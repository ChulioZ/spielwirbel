'use strict';

/*
 * The play-history import (#1665) creates a game from a BGG id with no cover
 * and no player range — the source names a game by id and title only. The
 * route fills both afterwards through bgg.cards(), fire-and-forget. These specs
 * poll the round until the fill lands, and stub BGG's /thing.
 */

process.env.BGG_API_TOKEN = 'test-token';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const COVER = (id) => `https://cf.geekdo-images.com/c${id}/pic${id}.jpg`;

// One <item> per id in the request, so a spec can see which ids were asked.
// `cover` overrides the thumbnail per id (null = none at all).
function stubThing(calls, { cover = {}, fail = false } = {}) {
  global.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (fail) return { status: 500, text: async () => 'down' };
    const ids = (new URL(u).searchParams.get('id') || '').split(',').filter(Boolean);
    const items = ids.map((id) => {
      const thumb = id in cover ? cover[id] : COVER(id);
      return `<item type="boardgame" id="${id}"><name type="primary" value="Game ${id}"/>
        ${thumb ? `<thumbnail>${thumb}</thumbnail>` : ''}
        <minplayers value="2"/><maxplayers value="5"/></item>`;
    }).join('');
    return { status: 200, text: async () => `<?xml version="1.0" encoding="utf-8"?><items>${items}</items>` };
  };
}

async function importGames(games) {
  const round = await createRound(request, { name: 'Cards' });
  const [alice] = round.members;
  const plays = games.map((g, i) => ({
    id: `p-${i}`, playedOn: '2025-03-07T18:00:00.000Z', gameKey: g.key, players: [{ key: 'a', win: true }],
  }));
  const res = await request(app).post(`/api/rounds/${round.id}/sessions/import`)
    .send({ source: 'bgstats', people: [{ key: 'a', memberId: alice.id }], games, plays });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { round, ids: res.body.games };
}

async function pollGames(rid, done) {
  let games = [];
  for (let i = 0; i < 100; i++) {
    games = (await request(app).get(`/api/rounds/${rid}`)).body.games;
    if (done(games)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return games;
}

test('an imported BGG-linked game gets its cover and player range, shelved or retired', async () => {
  const calls = [];
  stubThing(calls);
  const { round, ids } = await importGames([
    { key: 'bgg:71001', create: { title: 'Azul', bggId: 71001 } },
    { key: 'bgg:71002', create: { title: 'Pandemie', bggId: 71002, shelf: true } },
    { key: 'free', create: { title: 'Hausregel-Spiel' } },
  ]);
  const games = await pollGames(round.id, (gs) => gs.filter((g) => g.source).every((g) => g.image));
  const byId = new Map(games.map((g) => [g.id, g]));

  for (const [key, ext] of [['bgg:71001', '71001'], ['bgg:71002', '71002']]) {
    const g = byId.get(ids[key]);
    assert.equal(g.image, COVER(ext), `${key} carries BGG's hotlinked cover`);
    assert.equal(g.minPlayers, 2);
    assert.equal(g.maxPlayers, 5);
  }
  const free = byId.get(ids.free);
  assert.equal(free.image, null, 'a game with no BGG id asks nothing');

  const cardCalls = calls.filter((u) => u.includes('/thing') && !u.includes('stats=1'));
  assert.equal(cardCalls.length, 1, 'both linked games ride ONE plain /thing call');
  assert.match(cardCalls[0], /71001/);
  assert.match(cardCalls[0], /71002/);
});

test('a cover outside the host allowlist is not stored, the range still is', async () => {
  const calls = [];
  stubThing(calls, { cover: { 71011: 'https://evil.example/x.jpg' } });
  const { round, ids } = await importGames([{ key: 'bgg:71011', create: { title: 'Spiel', bggId: 71011 } }]);
  const games = await pollGames(round.id, (gs) => gs.some((g) => g.minPlayers != null));
  const g = games.find((x) => x.id === ids['bgg:71011']);
  assert.equal(g.minPlayers, 2);
  assert.equal(g.maxPlayers, 5);
  assert.equal(g.image, null);
});

test('a BGG outage never fails the import', async () => {
  const calls = [];
  stubThing(calls, { fail: true });
  const { round, ids } = await importGames([{ key: 'bgg:71021', create: { title: 'Spiel', bggId: 71021 } }]);
  await pollGames(round.id, () => calls.length > 0);
  const g = (await request(app).get(`/api/rounds/${round.id}`)).body.games.find((x) => x.id === ids['bgg:71021']);
  assert.equal(g.image, null);
  assert.equal(g.minPlayers, null);
});
