'use strict';

/* The round's measured playing time in the draw filter (#1771).
 *
 * #1770 records how long a session's game really took, and the Spielepass
 * prints the round's median from the second timed play on. This file pins that
 * every place a draw FILTERS by playing time reads that same figure first —
 * measured median, then the round's own override, then BGG's box — through the
 * one resolver `effectivePlaytime` (public/js/draw-pool.js):
 *
 *  - the server draw (`resolveDrawFilters` + `drawPool`) and the Regal filter
 *    agree on one fixture — a chip drawing a game the Regal had filtered away
 *    is the bug this issue exists for;
 *  - the shelf offers the playtime controls for a game only the round has timed
 *    (else a hand-typed shelf would silently drop the filter on normalization);
 *  - the automatic „bis 60 Min." quick chip is offered by the same figure;
 *  - the Spielepass says which figure it is („gemessen", „Schachtel"). */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  effectivePlaytime, fitsMetadataFilters, metadataFilterOptions, normalizeMetadataFilters,
} = require('../public/js/draw-pool');
const { roundGameDurations } = require('../public/js/session-duration');
const { resolveDrawFilters } = require('../lib/draw-filters');
const { drawPool } = require('../lib/draw');
const { quickPresets } = require('../public/js/hub-insights');
const { loadApp } = require('./support/dom');

let sid = 0;
const played = (gameId, durationMinutes) => ({
  id: `s${++sid}`, finished: true, chosenGameId: gameId, gameIds: [gameId],
  memberIds: ['m1'], votes: {}, durationMinutes, createdAt: '2026-11-01T18:00:00.000Z',
});

// Each game is chosen so the measured figure flips its answer to „bis 60 Min."
// compared to what the box alone would say — except Codenames, whose single
// timed evening is below the two-session floor and must leave the box in charge.
const GAMES = [
  { id: 'g1', title: 'Brass', minPlayers: 2, maxPlayers: 4, minPlaytime: 60, maxPlaytime: 60 },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4, minPlaytime: 90, maxPlaytime: 120 },
  { id: 'g3', title: 'Codenames', minPlayers: 2, maxPlayers: 8, minPlaytime: 15, maxPlaytime: 15 },
  { id: 'g4', title: 'Handgeschrieben', minPlayers: 2, maxPlayers: 6 },
  { id: 'g5', title: 'Eigene Angabe', minPlayers: 2, maxPlayers: 4, minPlaytime: 120, maxPlaytime: 120,
    playtimeOverride: { min: 30, max: 30 } },
];
const SESSIONS = () => [
  played('g1', 100), played('g1', 121), // → ~110: out of „bis 60" though the box says 60
  played('g2', 40), played('g2', 50), //   → ~45: in, though the box says 90–120
  played('g3', 200), //                    one evening: an anecdote, the box stays
  played('g4', 30), played('g4', 40), //   → ~35: a hand-typed game gains a time
  played('g5', 150), played('g5', 150), // → ~150: measured beats the override too
];
const roundFixture = () => ({
  id: 'mp-1', name: 'Freitagsrunde', members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }], tags: [],
  sessions: SESSIONS(), games: GAMES.map((g) => ({ ...g })),
});
const SHORT = ['Azul', 'Codenames', 'Handgeschrieben'];

/* ----------------------------- The resolver ------------------------------ */

test('effectivePlaytime reads the measured median, then the override, then the box — and names it', () => {
  const measured = roundGameDurations(SESSIONS());
  const of = (id) => effectivePlaytime(GAMES.find((g) => g.id === id), measured);
  assert.deepEqual(of('g1'), { minPlaytime: 110, maxPlaytime: 110, source: 'measured', count: 2 });
  assert.deepEqual(of('g3'), { minPlaytime: 15, maxPlaytime: 15, source: 'box', count: 0 });
  assert.deepEqual(of('g5'), { minPlaytime: 150, maxPlaytime: 150, source: 'measured', count: 2 });
  // Without a measurement the override and the box keep their old order.
  assert.deepEqual(effectivePlaytime(GAMES[4], null), { minPlaytime: 30, maxPlaytime: 30, source: 'override', count: 0 });
  assert.deepEqual(effectivePlaytime({ id: 'x' }, measured), { minPlaytime: null, maxPlaytime: null, source: null, count: 0 });
  assert.deepEqual(effectivePlaytime(null), { minPlaytime: null, maxPlaytime: null, source: null, count: 0 });
});

test('the filter clause containment-tests the measured figure, both bounds', () => {
  const measured = roundGameDurations(SESSIONS());
  const short = GAMES.filter((g) => fitsMetadataFilters(g, { maxPlaytime: 60 }, measured)).map((g) => g.title);
  assert.deepEqual(short, SHORT);
  const long = GAMES.filter((g) => fitsMetadataFilters(g, { minPlaytime: 90 }, measured)).map((g) => g.title);
  assert.deepEqual(long, ['Brass', 'Eigene Angabe'],
    'Azul measured at 45 is no longer a 90-minute game; the hand-typed one now has a time to fail on');
  // No map: exactly the pre-#1771 answer, so a caller without sessions is unchanged.
  const boxOnly = GAMES.filter((g) => fitsMetadataFilters(g, { maxPlaytime: 60 })).map((g) => g.title);
  assert.deepEqual(boxOnly, ['Brass', 'Codenames', 'Handgeschrieben', 'Eigene Angabe']);
});

test('a shelf only the round has timed still offers the playtime controls', () => {
  const games = [{ id: 'g4', title: 'Handgeschrieben' }];
  const measured = roundGameDurations([played('g4', 30), played('g4', 40)]);
  assert.equal(metadataFilterOptions(games).playtimeMax, false);
  const opts = metadataFilterOptions(games, measured);
  assert.equal(opts.playtimeMax, true);
  assert.equal(opts.playtimeMin, true);
  assert.equal(normalizeMetadataFilters({ maxPlaytime: 60 }, opts).maxPlaytime, 60,
    'normalization would otherwise drop the bound as a filter this shelf cannot offer');
});

/* ------------------- The server draw and the Regal agree ------------------ */

test('the server draw honours the measured figure, including on an all-hand-typed shelf', () => {
  const round = roundFixture();
  const active = round.games;
  const { metadata } = resolveDrawFilters({ metadata: { maxPlaytime: 60 } }, round, active);
  const pool = drawPool(round, { metadata, playerCount: 2 });
  assert.deepEqual(pool.map((g) => g.title), SHORT);

  // The options gate is the half nobody would notice: a shelf whose only time
  // is measured must keep the bound, not normalize it to „unfiltered".
  const handTyped = {
    ...roundFixture(),
    games: [{ id: 'g4', title: 'Handgeschrieben', minPlayers: 2, maxPlayers: 6 },
      { id: 'g6', title: 'Auch handgeschrieben', minPlayers: 2, maxPlayers: 6 }],
    sessions: [played('g4', 150), played('g4', 170)],
  };
  const resolved = resolveDrawFilters({ metadata: { maxPlaytime: 60 } }, handTyped, handTyped.games);
  assert.equal(resolved.metadata.maxPlaytime, 60);
  assert.deepEqual(drawPool(handTyped, { metadata: resolved.metadata, playerCount: 2 }).map((g) => g.title),
    ['Auch handgeschrieben']);
});

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);

test('the Regal filter shows exactly the pool the server would draw', () => {
  const round = roundFixture();
  const shelved = () =>
    [...dom.app.querySelectorAll('.game-card__title')].map((el) => el.textContent).sort();
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', round, round.games);
  // Set the bound the panel's select would, then re-render: the Regal
  // re-normalizes against the shelf's options on every render, so this drives
  // the options gate as well as the predicate.
  dom.run('regalFilters.metadata = { ...regalFilters.metadata, maxPlaytime: 60 };');
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', round, round.games);
  assert.equal(dom.run('regalFilters.metadata.maxPlaytime'), 60);
  const { metadata } = resolveDrawFilters({ metadata: { maxPlaytime: 60 } }, round, round.games);
  const pool = drawPool(round, { metadata, playerCount: 2 }).map((g) => g.title).sort();
  assert.deepEqual(shelved(), pool);
  assert.deepEqual(shelved(), [...SHORT].sort());
  dom.run('regalFilters.metadata = { ...regalFilters.metadata, maxPlaytime: null };');
});

test('the Regal keeps the bound on a shelf only the round has timed', () => {
  // The Regal re-normalizes its filters against the shelf's options on every
  // render, so without the measured map in that call the bound would be dropped
  // as unofferable here — the fixture above has box times and cannot see it.
  const round = {
    ...roundFixture(),
    id: 'mp-2',
    games: [{ id: 'g4', title: 'Kurz' }, { id: 'g6', title: 'Lang' }],
    sessions: [played('g4', 30), played('g4', 40), played('g6', 150), played('g6', 170)],
  };
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', round, round.games);
  dom.run('regalFilters.metadata = { ...regalFilters.metadata, maxPlaytime: 60 };');
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', round, round.games);
  assert.equal(dom.run('regalFilters.metadata.maxPlaytime'), 60, 'the Regal normalized the bound away');
  const shelved = [...dom.app.querySelectorAll('.game-card__title')].map((el) => el.textContent);
  assert.deepEqual(shelved, ['Kurz']);
  dom.run('regalFilters.metadata = { ...regalFilters.metadata, maxPlaytime: null };');
});

/* -------------------------- The session setup screen ------------------------ */

const previewed = () =>
  [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort();

test('the setup preview shows exactly the pool the server would draw', async () => {
  // The round's remembered preset is how the setup screen opens filtered.
  const round = { ...roundFixture(), lastSessionFilters: { metadata: { maxPlaytime: 60 } } };
  await dom.call('showStartSession', round);
  const { metadata } = resolveDrawFilters({ metadata: { maxPlaytime: 60 } }, round, round.games);
  // Two members at the table: the range clause admits every fixture game, so
  // only the playing time decides — and the comparison is to the draw itself.
  assert.deepEqual(previewed(), drawPool(round, { metadata, playerCount: 2 }).map((g) => g.title).sort());
  assert.deepEqual(previewed(), [...SHORT].sort());
});

test('the setup screen keeps the bound, and offers its row, on a shelf only the round has timed', async () => {
  const { filterPanelKit } = require('./support/filter-panel');
  const { openPanel, closePanel } = filterPanelKit(dom);
  const round = {
    ...roundFixture(),
    games: [{ id: 'g4', title: 'Kurz' }, { id: 'g6', title: 'Lang' }],
    sessions: [played('g4', 30), played('g4', 40), played('g6', 150), played('g6', 170)],
    lastSessionFilters: { metadata: { maxPlaytime: 60 } },
  };
  await dom.call('showStartSession', round);
  assert.deepEqual(previewed(), ['Kurz'], 'the preset bound was normalized away');
  // The panel is offered at all only because the measured times are a playtime
  // control — this shelf has no tags, owners or provider fields.
  const body = openPanel();
  const labels = [...body.querySelectorAll('.mfilter__label')].map((el) => el.textContent);
  assert.ok(labels.includes('Spieldauer'), `no playtime row in ${JSON.stringify(labels)}`);
  closePanel();
});

/* --------------------------- The automatic chips -------------------------- */

test('the „bis 60 Min." quick chip is offered on a shelf only the round has timed', () => {
  // Two hand-typed games, one measured short and one long: the chip has a pool
  // that is neither empty nor the whole shelf — but only if the options gate
  // and the predicate both read the measured figures. `quickPresets` drops a
  // chip whose control the shelf cannot offer, so without them it is not there.
  const shelf = [{ id: 'g4', title: 'Kurz' }, { id: 'g6', title: 'Lang' }];
  const sessions = [played('g4', 30), played('g4', 40), played('g6', 150), played('g6', 170)];
  const deps = dom.run('hubDeps()');
  const ids = (d) => quickPresets(shelf, d).map((c) => c.id);
  assert.deepEqual(ids({ ...deps, measured: null }), [], 'control: no measured map, no time, no chip');
  assert.deepEqual(ids({ ...deps, measured: roundGameDurations(sessions) }), ['short']);
  // And the hub builds its deps from the round, not without it.
  const fromRound = dom.run(`hubDeps({ sessions: ${JSON.stringify(sessions)} }).measured.get('g4').minutes`);
  assert.equal(fromRound, 35, 'hubDeps(round) does not carry the round\'s measured map');
});

/* ------------------------------- Spielepass ------------------------------- */

test('the Spielepass pill shows the figure the filter uses, and names where it came from', () => {
  const measured = roundGameDurations(SESSIONS());
  const pill = (id) => {
    const game = GAMES.find((g) => g.id === id);
    const facts = dom.call('gameGlanceFacts', game, { own: measured.get(id) || null });
    const value = facts && facts.querySelector('.fact__value');
    const notes = facts ? [...facts.querySelectorAll('.fact__note')].map((n) => n.textContent) : [];
    return { value: value && value.textContent, notes };
  };
  assert.deepEqual(pill('g1'), { value: '~110 Min.', notes: ['bei euch gemessen · Schachtel: 60 Min.'] });
  assert.deepEqual(pill('g4'), { value: '~35 Min.', notes: ['bei euch gemessen'] });
  assert.deepEqual(pill('g5'), { value: '~150 Min.', notes: ['bei euch gemessen · eigene Angabe: 30 Min.'] });
  // Below the floor nothing changes: the box value, no note.
  assert.deepEqual(pill('g3'), { value: '15 Min.', notes: [] });
});
