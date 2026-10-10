'use strict';

/*
 * Logging a past session and correcting a finished session's date (#1616).
 *
 * Pinned here, through the real routes on the JSON backend:
 *  - `playedOn` with a direct pick creates a FINISHED session dated that day,
 *    its log opening with `logged` rather than `started`;
 *  - recording winners afterwards — and un-finishing and re-finishing — keeps
 *    the evening's own day as `finishedAt` instead of dragging it to today;
 *  - PATCH …/date moves all three stamps, logs `redated`, and refuses a
 *    running session;
 *  - every malformed or out-of-range date is a 400;
 *  - a round's sessions read back by DATE, so a session logged last but played
 *    first is not the newest (the insertion-order leak).
 * The feed half needs accounts on and lives in session-backdate-feed.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

async function addGame(rid, title = 'Azul') {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8' })) req.field(k, v);
  return (await req).body;
}

const PAST = '2026-03-01T20:00:00.000Z';
const log = (rid, body) => request(app).post(`/api/rounds/${rid}/sessions`).send(body);
const finish = (rid, sid, body) => request(app).post(`/api/rounds/${rid}/sessions/${sid}/finish`).send(body);
const redate = (rid, sid, playedOn, extra = {}) =>
  request(app).patch(`/api/rounds/${rid}/sessions/${sid}/date`).send({ playedOn, ...extra });
const roundOf = (rid) => request(app).get(`/api/rounds/${rid}`).then((r) => r.body);

test('a logged session is created FINISHED on its own day', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const res = await log(round.id, { gameId: game.id, playedOn: PAST });
  assert.equal(res.status, 201);
  const s = res.body.session;
  assert.equal(s.finished, true);
  assert.equal(s.createdAt, PAST);
  assert.equal(s.chosenAt, PAST);
  assert.equal(s.finishedAt, PAST);
  assert.equal(s.chosenGameId, game.id);
  assert.deepEqual(s.events.map((e) => e.type), ['logged']);
  // The log keeps the REAL time it was entered, not the evening's.
  assert.ok(s.events[0].at > PAST);
});

test('a playedOn given in another zone is stored normalised to UTC', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const res = await log(round.id, { gameId: game.id, playedOn: '2026-03-01T20:00:00+01:00' });
  assert.equal(res.status, 201);
  assert.equal(res.body.session.createdAt, '2026-03-01T19:00:00.000Z');
});

test('recording winners later keeps the logged day as finishedAt', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const s = (await log(round.id, { gameId: game.id, playedOn: PAST })).body.session;
  const winner = round.members[0].id;
  const res = await finish(round.id, s.id, { winnerIds: [winner] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.winnerIds, [winner]);
  assert.equal(res.body.finishedAt, PAST);
});

test('un-finishing and re-finishing a logged session keeps its day', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const s = (await log(round.id, { gameId: game.id, playedOn: PAST })).body.session;
  assert.equal((await finish(round.id, s.id, { finished: false })).body.finishedAt, null);
  assert.equal((await finish(round.id, s.id, {})).body.finishedAt, PAST);
});

test('an ordinary session is still stamped NOW when it is finished', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const s = (await log(round.id, { gameId: game.id })).body.session;
  assert.equal(s.finished, false);
  assert.equal(s.events[0].type, 'started');
  const before = new Date().toISOString();
  const done = (await finish(round.id, s.id, {})).body;
  assert.ok(done.finishedAt >= before, `${done.finishedAt} is now, not ${s.createdAt}`);
});

test('a finished session can be moved to another day — all three stamps together', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const s = (await log(round.id, { gameId: game.id })).body.session;
  await finish(round.id, s.id, {});
  const res = await redate(round.id, s.id, PAST);
  assert.equal(res.status, 200);
  assert.equal(res.body.createdAt, PAST);
  assert.equal(res.body.chosenAt, PAST);
  assert.equal(res.body.finishedAt, PAST);
  const last = res.body.events[res.body.events.length - 1];
  assert.equal(last.type, 'redated');
  assert.ok(last.at > PAST, 'the log entry carries the real time of the change');
  // …and a later winner tap does not drag it back to today.
  assert.equal((await finish(round.id, s.id, { winnerIds: [round.members[0].id] })).body.finishedAt, PAST);
});

test('re-dating a running session is refused', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const s = (await log(round.id, { gameId: game.id })).body.session;
  const res = await redate(round.id, s.id, PAST);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /not finished/);
});

test('every malformed or out-of-range date is a 400', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const future = new Date(Date.now() + 2 * 86400000).toISOString();
  for (const playedOn of [future, 'not a date', '2026-03-01', '1999-06-01T20:00:00Z', 42]) {
    const res = await log(round.id, { gameId: game.id, playedOn });
    assert.equal(res.status, 400, `start with ${JSON.stringify(playedOn)}`);
  }
  // A date only means something for a direct pick.
  const noGame = await log(round.id, { playedOn: PAST });
  assert.equal(noGame.status, 400);
  assert.match(noGame.body.error, /requires gameId/);

  const s = (await log(round.id, { gameId: game.id, playedOn: PAST })).body.session;
  for (const playedOn of [future, 'garbage', '1999-06-01T20:00:00Z']) {
    assert.equal((await redate(round.id, s.id, playedOn)).status, 400, `redate to ${playedOn}`);
  }
  assert.equal((await request(app).patch(`/api/rounds/${round.id}/sessions/${s.id}/date`).send({})).status, 400);
  // Nothing above moved the stored day.
  const stored = (await roundOf(round.id)).sessions.find((x) => x.id === s.id);
  assert.equal(stored.createdAt, PAST);
});

test('re-dating an unknown session is a 404', async () => {
  const round = await createRound(request);
  assert.equal((await redate(round.id, 'nope', PAST)).status, 404);
});

test('a session logged LAST but played FIRST reads back first, not newest', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const today = (await log(round.id, { gameId: game.id })).body.session;
  const past = (await log(round.id, { gameId: game.id, playedOn: PAST })).body.session;
  assert.deepEqual((await roundOf(round.id)).sessions.map((s) => s.id), [past.id, today.id]);

  // Re-dating moves it too: today's session pushed before the logged one.
  await finish(round.id, today.id, {});
  await redate(round.id, today.id, '2026-02-01T20:00:00.000Z');
  assert.deepEqual((await roundOf(round.id)).sessions.map((s) => s.id), [today.id, past.id]);
});

// ---- The optional time (#1629) ----

const summaryOf = async (rid) =>
  (await request(app).get('/api/rounds').then((r) => r.body)).find((r) => r.id === rid);

test('a logged session records whether a time was entered — as a boolean either way', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const plain = (await log(round.id, { gameId: game.id, playedOn: PAST })).body.session;
  assert.equal(plain.dateOnly, true, 'a pre-#1629 client sends no flag: the 20:00 stand-in');
  const timed = (await log(round.id, { gameId: game.id, playedOn: PAST, dateOnly: false })).body.session;
  assert.equal(timed.dateOnly, false);
  // Lenient like the rest of this schema: anything but `false` is date-only.
  const odd = (await log(round.id, { gameId: game.id, playedOn: PAST, dateOnly: 'no' })).body.session;
  assert.equal(odd.dateOnly, true);
  // An ordinary start grows no key at all.
  const now = (await log(round.id, { gameId: game.id })).body.session;
  assert.equal('dateOnly' in now, false);
});

test('a TODAY session with an entered time is logged, born finished at that time', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const earlier = new Date(Date.now() - 2 * 3600000);
  earlier.setSeconds(0, 0);
  const res = await log(round.id, { gameId: game.id, playedOn: earlier.toISOString(), dateOnly: false });
  assert.equal(res.status, 201);
  assert.equal(res.body.session.finished, true);
  assert.equal(res.body.session.createdAt, earlier.toISOString());
  assert.equal(res.body.session.events[0].type, 'logged');
});

test('re-dating writes the marker: with a time, without one, and back', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const s = (await log(round.id, { gameId: game.id, playedOn: PAST })).body.session;
  const timed = await redate(round.id, s.id, '2026-03-01T18:30:00.000Z', { dateOnly: false });
  assert.equal(timed.status, 200);
  assert.equal(timed.body.dateOnly, false);
  assert.equal(timed.body.createdAt, '2026-03-01T18:30:00.000Z');
  const plain = await redate(round.id, s.id, PAST);
  assert.equal(plain.body.dateOnly, true, 'no flag: the stand-in again');
  // …and an app-stamped session moved to a day with no time becomes date-only.
  const other = (await log(round.id, { gameId: game.id })).body.session;
  await finish(round.id, other.id, {});
  assert.equal((await redate(round.id, other.id, PAST, { dateOnly: true })).body.dateOnly, true);
});

test('a dateOnly that is not a boolean is a 400 on the re-date', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const s = (await log(round.id, { gameId: game.id, playedOn: PAST, dateOnly: false })).body.session;
  assert.equal((await redate(round.id, s.id, PAST, { dateOnly: 'yes' })).status, 400);
  assert.equal((await roundOf(round.id)).sessions.find((x) => x.id === s.id).dateOnly, false, 'nothing moved');
});

test('the home summary flags an UN-finished date-only session, and only that one', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const plain = (await log(round.id, { gameId: game.id, playedOn: PAST })).body.session;
  const timed = (await log(round.id, { gameId: game.id, playedOn: PAST, dateOnly: false })).body.session;
  const running = (await log(round.id, { gameId: game.id })).body.session;
  // „Doch nicht gespielt" brings a logged session back into the resume zone.
  await finish(round.id, plain.id, { finished: false });
  await finish(round.id, timed.id, { finished: false });
  const open = new Map((await summaryOf(round.id)).openSessions.map((s) => [s.id, s]));
  assert.equal(open.size, 3, 'all three are open');
  assert.equal(open.get(plain.id).dateOnly, true);
  assert.equal('dateOnly' in open.get(timed.id), false, 'a time was entered');
  assert.equal('dateOnly' in open.get(running.id), false, 'stamped by the app');
});
