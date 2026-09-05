'use strict';

/*
 * The JSON backend's one-off retire-vote migration (issue #909).
 *
 * The Postgres side is a Knex migration that runs itself on boot
 * (lib/repo/migrations/20260905120000_drop_retire_votes.js, exercised by
 * test/migrate.postgres.test.js). A self-hosted JSON instance has no migration
 * runner, so the same rewrite ships as a script the operator runs once with the
 * server stopped — and the two must agree on the mapping, or the same round
 * would read differently depending on which backend it lives in.
 *
 * Everything here runs against a GENERATED dataset in a temp folder; the real
 * data/ is never opened (.claude/rules/no-reading-production-data.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { migrateVotes, migrateFile } = require('../scripts/migrate-retire-votes');

const round = (sessions) => ({ id: 'r1', name: 'R', games: [], members: [], sessions });

test('the mapping matches the Postgres migration, row for row', () => {
  const data = {
    rounds: [round([{
      id: 's1',
      votes: {
        ann: { g1: { rating: 5, retire: false } },
        // The flag WAS the vote — dropping it alone would delete the opinion.
        bo: { g1: { rating: null, retire: true } },
        // The legacy contradiction: the stored rating wins now, reversing #797.
        cy: { g1: { rating: 4, retire: true } },
        // The STRING "true" was never `=== true`, so it was never a retirement.
        dee: { g1: { rating: null, retire: 'true' } },
      },
    }])],
  };

  const stats = migrateVotes(data);

  assert.deepEqual(data.rounds[0].sessions[0].votes, {
    ann: { g1: { rating: 5 } },
    bo: { g1: { rating: 1 } },
    cy: { g1: { rating: 4 } },
    dee: { g1: { rating: null } },
  });
  assert.deepEqual(stats, { votes: 4, flagsDropped: 4, rewritten: 1 });
});

test('a dataset with nothing to migrate is reported as untouched', () => {
  const data = { rounds: [round([{ id: 's1', votes: { ann: { g1: { rating: 3 } } } }])] };
  assert.deepEqual(migrateVotes(data), { votes: 1, flagsDropped: 0, rewritten: 0 });
  assert.deepEqual(data.rounds[0].sessions[0].votes, { ann: { g1: { rating: 3 } } });
});

test('malformed blobs are stepped over rather than thrown on', () => {
  const data = {
    rounds: [
      round([{ id: 's1', votes: { ann: 'nope', bo: { g1: 7 }, cy: { g1: null } } }]),
      round([{ id: 's2' }, { id: 's3', votes: {} }]),
      { id: 'r3' },
    ],
  };
  assert.doesNotThrow(() => migrateVotes(data));
  assert.deepEqual(data.rounds[0].sessions[0].votes, { ann: 'nope', bo: { g1: 7 }, cy: { g1: null } });
});

test('a dataset with no rounds at all is handled', () => {
  assert.deepEqual(migrateVotes({}), { votes: 0, flagsDropped: 0, rewritten: 0 });
});

test('migrateFile backs the dataset up before rewriting it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-mig-'));
  const file = path.join(dir, 'data.json');
  const before = { rounds: [round([{ id: 's1', votes: { bo: { g1: { rating: null, retire: true } } } }])] };
  fs.writeFileSync(file, JSON.stringify(before, null, 2));

  const { stats, backup } = migrateFile(file);

  assert.equal(stats.flagsDropped, 1);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(after.rounds[0].sessions[0].votes, { bo: { g1: { rating: 1 } } });
  // The backup must hold the ORIGINAL, or the operator has no way back — the
  // data/ folder is gitignored, so git will not save them
  // (.claude/rules/data-json-external-edits.md).
  assert.deepEqual(JSON.parse(fs.readFileSync(backup, 'utf8')), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrateFile leaves the file completely alone when there is nothing to do', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-mig-'));
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, JSON.stringify({ rounds: [] }, null, 2));
  const stamp = fs.statSync(file).mtimeMs;

  const { stats, backup } = migrateFile(file);

  assert.equal(stats.flagsDropped, 0);
  assert.equal(backup, null, 'no backup for a no-op run');
  assert.equal(fs.statSync(file).mtimeMs, stamp, 'the dataset is not rewritten');
  fs.rmSync(dir, { recursive: true, force: true });
});
