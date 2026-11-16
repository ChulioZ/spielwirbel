'use strict';

/*
 * lib/game-scoring.js (#1786): the overlay a confirmation applies on read, the
 * admin list's state rule, the fold of the backends' per-round rows, and the
 * confirmed-map cache. The HTTP half is test/game-scoring-admin.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  bggIdOf, overlayGame, overlayRound, confirmedLoader, settingState, foldScoringRounds, CONFIRMED_TTL_MS,
} = require('../lib/game-scoring');

const bgg = (id) => ({ source: { provider: 'bgg', externalId: id } });

test('bggIdOf takes a digits-only bgg externalId and nothing else', () => {
  assert.equal(bggIdOf(bgg('123')), '123');
  assert.equal(bggIdOf(bgg(123)), '123');
  assert.equal(bggIdOf(bgg('12a')), null);
  assert.equal(bggIdOf({ source: { provider: 'steam', externalId: '123' } }), null);
  assert.equal(bggIdOf({ title: 'x' }), null);
  assert.equal(bggIdOf(null), null);
});

test('the overlay replaces the round value with the confirmed one, both ways, and marks it locked', () => {
  const map = new Map([['1', true], ['2', false]]);
  assert.deepEqual(overlayGame({ ...bgg('1') }, map), { ...bgg('1'), lowScoreWins: true, scoringLocked: true });
  // false is ABSENCE, the stored shape (#1630) — never a `lowScoreWins: false`.
  const high = overlayGame({ ...bgg('2'), lowScoreWins: true }, map);
  assert.equal('lowScoreWins' in high, false);
  assert.equal(high.scoringLocked, true);
  // Unconfirmed and unlinked games are untouched.
  assert.deepEqual(overlayGame({ ...bgg('3'), lowScoreWins: true }, map), { ...bgg('3'), lowScoreWins: true });
  assert.deepEqual(overlayGame({ title: 'x' }, map), { title: 'x' });
  const round = overlayRound({ games: [{ ...bgg('1') }, { ...bgg('3') }] }, map);
  assert.deepEqual(round.games.map((g) => !!g.scoringLocked), [true, false]);
  assert.equal(overlayRound(null, map), null);
});

test('settingState: confirmed sticks; a dismissal holds until a round more contributes', () => {
  assert.equal(settingState(null, 4), 'open');
  assert.equal(settingState({ state: 'confirmed' }, 0), 'confirmed');
  assert.equal(settingState({ state: 'dismissed', dismissedAtRounds: 3 }, 3), 'dismissed');
  assert.equal(settingState({ state: 'dismissed', dismissedAtRounds: 3 }, 2), 'dismissed', 'fewer is not more');
  assert.equal(settingState({ state: 'dismissed', dismissedAtRounds: 3 }, 4), 'open');
});

test('the fold counts rounds and their own switch per id, and names the most common title', () => {
  // Tie broken alphabetically: 'Azul' and 'Zug' both appear once in the second
  // id, so the fixture lists 'Zug' FIRST — a fold that took the first title
  // seen would answer 'Zug' (.claude/rules/tiebreak-fixtures-must-sort-against-the-fallback.md).
  const out = foldScoringRounds([
    { bggId: '7', low: true, titles: ['Golf'] },
    { bggId: '7', low: false, titles: ['Golf', 'Golf!'] },
    { bggId: '7', low: false, titles: ['Golf'] },
    { bggId: '8', low: false, titles: ['Zug', 'Azul'] },
  ]);
  assert.deepEqual(out, [
    { bggId: '7', rounds: 3, lowWins: 1, highWins: 2, title: 'Golf' },
    { bggId: '8', rounds: 1, lowWins: 0, highWins: 1, title: 'Azul' },
  ]);
  assert.deepEqual(foldScoringRounds([{ bggId: '9', low: false, titles: [] }])[0].title, null);
});

test('the confirmed map is cached for the TTL, shared by concurrent reads, and invalidated on demand', async () => {
  let calls = 0;
  let clock = 0;
  let rows = [{ bggId: '1', state: 'confirmed', lowScoreWins: true }, { bggId: '2', state: 'dismissed' }];
  const load = confirmedLoader(async () => { calls += 1; return rows; }, () => clock);
  const [a, b] = await Promise.all([load(), load()]);
  assert.equal(calls, 1, 'one query for two concurrent reads');
  assert.equal(a, b);
  assert.deepEqual([...a], [['1', true]], 'only confirmed rows');
  rows = [];
  clock = CONFIRMED_TTL_MS - 1;
  assert.deepEqual([...(await load())], [['1', true]], 'still cached inside the TTL');
  clock = CONFIRMED_TTL_MS;
  assert.deepEqual([...(await load())], [], 'reloaded at the TTL');
  rows = [{ bggId: '5', state: 'confirmed', lowScoreWins: false }];
  load.invalidate();
  assert.deepEqual([...(await load())], [['5', false]], 'invalidate forces a reload');
  assert.equal(calls, 3);
});
