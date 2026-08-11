'use strict';

/*
 * The data-access-layer contract (lib/repo, issue #127) against the default JSON
 * backend. The same suite runs against PostgreSQL in test/repo.postgres.test.js.
 * helpers.js points DATA_DIR at a fresh temp dir before the store loads.
 */

require('./helpers');
const repo = require('../lib/repo');

require('./support/repo-contract')(repo);

/*
 * The half the shared contract cannot reach (#744).
 *
 * The `rounds.providers` column and its JSON key are deliberately NOT dropped —
 * CLAUDE.md keeps no permanent migration code — so rows configured before the
 * retirement still CARRY a value. What had to change is that nothing reads it.
 *
 * A contract spec over a fresh round cannot see that: the key was never there,
 * so it passes with the shaping lines still in place (measured — 141/141 green
 * with one reinstated on purpose). This plants a legacy value the way an
 * existing row holds one and asserts every read path drops it. It is
 * JSON-backend-only because it needs to write past the repo, which is exactly
 * what makes it a fixture rather than a contract.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../lib/store');

test('a round that still STORES a providers value never surfaces it (#744)', async () => {
  const round = await repo.createRound('tenant-legacy', { name: 'Pre-#744', members: ['Ada'] });
  const raw = store.findRound(round.id);
  raw.providers = ['bgg', 'steam']; // what a round configured under #294 holds
  store.saveData();

  for (const [what, shape] of [
    ['getRound', await repo.getRound('tenant-legacy', round.id)],
    ['getRoundMeta', await repo.getRoundMeta('tenant-legacy', round.id)],
    ['listRounds', (await repo.listRounds('tenant-legacy')).find((r) => r.id === round.id)],
    ['renameRound', await repo.renameRound('tenant-legacy', round.id, 'Renamed', null)],
  ]) assert.equal('providers' in shape, false, `${what} still surfaces the retired setting`);

  // Anti-vacuous: the value really is still in the store, so the assertions
  // above are about the READ and not about the write having been lost.
  assert.deepEqual(store.findRound(round.id).providers, ['bgg', 'steam']);
});
