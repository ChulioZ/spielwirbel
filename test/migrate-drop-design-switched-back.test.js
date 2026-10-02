'use strict';

/*
 * The JSON backend's one-off deletion of `designSwitchedBack` (issue #1480).
 *
 * The Postgres side is a Knex migration that runs itself on boot
 * (lib/repo/migrations/20261002120000_drop_design_switched_back.js, exercised by
 * test/migrate.postgres.test.js). A self-hosted JSON instance has no migration
 * runner, so the same deletion ships as a script the operator runs once with
 * the server stopped.
 *
 * Everything here runs against a GENERATED dataset in a temp folder; the real
 * data/ is never opened (.claude/rules/no-reading-production-data.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { dropSwitchedBack, migrateFile } = require('../scripts/migrate-drop-design-switched-back');

const user = (id, extra = {}) => ({ id, email: `${id}@example.test`, design: 'tisch', ...extra });

test('every value of the key goes, and nothing else on the account moves', () => {
  const data = {
    rounds: [{ id: 'r1', name: 'R' }],
    users: [
      user('a', { designSwitchedBack: true }),
      user('b', { designSwitchedBack: false }),
      // Not `=== true`, but still a stored value of the field — it goes too.
      user('c', { designSwitchedBack: 'true' }),
      user('d'),
    ],
  };

  const stats = dropSwitchedBack(data);

  assert.deepEqual(data.users, [user('a'), user('b'), user('c'), user('d')]);
  assert.deepEqual(stats, { users: 4, dropped: 3 });
  assert.deepEqual(data.rounds, [{ id: 'r1', name: 'R' }], 'rounds are not touched');
});

test('malformed entries and a dataset without users are stepped over', () => {
  const data = { users: [null, 'nope', [1], user('a', { designSwitchedBack: true })] };
  assert.doesNotThrow(() => dropSwitchedBack(data));
  assert.deepEqual(data.users, [null, 'nope', [1], user('a')]);
  assert.deepEqual(dropSwitchedBack({}), { users: 0, dropped: 0 });
  assert.deepEqual(dropSwitchedBack({ users: 'x' }), { users: 0, dropped: 0 });
});

const tmpFile = (content) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-mig1480-'));
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
  return { dir, file };
};

test('migrateFile backs the dataset up before rewriting it, and a second run is a no-op', () => {
  const before = { rounds: [], users: [user('a', { designSwitchedBack: true })] };
  const { dir, file } = tmpFile(before);

  const { stats, backup } = migrateFile(file);

  assert.equal(stats.dropped, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).users, [user('a')]);
  // The backup must hold the ORIGINAL — data/ is gitignored, so git will not
  // save the operator (.claude/rules/data-json-external-edits.md).
  assert.deepEqual(JSON.parse(fs.readFileSync(backup, 'utf8')), before);

  const again = migrateFile(file);
  assert.equal(again.stats.dropped, 0);
  assert.equal(again.backup, null, 'safe to run twice: nothing found, nothing written');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--dry-run reports what it would do and writes nothing', () => {
  const before = { rounds: [], users: [user('a', { designSwitchedBack: false })] };
  const { dir, file } = tmpFile(before);

  const { stats, backup } = migrateFile(file, { dryRun: true });

  assert.equal(stats.dropped, 1, 'it still reports what it found');
  assert.equal(backup, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), before, 'the dataset is untouched');
  assert.deepEqual(fs.readdirSync(dir), ['data.json'], 'and no backup was left behind');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrateFile leaves the file completely alone when there is nothing to do', () => {
  const { dir, file } = tmpFile({ rounds: [], users: [user('a')] });
  const stamp = fs.statSync(file).mtimeMs;

  const { stats, backup } = migrateFile(file);

  assert.equal(stats.dropped, 0);
  assert.equal(backup, null, 'no backup for a no-op run');
  assert.equal(fs.statSync(file).mtimeMs, stamp, 'the dataset is not rewritten');
  fs.rmSync(dir, { recursive: true, force: true });
});
