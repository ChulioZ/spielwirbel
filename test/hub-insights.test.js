'use strict';

/* The Start tab's derivations (#923). Pure functions over the round payload, so
   this spec needs no server, no jsdom and no fixtures on disk — it builds the
   shapes the hub actually receives and asserts what each card would say.

   The dependencies are the REAL siblings, required here exactly as the view
   injects them in the browser. Stubbing them would let this spec agree with a
   drifted copy of `sessionOutcome` or `fitsMetadataFilters`, which is the one
   thing the injection shape exists to prevent
   (.claude/rules/shared-constants-across-the-stack.md). */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SUGGEST_MIN_SHELF, PULSE_MONTHS,
  gameSuggestions, quickPresets, roundPulse, careList, anniversary,
} = require('../public/js/hub-insights');
const { sessionOutcome } = require('../public/js/session-outcome');
const { periodKeyOf } = require('../public/js/period-recap');
const {
  metadataFilterOptions, normalizeMetadataFilters, fitsMetadataFilters,
} = require('../public/js/draw-pool');
const { PRIOR_DEFAULT } = require('../public/js/vote-score');

const deps = {
  outcomeOf: sessionOutcome,
  monthKeyOf: periodKeyOf,
  neutralScore: PRIOR_DEFAULT,
  filterOptions: metadataFilterOptions,
  normalizeMetadata: normalizeMetadataFilters,
  fitsMetadata: fitsMetadataFilters,
};

// A local timestamp, so every assertion below reads in the same calendar the
// derivations bucket by. Using an ISO Z literal here would put the spec one
// timezone away from the code under test and make the month cases flap.
const at = (y, m, d, h = 20) => new Date(y, m - 1, d, h, 0, 0).toISOString();
const NOW = new Date(2026, 8, 5, 12).getTime(); // 5 September 2026, local

const game = (id, extra = {}) => ({ id, title: 'G' + id, minPlayers: 2, maxPlayers: 4, image: 'x.jpg', ...extra });
const shelfOf = (n) => Array.from({ length: n }, (_, i) => game('g' + (i + 1)));
const played = (id, gid, when, extra = {}) => ({
  id, createdAt: when, finished: true, done: true,
  gameIds: [gid], chosenGameId: gid, winnerIds: ['m1'], votes: {}, ...extra,
});
const round = (games, sessions) => ({ id: 'r1', games, sessions, members: [{ id: 'm1', name: 'Ada' }] });

// ---------------------------------------------------------------- suggestions

test('gameSuggestions says nothing about a shelf too small to choose from', () => {
  const games = shelfOf(SUGGEST_MIN_SHELF - 1);
  const out = gameSuggestions(round(games, []), games, { now: NOW }, deps);
  assert.deepEqual(out, []);
});

test('gameSuggestions names one game per reason kind, never three of the same', () => {
  const games = shelfOf(8);
  const sessions = [
    played('s1', 'g1', at(2024, 3, 1)),   // long ago
    played('s2', 'g2', at(2026, 9, 1)),   // just played
  ];
  const stats = { g5: { score: 4.8 }, g6: { score: 4.2 } };
  const out = gameSuggestions(round(games, sessions), games, { now: NOW, statsByGame: stats }, deps);
  assert.deepEqual(out.map((r) => r.reason.kind), ['never', 'longAgo', 'loved']);
  // g5 is the best-scored never-played game, so it leads; g1 is the stale one.
  assert.equal(out[0].game.id, 'g5');
  assert.equal(out[1].game.id, 'g1');
  assert.ok(out[1].reason.months >= 3, 'the stale row states how many months');
  // The runner-up, NOT g5 again — a candidate an earlier row claimed must be
  // skipped at SELECTION time, or the whole third row silently disappears.
  assert.equal(out[2].game.id, 'g6');
});

test('gameSuggestions never proposes an excluded game, even when it would lead', () => {
  /* THIS IS THE ONLY PLACE THE EXCLUSION CAN BE TESTED, and it is worth saying
     why the obvious place cannot.

     In the running app the two features are arithmetically coupled: the
     retirement banner proposes a game whose RAW score is at or below 1.0, and
     shrinkage never lifts a score above the prior it shrinks toward — so a
     nagged game is always below the `>= neutral` floor the rows apply anyway,
     and deleting the exclusion changes nothing on screen. Measured: with
     `nagged` replaced by an empty set, test/hub-start-cards.test.js stays green.

     The exclusion is kept regardless, because those two thresholds are
     independently tunable and a future retune of either breaks the coincidence
     silently. What that means for testing is that it has to be pinned HERE,
     where `exclude` and `statsByGame` are separate arguments and the coupling
     does not exist — a synthetic 4.8 on the excluded game is a state the app
     cannot currently produce, which is exactly what makes the assertion able to
     fail. */
  const games = shelfOf(8);
  const stats = { g5: { score: 4.8 }, g6: { score: 4.2 } };
  const opts = { now: NOW, statsByGame: stats, exclude: new Set(['g5']) };
  const out = gameSuggestions(round(games, []), games, opts, deps);
  assert.ok(out.length, 'the card said nothing at all, so the exclusion proves nothing');
  assert.ok(!out.some((r) => r.game.id === 'g5'), 'the excluded game was proposed anyway');
  assert.equal(out[0].game.id, 'g6', 'the runner-up did not take its place');
});

test('gameSuggestions will not headline a never-played game the group has already voted down', () => {
  /* „Never played" does not mean „never voted on": a game drawn in two sessions
     but never chosen carries four real ratings while still qualifying for the
     never-played row — and at four votes it is under the retirement banner's
     evidence bar (three times the member count), so nothing else on the screen
     mentions it either.

     THE FIXTURE HAS TO MAKE IT THE ONLY CANDIDATE. With other unrated games on
     the shelf the ordering alone demotes it (an unrated game reads as the prior,
     which is higher), so the floor decides nothing and a test built that way
     passes with the floor deleted — measured. Here every other game was played
     last week, so g1 is the entire never-played set: either it is proposed or
     the row is absent. */
  const games = shelfOf(8);
  const sessions = games.slice(1).map((g, i) => played('s' + i, g.id, at(2026, 8, 25)));
  const stats = { g1: { score: 1.0 } };   // drawn twice, rated {1,1,3,3}
  const out = gameSuggestions(round(games, sessions), games, { now: NOW, statsByGame: stats }, deps);
  assert.ok(!out.some((r) => r.game.id === 'g1'), 'the hub headlined the shelf\'s least-wanted game');

  // Anti-vacuous: the same shelf with that game merely UNRATED must still speak,
  // or this would pass against a build that suggests nothing at all.
  const open = gameSuggestions(round(games, sessions), games, { now: NOW, statsByGame: {} }, deps);
  assert.deepEqual(open.map((r) => r.game.id), ['g1'], 'an unknown game is still worth proposing');
});

test('gameSuggestions keeps the shelf floor measured on the ACTIVE shelf, not on what survives the exclusion', () => {
  const games = shelfOf(SUGGEST_MIN_SHELF);
  const opts = { now: NOW, exclude: new Set(['g1', 'g2', 'g3']) };
  assert.ok(gameSuggestions(round(games, []), games, opts, deps).length > 0);
});

test('gameSuggestions stays quiet about a gap under three months', () => {
  const games = shelfOf(8);
  const sessions = games.map((g, i) => played('s' + i, g.id, at(2026, 8, 20)));
  const out = gameSuggestions(round(games, sessions), games, { now: NOW }, deps);
  assert.ok(!out.some((r) => r.reason.kind === 'longAgo'), 'two weeks is not "long ago"');
});

test('gameSuggestions will not call a merely-tolerated game well liked', () => {
  const games = shelfOf(8);
  // Everything played long ago, so recency rules nothing out — but nothing on
  // this shelf has earned a score above what we assume about a stranger.
  const sessions = games.map((g, i) => played('s' + i, g.id, at(2024, 1, 10 + i)));
  const stats = Object.fromEntries(games.map((g) => [g.id, { score: PRIOR_DEFAULT }]));
  const out = gameSuggestions(round(games, sessions), games, { now: NOW, statsByGame: stats }, deps);
  assert.ok(!out.some((r) => r.reason.kind === 'loved'), 'a flat neutral score is not a recommendation');
});

test('gameSuggestions does not call a just-played game a discovery', () => {
  const games = shelfOf(8);
  // Every game played last week, so nothing is "not played recently".
  const sessions = games.map((g, i) => played('s' + i, g.id, at(2026, 8, 30)));
  const stats = Object.fromEntries(games.map((g) => [g.id, { score: 4.5 }]));
  const out = gameSuggestions(round(games, sessions), games, { now: NOW, statsByGame: stats }, deps);
  assert.ok(!out.some((r) => r.reason.kind === 'loved'));
});

test('gameSuggestions counts a DRAWN game as unplayed — only the chosen one was played', () => {
  const games = shelfOf(8);
  // g3 was drawn and voted on but g1 was the game that hit the table.
  const s = played('s1', 'g1', at(2026, 8, 30));
  s.gameIds = ['g1', 'g3'];
  const out = gameSuggestions(round(games, [s]), games, { now: NOW }, deps);
  const never = out.find((r) => r.reason.kind === 'never');
  assert.ok(never, 'the never-played row exists');
  assert.notEqual(never.game.id, 'g1');
});

// -------------------------------------------------------------------- presets

test('quickPresets offers nothing for a shelf carrying no BGG metadata at all', () => {
  assert.deepEqual(quickPresets(shelfOf(10), deps), []);
});

test('quickPresets offers only the chip whose field the shelf can express', () => {
  const games = shelfOf(6).map((g, i) => (i < 3 ? { ...g, minPlaytime: 30 } : { ...g, minPlaytime: 120 }));
  const ids = quickPresets(games, deps).map((c) => c.id);
  assert.deepEqual(ids, ['short'], 'playtime is the only field on this shelf');
  const chip = quickPresets(games, deps)[0];
  assert.equal(chip.metadata.maxPlaytime, 60, 'the chip carries a real PLAYTIME_CHOICES step');
});

test('quickPresets drops a chip that would narrow nothing', () => {
  // Every game is short, so "unter 60 Min" admits the whole shelf.
  const games = shelfOf(6).map((g) => ({ ...g, minPlaytime: 30 }));
  assert.deepEqual(quickPresets(games, deps), []);
});

test('quickPresets drops a chip that would empty the pool', () => {
  // Every game is long, so "unter 60 Min" admits none of them.
  const games = shelfOf(6).map((g) => ({ ...g, minPlaytime: 180 }));
  assert.deepEqual(quickPresets(games, deps), []);
});

test('quickPresets offers both ends of the complexity range when the shelf spans it', () => {
  const games = shelfOf(6).map((g, i) => ({ ...g, weight: i < 3 ? 1.4 : 3.8 }));
  const ids = quickPresets(games, deps).map((c) => c.id);
  assert.deepEqual(ids, ['light', 'meaty']);
});

// ---------------------------------------------------------------------- pulse

test('roundPulse stays silent until there is a shape to draw', () => {
  const games = shelfOf(4);
  assert.equal(roundPulse(round(games, []), games, { now: NOW }, deps), null);
  const one = [played('s1', 'g1', at(2026, 8, 1))];
  assert.equal(roundPulse(round(games, one), games, { now: NOW }, deps), null);
});

test('roundPulse buckets by the LOCAL month and spans a fixed twelve', () => {
  const games = shelfOf(4);
  const sessions = [
    played('s1', 'g1', at(2026, 9, 1)),
    played('s2', 'g2', at(2026, 9, 3)),
    played('s3', 'g1', at(2026, 7, 4)),
    // 31 July at 22:00 local belongs to the group's July, not to August.
    played('s4', 'g3', at(2026, 7, 31, 22)),
  ];
  const pulse = roundPulse(round(games, sessions), games, { now: NOW }, deps);
  assert.equal(pulse.months.length, PULSE_MONTHS);
  assert.equal(pulse.months.at(-1).key, '2026-09');
  assert.equal(pulse.months.at(-1).count, 2);
  assert.equal(pulse.months.find((m) => m.key === '2026-07').count, 2);
  assert.equal(pulse.months.find((m) => m.key === '2026-08').count, 0, 'an empty month is a zero bar, not a gap');
  assert.equal(pulse.total, 4);
});

test('roundPulse counts a split evening as its TABLES, never as its parent', () => {
  const games = shelfOf(4);
  const parent = {
    id: 'p1', createdAt: at(2026, 9, 2), done: true, finished: false,
    gameIds: [], votes: {}, childSessionIds: ['t1', 't2'],
  };
  const sessions = [
    parent,
    played('t1', 'g1', at(2026, 9, 2), { parentSessionId: 'p1' }),
    played('t2', 'g2', at(2026, 9, 2), { parentSessionId: 'p1' }),
  ];
  const pulse = roundPulse(round(games, sessions), games, { now: NOW }, deps);
  assert.equal(pulse.total, 2, 'two tables, not three sessions and not one parent');
});

test('roundPulse counts only the twelve months it draws — the number cannot contradict the chart', () => {
  const games = shelfOf(4);
  const sessions = [
    played('s1', 'g1', at(2026, 9, 1)),
    played('s2', 'g2', at(2026, 8, 20)),
    played('s3', 'g1', at(2024, 3, 4)),   // two years back: not in the picture
  ];
  const pulse = roundPulse(round(games, sessions), games, { now: NOW }, deps);
  assert.equal(pulse.total, 2, 'a session outside the twelve bars was counted in the headline');
  assert.equal(pulse.total, pulse.months.reduce((n, m) => n + m.count, 0));
});

test('roundPulse is silent for a round whose only evenings predate the window', () => {
  const games = shelfOf(4);
  const sessions = [played('s1', 'g1', at(2023, 5, 1)), played('s2', 'g2', at(2023, 6, 1))];
  assert.equal(roundPulse(round(games, sessions), games, { now: NOW }, deps), null);
});

test('roundPulse reports the days since the last evening and the untouched shelf', () => {
  const games = shelfOf(5);
  const sessions = [played('s1', 'g1', at(2026, 8, 26)), played('s2', 'g2', at(2026, 9, 1))];
  const pulse = roundPulse(round(games, sessions), games, { now: NOW }, deps);
  assert.equal(pulse.daysSinceLast, 3);
  assert.equal(pulse.shelfSize, 5);
  assert.equal(pulse.neverPlayed, 3, 'g3, g4 and g5 have never reached the table');
});

// ----------------------------------------------------------------- Kümmerliste

test('careList says nothing at all about a round that has never played', () => {
  // Two hand-typed games with no cover and no range. That is not a maintenance
  // backlog, it is a shelf someone started five minutes ago — and it was the
  // very first content a brand-new round met before the floor existed.
  const games = [{ id: 'g1', title: 'Azul' }, { id: 'g2', title: 'Cascadia' }];
  const list = careList(round(games, []), games, deps);
  assert.equal(list.empty, true);
  assert.equal(list.coverlessTotal, 0);
  assert.equal(list.noRangeTotal, 0);
});

test('careList reports nothing about a round with nothing to fix', () => {
  const games = shelfOf(3);
  const list = careList(round(games, [played('s1', 'g1', at(2026, 9, 1))]), games, deps);
  assert.equal(list.empty, true);
});

test('careList finds the three gaps and caps each section', () => {
  const games = [
    ...shelfOf(2),
    game('g3', { image: null }),
    game('g4', { image: null }),
    game('g5', { image: null }),
    game('g6', { image: null }),
    game('g7', { maxPlayers: null }),
  ];
  const sessions = [
    played('s1', 'g1', at(2026, 9, 1), { winnerIds: [] }),
    played('s2', 'g2', at(2026, 8, 1), { winnerIds: [] }),
  ];
  const list = careList(round(games, sessions), games, deps);
  assert.equal(list.empty, false);
  assert.equal(list.winnerlessTotal, 2);
  assert.equal(list.coverlessTotal, 4);
  assert.equal(list.coverless.length, 3, 'the card names at most three, and says how many there are');
  assert.equal(list.noRangeTotal, 1, 'a HALF range is a gap — g7 has a min and no max');
  assert.equal(list.noRange[0].id, 'g7');
});

test('careList ignores an open evening that simply has no winner yet', () => {
  const games = shelfOf(3);
  const open = { id: 's1', createdAt: at(2026, 9, 1), done: true, finished: false, gameIds: ['g1'], chosenGameId: 'g1', winnerIds: [], votes: {} };
  assert.equal(careList(round(games, [open]), games, deps).winnerlessTotal, 0);
});

// --------------------------------------------------------------- anniversary

test('anniversary is null on the 364 days that are not one', () => {
  const games = shelfOf(3);
  const sessions = [played('s1', 'g1', at(2025, 9, 4))]; // one day off
  assert.equal(anniversary(round(games, sessions), { now: NOW }, deps), null);
});

test('anniversary tells the most recent story on a matching local day', () => {
  const games = shelfOf(3);
  const sessions = [
    played('s1', 'g1', at(2023, 9, 5)),
    played('s2', 'g2', at(2025, 9, 5)),
  ];
  const out = anniversary(round(games, sessions), { now: NOW }, deps);
  assert.equal(out.years, 1);
  assert.equal(out.game.id, 'g2');
  assert.equal(out.session.id, 's2');
});

test('anniversary says nothing when the game it would name is gone', () => {
  const games = shelfOf(3);
  const sessions = [played('s1', 'deleted', at(2025, 9, 5))];
  assert.equal(anniversary(round(games, sessions), { now: NOW }, deps), null);
});

test('anniversary does not celebrate today', () => {
  const games = shelfOf(3);
  const sessions = [played('s1', 'g1', at(2026, 9, 5))];
  assert.equal(anniversary(round(games, sessions), { now: NOW }, deps), null);
});
