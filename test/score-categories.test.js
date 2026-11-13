'use strict';

/*
 * Scoring categories (#1780), the pure half in public/js/point-records.js:
 *  - mergeScoreCategories: the editor's list into the stored one — ids kept on a
 *    rename, a removed category kept (as `removed`) only while a session holds
 *    values for it, a re-added name revives its id, the bounds;
 *  - parseScoreParts: a breakdown must name known categories and add up to the
 *    seat's total;
 *  - seatScoreParts / consistentScoreParts: a breakdown that no longer adds up
 *    reads as absent;
 *  - gameCategoryRecords / memberCategoryBests: per-category records and bests,
 *    both directions, members only for a best.
 * The routes are test/score-categories-routes.test.js, the screens
 * test/score-categories-view.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SCORE_CATEGORY_MAX, SCORE_CATEGORY_NAME_MAX, mergeScoreCategories, parseScoreParts,
  consistentScoreParts, seatScoreParts, activeScoreCategories, gameCategoryRecords, memberCategoryBests,
} = require('../public/js/point-records');
const { sessionPartyGroups } = require('../public/js/session-people');
const { sortSessionsByDate } = require('../public/js/session-order');

const deps = { sessionPartyGroups, sortSessionsByDate };
let n = 0;
const mintId = () => `c${++n}`;
const merge = (stored, incoming, used = []) => mergeScoreCategories(stored, incoming, { mintId, usedIds: new Set(used) });

test('a new list mints ids in order; a rename keeps the id; a reorder is the new order', () => {
  n = 0;
  const first = merge(undefined, [{ name: ' Vögel ' }, { name: 'Eier' }]);
  assert.deepEqual(first.list, [{ id: 'c1', name: 'Vögel' }, { id: 'c2', name: 'Eier' }]);
  const second = merge(first.list, [{ id: 'c2', name: 'Eier gelegt' }, { id: 'c1', name: 'Vögel' }]);
  assert.deepEqual(second.list, [{ id: 'c2', name: 'Eier gelegt' }, { id: 'c1', name: 'Vögel' }]);
});

test('a removed category stays (as removed) only while a session holds values for it', () => {
  const stored = [{ id: 'a', name: 'Vögel' }, { id: 'b', name: 'Eier' }, { id: 'c', name: 'Boni' }];
  const { list } = merge(stored, [{ id: 'a', name: 'Vögel' }], ['b']);
  assert.deepEqual(list, [{ id: 'a', name: 'Vögel' }, { id: 'b', name: 'Eier', removed: true }]);
  assert.deepEqual(activeScoreCategories({ scoreCategories: list }).map((c) => c.id), ['a']);
  // Clearing everything leaves only the used one, removed.
  assert.deepEqual(merge(stored, [], ['b']).list, [{ id: 'b', name: 'Eier', removed: true }]);
  assert.deepEqual(merge(stored, []).list, []);
});

test('re-adding a removed name revives its id, and with it its history', () => {
  const stored = [{ id: 'a', name: 'Vögel' }, { id: 'b', name: 'Eier', removed: true }];
  const { list } = merge(stored, [{ id: 'a', name: 'Vögel' }, { name: 'eier' }], ['b']);
  assert.deepEqual(list, [{ id: 'a', name: 'Vögel' }, { id: 'b', name: 'eier' }]);
});

test('the bounds: count, name length, blanks, duplicates, unknown ids', () => {
  const many = Array.from({ length: SCORE_CATEGORY_MAX + 1 }, (_, i) => ({ name: `K${i}` }));
  assert.ok(merge([], many).error, 'more than the cap');
  assert.ok(!merge([], many.slice(0, SCORE_CATEGORY_MAX)).error, 'exactly the cap');
  assert.ok(merge([], [{ name: 'x'.repeat(SCORE_CATEGORY_NAME_MAX + 1) }]).error);
  assert.ok(!merge([], [{ name: 'x'.repeat(SCORE_CATEGORY_NAME_MAX) }]).error);
  assert.ok(merge([], [{ name: '   ' }]).error);
  assert.ok(merge([], [{ name: 'Eier' }, { name: 'EIER' }]).error, 'case-insensitive duplicate');
  assert.ok(merge([{ id: 'a', name: 'A' }], [{ id: 'zz', name: 'B' }]).error, 'an id the game does not have');
  assert.ok(merge([{ id: 'a', name: 'A' }], [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }]).error, 'one id twice');
  assert.ok(merge([], 'Vögel').error);
  assert.ok(merge([], [null]).error);
});

const game = { id: 'g1', scoreCategories: [{ id: 'a', name: 'Vögel' }, { id: 'b', name: 'Eier' }, { id: 'old', name: 'Alt', removed: true }] };

test('parseScoreParts: known categories that add up to the total, nothing else', () => {
  const scores = { m1: 30, m2: 5 };
  assert.deepEqual(parseScoreParts({ m1: { a: 20, b: 10 }, m2: {} }, scores, game), { m1: { a: 20, b: 10 } },
    'an empty seat is dropped');
  assert.deepEqual(parseScoreParts({ m2: { old: 7, b: -2 } }, scores, game), { m2: { old: 7, b: -2 } },
    'a removed category still holds an old session’s value; negatives add up');
  assert.deepEqual(parseScoreParts(undefined, scores, game), {});
  assert.equal(parseScoreParts({ m1: { a: 20, b: 9 } }, scores, game), null, 'does not add up');
  assert.equal(parseScoreParts({ m1: { a: 20, zz: 10 } }, scores, game), null, 'unknown category');
  assert.equal(parseScoreParts({ m3: { a: 1 } }, scores, game), null, 'a seat without a total');
  assert.equal(parseScoreParts({ m1: { a: 29.5, b: 0.5 } }, scores, game), null, 'not whole numbers');
  assert.equal(parseScoreParts({ m1: [20, 10] }, scores, game), null);
  assert.equal(parseScoreParts([], scores, game), null);
  assert.equal(parseScoreParts(JSON.parse('{"__proto__":{"a":1}}'), scores, game), null, 'an own __proto__ seat is refused');
});

test('a breakdown that no longer adds up reads as absent, and is dropped on a re-save', () => {
  const s = { scores: { m1: 31, m2: 5 }, scoreParts: { m1: { a: 20, b: 10 }, m2: { a: 5 } } };
  assert.equal(seatScoreParts(s, 'm1'), null, 'the total moved on without the parts');
  assert.deepEqual(seatScoreParts(s, 'm2'), { a: 5 });
  assert.deepEqual(consistentScoreParts(s.scoreParts, s.scores), { m2: { a: 5 } });
  assert.deepEqual(consistentScoreParts(s.scoreParts, { m1: 30 }), { m1: { a: 20, b: 10 } });
});

// Two plays of g1: Anna's Vögel 40 then 48, Ben's 50 once; Ben's Eier best.
const play = (id, createdAt, scores, scoreParts, extra = {}) => ({
  id, createdAt, finishedAt: createdAt, finished: true, cancelled: false, chosenGameId: 'g1',
  gameIds: ['g1'], memberIds: ['m1', 'm2', 'm3'], winnerIds: [], scores, scoreParts, ...extra,
});
const round = (sessions, g = game) => ({
  id: 'r1', members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }],
  games: [g], sessions,
});

test('per-category records follow the game’s direction; removed categories are not shown', () => {
  const r = round([
    play('s1', '2026-03-01T19:00:00Z', { m1: 50, m2: 58 }, { m1: { a: 40, b: 10 }, m2: { a: 50, b: 8 } }),
    play('s2', '2026-03-08T19:00:00Z', { m1: 54, m2: 59 }, { m1: { a: 48, b: 6 }, m2: { a: 40, b: 12, old: 7 } }),
    // Clara's parts do not add up, so they are not read at all.
    play('s3', '2026-03-09T19:00:00Z', { m3: 99 }, { m3: { a: 90, b: 90 } }),
  ]);
  const high = gameCategoryRecords(r, game, deps).map((e) => [e.category.id, e.record.points, e.record.party.id, e.record.session.id]);
  assert.deepEqual(high, [['a', 50, 'm2', 's1'], ['b', 12, 'm2', 's2']]);
  const low = gameCategoryRecords(r, { ...game, lowScoreWins: true }, deps).map((e) => [e.category.id, e.record.points, e.record.party.id]);
  assert.deepEqual(low, [['a', 40, 'm1'], ['b', 6, 'm1']], '„Niedrigere Punktzahl gewinnt" applies per category');
});

test('per-category bests are a member’s own, never a team’s, in the round’s order', () => {
  const r = round([
    play('s1', '2026-03-01T19:00:00Z', { m1: 50 }, { m1: { a: 40, b: 10 } }),
    play('s2', '2026-03-08T19:00:00Z', { m1: 54 }, { m1: { a: 48, b: 6 } }),
    play('s3', '2026-03-09T19:00:00Z', { t1: 200 }, { t1: { a: 150, b: 50 } }, { teams: [{ id: 't1', personIds: ['m1', 'm2'] }] }),
  ]);
  const anna = memberCategoryBests(r, 'm1', deps);
  assert.equal(anna.length, 1);
  assert.deepEqual(anna[0].categories.map((c) => [c.category.name, c.points, c.session.id]),
    [['Vögel', 48, 's2'], ['Eier', 10, 's1']]);
  assert.deepEqual(memberCategoryBests(r, 'm2', deps), [], 'a team score is nobody’s best');
  assert.deepEqual(memberCategoryBests(round([play('s1', '2026-03-01T19:00:00Z', { m1: 3 }, undefined)]), 'm1', deps), [],
    'a session from before categories has no breakdown to read');
});
