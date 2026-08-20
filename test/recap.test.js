'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RECAP_MIN_RATINGS, roundRecap, isNameableGame } = require('../public/js/recap');
// The real resolver, not a stand-in: the member/guest split is the thing most of
// these assertions are about, so a simplified fake would test the wrong rules
// (.claude/rules/session-guests-are-not-members.md).
const { sessionPeople } = require('../public/js/session-people');
const { effectiveRating } = require('../public/js/vote-scale');

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

const recapOf = (r) => roundRecap(r, sessionPeople, effectiveRating);

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

// ---- what a taste stat may name -------------------------------------------

// The rule itself, not one of its consumers. It is a shared function because
// views-member.js computes the member page's Lieblingsspiel from the raw
// sessions rather than through this file's index, so without it the same rule
// would exist twice (.claude/rules/shared-constants-across-the-stack.md).
test('only retiring takes a game out of the taste stats — completing does not', () => {
  assert.equal(isNameableGame({ id: 'g1', title: 'Catan' }), true);
  assert.equal(isNameableGame({ id: 'g2', title: 'Alt', retired: true }), false);
  assert.equal(isNameableGame({ id: 'g3', title: 'Fertig', completed: true }), true);
  // A game cannot be both (the repo enforces exclusivity), but if one ever were,
  // retired must still win — otherwise the withdrawn preference gets named.
  assert.equal(isNameableGame({ id: 'g4', retired: true, completed: true }), false);
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

// The two archives part company here (#643): a retired game is out of the
// group's collection, so naming it is a contradiction of the act of retiring it;
// a completed one was played through and stays part of the record. The pair is
// deliberately kept side by side so the distinction cannot collapse back into a
// single "archived" filter without one of them going red.
test('a retired game is never the most divisive — the next-widest gap wins instead', () => {
  const r = round({
    games: [
      { id: 'g1', title: 'Catan', retired: true },
      { id: 'g2', title: 'Azul' },
    ],
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
  assert.equal(d.gameId, 'g2', 'g1 has the wider spread but is retired');
  assert.equal(d.spread, 1);
});

test('a completed game may still be the most divisive — it was played through', () => {
  const r = round({
    games: [
      { id: 'g1', title: 'Catan', completed: true },
      { id: 'g2', title: 'Azul' },
    ],
    members: [
      { id: 'm1', name: 'Anna' },
      { id: 'm2', name: 'Ben' },
      { id: 'm3', name: 'Cem' },
    ],
    sessions: [
      session({ m1: { g1: 5, g2: 3 }, m2: { g1: 1, g2: 4 }, m3: { g1: 3, g2: 3 } }),
    ],
  });
  assert.equal(recapOf(r).divisive.gameId, 'g1');
});

test('a round whose only divisive game is retired has no disagreement to show', () => {
  const r = round({
    games: [{ id: 'g1', title: 'Catan', retired: true }],
    members: [
      { id: 'm1', name: 'Anna' },
      { id: 'm2', name: 'Ben' },
      { id: 'm3', name: 'Cem' },
    ],
    sessions: [session({ m1: { g1: 5 }, m2: { g1: 1 }, m3: { g1: 3 } })],
  });
  assert.equal(recapOf(r).divisive, null);
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

// This pair replaces a single spec that asserted the opposite for BOTH archives
// ("an archived game may still be a favourite — the record is retrospective").
// #643 split them: retiring is the user saying the game has left the collection,
// so it must not be named; completing is not, so it still may be.
test('a retired game is skipped — the member keeps their best non-retired favourite', () => {
  const r = round({
    games: [
      { id: 'g1', title: 'Catan' },
      { id: 'g2', title: 'Alt', retired: true },
    ],
    sessions: [session({ m1: { g1: 3, g2: 5 } })],
  });
  const [fav] = recapOf(r).favourites;
  assert.equal(fav.gameId, 'g1', 'g2 rates higher but is retired');
  assert.equal(fav.avg, 3);
});

test('a completed game may still be a favourite — the record is retrospective', () => {
  const r = round({
    games: [
      { id: 'g1', title: 'Catan' },
      { id: 'g2', title: 'Fertig', completed: true },
    ],
    sessions: [session({ m1: { g1: 3, g2: 5 } })],
  });
  assert.equal(recapOf(r).favourites[0].gameId, 'g2');
});

test('a member who has rated nothing but retired games drops out of the favourites', () => {
  const r = round({
    games: [
      { id: 'g1', title: 'Catan' },
      { id: 'g2', title: 'Alt', retired: true },
    ],
    sessions: [session({ m1: { g1: 4 }, m2: { g2: 5 } })],
  });
  assert.deepEqual(
    recapOf(r).favourites.map((f) => f.memberId),
    ['m1'],
    'Ben rated only a retired game, so he has no favourite left to name'
  );
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

/* Inverted by #797. A retire-only vote used to be invisible to every taste stat
   — the strongest thing a member can say about a game they have played simply
   did not count — so a round whose members all wanted a game gone reported no
   ratings at all. It is now a 0, which is a rating like any other. */
test('a session carrying only retire flags contributes ratings of 0', () => {
  const r = round({
    sessions: [{ id: 'sx', createdAt: '2026-07-01T20:00:00.000Z', finished: true, gameIds: ['g1'], votes: { m1: { g1: { rating: null, retire: true } } } }],
  });
  assert.equal(recapOf(r).totals.ratings, 1);
  assert.deepEqual(recapOf(r).favourites, [{ memberId: 'm1', gameId: 'g1', avg: 0, count: 1 }]);
});

// The legacy shape the storage was never migrated for: retirement wins, so this
// member's favourite averages 0 rather than the 5 the stored rating claims.
test('a legacy vote carrying BOTH a rating and the flag counts as 0', () => {
  const r = round({
    sessions: [{ id: 'sx', createdAt: '2026-07-01T20:00:00.000Z', finished: true, gameIds: ['g1'], votes: { m1: { g1: { rating: 5, retire: true } } } }],
  });
  assert.equal(recapOf(r).totals.ratings, 1);
  assert.equal(recapOf(r).favourites[0].avg, 0);
});
