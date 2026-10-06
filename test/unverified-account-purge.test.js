'use strict';

/*
 * A never-verified account is ERASED 7 days after sign-up (#1544; legal audit
 * 2026-10-04, L-014). Login refuses it and its verification link lives 24 h,
 * so after that the row only holds an address, a username and a password hash
 * with no function — and keeps both identifiers claimed.
 *
 * THE CLOCK IS STEPPED ACROSS THE BOUNDARY, never read inside a callback
 * (.claude/rules/mock-timers-jump-the-clock-before-firing.md): still there one
 * millisecond before the mark, gone at it. A single "tick eight days, assert
 * gone" passes against a sweep that erases far too early — the direction that
 * deletes an account whose owner is about to click the link.
 *
 * Only `Date` is mocked: the sweep reads the clock and arms no timer, and the
 * routes building the fixture need real timers underneath supertest.
 *
 * Named for what it covers; `ls test/unverified*` was empty
 * (.claude/rules/test-file-names-collide-silently.md).
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.DEMO_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const scheduler = require('../lib/scheduler');
const { UNVERIFIED_ACCOUNT_TTL_MS } = require('../lib/unverified-accounts');
const { outbox } = require('../lib/mail');

const PASSWORD = 'correct horse battery';
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

async function register(prefix = 'unverified') {
  seq += 1;
  const email = `${prefix}${seq}@example.com`;
  const username = `${prefix}${seq}`;
  const res = await request(app).post('/api/account/register').send({ email, username, password: PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const user = await repo.getUserByEmail(email);
  assert.ok(user && user.emailVerified === false, 'the fixture is not an unverified account');
  return user;
}

async function verify(user) {
  const mail = outbox.filter((m) => m.to === user.email).pop();
  const v = mail.text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(v, 'registration mailed no verification link');
  const res = await request(app).post('/api/account/verify-email').send({ token: v[1] });
  assert.equal(res.status, 200);
}

test('the sweep is a scheduled job, always on', () => {
  // A function nobody schedules is the failure this guards: every assertion
  // below would stay green while the rows lived forever in production.
  assert.ok(scheduler.JOBS.purgeUnverifiedAccounts, 'the sweep is not a scheduled job');
  assert.equal(scheduler.JOBS.purgeUnverifiedAccounts.enabled(), true);
  assert.equal(UNVERIFIED_ACCOUNT_TTL_MS, 7 * DAY, 'the operator decision is 7 days');
});

test('a never-verified account is erased at 7 days after sign-up, not one millisecond before', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-06T10:00:00.000Z') });
  const user = await register();

  t.mock.timers.tick(UNVERIFIED_ACCOUNT_TTL_MS - 1);
  await scheduler.runJob('purgeUnverifiedAccounts');
  assert.ok(await repo.getUserById(user.id), 'erased before its 7 days were up');

  t.mock.timers.tick(1);
  const erased = await scheduler.runJob('purgeUnverifiedAccounts');
  assert.ok(erased >= 1, 'the job reports a count');
  assert.equal(await repo.getUserById(user.id), null, 'still there at the 7-day mark');

  // Idempotent: a second sweep over the same instant has nothing of ours left.
  await scheduler.runJob('purgeUnverifiedAccounts');
  assert.equal(await repo.getUserById(user.id), null);
});

test('a RESEND does not extend the deadline — it runs from createdAt', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-06T10:00:00.000Z') });
  const user = await register('resend');
  t.mock.timers.tick(6 * DAY);
  await request(app).post('/api/account/resend-verification').send({ email: user.email });
  assert.notDeepEqual((await repo.getUserById(user.id)).verification, user.verification,
    'the fixture did not actually re-send');

  t.mock.timers.tick(DAY);
  await scheduler.runJob('purgeUnverifiedAccounts');
  assert.equal(await repo.getUserById(user.id), null, 'the resend bought extra time');
});

test('a verified account and a demo account of the same age both survive', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-06T10:00:00.000Z') });
  const verified = await register('verified');
  await verify(verified);
  const demo = await request(app).post('/api/account/demo');
  assert.equal(demo.status, 200, JSON.stringify(demo.body));
  const control = await register('control');

  t.mock.timers.tick(30 * DAY);
  await scheduler.runJob('purgeUnverifiedAccounts');
  assert.equal(await repo.getUserById(control.id), null, 'control: the sweep did not run at all');
  assert.ok(await repo.getUserById(verified.id), 'a verified account was erased');
  // The demo sweep owns demo accounts; this job must never touch one, whatever
  // its own verification flag says.
  assert.ok(await repo.getUserById(demo.body.user.id), 'a demo account was erased by the wrong sweep');
});

test('the username and address can be registered again afterwards', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-06T10:00:00.000Z') });
  const user = await register('again');
  t.mock.timers.tick(UNVERIFIED_ACCOUNT_TTL_MS);
  await scheduler.runJob('purgeUnverifiedAccounts');
  assert.equal(await repo.getUserById(user.id), null);

  const res = await request(app).post('/api/account/register')
    .send({ email: user.email, username: user.username, password: PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const fresh = await repo.getUserByEmail(user.email);
  assert.ok(fresh && fresh.id !== user.id, 'the address is still claimed by the erased row');
  assert.equal(fresh.username, user.username);
});
