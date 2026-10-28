'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  AUDIT_ARGS, AUDIT_SUMMARY, auditFindings, auditAdvisoryBody, runAudit,
} = require('../scripts/npm-audit-watch');
const { main } = require('../scripts/node-security-watch');

// Captured 2026-10-28 with npm 10.9.4: `npm audit --omit=dev --json` against the
// lockfile as it stood just before #1740 — two real highs and one moderate (qs).
const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'npm-audit-pre-1740-2026-10-28.json'), 'utf8'));
const CLEAN = { auditReportVersion: 2, vulnerabilities: {}, metadata: {} };

test('the captured report yields its two high advisories, and not the moderate one', () => {
  assert.deepEqual(auditFindings(FIXTURE).map((f) => `${f.package} ${f.id} ${f.severity}`), [
    'body-parser GHSA-27r3-jxmh-p828 high',
    'multer GHSA-q7qp-rjg7-q26m high',
  ]);
});

test('a clean report has no findings', () => {
  assert.deepEqual(auditFindings(CLEAN), []);
});

test('a moderate-only report has no findings; a critical one does', () => {
  const only = (severity) => ({
    auditReportVersion: 2,
    vulnerabilities: { qs: { via: [{ ...FIXTURE.vulnerabilities.qs.via[0], severity }] } },
  });
  assert.deepEqual(auditFindings(only('moderate')), []);
  assert.deepEqual(auditFindings(only('low')), []);
  assert.deepEqual(auditFindings(only('critical')).map((f) => f.package), ['qs']);
});

test('a dependent listed only by name adds no second finding', () => {
  const report = structuredClone(FIXTURE);
  report.vulnerabilities.express = { name: 'express', severity: 'high', via: ['body-parser'] };
  assert.equal(auditFindings(report).length, 2);
});

test('an npm error or an unknown format fails rather than reading as clean', () => {
  assert.throws(() => auditFindings({ error: { code: 'ENOAUDIT', summary: 'x' } }), /reported an error/);
  assert.throws(() => auditFindings({ advisories: {} }), /unknown report format/);
});

test('the audit is run for production dependencies only', () => {
  // The report has no dev flag to filter on, so --omit=dev is the only dev filter.
  let call;
  const report = runAudit('/x', (cmd, args, opts) => {
    call = { cmd, args, cwd: opts.cwd };
    return { status: 1, stdout: JSON.stringify(CLEAN) };
  });
  assert.deepEqual(report, CLEAN);
  assert.deepEqual(call, { cmd: 'npm', args: ['audit', '--omit=dev', '--json'], cwd: '/x' });
  assert.deepEqual(AUDIT_ARGS, call.args);
});

test('npm failing to run or printing no JSON fails the check', () => {
  assert.throws(() => runAudit('/x', () => ({ error: new Error('ENOENT') })), /could not be run/);
  assert.throws(() => runAudit('/x', () => ({ status: 1, stdout: 'npm ERR! nope' })), /no JSON/);
});

test('the draft names every finding and has a title that does not vary with them', () => {
  const body = auditAdvisoryBody(auditFindings(FIXTURE));
  assert.equal(body.summary, AUDIT_SUMMARY);
  assert.equal(auditAdvisoryBody(auditFindings(FIXTURE).slice(1)).summary, body.summary);
  assert.match(body.description, /GHSA-27r3-jxmh-p828/);
  assert.match(body.description, /GHSA-q7qp-rjg7-q26m/);
  assert.deepEqual(body.vulnerabilities.map((v) => v.package), [
    { ecosystem: 'npm', name: 'body-parser' }, { ecosystem: 'npm', name: 'multer' },
  ]);
  assert.equal(body.severity, 'high');
});

// main() with both legs stubbed: nodejs.org reports nothing pending, so only
// the npm leg can require action.
async function runMain(t, { report, drafts = [], index = [] }) {
  const calls = [];
  const logged = [];
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    calls.push({ method: opts.method || 'GET', url, body: opts.body });
    if (url === 'https://nodejs.org/dist/index.json') return { ok: true, json: async () => index };
    if ((opts.method || 'GET') === 'GET') return { ok: true, json: async () => drafts };
    return { ok: true, json: async () => ({}) };
  });
  for (const m of ['log', 'error', 'warn']) {
    t.mock.method(console, m, (...a) => logged.push(a.join(' ')));
  }
  const spawn = () => ({ status: report === CLEAN ? 0 : 1, stdout: JSON.stringify(report) });
  const env = { GH_ADVISORY_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' };
  return { result: await main({ env, spawn }), calls, logged: logged.join('\n') };
}

test('a prod high advisory files a draft and fails the run', async (t) => {
  const { result, calls } = await runMain(t, { report: FIXTURE });
  assert.equal(result, true);
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post && post.url.endsWith('/repos/o/r/security-advisories'));
  assert.equal(JSON.parse(post.body).summary, AUDIT_SUMMARY);
});

test('an open draft for the finding is updated, not duplicated', async (t) => {
  const drafts = [{ ghsa_id: 'GHSA-aaaa-bbbb-cccc', summary: AUDIT_SUMMARY }];
  const { result, calls } = await runMain(t, { report: FIXTURE, drafts });
  assert.equal(result, true);
  assert.ok(!calls.some((c) => c.method === 'POST'));
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch && patch.url.endsWith('/repos/o/r/security-advisories/GHSA-aaaa-bbbb-cccc'));
  assert.match(JSON.parse(patch.body).description, /GHSA-q7qp-rjg7-q26m/);
});

test('a clean audit files nothing and passes', async (t) => {
  const { result, calls } = await runMain(t, { report: CLEAN });
  assert.equal(result, false);
  assert.ok(!calls.some((c) => c.method !== 'GET'));
});

test('the public log names no package and no advisory', async (t) => {
  const { logged } = await runMain(t, { report: FIXTURE });
  assert.match(logged, /action required/);
  for (const f of auditFindings(FIXTURE)) {
    assert.ok(!logged.includes(f.package), `log names ${f.package}`);
    assert.ok(!logged.includes(f.id), `log names ${f.id}`);
  }
  assert.ok(!/GHSA-/.test(logged));
});

test('a failing Node leg still lets the npm leg run, then fails the run', async (t) => {
  // Node runs first, so it is the leg whose failure could swallow the other.
  t.mock.method(globalThis, 'fetch', async (url) => (url === 'https://nodejs.org/dist/index.json'
    ? { ok: false, status: 503 } : { ok: true, json: async () => [] }));
  t.mock.method(console, 'log', () => {});
  let audited = false;
  const spawn = () => { audited = true; return { status: 1, stdout: JSON.stringify(FIXTURE) }; };
  const env = { GH_ADVISORY_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' };
  await assert.rejects(main({ env, spawn }), /answered 503/);
  assert.ok(audited, 'the npm leg never ran');
});
