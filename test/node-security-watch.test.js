'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pinnedVersion, pendingSecurityReleases, advisoryBody } = require('../scripts/node-security-watch');

const INDEX = [
  { version: 'v27.0.0', date: '2026-11-01', security: true },
  { version: 'v26.12.3', date: '2026-11-20', security: false },
  { version: 'v26.12.2', date: '2026-11-10', security: true },
  { version: 'v26.12.1', date: '2026-10-21', security: true },
  { version: 'v26.12.0', date: '2026-10-07', security: false },
  { version: 'v24.22.2', date: '2026-11-10', security: true },
];

test('the real Dockerfile yields its one pinned patch', () => {
  const pinned = pinnedVersion(fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8'));
  assert.match(pinned, /^\d+\.\d+\.\d+$/);
});

test('pinnedVersion refuses stages that disagree', () => {
  assert.throws(() => pinnedVersion('FROM node:26.12.1-slim AS b\nFROM node:26.12.0-slim\n'));
  assert.throws(() => pinnedVersion('FROM debian\n'));
});

test('only newer SECURITY releases on the pinned major count, newest first', () => {
  assert.deepEqual(pendingSecurityReleases(INDEX, '26.12.1').map((r) => r.version), ['26.12.2']);
  assert.deepEqual(pendingSecurityReleases(INDEX, '26.12.0').map((r) => r.version), ['26.12.2', '26.12.1']);
});

test('nothing is pending at or past the newest security release', () => {
  assert.deepEqual(pendingSecurityReleases(INDEX, '26.12.2'), []);
  assert.deepEqual(pendingSecurityReleases(INDEX, '26.12.3'), []);
});

test('the advisory names the release and the pin, and is stable for de-duplication', () => {
  const a = advisoryBody({ version: '26.12.2', date: '2026-11-10' }, '26.12.1');
  assert.match(a.summary, /26\.12\.2/);
  assert.match(a.description, /node:26\.12\.1-slim/);
  assert.equal(a.vulnerabilities[0].patched_versions, '26.12.2');
  assert.equal(advisoryBody({ version: '26.12.2', date: 'x' }, '26.12.0').summary, a.summary);
});

// main() against a stubbed fetch: its return value is what fails the run, and a
// failed run is the only thing that notifies the operator.
const { main } = require('../scripts/node-security-watch');
const PIN = pinnedVersion(fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8'));

async function runMain(t, index, extra = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${url}`);
    if (url.includes('nodejs.org')) return { ok: true, json: async () => index };
    return { ok: true, json: async () => [] };
  });
  t.mock.method(console, 'log', () => {});
  const vars = Object.assign({ GH_ADVISORY_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' }, extra);
  return { result: await main({ env: vars }), calls };
}

test('a pending security release files a draft AND reports action required', async (t) => {
  const [maj, min, pat] = PIN.split('.').map(Number);
  const next = `v${maj}.${min}.${pat + 1}`;
  const { result, calls } = await runMain(t, [{ version: next, date: '2099-01-01', security: true }]);
  assert.equal(result, true);
  assert.ok(calls.some((c) => c.startsWith('POST ') && c.includes('/security-advisories')));
});

test('nothing pending: no draft, and the run passes', async (t) => {
  const { result, calls } = await runMain(t, [{ version: 'v1.0.0', date: '2000-01-01', security: true }]);
  assert.equal(result, false);
  assert.ok(!calls.some((c) => c.startsWith('POST ')));
});

test('test mode also reports action required, so the mail path can be checked', async (t) => {
  const { result } = await runMain(t, [], { WATCH_TEST: 'true' });
  assert.equal(result, true);
});
