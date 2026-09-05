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

/*
 * The other half the shared contract cannot reach (#921).
 *
 * The import copies object-valued fields — `source`, `edition`, and the
 * `categories`/`mechanics` lists — onto the new round's game. In THIS backend
 * `data` is one shared in-memory tree, so carrying them by reference aliases two
 * rounds' live objects: an in-place edit to the source round's list would silently
 * rewrite the copy's. That is the hazard `copyExpansions`' own comment names, and
 * nothing today mutates these in place — but it costs one clone to make
 * unreachable.
 *
 * The contract suite is structurally blind to it: every read goes through
 * `clone()`, so two aliased objects come back as two distinct ones and the
 * assertion passes on both backends with the bug in place. Reaching past the repo
 * into the store is the only way to see it, which is what makes this a fixture
 * rather than a contract (Postgres cannot have it — every row is a fresh parse).
 */
test('an imported game shares no live object with the game it was copied from (#921)', async () => {
  const T = 'tenant-alias';
  const src = await repo.createRound(T, { name: 'Quelle', members: ['Ada'] });
  const koop = await repo.addTag(T, src.id, 'Koop');
  await repo.createGame(T, src.id, {
    title: 'Catan',
    image: null,
    source: { provider: 'bgg', externalId: '13', url: 'https://boardgamegeek.com/boardgame/13' },
    edition: { name: 'Kosmos', year: 2015, languages: ['de'] },
    categories: ['Negotiation'],
    mechanics: ['Trading'],
    tagIds: [koop.id],
  });
  const copy = await repo.createRound(T, { name: 'Kopie', members: ['Bo'], importFromRoundId: src.id });

  const from = store.findRound(src.id).games[0];
  const to = store.findRound(copy.id).games[0];
  for (const key of ['source', 'edition', 'categories', 'mechanics']) {
    assert.notEqual(from[key], to[key], `${key} is the SAME live object on both games`);
    assert.deepEqual(from[key], to[key], `${key} was copied, not dropped`);
  }
  // Anti-vacuous: the values really are there, so `notEqual` is about identity
  // and not about one side being undefined.
  assert.equal(from.categories[0], 'Negotiation');
});
