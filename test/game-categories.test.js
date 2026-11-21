'use strict';

/*
 * The pure half of the operator's confirmed scoring categories (#1787):
 * normalisation, the stored base, the read overlay (sheet + session parts), the
 * write-side translation, the lock on an edit, the admin state and the fold.
 * The HTTP half is test/game-categories-admin.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normCategoryName, categorySetKey, globalCategoryId, buildCategoryBase, overlayGameCategories,
  overlayRoundCategories, mapScoreParts, toStoredParts, splitLockedEdit, storedEditList,
  categoryState, foldCategoryRounds,
} = require('../lib/game-categories');

const BGG = '266192';
const src = { provider: 'bgg', externalId: BGG };
const baseOf = (names, original = names) => buildCategoryBase(BGG, original, names).base;

test('names normalise on case, outer and inner whitespace; order counts in a set key', () => {
  assert.equal(normCategoryName('  Vögel   im  Wald '), 'vögel im wald');
  assert.equal(categorySetKey(['Eier', 'Vögel']), categorySetKey([' eier', 'VÖGEL ']));
  assert.notEqual(categorySetKey(['Eier', 'Vögel']), categorySetKey(['Vögel', 'Eier']));
});

test('global ids are derived from the BGG id and the confirmed name, so a re-confirm gives them back', () => {
  assert.equal(globalCategoryId(BGG, 'Vögel'), globalCategoryId(BGG, ' vögel '));
  assert.notEqual(globalCategoryId(BGG, 'Vögel'), globalCategoryId('1', 'Vögel'));
  assert.match(globalCategoryId(BGG, 'Vögel'), /^g[0-9a-f]{12}$/);
});

test('a base matches both the corrected and the original spelling', () => {
  const { base } = buildCategoryBase(BGG, ['Vogel', 'Eier'], ['Vögel', 'Eier']);
  assert.deepEqual(base[0].match, ['vögel', 'vogel']);
  assert.equal(base[0].name, 'Vögel');
});

test('a base refuses a changed length, an empty or over-long name, and colliding names', () => {
  assert.equal(buildCategoryBase(BGG, ['A'], ['A', 'B']).error, 'names_mismatch');
  assert.equal(buildCategoryBase(BGG, ['A'], ['  ']).error, 'invalid_names');
  assert.equal(buildCategoryBase(BGG, ['A'], ['x'.repeat(31)]).error, 'invalid_names');
  assert.equal(buildCategoryBase(BGG, ['A', 'B'], ['A', 'a']).error, 'duplicate_names');
  // Correcting position 1 to position 0's original spelling would make one
  // round category match two base categories.
  assert.equal(buildCategoryBase(BGG, ['Vogel', 'Eier'], ['Eier2', 'Vogel']).error, 'duplicate_names');
});

test('the overlay puts the base first, locked, maps matching round categories and keeps the rest as extras', () => {
  const base = baseOf(['Vögel', 'Eier']);
  const game = {
    id: 'g1', source: src,
    scoreCategories: [{ id: 'l-eier', name: 'eier ' }, { id: 'l-exp', name: 'Ozeanien' }, { id: 'l-old', name: 'Vögel', removed: true }],
  };
  overlayGameCategories(game, new Map([[BGG, base]]));
  assert.deepEqual(game.scoreCategories, [
    { id: base[0].id, name: 'Vögel', locked: true },
    { id: base[1].id, name: 'Eier', locked: true },
    { id: 'l-exp', name: 'Ozeanien' },
  ]);
  assert.equal(game.scoreCategoriesLocked, 2);
  assert.deepEqual(game.scoreCategoryMap, { 'l-eier': base[1].id, 'l-old': base[0].id }, 'tombstones map too');
});

test('the overlay leaves unlinked games, other BGG ids and an empty map untouched', () => {
  const base = baseOf(['A']);
  const unlinked = { id: 'g', scoreCategories: [{ id: 'x', name: 'A' }] };
  overlayGameCategories(unlinked, new Map([[BGG, base]]));
  assert.deepEqual(unlinked, { id: 'g', scoreCategories: [{ id: 'x', name: 'A' }] });
  const other = { id: 'g', source: { provider: 'bgg', externalId: '1' } };
  overlayGameCategories(other, new Map([[BGG, base]]));
  assert.equal('scoreCategoriesLocked' in other, false);
  const g = { id: 'g', source: src };
  assert.equal(overlayGameCategories(g, new Map()), g);
  assert.equal('scoreCategories' in g, false);
});

test('a round overlay re-keys the parts of that game only, and summing keeps totals intact', () => {
  const base = baseOf(['Eier']);
  const round = {
    games: [
      { id: 'g1', source: src, scoreCategories: [{ id: 'a', name: 'Eier' }, { id: 'b', name: 'eier' }, { id: 'c', name: 'Bonus' }] },
      { id: 'g2', scoreCategories: [{ id: 'a', name: 'Eier' }] },
    ],
    sessions: [
      { chosenGameId: 'g1', scores: { m1: 9 }, scoreParts: { m1: { a: 3, b: 2, c: 4 } } },
      { chosenGameId: 'g2', scores: { m1: 5 }, scoreParts: { m1: { a: 5 } } },
    ],
  };
  overlayRoundCategories(round, new Map([[BGG, base]]));
  assert.deepEqual(round.sessions[0].scoreParts, { m1: { [base[0].id]: 5, c: 4 } });
  assert.deepEqual(round.sessions[1].scoreParts, { m1: { a: 5 } }, 'another game keeps its own ids');
});

test('stored parts go back to the round-local id; a base the round never had keeps the global id', () => {
  const map = { 'l-eier': 'gE', 'l-eier2': 'gE' };
  assert.deepEqual(toStoredParts({ m1: { gE: 3, gV: 4, own: 1 } }, map), { m1: { 'l-eier': 3, gV: 4, own: 1 } });
  assert.deepEqual(mapScoreParts({ m1: { 'l-eier': 3 } }, map), { m1: { gE: 3 } });
  assert.equal(toStoredParts(null, map), null);
});

test('a locked edit must start with the base unchanged; extras may follow but not reuse a base name', () => {
  const base = baseOf(['Vögel', 'Eier']);
  const ok = [{ id: base[0].id, name: 'Vögel' }, { id: base[1].id, name: 'Eier' }, { name: 'Ozeanien' }];
  assert.deepEqual(splitLockedEdit(ok, base), { extras: [{ name: 'Ozeanien' }] });
  const refuse = (list) => splitLockedEdit(list, base);
  assert.equal(refuse([{ id: base[0].id, name: 'Vogel' }, ok[1]]).status, 409, 'rename');
  assert.equal(refuse([ok[1], ok[0]]).status, 409, 'reorder');
  assert.equal(refuse([ok[0]]).status, 409, 'removal');
  assert.equal(refuse([ok[0], ok[1], { id: base[0].id, name: 'X' }]).status, 409, 'a base id among the extras');
  assert.deepEqual(refuse([ok[0], ok[1], { name: ' eier' }]), { error: 'Duplicate scoring category', status: 400 });
  assert.equal(refuse('nope').status, 400);
});

test('the stored edit list keeps the round categories the base matched, then the extras', () => {
  const base = baseOf(['Eier']);
  const raw = { scoreCategories: [{ id: 'x', name: 'Bonus' }, { id: 'l', name: 'eier' }, { id: 'r', name: 'Eier', removed: true }] };
  assert.deepEqual(storedEditList(raw, base, [{ id: 'x', name: 'Boni' }]), [{ id: 'l', name: 'eier' }, { id: 'x', name: 'Boni' }]);
});

test('a dismissal lasts until one more round, or one more distinct set, appears', () => {
  const d = { state: 'dismissed', dismissedAtRounds: 2, dismissedAtSets: 1 };
  assert.equal(categoryState(null, 1, 1), 'open');
  assert.equal(categoryState({ state: 'confirmed' }, 0, 0), 'confirmed');
  assert.equal(categoryState(d, 2, 1), 'dismissed');
  assert.equal(categoryState(d, 3, 1), 'open');
  assert.equal(categoryState(d, 2, 2), 'open');
});

test('the fold groups normalised sets per game, counts rounds, and shows the commonest spelling', () => {
  const out = foldCategoryRounds([
    { bggId: BGG, sets: [['Vögel', 'Eier']], titles: ['Flügelschlag'] },
    { bggId: BGG, sets: [['vögel ', 'EIER'], ['Vögel', 'Eier']], titles: ['Flügelschlag'] },
    { bggId: BGG, sets: [['Vögel', 'Eier']], titles: ['Wingspan'] },
    { bggId: BGG, sets: [['Eier', 'Vögel']], titles: [] },
    { bggId: '1', sets: [['A']], titles: [] },
  ]);
  const mine = out.find((e) => e.bggId === BGG);
  assert.equal(mine.rounds, 4);
  assert.equal(mine.title, 'Flügelschlag');
  assert.deepEqual(mine.sets.map((s) => ({ names: s.names, rounds: s.rounds })), [
    { names: ['Vögel', 'Eier'], rounds: 3 },
    { names: ['Eier', 'Vögel'], rounds: 1 },
  ]);
});
