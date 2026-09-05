'use strict';

/* The Spielwirbel-Score (#893): a per-tile value curve applied to each vote
   BEFORE averaging, so a game one person really does not want to play stops
   outranking a game everybody is fine with.

   The calibration table below is the whole issue's acceptance evidence, and it
   is pinned row by row on purpose. The five values are expected to be retuned
   from real use — what must NOT move silently is the SHAPE: where the cliff
   sits, and the three anchors that make the number readable next to the raw
   mean everyone already knows. A retune that breaks an anchor is a different
   decision than a retune that shifts a magnitude, and only these rows can tell
   the two apart. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { TILE_VALUE, tileValue, scoreRatings, scoreTally } = require('../public/js/vote-score');

// Rounded the way every screen prints it (`fmtAvg` is one decimal), so a row
// asserts what a user actually reads rather than a float nobody sees.
const scoreOf = (ratings) => Number(scoreRatings(ratings).score.toFixed(1));

test('the curve is five integers with the cliff between 1 and 2', () => {
  // Slot 0 is a `null` hole, not a tile: the array is indexed by the RATING, so
  // dropping the retirement rung (#909) had to leave the index alone or every
  // consumer — both backends, the SQL aggregate and six screens — would need
  // re-basing. `tileValue` and `scoreTally` skip it.
  assert.deepEqual(TILE_VALUE, [null, -5, 1, 3, 4, 5]);
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
  { votes: [5, 5, 5, 5, 1], raw: 4.2, score: 3.0, why: 'calibration anchor - ties all-3s' },
  { votes: [4, 4, 4, 4, 1], raw: 3.4, score: 2.2, why: '' },
  { votes: [5, 5, 4, 3, 1], raw: 3.6, score: 2.4, why: '' },
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

test('four people at 5 exactly cancel one at 1', () => {
  // The single sentence carrying the whole value judgement. `f(1)` is the
  // number to move if the family disagrees; this is the assertion that says so.
  assert.equal(scoreRatings([5, 5, 5, 5, 1]).score, scoreRatings([3, 3, 3, 3, 3]).score);
});

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
  // veto wins at five voters or fewer and starts losing at six.
  const allThrees = 3;
  const withVeto = (n) => scoreRatings([...Array(n - 1).fill(5), 1]).score;
  assert.ok(withVeto(5) <= allThrees, 'at five voters the veto still wins');
  assert.ok(withVeto(6) > allThrees, 'at six voters it starts losing');
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

/* ------------------------------------------------------------- #894 / #928 --
   Shelf scope: how much of its own score a game has actually earned.

   The worked rows below are the two issues' acceptance evidence and are pinned
   one by one for the same reason the curve's are: `SHRINK_M`, `PRIOR_DEFAULT`,
   `PLAY_LIFT` and `PLAY_HALF` are starting values expected to be retuned, and
   only a row can tell a retune that shifts a magnitude apart from one that
   breaks a property (the null contract, the one-directionality of plays, the
   fixedness of the prior). */

const {
  SHRINK_M, PRIOR_DEFAULT, PLAY_LIFT,
  playCredit, gamePrior, shrinkScore, shelfScore, playCounts,
} = require('../public/js/vote-score');

// One decimal, the way fmtAvg prints it — a row asserts what a user reads.
const d1 = (x) => (x === null ? null : Number(x.toFixed(1)));
const shelf = (ratings, plays) => {
  const sc = scoreRatings(ratings);
  return d1(shelfScore(sc ? sc.score : null, ratings.length, plays));
};

test('#894 the worked rows: shrinkage alone, no plays', () => {
  // {5,5,5} played once — the game this issue exists to stop crowning.
  assert.equal(shelf([5, 5, 5], 0), 3.9);
  // A staple with deep data barely moves.
  assert.equal(d1(shrinkScore(4.3, 40, PRIOR_DEFAULT)), 4.2);
  // The accepted interaction: a lone veto on thin data is softened, on purpose.
  assert.equal(shelf([5, 5, 1], 0), 2.4);
});

test('#894 the worked rows: plays lift the prior a game is shrunk toward', () => {
  assert.equal(shelf([5, 5, 5], 1), 4.2);
  assert.equal(d1(shelfScore(4.3, 40, 10)), 4.3);
  assert.equal(shelf([5, 5, 1], 1), 2.8);
  // The direct-pick round: never rated, played four times. Before #894 it was
  // unrankable; the lift is what gives it a number at all.
  assert.equal(shelf([], 4), 4.3);
});

/* #928's own acceptance table, row by row. The two field cards are the ones the
   issue was reported from: both read 2,7 under the shelf-relative prior, both
   with no vote below 3 at all, so their score IS their average and every point
   of the gap was shrinkage toward a prior that had collapsed to ≈ 0,4. */
test('#928 the worked rows: the field cards read at or above their own average', () => {
  // Castle Combo — Ø 3,83 over six ratings, played twice.
  assert.equal(d1(shelfScore(23 / 6, 6, 2)), 3.9);
  // Toriki — Ø 4,25 over four ratings, played seven times.
  assert.equal(d1(shelfScore(4.25, 4, 7)), 4.4);
  // A thin darling is still held back, which is what #894 exists for.
  assert.equal(shelf([5, 5, 5], 1), 4.2);
  // A staple, with and without a history of actually being played.
  assert.equal(shelf([4, 4, 4, 3, 4, 3, 4, 4], 12), 4.1);
  assert.equal(shelf([4, 4, 4, 3, 4, 3, 4, 4], 0), 3.5);
});

/* The other half of #928: the veto signal has to SURVIVE the recovery. Under the
   shelf-relative prior a lone „gar nicht" printed the clamped 0,0 — the same
   number a genuinely rejected game got — so the bottom of the shelf carried no
   information at all. These rows are what separate "one person said no once"
   from "the round has decided". */
test('#928 the worked rows: a veto still costs, and a real dud still sinks', () => {
  assert.equal(shelf([1], 0), 1.4, 'one lone veto is visibly low, not floored');
  assert.equal(shelf([2], 0), 2.6);
  assert.equal(shelf([1, 1, 2, 1], 1), 0.1, 'a real dud stays at the bottom');
  // And the ordering between them is the point, not the magnitudes.
  assert.ok(shelf([1, 1, 2, 1], 1) < shelf([1], 0));
});

test('#894 no evidence at all means NO NUMBER — never rated and never played', () => {
  assert.equal(shelfScore(null, 0, 0), null);
  // A game with votes always keeps a number, however few.
  assert.notEqual(shelfScore(5, 1, 0), null);
});

/* THE COMPARABILITY CRITERION (#928). The whole defect was that the same votes
   on the same game printed a different number in every round, while five
   surfaces — the Regal pill, the detail ring, the Pokale, the Chronik and the
   share text sent OUTSIDE the round — all called it „Spielwirbel-Score".

   Asserted as ARITY rather than as an equality between two rounds, because an
   equality is satisfied by a shelf-relative implementation that happens to be
   handed two identical shelves, and constructing two genuinely different ones
   is a fixture whose relevance nobody can check later. `shelfScore.length === 3`
   fails the moment a prior parameter comes back, which is the only way the
   round could get a say again. */
test('#928 the shelf score cannot be handed a prior at all', () => {
  assert.equal(shelfScore.length, 3, 'score, n, plays — and nothing about the shelf');
  assert.equal(gamePrior.length, 1, 'plays alone decide the prior');
  // The fixed prior is the neutral tile's own value, so „wir wissen es noch
  // nicht" and „keiner hat was dagegen" stay literally the same number.
  assert.equal(PRIOR_DEFAULT, 3);
  assert.equal(gamePrior(0), PRIOR_DEFAULT, 'an unplayed game is shrunk toward exactly that');
});

test('#894 shrinking a score that already equals the prior is a no-op', () => {
  [1, 3, 10, 40].forEach((n) => assert.equal(shrinkScore(3, n, 3), 3, `n=${n}`));
  // And it holds for any prior, which is what makes the ramp invisible to a
  // round whose games all agree with each other.
  assert.equal(shrinkScore(4.25, 7, 4.25), 4.25);
});

test('#894 plays are ONE-DIRECTIONAL: no game scores lower for being played more', () => {
  // The property, not a row: d(shrunk)/d(prior) = m/(n+m) > 0, so a lifted
  // prior can only ever raise a number. A pseudo-vote form would fail this for
  // every game already scoring above the play value, which is why it was
  // rejected — and nothing else in the suite would notice.
  const scores = [null, 0, 1, 1.7, 3, 4.3, 5];
  const counts = [0, 1, 3, 12, 40];
  scores.forEach((s) => counts.forEach((n) => {
    if (s === null && n > 0) return;
    if (s !== null && n === 0) return;
    let prev = null;
    for (let plays = 0; plays <= 30; plays++) {
      const cur = shelfScore(s, n, plays);
      if (cur === null) { assert.equal(plays, 0, 'only the no-evidence case is null'); continue; }
      if (prev !== null) assert.ok(cur >= prev, `score ${s} n=${n}: ${plays} plays scored ${cur} < ${prev}`);
      prev = cur;
    }
  }));
});

test('#894 the play lift saturates but never clamps — twelve plays beat six', () => {
  assert.equal(d1(playCredit(1)), 0.3);
  assert.equal(playCredit(2), 0.5);
  assert.equal(d1(playCredit(10)), 0.8);
  assert.ok(playCredit(12) > playCredit(6), 'a saturating curve is still strictly increasing');
  assert.equal(playCredit(0), 0);
  [-3, null, undefined, NaN].forEach((bad) => assert.equal(playCredit(bad), 0, String(bad)));
  /* #928 RAISED THE LIFT TO 2,0 AND DROPPED #894'S 🤩 CEILING KNOWINGLY: a
     never-rated game played twelve times now reads 4,7 and outranks one rated
     {5,5,5,5} (4,0), because a family that put a game on the table twelve times
     has said something at least as strong as four ratings.

     What survives is the weaker bound that still makes the dial mean something:
     the lift is asymptotic, so plays alone approach PRIOR_DEFAULT + PLAY_LIFT
     and never reach it. With both at their shipped values that is 5,0, so „alle
     5en" remains the only route to a full five. */
  assert.equal(PLAY_LIFT, 2.0);
  assert.ok(gamePrior(1e6) < PRIOR_DEFAULT + PLAY_LIFT);
  assert.equal(d1(gamePrior(12)), 4.7, 'the accepted consequence, stated as a row');
  assert.ok(gamePrior(12) > shelf([5, 5, 5, 5], 0), 'twelve plays outrank four 5-star votes');
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
