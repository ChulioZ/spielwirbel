'use strict';

/*
 * The pending e-mail change is DELETED at its 24-hour mark (#1076; legal audit
 * 2026-10-04, L-014) — the privacy policy says the new address is kept
 * "längstens 24 Stunden", and until this sweep an expired record was only
 * ignored.
 *
 * THE CLOCK IS STEPPED ACROSS THE BOUNDARY, never read inside a callback:
 * `mock.timers` jumps to the end of a tick before running anything, so a
 * timestamp taken there agrees with every implementation
 * (.claude/rules/mock-timers-jump-the-clock-before-firing.md). The pair below —
 * still there one millisecond before, gone at the mark — is the whole
 * assertion; a single "tick a day and a bit, assert gone" passes against a
 * sweep that clears records far too early, which is the direction that would
 * break a link the person is about to click.
 *
 * Only `Date` is mocked: the sweep reads the clock and arms no timer, and the
 * routes building the fixture need real timers underneath supertest.
 *
 * Named for what it covers; `ls test/pending-email*` was empty
 * (.claude/rules/test-file-names-collide-silently.md).
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const accounts = require('../lib/accounts');
const scheduler = require('../lib/scheduler');
const { outbox } = require('../lib/mail');

const PASSWORD = 'correct horse battery';
let seq = 0;

// Register -> verify -> login -> request a change, all through the real routes,
// so the record under test has exactly the shape and expiry the route writes.
async function accountWithPendingChange() {
  seq += 1;
  const email = `pending${seq}@example.com`;
  await request(app).post('/api/account/register').send({ email, username: `pending${seq}`, password: PASSWORD });
  const v = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(v, 'registration mailed no verification link');
  await request(app).post('/api/account/verify-email').send({ token: v[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  const chg = await request(app).post('/api/account/change-email')
    .set('Authorization', `Bearer ${login.body.accessToken}`)
    .send({ email: `pending${seq}-new@example.com`, currentPassword: PASSWORD });
  assert.equal(chg.status, 200, JSON.stringify(chg.body));
  const user = await repo.getUserByEmail(email);
  assert.ok(user.pendingEmail && user.pendingEmail.email, 'the fixture holds no pending change');
  return user;
}

test('the sweep is a scheduled job, always on', () => {
  // A function nobody schedules is the failure this guards: every assertion
  // below would stay green while the record lived forever in production.
  assert.ok(scheduler.JOBS.purgeExpiredPendingEmails, 'the sweep is not a scheduled job');
  assert.equal(scheduler.JOBS.purgeExpiredPendingEmails.enabled(), true);
});

test('an unconfirmed address is deleted at its 24-hour mark, not one millisecond before', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T10:00:00.000Z') });
  const user = await accountWithPendingChange();
  const deadline = Date.parse(user.pendingEmail.expiresAt);
  // The record carries its own deadline, and it is the policy's 24 hours.
  assert.equal(deadline - Date.now(), accounts.VERIFY_TTL_MS);

  t.mock.timers.tick(accounts.VERIFY_TTL_MS - 1);
  assert.equal(await scheduler.runJob('purgeExpiredPendingEmails'), 0);
  assert.deepEqual((await repo.getUserById(user.id)).pendingEmail, user.pendingEmail,
    'cleared while the link still worked');

  t.mock.timers.tick(1);
  assert.equal(await scheduler.runJob('purgeExpiredPendingEmails'), 1);
  const after = await repo.getUserById(user.id);
  assert.equal(after.pendingEmail, null, 'the address outlived its 24 hours');
  // Nothing else on the account moves: the old address is still the account's.
  assert.equal(after.email, user.email);
  assert.equal(after.emailVerified, true);
});

test('the address is gone from the stored row, not merely from the account screen', async (t) => {
  // /me already hid an expired address before this sweep existed, so asserting
  // on /me would be green with no sweep at all. Only the stored row tells.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-05T10:00:00.000Z') });
  const user = await accountWithPendingChange();
  const address = user.pendingEmail.email;
  t.mock.timers.tick(accounts.VERIFY_TTL_MS + 60 * 60 * 1000);
  await scheduler.runJob('purgeExpiredPendingEmails');
  const raw = JSON.stringify(await repo.getUserById(user.id));
  assert.equal(raw.includes(address), false, 'the unconfirmed address is still stored');
});
