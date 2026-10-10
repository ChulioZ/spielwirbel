'use strict';

/*
 * The tie rule, as decided (#1421): what a night with several winners, and a
 * vote with several top games, does to the numbers.
 *
 * Die Brücke's density sheet (B16.3) drew three statements next to a tie, and
 * only one of them was the app's rule. Checked 2026-09-30 (#1421): 1 held, 2
 * was changed in the code to match the design, 3 was settled in favour of the
 * code and the design notes were corrected:
 *
 *   1. Every tied winner counts a FULL win — in the member page's count and
 *      rate and in the Pokale standings. (B16.3 said this; it holds.)
 *   2. A shared win CONTINUES the Serie for each winner — as the operator
 *      decided for Das Programmheft on 2026-09-26 (P7, decision 6). Until
 *      #1421 the Pokale streak was a SOLE-win streak and a tie ended it for
 *      everybody, the one counter out of step with the rest.
 *   3. Two games on the same displayed score SHARE place 1, and the table
 *      picks. (B16.3 said the older game is drawn.) There is no automatic
 *      draw anywhere in the app.
 *
 * Each has a finer spec elsewhere (session-tally, ranking, the Pokale view
 * specs); this file keeps the three together so the rule is readable in one
 * place, and so changing any of them is a red test to answer, not a drift.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { memberStats } = require('../public/js/member-stats');
const { winStreak } = require('../public/js/session-tally');
const { computePlaces } = require('../public/js/ranking');
const { sessionEnding } = require('../public/js/session-outcome');
const { isContestSession, sessionPartyGroups } = require('../public/js/session-people');
const { loadApp } = require('./support/dom');

const MEMBERS = ['aylin', 'nils', 'mia'];
let seq = 0;
const night = (winnerIds, extra = {}) => ({
  id: `s${++seq}`,
  createdAt: `2026-09-${String(seq).padStart(2, '0')}T20:00:00.000Z`,
  gameIds: ['g1'], memberIds: MEMBERS, guests: [], votes: {}, votedIds: [],
  finished: true, cancelled: false, done: true, winnerIds, chosenGameId: 'g1', events: [],
  ...extra,
});
const roundWith = (sessions) => ({
  id: 'r1', name: 'Donnerstagsrunde', background: null, tags: [], providers: [],
  members: MEMBERS.map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) })),
  games: [{ id: 'g1', title: 'Salzwiesen', tagIds: [] }],
  sessions,
});

test('1 — every tied winner counts a full win on the member page', () => {
  const round = roundWith([night(['aylin', 'nils'])]);
  // The one non-module dependency, as recap.js defines it.
  const deps = { sessionEnding, isContestSession, sessionPartyGroups, isNameableGame: (g) => !g.retired };
  const [a, n, m] = MEMBERS.map((id) => memberStats(round, id, deps));
  assert.equal(a.wins, 1, 'a whole win, not a half');
  assert.equal(n.wins, 1);
  assert.equal(a.winRate, 1, 'and the rate counts it as won');
  assert.equal(n.winRate, 1);
  assert.equal(m.wins, 0);
  assert.equal(m.winRate, 0);
});

test('1 — every tied winner counts a full win in the Pokale standings', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = roundWith([night(['aylin', 'nils']), night(['aylin'])]);
  const { wins, rankOf } = dom.call('roundStandings', round);
  assert.deepEqual({ ...wins }, { aylin: 2, nils: 1, mia: 0 });
  assert.equal(rankOf.aylin, 1);
  assert.equal(rankOf.nils, 2, 'the shared night counted in full, so Nils is ahead of Mia');
});

test('2 — a shared win continues the Serie for each winner', () => {
  const deps = { sessionEnding, isContestSession };
  const round = roundWith([]);
  const through = winStreak(round, [night(['aylin']), night(['aylin']), night(['aylin', 'nils'])], deps);
  assert.deepEqual([...through.memberIds], ['aylin'], 'Aylin runs on through the tie; Nils is only on 1');
  assert.equal(through.n, 3, 'the tie counts as a win in the run, not a break');
  const joint = winStreak(round, [night(['mia']), night(['aylin', 'nils']), night(['nils', 'aylin'])], deps);
  assert.deepEqual([...joint.memberIds].sort(), ['aylin', 'nils'], 'two who keep winning together both hold it');
  assert.equal(joint.n, 2);
});

test('3 — two games on the same score share place 1; nothing picks one for the table', () => {
  // Rows as showResults builds them: sorted on score, the newer game first.
  const rows = [
    { game: { id: 'new', createdAt: '2026-09-01' }, score: 4.2, shown: 4.2, count: 3 },
    { game: { id: 'old', createdAt: '2024-01-01' }, score: 4.2, shown: 4.2, count: 3 },
    { game: { id: 'low' }, score: 3.1, shown: 3.1, count: 3 },
  ];
  assert.deepEqual(computePlaces(rows), [1, 1, 3], 'both crowned, and no age tiebreak moves the older one ahead');
});

async function streakCard(t, sessions) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => []);
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  await dom.call('renderPokaleTab', roundWith(sessions));
  return [...dom.app.querySelectorAll('.pokale-card')].find((c) => c.querySelector('.ti-bolt'));
}

test('2 — on the Pokale tab, a run held jointly names both holders and links neither', async (t) => {
  const joint = await streakCard(t, [night(['mia']), night(['aylin', 'nils']), night(['nils', 'aylin'])]);
  assert.ok(joint, 'the streak card is shown for a jointly held run');
  const value = joint.querySelector('.pokale-card__value');
  assert.equal(value.textContent, 'Aylin und Nils', 'in the round’s member order, not the ticking order');
  assert.equal(value.tagName, 'SPAN', 'one value cannot link two people');
  assert.match(joint.textContent, /2 Siege in Folge/);
});

test('2 — on the Pokale tab, a run through a tie shows its one holder, linked', async (t) => {
  const card = await streakCard(t, [night(['mia']), night(['aylin']), night(['aylin', 'nils'])]);
  const value = card.querySelector('.pokale-card__value');
  assert.equal(value.textContent, 'Aylin', 'the longer run is the one shown');
  assert.equal(value.tagName, 'A', 'a single holder still links to their page');
  assert.match(card.textContent, /2 Siege in Folge/);
});

test('2 — a win shared with a GUEST continues the member’s Serie; a guest-only win is skipped', () => {
  const deps = { sessionEnding, isContestSession };
  const round = roundWith([]);
  const withGuest = (winnerIds) => night(winnerIds, { guests: [{ id: 'g1', name: 'Gast' }] });
  const mixed = winStreak(round, [night(['aylin']), withGuest(['aylin', 'g1']), night(['aylin'])], deps);
  assert.deepEqual([...mixed.memberIds], ['aylin'], 'the guest has no member row, so only Aylin can hold it');
  assert.equal(mixed.n, 3, 'the shared night is a win in her run, as a tie with a member is');
  const endsOnMixed = winStreak(round, [night(['nils']), night(['aylin']), withGuest(['aylin', 'g1'])], deps);
  assert.deepEqual([...endsOnMixed.memberIds], ['aylin']);
  assert.equal(endsOnMixed.n, 2);
  // A guest winning ALONE stays skipped (#458): neither a break nor an extension.
  const guestOnly = winStreak(round, [night(['aylin']), withGuest(['g1']), night(['aylin'])], deps);
  assert.equal(guestOnly.n, 2);
});
