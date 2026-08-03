'use strict';

/*
 * E-mail for actionable inbox items (issue #618), over HTTP.
 *
 * What is pinned here:
 *  - both producers (round invitation #207, friend request #325) mail their
 *    recipient exactly once, with a link into the inbox;
 *  - the per-recipient throttle suppresses a second item within the hour, and the
 *    first item past the window COALESCES — naming the running unread total, so a
 *    suppressed item is delayed rather than lost;
 *  - the two per-type opt-outs are independent, and a type outside the allowlist
 *    mails nobody;
 *  - the budget reserve: a notification is refused while a CRITICAL send still
 *    succeeds. That is the discriminating assertion of the whole issue — an
 *    ordinary "it stops at the ceiling" test passes just as well against code
 *    with no reserve at all;
 *  - two recipients that must never be mailed at all (a guest demo's unroutable
 *    address, an unverified account);
 *  - a failing send never fails the request that triggered it.
 *
 * Accounts must be ON, so this drives real accounts (register → verify → login),
 * mirroring test/friends.test.js and test/invitations.test.js.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const mail = require('../lib/mail');
const notify = require('../lib/notify');

const { outbox } = mail;
const PASSWORD = 'correct horse battery';
const handle = (email) => email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');
const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function makeAccount(email, { verify = true } = {}) {
  await request(app).post('/api/account/register').send({ email, username: handle(email), password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  if (!verify) return { user: await repo.getUserByEmail(email), username: handle(email) };
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email), username: handle(email) };
}

// Every producer call is fire-and-forget, so a test that read the outbox straight
// after the response would race the send. idle() is the module's own answer to
// that — see lib/notify.js on why the routes must not await.
const sendFriendRequest = async (from, username) => {
  const res = await request(app).post('/api/account/friends').set(auth(from.token)).send({ username });
  await notify.idle();
  return res;
};
const makeRound = (a, name) =>
  request(app).post('/api/rounds').set(auth(a.token)).send({ name, members: ['Gast'] }).then((r) => r.body);
const sendInvitation = async (from, roundId, username) => {
  const res = await request(app).post('/api/account/invitations').set(auth(from.token)).send({ roundId, username });
  await notify.idle();
  return res;
};

// Mail addressed to one recipient, newest last. The outbox also carries every
// verification mail this file sends, so nothing here may assert on its length.
const mailsTo = (who) => outbox.filter((m) => m.to === who.user.email);
// "Long ago", so the next item is not suppressed by a previous test's send.
const rewindThrottle = (who) => repo.updateUser(who.user.id, { notifiedAt: '2020-01-01T00:00:00.000Z' });

/* -------------------------- the two producers mail -------------------------- */

test('a round invitation mails the invitee once, linking to the inbox (#618)', async () => {
  const owner = await makeAccount('nt-owner@example.com');
  const invitee = await makeAccount('nt-invitee@example.com');
  const round = await makeRound(owner, 'Freitagsrunde');

  const before = mailsTo(invitee).length;
  const res = await sendInvitation(owner, round.id, invitee.username);
  assert.equal(res.status, 201);

  const mails = mailsTo(invitee);
  assert.equal(mails.length, before + 1, 'exactly one message');
  const last = mails[mails.length - 1];
  assert.match(last.subject, /Einladung/);
  assert.match(last.text, /\/inbox$/m, 'deep-links into the inbox');
  assert.match(last.text, new RegExp(owner.username), 'names who invited them');
  // The round NAME is deliberately absent: it is free text, and mail sent from
  // our own domain must not carry a stranger's prose (lib/notify.js).
  assert.doesNotMatch(last.text, /Freitagsrunde/, 'the free-text round name stays out of the body');
});

test('a friend request mails the addressee once (#618)', async () => {
  const alice = await makeAccount('nt-alice@example.com');
  const bob = await makeAccount('nt-bob@example.com');

  const before = mailsTo(bob).length;
  assert.equal((await sendFriendRequest(alice, bob.username)).status, 201);

  const mails = mailsTo(bob);
  assert.equal(mails.length, before + 1);
  assert.match(mails[mails.length - 1].subject, /Freundschaftsanfrage/);
  assert.match(mails[mails.length - 1].text, new RegExp(alice.username));
});

// RFC 2045 allows 76 characters including the trailing soft-break `=`, so 75 of
// content is the last width that is never broken. The body is German, which forces
// quoted-printable, and a link split across a soft break stops being clickable in
// clients whose auto-linkifier does not run across one — the #434 defect.
//
// The suite otherwise runs with no APP_BASE_URL, i.e. against a localhost origin
// 21 characters shorter than production, under which this assertion would pass no
// matter how long the links grew
// (.claude/rules/mailed-links-must-fit-one-qp-line.md).
const QP_SAFE_LINE = 75;
async function withProdBaseUrl(fn) {
  const prev = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = 'https://spielwirbel.app';
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = prev;
  }
}

test('every line of a notification mail fits on one quoted-printable line (#618)', async () => {
  const alice = await makeAccount('nt-qp-a@example.com');
  const bob = await makeAccount('nt-qp-b@example.com');

  await withProdBaseUrl(() => sendFriendRequest(alice, bob.username));

  const last = mailsTo(bob)[mailsTo(bob).length - 1];
  const long = last.text.split('\n').filter((l) => l.length > QP_SAFE_LINE);
  assert.deepEqual(long, [], `these lines would be soft-broken: ${JSON.stringify(long)}`);
  // Both links are absolute against the real origin — a relative one would not be
  // followable from a mail client at all.
  assert.ok(last.text.includes('https://spielwirbel.app/inbox'));
  assert.ok(last.text.includes('https://spielwirbel.app/konto'));
});

/* ------------------------ throttle, then coalescing ------------------------- */

test('a second item within the hour is suppressed, and the next one names the total (#618)', async () => {
  const a = await makeAccount('nt-thr-a@example.com');
  const b = await makeAccount('nt-thr-b@example.com');
  const target = await makeAccount('nt-thr-t@example.com');

  await sendFriendRequest(a, target.username);
  const afterFirst = mailsTo(target).length;

  // A second, from a different sender, inside the window: the item lands in the
  // inbox but must NOT produce mail — the throttle is keyed to the RECIPIENT, so
  // a second sender cannot reset it.
  assert.equal((await sendFriendRequest(b, target.username)).status, 201);
  assert.equal(mailsTo(target).length, afterFirst, 'no second mail inside the window');
  assert.equal((await request(app).get('/api/account/inbox').set(auth(target.token))).body.items.length, 2,
    'the suppressed item is still delivered in-app');

  // Past the window, the next item names the running total rather than only
  // itself — which is what makes a suppressed item delayed, never lost.
  await rewindThrottle(target);
  const owner = await makeAccount('nt-thr-o@example.com');
  const round = await makeRound(owner, 'Runde');
  await sendInvitation(owner, round.id, target.username);

  const mails = mailsTo(target);
  assert.equal(mails.length, afterFirst + 1, 'exactly one mail past the window');
  const last = mails[mails.length - 1];
  assert.match(last.subject, /Anfragen \/ New requests/, 'the coalesced subject');
  assert.match(last.text, /3 offene Anfragen/, 'names the running unread total, not just this item');
});

/* ------------------------------ the opt-outs -------------------------------- */

test('the two per-type opt-outs are independent (#618)', async () => {
  const sender = await makeAccount('nt-pref-s@example.com');
  const target = await makeAccount('nt-pref-t@example.com');

  // Friend-request mail off, invitations left on.
  const patched = await request(app).patch('/api/account/me').set(auth(target.token))
    .send({ notifyFriendRequests: false });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.notifyFriendRequests, false);
  assert.equal(patched.body.notifyRoundInvitations, true, 'the other flag is untouched');

  const before = mailsTo(target).length;
  await sendFriendRequest(sender, target.username);
  assert.equal(mailsTo(target).length, before, 'the disabled type mails nothing');

  // …and the type that is still on must still mail, which is what makes this an
  // assertion about TWO independent flags rather than about one global switch.
  await rewindThrottle(target);
  const round = await makeRound(sender, 'Runde');
  await sendInvitation(sender, round.id, target.username);
  assert.equal(mailsTo(target).length, before + 1, 'the enabled type still mails');
});

test('an inbox type outside the allowlist mails nobody (#618)', async () => {
  const who = await makeAccount('nt-allow@example.com');
  await rewindThrottle(who);
  const before = mailsTo(who).length;

  const item = await repo.addInboxItem(who.user.id, { type: 'some_future_type', payload: {} });
  await notify.notifyInboxItem(who.user.id, item);
  assert.equal(mailsTo(who).length, before, 'a generic store must not inherit the mail path');

  // The guard is the allowlist itself, not the absence of a producer.
  assert.deepEqual(Object.keys(notify.NOTIFIABLE).sort(), ['friend_request', 'round_invitation']);
});

/* ---------------- recipients that must never be mailed at all --------------- */

test('a guest demo and an unverified account are never mailed (#618)', async () => {
  // A demo's stored address is a synthetic `…@demo.invalid` placeholder, so every
  // send is a guaranteed bounce. Classified by the tenant prefix, the one tested
  // definition (.claude/rules/guest-demo-accounts.md §1).
  const demo = await makeAccount('nt-demo@example.com');
  await repo.updateUser(demo.user.id, { tenantId: `demo-${'a'.repeat(16)}`, notifiedAt: null });
  const demoBefore = mailsTo(demo).length;
  const demoItem = await repo.addInboxItem(demo.user.id, {
    type: 'friend_request', payload: { requesterUsername: 'someone' },
  });
  await notify.notifyInboxItem(demo.user.id, demoItem);
  assert.equal(mailsTo(demo).length, demoBefore, 'a demo account is never mailed');

  // An unverified address is not a confirmed channel, and such an account cannot
  // even log in — so mailing it repeatedly is pure amplifier.
  const pending = await makeAccount('nt-unverified@example.com', { verify: false });
  const pendingBefore = mailsTo(pending).length;
  const item = await repo.addInboxItem(pending.user.id, {
    type: 'friend_request', payload: { requesterUsername: 'someone' },
  });
  await notify.notifyInboxItem(pending.user.id, item);
  assert.equal(mailsTo(pending).length, pendingBefore, 'an unverified account is never mailed');
});

/* ------------------------------ the reserve --------------------------------- */

// THE discriminating assertion (.claude/rules/break-the-code-on-purpose.md): it
// must fail against a bookSend() that ignores its `kind`. A test that merely
// checks "notifications stop when the budget is spent" passes with no reserve at
// all, because the plain ceiling stops them too.
//
// test/helpers.js raises MAIL_DAILY_MAX out of reach for the ordinary suite, so
// this sets its own — sized RELATIVE to what this process has already sent, since
// the counter is per-process with no reset hook
// (.claude/rules/bounding-bulk-registration-mail.md).
test('the reserve refuses a notification while a critical send still succeeds (#618)', async () => {
  const who = await makeAccount('nt-budget@example.com');
  await rewindThrottle(who);

  // Exactly one send left in the day. The reserve is ceil(limit * 0.25) >= 1, so
  // that last send is critical-only.
  process.env.MAIL_DAILY_MAX = String(mail.budgetState().sent + 1);
  try {
    await assert.rejects(
      () => mail.send({ to: 'x@example.com', subject: 'S', text: 'T', kind: 'notification' }),
      /mail_notification_budget_reserved/,
      'a notification may not touch the reserved tail',
    );
    // The same budget state, one line later, still delivers a verification mail —
    // which is the entire point of splitting the classes.
    assert.deepEqual(
      await mail.send({ to: 'x@example.com', subject: 'S', text: 'T' }),
      { delivered: false },
      'a critical send may spend the whole ceiling',
    );

    // …and end to end: an inbox item under a reserved budget produces no mail and
    // does NOT stamp the throttle, so the recipient is not silenced for an hour
    // over a message they never received.
    process.env.MAIL_DAILY_MAX = String(mail.budgetState().sent + 1);
    const before = mailsTo(who).length;
    const item = await repo.addInboxItem(who.user.id, {
      type: 'friend_request', payload: { requesterUsername: 'someone' },
    });
    await notify.notifyInboxItem(who.user.id, item);
    assert.equal(mailsTo(who).length, before, 'refused, not delivered');
    assert.equal((await repo.getUserById(who.user.id)).notifiedAt, '2020-01-01T00:00:00.000Z',
      'a refused send must not start the throttle window');
  } finally {
    delete process.env.MAIL_DAILY_MAX;
  }
});

/* ------------------------------- /me + PATCH -------------------------------- */

test('/me reports both flags as booleans, including for an account predating #618', async () => {
  const who = await makeAccount('nt-me@example.com');

  // Strip the keys the way an account created before this change has them.
  await repo.updateUser(who.user.id, { notifyRoundInvitations: undefined, notifyFriendRequests: undefined });
  const legacy = await repo.getUserById(who.user.id);
  assert.ok(legacy.notifyRoundInvitations === undefined || legacy.notifyRoundInvitations === null,
    'the fixture really is missing the key');

  const me = await request(app).get('/api/account/me').set(auth(who.token));
  assert.equal(me.body.notifyRoundInvitations, true, 'absent reads as ON');
  assert.equal(me.body.notifyFriendRequests, true);
  assert.equal(typeof me.body.notifyFriendRequests, 'boolean', 'never undefined, never a string');
});

test('PATCH /me sets each flag and refuses a non-boolean (#618)', async () => {
  const who = await makeAccount('nt-patch@example.com');
  const patch = (body) => request(app).patch('/api/account/me').set(auth(who.token)).send(body);

  assert.equal((await patch({ notifyRoundInvitations: false })).body.notifyRoundInvitations, false);
  assert.equal((await patch({ notifyFriendRequests: false })).body.notifyFriendRequests, false);
  assert.equal((await patch({ notifyRoundInvitations: true })).body.notifyRoundInvitations, true);

  // 'false' would be STORED and then read back as `!== false`, i.e. ON — a toggle
  // the user switched off that keeps mailing them. Refusing is the honest answer.
  for (const bad of ['false', 0, null, 'yes']) {
    const res = await patch({ notifyFriendRequests: bad });
    assert.equal(res.status, 400, `${JSON.stringify(bad)} must be refused`);
    assert.equal(res.body.error, 'invalid_notify_pref');
  }
  assert.equal((await request(app).get('/api/account/me').set(auth(who.token))).body.notifyFriendRequests, false,
    'a refused patch changed nothing');
});

/* ------------------------- the send never fails the flow -------------------- */

test('a failing send never fails the request that triggered it (#618)', async () => {
  const alice = await makeAccount('nt-fail-a@example.com');
  const bob = await makeAccount('nt-fail-b@example.com');

  const real = mail.send;
  mail.send = async () => { throw new Error('smtp down'); };
  try {
    const res = await sendFriendRequest(alice, bob.username);
    assert.equal(res.status, 201, 'the friend request still succeeds');
    assert.ok(res.body.friendship, 'and is really stored');
  } finally {
    mail.send = real;
  }

  // The failure must not stamp the throttle either — otherwise one SMTP hiccup
  // silences the recipient for an hour.
  assert.equal((await repo.getUserById(bob.user.id)).notifiedAt, null);
});
