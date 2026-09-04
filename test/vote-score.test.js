'use strict';

/* The Spielwirbel-Score (#893): a per-tile value curve applied to each vote
   BEFORE averaging, so a game one person really does not want to play stops
   outranking a game everybody is fine with.

   The calibration table below is the whole issue's acceptance evidence, and it
   is pinned row by row on purpose. The six values are expected to be retuned
   from real use — what must NOT move silently is the SHAPE: where the cliff
   sits, and the three anchors that make the number readable next to the raw
   mean everyone already knows. A retune that breaks an anchor is a different
   decision than a retune that shifts a magnitude, and only these rows can tell
   the two apart. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { TILE_VALUE, tileValue, scoreRatings } = require('../public/js/vote-score');

// Rounded the way every screen prints it (`fmtAvg` is one decimal), so a row
// asserts what a user actually reads rather than a float nobody sees.
const scoreOf = (ratings) => Number(scoreRatings(ratings).score.toFixed(1));

test('the curve is six integers with the cliff between 1 and 2', () => {
  assert.deepEqual(TILE_VALUE, [-6, -5, 1, 3, 4, 5]);
  // Integers are load-bearing: scoreSplit compares sums lexicographically and
  // its determinism argument (table-split.js) rests on exact arithmetic.
  TILE_VALUE.forEach((v) => assert.ok(Number.isInteger(v), `${v} is not an integer`));
  // Strictly increasing — `lowest` in scoreSplit stays the raw rating only
  // because the curve preserves order.
  for (let n = 1; n < TILE_VALUE.length; n++) assert.ok(TILE_VALUE[n] > TILE_VALUE[n - 1]);
});

test('f(3) = 3 and f(5) = 5 — both familiar anchors survive', () => {
  assert.equal(tileValue(3), 3);
  assert.equal(tileValue(5), 5);
});

test('tileValue rejects anything off the 0-5 scale', () => {
  [-1, 6, 2.5, NaN, null, undefined, '3'].forEach((bad) => {
    assert.equal(tileValue(bad), null, `${String(bad)} should not be a tile`);
  });
});

// ---- the calibration table (five voters) ----

const CALIBRATION = [
  { votes: [4, 3, 3, 3, 4], raw: 3.4, score: 3.4, why: 'nobody below 3 -> unchanged' },
  { votes: [5, 5, 5, 5, 5], raw: 5.0, score: 5.0, why: 'top anchor' },
  { votes: [3, 3, 3, 3, 3], raw: 3.0, score: 3.0, why: 'middle anchor' },
  { votes: [5, 5, 5, 5, 1], raw: 4.2, score: 3.0, why: 'calibration anchor - ties all-3s' },
  { votes: [4, 4, 4, 4, 1], raw: 3.4, score: 2.2, why: '' },
  { votes: [5, 5, 4, 3, 1], raw: 3.6, score: 2.4, why: '' },
  { votes: [5, 5, 4, 3, 0], raw: 3.4, score: 2.2, why: '' },
  { votes: [4, 4, 4, 2, 2], raw: 3.2, score: 2.8, why: 'two sad faces, no veto' },
  { votes: [2, 2, 2, 2, 2], raw: 2.0, score: 1.0, why: '' },
];

for (const row of CALIBRATION) {
  const label = `{${row.votes.join(',')}} scores ${row.score}${row.why ? ` (${row.why})` : ''}`;
  test(label, () => {
    // The raw mean is asserted too: it is what the row is a claim ABOUT, and a
    // typo there would otherwise make a passing row prove nothing.
    const raw = row.votes.reduce((a, b) => a + b, 0) / row.votes.length;
    assert.equal(Number(raw.toFixed(1)), row.raw, 'raw mean of the fixture');
    assert.equal(scoreOf(row.votes), row.score);
  });
}

test('a game nobody rated below 3 scores exactly its raw average', () => {
  // Property form of the first row: the score only ever diverges from the
  // familiar number when there is something to say.
  const cases = [[3], [5, 3], [4, 4, 3, 5], [3, 3, 4, 5, 5, 4], [5, 5, 5, 4, 4, 3, 3]];
  for (const votes of cases) {
    const raw = votes.reduce((a, b) => a + b, 0) / votes.length;
    assert.equal(scoreRatings(votes).score, raw, `{${votes.join(',')}}`);
  }
});

test('the ordering flip that motivates the issue', () => {
  // Both read O 3,4 today, in the same size and the same colour, while being
  // completely different recommendations.
  const vetoed = [5, 5, 4, 3, 0];
  const content = [4, 3, 3, 3, 4];
  const mean = (xs) => Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1));
  assert.equal(mean(vetoed), mean(content), 'the raw means are indistinguishable');
  assert.ok(
    scoreRatings(vetoed).score < scoreRatings(content).score,
    'the vetoed game must rank below the one nobody objects to'
  );
});

test('four people at 5 exactly cancel one at 1', () => {
  // The single sentence carrying the whole value judgement. `f(1)` is the
  // number to move if the family disagrees; this is the assertion that says so.
  assert.equal(scoreRatings([5, 5, 5, 5, 1]).score, scoreRatings([3, 3, 3, 3, 3]).score);
});

// ---- the reason line's inputs ----

test('scoreRatings reports the low, the vetoes and the retires', () => {
  const s = scoreRatings([5, 5, 4, 1, 1, 0]);
  assert.equal(s.low, 0, 'lowest raw rating');
  assert.equal(s.vetoes, 2, 'ratings of exactly 1');
  assert.equal(s.retires, 1, 'ratings of exactly 0');
  assert.equal(s.count, 6);
});

test('vetoes and retires are counted separately, never merged', () => {
  // They phrase two different reason lines ("1x gar nicht" vs "1x aussortieren")
  // and the trash tile is members-only, so conflating them would put a control
  // a guest never sees into a guest's mouth.
  assert.deepEqual(pick(scoreRatings([1, 1, 1])), { vetoes: 3, retires: 0 });
  assert.deepEqual(pick(scoreRatings([0, 0])), { vetoes: 0, retires: 2 });
  function pick(s) { return { vetoes: s.vetoes, retires: s.retires }; }
});

test('an empty list scores null, matching avg === null today', () => {
  assert.equal(scoreRatings([]), null);
  assert.equal(scoreRatings(null), null);
  assert.equal(scoreRatings(undefined), null);
});

test('a rating off the scale is ignored rather than poisoning the score', () => {
  // Nothing should ever store one, but `avg` today would silently produce NaN
  // and paint every pill on the screen with it.
  const s = scoreRatings([3, 3, 'x', null, 9, 3]);
  assert.equal(s.score, 3);
  assert.equal(s.count, 3);
});

test('the veto scales with group size, by construction', () => {
  // Documented behaviour, not a defect: one crying face is 25% of a four-person
  // vote and 10% of a ten-person one. Against a clean all-3s alternative the
  // veto wins at five voters or fewer and starts losing at six.
  const allThrees = 3;
  const withVeto = (n) => scoreRatings([...Array(n - 1).fill(5), 1]).score;
  assert.ok(withVeto(5) <= allThrees, 'at five voters the veto still wins');
  assert.ok(withVeto(6) > allThrees, 'at six voters it starts losing');
});
