'use strict';

/*
 * POST /api/rounds/:rid/sessions/import (#1665): a play history written as
 * finished sessions. Accounts off — the route itself does not need an account,
 * only the BGG source does (test/bgg-plays.test.js). The quota sentinels are
 * the repo contract's (test/support/repo-contract.js).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const { IMPORT_BATCH_MAX } = require('../public/js/play-import');

const base = (rid) => `/api/rounds/${rid}/sessions/import`;
const get = async (rid) => (await request(app).get(`/api/rounds/${rid}`)).body;

const PLAYS = [
  { id: 'p-azul', playedOn: '2025-03-07T18:30:00.000Z', dateOnly: false, gameKey: 'bgg:230802',
    players: [{ key: 'a', win: true, score: 61 }, { key: 'c', win: false, score: 40 }, { key: 'd', win: false }] },
  { id: 'p-teams', playedOn: '2025-04-02T18:00:00.000Z', dateOnly: true, gameKey: 'shelf',
    players: [
      { key: 'a', win: true, team: 'Rot', score: 7 }, { key: 'b', win: true, team: 'Rot', score: 7 },
      { key: 'c', win: false, team: 'Blau', score: 3 }, { key: 'd', win: false, team: 'Blau' },
    ] },
  { id: 'p-coop', playedOn: '2025-05-01T18:00:00.000Z', gameKey: 'bgg:30549', ending: 'lost',
    players: [{ key: 'a', win: false }, { key: 'b', win: false }] },
];

async function setup() {
  const round = await createRound(request, { name: 'Import' });
  const [alice, bob] = round.members;
  const shelf = (await request(app).post(`/api/rounds/${round.id}/games`).send({ title: 'Schach', minPlayers: 2, maxPlayers: 4 })).body;
  const body = {
    source: 'bgstats',
    people: [
      { key: 'a', memberId: alice.id },
      { key: 'b', memberId: bob.id },
      { key: 'c', newMember: 'Cem' },
      { key: 'd', guest: 'Dio' },
    ],
    games: [
      { key: 'bgg:230802', create: { title: 'Azul', bggId: 230802 } },
      { key: 'bgg:30549', create: { title: 'Pandemie', bggId: 30549, shelf: true } },
      { key: 'shelf', gameId: shelf.id },
    ],
    plays: PLAYS,
  };
  return { round, alice, bob, shelf, body };
}

test('an import writes finished, dated sessions with winners, points, teams, guests and an ending', async () => {
  const { round, alice, bob, shelf, body } = await setup();
  const res = await request(app).post(base(round.id)).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.imported, 3);
  assert.equal(res.body.skipped, 0);
  assert.deepEqual(Object.keys(res.body.people), ['c'], 'only the NEW seat gets an id back');
  assert.deepEqual(Object.keys(res.body.games).sort(), ['bgg:230802', 'bgg:30549']);

  const after = await get(round.id);
  const cem = after.members.find((m) => m.name === 'Cem');
  assert.ok(cem, 'the new member exists');
  assert.equal(cem.id, res.body.people.c);
  const azulGame = after.games.find((g) => g.title === 'Azul');
  assert.equal(azulGame.retired, true, 'a created game is retired by default');
  assert.deepEqual(azulGame.source, { provider: 'bgg', externalId: '230802', url: 'https://boardgamegeek.com/boardgame/230802' });
  assert.equal(after.games.find((g) => g.title === 'Pandemie').retired, false, '„ins Regal" was chosen');

  const byRef = new Map(after.sessions.map((s) => [s.importRef && s.importRef.id, s]));
  const azul = byRef.get('p-azul');
  assert.deepEqual(azul.importRef, { source: 'bgstats', id: 'p-azul' });
  assert.equal(azul.finished, true);
  assert.equal(azul.createdAt, '2025-03-07T18:30:00.000Z');
  assert.equal(azul.finishedAt, azul.createdAt);
  assert.equal(azul.dateOnly, false);
  assert.deepEqual(azul.votes, {}, 'nothing rated');
  assert.equal(azul.chosenGameId, azulGame.id);
  assert.deepEqual(azul.memberIds, [alice.id, cem.id]);
  assert.equal(azul.guests.length, 1);
  assert.equal(azul.guests[0].name, 'Dio');
  assert.deepEqual(azul.winnerIds, [alice.id]);
  assert.deepEqual(azul.scores, { [alice.id]: 61, [cem.id]: 40 }, 'a player without points has no seat in the map');
  assert.equal(azul.events[0].type, 'imported');
  assert.equal(azul.events[0].source, 'bgstats');

  const teams = byRef.get('p-teams');
  assert.equal(teams.chosenGameId, shelf.id, 'an existing game is reused');
  assert.equal(teams.dateOnly, true);
  assert.equal(teams.teams.length, 2);
  const red = teams.teams.find((tm) => tm.personIds.includes(alice.id));
  assert.deepEqual(red.personIds, [alice.id, bob.id]);
  assert.deepEqual(teams.winnerIds, [alice.id, bob.id]);
  const blue = teams.teams.find((tm) => tm !== red);
  assert.deepEqual(teams.scores, { [red.id]: 7, [blue.id]: 3 }, 'points per party: the team scores');

  const coop = byRef.get('p-coop');
  assert.equal(coop.ending, 'lost');
  assert.deepEqual(coop.winnerIds, []);
  assert.equal('guests' in coop, false, 'absent-key discipline: no guests, no key');
  assert.equal('teams' in coop, false);
  assert.equal('scores' in coop, false);
});

test('a second import of the same plays writes nothing — no sessions, no seats', async () => {
  const { round, body } = await setup();
  await request(app).post(base(round.id)).send(body);
  const before = await get(round.id);
  const again = await request(app).post(base(round.id)).send(body);
  assert.equal(again.status, 201);
  assert.equal(again.body.imported, 0);
  assert.equal(again.body.skipped, 3);
  assert.deepEqual(again.body.people, {});
  const after = await get(round.id);
  assert.equal(after.sessions.length, before.sessions.length);
  assert.equal(after.members.length, before.members.length, 'a re-run must not grow „Cem" a second seat');
  assert.equal(after.games.length, before.games.length);
});

test('an imported play is hand-dated: a winner tapped in later keeps its finish on that day', async () => {
  const { round, body, bob } = await setup();
  await request(app).post(base(round.id)).send(body);
  const s = (await get(round.id)).sessions.find((x) => x.importRef && x.importRef.id === 'p-coop');
  const res = await request(app).post(`/api/rounds/${round.id}/sessions/${s.id}/finish`).send({ winnerIds: [bob.id] });
  assert.equal(res.status, 200);
  assert.equal(res.body.finishedAt, s.createdAt);
});

test('an imported old play sorts before a session played today', async () => {
  const { round, body, shelf } = await setup();
  await request(app).post(`/api/rounds/${round.id}/sessions`).send({ gameId: shelf.id });
  await request(app).post(base(round.id)).send(body);
  const ids = (await get(round.id)).sessions.map((s) => (s.importRef ? s.importRef.id : 'today'));
  assert.deepEqual(ids, ['p-azul', 'p-teams', 'p-coop', 'today']);
});

test('a play with nobody from the round left is dropped and counted, not written', async () => {
  const { round, body } = await setup();
  const plays = [{ id: 'only-guest', playedOn: '2025-01-01T18:00:00.000Z', gameKey: 'shelf', players: [{ key: 'd' }, { key: 'nobody' }] }];
  const res = await request(app).post(base(round.id)).send({ ...body, plays });
  assert.equal(res.status, 201);
  assert.equal(res.body.imported, 0);
  assert.equal(res.body.empty, 1);
});

test('the route refuses what the client got wrong', async () => {
  const { round, body } = await setup();
  const post = (b) => request(app).post(base(round.id)).send(b);
  const future = new Date(Date.now() + 86400000 * 3).toISOString();
  assert.equal((await post({ ...body, plays: [{ ...PLAYS[0], playedOn: future }] })).status, 400, 'a future date');
  assert.equal((await post({ ...body, plays: [{ ...PLAYS[0], playedOn: '1999-12-31T18:00:00.000Z' }] })).status, 400, 'before 2000');
  assert.equal((await post({ ...body, people: [{ key: 'a', memberId: 'not-a-member' }] })).body.error, 'Unknown member');
  assert.equal((await post({ ...body, people: [{ key: 'a', memberId: body.people[0].memberId, guest: 'x' }] })).status, 400, 'two mappings for one person');
  assert.equal((await post({ ...body, games: [{ key: 'shelf', gameId: 'nope' }] })).body.error, 'Unknown game');
  assert.equal((await post({ ...body, plays: [{ ...PLAYS[0], gameKey: 'unmapped' }] })).body.error, 'Unknown game key');
  assert.equal((await post({ ...body, source: 'spreadsheet' })).status, 400);
  const many = Array.from({ length: IMPORT_BATCH_MAX + 1 }, (_, i) => ({ ...PLAYS[0], id: `x${i}` }));
  assert.equal((await post({ ...body, plays: many })).status, 400, 'over the batch cap');
  assert.equal((await post({ ...body, plays: [] })).status, 400, 'an empty batch');
  assert.equal((await get(round.id)).sessions.length, 0, 'none of it wrote anything');
});

test('an over-long name or title from the source is truncated, not refused', async () => {
  const { round, body } = await setup();
  const long = 'Bartholomäus-Maximilian von Hohenzollern-Sigmaringen';
  const people = body.people.map((p) => (p.key === 'c' ? { key: 'c', newMember: long } : p.key === 'd' ? { key: 'd', guest: long } : p));
  const games = body.games.map((g) => (g.key === 'bgg:230802' ? { key: g.key, create: { title: 'T'.repeat(260), bggId: 230802 } } : g));
  const res = await request(app).post(base(round.id)).send({ ...body, people, games });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const after = await get(round.id);
  const seat = after.members.find((m) => m.id === res.body.people.c);
  assert.equal(seat.name, long.slice(0, 30).trim());
  assert.equal(after.games.find((g) => g.id === res.body.games['bgg:230802']).title.length, 200);
});

test('an unknown round is a 404', async () => {
  const { body } = await setup();
  const res = await request(app).post(base('nope')).send(body);
  assert.equal(res.status, 404);
});
