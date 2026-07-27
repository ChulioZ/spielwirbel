'use strict';

/*
 * User accounts (issue #135): register -> verify -> login -> refresh -> reset,
 * plus the feature flag, anti-enumeration behaviour, and member linking.
 * No network: SMTP_PASS stays unset, so lib/mail.js captures every message
 * in its in-memory outbox and the tests read tokens out of the mail text —
 * exactly the delivery-degraded path a self-hoster without email runs.
 */

// The account feature is env-gated; enable it BEFORE the app is built (the
// flags are read per request, but being explicit keeps the setup obvious).
process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const accounts = require('../lib/accounts');
const { outbox } = require('../lib/mail');

const EMAIL = 'user@example.com';
const USERNAME = 'user_one';
const PASSWORD = 'correct horse battery';

// A fresh handle per call — registration requires a unique one (#320), so tests
// that are not ABOUT collisions must never reuse one by accident.
let handleSeq = 0;
const handle = () => `probe${(handleSeq += 1)}`;

// Pull the one-time token out of the latest captured mail. Since #434 the link
// carries a single combined "<version>.<uid>.<secret>" token; `uid` is returned
// too (parsed back out of it) so callers that pass both keep working — since
// #451 the server ignores a separate uid entirely, it does not resolve links.
function lastMailTokens() {
  const text = outbox[outbox.length - 1].text;
  const m = text.match(/\/[vr]\?t=([a-z0-9]+\.([0-9a-f]+)\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'mail contains a short one-time link');
  return { uid: m[2], token: m[1] };
}

// The line the link sits on, as the mail carries it.
function lastMailLinkLine() {
  const line = outbox[outbox.length - 1].text.split('\n').find((l) => l.includes('://'));
  assert.ok(line, 'mail contains a link line');
  return line;
}

/* ------------------------------ feature flag -------------------------------- */

test('the whole surface 404s while accounts are not enabled', async () => {
  const flag = process.env.ACCOUNTS_ENABLED;
  delete process.env.ACCOUNTS_ENABLED;
  try {
    for (const path of ['/api/account/register', '/api/account/login']) {
      const res = await request(app).post(path).send({ email: EMAIL, password: PASSWORD });
      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'accounts_disabled');
    }
  } finally {
    process.env.ACCOUNTS_ENABLED = flag;
  }
});

test('enabling accounts without a SESSION_SECRET keeps them off (forgeable tokens)', async () => {
  const secret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = '';
  try {
    const res = await request(app).post('/api/account/login').send({ email: EMAIL, password: PASSWORD });
    assert.equal(res.status, 404);
  } finally {
    process.env.SESSION_SECRET = secret;
  }
});

/* ------------------------------- validation --------------------------------- */

test('register validates email shape, username policy and password length', async () => {
  const post = (body) => request(app).post('/api/account/register').send(body);

  const bad = await post({ email: 'not-an-email', username: handle(), password: PASSWORD });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_email');

  const short = await post({ email: EMAIL, username: handle(), password: 'short' });
  assert.equal(short.status, 400);
  assert.equal(short.body.error, 'invalid_password');

  // No account may exist without a handle (#320) — that is what makes a backfill
  // unnecessary and what an abuse report needs to be able to name.
  for (const username of [
    undefined, '', '  ', 'ab', // absent / blank / under 3
    'a'.repeat(31), // over 30
    'has space', 'has.dot', 'exclaim!', 'ümläut', // outside the charset
  ]) {
    const res = await post({ email: EMAIL, username, password: PASSWORD });
    assert.equal(res.status, 400, `username ${JSON.stringify(username)} must be refused`);
    assert.equal(res.body.error, 'invalid_username');
  }

  // The full allowed charset, at both length bounds, is accepted.
  for (const username of ['a-B_9', 'abc', 'z'.repeat(30)]) {
    const res = await post({ email: `${username}@example.com`, username, password: PASSWORD });
    assert.equal(res.status, 200, `username ${username} must be accepted`);
  }
});

test('a taken username is refused openly — and cannot be used to probe for e-mails', async () => {
  const post = (body) => request(app).post('/api/account/register').send(body);
  await post({ email: 'taken-owner@example.com', username: 'TakenName', password: PASSWORD });

  // Openly refused, unlike a taken e-mail: a username is a public identifier, so
  // saying so reveals nothing — and the form is unusable if it cannot.
  const clash = await post({ email: 'someone-else@example.com', username: 'TakenName', password: PASSWORD });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, 'username_taken');

  // Case-insensitive: `takenname` is the same handle.
  const cased = await post({ email: 'third@example.com', username: 'takenname', password: PASSWORD });
  assert.equal(cased.status, 409);
  assert.equal(cased.body.error, 'username_taken');

  // The invariant that keeps the OPEN error from leaking the HIDDEN one: a
  // signup colliding on the username answers username_taken whether or not the
  // e-mail also exists. Were it the other way round, `{ ok: true }` here versus
  // 409 above would answer "does this address have an account?".
  const both = await post({ email: 'taken-owner@example.com', username: 'takenname', password: PASSWORD });
  assert.equal(both.status, 409);
  assert.equal(both.body.error, 'username_taken');
});

/* ------------------------- register -> verify -> login ---------------------- */

test('full account lifecycle', async (t) => {
  let verifyUid, verifyToken, tokens;

  await t.test('register creates the user and mails a verification link', async () => {
    const res = await request(app).post('/api/account/register')
      .send({ email: EMAIL.toUpperCase(), username: USERNAME, password: PASSWORD });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });

    ({ uid: verifyUid, token: verifyToken } = lastMailTokens());
    const user = await repo.getUserByEmail(EMAIL); // stored lowercased
    assert.equal(user.id, verifyUid);
    assert.equal(user.username, USERNAME); // stored as typed, unlike the e-mail
    assert.equal(user.emailVerified, false);
    // Only hashes at rest — never the raw password or token.
    assert.ok(!JSON.stringify(user).includes(PASSWORD));
    assert.ok(!JSON.stringify(user).includes(verifyToken));
  });

  await t.test('re-registering the same email answers identically and sends nothing', async () => {
    const before = outbox.length;
    // A FREE username, deliberately: that is the only way to reach the e-mail
    // check at all (a taken handle short-circuits first, by design), so this is
    // the request that actually tests the anti-enumeration answer.
    const res = await request(app).post('/api/account/register')
      .send({ email: EMAIL, username: handle(), password: 'other password 1' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true }); // indistinguishable from a fresh signup
    assert.equal(outbox.length, before);
  });

  await t.test('login before verification is refused', async () => {
    const res = await request(app).post('/api/account/login').send({ email: EMAIL, password: PASSWORD });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'email_not_verified');
    // The username path (#431) must not walk past the same guard.
    const byName = await request(app).post('/api/account/login').send({ login: USERNAME, password: PASSWORD });
    assert.equal(byName.status, 403);
    assert.equal(byName.body.error, 'email_not_verified');
  });

  await t.test('verify-email rejects a wrong token, accepts the mailed one once', async () => {
    const bad = await request(app).get(`/api/account/verify-email?uid=${verifyUid}&token=wrong`);
    assert.equal(bad.status, 400);

    const ok = await request(app).get(`/api/account/verify-email?uid=${verifyUid}&token=${verifyToken}`);
    assert.equal(ok.status, 200);

    const again = await request(app).get(`/api/account/verify-email?uid=${verifyUid}&token=${verifyToken}`);
    assert.equal(again.status, 400); // single-use
  });

  await t.test('login returns an access/refresh pair; wrong password stays a generic 401', async () => {
    const wrong = await request(app).post('/api/account/login').send({ email: EMAIL, password: 'wrong password' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, 'invalid_credentials');
    const unknown = await request(app).post('/api/account/login').send({ email: 'ghost@example.com', password: PASSWORD });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, 'invalid_credentials'); // same error: no enumeration

    const res = await request(app).post('/api/account/login').send({ email: EMAIL, password: PASSWORD });
    assert.equal(res.status, 200);
    assert.ok(res.body.accessToken && res.body.refreshToken);
    assert.equal(res.body.user.email, EMAIL);
    assert.equal(res.body.user.username, USERNAME); // the SPA shows it in the account menu
    tokens = res.body;
  });

  await t.test('the username logs in too, case-insensitively (#431)', async () => {
    const byName = await request(app).post('/api/account/login').send({ login: USERNAME, password: PASSWORD });
    assert.equal(byName.status, 200);
    assert.ok(byName.body.accessToken && byName.body.refreshToken);
    assert.equal(byName.body.user.email, EMAIL); // same account, same response shape

    // Registered as 'user_one'; the handle is matched case-insensitively in both
    // backends, so shouting it still works.
    const shouted = await request(app).post('/api/account/login')
      .send({ login: USERNAME.toUpperCase(), password: PASSWORD });
    assert.equal(shouted.status, 200);
    assert.equal(shouted.body.user.username, USERNAME);

    // An unknown handle is the generic 401, never a distinct "no such user" and
    // never a 500 from a null user.
    const ghost = await request(app).post('/api/account/login')
      .send({ login: 'nobody_at_all', password: PASSWORD });
    assert.equal(ghost.status, 401);
    assert.equal(ghost.body.error, 'invalid_credentials');

    const wrongPw = await request(app).post('/api/account/login')
      .send({ login: USERNAME, password: 'wrong password' });
    assert.equal(wrongPw.status, 401);
    assert.equal(wrongPw.body.error, 'invalid_credentials');

    // An empty identifier must fall through to the same generic answer rather
    // than resolving a user (getUserByUsername('') is null by contract).
    const blank = await request(app).post('/api/account/login').send({ login: '', password: PASSWORD });
    assert.equal(blank.status, 401);
    assert.equal(blank.body.error, 'invalid_credentials');
  });

  await t.test('the legacy { email } body still logs in (stale cached shell)', async () => {
    // The SPA shell is served cache-first, so a browser on a pre-#431 account.js
    // keeps POSTing `email` after the deploy. Dropping the alias would break
    // login for exactly those users until their cache turns over.
    const res = await request(app).post('/api/account/login').send({ email: EMAIL, password: PASSWORD });
    assert.equal(res.status, 200);
    assert.ok(res.body.accessToken && res.body.refreshToken);
  });

  await t.test('/me works with the access token, 401s without', async () => {
    const res = await request(app).get('/api/account/me').set('Authorization', `Bearer ${tokens.accessToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.email, EMAIL);
    assert.equal(res.body.username, USERNAME);
    assert.equal(res.body.emailVerified, true);

    assert.equal((await request(app).get('/api/account/me')).status, 401);
    assert.equal((await request(app).get('/api/account/me').set('Authorization', 'Bearer garbage')).status, 401);
  });

  await t.test('refresh rotates the token: the old one is spent, the new one works', async () => {
    const first = await request(app).post('/api/account/refresh').send({ refreshToken: tokens.refreshToken });
    assert.equal(first.status, 200);
    assert.ok(first.body.accessToken && first.body.refreshToken);
    assert.notEqual(first.body.refreshToken, tokens.refreshToken);

    const replay = await request(app).post('/api/account/refresh').send({ refreshToken: tokens.refreshToken });
    assert.equal(replay.status, 401); // rotation spent it

    tokens = { ...tokens, refreshToken: first.body.refreshToken };
  });

  await t.test('refresh rejects malformed and forged tokens', async () => {
    for (const bad of ['garbage', 'r1.someuser.token', null]) {
      const res = await request(app).post('/api/account/refresh').send({ refreshToken: bad });
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'invalid_refresh_token');
    }
  });

  await t.test('logout revokes the refresh token', async () => {
    const res = await request(app).post('/api/account/logout').send({ refreshToken: tokens.refreshToken });
    assert.equal(res.status, 200);
    const after = await request(app).post('/api/account/refresh').send({ refreshToken: tokens.refreshToken });
    assert.equal(after.status, 401);
  });

  await t.test('password reset: forgot mails a link, reset swaps the hash and revokes sessions', async () => {
    // A live session that the reset must revoke.
    const login = await request(app).post('/api/account/login').send({ email: EMAIL, password: PASSWORD });
    const preResetRefresh = login.body.refreshToken;

    const before = outbox.length;
    const ghost = await request(app).post('/api/account/forgot-password').send({ email: 'ghost@example.com' });
    assert.equal(ghost.status, 200); // identical answer, no mail
    assert.equal(outbox.length, before);

    const res = await request(app).post('/api/account/forgot-password').send({ email: EMAIL });
    assert.equal(res.status, 200);
    const { uid, token } = lastMailTokens();

    const badToken = await request(app).post('/api/account/reset-password')
      .send({ uid, token: 'wrong', password: 'brand new password' });
    assert.equal(badToken.status, 400);

    const ok = await request(app).post('/api/account/reset-password')
      .send({ uid, token, password: 'brand new password' });
    assert.equal(ok.status, 200);

    const replay = await request(app).post('/api/account/reset-password')
      .send({ uid, token, password: 'another password 9' });
    assert.equal(replay.status, 400); // single-use

    const oldPw = await request(app).post('/api/account/login').send({ email: EMAIL, password: PASSWORD });
    assert.equal(oldPw.status, 401);
    const newPw = await request(app).post('/api/account/login').send({ email: EMAIL, password: 'brand new password' });
    assert.equal(newPw.status, 200);

    const revoked = await request(app).post('/api/account/refresh').send({ refreshToken: preResetRefresh });
    assert.equal(revoked.status, 401); // reset revoked every session
  });

  await t.test('an expired verification token is refused', async () => {
    await request(app).post('/api/account/register')
      .send({ email: 'late@example.com', username: handle(), password: PASSWORD });
    const { uid, token } = lastMailTokens();
    const user = await repo.getUserById(uid);
    await repo.updateUser(uid, {
      verification: { ...user.verification, expiresAt: new Date(Date.now() - 1000).toISOString() },
    });
    const res = await request(app).get(`/api/account/verify-email?uid=${uid}&token=${token}`);
    assert.equal(res.status, 400);
  });
});

/* -------------------- login by username: the guards it keeps ---------------- */

test('username login keeps the suspension guard, and forgot-password ignores handles (#431)', async () => {
  const email = 'byname@example.com';
  const username = 'by_name';
  await request(app).post('/api/account/register').send({ email, username, password: PASSWORD });
  const { uid, token } = lastMailTokens();
  await request(app).post('/api/account/verify-email').send({ uid, token });

  const ok = await request(app).post('/api/account/login').send({ login: username, password: PASSWORD });
  assert.equal(ok.status, 200);

  // An operator suspension (#268) must bite on the username path exactly as it
  // does on the e-mail one — and still only AFTER the password check, so it
  // stays unreachable for anyone who hasn't proven ownership.
  await repo.updateUser(uid, { disabled: true });
  const suspended = await request(app).post('/api/account/login').send({ login: username, password: PASSWORD });
  assert.equal(suspended.status, 403);
  assert.equal(suspended.body.error, 'account_disabled');
  const suspendedWrongPw = await request(app).post('/api/account/login')
    .send({ login: username, password: 'wrong password' });
  assert.equal(suspendedWrongPw.status, 401, 'suspension must not leak before the password check');
  assert.equal(suspendedWrongPw.body.error, 'invalid_credentials');
  await repo.updateUser(uid, { disabled: false });

  // forgot-password stays e-mail-only ON PURPOSE: accepting the public handle
  // there would let anyone aim reset mail at a stranger's inbox knowing only
  // their username. It answers ok either way, so assert on the mail.
  const before = outbox.length;
  const forgot = await request(app).post('/api/account/forgot-password').send({ email: username });
  assert.equal(forgot.status, 200);
  assert.deepEqual(forgot.body, { ok: true }); // silent, like every unknown address
  assert.equal(outbox.length, before, 'a username must not trigger reset mail');
});

/* --------------------------- resend verification ---------------------------- */

// Backdate the stored challenge so the per-account cooldown (#435) has lapsed,
// without making the test sleep for it.
async function clearResendCooldown(uid) {
  const user = await repo.getUserById(uid);
  await repo.updateUser(uid, {
    verification: { ...user.verification, sentAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
  });
}

test('resend-verification recovers a lost mail without leaking who has an account (#435)', async (t) => {
  const email = 'resend@example.com';
  await request(app).post('/api/account/register')
    .send({ email, username: handle(), password: PASSWORD });
  const first = lastMailTokens();

  await t.test('a resend mails a NEW working link and invalidates the old one', async () => {
    await clearResendCooldown(first.uid);
    const before = outbox.length;
    const res = await request(app).post('/api/account/resend-verification').send({ email });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(outbox.length, before + 1);

    const next = lastMailTokens();
    assert.equal(next.uid, first.uid);
    assert.notEqual(next.token, first.token); // a fresh challenge, not a re-send of the old one

    // The superseded link must be dead — a resend may not leave two valid tokens.
    const stale = await request(app).get(`/api/account/verify-email?uid=${first.uid}&token=${first.token}`);
    assert.equal(stale.status, 400);

    const ok = await request(app).get(`/api/account/verify-email?uid=${next.uid}&token=${next.token}`);
    assert.equal(ok.status, 200);
  });

  // The account above is verified from here on, which is exactly one of the three
  // cases that must be indistinguishable.
  await t.test('unknown, malformed and already-verified addresses answer identically and mail nothing', async () => {
    for (const probe of ['ghost@example.com', 'not-an-email', email]) {
      const before = outbox.length;
      const res = await request(app).post('/api/account/resend-verification').send({ email: probe });
      assert.equal(res.status, 200, probe);
      assert.deepEqual(res.body, { ok: true }, probe);
      assert.equal(outbox.length, before, `no mail for ${probe}`);
    }
    // A missing body must not 400 either — that alone would be a probe.
    const empty = await request(app).post('/api/account/resend-verification').send({});
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body, { ok: true });
  });

  await t.test('a second resend inside the cooldown is silently skipped', async () => {
    const pending = 'cooldown@example.com';
    await request(app).post('/api/account/register')
      .send({ email: pending, username: handle(), password: PASSWORD });

    // Registration has just mailed a link, so the cooldown is running.
    const before = outbox.length;
    const throttled = await request(app).post('/api/account/resend-verification').send({ email: pending });
    assert.equal(throttled.status, 200);
    assert.deepEqual(throttled.body, { ok: true }); // indistinguishable from a real send
    assert.equal(outbox.length, before, 'no mail while the cooldown runs');

    // …and once it lapses, the same request does send.
    const user = await repo.getUserByEmail(pending);
    await clearResendCooldown(user.id);
    const res = await request(app).post('/api/account/resend-verification').send({ email: pending });
    assert.equal(res.status, 200);
    assert.equal(outbox.length, before + 1);
  });

  await t.test('a verification record predating #435 carries no sentAt and still resends', async () => {
    const legacy = 'legacy@example.com';
    await request(app).post('/api/account/register')
      .send({ email: legacy, username: handle(), password: PASSWORD });
    const user = await repo.getUserByEmail(legacy);
    // Exactly the shape register wrote before this feature: no sentAt at all.
    await repo.updateUser(user.id, {
      verification: { tokenHash: user.verification.tokenHash, expiresAt: user.verification.expiresAt },
    });

    const before = outbox.length;
    const res = await request(app).post('/api/account/resend-verification').send({ email: legacy });
    assert.equal(res.status, 200);
    assert.equal(outbox.length, before + 1, 'a missing sentAt must read as "long ago", not "just now"');
  });
});

/* ------------------------------ forgot password ----------------------------- */

// Backdate the stored reset challenge so the per-account cooldown (#447) has
// lapsed — the reset-side twin of clearResendCooldown above.
async function clearResetCooldown(uid) {
  const user = await repo.getUserById(uid);
  await repo.updateUser(uid, {
    reset: { ...user.reset, sentAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
  });
}

test('forgot-password is throttled per account, silently (#447)', async (t) => {
  const email = 'forgot@example.com';
  await request(app).post('/api/account/register')
    .send({ email, username: handle(), password: PASSWORD });
  const { uid } = lastMailTokens();

  await t.test('a second request inside the cooldown mails nothing and says nothing', async () => {
    const first = await request(app).post('/api/account/forgot-password').send({ email });
    assert.equal(first.status, 200);
    const mailed = lastMailTokens();

    const before = outbox.length;
    const throttled = await request(app).post('/api/account/forgot-password').send({ email });
    assert.equal(throttled.status, 200);
    assert.deepEqual(throttled.body, { ok: true }); // indistinguishable from a real send
    assert.equal(outbox.length, before, 'no mail while the cooldown runs');

    // The skip must not have re-minted: the already-mailed link still works.
    // (Checked last — reset-password burns the token and revokes the sessions.)
    const still = await request(app).post('/api/account/reset-password')
      .send({ uid: mailed.uid, token: mailed.token, password: 'a whole new password' });
    assert.equal(still.status, 200, 'a throttled request must not invalidate the link already sent');
  });

  await t.test('once the cooldown lapses the same request mails a fresh working link', async () => {
    // reset-password above cleared `reset` to null, so there is no sentAt left to
    // backdate — that absent case is the next subtest's subject. Mail one first.
    const seed = await request(app).post('/api/account/forgot-password').send({ email });
    assert.equal(seed.status, 200);
    const stale = lastMailTokens();

    await clearResetCooldown(uid);
    const before = outbox.length;
    const res = await request(app).post('/api/account/forgot-password').send({ email });
    assert.equal(res.status, 200);
    assert.equal(outbox.length, before + 1);

    const next = lastMailTokens();
    assert.equal(next.uid, uid);
    assert.notEqual(next.token, stale.token); // a genuinely fresh challenge

    const ok = await request(app).post('/api/account/reset-password')
      .send({ uid: next.uid, token: next.token, password: PASSWORD });
    assert.equal(ok.status, 200);
  });

  await t.test('a reset record predating #447 carries no sentAt and still mails', async () => {
    await request(app).post('/api/account/forgot-password').send({ email });
    const user = await repo.getUserById(uid);
    // Exactly the shape the handler wrote before this change: no sentAt at all.
    await repo.updateUser(uid, {
      reset: { tokenHash: user.reset.tokenHash, expiresAt: user.reset.expiresAt },
    });

    const before = outbox.length;
    const res = await request(app).post('/api/account/forgot-password').send({ email });
    assert.equal(res.status, 200);
    assert.equal(outbox.length, before + 1, 'a missing sentAt must read as "long ago", not "just now"');
  });

  await t.test('unknown, malformed and password-less accounts answer identically and mail nothing', async () => {
    // An account with no password identity: registered, then its identities
    // emptied — forgot-password has nothing to reset for it.
    const noPw = 'nopassword@example.com';
    await request(app).post('/api/account/register')
      .send({ email: noPw, username: handle(), password: PASSWORD });
    const other = await repo.getUserByEmail(noPw);
    await repo.updateUser(other.id, { identities: [] });

    for (const probe of ['ghost@example.com', 'not-an-email', noPw]) {
      const before = outbox.length;
      const res = await request(app).post('/api/account/forgot-password').send({ email: probe });
      assert.equal(res.status, 200, probe);
      assert.deepEqual(res.body, { ok: true }, probe);
      assert.equal(outbox.length, before, `no mail for ${probe}`);
    }
    // A missing body must not 400 either — that alone would be a probe.
    const empty = await request(app).post('/api/account/forgot-password').send({});
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body, { ok: true });
  });
});

/* ----------------------------- mailed link shape ---------------------------- */

// #434: the reported bug was a verification link arriving cut in half. The mail
// body is quoted-printable (the German text has umlauts) and QP wraps at 76
// columns with a '=' soft break — which landed INSIDE the 107-character URL.
// A compliant client rejoins it, but the body carries a bare text URL, so
// whether it stays clickable is up to the receiving client's auto-linkifier
// spanning that break. The reporter's did not.
//
// RFC 2045: a QP line may be at most 76 characters INCLUDING the trailing '=',
// so 75 characters of content is the last width that is never broken. The link
// sits alone on its line, and every character of it is QP-safe (hex uid,
// base64url secret, no '='), so the encoded width equals the literal width.
const QP_SAFE_LINE = 75;

// The tests otherwise run without APP_BASE_URL, i.e. against a short
// http://localhost:3000 — which would pass this assertion no matter how long
// the link grew. Measure against the real production origin.
async function withProdBaseUrl(fn) {
  const prev = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = 'https://spielwirbel.app';
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = prev;
  }
}

test('the mailed links fit on one quoted-printable line (#434)', async (t) => {
  const email = 'qp@example.com';

  await t.test('the verification link is short enough never to be soft-broken', async () => {
    await withProdBaseUrl(() => request(app).post('/api/account/register')
      .send({ email, username: handle(), password: PASSWORD }));

    const line = lastMailLinkLine();
    assert.ok(line.length <= QP_SAFE_LINE,
      `verification link line is ${line.length} chars, must be <= ${QP_SAFE_LINE}: ${line}`);
    // The uid rides inside the token now; a second parameter is what made the
    // old URL too long in the first place.
    assert.match(line, /^https:\/\/spielwirbel\.app\/v\?t=v1\./);
    assert.doesNotMatch(line, /uid=/);
  });

  await t.test('the password-reset link is too', async () => {
    await withProdBaseUrl(() => request(app).post('/api/account/forgot-password').send({ email }));

    const line = lastMailLinkLine();
    assert.ok(line.length <= QP_SAFE_LINE,
      `reset link line is ${line.length} chars, must be <= ${QP_SAFE_LINE}: ${line}`);
    assert.match(line, /^https:\/\/spielwirbel\.app\/r\?t=p1\./);
    assert.doesNotMatch(line, /uid=/);
  });

  // The two prefixes exist so one mail's token can never be spent on the other
  // endpoint: both hash into the same `tokenHash` field, so without the version
  // check a verification link would double as a password-reset link.
  await t.test('a verification token cannot be spent on reset-password, or vice versa', async () => {
    const user = await repo.getUserByEmail(email);
    const verify = accounts.mintLinkToken(accounts.VERIFY_TOKEN_VERSION, user.id, 'secret');
    const reset = accounts.mintLinkToken(accounts.RESET_TOKEN_VERSION, user.id, 'secret');
    // Plant one known secret in BOTH records, so only the prefix separates them.
    await repo.updateUser(user.id, {
      verification: { tokenHash: accounts.hashToken('secret'), expiresAt: new Date(Date.now() + 60000).toISOString() },
      reset: { tokenHash: accounts.hashToken('secret'), expiresAt: new Date(Date.now() + 60000).toISOString() },
    });

    const crossed = await request(app).post('/api/account/reset-password')
      .send({ token: verify, password: 'crossing the streams' });
    assert.equal(crossed.status, 400, 'a verification token must not reset a password');

    const other = await request(app).get(`/api/account/verify-email?token=${encodeURIComponent(reset)}`);
    assert.equal(other.status, 400, 'a reset token must not verify an e-mail');

    // ...while each one still works on its own endpoint, so the refusals above
    // are the prefix check and not some unrelated breakage.
    const ok = await request(app).get(`/api/account/verify-email?token=${encodeURIComponent(verify)}`);
    assert.equal(ok.status, 200);
  });
});

// #451: the pre-#434 `uid=` + bare-token pair was carried by a fallback in
// linkCredentials() so links already in inboxes at deploy time kept working.
// Removed once that transition was over — #434 deployed 2026-07-25T23:59Z, reset
// links (1 h) were long dead, and the last verification links (24 h) were let go
// ~16 h early by operator decision: they fall back to resend-verification. Pin
// the removal — a bare token must now be refused even against a matching record,
// so nobody "restores" the branch by reading it as a bug.
test('a pre-#434 uid=/token= link is refused (#451)', async (t) => {
  const email = 'legacy-link@example.com';
  await request(app).post('/api/account/register')
    .send({ email, username: handle(), password: PASSWORD });
  const user = await repo.getUserByEmail(email);
  const legacy = accounts.newRawToken(); // the old 32-byte bare token

  await t.test('verify-email refuses the separate uid and bare token', async () => {
    await repo.updateUser(user.id, {
      verification: { tokenHash: accounts.hashToken(legacy), expiresAt: new Date(Date.now() + 60000).toISOString() },
    });
    const res = await request(app).get(`/api/account/verify-email?uid=${user.id}&token=${legacy}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_token');
    // Still unverified: the refusal is a refusal, not a silent success.
    assert.equal((await repo.getUserById(user.id)).emailVerified, false);
  });

  await t.test('reset-password does too, leaving the password unchanged', async () => {
    await repo.updateUser(user.id, {
      reset: { tokenHash: accounts.hashToken(legacy), expiresAt: new Date(Date.now() + 60000).toISOString() },
    });
    const res = await request(app).post('/api/account/reset-password')
      .send({ uid: user.id, token: legacy, password: 'a legacy-link password' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_token');
    const stored = await repo.getUserById(user.id);
    const identity = (stored.identities || []).find((i) => i.type === 'password');
    assert.ok(await accounts.verifyPassword(identity.hash, PASSWORD),
      'the original password must survive a refused legacy reset');
  });
});

/* ------------------------------ member linking ------------------------------ */

test('a seat can be claimed and released by its own account (#421)', async () => {
  // Accounts are on in this file (#138 gate), so the round is created with an
  // account's Bearer token — which since #421 seats the creator at index 0.
  const email = 'linkme@example.com';
  await request(app).post('/api/account/register').send({ email, username: 'linkme', password: PASSWORD });
  const { uid, token: vtok } = lastMailTokens();
  await request(app).post('/api/account/verify-email').send({ uid, token: vtok });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  const bearer = `Bearer ${login.body.accessToken}`;
  const user = await repo.getUserByEmail(email);

  const created = await request(app)
    .post('/api/rounds').set('Authorization', bearer)
    .send({ name: 'Test round', members: ['Alice', 'Bob'] });
  const round = created.body;
  assert.deepEqual(round.members.map((m) => m.name), ['linkme', 'Alice', 'Bob']);
  assert.equal(round.members[0].userId, user.id);
  const own = round.members[0].id;
  const alice = round.members[1].id;

  // Release the auto-seat, then claim Alice's chair instead: the deliberate
  // two-step move (a claim never silently unlinks the seat you already hold).
  const released = await request(app).patch(`/api/rounds/${round.id}/members/${own}`)
    .set('Authorization', bearer).send({ userId: null });
  assert.equal(released.status, 200);
  assert.equal(released.body.userId, null);

  const claimed = await request(app).patch(`/api/rounds/${round.id}/members/${alice}`)
    .set('Authorization', bearer).send({ userId: user.id });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.userId, user.id);
  // The seat keeps its own name — claiming links an account, it doesn't rename.
  assert.equal(claimed.body.name, 'Alice');
});

// The payoff for the auto-seat: actorSeat (routes/games.js) resolves the acting
// account to a member by m.userId, so before #421 an owner's own actions carried
// no actorMemberId and the Chronik showed no „von …" for them, ever.
test('the creator is attributed in the activity feed from the first action (#421)', async () => {
  const email = 'attrib@example.com';
  await request(app).post('/api/account/register').send({ email, username: 'attrib', password: PASSWORD });
  const { uid, token: vtok } = lastMailTokens();
  await request(app).post('/api/account/verify-email').send({ uid, token: vtok });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  const bearer = `Bearer ${login.body.accessToken}`;

  const round = (await request(app).post('/api/rounds').set('Authorization', bearer)
    .send({ name: 'Attributed', members: ['Ann'] })).body;
  await request(app).post(`/api/rounds/${round.id}/games`).set('Authorization', bearer)
    .send({ title: 'Catan', minPlayers: 2, maxPlayers: 4 });

  const feed = (await request(app).get(`/api/rounds/${round.id}/activities`).set('Authorization', bearer)).body;
  const added = feed.find((a) => a.type === 'game_added');
  assert.equal(added.actorMemberId, round.members[0].id);
  assert.equal(round.members[0].name, 'attrib');
});

test('the owner seat can be opted out of, and a solo round needs no typed members (#421)', async () => {
  const email = 'solo@example.com';
  await request(app).post('/api/account/register').send({ email, username: 'solo', password: PASSWORD });
  const { uid, token: vtok } = lastMailTokens();
  await request(app).post('/api/account/verify-email').send({ uid, token: vtok });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  const bearer = `Bearer ${login.body.accessToken}`;
  const post = (body) => request(app).post('/api/rounds').set('Authorization', bearer).send(body);

  // Just me: the common way to start a round now, and it used to be a 400.
  const solo = await post({ name: 'Solo', members: [] });
  assert.equal(solo.status, 201);
  assert.deepEqual(solo.body.members.map((m) => m.name), ['solo']);

  // Opted out: byte-identical to pre-#421 — no seat, and no `userId` key at all.
  const optedOut = await post({ name: 'No seat', members: ['Ann'], ownerSeat: false });
  assert.equal(optedOut.status, 201);
  assert.deepEqual(optedOut.body.members.map((m) => m.name), ['Ann']);
  assert.deepEqual(Object.keys(optedOut.body.members[0]).sort(), ['id', 'name']);

  // Opted out AND nothing typed leaves an empty table, which is still refused.
  const empty = await post({ name: 'Nobody', members: [], ownerSeat: false });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, 'At least one member is required');
});

test('the seat link is self-claim only: strangers, taken seats and second seats are refused (#421)', async () => {
  const mk = async (handleName) => {
    const email = `${handleName}@example.com`;
    await request(app).post('/api/account/register').send({ email, username: handleName, password: PASSWORD });
    const { uid, token: vtok } = lastMailTokens();
    await request(app).post('/api/account/verify-email').send({ uid, token: vtok });
    const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
    return { bearer: `Bearer ${login.body.accessToken}`, user: await repo.getUserByEmail(email) };
  };
  const owner = await mk('claimowner');
  const other = await mk('claimother');

  const created = await request(app).post('/api/rounds').set('Authorization', owner.bearer)
    .send({ name: 'Claims', members: ['Alice', 'Bob'] });
  const round = created.body;
  const [ownSeat, alice, bob] = round.members.map((m) => m.id);
  const patch = (mid, body) =>
    request(app).patch(`/api/rounds/${round.id}/members/${mid}`).set('Authorization', owner.bearer).send(body);

  // Never link a STRANGER's account — the pre-#421 route took any existing user
  // id from anyone with round access, which is what made this reachable.
  const stranger = await patch(alice, { userId: other.user.id });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.error, 'not_self');

  // An unknown id is refused the same way: it is simply not the caller. (It used
  // to be a 400 'Unknown user', which also answered "does this id exist?".)
  assert.equal((await patch(alice, { userId: 'nope' })).status, 403);

  // One seat per account per round — actorSeat/seatOf both .find(), so two seats
  // for one account is undefined behaviour.
  const second = await patch(alice, { userId: owner.user.id });
  assert.equal(second.status, 400);
  assert.equal(second.body.error, 'already_seated');

  // Releasing a seat that is not yours is refused. This is the case that used to
  // strand a grantee with full access and no chair, their old seat re-offered in
  // the invite dialog.
  const ownerTenant = (await repo.getUserById(owner.user.id)).tenantId;
  await repo.forTenant(ownerTenant).updateMember(round.id, bob, { userId: other.user.id });
  const alienRelease = await patch(bob, { userId: null });
  assert.equal(alienRelease.status, 403);
  assert.equal(alienRelease.body.error, 'not_self');
  assert.equal((await repo.forTenant(ownerTenant).getRoundMeta(round.id))
    .members.find((m) => m.id === bob).userId, other.user.id);

  // A seat held by another account cannot be claimed either — 409, distinct from
  // the 403s so the UI can say which of the two happened.
  await patch(ownSeat, { userId: null }); // free myself up first
  const taken = await patch(bob, { userId: owner.user.id });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error, 'seat_taken');

  // Name/colour edits are untouched by the tightening.
  const renamed = await patch(bob, { name: 'Bobby' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, 'Bobby');
});

/* --------------------------- token primitive edges -------------------------- */

test('access tokens are JWTs that reject tampering, wrong signature, and expiry', () => {
  const good = accounts.mintAccessToken('user1');
  assert.equal(accounts.verifyAccessToken(good), 'user1');

  const parts = good.split('.');
  assert.equal(parts.length, 3); // a real JWT: header.payload.signature
  const [header, payload, sig] = parts;

  // Swap the payload for one with a different sub while keeping the original
  // signature — the signature covers header+payload, so verification must fail.
  const forged = Buffer.from(JSON.stringify({ sub: 'other' })).toString('base64url');
  assert.equal(accounts.verifyAccessToken(`${header}.${forged}.${sig}`), null);

  assert.equal(accounts.verifyAccessToken(`${header}.${payload}.deadbeef`), null); // bad signature
  assert.equal(accounts.verifyAccessToken('garbage'), null); // not a JWT
  assert.equal(accounts.verifyAccessToken(accounts.mintAccessToken('user1', -1000)), null); // expired
});

test('access tokens are signed with SESSION_SECRET only — no AUTH_PASSWORD fallback', () => {
  const token = accounts.mintAccessToken('user1');

  // A different SESSION_SECRET must not verify the token...
  const realSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'a-completely-different-secret';
  try {
    assert.equal(accounts.verifyAccessToken(token), null);
  } finally {
    process.env.SESSION_SECRET = realSecret;
  }

  // ...and AUTH_PASSWORD is never consulted as a signing key: with SESSION_SECRET
  // cleared, verification fails even when AUTH_PASSWORD equals the old secret.
  process.env.SESSION_SECRET = '';
  process.env.AUTH_PASSWORD = realSecret;
  try {
    assert.equal(accounts.verifyAccessToken(token), null);
  } finally {
    process.env.SESSION_SECRET = realSecret;
    delete process.env.AUTH_PASSWORD;
  }
});

test('pushRefreshToken drops expired entries and caps the list at the oldest end', () => {
  const future = new Date(Date.now() + 1e6).toISOString();
  const expired = { tokenHash: 'old', createdAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-02T00:00:00.000Z' };
  const list = [expired];
  for (let i = 0; i < accounts.MAX_REFRESH_TOKENS + 3; i++) {
    list.push({ tokenHash: `t${i}`, createdAt: new Date(2026, 0, i + 1).toISOString(), expiresAt: future });
  }
  const next = accounts.pushRefreshToken(list, { tokenHash: 'newest', createdAt: new Date(2026, 6, 1).toISOString(), expiresAt: future });
  assert.equal(next.length, accounts.MAX_REFRESH_TOKENS);
  assert.ok(!next.some((t) => t.tokenHash === 'old')); // expired dropped
  assert.ok(!next.some((t) => t.tokenHash === 't0')); // oldest evicted
  assert.equal(next[next.length - 1].tokenHash, 'newest');
});

/* ------------------- the daily send budget stays silent (#448) -------------- */

// The global mail breaker (lib/mail.js) must never become an oracle. Register
// answers `{ ok: true }` whether it mailed, hit `email_taken`, or was refused by
// the budget — sendSafe() swallows the rejection, so all three are one response.
// A distinct code here would be a perfect account-existence probe, exactly as
// .claude/rules/mail-sending-endpoints-need-a-per-account-cooldown.md warns for
// the cooldown skips.
test('an exhausted mail budget does not change what register answers (#448)', async () => {
  const mail = require('../lib/mail');
  const saved = process.env.MAIL_DAILY_MAX;
  // Zero headroom: the very next send is refused.
  process.env.MAIL_DAILY_MAX = String(mail.budgetState().sent);
  try {
    const before = outbox.length;
    const fresh = await request(app).post('/api/account/register')
      .send({ email: 'budget-probe@example.com', username: handle(), password: PASSWORD });
    assert.equal(fresh.status, 200);
    assert.deepEqual(fresh.body, { ok: true });
    assert.equal(outbox.length, before, 'nothing was mailed');

    // …and the answer is byte-for-byte the one a taken address gets, which is
    // the pairing that makes the endpoint useless as a probe.
    const taken = await request(app).post('/api/account/register')
      .send({ email: EMAIL, username: handle(), password: PASSWORD });
    assert.equal(taken.status, fresh.status);
    assert.deepEqual(taken.body, fresh.body);
  } finally {
    if (saved === undefined) delete process.env.MAIL_DAILY_MAX; else process.env.MAIL_DAILY_MAX = saved;
  }
});

// A refused verification mail must not leave a half-built account: the row is
// committed before the send (sendSafe never fails the flow), so the standing
// recovery path (#435) is what gets the user unstuck.
//
// Note the account's `verification.sentAt` is stamped at creation even though
// nothing went out, so the 60 s per-account cooldown briefly suppresses a
// resend. That is harmless rather than a bug worth fixing: the budget is a
// whole-UTC-day breaker, so by the time a resend could actually deliver, the
// cooldown has long lapsed — it is never the binding constraint. Don't "fix" it
// by moving the mint after the send; #447 pins that the mint and the send stay
// together, or a double-submit invalidates the link already in the inbox.
test('a refused verification mail still leaves a usable, unverified account (#448)', async () => {
  const user = await repo.getUserByEmail('budget-probe@example.com');
  assert.ok(user, 'the account was committed even though its mail was refused');
  assert.equal(user.emailVerified, false);
  assert.ok(user.verification && user.verification.tokenHash, 'it holds a live challenge');

  // And the recovery endpoint stays silent either way — throttled, sent, or
  // unknown address are one answer (see the rule file above).
  const res = await request(app).post('/api/account/resend-verification')
    .send({ email: 'budget-probe@example.com' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

/* ------------------------------ change password ----------------------------- */

// Register + verify + log in a throwaway account; returns its tokens and id.
// Deliberately its own account per call: these specs replace the password, so
// sharing one with the suite's EMAIL/PASSWORD fixtures would couple them.
async function freshAccount(email) {
  const reg = await request(app).post('/api/account/register')
    .send({ email, username: handle(), password: PASSWORD });
  assert.equal(reg.status, 200);
  const { uid, token } = lastMailTokens();
  await request(app).post('/api/account/verify-email').send({ token });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { uid, accessToken: login.body.accessToken, refreshToken: login.body.refreshToken };
}

const changePassword = (accessToken, body) => request(app)
  .post('/api/account/change-password')
  .set('Authorization', `Bearer ${accessToken}`)
  .send(body);

test('change-password swaps the credential, evicts other sessions and keeps the caller in (#482)', async (t) => {
  const email = 'changer@example.com';
  const NEW = 'a brand new secret';
  const acc = await freshAccount(email);

  // A second, independent session — the one the change must evict.
  const other = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(other.status, 200);

  await t.test('a wrong current password refuses with 401 and changes nothing', async () => {
    const res = await changePassword(acc.accessToken, { currentPassword: 'not it', newPassword: NEW });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_credentials');
    const still = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
    assert.equal(still.status, 200, 'the old password still works');
  });

  await t.test('a too-short new password is refused with the same code as register/reset', async () => {
    const res = await changePassword(acc.accessToken, { currentPassword: PASSWORD, newPassword: 'short' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_password');
    const still = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
    assert.equal(still.status, 200);
  });

  await t.test('an unauthenticated call is refused by the token guard', async () => {
    const res = await request(app).post('/api/account/change-password')
      .send({ currentPassword: PASSWORD, newPassword: NEW });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_token');
  });

  await t.test('the change succeeds, mails a notification and hands back a live token pair', async () => {
    const before = outbox.length;
    const res = await changePassword(acc.accessToken, { currentPassword: PASSWORD, newPassword: NEW });
    assert.equal(res.status, 200);
    assert.ok(res.body.accessToken && res.body.refreshToken, 'the caller is handed a fresh pair');
    assert.equal(outbox.length, before + 1, 'the owner is told their password changed');
    assert.match(outbox[outbox.length - 1].text, /Passwort/);
    assert.equal(outbox[outbox.length - 1].to, email);

    // The caller stays signed in: the pair it was just handed still refreshes.
    const mine = await request(app).post('/api/account/refresh')
      .send({ refreshToken: res.body.refreshToken });
    assert.equal(mine.status, 200);
  });

  await t.test('the old password is dead and the new one works', async () => {
    const old = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
    assert.equal(old.status, 401);
    const now = await request(app).post('/api/account/login').send({ email, password: NEW });
    assert.equal(now.status, 200);
  });

  await t.test('every OTHER session was evicted', async () => {
    // The whole point of clearing refreshTokens: a stolen session must not
    // outlive the change that was meant to end it.
    const res = await request(app).post('/api/account/refresh')
      .send({ refreshToken: other.body.refreshToken });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_refresh_token');
  });
});

test('change-password kills a pending reset link (#482)', async () => {
  const email = 'changer-reset@example.com';
  const acc = await freshAccount(email);

  // Somebody triggered a reset; the owner instead changes the password in-app.
  await request(app).post('/api/account/forgot-password').send({ email });
  const { token } = lastMailTokens();

  const changed = await changePassword(acc.accessToken, {
    currentPassword: PASSWORD, newPassword: 'chosen deliberately',
  });
  assert.equal(changed.status, 200);

  const reset = await request(app).post('/api/account/reset-password')
    .send({ token, password: 'attacker chosen pw' });
  assert.equal(reset.status, 400, 'the outstanding link died with the deliberate change');
  assert.equal(reset.body.error, 'invalid_token');
});

test('a failed notification mail does not 500 a completed change (#482)', async () => {
  const email = 'changer-mailfail@example.com';
  const NEW = 'still changed anyway';
  const acc = await freshAccount(email);

  const mail = require('../lib/mail');
  const real = mail.send;
  mail.send = () => Promise.reject(new Error('smtp down'));
  try {
    const res = await changePassword(acc.accessToken, { currentPassword: PASSWORD, newPassword: NEW });
    assert.equal(res.status, 200);
  } finally {
    mail.send = real;
  }
  // The change itself is persisted — the mail is a notification, not a step.
  const now = await request(app).post('/api/account/login').send({ email, password: NEW });
  assert.equal(now.status, 200);
});

test('change-password is gated with the rest of the account surface (#482)', async () => {
  const flag = process.env.ACCOUNTS_ENABLED;
  delete process.env.ACCOUNTS_ENABLED;
  try {
    const res = await request(app).post('/api/account/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'whatever it is' });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'accounts_disabled');
  } finally {
    process.env.ACCOUNTS_ENABLED = flag;
  }
});

/* ---------------------------- BGG handle (#481) ----------------------------- */

const patchMe = (accessToken, body) => request(app)
  .patch('/api/account/me')
  .set('Authorization', `Bearer ${accessToken}`)
  .send(body);

const getMe = (accessToken) => request(app)
  .get('/api/account/me')
  .set('Authorization', `Bearer ${accessToken}`);

test('the BGG handle round-trips through /me and can be cleared (#481)', async () => {
  const acc = await freshAccount('bgg-handle@example.com');

  // A fresh account has the key present and empty, so a client never has to
  // distinguish "never set" from "cleared".
  const before = await getMe(acc.accessToken);
  assert.equal(before.status, 200);
  assert.equal(before.body.bggUsername, null);

  const set = await patchMe(acc.accessToken, { bggUsername: '  BoardGamer_42  ' });
  assert.equal(set.status, 200);
  assert.equal(set.body.bggUsername, 'BoardGamer_42', 'trimmed, stored as typed');
  assert.equal((await getMe(acc.accessToken)).body.bggUsername, 'BoardGamer_42');

  // A blank string is the form's own "clear it", and so is an explicit null.
  assert.equal((await patchMe(acc.accessToken, { bggUsername: '   ' })).body.bggUsername, null);
  await patchMe(acc.accessToken, { bggUsername: 'again' });
  assert.equal((await patchMe(acc.accessToken, { bggUsername: null })).body.bggUsername, null);
});

test('PATCH /me refuses an unusable BGG handle and leaves the stored one alone (#481)', async () => {
  const acc = await freshAccount('bgg-handle-bad@example.com');
  await patchMe(acc.accessToken, { bggUsername: 'Keeper' });

  const TAB = String.fromCharCode(9);
  const NUL = String.fromCharCode(0);
  for (const bad of ['has space', 'x'.repeat(61), 'a' + TAB + 'b', 'a' + NUL + 'b']) {
    const res = await patchMe(acc.accessToken, { bggUsername: bad });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    assert.equal(res.body.error, 'invalid_bgg_username');
  }
  assert.equal((await getMe(acc.accessToken)).body.bggUsername, 'Keeper', 'a refusal writes nothing');
});

test('PATCH /me leaves the handle alone when the key is absent, and never exposes secrets (#481)', async () => {
  const acc = await freshAccount('bgg-handle-absent@example.com');
  await patchMe(acc.accessToken, { bggUsername: 'Stays' });

  // Absent key = "leave it alone", so a client that knows nothing about this
  // field cannot blank it by omission.
  const res = await patchMe(acc.accessToken, { somethingElse: 1 });
  assert.equal(res.status, 200);
  assert.equal(res.body.bggUsername, 'Stays');

  // The shared projection is what keeps the stored record's secrets out of the
  // response — asserted here so a field added to the user shape later cannot
  // ride out of /me unnoticed.
  // `demo`/`demoExpiresAt` (#427) are present on EVERY account, not just demo
  // ones — the projection normalizes them (false/null here), which is what lets
  // the client decide whether to show the demo banner without a second call.
  assert.deepEqual(Object.keys(res.body).sort(),
    ['bggUsername', 'createdAt', 'demo', 'demoExpiresAt', 'email', 'emailVerified', 'id', 'username']);
  assert.equal(res.body.demo, false);
  assert.equal(res.body.demoExpiresAt, null);

  // An unauthenticated caller gets nowhere near it.
  assert.equal((await request(app).patch('/api/account/me').send({ bggUsername: 'x' })).status, 401);
});
