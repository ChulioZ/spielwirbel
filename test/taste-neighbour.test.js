'use strict';

/* Die Tischkarte's taste line (#1778): whose taste is closest to a member's and
 * whose is most different, over the mean absolute difference of per-game
 * average ratings, at least TASTE_MIN_SHARED shared games per pair.
 *
 * The fixture is built so every rule has a member that only that rule names:
 *   - Ben and Cleo TIE as Anna's closest (both one point off on every game),
 *   - Dana is the most different (always three points off),
 *   - Emil would be the closest of all (identical ratings) but shares only
 *     four games — below the floor, so he must never be named,
 *   - Finn rates identically too, but is RETIRED, so he may not be named,
 *   - and a retired GAME on which Dana agrees with Anna perfectly must not
 *     pull her closer.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { TASTE_MIN_SHARED, tasteDistance, tasteNeighbours } = require('../public/js/taste-neighbour');
const { isNameableGame } = require('../public/js/recap');
const { activeMembers } = require('../public/js/member-active');
const { loadApp } = require('./support/dom');

const deps = { isNameableGame, activeMembers };
const RID = 'r1';

const GAMES = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((id) => ({ id, title: `Spiel ${id}`, tagIds: [] }));
const RETIRED = { id: 'g9', title: 'Altspiel', tagIds: [], retired: true };

// Anna's ratings; every other member is written out against them below.
const ANNA = { g1: 5, g2: 4, g3: 2, g4: 5, g5: 1, g6: 3 };

function session(id, votes) {
  const v = {};
  Object.entries(votes).forEach(([mid, byGame]) => {
    v[mid] = Object.fromEntries(Object.entries(byGame).map(([g, rating]) => [g, { rating }]));
  });
  return {
    id, createdAt: '2026-07-01T20:00:00.000Z', gameIds: [], memberIds: Object.keys(votes),
    votes: v, votedIds: [], finished: true, cancelled: false, done: true, winnerIds: [], events: [],
  };
}

function fixture() {
  // Ben and Cleo are each exactly one point off on all six games (distance 1);
  // Dana is three off on five and two off on one (17/6).
  const ben = { g1: 4, g2: 3, g3: 1, g4: 4, g5: 2, g6: 2 };
  const cleo = { g1: 4, g2: 5, g3: 3, g4: 4, g5: 2, g6: 4 };
  const dana = { g1: 2, g2: 1, g3: 5, g4: 2, g5: 4, g6: 5, g9: 3 };
  const emil = { g1: 5, g2: 4, g3: 2, g4: 5 }; // identical, but only four shared
  const finn = { ...ANNA };
  return {
    id: RID, name: 'Freitagsrunde', background: null, tags: [], providers: [],
    members: [
      { id: 'anna', name: 'Anna' }, { id: 'ben', name: 'Ben' }, { id: 'cleo', name: 'Cleo' },
      { id: 'dana', name: 'Dana' }, { id: 'emil', name: 'Emil' }, { id: 'finn', name: 'Finn', retired: true },
    ],
    games: [...GAMES, RETIRED],
    sessions: [
      session('s1', { anna: { ...ANNA, g9: 3 }, ben, cleo, dana, emil, finn }),
    ],
  };
}

test('the floor is five shared games', () => {
  assert.equal(TASTE_MIN_SHARED, 5);
  const a = { g1: 5, g2: 4, g3: 3, g4: 2 };
  assert.equal(tasteDistance(a, { ...a }), null, 'four shared games do not qualify');
  assert.equal(tasteDistance({ ...a, g5: 1 }, { ...a, g5: 3 }), 0.4, 'five do — mean of |0,0,0,0,2|');
});

test('distance is over per-game AVERAGES, not per vote', () => {
  const round = fixture();
  // Gus agrees with Anna on g1 and is two off on the other five (per-game
  // distance 10/6 ≈ 1,67 — further than Ben and Cleo, closer than Dana). He
  // then rates g1 nineteen more times. Weighted per vote, that one agreement
  // would pull him to (0·20 + 2·5) / 25 = 0,4 and make him the closest of all;
  // averaged per game it changes nothing.
  round.members.push({ id: 'gus', name: 'Gus' });
  const gus = { g1: 5, g2: 2, g3: 4, g4: 3, g5: 3, g6: 5 };
  round.sessions.push(session('sg', { gus }));
  for (let i = 0; i < 19; i += 1) round.sessions.push(session(`sg${i}`, { gus: { g1: 5 } }));
  const { near, far } = tasteNeighbours(round, 'anna', deps);
  assert.deepEqual(near.map((m) => m.id), ['ben', 'cleo']);
  assert.deepEqual(far.map((m) => m.id), ['dana']);
});

test('neighbours tie together, the opposite is named, the floor and retired seats are respected', () => {
  const { near, far } = tasteNeighbours(fixture(), 'anna', deps);
  assert.deepEqual(near.map((m) => m.id), ['ben', 'cleo'], 'Ben and Cleo are both exactly one point off — a tie names both');
  assert.deepEqual(far.map((m) => m.id), ['dana']);
});

test('a retired game does not count toward agreement', () => {
  const round = fixture();
  // Make Dana agree with Anna on twelve more RETIRED games (thirteen with g9):
  // were they counted, her distance would drop to 17/19 < 1 and she would be
  // the CLOSEST, with Ben and Cleo the most different.
  for (let i = 0; i < 12; i += 1) {
    const g = { id: `r${i}`, title: `Alt ${i}`, tagIds: [], retired: true };
    round.games.push(g);
    round.sessions.push(session(`sr${i}`, { anna: { [g.id]: 3 }, dana: { [g.id]: 3 } }));
  }
  assert.deepEqual(tasteNeighbours(round, 'anna', deps).far.map((m) => m.id), ['dana']);
});

test('one qualifying pair names only the neighbour', () => {
  const round = fixture();
  round.members = round.members.filter((m) => ['anna', 'ben', 'emil'].includes(m.id));
  const { near, far } = tasteNeighbours(round, 'anna', deps);
  assert.deepEqual(near.map((m) => m.id), ['ben']);
  assert.deepEqual(far, [], 'the same person may not be both closest and most different');
});

test('nobody qualifies → nothing at all', () => {
  const round = fixture();
  assert.deepEqual(tasteNeighbours(round, 'emil', deps), { near: [], far: [] });
});

// ---- the view ---------------------------------------------------------------

function bootApp(t, round) {
  const dom = loadApp({ locale: 'en' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

test('die Tischkarte names the neighbours and the opposite, each as a member link, with no number', async (t) => {
  const dom = bootApp(t, fixture());
  await dom.call('showMember', RID, 'anna');
  const line = dom.app.querySelector('.member-card .member-taste');
  assert.ok(line, 'the taste line renders inside the card');
  const near = line.querySelector('.member-taste__row--near');
  const far = line.querySelector('.member-taste__row--far');
  assert.deepEqual([...near.querySelectorAll('a')].map((a) => a.textContent), ['Ben', 'Cleo']);
  assert.deepEqual([...far.querySelectorAll('a')].map((a) => a.textContent), ['Dana']);
  near.querySelectorAll('a').forEach((a) => {
    assert.ok(a.classList.contains('member-link'), 'each name is a real member link');
  });
  assert.match(far.querySelector('a').getAttribute('href'), /dana/);
  assert.match(near.textContent, /Ben and Cleo/, 'a tie reads as a list, not two lines');
  assert.doesNotMatch(line.textContent, /\d/, 'words only — never a score or a percentage');
});

test('die Tischkarte shows nothing for a member with no qualifying pair', async (t) => {
  const dom = bootApp(t, fixture());
  await dom.call('showMember', RID, 'emil');
  assert.equal(dom.app.querySelector('.member-taste'), null);
});

test('only the neighbour row when one pair qualifies', async (t) => {
  const round = fixture();
  round.members = round.members.filter((m) => ['anna', 'ben', 'emil'].includes(m.id));
  const dom = bootApp(t, round);
  await dom.call('showMember', RID, 'anna');
  assert.ok(dom.app.querySelector('.member-taste__row--near'));
  assert.equal(dom.app.querySelector('.member-taste__row--far'), null);
});
