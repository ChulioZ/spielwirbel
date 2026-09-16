'use strict';

/* Instance faults that are CAUGHT and converted into a status code, a null or an
 * empty list (#1148).
 *
 * None of these reach `errorHandler`, so none of them used to log: an R2 outage
 * broke every cover in the app while the operator panel reported „Keine Warn-
 * oder Fehlermeldungen". Each site now emits one structured line, and the
 * behaviour the caller sees is deliberately unchanged — every spec below asserts
 * both halves, because a log line that also changed the answer would be a
 * regression dressed as observability.
 *
 * Its own file rather than more of test/storage.test.js: the sites span six
 * modules and it is the *logging* that is under test, not any one of them.
 * `test/client-error-logging.test.js` is the neighbouring file and covers the
 * opposite question — which faults must NOT be recorded as ours.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');
const express = require('express');
const request = require('supertest');

const { app, DATA_DIR } = require('./helpers');
const { recentLogs, clearLogs } = require('../lib/observability');
const createS3Storage = require('../lib/storage/s3');
const disk = require('../lib/storage/disk');
const { rememberOwnerPreset } = require('../lib/game-owners');
const { assetPathSet } = require('../lib/app');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');

const UPLOADS = path.join(DATA_DIR, 'uploads');

// The one line this site emitted, or undefined. Fails loudly when a site logs
// MORE than once, which is the flood the ring buffer cannot survive.
function lineFor(event) {
  const hits = recentLogs().filter((l) => l.event === event);
  assert.ok(hits.length <= 1, `${event} logged ${hits.length} times; expected at most one`);
  return hits[0];
}

/* --------------------------- the S3 backend (#128) ------------------------- */

// A client whose every command fails the way a credential rotation or an outage
// fails — NOT the way a missing object does, which is the distinction serve()
// has to keep making.
function brokenS3() {
  return createS3Storage({
    client: {
      async send() {
        const err = new Error('connection refused');
        err.name = 'TimeoutError';
        throw err;
      },
    },
    bucket: 'b',
  });
}

test('an unreachable object store logs GET /uploads at error and still answers 502', async () => {
  clearLogs();
  const srv = express();
  srv.use('/uploads', brokenS3().serve);

  const res = await request(srv).get('/uploads/abc.png');

  assert.equal(res.status, 502, 'the response the caller sees must not change');
  const line = lineFor('storage_serve_failed');
  assert.ok(line, 'a failing store served no log line');
  assert.equal(line.level, 'error');
  assert.equal(line.backend, 's3');
  assert.equal(line.key, 'abc.png');
  assert.equal(line.message, 'connection refused');
});

test('a MISSING object is a 404 and logs nothing — it is not an instance fault', async () => {
  clearLogs();
  const storage = createS3Storage({
    client: {
      async send() {
        const err = new Error('NoSuchKey');
        err.name = 'NoSuchKey';
        throw err;
      },
    },
    bucket: 'b',
  });
  const srv = express();
  srv.use('/uploads', storage.serve);

  const res = await request(srv).get('/uploads/gone.png');

  assert.equal(res.status, 404);
  assert.deepEqual(recentLogs(), [], 'a missing cover must not fill the operator panel');
});

test('the best-effort S3 reads log at warn and keep their best-effort answers', async () => {
  const storage = brokenS3();

  clearLogs();
  assert.equal(await storage.size('/uploads/a.png'), null);
  assert.equal(lineFor('storage_size_failed').level, 'warn');

  clearLogs();
  assert.equal(await storage.read('/uploads/a.png'), null);
  assert.equal(lineFor('storage_read_failed').level, 'warn');

  clearLogs();
  assert.deepEqual(await storage.usage(), { objects: 0, bytes: 0, complete: false, keys: [] });
  assert.equal(lineFor('storage_usage_failed').level, 'warn');

  clearLogs();
  await storage.remove('/uploads/a.png');
  const del = lineFor('storage_delete_failed');
  assert.equal(del.level, 'warn');
  assert.equal(del.key, 'a.png', 'the key is what makes the line actionable');
});

/* -------------------------- the disk backend (#128) ------------------------ */

test('a delete of an already-gone file logs nothing; one that really fails logs at warn', async () => {
  clearLogs();
  await disk.remove('/uploads/never-existed.png');
  assert.deepEqual(recentLogs(), [], 'ENOENT is the documented no-op, not a fault');

  // A directory where a file is expected: unlink refuses it (EPERM/EISDIR), which
  // is the shape of a delete that did NOT happen.
  const blocked = path.join(UPLOADS, 'blocked.png');
  fs.mkdirSync(blocked, { recursive: true });
  clearLogs();
  await disk.remove('/uploads/blocked.png');
  const line = lineFor('storage_delete_failed');
  assert.ok(line, 'a failing unlink logged nothing');
  assert.equal(line.level, 'warn');
  assert.equal(line.backend, 'disk');
  assert.ok(line.code, 'the line must carry the errno that distinguishes it from ENOENT');
  fs.rmdirSync(blocked);
});

test('disk size/read report the missing bytes they were asked for', async () => {
  clearLogs();
  assert.equal(await disk.size('/uploads/absent.png'), null);
  assert.equal(lineFor('storage_size_failed').code, 'ENOENT');

  clearLogs();
  assert.equal(await disk.read('/uploads/absent.png'), null);
  assert.equal(lineFor('storage_read_failed').code, 'ENOENT');
});

test('a usage sweep logs ONE aggregated line, never one per unreadable file', async () => {
  // Broken symlinks: readdir lists them, stat follows and fails. Three of them,
  // so a per-file line would be three lines — which is the ring-buffer flood the
  // aggregation exists to prevent (LOG_BUFFER_MAX is 200 and this loop runs up
  // to USAGE_MAX = 5000 times).
  const links = ['l1.png', 'l2.png', 'l3.png'].map((n) => path.join(UPLOADS, n));
  for (const l of links) fs.symlinkSync(path.join(UPLOADS, 'nothing-here'), l);
  try {
    clearLogs();
    const out = await disk.usage();
    assert.equal(out.objects, 0, 'a broken link is not an object');
    const line = lineFor('storage_usage_incomplete');   // asserts exactly one
    assert.ok(line, 'three unreadable entries produced no line at all');
    assert.equal(line.level, 'warn');
    assert.equal(line.unreadable, 3, 'the count is what a single line has to carry');
  } finally {
    for (const l of links) fs.unlinkSync(l);
  }
});

test('an unlistable uploads folder logs at warn and exempts nothing', async () => {
  const stash = `${UPLOADS}-stash`;
  fs.renameSync(UPLOADS, stash);
  try {
    clearLogs();
    const out = await disk.usage();
    assert.deepEqual(out.keys, []);
    const line = lineFor('storage_usage_failed');
    assert.ok(line, 'an unreadable folder reported nothing');
    assert.equal(line.code, 'ENOENT');
  } finally {
    fs.renameSync(stash, UPLOADS);
  }
});

/* ------------------------------ shared fixtures ---------------------------- */

// ACCOUNTS_ENABLED is on for this file (the e-mail-change site needs it), so the
// round below has to be created by a real account rather than by helpers'
// unauthenticated createRound.
const PASSWORD = 'correct horse battery';
let seq = 0;

async function makeAccount() {
  const name = `faultlog${(seq += 1)}`;
  const email = `${name}@example.com`;
  await request(app).post('/api/account/register').send({ email, username: name, password: PASSWORD });
  const v = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  await request(app).post('/api/account/verify-email').send({ token: v[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200, 'the fixture account could not log in');
  return { name, email, auth: { Authorization: `Bearer ${login.body.accessToken}` } };
}

/* ---------------------------- the lookup (#117) ---------------------------- */

const { providers } = require('../lib/providers');

async function withThrowingProvider(fn) {
  providers.stub = {
    id: 'stub',
    resolveLocale: () => '',
    search: async () => { throw new Error('upstream 503'); },
    detail: async () => { throw new Error('upstream 503'); },
    imageHosts: [],
    imageHostAllowed: () => false,
  };
  try { await fn(); } finally { delete providers.stub; }
}

test('a provider outage logs at warn, still answers 502, and never logs the query', async () => {
  const a = await makeAccount();
  const round = await request(app).post('/api/rounds').set(a.auth)
    .send({ name: 'Test round', members: ['Alice', 'Bob'] });
  assert.equal(round.status, 201, 'the fixture round was not created');
  const rid = round.body.id;

  await withThrowingProvider(async () => {
    clearLogs();
    const res = await request(app)
      .get(`/api/rounds/${rid}/lookup/search?provider=stub&q=Geheimes%20Lieblingsspiel`)
      .set(a.auth);

    assert.equal(res.status, 502);
    assert.deepEqual(res.body, { error: 'provider_unreachable' });
    const line = lineFor('lookup_provider_failed');
    assert.ok(line, 'a provider outage logged nothing');
    assert.equal(line.level, 'warn', 'a third party being down is not our error');
    assert.equal(line.provider, 'stub');
    assert.equal(line.op, 'search');
    // The query is user-typed text; the logger's allowlist promises it never
    // reaches a line (.claude/rules/product-event-logging.md).
    assert.ok(!JSON.stringify(recentLogs()).includes('Lieblingsspiel'),
      'the search term reached the logs');

    clearLogs();
    const detail = await request(app)
      .get(`/api/rounds/${rid}/lookup/game?provider=stub&id=4711`)
      .set(a.auth);
    assert.equal(detail.status, 502);
    assert.equal(lineFor('lookup_provider_failed').op, 'detail');
  });
});

/* --------------------- the e-mail change confirm (#1076) ------------------- */

test('a failing e-mail write logs at error while the user still sees invalid_token', async () => {
  const a = await makeAccount();
  const next = `${a.name}-new@example.com`;
  const req = await request(app).post('/api/account/change-email').set(a.auth)
    .send({ email: next, currentPassword: PASSWORD });
  assert.equal(req.status, 200, 'the change could not be requested');
  const token = outbox[outbox.length - 1].text.match(/\/e\?t=(e1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/)[1];

  // Only the write that carries the new address fails — the catch's own
  // pendingEmail clear must still go through, or the route 500s instead and the
  // assertion below would be measuring a different bug.
  const real = repo.updateUser;
  repo.updateUser = async (id, patch) => {
    if (patch && patch.email) throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    return real.call(repo, id, patch);
  };
  try {
    clearLogs();
    const res = await request(app).post('/api/account/confirm-email').send({ token });

    assert.equal(res.status, 400, 'the answer to the user must not change');
    assert.deepEqual(res.body, { error: 'invalid_token' });
    const line = lineFor('email_change_write_failed');
    assert.ok(line, 'a database fault was reported to the user and to nobody else');
    assert.equal(line.level, 'error');
    assert.equal(line.code, '40P01');
    assert.ok(!JSON.stringify(recentLogs()).includes(a.name),
      'an e-mail address or username reached the logs');
  } finally {
    repo.updateUser = real;
  }
});

/* ------------------------- the owner preset (#971) ------------------------- */

test('a dropped owner-preference write logs at warn and still resolves', async () => {
  const round = { members: [{ id: 'm1', userId: 'u1' }] };
  const failing = { async updateMember() { throw new Error('write failed'); } };

  clearLogs();
  await rememberOwnerPreset(failing, round, 'r1', 'u1', ['m1']);

  const line = lineFor('owner_preset_write_failed');
  assert.ok(line, 'the preference write failed silently');
  assert.equal(line.level, 'warn');
  assert.equal(line.message, 'write failed');
});

/* ----------------------- the asset exemption (lib/app.js) ------------------ */

test('an unreadable asset dir logs at warn and exempts nothing', () => {
  clearLogs();
  const out = assetPathSet(path.join(DATA_DIR, 'no-such-asset-dir'));

  assert.equal(out.size, 0, 'fail closed: exempt nothing');
  const line = lineFor('asset_scan_failed');
  assert.ok(line, 'the limiter stopped exempting assets with nothing said');
  assert.equal(line.level, 'warn');
  assert.equal(line.code, 'ENOENT');
});

/* ------------------------- the JSON dataset (lib/store.js) ----------------- */

/* loadData() runs at REQUIRE time, so this one has to be a fresh process: the
   store in this one already loaded its (empty) dataset before the first test. */
function loadStoreWith(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-log-store-'));
  if (contents !== null) fs.writeFileSync(path.join(dir, 'data.json'), contents);
  const script = `
    process.env.DATA_DIR = ${JSON.stringify(dir)};
    process.env.LOG_LEVEL = 'silent';
    require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'store'))});
    const { recentLogs } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'observability'))});
    process.stdout.write(JSON.stringify(recentLogs()));
  `;
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return JSON.parse(out);
}

test('a corrupt data.json logs at error — and NEVER quotes the file', () => {
  // A JSON.parse failure message embeds a snippet of what it was parsing
  // ("Unexpected token 'o', \"not json at\"... is not valid JSON"), which for
  // this file is the group's own private data. Hence code/name, never message —
  // the same reason client_error logs `type`.
  const secret = 'Geheime Runde mit Anna Schmidt';
  const logs = loadStoreWith(`not json at all ${secret}`);

  const line = logs.find((l) => l.event === 'data_load_failed');
  assert.ok(line, 'an empty dataset was started over real data with nothing said');
  assert.equal(line.level, 'error');
  assert.equal(line.code, 'SyntaxError');
  assert.equal(line.message, undefined, 'the parser message carries file content');
  assert.ok(!JSON.stringify(logs).includes('Anna Schmidt'), 'data.json content reached the logs');
});

test('a MISSING data.json is a fresh instance and logs nothing at all', () => {
  // Every first boot and every test process takes this branch; a line here would
  // fill the 200-entry ring buffer with non-faults before anything real happened.
  assert.deepEqual(loadStoreWith(null), []);
});
