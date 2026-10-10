'use strict';

/* What counts as a CONTEST (#1624): more than one PERSON at the table, and an
   ending that was about winning. A whole-table team — everyone on one side,
   playing against the game — is a contest: a shared win raises every player's
   Siegquote and a shared „Verloren" lowers it, exactly as the same table
   recorded without a team. Only a one-person session (#895), „Kein Sieger" and
   „Fortsetzung folgt" (#1038) stay out.

   Every reader of the rule is driven here through the ONE predicate, so the
   rate, „Stärkstes Spiel" and the streak cannot disagree about it. The contest
   badges have their own case in test/achievements.test.js, the account-wide
   rate in test/user-stats.test.js. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isContestSession, sessionPartyGroups } = require('../public/js/session-people');
const { sessionEnding } = require('../public/js/session-outcome');
const { memberStats } = require('../public/js/member-stats');
const { winStreak } = require('../public/js/session-tally');
const { isNameableGame } = require('../public/js/recap');

const STATS_DEPS = { sessionEnding, isContestSession, sessionPartyGroups, isNameableGame };
const STREAK_DEPS = { sessionEnding, isContestSession };

const ALL = ['m1', 'm2', 'm3', 'm4'];
const round = (sessions) => ({
  members: ALL.map((id) => ({ id, name: id.toUpperCase() })),
  games: [{ id: 'g', title: 'Coop' }],
  sessions,
});

let seq = 0;
const sess = (over = {}) => {
  seq += 1;
  return {
    id: `s${seq}`, createdAt: `2026-09-${String(10 + seq).padStart(2, '0')}T20:00:00Z`,
    gameIds: ['g'], chosenGameId: 'g', votes: {}, finished: true,
    memberIds: ALL, winnerIds: [], ...over,
  };
};
// Everyone on one team, in either seat mode (#575, #1610).
const wholeTeam = (over = {}, sharedSeat = false) =>
  sess({ teams: [{ id: 't', personIds: ALL, sharedSeat }], ...over });

test('the predicate counts people, not sides — a whole-table team is a contest', () => {
  const r = round([]);
  assert.equal(isContestSession(r, wholeTeam(), sessionEnding), true, 'own-seat team of everyone');
  assert.equal(isContestSession(r, wholeTeam({}, true), sessionEnding), true, 'shared-seat team of everyone');
  assert.equal(isContestSession(r, sess(), sessionEnding), true, 'four individuals');
  assert.equal(isContestSession(r, sess({ memberIds: ['m1'], guests: [{ id: 'x', name: 'Gast' }] }), sessionEnding),
    true, 'a member and a guest are two people');
});

test('one person, „Kein Sieger" and „Fortsetzung folgt" are still no contest', () => {
  const r = round([]);
  assert.equal(isContestSession(r, sess({ memberIds: ['m1'], winnerIds: ['m1'] }), sessionEnding), false, 'solo (#895)');
  assert.equal(isContestSession(r, wholeTeam({ ending: 'noWinner' }), sessionEnding), false);
  assert.equal(isContestSession(r, wholeTeam({ ending: 'ongoing' }), sessionEnding), false);
  assert.equal(isContestSession(r, wholeTeam({ ending: 'lost' }), sessionEnding), true, '„Verloren" stays contested');
  // A session that was not PLAYED has no ending at all — the predicate itself
  // refuses it, rather than trusting every caller's `finished` filter.
  assert.equal(isContestSession(r, sess({ cancelled: true }), sessionEnding), false, 'cancelled');
  assert.equal(isContestSession(r, sess({ childSessionIds: ['c1'] }), sessionEnding), false, 'split parent');
  assert.equal(isContestSession(r, sess({ ending: undefined }), sessionEnding), true, 'unrecorded stays contested');
});

test('a whole-table team win counts as a contested win for every member', () => {
  const r = round([wholeTeam({ winnerIds: ALL })]);
  ALL.forEach((mid) => {
    const st = memberStats(r, mid, STATS_DEPS);
    assert.equal(st.contested, 1, mid);
    assert.equal(st.contestedWins, 1, mid);
    assert.equal(st.winRate, 1, mid);
  });
});

test('the same lost evening gives the same rate, recorded as one team or as four people', () => {
  const asTeam = round([sess({ winnerIds: ['m1'] }), wholeTeam({ ending: 'lost' })]);
  const asPeople = round([sess({ winnerIds: ['m1'] }), sess({ ending: 'lost' })]);
  const team = memberStats(asTeam, 'm1', STATS_DEPS);
  const people = memberStats(asPeople, 'm1', STATS_DEPS);
  assert.equal(team.winRate, 0.5);
  assert.deepEqual([team.contested, team.contestedWins, team.winRate],
    [people.contested, people.contestedWins, people.winRate]);
});

test('a one-person session stays out of the rate', () => {
  const r = round([sess({ memberIds: ['m1'], winnerIds: ['m1'] }), sess({ winnerIds: ['m2'] })]);
  const st = memberStats(r, 'm1', STATS_DEPS);
  assert.equal(st.contested, 1);
  assert.equal(st.winRate, 0);
  assert.equal(st.wins, 1, 'the solo win is still a win in the count');
});

test('„Stärkstes Spiel" counts whole-table team plays of a game', () => {
  const r = round([wholeTeam({ winnerIds: ALL }), wholeTeam({ winnerIds: ALL }), wholeTeam({ ending: 'lost' })]);
  const st = memberStats(r, 'm2', STATS_DEPS);
  assert.deepEqual(st.bestGames.map((g) => g.id), ['g']);
  assert.equal(st.bestPlays, 3);
  assert.equal(st.bestScore, 2 / 3);
});

test('a whole-table team win extends the streak for every winner; a team loss breaks it', () => {
  const r = round([]);
  const run = winStreak(r, [sess({ winnerIds: ['m1', 'm2'] }), wholeTeam({ winnerIds: ALL })], STREAK_DEPS);
  assert.equal(run.n, 2);
  assert.deepEqual([...run.memberIds].sort(), ['m1', 'm2']);
  const broken = winStreak(r, [sess({ winnerIds: ['m1'] }), wholeTeam({ ending: 'lost' })], STREAK_DEPS);
  assert.equal(broken.n, 0);
  // …while a solo night still neither breaks nor extends it.
  const solo = winStreak(r, [sess({ winnerIds: ['m1'] }), sess({ memberIds: ['m1'], winnerIds: ['m1'] })], STREAK_DEPS);
  assert.equal(solo.n, 1);
});
