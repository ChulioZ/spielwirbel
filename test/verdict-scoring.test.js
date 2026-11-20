'use strict';

/*
 * „Wie war's?" verdicts in the numbers (#1838).
 *
 * The scoring rule (operator decision, 2026-11-20 — rule B): a play is worth a
 * pick (5) per seat, and each verdict replaces ITS seat's share. The four-player
 * example the decision was made on: four players vote 5,5,4,4 and play the game
 * once — 4,17 today; one lone „gar nicht" 3,50; all four 2,2,3,1 2,50.
 *
 * Then: every TASTE site reads verdicts as ratings, and every BALLOT site is
 * unchanged by them.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');
const { PICK_VALUE, playValue, playEvidence, shelfScore, scoreRatings } = require('../public/js/vote-score');
const { sessionPeople } = require('../public/js/session-people');
const { sessionRatings, personRatings, verdictOf, hasAnyRating } = require('../public/js/session-ratings');
const { ownRating } = require('../lib/recommend');
const { seatPlays } = require('../lib/user-plays');
const { favouritesByMember, memberBoosts } = require('../public/js/vote-boost');
const { BOOST_DEPS } = require('../lib/draw-boost');

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

const MEMBERS = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }));
const votes = (byPerson) => Object.fromEntries(Object.entries(byPerson).map(([p, r]) => [p, { g: { rating: r } }]));

function round({ verdicts } = {}) {
  return {
    members: MEMBERS,
    games: [{ id: 'g', title: 'Azul' }, { id: 'h', title: 'Hive' }],
    sessions: [{
      id: 's1', createdAt: '2026-11-01T19:00:00.000Z', memberIds: ['a', 'b', 'c', 'd'], gameIds: ['g', 'h'],
      votes: votes({ a: 5, b: 5, c: 4, d: 4 }), chosenGameId: 'g', finished: true, cancelled: false,
      winnerIds: [], done: true, ...(verdicts ? { verdicts: votes(verdicts) } : {}),
    }],
  };
}
// The shelf number the Regal prints, computed through the shared pieces.
function shelf(r) {
  const s = r.sessions[0];
  const tonight = Object.values(s.votes).map((v) => v.g.rating);
  const ev = playEvidence(r, sessionPeople).get('g');
  return shelfScore(scoreRatings(tonight).score, 1, ev.count, ev.sum);
}

test('rule B, on the four-player example the operator decided it on', () => {
  close(shelf(round()), (3 + 4.5 + 5) / 3);                                      // 4,17
  close(shelf(round({ verdicts: { a: 1 } })), 3.5);
  close(shelf(round({ verdicts: { a: 2, b: 2, c: 3, d: 1 } })), 2.5);
  close(shelf(round({ verdicts: { a: 5, b: 5, c: 4, d: 4 } })), 4.0);
  close(shelf(round({ verdicts: { a: 4, b: 4 } })), 4.0);
});

test('playValue: no verdict is a pick; each verdict replaces one seat share', () => {
  assert.equal(playValue([], 4), PICK_VALUE);
  close(playValue([1], 4), 3);
  close(playValue([2, 2, 3, 1], 4), 0);
  close(playValue([5, 5], 1), 5, 'a seat count below the verdicts is floored at them');
  close(playValue([9, 4], 2), (4 + 5) / 2, 'an off-scale stray is not a verdict');
});

test('playEvidence counts only verdicts of people at that table, and no cancelled play', () => {
  const r = round({ verdicts: { a: 1 } });
  r.sessions[0].memberIds = ['b', 'c', 'd'];                       // a was not seated
  assert.deepEqual(playEvidence(r, sessionPeople).get('g'), { count: 1, sum: 5 });
  r.sessions.push({ ...r.sessions[0], id: 's2', cancelled: true });
  assert.equal(playEvidence(r, sessionPeople).get('g').count, 1);
});

test('no verdicts: the shelf score is exactly the pre-#1838 one, and shelfScore keeps its old call', () => {
  const r = round();
  assert.deepEqual(playEvidence(r, sessionPeople).get('g'), { count: 1, sum: PICK_VALUE });
  assert.equal(shelfScore(4.5, 1, 1), shelfScore(4.5, 1, 1, PICK_VALUE));
});

test('the accessor yields votes then verdicts, string-keyed, and the guards see both', () => {
  const s = round({ verdicts: { a: 2 } }).sessions[0];
  assert.deepEqual(personRatings(s, 'a'), [
    { gameId: 'g', rating: 5, kind: 'vote' }, { gameId: 'g', rating: 2, kind: 'verdict' },
  ]);
  assert.equal(sessionRatings(s, MEMBERS).length, 5);
  assert.equal(sessionRatings(s, MEMBERS, ['vote']).length, 4);
  assert.equal(verdictOf(s, 'a', 'g'), 2);
  assert.equal(verdictOf(s, 'b', 'g'), null);
  const bare = { votes: {}, verdicts: { b: { g: { rating: 3 } } } };
  assert.equal(hasAnyRating(bare, 'b'), true);
  assert.equal(hasAnyRating(bare, 'a'), false);
});

test('taste: the recommender, the profile play list and the draw favourites read verdicts', () => {
  const plain = round();
  const judged = round({ verdicts: { a: 1, b: 1 } });
  assert.equal(ownRating(plain, 'g').count, 4);
  assert.equal(ownRating(judged, 'g').count, 6, 'two verdicts join four votes');
  assert.ok(ownRating(judged, 'g').score < ownRating(plain, 'g').score);

  const rows = [];
  seatPlays(judged, 'a', rows);
  assert.equal(rows[0].rating, 1, 'the verdict wins over the vote for THIS play');
  const plainRows = [];
  seatPlays(plain, 'a', plainRows);
  assert.equal(plainRows[0].rating, 5, 'without one the vote stays');

  assert.ok(favouritesByMember(plain, BOOST_DEPS).get('a').has('g'));
  assert.ok(!favouritesByMember(judged, BOOST_DEPS).get('a').has('g'), '5 then 1 is no longer the top face');
});

test('ballot: the boosts ask about wishes, so a verdict does not move them', () => {
  const later = (r) => ({ ...r, sessions: [...r.sessions, { ...r.sessions[0], id: 's9', createdAt: '2026-11-09T19:00:00.000Z' }] });
  assert.deepEqual([...memberBoosts(later(round({ verdicts: { a: 1 } })), null, BOOST_DEPS)],
    [...memberBoosts(later(round()), null, BOOST_DEPS)]);
});

test('the shelf (Regal, Spielepass raters) reads verdicts; tonight\'s result does not', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  const judged = round({ verdicts: { a: 1 } });
  const plain = round();
  const st = dom.call('gameStats', judged, 'g');
  close(st.score, 3.5);
  assert.equal(st.count, 5, 'the verdict is a rating of the game');
  assert.equal(st.ratedEvenings, 1, 'but not a second rated evening');
  close(dom.call('gameStats', plain, 'g').score, (3 + 4.5 + 5) / 3);
  const idx = dom.call('roundScoreIndex', judged);
  close(idx.byGame.g.score, 3.5);

  const raters = dom.call('gameRaters', judged, 'g');
  assert.equal(raters.find((x) => x.person.id === 'a').n, 2, 'vote and verdict both explain the score');

  const tonight = dom.call('gameStatsForSession', judged, judged.sessions[0], 'g');
  assert.deepEqual(tonight, dom.call('gameStatsForSession', plain, plain.sessions[0], 'g'),
    'the result of THIS vote is unchanged by a verdict');
});

test('member stats and the Pokale count a verdict as a rating', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  const judged = round({ verdicts: { a: 1 } });
  const st = dom.call('memberStats', judged, 'a');
  const plainSt = dom.call('memberStats', round(), 'a');
  assert.ok(st.avgGiven < plainSt.avgGiven, `avg given ${st.avgGiven} vs ${plainSt.avgGiven}`);
  const recap = dom.run(`roundRecap(${JSON.stringify(judged)}, sessionPeople, () => null, sessionRatings)`);
  assert.equal(recap.totals.ratings, 5);
});
