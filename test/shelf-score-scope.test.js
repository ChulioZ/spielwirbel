'use strict';

/* SHELF scope is shrunk; SESSION scope is not (#894).

   The split is the load-bearing half of that issue, and it is invisible in the
   code: `gameStats` and `gameStatsForSession` return the same field names, so a
   later change routing tonight's podium through the shelf index would move
   every number on the results screen with nothing going red. These specs are
   the only thing standing between that and a silent regression.

   The reasons the podium stays unshrunk, either of which is sufficient: `n`
   there is the whole electorate rather than a sample (the vote card refuses to
   advance until everyone present has rated every drawn game), and shrinking
   equal-`n` values toward a common prior is order-preserving anyway — it would
   change every number on the podium and none of its ranking. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { scoreRatings } = require('../public/js/vote-score');

const members = ['m1', 'm2', 'm3'].map((id) => ({ id, name: id }));
const votesFor = (gid, rating) =>
  Object.fromEntries(members.map((m) => [m.id, { [gid]: { rating } }]));

// One thin darling and one staple, so the shelf has a prior of its own and the
// two scopes have something to disagree about.
const ROUND = {
  id: 'r1',
  name: 'R',
  members,
  games: [
    { id: 'g1', title: 'Thin' },
    { id: 'g2', title: 'Staple' },
    { id: 'g3', title: 'Other' },
  ],
  sessions: [
    {
      id: 's1', createdAt: '2026-08-01T20:00:00.000Z', gameIds: ['g1'],
      memberIds: members.map((m) => m.id), votes: votesFor('g1', 5),
      chosenGameId: 'g1', finished: true, done: true,
    },
    ...[0, 1, 2, 3].map((i) => ({
      id: 'st' + i, createdAt: `2026-08-0${i + 2}T20:00:00.000Z`, gameIds: ['g2'],
      memberIds: members.map((m) => m.id), votes: votesFor('g2', 4),
      chosenGameId: 'g2', finished: true, done: true,
    })),
    {
      id: 's3', createdAt: '2026-08-09T20:00:00.000Z', gameIds: ['g3'],
      memberIds: members.map((m) => m.id), votes: votesFor('g3', 3),
      chosenGameId: 'g3', finished: true, done: true,
    },
  ],
};

function boot(t) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => ({}));
  dom.context.ROUND = ROUND;
  return dom;
}

test('#894 the SHELF score is shrunk, and rawScore keeps the unshrunk one beside it', async (t) => {
  const dom = boot(t);
  const st = dom.run('gameStats(ROUND, "g1")');
  // Its own votes say a flat 5; the shelf says otherwise until there is more of
  // them. `rawScore` is what the ring's „Ø" line is derived from, so the two
  // must both be present and must differ here.
  assert.equal(st.rawScore, 5);
  assert.ok(st.score < st.rawScore, `thin 5,5,5 must be pulled down, got ${st.score}`);
  assert.equal(st.count, 3);
  assert.equal(st.plays, 1);
});

test('#894 the SESSION score is NOT shrunk — tonight is the whole electorate', async (t) => {
  const dom = boot(t);
  const raw = scoreRatings([5, 5, 5]).score;
  const perSession = dom.run('gameStatsForSession(ROUND, ROUND.sessions[0], "g1")');
  assert.equal(perSession.score, raw, 'the podium must print the votes as cast');
  // And it carries no shelf fields at all, so a call site cannot reach for one
  // by accident and silently get `undefined` where a number was meant.
  assert.equal(perSession.rawScore, undefined);
  assert.equal(perSession.plays, undefined);
  // The shelf's own number for the same game really is different, which is what
  // makes the assertion above discriminating rather than an identity.
  assert.notEqual(dom.run('gameStats(ROUND, "g1")').score, perSession.score);
});

test('#894 the prior is built ONCE per index, over the active shelf', async (t) => {
  const dom = boot(t);
  const idx = dom.run('roundScoreIndex(ROUND)');
  // Three rated games clears PRIOR_MIN_GAMES, so the round has a prior of its
  // own: the mean of the per-GAME scores (5, 4, 3), not of the fifteen votes
  // behind them — a vote-weighted mean would sit at 4.07 here, dragged there by
  // the staple's four evenings.
  assert.equal(idx.prior, 4);
  assert.deepEqual(Object.keys(idx.byGame).sort(), ['g1', 'g2', 'g3']);
  // Play counts come out of that same walk rather than a second one per game.
  assert.equal(idx.plays.get('g2'), 4);
});
