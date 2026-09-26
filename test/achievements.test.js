'use strict';

/* Abzeichen (#1387): the catalogue and its derivation, public/js/achievements.js.

   One spec per entry with a fixture that earns it and one that just misses it,
   and every tier boundary pinned from both sides — a threshold asserted only
   from above is green against an off-by-one in either direction.

   The siblings the module reads are the REAL modules, injected exactly as
   lib/user-stats.js injects memberStats' — a hand-written stand-in would be a
   second definition of what a party, a contest or a vote is. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const people = require('../public/js/session-people');
const outcome = require('../public/js/session-outcome');
const voteScore = require('../public/js/vote-score');
const { computePlaces } = require('../public/js/ranking');
const { isActiveGame } = require('../public/js/draw-pool');
const {
  BADGE_CATALOGUE, roundBadges, newSince, accountBadges,
  BADGE_EXPLORER_DAYS, BADGE_BIG_TABLE, BADGE_COMEBACK_DROUGHT, BADGE_EVERGREEN_PLAYS,
} = require('../public/js/achievements');

const DEPS = {
  sessionPeople: people.sessionPeople,
  sessionPartyGroups: people.sessionPartyGroups,
  sessionPartyCount: people.sessionPartyCount,
  sessionEnding: outcome.sessionEnding,
  sessionHasVotes: outcome.sessionHasVotes,
  scoreRatings: voteScore.scoreRatings,
  TILE_VALUE: voteScore.TILE_VALUE,
  SCORE_MIN: voteScore.SCORE_MIN,
  computePlaces,
  isActiveGame,
};

// --- fixtures ------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-01-01T19:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

let seq = 0;
// Sessions are dated one day apart in the order they are built, so the replay
// order is the fixture order unless a spec says otherwise.
function sess(over = {}) {
  seq += 1;
  return {
    id: `s${seq}`,
    createdAt: iso(T0 + seq * DAY),
    memberIds: ['a', 'b'],
    gameIds: ['g1'],
    chosenGameId: 'g1',
    votes: {},
    finished: true,
    winnerIds: [],
    ...over,
  };
}
const many = (n, over = {}) => Array.from({ length: n }, () => sess(typeof over === 'function' ? over() : over));

const game = (id, over = {}) => ({ id, title: id, retired: false, completed: false, wish: false, createdAt: iso(T0), ...over });

function mkRound({ members, games, sessions } = {}) {
  return {
    id: 'r1',
    members: members || [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bo' }],
    games: games || [game('g1'), game('g2'), game('g3')],
    sessions: sessions || [],
  };
}

const all = (round, opts = {}) => roundBadges(round, { deps: DEPS, ...opts });
const mine = (round, key, mid = 'a', opts) => all(round, opts).members[mid].find((e) => e.key === key);
const ours = (round, key, opts) => all(round, opts).round.find((e) => e.key === key);

// --- the catalogue -------------------------------------------------------------

test('the catalogue is the 21 decided entries: 9 member · 8 round · 4 account', () => {
  const by = (h) => BADGE_CATALOGUE.filter((d) => d.holder === h).map((d) => d.key);
  assert.deepEqual(by('member'), ['firstWin', 'regular', 'streak', 'versatile', 'allPlayed', 'teamPlayer', 'host', 'comeback', 'explorer']);
  assert.deepEqual(by('round'), ['founded', 'sessions', 'shelf', 'unanimous', 'tie', 'bigTable', 'completed', 'evergreen']);
  assert.deepEqual(by('account'), ['accountSessions', 'accountWins', 'accountRounds', 'accountYears']);
  assert.equal(new Set(BADGE_CATALOGUE.map((d) => d.key)).size, 21, 'keys are unique');
});

test('exactly three secrets, and the tier ladders the review decided', () => {
  assert.deepEqual(BADGE_CATALOGUE.filter((d) => d.secret).map((d) => d.key), ['comeback', 'unanimous', 'tie']);
  const tiers = Object.fromEntries(BADGE_CATALOGUE.filter((d) => d.tiers).map((d) => [d.key, d.tiers]));
  assert.deepEqual(tiers, {
    regular: [10, 25, 50, 100],
    versatile: [3, 6, 10],
    sessions: [10, 50, 100, 250],
    shelf: [25, 50, 100],
    accountSessions: [25, 100, 500],
    accountWins: [10, 50],
    accountRounds: [2, 5],
    accountYears: [1, 2, 3],
  });
  // Four tiers for Stammgast and the round's Sessions only (pruefung finding 4).
  const four = BADGE_CATALOGUE.filter((d) => d.tiers && d.tiers.length > 3).map((d) => d.key);
  assert.deepEqual(four, ['regular', 'sessions']);
});

test('every glyph is declared in the bundled Tabler subset', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'fonts', 'tabler-icons.css'), 'utf8');
  for (const d of BADGE_CATALOGUE) {
    assert.match(css, new RegExp(`\\.${d.glyph}::before`), `${d.key}: ${d.glyph} is not declared`);
  }
});

test('every entry has a name and a condition line in every shipped locale', () => {
  const vm = require('vm');
  const { LOCALES } = require('../public/js/locales');
  for (const { code } of LOCALES) {
    const ctx = { I18N: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lang', `${code}.js`), 'utf8'), ctx);
    const dict = ctx.I18N[code];
    for (const d of BADGE_CATALOGUE) {
      for (const k of [`badges.${d.key}.name`, `badges.${d.key}.line`]) {
        assert.ok(dict[k], `${code}: ${k} missing`);
      }
      // A line that states a threshold states it through {n}, so a retuned
      // tier cannot leave nine languages printing the old number.
      if (d.tiers || d.goal || d.n) assert.match(dict[`badges.${d.key}.line`], /\{n\}/, `${code}: ${d.key} line lacks {n}`);
    }
    for (const s of ['earned', 'progress', 'locked', 'secret']) assert.ok(dict[`badges.state.${s}`], `${code}: state ${s}`);
  }
});

// --- A. member entries ---------------------------------------------------------

test('Erster Sieg: earned at the first win, locked without one', () => {
  const first = sess({ winnerIds: ['b'] });
  const win = sess({ winnerIds: ['a'] });
  const e = mine(mkRound({ sessions: [first, win, sess({ winnerIds: ['a'] })] }), 'firstWin');
  assert.equal(e.state, 'earned');
  assert.deepEqual(e.earnedAt, { sessionId: win.id, at: win.createdAt });
  assert.equal(mine(mkRound({ sessions: [sess({ winnerIds: ['b'] })] }), 'firstWin').state, 'locked');
});

test('Stammgast: every tier boundary, both sides', () => {
  for (const [n, tier, state, of] of [[9, null, 'progress', 10], [10, 10, 'earned', 25], [24, 10, 'earned', 25],
    [25, 25, 'earned', 50], [49, 25, 'earned', 50], [50, 50, 'earned', 100], [99, 50, 'earned', 100], [100, 100, 'earned', null]]) {
    const e = mine(mkRound({ sessions: many(n) }), 'regular');
    assert.equal(e.state, state, `${n} sessions`);
    assert.equal(e.tier, tier, `${n} sessions`);
    assert.equal(e.of, of, `${n} sessions`);
    assert.equal(e.count, of === null ? null : n);
  }
  // Only sessions the member JOINED count; a legacy session without memberIds
  // counts everyone, as memberStats does.
  const e = mine(mkRound({ sessions: [...many(9, { memberIds: ['b'] }), ...many(9), sess({ memberIds: undefined })] }), 'regular');
  assert.equal(e.count, 10);
  assert.equal(e.tier, 10);
});

test('Stammgast: the tier date is the session that crossed it, the history keeps each tier', () => {
  const ss = many(25);
  const e = mine(mkRound({ sessions: ss }), 'regular');
  assert.deepEqual(e.history.map((h) => [h.tier, h.sessionId]), [[10, ss[9].id], [25, ss[24].id]]);
  assert.equal(e.earnedAt.sessionId, ss[24].id);
});

test('Serienheld: three contested wins in a row; two, or a broken run, miss', () => {
  const W = { winnerIds: ['a'] };
  const L = { winnerIds: ['b'] };
  const loss = sess(L);
  const run = [sess(W), sess(W), sess(W)];
  const e = mine(mkRound({ sessions: [loss, ...run] }), 'streak');
  assert.equal(e.state, 'earned');
  assert.equal(e.earnedAt.sessionId, run[2].id);
  assert.equal(mine(mkRound({ sessions: [sess(W), sess(W), sess(L), sess(W)] }), 'streak').state, 'locked');
  // A solo night and a „Kein Sieger" night are no contest: they neither break
  // nor extend the run (#895, #1038) — the Pokale streak's own filter.
  const solo = sess({ memberIds: ['a'], winnerIds: ['a'] });
  assert.equal(mine(mkRound({ sessions: [sess(W), solo, sess(W)] }), 'streak').state, 'locked', 'a solo win does not extend');
  const noWinner = sess({ ending: 'noWinner' });
  assert.equal(mine(mkRound({ sessions: [sess(W), sess(W), noWinner, sess(W)] }), 'streak').state, 'earned', 'noWinner does not break');
});

test('Vielseitig: distinct games won with, tiers 3 · 6 · 10 both sides', () => {
  const games = Array.from({ length: 10 }, (_, i) => game(`v${i}`));
  const wins = (n) => games.slice(0, n).map((g) => sess({ chosenGameId: g.id, gameIds: [g.id], winnerIds: ['a'] }));
  for (const [n, tier] of [[2, null], [3, 3], [5, 3], [6, 6], [9, 6], [10, 10]]) {
    assert.equal(mine(mkRound({ games, sessions: wins(n) }), 'versatile').tier, tier, `${n} games`);
  }
  // The same game won twice is one game.
  const same = [sess({ winnerIds: ['a'] }), sess({ winnerIds: ['a'] }), sess({ chosenGameId: 'g2', winnerIds: ['a'] })];
  assert.equal(mine(mkRound({ sessions: same }), 'versatile').count, 2);
});

test('Alles gespielt: every shelf game played with the member present', () => {
  const games = [game('g1'), game('g2'), game('g3'), game('old', { retired: true })];
  const played = ['g1', 'g2', 'g3'].map((g) => sess({ chosenGameId: g }));
  const e = mine(mkRound({ games, sessions: played }), 'allPlayed');
  assert.equal(e.state, 'earned', 'a retired game is not on the shelf');
  assert.equal(e.earnedAt.sessionId, played[2].id);

  const miss = mine(mkRound({ games, sessions: played.slice(0, 2) }), 'allPlayed');
  assert.deepEqual([miss.state, miss.count, miss.of], ['progress', 2, 3]);
  const absent = [...played.slice(0, 2), sess({ chosenGameId: 'g3', memberIds: ['b'] })];
  assert.equal(mine(mkRound({ games, sessions: absent }), 'allPlayed').state, 'progress', 'played without her does not count');
});

test('Alles gespielt: earned stays earned when a game joins the shelf later', () => {
  const played = ['g1', 'g2'].map((g) => sess({ chosenGameId: g }));
  const later = game('g9', { createdAt: iso(T0 + 100000 * DAY) });
  const e = mine(mkRound({ games: [game('g1'), game('g2'), later], sessions: played }), 'allPlayed');
  assert.equal(e.state, 'earned');
  assert.equal(e.earnedAt.sessionId, played[1].id);
});

test('Teamgeist: won as part of a team; a solo win or a losing team misses', () => {
  const members = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const teams = [{ id: 't1', personIds: ['a', 'b'] }];
  const base = { memberIds: ['a', 'b', 'c'], teams };
  assert.equal(mine(mkRound({ members, sessions: [sess({ ...base, winnerIds: ['a', 'b'] })] }), 'teamPlayer').state, 'earned');
  assert.equal(mine(mkRound({ members, sessions: [sess({ ...base, winnerIds: ['c'] })] }), 'teamPlayer').state, 'locked');
  assert.equal(mine(mkRound({ members, sessions: [sess({ ...base, winnerIds: ['c'] })] }), 'teamPlayer', 'c').state, 'locked',
    'a win outside any team is not Teamgeist');
});

test('Gastgeber: the own box played 10 times, not when she came without her shelf', () => {
  const games = [game('g1', { ownerIds: ['a'] }), game('g2')];
  assert.equal(mine(mkRound({ games, sessions: many(10) }), 'host').state, 'earned');
  const nine = mine(mkRound({ games, sessions: many(9) }), 'host');
  assert.deepEqual([nine.state, nine.count, nine.of], ['progress', 9, 10]);
  const away = [...many(9), sess({ withoutShelfIds: ['a'] })];
  assert.equal(mine(mkRound({ games, sessions: away }), 'host').state, 'progress');
  assert.equal(mine(mkRound({ games, sessions: many(10, { chosenGameId: 'g2' }) }), 'host').state, 'locked', "not her box");
});

test('Comeback (secret): a win after 10 contested sessions without one; 9 misses', () => {
  const L = { winnerIds: ['b'] };
  const drought = many(BADGE_COMEBACK_DROUGHT, L);
  const win = sess({ winnerIds: ['a'] }); // built after, so dated after
  const e = mine(mkRound({ sessions: [...drought, win] }), 'comeback');
  assert.equal(e.state, 'earned');
  assert.equal(e.earnedAt.sessionId, win.id);
  const miss = mine(mkRound({ sessions: [...many(9, L), sess({ winnerIds: ['a'] })] }), 'comeback');
  assert.deepEqual([miss.state, miss.count, miss.of], ['secret', null, null], 'unearned, it shows nothing');
  // An earlier win restarts the drought.
  const reset = [...many(5, L), sess({ winnerIds: ['a'] }), ...many(9, L), sess({ winnerIds: ['a'] })];
  assert.equal(mine(mkRound({ sessions: reset }), 'comeback').state, 'secret');
});

test('Entdecker: 5 games played within a week of joining the shelf; 4, or day 8, misses', () => {
  const games = Array.from({ length: 5 }, (_, i) => game(`e${i}`, { createdAt: iso(T0 + 1000 * DAY) }));
  const within = (g, days) => ({ id: `x-${g.id}-${days}`, createdAt: iso(Date.parse(g.createdAt) + days * DAY), memberIds: ['a', 'b'],
    gameIds: [g.id], chosenGameId: g.id, votes: {}, finished: true, winnerIds: [] });
  const edge = BADGE_EXPLORER_DAYS;
  assert.equal(mine(mkRound({ games, sessions: games.map((g) => within(g, edge)) }), 'explorer').state, 'earned', 'day 7 counts');
  const four = [...games.slice(0, 4).map((g) => within(g, 1)), within(games[4], edge + 1)];
  const e = mine(mkRound({ games, sessions: four }), 'explorer');
  assert.deepEqual([e.state, e.count, e.of], ['progress', 4, 5]);
});

// --- B. round entries ----------------------------------------------------------

test('Gegründet: the first finished session; an open or cancelled one is not', () => {
  const open = sess({ finished: false });
  const first = sess();
  assert.equal(ours(mkRound({ sessions: [open, first] }), 'founded').earnedAt.sessionId, first.id);
  assert.equal(ours(mkRound({ sessions: [sess({ finished: false, cancelled: true })] }), 'founded').state, 'locked');
});

test('Sessions: every tier boundary, both sides', () => {
  for (const [n, tier] of [[9, null], [10, 10], [49, 10], [50, 50], [99, 50], [100, 100], [249, 100], [250, 250]]) {
    assert.equal(ours(mkRound({ sessions: many(n) }), 'sessions').tier, tier, `${n} sessions`);
  }
});

test('Regal: active games only, tiers 25 · 50 · 100 both sides', () => {
  const shelf = (n, extra = []) => [...Array.from({ length: n }, (_, i) => game(`r${i}`, { createdAt: iso(T0 + i * DAY) })), ...extra];
  for (const [n, tier] of [[24, null], [25, 25], [49, 25], [50, 50], [99, 50], [100, 100]]) {
    assert.equal(ours(mkRound({ games: shelf(n) }), 'shelf').tier, tier, `${n} games`);
  }
  const archived = [game('x1', { retired: true }), game('x2', { completed: true }), game('x3', { wish: true })];
  assert.equal(ours(mkRound({ games: shelf(24, archived) }), 'shelf').state, 'progress', 'archive and wish list do not count');
  const e = ours(mkRound({ games: shelf(25) }), 'shelf');
  assert.deepEqual(e.earnedAt, { sessionId: null, at: iso(T0 + 24 * DAY) }, 'dated by the 25th game, no session');
});

test('Einstimmig (secret): every voter gave the played game the top rating', () => {
  const vote = (a, b) => ({ a: { g1: { rating: a }, g2: { rating: 3 } }, b: { g1: { rating: b }, g2: { rating: 4 } } });
  const yes = sess({ gameIds: ['g1', 'g2'], votes: vote(5, 5) });
  assert.equal(ours(mkRound({ sessions: [yes] }), 'unanimous').earnedAt.sessionId, yes.id);
  assert.equal(ours(mkRound({ sessions: [sess({ gameIds: ['g1', 'g2'], votes: vote(5, 4) })] }), 'unanimous').state, 'secret');
  // One voter is not a group, and a direct pick asked nobody.
  const alone = sess({ gameIds: ['g1', 'g2'], votes: { a: { g1: { rating: 5 } } } });
  assert.equal(ours(mkRound({ sessions: [alone] }), 'unanimous').state, 'secret');
  assert.equal(ours(mkRound({ sessions: [sess()] }), 'unanimous').state, 'secret');
  // A guest who voted is a voter too.
  const guest = sess({ gameIds: ['g1', 'g2'], guests: [{ id: 'q', name: 'Q' }],
    votes: { ...vote(5, 5), q: { g1: { rating: 4 } } } });
  assert.equal(ours(mkRound({ sessions: [guest] }), 'unanimous').state, 'secret');
});

test('Unentschieden (secret): first place of the vote shared, as the result screen ranks it', () => {
  const tied = sess({ gameIds: ['g1', 'g2', 'g3'], votes: { a: { g1: { rating: 4 }, g2: { rating: 4 }, g3: { rating: 2 } }, b: { g1: { rating: 4 }, g2: { rating: 4 }, g3: { rating: 1 } } } });
  assert.equal(ours(mkRound({ sessions: [tied] }), 'tie').earnedAt.sessionId, tied.id);
  const clear = sess({ gameIds: ['g1', 'g2'], votes: { a: { g1: { rating: 5 }, g2: { rating: 4 } }, b: { g1: { rating: 4 }, g2: { rating: 4 } } } });
  assert.equal(ours(mkRound({ sessions: [clear] }), 'tie').state, 'secret');
  // A tie below first place is no Unentschieden.
  const lower = sess({ gameIds: ['g1', 'g2', 'g3'], votes: { a: { g1: { rating: 5 }, g2: { rating: 3 }, g3: { rating: 3 } } } });
  assert.equal(ours(mkRound({ sessions: [lower] }), 'tie').state, 'secret');
});

test('Große Runde: 8 at the table with guests counting; 7 misses', () => {
  const members = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, name: `M${i}` }));
  const ids = members.map((m) => m.id);
  const two = [{ id: 'q1', name: 'Q1' }, { id: 'q2', name: 'Q2' }];
  assert.equal(BADGE_BIG_TABLE, 8);
  assert.equal(ours(mkRound({ members, sessions: [sess({ memberIds: ids, guests: two })] }), 'bigTable').state, 'earned');
  assert.equal(ours(mkRound({ members, sessions: [sess({ memberIds: ids, guests: two.slice(1) })] }), 'bigTable').state, 'locked');
});

test('Durchgespielt: the first game marked completed, dated by it', () => {
  const games = [game('g1', { completed: true, completedAt: iso(T0 + 9 * DAY) }), game('g2', { completed: true, completedAt: iso(T0 + 3 * DAY) })];
  assert.deepEqual(ours(mkRound({ games }), 'completed').earnedAt, { sessionId: null, at: iso(T0 + 3 * DAY) });
  assert.equal(ours(mkRound(), 'completed').state, 'locked');
});

test('Dauerbrenner: one game at 10 plays, naming the game; 9 misses', () => {
  const ten = [...many(3, { chosenGameId: 'g2' }), ...many(BADGE_EVERGREEN_PLAYS)];
  const e = ours(mkRound({ sessions: ten }), 'evergreen');
  assert.equal(e.state, 'earned');
  assert.equal(e.gameId, 'g1');
  assert.equal(e.earnedAt.sessionId, ten[ten.length - 1].id);
  const nine = ours(mkRound({ sessions: [...many(9), ...many(5, { chosenGameId: 'g2' })] }), 'evergreen');
  assert.deepEqual([nine.state, nine.count, nine.of, nine.gameId], ['progress', 9, 10, 'g1']);
});

// --- holders, states, newSince --------------------------------------------------

test('guests never hold marks; a retired member keeps theirs', () => {
  const members = [{ id: 'a', name: 'A', retired: true }, { id: 'b', name: 'B' }];
  const res = all(mkRound({ members, sessions: [sess({ guests: [{ id: 'q', name: 'Q' }], winnerIds: ['q'] }), sess({ winnerIds: ['a'] })] }));
  assert.deepEqual(Object.keys(res.members), ['a', 'b']);
  assert.equal(res.members.a.find((e) => e.key === 'firstWin').state, 'earned');
});

test('an empty round: every member entry locked or secret, nothing earned, nothing new', () => {
  const res = all(mkRound({ games: [] }));
  const every = [...res.round, ...res.members.a];
  assert.equal(every.length, 17);
  assert.ok(every.every((e) => e.state === 'locked' || e.state === 'secret'));
  assert.ok(every.every((e) => !e.isNew && e.earnedAt === null));
});

test('isNew marks exactly what the latest finished session earned', () => {
  const ss = [...many(9), sess({ winnerIds: ['a'] })];
  const res = all(mkRound({ sessions: ss }));
  const fresh = [...res.round, ...res.members.a, ...res.members.b].filter((e) => e.isNew).map((e) => e.key);
  assert.deepEqual(fresh.sort(), ['evergreen', 'firstWin', 'regular', 'regular', 'sessions'], 'g1 was the tenth play too');
});

test('newSince returns exactly the entries (and tiers) a session first satisfied', () => {
  const ss = many(25);
  const r = mkRound({ sessions: ss });
  assert.deepEqual(newSince(r, ss[9].id, { deps: DEPS }).map((e) => [e.key, e.memberId, e.tier]),
    [['regular', 'a', 10], ['regular', 'b', 10], ['sessions', null, 10], ['evergreen', null, null]]);
  assert.deepEqual(newSince(r, ss[0].id, { deps: DEPS }).map((e) => [e.key, e.memberId]), [['founded', null]]);
  assert.deepEqual(newSince(r, ss[10].id, { deps: DEPS }), [], 'a session that crossed nothing earned nothing');
  assert.deepEqual(newSince(r, ss[24].id, { deps: DEPS }).map((e) => [e.key, e.memberId, e.tier]),
    [['regular', 'a', 25], ['regular', 'b', 25]]);
  assert.deepEqual(newSince(r, null, { deps: DEPS }), []);
});

test('deleting the session that earned a mark removes it — nothing is stored', () => {
  const win = sess({ winnerIds: ['a'] });
  const r = mkRound({ sessions: [sess(), win] });
  assert.equal(mine(r, 'firstWin').state, 'earned');
  r.sessions = r.sessions.filter((s) => s !== win);
  assert.equal(mine(r, 'firstWin').state, 'locked');
});

test('replay follows createdAt, not the stored order', () => {
  const late = sess({ winnerIds: ['a'] });
  const early = sess({ winnerIds: ['a'], createdAt: iso(T0 - DAY) });
  assert.equal(mine(mkRound({ sessions: [late, early] }), 'firstWin').earnedAt.sessionId, early.id);
});

// --- C. the account --------------------------------------------------------------

test('account tiers: Sessions 25 · 100 · 500, Siege 10 · 50, Runden 2 · 5, both sides', () => {
  const at = (stats, key) => accountBadges(stats, null, T0).find((e) => e.key === key);
  for (const [n, tier] of [[24, null], [25, 25], [99, 25], [100, 100], [499, 100], [500, 500]]) {
    assert.equal(at({ sessions: n }, 'accountSessions').tier, tier, `${n} sessions`);
  }
  for (const [n, tier] of [[9, null], [10, 10], [49, 10], [50, 50]]) assert.equal(at({ wins: n }, 'accountWins').tier, tier);
  for (const [n, tier] of [[1, null], [2, 2], [4, 2], [5, 5]]) assert.equal(at({ rounds: n }, 'accountRounds').tier, tier);
  const zero = at({}, 'accountWins');
  assert.deepEqual([zero.state, zero.count, zero.of], ['locked', 0, 10]);
});

test('account Jahre: each anniversary, both sides of it', () => {
  const created = '2024-03-10T12:00:00.000Z';
  const years = (now) => accountBadges({}, created, Date.parse(now)).find((e) => e.key === 'accountYears');
  assert.equal(years('2025-03-10T11:59:59.000Z').tier, null);
  assert.equal(years('2025-03-10T12:00:00.000Z').tier, 1);
  const y = years('2027-03-10T12:00:00.000Z');
  assert.equal(y.tier, 3);
  assert.deepEqual(y.earnedAt, { sessionId: null, at: '2027-03-10T12:00:00.000Z' });
  assert.equal(accountBadges({}, 'not a date', T0).find((e) => e.key === 'accountYears').state, 'locked');
  assert.equal(accountBadges(null, created).length, 4, 'now defaults to the clock');
});
