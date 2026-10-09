'use strict';

/* A session team either SHARES one seat (counts as one player, the #575 case of
   pairs sharing a hand) or gives each of its people their OWN seat (counts its
   headcount — a cooperative table, Tichu's two pairs). #1610.

   Every fixture that has to tell the two apart holds BOTH kinds: with a single
   kind, "count the shared ones" and "count every team" are the same arithmetic,
   and a spec over it is green against a resolver that ignores the flag. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

global.t = (key, params) => `${key}:${JSON.stringify(params || {})}`;

const {
  sessionPartyCount,
  sessionPartyGroups,
  sessionSeatCount,
  teamSharesSeat,
} = require('../public/js/session-people');
const { partyDistribution } = require('../lib/recommend');
const { memberStats } = require('../public/js/member-stats');
const { sessionEnding } = require('../public/js/session-outcome');
const { isNameableGame } = require('../public/js/recap');

const round = {
  members: [
    { id: 'm1', name: 'Alice' },
    { id: 'm2', name: 'Bob' },
    { id: 'm3', name: 'Cleo' },
    { id: 'm4', name: 'Dora' },
  ],
  games: [],
  sessions: [],
};

// One shared-seat team, one own-seat team with a guest in it, and one person on
// their own: 1 + 3 + 1 = 5 seats over 3 parties.
const mixed = {
  memberIds: ['m1', 'm2', 'm3', 'm4'],
  guests: [{ id: 'g1', name: 'Eli' }],
  teams: [
    { id: 'tA', personIds: ['m1', 'm2'], sharedSeat: true },
    { id: 'tB', personIds: ['m3', 'g1', 'm4'], sharedSeat: false },
  ],
};

test('seats count a shared team as one and an own-seat team as its people', () => {
  // Five people, one of them on their own.
  const s = { ...mixed, memberIds: ['m1', 'm2', 'm3', 'm4'], guests: [{ id: 'g1', name: 'Eli' }, { id: 'g2', name: 'Fay' }] };
  assert.equal(sessionSeatCount(round, s), 1 + 3 + 1);
  // The PARTY count — contest semantics — is untouched by the flag.
  assert.equal(sessionPartyCount(round, s), 3);
});

test('each party carries its seat count, and a team its resolved sharedSeat', () => {
  const parties = sessionPartyGroups(round, mixed);
  assert.deepEqual(parties.map((p) => [p.id, p.seats, p.sharedSeat]), [
    ['tA', 1, true],
    ['tB', 3, false],
  ]);
});

/* Legacy teams (#575) carry no `sharedSeat` key. Absent is inferred from the
   team's SHAPE: one holding the whole table reads as own seats (nobody forms one
   whole-table team to mean "solo"), any other as a shared seat (#575's meaning). */
test('legacy shape: a whole-table team counts its headcount', () => {
  const s = { memberIds: ['m1', 'm2', 'm3', 'm4'], teams: [{ id: 't', personIds: ['m1', 'm2', 'm3', 'm4'] }] };
  assert.equal(sessionSeatCount(round, s), 4);
});

test('legacy shape: a partial team still counts as one seat', () => {
  const s = { memberIds: ['m1', 'm2', 'm3', 'm4'], teams: [{ id: 't', personIds: ['m1', 'm2'] }] };
  assert.equal(sessionSeatCount(round, s), 3);
});

test('an explicit sharedSeat always wins over the inference', () => {
  const whole = { memberIds: ['m1', 'm2', 'm3', 'm4'], teams: [{ id: 't', personIds: ['m1', 'm2', 'm3', 'm4'], sharedSeat: true }] };
  assert.equal(sessionSeatCount(round, whole), 1);
  const partial = { memberIds: ['m1', 'm2', 'm3', 'm4'], teams: [{ id: 't', personIds: ['m1', 'm2'], sharedSeat: false }] };
  assert.equal(sessionSeatCount(round, partial), 4);
});

// "Everyone at the table" is decided against the RESOLVED people, so a member
// removed from the round since (#1538) shrinks the table and the team together.
test('the whole-table inference reads the resolved people, not the stored ids', () => {
  const s = { memberIds: ['m1', 'm2', 'm3'], teams: [{ id: 't', personIds: ['m1', 'm2', 'm3', 'gone'] }] };
  const people = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }];
  assert.equal(teamSharesSeat({ people }, people), false);
  assert.equal(sessionSeatCount(round, s), 3);
});

test('the recommender counts a whole-table own-seat team at its headcount', () => {
  const r = {
    ...round,
    sessions: [
      { id: 's1', gameIds: [], votes: {}, memberIds: ['m1', 'm2', 'm3', 'm4'], teams: [{ id: 't', personIds: ['m1', 'm2', 'm3', 'm4'], sharedSeat: false }] },
      { id: 's2', gameIds: [], votes: {}, memberIds: ['m1', 'm2', 'm3', 'm4'], teams: [{ id: 't', personIds: ['m1', 'm2'], sharedSeat: true }] },
    ],
  };
  assert.deepEqual(partyDistribution(r), [
    { players: 3, share: 0.5 },
    { players: 4, share: 0.5 },
  ]);
});

// Contest semantics stay on SIDES (#1610 scope): a table that won together
// against the game is still not a contest between players, however many seats.
test('a whole-table own-seat team is still not a contest', () => {
  const s = {
    id: 's1', gameIds: ['g'], chosenGameId: 'g', votes: {}, finished: true,
    memberIds: ['m1', 'm2', 'm3', 'm4'],
    teams: [{ id: 't', personIds: ['m1', 'm2', 'm3', 'm4'], sharedSeat: false }],
    winnerIds: ['m1', 'm2', 'm3', 'm4'],
  };
  assert.equal(sessionSeatCount(round, s), 4);
  assert.equal(sessionPartyCount(round, s), 1);
  const stats = memberStats({ ...round, games: [{ id: 'g', title: 'Coop' }], sessions: [s] }, 'm1', {
    sessionEnding, sessionPartyCount, sessionPartyGroups, isNameableGame,
  });
  assert.equal(stats.winRate, null);
});

/* ------------------------------ the draw route ------------------------------ */

const request = require('supertest');
const { app, createRound } = require('./helpers');

async function addGame(rid, fields) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Game', minPlayers: '1', maxPlayers: '8', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  const res = await req;
  assert.equal(res.status, 201);
  return res.body;
}

// Alice + Bob + two guests = four people throughout.
function draw(rid, teams) {
  return request(app).post(`/api/rounds/${rid}/sessions`).send({ count: 3, guests: ['Dana', 'Eli'], teams });
}

test('one own-seat team of four draws a four-player pool, not a solo one', async () => {
  const round = await createRound(request);
  const [alice, bob] = round.members;
  await addGame(round.id, { title: 'Coop', minPlayers: '2', maxPlayers: '4' });
  await addGame(round.id, { title: 'Solo', minPlayers: '1', maxPlayers: '1' });
  const whole = [{ memberIds: [alice.id, bob.id], guestIndices: [0, 1], sharedSeat: false }];
  const res = await draw(round.id, whole);
  assert.equal(res.status, 201);
  const titles = res.body.games.map((g) => g.title).sort();
  assert.deepEqual(titles, ['Coop']);
  assert.equal(res.body.session.teams[0].sharedSeat, false);
});

test('Tichu (4–4) is drawn for two own-seat pairs and refused for two shared-seat pairs', async () => {
  const round = await createRound(request);
  const [alice, bob] = round.members;
  await addGame(round.id, { title: 'Tichu', minPlayers: '4', maxPlayers: '4' });
  const pairs = (sharedSeat) => [
    { memberIds: [alice.id], guestIndices: [0], sharedSeat },
    { memberIds: [bob.id], guestIndices: [1], sharedSeat },
  ];
  assert.equal((await draw(round.id, pairs(false))).status, 201);
  // Two pairs each sharing a hand are two players — as every team was before.
  assert.equal((await draw(round.id, pairs(true))).status, 400);
});

// One of each kind, so the count can only be right if the flag is read per team.
test('a shared-seat pair beside an own-seat pair counts three', async () => {
  const round = await createRound(request);
  const [alice, bob] = round.members;
  await addGame(round.id, { title: 'Three', minPlayers: '3', maxPlayers: '3' });
  const res = await draw(round.id, [
    { memberIds: [alice.id], guestIndices: [0], sharedSeat: true },
    { memberIds: [bob.id], guestIndices: [1], sharedSeat: false },
  ]);
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.session.teams.map((tm) => tm.sharedSeat), [true, false]);
});

// A pre-#1610 bundle sends no key; the route must not invent one, so the read
// side's shape inference applies. Junk is "not said" too.
test('a team sent without a boolean sharedSeat is stored without the key', async () => {
  const round = await createRound(request);
  const [alice] = round.members;
  await addGame(round.id, { title: 'Any' });
  const res = await draw(round.id, [
    { memberIds: [alice.id], guestIndices: [0] },
    { memberIds: [], guestIndices: [1], sharedSeat: 'yes' },
  ]);
  assert.equal(res.status, 201);
  assert.equal('sharedSeat' in res.body.session.teams[0], false);
});
