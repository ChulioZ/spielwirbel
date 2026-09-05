'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { periodsOf, periodRecap, periodKeyOf } = require('../public/js/period-recap');
// The real resolvers, not stand-ins — same reasoning as test/recap.test.js: the
// member/guest split and the retirement-is-zero rule are things these
// assertions depend on, so a simplified fake would test the wrong rules.
const { sessionPeople } = require('../public/js/session-people');
const { effectiveRating } = require('../public/js/vote-scale');
const { RECAP_MIN_RATINGS } = require('../public/js/recap');
const { scoreRatings, shelfScore, roundPrior, playCounts } = require('../public/js/vote-score');
const { isActiveGame } = require('../public/js/draw-pool');

const deps = {
  peopleOf: sessionPeople, ratingOf: effectiveRating, scoreOf: scoreRatings,
  // The shelf half (#894): the real ones, never a stub — a substituted shrinkage
  // is exactly the drift this file's injection discipline exists to prevent.
  shelfOf: shelfScore, priorOf: roundPrior, playsOf: playCounts,
  minRatings: RECAP_MIN_RATINGS, isActive: isActiveGame,
};

// ---- fixtures -------------------------------------------------------------

// Timestamps are built from LOCAL calendar components and serialized to UTC, so
// a fixture dated "July 15" really is July 15 on the machine running the test.
// Writing '2026-07-15T…Z' literals instead would bucket into June or August
// depending on the runner's timezone, which is exactly the bug these assertions
// would then hide (CI runs UTC, a laptop does not).
const at = (y, m, d, hh = 20) => new Date(y, m - 1, d, hh, 0, 0).toISOString();

let seq = 0;
// `votes` is { personId: { gameId: rating } } for brevity, as in recap.test.js.
const session = (when, votes, opts = {}) => ({
  id: `s${++seq}`,
  createdAt: when,
  finished: opts.finished !== false,
  cancelled: opts.cancelled || undefined,
  chosenGameId: opts.chosen || null,
  gameIds: opts.gameIds || Object.keys(Object.values(votes || {})[0] || {}),
  votes: Object.fromEntries(
    Object.entries(votes || {}).map(([pid, byGame]) => [
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
    { id: 'm3', name: 'Cleo' },
  ],
  games: over.games || [
    { id: 'g1', title: 'Catan' },
    { id: 'g2', title: 'Azul' },
    { id: 'g3', title: 'Dune' },
  ],
  sessions: over.sessions || [],
});

const month = (key) => ({ kind: 'month', key });
const year = (key) => ({ kind: 'year', key });

// ---- period derivation ----------------------------------------------------

test('periods are derived from finished sessions and shelf activity, newest first, months before years', () => {
  const r = round({
    sessions: [
      session(at(2026, 7, 15), null, { chosen: 'g1' }),
      session(at(2025, 3, 4), null, { chosen: 'g2' }),
    ],
  });
  const acts = [{ type: 'game_added', at: at(2026, 8, 2), gameId: 'g3', title: 'Dune' }];
  assert.deepEqual(
    periodsOf(r, acts).map((p) => `${p.kind}:${p.key}`),
    ['month:2026-08', 'month:2026-07', 'month:2025-03', 'year:2026', 'year:2025']
  );
});

test('a month with neither a session nor a shelf change is never offered', () => {
  const r = round({
    sessions: [session(at(2026, 5, 9), null, { chosen: 'g1' }), session(at(2026, 7, 9), null, { chosen: 'g1' })],
  });
  const keys = periodsOf(r, []).map((p) => p.key);
  assert.ok(keys.includes('2026-05') && keys.includes('2026-07'));
  assert.ok(!keys.includes('2026-06'), 'June has no content and must not be a picker row');
});

test('an unfinished or cancelled session contributes no period at all', () => {
  const r = round({
    sessions: [
      session(at(2026, 4, 3), null, { finished: false }),
      session(at(2026, 5, 3), null, { finished: false, cancelled: true }),
    ],
  });
  assert.deepEqual(periodsOf(r, []), []);
});

test('periodKeyOf buckets a timestamp by the LOCAL calendar', () => {
  assert.deepEqual(periodKeyOf(at(2026, 1, 31, 23)), { month: '2026-01', year: '2026' });
});

// ---- counts ---------------------------------------------------------------

test('sessions and distinct games played are counted per period, and the year aggregates its months', () => {
  const r = round({
    sessions: [
      session(at(2026, 7, 2), null, { chosen: 'g1' }),
      session(at(2026, 7, 9), null, { chosen: 'g1' }),
      session(at(2026, 8, 9), null, { chosen: 'g2' }),
    ],
  });
  assert.deepEqual(
    { s: periodRecap(r, [], month('2026-07'), deps).sessions, g: periodRecap(r, [], month('2026-07'), deps).gamesPlayed },
    { s: 2, g: 1 }
  );
  const y = periodRecap(r, [], year('2026'), deps);
  assert.equal(y.sessions, 3);
  assert.equal(y.gamesPlayed, 2);
});

test('a cancelled or unfinished session is excluded from every number', () => {
  const r = round({
    sessions: [
      session(at(2026, 7, 2), { m1: { g1: 5 }, m2: { g1: 5 }, m3: { g1: 5 } }, { chosen: 'g1' }),
      session(at(2026, 7, 3), { m1: { g2: 5 }, m2: { g2: 5 }, m3: { g2: 5 } }, { chosen: 'g2', finished: false, cancelled: true }),
      session(at(2026, 7, 4), { m1: { g3: 5 }, m2: { g3: 5 }, m3: { g3: 5 } }, { chosen: 'g3', finished: false }),
    ],
  });
  const rec = periodRecap(r, [], month('2026-07'), deps);
  assert.equal(rec.sessions, 1);
  assert.equal(rec.gamesPlayed, 1);
  assert.deepEqual(rec.topPlayed.gameIds, ['g1']);
  assert.deepEqual(rec.topRated.gameIds, ['g1'], 'votes cast in a session that never happened must not crown a game');
});

test('a tie on most-played names every tied game, not an arbitrary one', () => {
  const r = round({
    sessions: [
      session(at(2026, 7, 2), null, { chosen: 'g1' }),
      session(at(2026, 7, 3), null, { chosen: 'g2' }),
      session(at(2026, 7, 4), null, { chosen: 'g3' }),
    ],
  });
  const top = periodRecap(r, [], month('2026-07'), deps).topPlayed;
  assert.deepEqual([...top.gameIds].sort(), ['g1', 'g2', 'g3']);
  assert.equal(top.count, 1);
});

test('a period with no session at all reports zeroes and no game', () => {
  const r = round({ sessions: [session(at(2026, 7, 2), null, { chosen: 'g1' })] });
  const acts = [{ type: 'game_added', at: at(2026, 9, 2), gameId: 'g3', title: 'Dune' }];
  const rec = periodRecap(r, acts, month('2026-09'), deps);
  assert.deepEqual(
    { sessions: rec.sessions, gamesPlayed: rec.gamesPlayed, topPlayed: rec.topPlayed, topRated: rec.topRated },
    { sessions: 0, gamesPlayed: 0, topPlayed: null, topRated: null }
  );
  assert.equal(rec.added, 1, 'the shelf change is why this period exists');
});

// ---- best rated -----------------------------------------------------------

test('a game rated by fewer than RECAP_MIN_RATINGS voters in the period is not crowned', () => {
  const r = round({
    sessions: [session(at(2026, 7, 2), { m1: { g1: 5 }, m2: { g1: 5 } }, { chosen: 'g1' })],
  });
  assert.equal(RECAP_MIN_RATINGS, 3);
  assert.equal(periodRecap(r, [], month('2026-07'), deps).topRated, null);
});

test('the threshold counts ratings inside the period only, never the round total', () => {
  const r = round({
    sessions: [
      session(at(2026, 6, 2), { m1: { g1: 5 }, m2: { g1: 5 } }, { chosen: 'g1' }),
      session(at(2026, 7, 2), { m1: { g1: 5 } }, { chosen: 'g1' }),
    ],
  });
  assert.equal(periodRecap(r, [], month('2026-07'), deps).topRated, null, 'one July rating is one rating');
  assert.equal(periodRecap(r, [], year('2026'), deps).topRated.gameIds[0], 'g1', 'three across the year clears it');
});

test('votes for a game that has since been deleted are dropped', () => {
  const r = round({
    games: [{ id: 'g1', title: 'Catan' }],
    sessions: [session(at(2026, 7, 2), { m1: { gone: 5 }, m2: { gone: 5 }, m3: { gone: 5 } }, { chosen: 'g1' })],
  });
  assert.equal(periodRecap(r, [], month('2026-07'), deps).topRated, null);
});

test('a retirement proposal counts as the zero it is', () => {
  const r = round({
    sessions: [
      {
        id: 'sx', createdAt: at(2026, 7, 2), finished: true, gameIds: ['g1'],
        votes: { m1: { g1: { rating: 5, retire: true } }, m2: { g1: { rating: 0 } }, m3: { g1: { rating: 0 } } },
      },
    ],
  });
  /* Three retirement proposals, one of them over a stored 5. TILE_VALUE[0] is
     −6, so the game's own score is exactly that — and since #894 the card prints
     it shrunk toward the shelf's prior: no other game is rated, so the prior is
     PRIOR_DEFAULT and nothing was played, giving (3·−6 + 4·3) / 7 = −6/7.
     The number still discriminates: had the stored 5 won, the raw score would be
     (5 − 6 − 6) / 3 ≈ −2,33 and the printed one +5/7 ≈ 0,71. */
  const top = periodRecap(r, [], month('2026-07'), deps).topRated;
  assert.equal(Number(top.score.toFixed(4)), Number((-6 / 7).toFixed(4)));
  assert.ok(top.score < 0, 'three retirement proposals must stay firmly negative');
});

test('a tie on best-rated names every tied game', () => {
  // Neither game was chosen, so the two are tied on every input. It used to say
  // `chosen: 'g1'`, which since #894 is no longer a tie at all — see the test
  // below, which pins that on purpose rather than leaving it as the accident
  // that made this one fail.
  const r = round({
    sessions: [session(at(2026, 7, 2), { m1: { g1: 5, g2: 5 }, m2: { g1: 5, g2: 5 }, m3: { g1: 5, g2: 5 } })],
  });
  assert.deepEqual([...periodRecap(r, [], month('2026-07'), deps).topRated.gameIds].sort(), ['g1', 'g2']);
});

test('a play breaks a tie between two identically rated games (#894)', () => {
  // The play lift is evidence, not decoration: of two games the group rated
  // exactly alike, the one they actually put on the table is the better bet.
  // The card is „Bestbewertet" and this makes it partly about plays — which is
  // deliberate and matches the all-time card beside it, since both read the same
  // shelf score (test/chronik-period-recap.test.js pins that they agree).
  const r = round({
    sessions: [session(at(2026, 7, 2), { m1: { g1: 5, g2: 5 }, m2: { g1: 5, g2: 5 }, m3: { g1: 5, g2: 5 } }, { chosen: 'g1' })],
  });
  const top = periodRecap(r, [], month('2026-07'), deps).topRated;
  assert.deepEqual(top.gameIds, ['g1'], 'the played one wins outright');
});

// ---- shelf changes --------------------------------------------------------

test('shelf changes are counted per period from the activity feed', () => {
  const r = round({ sessions: [] });
  const acts = [
    { type: 'game_added', at: at(2026, 7, 3), gameId: 'g1' },
    { type: 'game_added', at: at(2026, 7, 4), gameId: 'g2' },
    { type: 'game_retired', at: at(2026, 7, 5), gameId: 'g3' },
    { type: 'game_completed', at: at(2026, 7, 6), gameId: 'g1' },
    { type: 'game_added', at: at(2026, 8, 1), gameId: 'g3' },
  ];
  const jul = periodRecap(r, acts, month('2026-07'), deps);
  assert.deepEqual({ added: jul.added, retired: jul.retired, completed: jul.completed }, { added: 2, retired: 1, completed: 1 });
  assert.equal(periodRecap(r, acts, year('2026'), deps).added, 3);
});

test('a bulk import contributes its count, not one game', () => {
  const r = round({ sessions: [] });
  const acts = [{ type: 'games_imported', at: at(2026, 7, 3), count: 12 }];
  assert.equal(periodRecap(r, acts, month('2026-07'), deps).added, 12);
});

test('a bulk retire contributes its count, and games moved in are shelf growth', () => {
  const r = round({ sessions: [] });
  const acts = [
    { type: 'games_retired', at: at(2026, 7, 3), count: 7 },
    { type: 'games_moved_in', at: at(2026, 7, 4), count: 5, roundName: 'Andere' },
  ];
  const rec = periodRecap(r, acts, month('2026-07'), deps);
  assert.deepEqual({ added: rec.added, retired: rec.retired }, { added: 5, retired: 7 });
});

test('a move OUT and a deletion are neither retired nor completed', () => {
  const r = round({ sessions: [] });
  const acts = [
    { type: 'games_moved_out', at: at(2026, 7, 3), count: 4, roundName: 'Andere' },
    { type: 'game_deleted', at: at(2026, 7, 4), gameId: 'g9' },
    { type: 'game_added', at: at(2026, 7, 5), gameId: 'g1' },
  ];
  const rec = periodRecap(r, acts, month('2026-07'), deps);
  assert.deepEqual({ added: rec.added, retired: rec.retired, completed: rec.completed }, { added: 1, retired: 0, completed: 0 });
});

/* A copy IN is shelf growth like a move in — those games are on this shelf now.
   A copy OUT is in no bucket at all, and unlike a move out that is not even a
   judgement call: nothing left the source shelf, so it changed none of the three
   numbers. Both arms are asserted, because a mapping that counted the copy out
   as growth would still pass a test that only looked at the copy in. */
test('a copy IN is shelf growth; a copy OUT changes nothing (#916)', () => {
  const r = round({ sessions: [] });
  const rec = periodRecap(r, [
    { type: 'games_copied_in', at: at(2026, 7, 4), count: 5, roundName: 'Andere' },
    { type: 'games_copied_out', at: at(2026, 7, 5), count: 9, roundName: 'Andere' },
  ], month('2026-07'), deps);
  assert.deepEqual({ added: rec.added, retired: rec.retired, completed: rec.completed },
    { added: 5, retired: 0, completed: 0 });

  // On its own, a copy out is not even a period worth offering.
  assert.deepEqual(periodsOf(round({ sessions: [] }),
    [{ type: 'games_copied_out', at: at(2026, 7, 5), count: 9, roundName: 'Andere' }]), []);
});

test('an activity type the recap does not count still never creates a period', () => {
  const r = round({ sessions: [] });
  const acts = [{ type: 'round_renamed', at: at(2026, 7, 3), name: 'Neu' }];
  assert.deepEqual(periodsOf(r, acts), []);
});

test('a missing or malformed activity feed is survivable', () => {
  const r = round({ sessions: [session(at(2026, 7, 2), null, { chosen: 'g1' })] });
  assert.equal(periodsOf(r, undefined).length, 2);
  assert.equal(periodRecap(r, undefined, month('2026-07'), deps).sessions, 1);
});

/* The Pokale tab's retired-game rule (#643) reaches this card too, and it has to
   — the period card renders under the SAME „Bestbewertet" label as the all-time
   one, which is deliberately active-shelf-only. Two cards with one label
   disagreeing about whether a retired game may be named would be incoherent
   whichever answer is right in the abstract.

   Written to fail in both directions, like test/pokale-retired.test.js: the
   retired game leads on average (so a missing filter names it) and the
   runner-up is COMPLETED (so filtering only `retired` names the wrong game).
   Meistgespielt above is untouched — it is a record of nights that happened,
   not a claim of taste. */
test('the best-rated card skips a retired game AND a completed one', () => {
  const r = round({
    games: [
      { id: 'g1', title: 'Catan' },
      { id: 'g2', title: 'Azul', retired: true },
      { id: 'g3', title: 'Dune', completed: true },
    ],
    sessions: [
      session(at(2026, 7, 2), {
        m1: { g1: 3, g2: 5, g3: 4 },
        m2: { g1: 3, g2: 5, g3: 4 },
        m3: { g1: 3, g2: 5, g3: 4 },
      }, { chosen: 'g2' }),
    ],
  });
  const rec = periodRecap(r, [], month('2026-07'), deps);
  assert.deepEqual(rec.topRated.gameIds, ['g1']);
  // All 3s, and f(3) = 3 is one of the curve's pinned anchors — so the score
  // and the old raw mean coincide here, which is what makes it a clean fixture.
  assert.equal(rec.topRated.score, 3);
  // …while the record card still names the retired game the group played.
  assert.deepEqual(rec.topPlayed.gameIds, ['g2']);
});

test('a period whose only rated games are archived crowns nothing', () => {
  const r = round({
    games: [{ id: 'g2', title: 'Azul', retired: true }],
    sessions: [session(at(2026, 7, 2), { m1: { g2: 5 }, m2: { g2: 5 }, m3: { g2: 5 } }, { chosen: 'g2' })],
  });
  assert.equal(periodRecap(r, [], month('2026-07'), deps).topRated, null);
});
