'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RECAP_MIN_RATINGS, roundRecap } = require('../public/js/recap');
// The real resolver, not a stand-in: the member/guest split is the thing most of
// these assertions are about, so a simplified fake would test the wrong rules
// (.claude/rules/session-guests-are-not-members.md).
const { sessionPeople } = require('../public/js/session-people');

// ---- fixtures -------------------------------------------------------------

// A session where `votes` is { personId: { gameId: rating } } for brevity.
let seq = 0;
const session = (votes, opts = {}) => ({
  id: `s${++seq}`,
  createdAt: `2026-07-${String(seq).padStart(2, '0')}T20:00:00.000Z`,
  finished: opts.finished !== false,
  gameIds: opts.gameIds || Object.keys(Object.values(votes)[0] || {}),
  guests: opts.guests || undefined,
  votes: Object.fromEntries(
    Object.entries(votes).map(([pid, byGame]) => [
      pid,
      Object.fromEntries(Object.entries(byGame).map(([gid, rating]) => [gid, { rating }])),
    ])
  ),
});

const round = (over = {}) => ({
  id: 'r1',
  members: over.members || [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
  ],
  games: over.games || [
    { id: 'g1', title: 'Catan' },
    { id: 'g2', title: 'Azul' },
  ],
  sessions: over.sessions || [],
});

const recapOf = (r) => roundRecap(r, sessionPeople);

// Ratings for one game from as many distinct members as needed to clear the
// evidence bar, all at the same value.
const flat = (gameId, value, members) =>
  session(Object.fromEntries(members.map((m) => [m, { [gameId]: value }])));

// ---- totals ---------------------------------------------------------------

test('totals count finished sessions, the active shelf, the archive and every rating', () => {
  const r = round({
    games: [
      { id: 'g1', title: 'Catan' },
      { id: 'g2', title: 'Azul' },
      { id: 'g3', title: 'Alt', retired: true },
      { id: 'g4', title: 'Fertig', completed: true },
    ],
    sessions: [
      session({ m1: { g1: 4 }, m2: { g1: 2 } }),
      session({ m1: { g2: 5 } }, { finished: false }),
    ],
  });
  assert.deepEqual(recapOf(r).totals, { sessions: 1, games: 2, archived: 2, ratings: 3 });
});

test('an unfinished session still contributes its ratings, like the game detail ring does', () => {
  const r = round({ sessions: [session({ m1: { g1: 5 } }, { finished: false })] });
  const rec = recapOf(r);
  assert.equal(rec.totals.sessions, 0);
  assert.equal(rec.totals.ratings, 1);
});

test('votes for a deleted game are ignored rather than naming a game that is gone', () => {
  const r = round({ sessions: [session({ m1: { g1: 5, gGONE: 5 }, m2: { g1: 5, gGONE: 1 } })] });
  assert.equal(recapOf(r).totals.ratings, 2);
});

// ---- best / worst ---------------------------------------------------------

test('best and worst need RECAP_MIN_RATINGS ratings behind them', () => {
  const members = ['m1', 'm2', 'm3'];
  const r = round({
    members: members.map((id) => ({ id, name: id })),
    sessions: [flat('g1', 5, members.slice(0, RECAP_MIN_RATINGS - 1))],
  });
  assert.equal(recapOf(r).best, null, 'one rating short of the bar');

  r.sessions.push(flat('g1', 5, members.slice(RECAP_MIN_RATINGS - 1)));
  assert.deepEqual(recapOf(r).best, { gameIds: ['g1'], avg: 5 });
});

test('worst is withheld while a single game holds both ends', () => {
  const members = ['m1', 'm2', 'm3'];
  const r = round({
    members: members.map((id) => ({ id, name: id })),
    sessions: [flat('g1', 4, members)],
  });
  const rec = recapOf(r);
  assert.deepEqual(rec.best, { gameIds: ['g1'], avg: 4 });
  assert.equal(rec.worst, null, 'the same title must not be announced as best and worst');
});

test('best and worst separate once a second game qualifies, and ties share a card', () => {
  const members = ['m1', 'm2', 'm3'];
  const r = round({
    members: members.map((id) => ({ id, name: id })),
    games: [
      { id: 'g1', title: 'Catan' },
      { id: 'g2', title: 'Azul' },
      { id: 'g3', title: 'Dixit' },
    ],
    sessions: [flat('g1', 5, members), flat('g2', 2, members), flat('g3', 2, members)],
  });
  const rec = recapOf(r);
  assert.deepEqual(rec.best, { gameIds: ['g1'], avg: 5 });
  assert.deepEqual(rec.worst, { gameIds: ['g2', 'g3'], avg: 2 });
});

test('archived games are out of the best/worst pair — it is about the shelf you still have', () => {
  const members = ['m1', 'm2', 'm3'];
  const r = round({
    members: members.map((id) => ({ id, name: id })),
    games: [
      { id: 'g1', title: 'Catan' },
      { id: 'g2', title: 'Azul' },
      { id: 'g3', title: 'Weg', retired: true },
    ],
    sessions: [flat('g1', 5, members), flat('g2', 3, members), flat('g3', 1, members)],
  });
  const rec = recapOf(r);
  assert.deepEqual(rec.worst, { gameIds: ['g2'], avg: 3 }, 'the retired 1.0 must not win worst');
});

test("a guest's rating moves the average, so the recap cannot contradict the game's own ring", () => {
  const withGuest = session(
    { m1: { g1: 5 }, m2: { g1: 5 }, gu1: { g1: 2 } },
    { guests: [{ id: 'gu1', name: 'Gast' }] }
  );
  const rec = recapOf(round({ sessions: [withGuest] }));
  assert.equal(rec.totals.ratings, 3, 'the guest vote counts');
  assert.equal(rec.best.avg, 4, '(5 + 5 + 2) / 3');
});

// ---- most divisive --------------------------------------------------------

test('the most divisive game is the widest gap between two members', () => {
  const r = round({
    members: [
      { id: 'm1', name: 'Anna' },
      { id: 'm2', name: 'Ben' },
      { id: 'm3', name: 'Cem' },
    ],
    sessions: [
      session({ m1: { g1: 5, g2: 3 }, m2: { g1: 1, g2: 4 }, m3: { g1: 3, g2: 3 } }),
    ],
  });
  const d = recapOf(r).divisive;
  assert.equal(d.gameId, 'g1');
  assert.equal(d.spread, 4);
  assert.equal(d.high.memberId, 'm1');
  assert.equal(d.low.memberId, 'm2');
});

test('a guest never appears in the disagreement — their id is session-scoped', () => {
  const r = round({
    sessions: [
      session(
        { m1: { g1: 3 }, m2: { g1: 3 }, gu1: { g1: 1 } },
        { guests: [{ id: 'gu1', name: 'Gast' }] }
      ),
    ],
  });
  assert.equal(recapOf(r).divisive, null, 'members agree; only the guest differs');
});

test('a game everyone agrees on is not divisive at all', () => {
  const members = ['m1', 'm2', 'm3'];
  const r = round({
    members: members.map((id) => ({ id, name: id })),
    sessions: [flat('g1', 4, members)],
  });
  assert.equal(recapOf(r).divisive, null);
});

test('votes from someone who is neither a current member nor a guest are never read', () => {
  const r = round({
    members: [{ id: 'm1', name: 'Anna' }],
    sessions: [session({ m1: { g1: 5 }, mGONE: { g1: 1 }, m2: { g1: 1 } })],
  });
  const rec = recapOf(r);
  // sessionPeople resolves a session's participants against the round's CURRENT
  // members (plus its guests), so a member removed since voting leaves rows in
  // the vote map that no longer belong to anyone — and they must not drag the
  // average of a game they are no longer part of.
  assert.equal(rec.totals.ratings, 1, "only Anna's rating survives the resolver");
  assert.equal(rec.divisive, null, 'nobody is left to disagree with her');
  assert.deepEqual(rec.favourites.map((f) => f.memberId), ['m1']);
});

// ---- member favourites ----------------------------------------------------

test("each member's favourite is their own highest-rated game, not the group's", () => {
  const r = round({
    sessions: [session({ m1: { g1: 5, g2: 2 }, m2: { g1: 1, g2: 4 } })],
  });
  assert.deepEqual(
    recapOf(r).favourites.map((f) => [f.memberId, f.gameId, f.avg]),
    [
      ['m1', 'g1', 5],
      ['m2', 'g2', 4],
    ]
  );
});

test('a favourite averages that member across sessions', () => {
  const r = round({
    sessions: [session({ m1: { g1: 5, g2: 4 } }), session({ m1: { g1: 1 } })],
  });
  const [fav] = recapOf(r).favourites;
  assert.equal(fav.gameId, 'g2', 'g1 averages 3, g2 stays 4');
  assert.equal(fav.avg, 4);
});

test('an archived game may still be a favourite — the record is retrospective', () => {
  const r = round({
    games: [
      { id: 'g1', title: 'Catan' },
      { id: 'g2', title: 'Alt', retired: true },
    ],
    sessions: [session({ m1: { g1: 3, g2: 5 } })],
  });
  assert.equal(recapOf(r).favourites[0].gameId, 'g2');
});

test('members who have not rated anything are left out', () => {
  const r = round({ sessions: [session({ m1: { g1: 4 } })] });
  const favs = recapOf(r).favourites;
  assert.equal(favs.length, 1);
  assert.equal(favs[0].memberId, 'm1');
});

test('a guest gets no favourite card', () => {
  const r = round({
    sessions: [
      session({ m1: { g1: 4 }, gu1: { g1: 5 } }, { guests: [{ id: 'gu1', name: 'Gast' }] }),
    ],
  });
  assert.deepEqual(recapOf(r).favourites.map((f) => f.memberId), ['m1']);
});

// ---- the thin round -------------------------------------------------------

test('a young round yields totals and nothing else, never a throw', () => {
  const r = round({ sessions: [session({ m1: { g1: 4 } })] });
  const rec = recapOf(r);
  assert.deepEqual(rec.totals, { sessions: 1, games: 2, archived: 0, ratings: 1 });
  assert.equal(rec.best, null);
  assert.equal(rec.worst, null);
  assert.equal(rec.divisive, null);
  assert.equal(rec.favourites.length, 1);
});

test('a round with no sessions at all is all zeros', () => {
  const rec = recapOf(round());
  assert.deepEqual(rec.totals, { sessions: 0, games: 2, archived: 0, ratings: 0 });
  assert.deepEqual(rec.favourites, []);
});

test('a session carrying only retire flags contributes no ratings', () => {
  const r = round({
    sessions: [{ id: 'sx', createdAt: '2026-07-01T20:00:00.000Z', finished: true, gameIds: ['g1'], votes: { m1: { g1: { retire: true } } } }],
  });
  assert.equal(recapOf(r).totals.ratings, 0);
  assert.deepEqual(recapOf(r).favourites, []);
});
