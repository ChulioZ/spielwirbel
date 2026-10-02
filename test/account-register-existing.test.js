'use strict';

/* Registering with an address that already has an account (#1516).
 *
 * The response must stay exactly what a fresh signup gets — the endpoint may not
 * become an account-existence probe — but the INBOX now hears about it: a
 * verified account is told it exists and gets a reset link, an unverified one
 * gets a fresh verification mail. Only the owner of the address learns anything,
 * which is the same information the operator otherwise hands out by hand.
 *
 * Its own file rather than more of test/account.test.js, which is over budget
 * (.claude/rules/test-file-names-collide-silently.md — the name was checked).
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const mail = require('../lib/mail');

const { outbox } = mail;
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a different horse battery';
let seq = 0;
const handle = () => `rex${(seq += 1)}`;

const register = (email) =>
  request(app).post('/api/account/register').send({ email, username: handle(), password: PASSWORD });

const RESET_RE = /\/r\?t=(p1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/;
const VERIFY_RE = /\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/;

const mailsTo = (email, from) => outbox.slice(from).filter((m) => m.to === email);

// Backdates the cooldown, so a branch that is NOT about throttling is not
// silently measured as a throttled one.
async function cool(email, key) {
  const user = await repo.getUserByEmail(email);
  await repo.updateUser(user.id, { [key]: { ...user[key], sentAt: new Date(0).toISOString() } });
}

async function verifiedAccount() {
  const email = `${handle()}@example.com`;
  await register(email);
  const m = outbox[outbox.length - 1].text.match(VERIFY_RE);
  assert.ok(m, 'registration mailed no verification link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  assert.equal((await repo.getUserByEmail(email)).emailVerified, true);
  return email;
}

/* ------------------------- verified password account ----------------------- */

test('a verified account is told it exists, with a reset link that works', async () => {
  const email = await verifiedAccount();

  // Against the real origin, so the one-QP-line check below measures the length
  // production mails (#434) rather than a short localhost.
  const prev = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = 'https://spielwirbel.app';
  const before = outbox.length;
  let res;
  try { res = await register(email); } finally {
    if (prev === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = prev;
  }
  assert.deepEqual([res.status, res.body], [200, { ok: true }]);

  const sent = mailsTo(email, before);
  assert.equal(sent.length, 1, 'the existing account was not mailed exactly once');
  for (const line of sent[0].text.split('\n').filter((l) => l.startsWith('https://'))) {
    assert.ok(line.length <= 75, `link line is ${line.length} chars, must fit one QP line: ${line}`);
  }
  assert.match(sent[0].text, /bereits ein Spielwirbel-Konto/);
  assert.match(sent[0].text, /already have a Spielwirbel account/);
  assert.match(sent[0].text, /\/login\n/, 'the notice carries no sign-in link');
  const m = sent[0].text.match(RESET_RE);
  assert.ok(m, 'the notice carries no reset link');

  const reset = await request(app).post('/api/account/reset-password')
    .send({ token: m[1], password: NEW_PASSWORD });
  assert.equal(reset.status, 200);
  const login = await request(app).post('/api/account/login').send({ email, password: NEW_PASSWORD });
  assert.equal(login.status, 200, 'the new password does not sign in');
});

test('a second attempt inside the cooldown mails nothing and keeps the first link valid', async () => {
  const email = await verifiedAccount();
  const before = outbox.length;
  await register(email);
  await register(email);

  const sent = mailsTo(email, before);
  assert.equal(sent.length, 1, 'the cooldown did not hold');
  const token = sent[0].text.match(RESET_RE)[1];
  const reset = await request(app).post('/api/account/reset-password')
    .send({ token, password: NEW_PASSWORD });
  assert.equal(reset.status, 200, 'the throttled attempt invalidated the link already mailed');
});

test('the notice and forgot-password share one cooldown', async () => {
  const email = await verifiedAccount();
  const before = outbox.length;
  await request(app).post('/api/account/forgot-password').send({ email });
  await register(email);
  assert.equal(mailsTo(email, before).length, 1, 'register mailed straight after a reset mail');
});

/* ---------------------------- unverified account --------------------------- */

test('an unverified account gets a fresh verification mail and the old link dies', async () => {
  const email = `${handle()}@example.com`;
  await register(email);
  const oldToken = outbox[outbox.length - 1].text.match(VERIFY_RE)[1];
  await cool(email, 'verification');

  const before = outbox.length;
  const res = await register(email);
  assert.deepEqual([res.status, res.body], [200, { ok: true }]);
  const sent = mailsTo(email, before);
  assert.equal(sent.length, 1, 'no fresh verification mail');
  const m = sent[0].text.match(VERIFY_RE);
  assert.ok(m, 'the mail carries no verification link');
  assert.doesNotMatch(sent[0].text, RESET_RE, 'an unverified account was sent a reset link');

  const stale = await request(app).post('/api/account/verify-email').send({ token: oldToken });
  assert.equal(stale.status, 400, 'the older link still verifies');
  const fresh = await request(app).post('/api/account/verify-email').send({ token: m[1] });
  assert.equal(fresh.status, 200);

  // …and straight after, the cooldown applies (a new unverified account).
  const other = `${handle()}@example.com`;
  await register(other);
  const mid = outbox.length;
  await register(other);
  assert.equal(mailsTo(other, mid).length, 0, 'the verification cooldown did not hold');
});

/* -------------------- an account with no password identity ----------------- */

async function passkeyOnly(extra = {}) {
  const fields = {
    email: `${handle()}@example.com`, username: handle(), createdAt: new Date().toISOString(),
    tenantId: 'f'.repeat(16), emailVerified: true, identities: [],
    verification: null, reset: null, refreshTokens: [], ...extra,
  };
  await repo.createUser(fields);
  return fields.email;
}

test('a passkey-only account gets the notice without a reset link, and nothing redeemable is stored', async () => {
  const email = await passkeyOnly();
  const before = outbox.length;
  const res = await register(email);
  assert.deepEqual([res.status, res.body], [200, { ok: true }]);

  const sent = mailsTo(email, before);
  assert.equal(sent.length, 1, 'the passkey-only account was not mailed');
  assert.match(sent[0].text, /Passkey/);
  assert.doesNotMatch(sent[0].text, RESET_RE, 'a passkey-only account was sent a reset link');

  // The throttle marker rides on `reset`, but it is born expired and carries no
  // hash — so reset-password can never turn it into a password identity.
  const { reset } = await repo.getUserByEmail(email);
  assert.equal(reset.tokenHash, null);
  assert.ok(Date.parse(reset.expiresAt) <= Date.now(), 'the marker is redeemable');

  await register(email);
  assert.equal(mailsTo(email, before).length, 1, 'the passkey-only notice is not throttled');
});

test('a demo account is never mailed', async () => {
  // Synthetic .invalid address: a send could only fail and spend budget.
  const email = await passkeyOnly({ demo: true, email: `demo-${handle()}@demo.invalid` });
  const before = outbox.length;
  const res = await register(email);
  assert.deepEqual([res.status, res.body], [200, { ok: true }]);
  assert.equal(mailsTo(email, before).length, 0, 'a demo address was mailed');
});

/* ----------------- every branch answers byte-for-byte the same ------------- */

test('new, verified, unverified, throttled and budget-refused all answer identically', async () => {
  const verified = await verifiedAccount();
  const unverified = `${handle()}@example.com`;
  await register(unverified);
  await cool(unverified, 'verification');

  const answers = {};
  const take = (name, r) => { answers[name] = { status: r.status, body: r.body }; };

  take('new', await register(`${handle()}@example.com`));
  take('verified', await register(verified));
  take('throttled', await register(verified));
  take('unverified', await register(unverified));

  const saved = process.env.MAIL_DAILY_MAX;
  process.env.MAIL_DAILY_MAX = String(mail.budgetState().sent);
  try {
    const other = await verifiedAccountUnderBudget();
    take('budget', await register(other));
  } finally {
    if (saved === undefined) delete process.env.MAIL_DAILY_MAX; else process.env.MAIL_DAILY_MAX = saved;
  }

  for (const [name, a] of Object.entries(answers)) {
    assert.deepEqual(a, answers.new, `the ${name} branch answers differently`);
  }
});

// A verified account created directly, so building it spends no mail budget.
async function verifiedAccountUnderBudget() {
  return passkeyOnly({ identities: [{ type: 'password', hash: 'x' }] });
}
