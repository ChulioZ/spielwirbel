'use strict';

/* `retireRecommendations`' rating threshold, against the Spielwirbel-Score
   curve (#893).

   The threshold moved with the scale — it was `LOW_AVG = 2.0` on the raw mean
   (#797) and is `LOW_SCORE` on the score — and nothing else in the suite pins
   it, which is how it came to be worth its own file. The failure it guards is
   silent in the worst direction: a threshold set slightly too high proposes
   archiving games the group actually likes, and the only symptom is a
   recommendation box the user learns to dismiss.

   The DEMO fixture is asserted here too, deliberately. `lib/demo.js` carries a
   comment doing this arithmetic by hand ("leaves that game's average at 3.0,
   well clear of LOW_AVG"), and a hand-done sum in a comment is exactly the kind
   that stops being true when the arithmetic under it changes — as it did here.
   Wiring the real seed into a real assertion is what stops it drifting again. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { scoreRatings } = require('../public/js/vote-score');
const { DEMO_SESSIONS } = require('../lib/demo-seed');

// The threshold, read out of core.js rather than hand-copied — a test constant
// copied from the thing under test proves nothing (#420).
const LOW_SCORE = Number(
  /const LOW_SCORE = ([\d.]+);/.exec(require('fs').readFileSync('public/js/core.js', 'utf8'))[1]
);

test('the threshold means "the group is at all-2s or worse"', () => {
  // The anchor that gives the number a meaning instead of a value. A flat 2 —
  // „eher nicht" from everybody — is the worst a game can be while still
  // getting a real rating from every voter, and that is the bar.
  assert.equal(scoreRatings([2, 2, 2, 2]).score, LOW_SCORE);
});

test('a game most people like is NOT proposed, even carrying one veto', () => {
  // Three of four rated it 3-5 and one wants it gone. The retirement SHARE
  // branch declines it (25% < 50%); the rating branch must decline it too, or
  // one dissenter alone archives a game the group is fine with.
  assert.ok(scoreRatings([0, 4, 5, 3]).score > LOW_SCORE, 'one veto must not trip the rating branch');
  assert.ok(scoreRatings([1, 4, 4, 4]).score > LOW_SCORE);
});

test('a genuinely disliked game still trips it, as it did on the raw mean', () => {
  // Each of these had a raw mean at or below the old LOW_AVG of 2.0, so the
  // change must not have quietly narrowed what gets proposed.
  for (const votes of [[2, 2, 2, 2], [1, 2, 3, 2], [1, 1, 3, 3], [0, 2, 2, 2]]) {
    assert.ok(scoreRatings(votes).score <= LOW_SCORE, `{${votes.join(',')}} should be proposable`);
  }
});

test('the demo seed arrives with nothing proposed for retirement', () => {
  // The seeded round is the first thing a visitor sees (#427). It carries
  // exactly one retirement proposal on purpose — enough to show the zero bar on
  // the results screen, not enough to open with a nag. That balance is an
  // arithmetic claim about the fixture, and this is where it is checked.
  const perGame = new Map();
  for (const spec of DEMO_SESSIONS) {
    spec.gameIndexes.forEach((gameIdx, col) => {
      const votes = spec.ratings.map((row) => row[col]).filter((r) => r != null);
      perGame.set(gameIdx, (perGame.get(gameIdx) || []).concat(votes));
    });
  }
  assert.ok(perGame.size >= 5, 'the fixture must actually hold games');
  for (const [gameIdx, votes] of perGame) {
    const sc = scoreRatings(votes);
    assert.ok(
      sc.score > LOW_SCORE,
      `demo game ${gameIdx} scores ${sc.score} — at or below ${LOW_SCORE}, so the demo would open by proposing it for retirement`
    );
  }
});
