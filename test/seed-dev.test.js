'use strict';

/* scripts/seed-dev.js (#530) — the dev-instance seeder.
 *
 * Driven as a CHILD PROCESS on purpose, not by requiring it: the script's whole
 * contract is what it does with DATA_DIR, and the JSON store resolves that once
 * at require time (.claude/rules/automated-tests.md). Requiring it in-process
 * would either inherit this file's own store or need the target decided before
 * the first require — neither of which is the thing under test.
 *
 * The refusal tests are the load-bearing half. A seeder that quietly writes into
 * the default data/ would overwrite a maintainer's real instance
 * (.claude/rules/no-reading-production-data.md), and one that seeds on top of an
 * existing dataset silently duplicates the round and collides on the dev
 * account's e-mail — so both assert the process EXITED NON-ZERO and, for data/,
 * that the directory was not touched at all.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'seed-dev.js');

// A run of the script with DATA_DIR pointed wherever the caller wants. `cwd` is
// the repo so a relative DATA_DIR resolves the way a contributor's would.
const run = (dataDir, args = []) => spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, DATA_DIR: dataDir },
});

const tempTarget = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seed-dev-'));
const readData = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));

test('seeds a filled round into an isolated DATA_DIR', () => {
  const dir = tempTarget();
  try {
    const res = run(dir);
    assert.equal(res.status, 0, `expected a clean run, got:\n${res.stderr}`);

    const data = readData(dir);
    assert.equal(data.rounds.length, 1);
    const round = data.rounds[0];

    // The tenant an unauthenticated caller resolves to (lib/tenant.js), which is
    // what makes the seed visible in open mode.
    assert.equal(round.tenantId, 'default');
    assert.ok(round.games.length >= 5, `expected a filled Regal, got ${round.games.length} games`);
    assert.ok(round.members.length >= 4, `expected several seats, got ${round.members.length}`);
    assert.ok((round.tags || []).length >= 1, 'expected the seeded tags');

    // Covers are the reason the seeded shelf looks like a real one. They are
    // HOTLINKS to the providers' CDNs and must stay so — a local path here would
    // mean someone "fixed" a rotted URL by copying the bytes in
    // (.claude/rules/provider-cover-hotlinking.md).
    const covers = round.games.filter((g) => g.image);
    assert.ok(covers.length >= 5, `expected covers, got ${covers.length}`);
    for (const g of covers) {
      assert.match(g.image, /^https:\/\//, `${g.title}: cover must be a provider hotlink`);
    }

    // Chronik and Pokale render from FINISHED sessions with votes — a session
    // that merely exists leaves both screens on their empty states.
    const finished = round.sessions.filter((s) => s.finished);
    assert.ok(finished.length >= 1, 'expected at least one finished session');
    for (const s of finished) {
      assert.ok(s.chosenGameId, 'a finished session needs the game that was played');
      assert.ok(Object.keys(s.votes || {}).length >= 1, 'a finished session needs votes');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the seeded dev account can reach the seeded round in accounts mode', () => {
  const dir = tempTarget();
  try {
    assert.equal(run(dir).status, 0);
    const data = readData(dir);

    assert.equal(data.users.length, 1);
    const user = data.users[0];

    // The whole point of the account: its tenant is 'default', so logging in
    // resolves to the SAME round rather than a fresh empty tenant. A random
    // tenantId here would make the seed invisible on the dev-temp-data launch
    // config (ACCOUNTS_ENABLED=true), which is the primary way it is viewed.
    assert.equal(user.tenantId, 'default');
    assert.equal(user.tenantId, data.rounds[0].tenantId);
    // Login refuses an unverified address, and no mail can reach .invalid.
    assert.equal(user.emailVerified, true);
    assert.match(user.email, /\.invalid$/);
    assert.ok(user.identities.some((i) => i.type === 'password' && i.hash),
      'the dev account needs a password identity to log in with');

    // The owner seat carries the account id, so the Chronik attributes the
    // seeded actions to it and its own chair stays out of the seat pickers.
    assert.equal(data.rounds[0].members[0].userId, user.id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses to seed the default data/ directory', () => {
  const dataDir = path.join(ROOT, 'data');
  const existedBefore = fs.existsSync(dataDir);
  const before = existedBefore ? fs.statSync(dataDir).mtimeMs : null;

  const res = run('data');
  assert.notEqual(res.status, 0, 'seeding the real data/ must fail');
  assert.match(res.stderr, /refusing to seed the default data/);

  // It must refuse BEFORE requiring the store, which would create the directory
  // (lib/store.js mkdirs at require time) and read a real instance's file.
  assert.equal(fs.existsSync(dataDir), existedBefore, 'data/ must not be created by a refused run');
  if (existedBefore) {
    assert.equal(fs.statSync(dataDir).mtimeMs, before, 'data/ must not be written to');
  }
});

test('refuses the default data/ directory given as an absolute path', () => {
  // The guard compares resolved paths, so `DATA_DIR=/abs/path/to/data` and
  // `DATA_DIR=data` are the same target — a guard matching the literal string
  // would let the absolute form straight through.
  const res = run(path.join(ROOT, 'data'));
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /refusing to seed the default data/);
});

test('refuses a target that already holds data', () => {
  const dir = tempTarget();
  try {
    assert.equal(run(dir).status, 0);

    const res = run(dir);
    assert.notEqual(res.status, 0, 'a second seed must not append to an existing dataset');
    assert.match(res.stderr, /already holds data/);

    // Still exactly one round and one account: the refusal wrote nothing.
    const data = readData(dir);
    assert.equal(data.rounds.length, 1);
    assert.equal(data.users.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('seeds the round in the requested locale', () => {
  const dir = tempTarget();
  try {
    assert.equal(run(dir, ['en']).status, 0);
    const round = readData(dir).rounds[0];
    // The English seed text, so a contributor reading English does not get a
    // German round (lib/demo-seed.js DEMO_TEXT).
    assert.match(round.name, /demo/i);
    assert.equal(round.members[0].name, 'You');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
