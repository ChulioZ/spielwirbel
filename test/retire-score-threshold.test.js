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
   comment doing this arithmetic by hand, and a hand-done sum in a comment is
   exactly the kind that stops being true when the arithmetic under it changes —
   as it did here. Wiring the real seed into a real assertion is what stops it
   drifting again.

   #909 removed the SORT_SHARE branch this file also used to cover: the vote
   card no longer offers a retirement proposal, so the rating branch is the
   whole decision. The shapes below that used to carry a 0 now carry a 1 — the
   bottom of the surviving scale, and the value the migration rewrites a
   retire-only vote to. */

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
  // Three of four rated it 3-5 and one does not want to play it at all. The
  // rating branch must decline it, or one dissenter alone archives a game the
  // group is fine with.
  assert.ok(scoreRatings([1, 4, 5, 3]).score > LOW_SCORE, 'one veto must not trip the rating branch');
  assert.ok(scoreRatings([1, 4, 4, 4]).score > LOW_SCORE);
});

test('a genuinely disliked game still trips it, as it did on the raw mean', () => {
  // Each of these had a raw mean at or below the old LOW_AVG of 2.0, so the
  // change must not have quietly narrowed what gets proposed.
  for (const votes of [[2, 2, 2, 2], [1, 2, 3, 2], [1, 1, 3, 3], [1, 2, 2, 2]]) {
    assert.ok(scoreRatings(votes).score <= LOW_SCORE, `{${votes.join(',')}} should be proposable`);
  }
});

test('the demo seed arrives with nothing proposed for retirement', () => {
  // The seeded round is the first thing a visitor sees (#427). It carries
  // exactly one „gar nicht" on purpose — enough to show the leftmost bar on the
  // results screen and the score's reason line, not enough to open with a nag.
  // That balance is an arithmetic claim about the fixture, and this is where it
  // is checked.
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

/* ---------------------------------------------------------------------------
   The MEMBERSHIP decision, not just the threshold (#922).

   Everything above compares `scoreRatings(...)` to `LOW_SCORE` by hand, which
   is a statement about the number and not about what the banner does with it.
   That proxy is what let the bug through: the threshold is fine, and the
   proposal is still wrong, because the veto curve is divided by the VOTER COUNT
   — one dissenter weighs `-5/n`, decisive at n=3 and harmless at n=5. So these
   run the real `gameStats` -> `retireRecommendations` path under jsdom
   (`.claude/rules/testing-views-under-jsdom.md`) and ask the question the user
   sees: does this game get proposed?

   NOTE which sizes actually discriminate. The single-dissenter shapes flip only
   at n=3 and n=4; at n=5 a lone dissenter can never reach `LOW_SCORE` in the
   first place ({1,3,3,3,3} scores 1.4), so those rows are CONTROLS — green
   before the guard and green after. They are here because group-size
   independence is the claim, and a sweep that only covered the sizes which
   break is how the n=4-only coverage came to miss n=3. */

const { loadApp } = require('./support/dom');

/* One game, one session, one vote per member — the multiset IS the fixture.

   `minVotes` is passed as 0 deliberately: "is there enough data" is a separate
   condition (`round.members.length * 3` at the call site in views-round.js) and
   this file is about which vote SHAPES get proposed, not about when a game has
   accumulated enough votes to be judged at all. */
function recsFor(dom, votes) {
  const ids = votes.map((_, i) => `m${i}`);
  dom.set('UT_ROUND', {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    providers: [],
    members: votes.map((_, i) => ({ id: ids[i], name: `M${i}` })),
    games: [{ id: 'g1', title: 'Spiel', tagIds: [] }],
    sessions: [{
      id: 's1',
      createdAt: '2026-07-01T20:00:00.000Z',
      gameIds: ['g1'],
      memberIds: ids,
      votes: Object.fromEntries(votes.map((r, i) => [ids[i], { g1: { rating: r } }])),
    }],
  });
  return dom.run('retireRecommendations(UT_ROUND.games, { g1: gameStats(UT_ROUND, "g1") }, 0)');
}

const proposed = (dom, votes) => recsFor(dom, votes).length > 0;

test('one dissenter cannot propose a game the rest of the group is fine with', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // Exactly one voter below 2, everyone else at 3+. Until #922 the rating
  // branch proposed these anyway at the smaller group sizes.
  for (const votes of [
    [1, 4, 4], [1, 3, 3],              // n=3 — both flipped here
    [1, 3, 3, 3],                       // n=4
    [1, 4, 4, 4], [1, 4, 5, 3],         // n=4 controls (already fine)
    [1, 3, 3, 3, 3],                    // n=5 controls (already fine)
  ]) {
    assert.equal(
      proposed(dom, votes), false,
      `{${votes.join(',')}} must not be proposed — one dissenter, everyone else content`
    );
  }
});

test('a genuinely disliked game is still proposed — the guard narrows nothing', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // The anchor, then four shapes that are NOT a lone dissenter: either somebody
  // sits at 2 (so "everyone else is content" is false) or more than one voter
  // is below 2.
  for (const votes of [[2, 2, 2, 2], [1, 2, 3, 2], [1, 1, 3, 3], [1, 1, 4, 4]]) {
    assert.equal(
      proposed(dom, votes), true,
      `{${votes.join(',')}} must still be proposed`
    );
  }
});

test('the low score is the ONLY reason a game is ever proposed (#909)', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  /* There used to be a second branch, SORT_SHARE: half a game's votes being
     explicit "aussortieren" proposals. It is gone with the tile that fed it,
     and the shape that used to isolate it — {0,3}, one flag in two votes, a 50%
     share while the score branch declined — can no longer be expressed at all.

     So this pins the remaining branch by its REASON rather than by a count: one
     reason, and it is the score one. A revived share branch would show up as a
     second entry here even where both fire on the same game. */
  const recs = recsFor(dom, [1, 1, 2, 2]);
  assert.equal(recs.length, 1, 'a genuinely disliked game is still proposed');
  // `Array.from` because the value crossed out of the vm realm: its prototype is
  // that context's Array.prototype, and `deepEqual` (strict) compares those.
  const reasons = Array.from(recs[0].reasons);
  assert.equal(reasons.length, 1, `one reason, got: ${reasons.join(' | ')}`);
  assert.equal(reasons[0], dom.run("t('rec.reasonAvg', { avg: fmtAvg(displayScore(gameStats(UT_ROUND, 'g1').score)) })"));
});
