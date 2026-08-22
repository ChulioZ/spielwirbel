'use strict';

/* Multi-table sessions end to end (#796): the relaxed draw pool, the lazily
   computed and PERSISTED proposals, the confirm that spawns one session per
   table, and the guards that keep a split parent from acquiring an outcome its
   children already carry.

   The two things a route test can see that a unit test cannot are the
   persistence and the guards — the recommendation never moving once computed is
   the property the whole server-side design exists for, and every guard here is
   a state a hand-rolled request could otherwise reach. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

const NAMES = ['Anna', 'Ben', 'Dana', 'Eli', 'Frida', 'Georg', 'Hana', 'Ivo', 'Jo'];

async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Game', minPlayers: '2', maxPlayers: '4', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  return (await req).body;
}

// Nine members, three 2-4 player games: no single game seats the group, so the
// ordinary pool is empty and only the multi-table one is not.
async function nineWithThreeSmallGames() {
  const round = await createRound(request, { name: 'Big round', members: NAMES });
  const games = [];
  for (const title of ['Catan', 'Azul', 'Splendor']) games.push(await addGame(round.id, { title }));
  return { round, games };
}

// Start a multi-table session, have everyone rate every drawn game, and close it.
async function votedSession(round, { rating = () => 4 } = {}) {
  const start = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 5, multiTable: true });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const session = start.body.session;
  for (const member of start.body.members) {
    const votes = {};
    session.gameIds.forEach((gid, i) => { votes[gid] = { rating: rating(member, gid, i) }; });
    await request(app)
      .post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${member.id}`)
      .send({ votes });
  }
  const closed = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});
  assert.equal(closed.status, 200);
  return closed.body;
}

/* ---- The pool ---- */

test('multi-table relaxes the pool to games that seat SOME table', async () => {
  const { round, games } = await nineWithThreeSmallGames();

  const plain = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 5 });
  assert.equal(plain.status, 400, 'nine people fit no 2-4 player game');
  assert.equal(plain.body.error, 'No matching games in this round');

  const multi = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 5, multiTable: true });
  assert.equal(multi.status, 201);
  assert.deepEqual(multi.body.session.gameIds.sort(), games.map((g) => g.id).sort());
  assert.equal(multi.body.session.multiTable, true);
});

test('with the flag off the session grows no key at all', async () => {
  const round = await createRound(request);
  await addGame(round.id, { title: 'A', minPlayers: '1', maxPlayers: '8' });
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  assert.equal('multiTable' in res.body.session, false);
  // Absent-key parity, the same rule `guests` and `teams` keep — a normal
  // session's blob must stay byte-identical across both backends.
  assert.equal('multiTable' in (round.lastSessionFilters || {}), false);
});

test('only a literal true turns it on', async () => {
  const { round } = await nineWithThreeSmallGames();
  for (const value of ['true', 1, {}, 'yes']) {
    const res = await request(app)
      .post(`/api/rounds/${round.id}/sessions`)
      .send({ count: 5, multiTable: value });
    assert.equal(res.status, 400, `multiTable: ${JSON.stringify(value)} must not relax the pool`);
  }
});

test('the flag is remembered as a draw preset', async () => {
  const { round } = await nineWithThreeSmallGames();
  await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 5, multiTable: true });
  const fresh = (await request(app).get(`/api/rounds/${round.id}`)).body;
  assert.equal(fresh.lastSessionFilters.multiTable, true);
});

/* ---- The proposals ---- */

test('proposals are computed once and then never move', async () => {
  const { round } = await nineWithThreeSmallGames();
  const session = await votedSession(round, { rating: (m, gid, i) => 1 + ((m.name.length + i) % 5) });

  const first = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/tables`).send({});
  assert.equal(first.status, 200);
  assert.ok(first.body.proposals.length, 'nine people over three 4-seat games is feasible');

  // The stability guarantee: a second request — a reload, a second device, a
  // deploy in between — answers with exactly what is stored.
  const second = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/tables`).send({});
  assert.deepEqual(second.body.proposals, first.body.proposals);

  const stored = (await request(app).get(`/api/rounds/${round.id}`)).body.sessions
    .find((s) => s.id === session.id);
  assert.deepEqual(stored.tableProposals, first.body.proposals);
});

test('two simultaneous first opens cannot produce two proposal sets', async () => {
  const { round } = await nineWithThreeSmallGames();
  const session = await votedSession(round);
  const url = `/api/rounds/${round.id}/sessions/${session.id}/tables`;
  const [a, b] = await Promise.all([
    request(app).post(url).send({}),
    request(app).post(url).send({}),
  ]);
  assert.deepEqual(a.body.proposals, b.body.proposals);
});

test('the builder is refused before the vote closes, and for an ordinary session', async () => {
  const { round } = await nineWithThreeSmallGames();
  const open = (await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 5, multiTable: true })).body.session;
  const early = await request(app).post(`/api/rounds/${round.id}/sessions/${open.id}/tables`).send({});
  assert.equal(early.status, 400);
  assert.equal(early.body.error, 'voting_open');

  const plainRound = await createRound(request);
  await addGame(plainRound.id, { title: 'A', minPlayers: '1', maxPlayers: '8' });
  const plain = (await request(app).post(`/api/rounds/${plainRound.id}/sessions`).send({ count: 1 })).body.session;
  await request(app).post(`/api/rounds/${plainRound.id}/sessions/${plain.id}/close`).send({});
  const refused = await request(app).post(`/api/rounds/${plainRound.id}/sessions/${plain.id}/tables`).send({});
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'not_multi_table');
});

/* ---- The confirm ---- */

async function readyToSplit() {
  const { round, games } = await nineWithThreeSmallGames();
  const session = await votedSession(round);
  const proposals = (await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/tables`).send({})).body.proposals;
  return { round, games, session, tables: proposals[0].tables };
}

test('confirming creates one session per table, linked both ways', async () => {
  const { round, session, tables } = await readyToSplit();
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/split`)
    .send({ tables });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.children.length, tables.length);

  res.body.children.forEach((child, i) => {
    assert.equal(child.chosenGameId, tables[i].gameId);
    assert.equal(child.gameIds.length, 1);
    assert.equal(child.done, true, 'a child is a direct-pick session, with no voting phase');
    assert.deepEqual(child.votes, {}, 'copying the parent votes would double-count every rating');
    assert.equal(child.parentSessionId, session.id);
    assert.deepEqual(child.memberIds.sort(), tables[i].personIds.slice().sort());
  });
  assert.deepEqual(res.body.session.childSessionIds, res.body.children.map((c) => c.id));

  // And the parent now reads as split rather than as an evening still deciding.
  const stored = (await request(app).get(`/api/rounds/${round.id}`)).body.sessions
    .find((s) => s.id === session.id);
  assert.equal(stored.chosenGameId, null);
  assert.equal(stored.finished, false);
  assert.equal(stored.cancelled, false);
  assert.ok(stored.events.some((e) => e.type === 'split' && e.count === tables.length));
});

test('a second confirm is refused and creates nothing', async () => {
  const { round, session, tables } = await readyToSplit();
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/split`).send({ tables });
  const before = (await request(app).get(`/api/rounds/${round.id}`)).body.sessions.length;

  const again = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/split`)
    .send({ tables });
  assert.equal(again.status, 400);
  assert.equal(again.body.error, 'already_split');
  const after = (await request(app).get(`/api/rounds/${round.id}`)).body.sessions.length;
  assert.equal(after, before, 'a double tap must not double the evening');
});

test('every refusal the builder prevents is refused again server-side', async () => {
  const { round, session, tables, games } = await readyToSplit();
  const post = (payload) => request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/split`)
    .send(payload);
  const clone = () => JSON.parse(JSON.stringify(tables));

  assert.equal((await post({ tables: [tables[0]] })).body.error, 'bad_tables');

  const emptied = clone();
  emptied[1].personIds.forEach((pid) => emptied[0].personIds.push(pid));
  emptied[1].personIds = [];
  assert.equal((await post({ tables: emptied })).body.error, 'bad_tables');

  const dropped = clone();
  dropped[0].personIds.pop();
  assert.equal((await post({ tables: dropped })).body.error, 'people_mismatch');

  const doubled = clone();
  doubled[1].personIds[0] = doubled[0].personIds[0];
  assert.equal((await post({ tables: doubled })).body.error, 'person_twice');

  const sameGame = clone();
  sameGame[1].gameId = sameGame[0].gameId;
  assert.equal((await post({ tables: sameGame })).body.error, 'duplicate_game');

  const foreign = clone();
  foreign[0].gameId = 'nope';
  assert.equal((await post({ tables: foreign })).body.error, 'unknown_game');

  // A game the round archived since the draw is no longer splittable — the same
  // reasoning the direct-pick guard uses.
  const kept = clone();
  await request(app).post(`/api/rounds/${round.id}/games/${kept[0].gameId}/retire`).send({ retired: true });
  assert.equal((await post({ tables: kept })).body.error, 'unknown_game');
  await request(app).post(`/api/rounds/${round.id}/games/${kept[0].gameId}/retire`).send({ retired: false });
  assert.ok(games.length);
});

test('a table below the floor is refused even when the box would seat it', async () => {
  // Nine people over three tables is 3/3/3; moving one person makes a 2 and a 4,
  // and a 2 is inside the game's 2-4 range but below MIN_TABLE_PARTIES.
  const { round, session, tables } = await readyToSplit();
  assert.equal(tables.length, 3, 'nine people over three 4-seat games is 3/3/3');
  const moved = JSON.parse(JSON.stringify(tables));
  moved[1].personIds.push(moved[0].personIds.pop());
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/split`)
    .send({ tables: moved });
  assert.equal(res.body.error, 'table_too_small');
});

test('an over-full table is refused, which nothing downstream would catch', async () => {
  // The sharpest of the refusals: a child is a direct-pick session and direct
  // pick consults NO player range (#532), so without this check the split would
  // simply create a session with five people at a four-player box and the group
  // would find out at the table.
  const round = await createRound(request, { name: 'Eight', members: NAMES.slice(0, 8) });
  const small = await addGame(round.id, { title: 'Four', minPlayers: '2', maxPlayers: '4' });
  const big = await addGame(round.id, { title: 'Six', minPlayers: '2', maxPlayers: '6' });
  const session = await votedSession(round);
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/tables`).send({});
  const everyone = (await request(app).get(`/api/rounds/${round.id}`)).body.members.map((m) => m.id);

  const ok = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/split`)
    .send({ tables: [
      { gameId: small.id, personIds: everyone.slice(0, 4) },
      { gameId: big.id, personIds: everyone.slice(4) },
    ] });
  assert.equal(ok.status, 201, 'the control: 4 + 4 is fine');

  const round2 = await createRound(request, { name: 'Eight again', members: NAMES.slice(0, 8) });
  const small2 = await addGame(round2.id, { title: 'Four', minPlayers: '2', maxPlayers: '4' });
  const big2 = await addGame(round2.id, { title: 'Six', minPlayers: '2', maxPlayers: '6' });
  const session2 = await votedSession(round2);
  await request(app).post(`/api/rounds/${round2.id}/sessions/${session2.id}/tables`).send({});
  const all2 = (await request(app).get(`/api/rounds/${round2.id}`)).body.members.map((m) => m.id);
  const bad = await request(app)
    .post(`/api/rounds/${round2.id}/sessions/${session2.id}/split`)
    .send({ tables: [
      { gameId: small2.id, personIds: all2.slice(0, 5) },
      { gameId: big2.id, personIds: all2.slice(5) },
    ] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'table_out_of_range');
});

test('a team may not be split across two tables', async () => {
  const round = await createRound(request, { name: 'Teams', members: NAMES });
  for (const title of ['Catan', 'Azul', 'Splendor']) await addGame(round.id, { title });
  const members = (await request(app).get(`/api/rounds/${round.id}`)).body.members;
  const start = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({
      count: 5,
      multiTable: true,
      memberIds: members.map((m) => m.id),
      teams: [{ memberIds: [members[0].id, members[1].id], guestIndices: [] }],
    });
  const session = start.body.session;
  assert.equal(session.teams.length, 1);
  for (const member of start.body.members) {
    const votes = {};
    session.gameIds.forEach((gid) => { votes[gid] = { rating: 4 }; });
    await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${member.id}`).send({ votes });
  }
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});
  const proposals = (await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/tables`).send({})).body.proposals;
  const tables = JSON.parse(JSON.stringify(proposals[0].tables));

  // The pair sit together in every proposal; tearing them apart by hand must not
  // be accepted, or the evening produces two half-teams playing different games.
  const teamIds = session.teams[0].personIds;
  const home = tables.find((tb) => tb.personIds.includes(teamIds[0]));
  const away = tables.find((tb) => tb !== home);
  home.personIds = home.personIds.filter((pid) => pid !== teamIds[1]);
  away.personIds.push(teamIds[1]);
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/split`)
    .send({ tables });
  assert.equal(res.body.error, 'team_split');
});

test('a guest is carried into their table under a FRESH id', async () => {
  const round = await createRound(request, { name: 'Guests', members: NAMES });
  for (const title of ['Catan', 'Azul', 'Splendor']) await addGame(round.id, { title });
  const start = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 5, multiTable: true, guests: ['Kim', 'Lea', 'Mo'] });
  const session = start.body.session;
  for (const person of [...start.body.members, ...start.body.guests]) {
    const votes = {};
    session.gameIds.forEach((gid) => { votes[gid] = { rating: 4 }; });
    await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/votes/${person.id}`).send({ votes });
  }
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});
  const proposals = (await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/tables`).send({})).body.proposals;
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/split`)
    .send({ tables: proposals[0].tables });
  assert.equal(res.status, 201);

  const parentGuestIds = new Set(session.guests.map((g) => g.id));
  const carried = res.body.children.flatMap((c) => c.guests || []);
  assert.equal(carried.length, 3, 'every guest sat down somewhere');
  assert.deepEqual(carried.map((g) => g.name).sort(), ['Kim', 'Lea', 'Mo']);
  // A guest id keys that session's own vote map and winnerIds, so reusing the
  // parent's would make two evenings' records collide on one person.
  carried.forEach((g) => assert.equal(parentGuestIds.has(g.id), false));
});

/* ---- The parent's outcome is not overwritable ---- */

test('a split parent can be neither cancelled nor given a chosen game', async () => {
  const { round, session, tables } = await readyToSplit();
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/split`).send({ tables });

  const cancel = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/cancel`).send({ cancelled: true });
  assert.equal(cancel.status, 400);
  assert.equal(cancel.body.error, 'already_split');

  const choice = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/choice`).send({ gameId: session.gameIds[0] });
  assert.equal(choice.status, 400);
  assert.equal(choice.body.error, 'already_split');
});

test('deleting a child leaves the parent readable, and vice versa', async () => {
  const { round, session, tables } = await readyToSplit();
  const children = (await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/split`).send({ tables })).body.children;

  await request(app).delete(`/api/rounds/${round.id}/sessions/${children[0].id}`);
  const afterChild = (await request(app).get(`/api/rounds/${round.id}`)).body.sessions;
  const parent = afterChild.find((s) => s.id === session.id);
  // The stored id is left dangling on purpose: the links are resolved at render
  // time and what does not resolve is dropped, the same shape teamsForPeople uses.
  assert.equal(parent.childSessionIds.length, tables.length);
  assert.equal(afterChild.filter((s) => children.some((c) => c.id === s.id)).length, tables.length - 1);

  await request(app).delete(`/api/rounds/${round.id}/sessions/${session.id}`);
  const orphans = (await request(app).get(`/api/rounds/${round.id}`)).body.sessions;
  assert.equal(orphans.find((s) => s.id === session.id), undefined);
  // The surviving tables keep a `parentSessionId` that now resolves to nothing.
  // That is the state the Chronik and the hub have to render as ordinary
  // sessions rather than nesting under a header that is not there.
  const stranded = orphans.filter((s) => s.parentSessionId === session.id);
  assert.equal(stranded.length, tables.length - 1);
  stranded.forEach((s) => assert.ok(s.chosenGameId, 'still a perfectly good direct-pick session'));
});
