'use strict';

/* The Spielwirbel-Score (#893): a per-tile value curve applied to each vote
   BEFORE averaging, so a game one person really does not want to play stops
   outranking a game everybody is fine with.

   The calibration table below is the whole issue's acceptance evidence, and it
   is pinned row by row on purpose. The five values are expected to be retuned
   from real use — what must NOT move silently is the SHAPE: where the cliff
   sits, and the four anchors that make the number readable next to the raw
   mean everyone already knows. A retune that breaks an anchor is a different
   decision than a retune that shifts a magnitude, and only these rows can tell
   the two apart. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { TILE_VALUE, tileValue, scoreRatings, scoreTally } = require('../public/js/vote-score');

// Rounded the way every screen prints it (`fmtAvg` is one decimal), so a row
// asserts what a user actually reads rather than a float nobody sees.
const scoreOf = (ratings) => Number(scoreRatings(ratings).score.toFixed(1));

test('the curve is five integers with the cliff at the neutral face', () => {
  // Slot 0 is a `null` hole, not a tile: the array is indexed by the RATING, so
  // dropping the retirement rung (#909) had to leave the index alone or every
  // consumer — both backends, the SQL aggregate and six screens — would need
  // re-basing. `tileValue` and `scoreTally` skip it.
  assert.deepEqual(TILE_VALUE, [null, -3, 0, 3, 4, 5]);
  // The SHAPE (#1706): every step below „wäre okay" costs 3, every step above
  // it earns 1 — so the cliff sits at 3, the same line table-split.js's
  // VIOLATION_MAX = 2 draws when it counts a 1 and a 2 alike as unhappy.
  assert.equal(TILE_VALUE[3] - TILE_VALUE[2], 3, 'eher nicht -> wäre okay');
  assert.equal(TILE_VALUE[2] - TILE_VALUE[1], 3, 'gar nicht -> eher nicht');
  assert.equal(TILE_VALUE[4] - TILE_VALUE[3], 1, 'wäre okay -> gern');
  assert.equal(TILE_VALUE[5] - TILE_VALUE[4], 1, 'gern -> unbedingt');
  // Integers are load-bearing: scoreSplit compares sums lexicographically and
  // its determinism argument (table-split.js) rests on exact arithmetic.
  TILE_VALUE.slice(1).forEach((v) => assert.ok(Number.isInteger(v), `${v} is not an integer`));
  // Strictly increasing — `lowest` in scoreSplit stays the raw rating only
  // because the curve preserves order.
  for (let n = 2; n < TILE_VALUE.length; n++) assert.ok(TILE_VALUE[n] > TILE_VALUE[n - 1]);
});

test('f(3) = 3 and f(5) = 5 — both familiar anchors survive', () => {
  assert.equal(tileValue(3), 3);
  assert.equal(tileValue(5), 5);
});

test('tileValue rejects anything off the 1-5 scale', () => {
  // 0 belongs in this list since #909: it used to be the trash tile.
  [0, -1, 6, 2.5, NaN, null, undefined, '3'].forEach((bad) => {
    assert.equal(tileValue(bad), null, `${String(bad)} should not be a tile`);
  });
});

// ---- the calibration table (five voters) ----

const CALIBRATION = [
  { votes: [4, 3, 3, 3, 4], raw: 3.4, score: 3.4, why: 'nobody below 3 -> unchanged' },
  { votes: [5, 5, 5, 5, 5], raw: 5.0, score: 5.0, why: 'top anchor' },
  { votes: [3, 3, 3, 3, 3], raw: 3.0, score: 3.0, why: 'middle anchor' },
  { votes: [5, 5, 5, 5, 1], raw: 4.2, score: 3.4, why: 'four 5s now outweigh one 1' },
  { votes: [4, 4, 4, 4, 1], raw: 3.4, score: 2.6, why: '' },
  { votes: [5, 5, 4, 3, 1], raw: 3.6, score: 2.8, why: '' },
  { votes: [4, 4, 4, 2, 2], raw: 3.2, score: 2.4, why: 'two sad faces, no veto' },
  { votes: [2, 2, 2, 2, 2], raw: 2.0, score: 0.0, why: '' },
];

// ---- the four-player rows (#1706's acceptance table) ----

const FOUR_PLAYERS = [
  { votes: [5, 5, 5, 5], raw: 5.0, score: 5.0, why: 'top anchor' },
  { votes: [3, 3, 3, 3], raw: 3.0, score: 3.0, why: 'middle anchor' },
  { votes: [5, 5, 5, 1], raw: 4.0, score: 3.0, why: 'calibration anchor - ties all-3s' },
  { votes: [5, 5, 4, 1], raw: 3.8, score: 2.8, why: '' },
  { votes: [4, 4, 4, 1], raw: 3.3, score: 2.3, why: '' },
  { votes: [5, 5, 1, 1], raw: 3.0, score: 1.0, why: '' },
  { votes: [5, 5, 5, 2], raw: 4.3, score: 3.8, why: '' },
  { votes: [4, 4, 4, 2], raw: 3.5, score: 3.0, why: '' },
  { votes: [5, 5, 2, 2], raw: 3.5, score: 2.5, why: '' },
  { votes: [4, 4, 2, 2], raw: 3.0, score: 2.0, why: '' },
  { votes: [2, 2, 2, 2], raw: 2.0, score: 0.0, why: '' },
];

for (const row of [...CALIBRATION, ...FOUR_PLAYERS]) {
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
  // Both read O 3,8 as a raw mean, in the same size and the same colour, while
  // being completely different recommendations.
  const vetoed = [5, 5, 4, 4, 1];
  const content = [4, 4, 4, 4, 3];
  const mean = (xs) => Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1));
  assert.equal(mean(vetoed), mean(content), 'the raw means are indistinguishable');
  assert.ok(
    scoreRatings(vetoed).score < scoreRatings(content).score,
    'the vetoed game must rank below the one nobody objects to'
  );
});

test('three people at 5 exactly cancel one at 1', () => {
  // The single sentence carrying the whole value judgement. `f(1)` is the
  // number to move if a group disagrees; this is the assertion that says so.
  // In general f(1) = 3 - 2k for k fives cancelling one 1, and k = 3 (#1706).
  assert.equal(scoreRatings([5, 5, 5, 1]).score, scoreRatings([3, 3, 3, 3]).score);
});

test('one 1 weighs exactly two 2s against the neutral face', () => {
  // The shape as an equation: each step below „wäre okay" costs the same.
  assert.equal(scoreRatings([1, 3]).score, scoreRatings([2, 2]).score);
  assert.equal(TILE_VALUE[1] - TILE_VALUE[3], 2 * (TILE_VALUE[2] - TILE_VALUE[3]));
});

/* Tonight's decision between two games, four players each (#1706). The last two
   rows are the intended crossover: two „eher nicht" now lose to one „gar nicht"
   when the „gar nicht" game carries more enthusiasm, because they weigh the same. */
const HEAD_TO_HEAD = [
  { a: [5, 5, 5, 1], b: [3, 3, 3, 3], winner: 'tie' },
  { a: [5, 5, 4, 1], b: [4, 4, 3, 3], winner: 'b' },
  { a: [4, 4, 4, 2], b: [5, 5, 4, 1], winner: 'a' },
  { a: [5, 5, 2, 2], b: [5, 5, 5, 1], winner: 'b' },
  { a: [4, 4, 2, 2], b: [5, 5, 4, 1], winner: 'b' },
];

for (const row of HEAD_TO_HEAD) {
  test(`{${row.a.join(',')}} against {${row.b.join(',')}}: ${row.winner}`, () => {
    const a = scoreRatings(row.a).score;
    const b = scoreRatings(row.b).score;
    const got = a === b ? 'tie' : a > b ? 'a' : 'b';
    assert.equal(got, row.winner, `${a} vs ${b}`);
  });
}

// ---- the reason line's inputs ----

test('scoreRatings reports the low and the vetoes', () => {
  const s = scoreRatings([5, 5, 4, 1, 1]);
  assert.equal(s.low, 1, 'lowest raw rating');
  assert.equal(s.vetoes, 2, 'ratings of exactly 1');
  assert.equal(s.count, 5);
  // The counter it had beside `vetoes` until #909 is gone with the tile that
  // fed it — asserted so a revived `retires` cannot slip back in unnoticed.
  assert.equal('retires' in s, false);
});

test('a 0 is not a vote at all any more', () => {
  // It was the trash tile until #909. Nothing writes one now, and the migration
  // rewrote the ones that existed — so if one ever turns up it must be skipped
  // like any other off-scale value, not counted as a very bad rating.
  const s = scoreRatings([5, 0, 5]);
  assert.equal(s.count, 2);
  assert.equal(s.score, 5);
  assert.equal(scoreRatings([0, 0]), null);
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
  // veto holds at four voters or fewer and starts losing at five (#1706; it was
  // five and six under the old curve).
  const allThrees = 3;
  const withVeto = (n) => scoreRatings([...Array(n - 1).fill(5), 1]).score;
  assert.ok(withVeto(4) <= allThrees, 'at four voters the veto still holds');
  assert.ok(withVeto(5) > allThrees, 'at five voters it starts losing');
});

/* ---- the histogram shape (#914) -------------------------------------------- */

/* `scoreTally` exists because the cross-tenant Discover aggregate is SQL and
   cannot require this file — so the aggregate reports which TILE each vote
   landed on and the curve is applied here. `scoreRatings` is expressed through
   it, and this is the assertion that they are genuinely one implementation
   rather than two that happen to agree on the cases someone thought of. */
test('scoreTally and scoreRatings are the same function over two input shapes', () => {
  const cases = [[5, 5, 1], [3, 3, 3], [4], [2], [5, 4, 3, 2, 1]];
  for (const list of cases) {
    const tiles = [0, 0, 0, 0, 0, 0];
    list.forEach((r) => { tiles[r] += 1; });
    assert.deepEqual(scoreTally(tiles), scoreRatings(list), `disagreed on [${list}]`);
  }
});

test('an empty histogram scores null, like an empty list', () => {
  assert.equal(scoreTally([0, 0, 0, 0, 0, 0]), null);
  assert.equal(scoreTally([]), null);
  assert.equal(scoreTally(null), null);
});

test('a malformed bucket is treated as empty, never trusted into the divisor', () => {
  /* `count` is a divisor, so a stray value would publish NaN on the logged-out
     landing page rather than throw anywhere. The realistic source is a dropped
     ::int cast on one of the six SQL counters, which hands back a STRING —
     test/support/repo-contract.js guards that end, this one guards what happens
     if it ever gets through. */
  const s = scoreTally([0, 0, 0, '2', 1.5, 2]);
  assert.equal(s.count, 2, 'only the well-formed bucket counted');
  assert.equal(s.score, 5);
  assert.equal(s.low, 5, 'low is the lowest bucket that actually has votes in it');
  assert.equal(scoreTally([0, 0, 0, '3', -1, 0]), null, 'nothing well-formed at all');
  // Bucket 0 is not a tile, so a count sitting in it is ignored outright rather
  // than divided into the score — the histogram's half of #909's `null` hole.
  assert.equal(scoreTally([7, 0, 0, 0, 0, 0]), null, 'bucket 0 alone is nothing');
});

/* -------------------------------------------------------- #894 / #928 / #1721 --
   Shelf scope: how much of its own score a game has actually earned.

   Since #1721 the unit of evidence is an EVENING: each session that rated the
   game contributes its own score, each play a pick worth PICK_VALUE (5, the top
   of the scale — operator, 2026-10-24; #1721 proposed 4,5), and the fixed prior
   weighs one evening. The worked rows are #1721's acceptance table re-derived
   at a pick of 5 (four voters unless stated, under #1706's curve), pinned row
   by row for the reason the curve's are: `PRIOR_EVENINGS` and `PICK_VALUE` are
   starting values, and only a row tells a retune that shifts a magnitude apart
   from one that breaks a property (the null contract, plays only raising, the
   fixed prior, group-size neutrality). */

const {
  SHRINK_M, PRIOR_DEFAULT, PRIOR_EVENINGS, PICK_VALUE,
  shrinkScore, eveningEvidence, shelfScore, playCounts,
} = require('../public/js/vote-score');

// Exact, then rounded at the call site the way each row states it.
const shelfExact = (evenings, plays) => {
  const e = eveningEvidence(evenings.map((r) => scoreRatings(r)));
  return shelfScore(e.sum, e.evenings, plays);
};
const r2 = (x) => (x === null ? null : Number(x.toFixed(2)));
const r3 = (x) => (x === null ? null : Number(x.toFixed(3)));
const times = (n, votes) => Array.from({ length: n }, () => votes);
const FIVES = [5, 5, 5, 5];

const WORKED = [
  { history: 'A · unrated, 1 play', evenings: [], plays: 1, score: 4.0 },
  { history: 'B · 5-5-4-1 chosen + 4 picks', evenings: [[5, 5, 4, 1]], plays: 5, score: 4.39 },
  { history: '3-3-3-3 chosen once', evenings: [[3, 3, 3, 3]], plays: 1, score: 3.67 },
  { history: '5-5-5-5 chosen once', evenings: [FIVES], plays: 1, score: 4.33 },
  { history: '5-5-5-5 drawn once, lost', evenings: [FIVES], plays: 0, score: 4.0 },
  { history: '5-5-5-5 chosen twice', evenings: times(2, FIVES), plays: 2, score: 4.6 },
  { history: '6×5 (six voters) chosen once', evenings: [[5, 5, 5, 5, 5, 5]], plays: 1, score: 4.33 },
  { history: 'unrated, 3 plays', evenings: [], plays: 3, score: 4.5 },
  { history: 'unrated, 12 plays', evenings: [], plays: 12, score: 4.85 },
  { history: '5-5-4-4 chosen + 5 picks', evenings: [[5, 5, 4, 4]], plays: 6, score: 4.69 },
  { history: '4-4-3-3 drawn 3×, never chosen', evenings: times(3, [4, 4, 3, 3]), plays: 0, score: 3.38 },
  { history: '5-5-1-1 drawn once, lost', evenings: [[5, 5, 1, 1]], plays: 0, score: 2.0 },
  { history: '1-1-1-1 once, then 12 picks', evenings: [[1, 1, 1, 1]], plays: 12, score: 4.29 },
];

for (const row of WORKED) {
  test(`#1721 worked row: ${row.history} -> ${row.score}`, () => {
    assert.equal(r2(shelfExact(row.evenings, row.plays)), row.score);
  });
}

test('#1721 worked rows at three decimals: the top of the shelf, and one more pick', () => {
  // Listed apart because the issue states them to three places: the difference
  // between them is the one-directionality, and two decimals would hide it.
  assert.equal(r3(shelfExact(times(10, FIVES), 10)), 4.905);
  assert.equal(r3(shelfExact(times(10, FIVES), 11)), 4.909, 'one more direct pick rises');
});

test('#1721 B beats A: a rated, often-picked game outranks one played once and never rated', () => {
  // The operator's example, and the defect: under the vote unit A read 3,67
  // and B 3,34, and no play dial could flip them. (4,0 against 4,39 now.)
  assert.ok(shelfExact([[5, 5, 4, 1]], 5) > shelfExact([], 1));
});

test('#1721 plays only RAISE — including for a game everybody rated 5', () => {
  /* Holds because the pick is the TOP of the scale: no evening scores above 5,
     so every input to the weighted mean is at most the pick and adding one
     cannot lower it. A pick below 5 breaks this for every game rated above it
     ({5,5,5,5} ×10 chosen fell from 4,667 to 4,659 after one more pick at a
     fixed 4,5) — so the next assertion pins the value, and lowering it means
     restoring max(PICK_VALUE, own mean) first. */
  assert.equal(PICK_VALUE, 5, 'a pick below the top of the scale needs the max() back');
  const histories = [[], [[1, 1, 1, 1]], [[3, 3, 3, 3]], [[5, 5, 4, 1]], [FIVES], times(3, FIVES),
    [[5, 5, 5, 4]], [[5, 5]], times(10, FIVES)];
  let checked = 0;
  histories.forEach((evenings) => {
    let prev = null;
    for (let plays = 0; plays <= 30; plays++) {
      const cur = shelfExact(evenings, plays);
      if (cur === null) { assert.equal(plays, 0, 'only the no-evidence case is null'); continue; }
      if (prev !== null) {
        assert.ok(cur >= prev, `${JSON.stringify(evenings)}: ${plays} plays scored ${cur} < ${prev}`);
        checked += 1;
      }
      prev = cur;
    }
  });
  assert.ok(checked > 200, `only ${checked} steps compared`);
});

test('#1721 chosen never scores below the same votes lost', () => {
  for (const n of [1, 2, 10]) {
    assert.ok(shelfExact(times(n, FIVES), n) > shelfExact(times(n, FIVES), 0), `×${n}`);
  }
});

test('#1721 group size is neutral: four 5s and six 5s are the same evening', () => {
  assert.equal(shelfExact([FIVES], 1), shelfExact([[5, 5, 5, 5, 5, 5]], 1));
  assert.equal(shelfExact([[3, 4]], 0), shelfExact([[3, 4, 3, 4, 3, 4]], 0));
});

test('#1721 confined change: an all-voted, never-chosen four-voter history is the old number', () => {
  /* Four votes were one evening's weight under the old vote unit too
     ((n·score + 4·3) / (n + 4) with n = 4 per evening), so a round that always
     votes with four people and never chose the game reads EXACTLY what it did.
     Computed here from the old formula itself rather than from a remembered
     figure, so the row cannot agree with the new code by construction. */
  const old = (evenings) => {
    const all = evenings.flat();
    return (all.length * scoreRatings(all).score + 4 * 3) / (all.length + 4);
  };
  for (const evenings of [[[4, 4, 3, 3]], times(3, [4, 4, 3, 3]), [[5, 5, 1, 1], [2, 3, 4, 5]], [FIVES]]) {
    assert.equal(r3(shelfExact(evenings, 0)), r3(old(evenings)), JSON.stringify(evenings));
  }
});

test('#1721 unrated games rise with every play and never reach the pick value', () => {
  let prev = shelfScore(0, 0, 1);
  for (let plays = 2; plays <= 200; plays++) {
    const cur = shelfScore(0, 0, plays);
    assert.ok(cur > prev, `${plays} plays did not rise`);
    assert.ok(cur < PICK_VALUE, `${plays} plays reached ${cur}`);
    prev = cur;
  }
});

test('#894 no evidence at all means NO NUMBER — never rated and never played', () => {
  assert.equal(shelfScore(0, 0, 0), null);
  assert.equal(shelfScore(null, 0, 0), null);
  // One rated evening or one play is enough for a number.
  assert.notEqual(shelfScore(5, 1, 0), null);
  assert.notEqual(shelfScore(0, 0, 1), null);
  [-3, null, undefined, NaN].forEach((bad) => assert.equal(shelfScore(0, 0, bad), null, String(bad)));
});

test('#1721 eveningEvidence counts a session only when it rated the game', () => {
  const e = eveningEvidence([scoreRatings([5, 5]), scoreRatings([]), null, scoreRatings([1])]);
  assert.deepEqual(e, { sum: 5 + -3, evenings: 2 });
  assert.deepEqual(eveningEvidence(undefined), { sum: 0, evenings: 0 });
});

/* THE COMPARABILITY CRITERION (#928). The whole defect was that the same votes
   on the same game printed a different number in every round, while five
   surfaces — the Regal pill, the detail ring, the Pokale, the Chronik and the
   share text sent OUTSIDE the round — all called it „Spielwirbel-Score".

   Asserted as ARITY rather than as an equality between two rounds, because an
   equality is satisfied by a shelf-relative implementation that happens to be
   handed two identical shelves. `shelfScore.length === 3` fails the moment a
   prior parameter comes back, which is the only way the round could get a say
   again. */
test('#928 the shelf score cannot be handed a prior at all', () => {
  assert.equal(shelfScore.length, 3, 'evening sum, rated evenings, plays — and nothing about the shelf');
  // The fixed prior is the neutral tile's own value, so „wir wissen es noch
  // nicht" and „keiner hat was dagegen" stay literally the same number.
  assert.equal(PRIOR_DEFAULT, 3);
  assert.equal(PRIOR_EVENINGS, 1);
});

test('#894 shrinking a score that already equals the prior is a no-op', () => {
  // shrinkScore is the RECOMMENDER's per-vote shrink since #1721.
  [1, 3, 10, 40].forEach((n) => assert.equal(shrinkScore(3, n, 3), 3, `n=${n}`));
  assert.equal(shrinkScore(4.25, 7, 4.25), 4.25);
});

test('#894 playCounts: a play is a non-cancelled session with a chosen game', () => {
  const counts = playCounts({
    sessions: [
      { chosenGameId: 'g1' },                      // drawn and chosen
      { chosenGameId: 'g1', finished: true },      // finished counts the same
      { chosenGameId: 'g2', cancelled: true },     // cancelled does not
      { chosenGameId: null },                      // an abandoned draw does not
      {},                                          // nor a session that chose nothing
      { chosenGameId: 'g3' },                      // a direct pick counts like a draw
    ],
  });
  assert.equal(counts.get('g1'), 2);
  assert.equal(counts.get('g2'), undefined);
  assert.equal(counts.get('g3'), 1);
  assert.equal(playCounts({}).size, 0);
});

test('#894 a split evening counts once PER TABLE', () => {
  // Each child carries its own chosenGameId; the parent carries none, so it is
  // skipped without needing a split-specific branch.
  const counts = playCounts({
    sessions: [
      { id: 'p', childSessionIds: ['a', 'b'] },
      { id: 'a', parentSessionId: 'p', chosenGameId: 'g1' },
      { id: 'b', parentSessionId: 'p', chosenGameId: 'g2' },
    ],
  });
  assert.equal(counts.get('g1'), 1);
  assert.equal(counts.get('g2'), 1);
  assert.equal(counts.size, 2, 'the parent contributes no play of its own');
});

test('#894 SHRINK_M is about one table of votes', () => {
  assert.equal(SHRINK_M, 4);
  // The anchor worth stating: at n = m a game sits exactly halfway between its
  // own score and the prior, so "one evening of ratings buys half your say".
  assert.equal(shrinkScore(5, SHRINK_M, 3), 4);
});
