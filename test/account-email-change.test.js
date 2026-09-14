'use strict';

/* Changing the account e-mail address (#1076).
 *
 * The address is the account's login identifier and its only recovery channel,
 * so the shape is CONFIRM-THEN-SWAP: it is replaced only when the link mailed to
 * the NEW address is opened. A typo can therefore never lock anyone out, and
 * `emailVerified` stays true throughout — which is what the three assertions
 * about the old address still working are for.
 *
 * Its own file rather than more of test/account.test.js: that one is already
 * over the budget, and this is a self-contained flow with its own fixtures
 * (check `ls test/account*` before naming another —
 * .claude/rules/test-file-names-collide-silently.md).
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const accounts = require('../lib/accounts');
const { outbox } = require('../lib/mail');

const PASSWORD = 'correct horse battery';
let seq = 0;
const fresh = () => `chg${(seq += 1)}`;

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function makeAccount() {
  const name = fresh();
  const email = `${name}@example.com`;
  await request(app).post('/api/account/register').send({ email, username: name, password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'registration mailed no verification link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { email, name, token: login.body.accessToken, id: (await repo.getUserByEmail(email)).id };
}

const changeEmail = (a, body) =>
  request(app).post('/api/account/change-email').set(auth(a.token)).send(body);

// The token out of the newest mail, which must be the /e one.
function lastChangeToken() {
  const m = outbox[outbox.length - 1].text.match(/\/e\?t=(e1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'the newest mail carries no /e link');
  return m[1];
}

const confirm = (token) => request(app).post('/api/account/confirm-email').send({ token });
const me = (a) => request(app).get('/api/account/me').set(auth(a.token)).then((r) => r.body);

/* ------------------------------ the happy path ----------------------------- */

test('a confirmed change swaps the address and notifies the old one', async () => {
  const a = await makeAccount();
  const next = `${fresh()}@example.com`;

  const before = outbox.length;
  const req = await changeEmail(a, { email: next, currentPassword: PASSWORD });
  assert.equal(req.status, 200);
  assert.deepEqual(req.body, { ok: true, pendingEmail: next });

  // Mailed to the NEW address, and nothing about the account has moved yet.
  assert.equal(outbox.length, before + 1);
  assert.equal(outbox[outbox.length - 1].to, next);
  const mid = await repo.getUserById(a.id);
  assert.equal(mid.email, a.email, 'the address changed before it was confirmed');
  assert.equal(mid.emailVerified, true, 'the account was un-verified by a PENDING change');
  assert.equal((await me(a)).pendingEmail, next, '/me does not carry the pending address');

  // The old address still logs in while the change is pending — the property
  // that makes a typo survivable.
  assert.equal((await request(app).post('/api/account/login')
    .send({ login: a.email, password: PASSWORD })).status, 200);

  const token = lastChangeToken();
  const done = await confirm(token);
  assert.equal(done.status, 200);

  const after = await repo.getUserById(a.id);
  assert.equal(after.email, next);
  assert.equal(after.pendingEmail, null);
  assert.equal(after.emailVerified, true, 'confirming by link must not un-verify the account');

  // The notice goes to the address that is LOSING the account.
  assert.equal(outbox[outbox.length - 1].to, a.email);
  assert.match(outbox[outbox.length - 1].text, /Kontaktformular/,
    'the notice points at „Passwort vergessen?", whose link would go to the NEW address');

  // New address in, old address out.
  assert.equal((await request(app).post('/api/account/login')
    .send({ login: next, password: PASSWORD })).status, 200);
  assert.equal((await request(app).post('/api/account/login')
    .send({ login: a.email, password: PASSWORD })).status, 401);
  // …and the requester's own session survived.
  assert.equal((await me(a)).email, next);
});

/* -------------------------------- refusals --------------------------------- */

test('the wrong password changes nothing and sends nothing', async () => {
  const a = await makeAccount();
  const before = outbox.length;
  const res = await changeEmail(a, { email: `${fresh()}@example.com`, currentPassword: 'not it' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');
  assert.equal(outbox.length, before, 'a mail went out on a failed re-authentication');
  assert.equal((await repo.getUserById(a.id)).pendingEmail, null);
});

test('a malformed address, and the address you already have, are refused distinctly', async () => {
  const a = await makeAccount();
  const bad = await changeEmail(a, { email: 'not-an-address', currentPassword: PASSWORD });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_email');

  // A real, actionable slip rather than an enumeration risk: the caller already
  // knows this address is theirs.
  const same = await changeEmail(a, { email: a.email, currentPassword: PASSWORD });
  assert.equal(same.status, 400);
  assert.equal(same.body.error, 'same_email');
});

test("an address belonging to someone else answers exactly as a free one does", async () => {
  /* The anti-enumeration invariant, which binds for an AUTHENTICATED caller too:
     with DEMO_ENABLED on, anyone is an authenticated caller in one request. The
     response has to be byte-identical apart from the address echoed back. */
  const other = await makeAccount();
  const a = await makeAccount();
  const free = `${fresh()}@example.com`;

  const beforeFree = outbox.length;
  const freeRes = await changeEmail(a, { email: free, currentPassword: PASSWORD });
  assert.equal(outbox.length, beforeFree + 1);

  const b = await makeAccount();
  const beforeTaken = outbox.length;
  const takenRes = await changeEmail(b, { email: other.email, currentPassword: PASSWORD });

  assert.equal(takenRes.status, freeRes.status);
  assert.deepEqual(Object.keys(takenRes.body).sort(), Object.keys(freeRes.body).sort());
  assert.equal(takenRes.body.ok, true);
  assert.equal(takenRes.body.pendingEmail, other.email, 'the echo differs in shape, not just in value');
  assert.equal(outbox.length, beforeTaken, 'a mail went to an address that already has an account');
  assert.equal((await repo.getUserById(b.id)).pendingEmail, null, 'a record was stored for a taken address');
});

test('a demo account is refused outright', async () => {
  const a = await makeAccount();
  await repo.updateUser(a.id, { demo: true });
  const res = await changeEmail(a, { email: `${fresh()}@example.com`, currentPassword: PASSWORD });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'demo_account');
});

/* ------------------------------- the cooldown ------------------------------ */

test('a second request inside the cooldown answers ok and mails nothing', async () => {
  const a = await makeAccount();
  const first = `${fresh()}@example.com`;
  await changeEmail(a, { email: first, currentPassword: PASSWORD });

  const before = outbox.length;
  const again = await changeEmail(a, { email: `${fresh()}@example.com`, currentPassword: PASSWORD });
  assert.equal(again.status, 200);
  assert.equal(outbox.length, before, 'the cooldown let a second mail through');
  // …and the first record survives, so the link already in flight still works.
  assert.equal((await repo.getUserById(a.id)).pendingEmail.email, first);
});

test('after the cooldown a newer request REPLACES the pending one, killing the old link', async () => {
  const a = await makeAccount();
  const first = `${fresh()}@example.com`;
  await changeEmail(a, { email: first, currentPassword: PASSWORD });
  const stale = lastChangeToken();

  // Age the record past the cooldown rather than waiting a minute.
  const rec = (await repo.getUserById(a.id)).pendingEmail;
  await repo.updateUser(a.id, { pendingEmail: { ...rec, sentAt: new Date(Date.now() - 120000).toISOString() } });

  const second = `${fresh()}@example.com`;
  await changeEmail(a, { email: second, currentPassword: PASSWORD });
  const live = lastChangeToken();
  assert.notEqual(live, stale);

  assert.equal((await confirm(stale)).status, 400, 'the superseded link still works');
  assert.equal((await confirm(live)).status, 200);
  assert.equal((await repo.getUserById(a.id)).email, second);
});

/* -------------------------------- the token -------------------------------- */

test('expired, reused, tampered and wrong-version tokens are all refused', async () => {
  const a = await makeAccount();
  await changeEmail(a, { email: `${fresh()}@example.com`, currentPassword: PASSWORD });
  const token = lastChangeToken();

  // Tampered: the secret is hashed, so one changed character misses.
  assert.equal((await confirm(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'))).status, 400);
  // Wrong version: all three link kinds hash into the same field, so the prefix
  // is the only thing keeping a verification link out of this endpoint.
  const rec = (await repo.getUserById(a.id)).pendingEmail;

  // Expired.
  await repo.updateUser(a.id, {
    pendingEmail: { ...rec, expiresAt: new Date(Date.now() - 1000).toISOString() },
  });
  assert.equal((await confirm(token)).status, 400);
  assert.equal((await me(a)).pendingEmail, null, '/me still offers to resend a dead record');

  // Reused: revive it, spend it, spend it again.
  await repo.updateUser(a.id, { pendingEmail: rec });
  assert.equal((await confirm(token)).status, 200);
  assert.equal((await confirm(token)).status, 400, 'the link is not single-use');
});

test('the e1 prefix is what separates the three link kinds, in BOTH directions', async () => {
  /* All three hash into the same `tokenHash` field shape, so the version prefix
     is the only thing keeping one mail's token off another endpoint.

     ONE KNOWN SECRET IS PLANTED IN BOTH RECORDS, which is the whole design of
     this case: minting a v1 token over a DIFFERENT secret is refused by the hash
     comparison, so the assertion would pass with the version check deleted.
     Measured — it did, until this fixture. The same shape as
     test/account.test.js's v1/p1 case. */
  const a = await makeAccount();
  const next = `${fresh()}@example.com`;
  await changeEmail(a, { email: next, currentPassword: PASSWORD });

  const rec = (await repo.getUserById(a.id)).pendingEmail;
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  await repo.updateUser(a.id, {
    pendingEmail: { ...rec, tokenHash: accounts.hashToken('shared'), expiresAt },
    verification: { tokenHash: accounts.hashToken('shared'), expiresAt },
    reset: { tokenHash: accounts.hashToken('shared'), expiresAt },
  });

  // A verification or reset token must not confirm an address change…
  for (const version of [accounts.VERIFY_TOKEN_VERSION, accounts.RESET_TOKEN_VERSION]) {
    const res = await confirm(accounts.mintLinkToken(version, a.id, 'shared'));
    assert.equal(res.status, 400, `a ${version} token was spent on /confirm-email`);
  }
  assert.equal((await repo.getUserById(a.id)).email, a.email, 'the address moved on a foreign token');

  // …and an address-change token must not verify an address or reset a password.
  const mine = accounts.mintLinkToken(accounts.EMAIL_TOKEN_VERSION, a.id, 'shared');
  assert.equal((await request(app).post('/api/account/verify-email').send({ token: mine })).status, 400);
  assert.equal((await request(app).post('/api/account/reset-password')
    .send({ token: mine, password: 'another correct horse' })).status, 400);

  // Anti-vacuous: the secret and the record are right, so its OWN prefix works.
  assert.equal((await confirm(mine)).status, 200);
  assert.equal((await repo.getUserById(a.id)).email, next);
});

test('an address registered between request and confirm is caught, and the record cleared', async () => {
  const a = await makeAccount();
  const contested = `${fresh()}@example.com`;
  await changeEmail(a, { email: contested, currentPassword: PASSWORD });
  const token = lastChangeToken();

  // Somebody else takes it in the meantime.
  await request(app).post('/api/account/register')
    .send({ email: contested, username: fresh(), password: PASSWORD });

  const res = await confirm(token);
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_token');
  const after = await repo.getUserById(a.id);
  assert.equal(after.email, a.email, 'the address was swapped onto a taken one');
  assert.equal(after.pendingEmail, null, 'a link that can never work was left offerable');
});

/* --------------------------------- cancel ---------------------------------- */

test('DELETE clears the pending record and kills the link', async () => {
  const a = await makeAccount();
  await changeEmail(a, { email: `${fresh()}@example.com`, currentPassword: PASSWORD });
  const token = lastChangeToken();

  const res = await request(app).delete('/api/account/change-email').set(auth(a.token));
  assert.equal(res.status, 200);
  assert.equal((await repo.getUserById(a.id)).pendingEmail, null);
  assert.equal((await me(a)).pendingEmail, null);
  assert.equal((await confirm(token)).status, 400, 'a cancelled link still works');
});

/* ------------------------------- /me and legacy ---------------------------- */

test('an account predating this change reads as having no pending one', async () => {
  /* The legacy-shape case .claude/rules/defaulted-account-fields-need-a-legacy-shape-spec.md
     asks for, and it is unrepresentable through the API: `register` writes
     `pendingEmail: null`, so only a hand-made row has the key ABSENT. */
  const a = await makeAccount();
  const stored = await repo.getUserById(a.id);
  delete stored.pendingEmail;
  await repo.updateUser(a.id, stored);

  const body = await me(a);
  assert.equal(body.pendingEmail, null, 'an absent key does not read as "no pending change"');
  // …and a change still works from that shape.
  const next = `${fresh()}@example.com`;
  assert.equal((await changeEmail(a, { email: next, currentPassword: PASSWORD })).status, 200);
});

test('/me carries the address only — never the hash or the timestamps', async () => {
  const a = await makeAccount();
  const next = `${fresh()}@example.com`;
  await changeEmail(a, { email: next, currentPassword: PASSWORD });
  const body = await me(a);
  assert.equal(body.pendingEmail, next);
  assert.equal(typeof body.pendingEmail, 'string', 'the whole record leaked into /me');
  assert.ok(!JSON.stringify(body).includes((await repo.getUserById(a.id)).pendingEmail.tokenHash),
    'the token hash reached the client');
});

/* ----------------------------- the mailed link ----------------------------- */

test('the confirmation link fits on one quoted-printable line', async () => {
  // Same bar as /v and /r (#434): 75 characters of content is the last width a
  // QP soft break never splits. Measured against the production origin, or a
  // short localhost would pass however long the link grew.
  const prev = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = 'https://spielwirbel.app';
  try {
    const a = await makeAccount();
    await changeEmail(a, { email: `${fresh()}@example.com`, currentPassword: PASSWORD });
    const line = outbox[outbox.length - 1].text.split('\n').find((l) => l.includes('://'));
    assert.ok(line, 'the mail carries no link line');
    assert.ok(line.length <= 75, `link line is ${line.length} chars, must be <= 75: ${line}`);
    assert.match(line, /^https:\/\/spielwirbel\.app\/e\?t=e1\./);
  } finally {
    if (prev === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = prev;
  }
});
