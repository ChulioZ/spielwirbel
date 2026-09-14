'use strict';

/* The moderation log's 3-year retention purge (#311).
 *
 * The repo half — what gets deleted and what is exempt — is in the shared
 * contract suite, so it is proven against BOTH backends. This file covers the
 * parts that live above it: the cutoff arithmetic that encodes #140's promise,
 * and the audit record.
 *
 * The cutoff is the piece worth the most care. It is not "three years ago": it
 * is January 1 (UTC) of the current year minus three, so a run at ANY point
 * during 2030 purges everything dated before 2027-01-01. Getting it wrong in the
 * lenient direction keeps personal data past what the published policy promises;
 * getting it wrong in the strict direction destroys records early. Neither
 * failure is visible from anywhere else.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = process.env.DATA_DIR
  || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'retention-'));

const retention = require('../lib/retention');
const repo = require('../lib/repo');

const at = (iso) => new Date(iso).getTime();

/* --------------------------------- cutoff --------------------------------- */

test('the cutoff is Jan 1 UTC of the current year minus three', () => {
  assert.equal(retention.moderationLogCutoff(at('2030-06-15T12:00:00Z')), '2027-01-01T00:00:00.000Z');
  assert.equal(retention.moderationLogCutoff(at('2030-01-01T00:00:00Z')), '2027-01-01T00:00:00.000Z');
  assert.equal(retention.moderationLogCutoff(at('2030-12-31T23:59:59Z')), '2027-01-01T00:00:00.000Z');
});

test('the cutoff moves only at the turn of the year, never mid-year', () => {
  /* The year-end scheme is the whole of #140's decision (§§ 195, 199 BGB): an
     entry does not expire on its own third birthday, it expires when the third
     year after its year ends. A rolling `now - 3 years` would delete December
     entries eleven months early, every year, silently. */
  const dec = retention.moderationLogCutoff(at('2030-12-31T23:59:59Z'));
  const jan = retention.moderationLogCutoff(at('2031-01-01T00:00:00Z'));
  assert.equal(dec, '2027-01-01T00:00:00.000Z');
  assert.equal(jan, '2028-01-01T00:00:00.000Z');
  assert.notEqual(dec, jan, 'the cutoff must advance exactly once, at New Year');
});

test('nothing written today can be deletable yet', () => {
  /* The reason this job does nothing until 2030, asserted rather than asserted
     in prose: the app went live in 2026, so the earliest entry that can exist is
     dated 2026-xx and the cutoff does not reach 2027 until 2030. */
  const cutoff = retention.moderationLogCutoff(Date.now());
  assert.ok(cutoff < new Date().toISOString(), 'the cutoff is in the past');
  assert.ok(cutoff <= '2027-01-01T00:00:00.000Z',
    `the cutoff has reached ${cutoff} — if the year is now 2030+, this test's premise is spent`);
});

/* ------------------------------ the audit record --------------------------- */

test('a run that deletes nothing writes NO moderation-log entry', async () => {
  /* Deliberately narrower than the issue, which also wanted a record on the
     first run. Against the 15-minute scheduler this job joined, that would write
     one entry per deploy into the one log an operator reads by hand — for a job
     that deletes nothing until 2030. The pino `retention_purge_ran` line is the
     evidence instead. */
  await repo.init();
  const before = await repo.countModeration();
  const deleted = await retention.purgeModerationLog(at('2026-06-01T00:00:00Z'));
  assert.equal(deleted, 0, 'nothing is expired yet in 2026');
  assert.equal(await repo.countModeration(), before, 'and no record was written');
});

test('a run that deletes something records counts and dates, and no personal data', async () => {
  await repo.init();
  await repo.logModeration({
    action: 'takedown', target: '/uploads/x.jpg', reason: 'an old notice',
    at: '2026-05-05T00:00:00.000Z', email: 'someone@example.com',
  });

  const deleted = await retention.purgeModerationLog(at('2030-03-01T00:00:00Z'));
  assert.equal(deleted, 1);

  const log = await repo.listModeration(20);
  const rec = log.find((e) => e.action === 'retention_purge');
  assert.ok(rec, 'an effective run leaves an audit record');
  assert.equal(rec.target, 'moderation_log');
  assert.equal(rec.tenantId, null, 'the purge belongs to no tenant');
  assert.match(rec.reason, /^1 entries dated before 2027-01-01T00:00:00\.000Z deleted$/);

  /* It must itself be safely displayable AND safely purgeable by this same job,
     so it carries nothing but numbers and instants. Asserted over the whole
     serialized entry rather than field by field, so a future addition has to be
     considered rather than slipping in. */
  const text = JSON.stringify(rec);
  assert.ok(!/@/.test(text), `the audit record holds an address: ${text}`);
  assert.ok(!/uploads/.test(text), `the audit record names the purged target: ${text}`);
  assert.deepEqual(
    Object.keys(rec).sort(),
    ['action', 'at', 'id', 'reason', 'target', 'tenantId'],
    'the audit record grew a field — check it holds no personal data',
  );
});

test('the audit record is itself purgeable', async () => {
  /* The record is an ordinary entry with an ordinary action, so it expires on
     the same three-year clock. A record exempt from its own policy would grow
     without bound and would be the one thing this job could never clean up. */
  await repo.init();
  await repo.logModeration({
    action: 'retention_purge', target: 'moderation_log',
    reason: '3 entries dated before 2024-01-01T00:00:00.000Z deleted',
    at: '2026-01-01T00:00:00.000Z', tenantId: null,
  });
  const before = (await repo.listModeration(500)).filter((e) => e.action === 'retention_purge').length;
  assert.ok(before >= 1);
  await retention.purgeModerationLog(at('2030-03-01T00:00:00Z'));
  const after = (await repo.listModeration(500))
    .filter((e) => e.action === 'retention_purge' && e.at < '2027-01-01T00:00:00.000Z').length;
  assert.equal(after, 0, 'an expired retention_purge record must be purged like any other');
});

/* -------------------------------- the wiring ------------------------------- */

test('the purge is a scheduled job, and enabled unconditionally', () => {
  /* Wired into the existing scheduler rather than a boot-time timer in
     server.js, which is what the issue defaulted to before lib/scheduler.js
     existed. `enabled: () => true` matters: the promise in the published privacy
     policy has no feature flag, so the sweep that keeps it must not either. */
  const { JOBS } = require('../lib/scheduler');
  assert.ok(JOBS.purgeModerationLog, 'the purge is not a scheduled job');
  assert.equal(JOBS.purgeModerationLog.enabled(), true);
});
