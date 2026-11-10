'use strict';

/* Lent boxes (#1775) end to end over HTTP: the two loan routes, the Chronik
 * lines they write, and the draw leaving a lent box out unless asked — the half
 * test/draw.test.js cannot see, since it calls `drawPool` directly and so cannot
 * tell whether the ROUTE passes the flag in at all. The pure helpers are pinned
 * in test/game-loan-helpers.test.js. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const { LOAN_TO_MAX, loanToday } = require('../public/js/game-loan');

async function addGame(rid, title, extra = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`)
    .field('title', title).field('minPlayers', '1').field('maxPlayers', '8');
  for (const [k, v] of Object.entries(extra)) req.field(k, String(v));
  return (await req).body;
}
const lend = (rid, gid, body) => request(app).put(`/api/rounds/${rid}/games/${gid}/loan`).send(body);
const giveBack = (rid, gid) => request(app).delete(`/api/rounds/${rid}/games/${gid}/loan`);
const activities = async (rid) => (await request(app).get(`/api/rounds/${rid}/activities`)).body;

test('lend to a seat: the name is the seat\'s, the day defaults to today, and it shows in the Chronik', async () => {
  const round = await createRound(request);
  const alice = round.members.find((m) => m.name === 'Alice');
  const g = await addGame(round.id, 'Azul');
  // The client's `to` is ignored for a seat — a request cannot pin a seat under
  // somebody else's name.
  const res = await lend(round.id, g.id, { memberId: alice.id, to: 'Mallory' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.loan, { to: 'Alice', memberId: alice.id, since: loanToday() });

  const back = await giveBack(round.id, g.id);
  assert.equal(back.status, 200);
  assert.equal('loan' in back.body, false);

  const acts = (await activities(round.id)).filter((a) => /^game_(lent|returned)$/.test(a.type));
  assert.deepEqual(acts.map((a) => a.type).sort(), ['game_lent', 'game_returned']);
  for (const a of acts) assert.equal(a.to, 'Alice');
  // Accounts-off: nobody acts, so no seat is named (.claude/rules/actor-seat-needs-a-uid-guard.md).
  for (const a of acts) assert.equal('actorMemberId' in a, false);
});

test('lend to a typed name, with a date; the name is trimmed and capped', async () => {
  const round = await createRound(request);
  const g = await addGame(round.id, 'Cascadia');
  const res = await lend(round.id, g.id, { to: '  Nachbarin Kim  ', since: '2026-11-03' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.loan, { to: 'Nachbarin Kim', since: '2026-11-03' });

  assert.equal((await lend(round.id, g.id, { to: 'x'.repeat(LOAN_TO_MAX + 1) })).status, 400);
  assert.equal((await lend(round.id, g.id, { to: 'x'.repeat(LOAN_TO_MAX) })).status, 200);
});

test('the loan routes refuse what is not a loan', async () => {
  const round = await createRound(request);
  const g = await addGame(round.id, 'Home');
  const wish = await addGame(round.id, 'Wanted', { wish: 'true' });
  assert.equal(wish.wish, true, 'fixture: the wish really is a wish');

  assert.equal((await lend(round.id, g.id, {})).status, 400, 'no borrower');
  assert.equal((await lend(round.id, g.id, { to: '   ' })).status, 400, 'a blank borrower');
  assert.equal((await lend(round.id, g.id, { memberId: 'nobody' })).status, 400, 'an unknown seat');
  assert.equal((await lend(round.id, g.id, { to: 'Kim', since: '2026-02-31' })).status, 400, 'not a day');
  assert.equal((await lend(round.id, g.id, { to: 'Kim', since: '2999-01-01' })).status, 400, 'the future');
  assert.equal((await lend(round.id, wish.id, { to: 'Kim' })).status, 400, 'a wish is not in the cupboard');
  assert.equal((await lend(round.id, 'nope', { to: 'Kim' })).status, 404);
  assert.equal((await giveBack(round.id, g.id)).status, 409, 'nothing is out');
  assert.equal((await lend('nope', g.id, { to: 'Kim' })).status, 404);
});

test('a draw leaves a lent box out — unless the session asks for lent games too', async () => {
  const round = await createRound(request);
  const lent = await addGame(round.id, 'Lent');
  await addGame(round.id, 'Home');
  assert.equal((await lend(round.id, lent.id, { to: 'Kim' })).status, 200);

  const plain = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 9 });
  assert.equal(plain.status, 201);
  assert.deepEqual(plain.body.games.map((g) => g.title), ['Home']);

  const asked = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 9, includeLent: true });
  assert.deepEqual(asked.body.games.map((g) => g.title).sort(), ['Home', 'Lent']);

  // Only a literal `true` opts in.
  const truthy = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 9, includeLent: 'yes' });
  assert.deepEqual(truthy.body.games.map((g) => g.title), ['Home']);

  // Not remembered: the next setup screen opens with lent boxes out again.
  const r = (await request(app).get(`/api/rounds/${round.id}`)).body;
  assert.equal('includeLent' in (r.lastSessionFilters || {}), false);
});

test('a shelf of nothing but lent boxes draws nothing, and „Jetzt spielen" still plays one', async () => {
  const round = await createRound(request);
  const lent = await addGame(round.id, 'OnlyOne');
  await lend(round.id, lent.id, { to: 'Kim' });
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 3 });
  assert.equal(res.status, 400);
  // The direct pick names its box, so a lent one stays playable (it shows the marker).
  const direct = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ gameId: lent.id });
  assert.equal(direct.status, 201);
});
