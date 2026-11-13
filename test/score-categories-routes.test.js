'use strict';

/*
 * Scoring categories (#1780) through the real routes on the JSON backend:
 *  - PATCH …/games/:gid `scoreCategories` mints ids, keeps them on a rename,
 *    keeps a used category as `removed`, clears to absence, refuses bad lists;
 *  - PUT …/scores `parts` is stored beside the totals and must add up to them;
 *  - a re-save without `parts` keeps only the breakdowns its totals still match;
 *  - removing a person takes their breakdown with them (the played game's
 *    removal is in the repo contract, test/support/repo-contract.js).
 * The pure half is test/score-categories.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

async function addGame(rid, title = 'Flügelschlag') {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8' })) req.field(k, v);
  return (await req).body;
}
const PAST = '2026-03-01T20:00:00.000Z';
const patchGame = (rid, gid, body) => request(app).patch(`/api/rounds/${rid}/games/${gid}`).send(body);
const scores = (rid, sid, body) => request(app).put(`/api/rounds/${rid}/sessions/${sid}/scores`).send(body);
const roundOf = (rid) => request(app).get(`/api/rounds/${rid}`).then((r) => r.body);

async function scoredSetup() {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ gameId: game.id, playedOn: PAST });
  assert.equal(res.status, 201);
  const cats = await patchGame(round.id, game.id, { scoreCategories: [{ name: 'Vögel' }, { name: 'Eier' }] });
  assert.equal(cats.status, 200);
  const [birds, eggs] = cats.body.scoreCategories;
  return { round, game, session: res.body.session, birds, eggs };
}

test('a game’s categories: minted ids, a rename keeps them, a used removal stays as removed, a clear is absence', async () => {
  const { round, game, session, birds, eggs } = await scoredSetup();
  assert.match(birds.id, /^[0-9a-f]{12}$/);
  assert.deepEqual([birds.name, eggs.name], ['Vögel', 'Eier']);

  const renamed = await patchGame(round.id, game.id, { scoreCategories: [{ id: eggs.id, name: 'Eier gelegt' }, { id: birds.id, name: 'Vögel' }] });
  assert.deepEqual(renamed.body.scoreCategories, [{ id: eggs.id, name: 'Eier gelegt' }, { id: birds.id, name: 'Vögel' }]);

  const [alice] = round.members;
  await scores(round.id, session.id, { scores: { [alice.id]: 30 }, parts: { [alice.id]: { [eggs.id]: 10, [birds.id]: 20 } } });
  const cleared = await patchGame(round.id, game.id, { scoreCategories: null });
  assert.deepEqual(cleared.body.scoreCategories, [
    { id: eggs.id, name: 'Eier gelegt', removed: true }, { id: birds.id, name: 'Vögel', removed: true },
  ], 'still named for the export while a session holds their values');

  await scores(round.id, session.id, { scores: {} });
  const gone = await patchGame(round.id, game.id, { scoreCategories: [] });
  assert.equal('scoreCategories' in gone.body, false, 'nothing used and nothing active is absence');
});

test('a bad category list is a 400 and changes nothing', async () => {
  const { round, game } = await scoredSetup();
  for (const bad of [
    [{ name: '' }],
    [{ name: 'A' }, { name: 'a' }],
    [{ id: 'nope', name: 'A' }],
    Array.from({ length: 13 }, (_, i) => ({ name: `K${i}` })),
    'Vögel',
  ]) {
    const res = await patchGame(round.id, game.id, { scoreCategories: bad });
    assert.equal(res.status, 400, JSON.stringify(bad).slice(0, 40));
  }
  const stored = (await roundOf(round.id)).games.find((g) => g.id === game.id).scoreCategories;
  assert.deepEqual(stored.map((c) => c.name), ['Vögel', 'Eier']);
});

test('parts are stored beside the totals and must add up to them', async () => {
  const { round, session, birds, eggs } = await scoredSetup();
  const [alice, bob] = round.members;
  const ok = await scores(round.id, session.id, {
    scores: { [alice.id]: 30, [bob.id]: -2 },
    parts: { [alice.id]: { [birds.id]: 20, [eggs.id]: 10 }, [bob.id]: { [birds.id]: -2 } },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.scores, { [alice.id]: 30, [bob.id]: -2 }, 'the totals still decide everything');
  assert.deepEqual(ok.body.scoreParts, { [alice.id]: { [birds.id]: 20, [eggs.id]: 10 }, [bob.id]: { [birds.id]: -2 } });

  for (const parts of [
    { [alice.id]: { [birds.id]: 20, [eggs.id]: 9 } },
    { [alice.id]: { nope: 30 } },
    { [bob.id]: { [birds.id]: -2 }, 'not-a-seat': { [birds.id]: 1 } },
    'nope',
  ]) {
    const res = await scores(round.id, session.id, { scores: { [alice.id]: 30, [bob.id]: -2 }, parts });
    assert.equal(res.status, 400, JSON.stringify(parts).slice(0, 40));
    assert.equal(res.body.error, 'Invalid points breakdown');
  }
  const kept = (await roundOf(round.id)).sessions[0].scoreParts;
  assert.deepEqual(kept[alice.id], { [birds.id]: 20, [eggs.id]: 10 }, 'a refused save changed nothing');

  const none = await scores(round.id, session.id, { scores: { [alice.id]: 30 }, parts: {} });
  assert.equal('scoreParts' in none.body, false, 'an empty breakdown is absence');
});

test('a re-save without parts keeps only the breakdowns its totals still match', async () => {
  const { round, session, birds, eggs } = await scoredSetup();
  const [alice, bob] = round.members;
  await scores(round.id, session.id, {
    scores: { [alice.id]: 30, [bob.id]: 5 },
    parts: { [alice.id]: { [birds.id]: 20, [eggs.id]: 10 }, [bob.id]: { [eggs.id]: 5 } },
  });
  const res = await scores(round.id, session.id, { scores: { [alice.id]: 31, [bob.id]: 5 } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.scoreParts, { [bob.id]: { [eggs.id]: 5 } });
});

test('removing a person takes their breakdown with them', async () => {
  const { round, session, birds } = await scoredSetup();
  const [alice, bob] = round.members;
  await scores(round.id, session.id, {
    scores: { [alice.id]: 3, [bob.id]: 4 },
    parts: { [alice.id]: { [birds.id]: 3 }, [bob.id]: { [birds.id]: 4 } },
  });
  const del = await request(app).delete(`/api/rounds/${round.id}/sessions/${session.id}/people/${bob.id}`);
  assert.equal(del.status, 200);
  assert.deepEqual((await roundOf(round.id)).sessions[0].scoreParts, { [alice.id]: { [birds.id]: 3 } });

});
