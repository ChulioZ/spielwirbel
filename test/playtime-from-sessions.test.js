'use strict';

/*
 * „Aus euren Sessions" (#1874): a game whose round set `playtimeFromSessions`
 * takes the round's measured median (roundDurations, session-duration.js) as
 * its playing time, read through `gamePlaytime` (draw-pool.js) by every
 * surface and by the draw — and recomputed on every read, so a new timed
 * session moves it.
 *
 * The silent failures this pins:
 *  - a reader that forgot the round's sessions would quietly fall back to BGG,
 *    so `gamePlaytime` THROWS for a flagged game without its index, and the
 *    three server readers (draw, draw options, ballot) are each driven here;
 *  - the flag and the override exclude each other at the route, in both
 *    directions, or a stale override would silently outrank nothing;
 *  - with the flag set but no median (fewer than two timed sessions) the
 *    stored pair applies — never a 0, never a throw.
 * The repo half (absent-key clear, the admin figure) is in
 * test/support/repo-contract.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const repo = require('../lib/repo');
const { drawPool } = require('../lib/draw');
const { resolveDrawFilters } = require('../lib/draw-filters');
const { gamePlaytime, fitsMetadataFilters, metadataFilterOptions } = require('../public/js/draw-pool');
const {
  roundDurations, roundGameDuration, offersMeasuredPlaytime,
  PLAYTIME_ADOPT_MIN_DELTA, PLAYTIME_ADOPT_MIN_SHARE,
} = require('../public/js/session-duration');

const T = repo.forTenant('default');

async function addGame(rid, title) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8' })) req.field(k, String(v));
  return (await req).body;
}
const patch = (rid, gid, body) => request(app).patch(`/api/rounds/${rid}/games/${gid}`).send(body);
const roundOf = async (rid) => (await request(app).get(`/api/rounds/${rid}`)).body;
const gameOf = async (rid, gid) => (await roundOf(rid)).games.find((g) => g.id === gid);
// One played, timed evening of `gid`.
const played = (rid, gid, durationMinutes, day = 1) => T.createSession(rid, {
  gameIds: [gid], votes: {}, finished: true, chosenGameId: gid, durationMinutes,
  createdAt: new Date(Date.UTC(2026, 9, day, 19)).toISOString(),
});

/* ------------------------------ The index -------------------------------- */

test('roundDurations answers exactly what roundGameDuration answers, per game', () => {
  const s = (chosenGameId, durationMinutes, extra = {}) => ({ finished: true, chosenGameId, durationMinutes, ...extra });
  const sessions = [
    s('a', 100), s('a', 120), s('a', 200),          // median 120
    s('b', 60), s('b', 71),                         // 65.5 -> 65
    s('c', 90),                                     // one evening: no median
    s('d', 50), s('d', 50, { cancelled: true }),    // a cancelled one does not count
    s('e', 40), s('e', 45, { finished: false }),    // nor an unfinished one
  ];
  const index = roundDurations(sessions);
  for (const gid of ['a', 'b', 'c', 'd', 'e']) {
    assert.deepEqual(index.get(gid) || null, roundGameDuration(sessions, gid), gid);
  }
  assert.deepEqual([...index.keys()].sort(), ['a', 'b']);
  assert.equal(roundDurations(undefined).size, 0);
});

test('„Übernehmen" is offered only for a figure that says something new', () => {
  const pair = { minPlaytime: 60, maxPlaytime: 90 };
  // The bar is BOTH bounds: more than 15 min and more than a fifth of the bound.
  assert.equal(PLAYTIME_ADOPT_MIN_DELTA, 15);
  assert.equal(PLAYTIME_ADOPT_MIN_SHARE, 0.2);
  assert.equal(offersMeasuredPlaytime(pair, 75), false, 'inside the range');
  assert.equal(offersMeasuredPlaytime(pair, 108), false, '18 over 90 is the fifth, exactly — not more');
  assert.equal(offersMeasuredPlaytime(pair, 110), true, '20 over 90');
  assert.equal(offersMeasuredPlaytime(pair, 45), false, '15 under 60 is not more than 15');
  assert.equal(offersMeasuredPlaytime(pair, 40), true, '20 under 60');
  // On a short game the 15 minutes bind, on a long one the fifth does.
  assert.equal(offersMeasuredPlaytime({ minPlaytime: 20, maxPlaytime: 30 }, 44), false);
  assert.equal(offersMeasuredPlaytime({ minPlaytime: 20, maxPlaytime: 30 }, 46), true);
  assert.equal(offersMeasuredPlaytime({ minPlaytime: 180, maxPlaytime: 240 }, 280), false);
  assert.equal(offersMeasuredPlaytime({ minPlaytime: 180, maxPlaytime: 240 }, 290), true);
  // One known bound is the whole range; no figure at all always offers.
  assert.equal(offersMeasuredPlaytime({ minPlaytime: null, maxPlaytime: 60 }, 100), true);
  assert.equal(offersMeasuredPlaytime({ minPlaytime: null, maxPlaytime: null }, 30), true);
  assert.equal(offersMeasuredPlaytime(pair, null), false);
});

/* ----------------------------- The resolver ------------------------------ */

test('a flagged game takes the median as both bounds, over BGG and over a stale override', () => {
  const durations = new Map([['g', { minutes: 150, count: 3 }]]);
  const game = { id: 'g', minPlaytime: 60, maxPlaytime: 90, playtimeFromSessions: true };
  assert.deepEqual(gamePlaytime(game, durations),
    { minPlaytime: 150, maxPlaytime: 150, overridden: false, fromSessions: true });
  // The route never stores both, but the resolver must not let an override win.
  assert.equal(gamePlaytime({ ...game, playtimeOverride: { min: 20, max: 30 } }, durations).maxPlaytime, 150);
  // An unflagged game ignores the index altogether.
  assert.deepEqual(gamePlaytime({ id: 'g', minPlaytime: 60, maxPlaytime: 90 }, durations),
    { minPlaytime: 60, maxPlaytime: 90, overridden: false });
});

test('with the flag set but no median yet, the stored pair applies and the flag is kept', () => {
  const game = { id: 'g', minPlaytime: 60, maxPlaytime: 90, playtimeFromSessions: true };
  assert.deepEqual(gamePlaytime(game, new Map()), { minPlaytime: 60, maxPlaytime: 90, overridden: false });
});

test('a reader that forgets the index THROWS for a flagged game rather than falling back to BGG', () => {
  const game = { id: 'g', minPlaytime: 60, maxPlaytime: 90, playtimeFromSessions: true };
  assert.throws(() => gamePlaytime(game), /duration index/);
  assert.throws(() => fitsMetadataFilters(game, { maxPlaytime: 120 }), /duration index/);
  assert.throws(() => metadataFilterOptions([game]), /duration index/);
  // An unflagged game needs none — every pre-#1874 reader keeps working.
  assert.doesNotThrow(() => gamePlaytime({ minPlaytime: 60 }));
});

test('the filter and its options read the median, so a long-running game leaves a short budget', () => {
  const durations = new Map([['g', { minutes: 150, count: 2 }]]);
  const game = { id: 'g', minPlaytime: 60, maxPlaytime: 90, playtimeFromSessions: true };
  assert.equal(fitsMetadataFilters(game, { maxPlaytime: 120 }, durations), false);
  assert.equal(fitsMetadataFilters(game, { maxPlaytime: 180 }, durations), true);
  assert.equal(fitsMetadataFilters(game, { minPlaytime: 120 }, durations), true);
  // A hand-typed game with no BGG time still offers the controls once measured.
  const typed = { id: 't', playtimeFromSessions: true };
  const opts = metadataFilterOptions([typed], new Map([['t', { minutes: 40, count: 2 }]]));
  assert.equal(opts.playtimeMax, true);
  assert.equal(opts.playtimeMin, true);
});

/* ------------------------------- The route ------------------------------- */

test('PATCH turns it on and off, and the newer choice replaces the other one', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'Brass');
  await patch(round.id, game.id, { playtimeOverride: { min: 120, max: 120 } });

  // „Übernehmen" replaces a hand-set time.
  assert.equal((await patch(round.id, game.id, { playtimeFromSessions: true })).status, 200);
  let g = await gameOf(round.id, game.id);
  assert.equal(g.playtimeFromSessions, true);
  assert.equal('playtimeOverride' in g, false, 'the override is gone, not stored beside it');

  // Typing a time replaces the measured one.
  assert.equal((await patch(round.id, game.id, { playtimeOverride: { min: 90, max: 100 } })).status, 200);
  g = await gameOf(round.id, game.id);
  assert.equal('playtimeFromSessions' in g, false);
  assert.deepEqual(g.playtimeOverride, { min: 90, max: 100 });

  // null turns it off as absence.
  await patch(round.id, game.id, { playtimeOverride: null, playtimeFromSessions: true });
  assert.equal((await gameOf(round.id, game.id)).playtimeFromSessions, true);
  await patch(round.id, game.id, { playtimeFromSessions: null });
  g = await gameOf(round.id, game.id);
  assert.equal('playtimeFromSessions' in g, false);
  assert.equal('playtimeOverride' in g, false);
});

test('PATCH refuses both choices at once and any flag value but true or null', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'Azul');
  const both = await patch(round.id, game.id, { playtimeFromSessions: true, playtimeOverride: { min: 30, max: 45 } });
  assert.equal(both.status, 400);
  for (const bad of [false, 'yes', 1]) {
    assert.equal((await patch(round.id, game.id, { playtimeFromSessions: bad })).status, 400, String(bad));
  }
  assert.equal('playtimeFromSessions' in (await gameOf(round.id, game.id)), false);
});

/* ---------------------- The server readers, end to end -------------------- */

test('the draw and its filter options use the median — and a new evening moves it', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'Spirit Island');
  await T.setGameProviderInfo(round.id, game.id, { minPlaytime: 90, maxPlaytime: 120 });
  await patch(round.id, game.id, { playtimeFromSessions: true });
  await played(round.id, game.id, 170, 1);
  await played(round.id, game.id, 190, 2);

  let r = await T.getRound(round.id);
  // 120 is a ladder step; the control is offered because the median is a value.
  const resolved = resolveDrawFilters({ metadata: { maxPlaytime: 120 } }, r, r.games);
  assert.equal(resolved.metadata.maxPlaytime, 120, 'the control survives normalization on the median');
  assert.equal(drawPool(r, { metadata: { maxPlaytime: 120 }, playerCount: 3 }).length, 0, 'median 180 > 120, BGG\'s 120 would fit');
  assert.equal(drawPool(r, { metadata: { maxPlaytime: 180 }, playerCount: 3 }).length, 1);

  // Three short evenings bring the median down to 100 — recomputed, never stored.
  await played(round.id, game.id, 100, 3);
  await played(round.id, game.id, 90, 4);
  await played(round.id, game.id, 95, 5);
  r = await T.getRound(round.id);
  assert.equal(drawPool(r, { metadata: { maxPlaytime: 120 }, playerCount: 3 }).length, 1);
  assert.equal('measuredPlaytime' in (await gameOf(round.id, game.id)), false);
});

test('a filtered draw over a flagged game does not 500 — the route hands the draw its sessions', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'Ark Nova');
  await addGame(round.id, 'Azul');
  await T.setGameProviderInfo(round.id, game.id, { minPlaytime: 90, maxPlaytime: 150 });
  await patch(round.id, game.id, { playtimeFromSessions: true });
  await played(round.id, game.id, 100, 1);
  await played(round.id, game.id, 110, 2);
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 5, metadata: { maxPlaytime: 120 } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.session.gameIds.includes(game.id), 'median 105 fits under 120, BGG\'s 150 would not');
});

test('the shared-vote ballot carries the median, not BGG\'s figure', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'Terraforming Mars');
  await addGame(round.id, 'Azul');
  await T.setGameProviderInfo(round.id, game.id, { minPlaytime: 120, maxPlaytime: 120 });
  await patch(round.id, game.id, { playtimeFromSessions: true });
  await played(round.id, game.id, 160, 1);
  await played(round.id, game.id, 180, 2);

  const session = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 5 })).body.session;
  const { token } = (await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/vote-link`).send({})).body;
  const g = (await request(app).get(`/api/vote/${token}`)).body.games.find((x) => x.id === game.id);
  assert.equal(g.minPlaytime, 170);
  assert.equal(g.maxPlaytime, 170);
  assert.equal('playtimeFromSessions' in g, false, 'the voter sees a number, not where it came from');
});

test('copying a game into another round does NOT carry the flag — the target has none of these sessions', async () => {
  const from = await createRound(request);
  const to = await createRound(request, { name: 'Target' });
  const game = await addGame(from.id, 'Brass');
  await patch(from.id, game.id, { playtimeFromSessions: true });
  const res = await request(app).post(`/api/rounds/${from.id}/games/copy-to`)
    .send({ targetRoundId: to.id, gameIds: [game.id] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const copied = (await roundOf(to.id)).games.find((g) => g.title === 'Brass');
  assert.equal('playtimeFromSessions' in copied, false);
});
