'use strict';

/* The Regal's player-count filter (#1667): the predicate behind „Personen".

   It reuses the draw's own seat rule (`fitsPlayerCount`, draw-pool.js), so an
   owned expansion widens by UNION and a game with no player data stays IN —
   unknown is not a mismatch, exactly as in the draw. The open top („8+") is
   the same probe the Regal-Steckbrief's „6+" band reads (`fitsPlayerCountFrom`),
   so the two cannot disagree about "seats any table this big or bigger". */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  matchesPlayerFilter, fitsPlayerCountFrom, PLAYER_FILTER_CHOICES, PLAYER_FILTER_TOP,
} = require('../public/js/draw-pool');

const box = (min, max, over = {}) => ({ title: 'G', minPlayers: min, maxPlayers: max, ...over });

test('no count picked lets every game through', () => {
  assert.equal(matchesPlayerFilter(box(3, 4), null), true);
  assert.equal(matchesPlayerFilter(box(3, 4), undefined), true);
});

test('a 1–4 game passes at 1 and 4 and fails at 5', () => {
  const g = box(1, 4);
  assert.equal(matchesPlayerFilter(g, 1), true);
  assert.equal(matchesPlayerFilter(g, 4), true);
  assert.equal(matchesPlayerFilter(g, 5), false);
});

test('a 2–4 base with an owned 1–1 expansion passes at 1, by union rather than hull', () => {
  const g = box(3, 4, { expansions: [{ title: 'Solo', minPlayers: 1, maxPlayers: 1 }] });
  assert.equal(matchesPlayerFilter(g, 1), true);
  assert.equal(matchesPlayerFilter(g, 2), false, 'a hull of 1–4 would wrongly admit 2');
});

test('a game with no player data stays in at every count', () => {
  const g = { title: 'Handgeschrieben' };
  PLAYER_FILTER_CHOICES.forEach((n) => assert.equal(matchesPlayerFilter(g, n), true, `at ${n}`));
});

test('8+ passes a 2–10 party game and fails a 2–6 box', () => {
  assert.equal(PLAYER_FILTER_TOP, 8);
  assert.equal(matchesPlayerFilter(box(2, 10), PLAYER_FILTER_TOP), true);
  assert.equal(matchesPlayerFilter(box(2, 6), PLAYER_FILTER_TOP), false);
  assert.equal(matchesPlayerFilter(box(8, 8), PLAYER_FILTER_TOP), true, 'exactly eight is 8+');
});

test('8+ is reached through an owned expansion too', () => {
  const g = box(2, 5, { expansions: [{ title: 'Big Box', minPlayers: 6, maxPlayers: 9 }] });
  assert.equal(matchesPlayerFilter(g, PLAYER_FILTER_TOP), true);
});

test('8+ passes an open-topped box (a minimum and no maximum)', () => {
  assert.equal(matchesPlayerFilter({ title: 'G', minPlayers: 3 }, PLAYER_FILTER_TOP), true);
});

test('fitsPlayerCountFrom probes from its start up, never below it', () => {
  assert.equal(fitsPlayerCountFrom(box(2, 4), 6), false);
  assert.equal(fitsPlayerCountFrom(box(2, 7), 6), true);
  assert.equal(fitsPlayerCountFrom(box(2, 4), 4), true);
});

test('the choices are 1…8, the last one meaning „8 or more"', () => {
  assert.deepEqual(PLAYER_FILTER_CHOICES, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(PLAYER_FILTER_CHOICES[PLAYER_FILTER_CHOICES.length - 1], PLAYER_FILTER_TOP);
});

// CodeRabbit on #1669: a probe that walks counts from `from` up to a cap missed
// both a box whose range starts above `from` with no maximum and one that lies
// entirely past the cap — and a box that fits 9 but not 8 is the case that
// separates "8 or more" from "exactly 8".
test('8+ keeps a box that starts above eight, open-topped or bounded', () => {
  assert.equal(matchesPlayerFilter({ title: 'G', minPlayers: 10 }, PLAYER_FILTER_TOP), true);
  assert.equal(matchesPlayerFilter(box(9, 12), PLAYER_FILTER_TOP), true, 'fits 9 but not 8');
  assert.equal(matchesPlayerFilter(box(100, 120), PLAYER_FILTER_TOP), true);
  assert.equal(matchesPlayerFilter(box(2, 4, {
    expansions: [{ title: 'Mega', minPlayers: 10, maxPlayers: 12 }],
  }), PLAYER_FILTER_TOP), true, 'through an expansion that starts past eight');
});

test('8+ still drops a half-declared expansion, per the union rule', () => {
  assert.equal(matchesPlayerFilter(box(2, 4, {
    expansions: [{ title: 'Halb', minPlayers: 10 }],
  }), PLAYER_FILTER_TOP), false);
});
