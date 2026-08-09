'use strict';

/*
 * BGG weight + description (#717): the create-time resolution, the two lazy
 * backfill triggers (game-detail open, session start) and the vote-link ballot
 * projection.
 *
 * The provider cache is per-process and keyed on the external id, so EVERY spec
 * uses its own id — reuse one and a spec is answered from an earlier spec's
 * entry and proves nothing (the test/lookup.test.js trap).
 */

process.env.BGG_API_TOKEN = 'test-token';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

// A /thing body in BGG's shape, one <item> per entry. Like the real API, the
// <statistics> block appears ONLY when the request carried stats=1 — that is
// what lets these specs see a dropped stats=1 parameter at all (a stub that
// always serves it is blind to exactly that break). The community `average`
// sibling rides along so a sloppy name match would import the wrong number
// (7.0 instead of the weight) and fail the assertions loudly.
const thingXml = (items, withStats) => `<?xml version="1.0" encoding="utf-8"?><items>${items
  .map(({ id, weight, desc, playtime, age, cats, mechs }) => `<item type="boardgame" id="${id}">
    <name type="primary" value="Game ${id}"/>
    <minplayers value="2"/><maxplayers value="4"/>
    ${desc ? `<description>${desc}</description>` : ''}
    ${playtime ? `<minplaytime value="${playtime[0]}"/><maxplaytime value="${playtime[1]}"/>` : ''}
    ${age ? `<minage value="${age}"/>` : ''}
    ${(cats || []).map((c) => `<link type="boardgamecategory" id="1" value="${c}"/>`).join('')}
    ${(mechs || []).map((m) => `<link type="boardgamemechanic" id="2" value="${m}"/>`).join('')}
    ${withStats ? `<statistics><ratings><average value="7.0"/><bayesaverage value="6.9"/>
      ${weight ? `<averageweight value="${weight}"/>` : '<averageweight value="0"/>'}
    </ratings></statistics>` : ''}
  </item>`)
  .join('')}</items>`;

// The GET …/provider-info response shape, so a spec states only what it cares
// about. `rating: 7.0` is the default because the stub's <average> is served
// with stats=1 on every call — the detail surface DOES carry it (the ballot
// projection is where it is withheld; see the vote-link spec below).
const infoBody = (over = {}) => ({
  weight: null, description: null, minPlaytime: null, maxPlaytime: null,
  minAge: null, categories: [], mechanics: [], rating: 7.0, ...over,
});

const stubFetch = (items) => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return { status: 200, text: async () => thingXml(items, /stats=1/.test(String(url))) };
  };
  return calls;
};

async function makeRound(name) {
  const res = await request(app).post('/api/rounds').send({ name, members: ['Anna', 'Ben'] });
  return res.body.id;
}

const bggSource = (id) => ({
  sourceProvider: 'bgg',
  sourceExternalId: id,
  sourceUrl: `https://boardgamegeek.com/boardgame/${id}`,
});

test('POST games with a BGG source stores weight + description, resolved server-side', async () => {
  const rid = await makeRound('Info-Create');
  stubFetch([{ id: '900001', weight: '2.2809', desc: 'Handel &amp; Bau.' }]);
  const res = await request(app).post(`/api/rounds/${rid}/games`).send({
    title: 'Catan', minPlayers: 3, maxPlayers: 4, ...bggSource('900001'),
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.weight, 2.2809);
  assert.equal(res.body.description, 'Handel & Bau.');
  assert.equal(typeof res.body.providerInfoAt, 'string');
});

test('a client cannot dictate weight or description on create', async () => {
  const rid = await makeRound('Info-Trust');
  // No provider link -> no resolution runs; the client-sent fields are ignored.
  const res = await request(app).post(`/api/rounds/${rid}/games`).send({
    title: 'Selbstgebaut', minPlayers: 2, maxPlayers: 4,
    weight: 4.9, description: 'attacker-controlled text',
  });
  assert.equal(res.status, 201);
  assert.equal('weight' in res.body, false);
  assert.equal('description' in res.body, false);
});

test('GET provider-info backfills a linked game missing the fields, once', async () => {
  const rid = await makeRound('Info-Detail');
  // Seed through the repo, not the route, so the game starts WITHOUT the info —
  // the pre-#717 shape the backfill exists for.
  const game = await repo.createGame('default', rid, {
    title: 'Alt', minPlayers: 2, maxPlayers: 4, image: null,
    source: { provider: 'bgg', externalId: '900002', url: null },
  });
  const calls = stubFetch([{ id: '900002', weight: '3.5', desc: 'Ein Aufbauspiel.' }]);

  const res = await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, infoBody({ weight: 3.5, description: 'Ein Aufbauspiel.' }));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /stats=1/);

  // Persisted: the round read now carries the fields.
  const stored = (await repo.getRound('default', rid)).games.find((g) => g.id === game.id);
  assert.equal(stored.weight, 3.5);
  assert.equal(stored.description, 'Ein Aufbauspiel.');

  // A second open answers from the store — no further upstream request.
  const again = await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.deepEqual(again.body, infoBody({ weight: 3.5, description: 'Ein Aufbauspiel.' }));
  assert.equal(calls.length, 1);
});

test('a game BGG has no data for is stamped and not re-fetched on every view', async () => {
  const rid = await makeRound('Info-NoData');
  const game = await repo.createGame('default', rid, {
    title: 'Obskur', minPlayers: 2, maxPlayers: 4, image: null,
    source: { provider: 'bgg', externalId: '900003', url: null },
  });
  const calls = stubFetch([{ id: '900003' }]); // averageweight=0, no description

  const first = await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.deepEqual(first.body, infoBody());
  assert.equal(calls.length, 1);

  const second = await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.deepEqual(second.body, infoBody());
  assert.equal(calls.length, 1, 'the stamped attempt suppresses a re-fetch inside the TTL');
});

test('an upstream failure stamps nothing, so the next trigger retries', async () => {
  const rid = await makeRound('Info-Fail');
  const game = await repo.createGame('default', rid, {
    title: 'Down', minPlayers: 2, maxPlayers: 4, image: null,
    source: { provider: 'bgg', externalId: '900004', url: null },
  });
  // 404 is final for fetchXml (no retry loop), so the spec stays fast.
  global.fetch = async () => ({ status: 404, text: async () => '' });
  const res = await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, infoBody({ rating: null }));

  const stored = (await repo.getRound('default', rid)).games.find((g) => g.id === game.id);
  assert.equal('providerInfoAt' in stored, false, 'a failed fetch must not suppress the retry for the whole TTL');

  // Upstream recovers -> the next open fills the fields.
  const calls = stubFetch([{ id: '900004', weight: '1.8', desc: 'Leicht.' }]);
  const retry = await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.deepEqual(retry.body, infoBody({ weight: 1.8, description: 'Leicht.' }));
  assert.equal(calls.length, 1);
});

test('a game without a provider link answers its stored nulls with no fetch', async () => {
  const rid = await makeRound('Info-Freetext');
  const game = await repo.createGame('default', rid, {
    title: 'Hausregel', minPlayers: 2, maxPlayers: 4, image: null, source: null,
  });
  const calls = stubFetch([]);
  const res = await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.deepEqual(res.body, infoBody({ rating: null }));
  assert.equal(calls.length, 0);
});

test('a game already carrying #717\'s fields still receives the ones #724 added', async () => {
  /* THE TRAP, and the one break in this PR that fails completely silently.
   * needsProviderInfo short-circuits on a completeness check; leave it on the
   * old {weight, description} pair and every game the #717 backfill already
   * filled returns false FOREVER — so the games with the BEST coverage are
   * exactly the ones that never receive playtime, age, categories, mechanics or
   * the rating. No error, no failing route, and the feature looks implemented.
   *
   * Seeded WITHOUT providerInfoAt so the TTL gate is not what is under test —
   * this spec is about the completeness check alone. */
  const rid = await makeRound('Info-Widen');
  const game = await repo.createGame('default', rid, {
    title: 'Schon gefüllt', minPlayers: 2, maxPlayers: 4, image: null,
    source: { provider: 'bgg', externalId: '900012', url: null },
    weight: 2.5, description: 'Bereits da.',
  });
  const calls = stubFetch([{
    id: '900012', weight: '2.5', desc: 'Bereits da.',
    playtime: [45, 75], age: 12, cats: ['Economic'], mechs: ['Worker Placement', 'Trading'],
  }]);

  const res = await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.equal(calls.length, 1, 'a game with only the old fields was treated as complete');
  assert.deepEqual(res.body, infoBody({
    weight: 2.5, description: 'Bereits da.', minPlaytime: 45, maxPlaytime: 75,
    minAge: 12, categories: ['Economic'], mechanics: ['Worker Placement', 'Trading'],
  }));

  const stored = (await repo.getRound('default', rid)).games.find((g) => g.id === game.id);
  assert.equal(stored.minPlaytime, 45);
  assert.equal(stored.minAge, 12);
  assert.deepEqual(stored.mechanics, ['Worker Placement', 'Trading']);
  assert.equal(stored.rating, 7.0);
});

test('a game carrying EVERY field is complete — the widened check still terminates', async () => {
  /* The other half, and the one that keeps the fix above from being "always
   * re-fetch": a fully-filled game must still short-circuit, or every view of
   * every game costs an upstream request per TTL forever. Seeded with no
   * providerInfoAt, so only the completeness check can stop it. */
  const rid = await makeRound('Info-Complete');
  const game = await repo.createGame('default', rid, {
    title: 'Komplett', minPlayers: 2, maxPlayers: 4, image: null,
    source: { provider: 'bgg', externalId: '900013', url: null },
    weight: 2.5, description: 'Alles da.', minPlaytime: 45, maxPlaytime: 75, minAge: 12,
    categories: ['Economic'], mechanics: ['Trading'], rating: 7.4,
  });
  const calls = stubFetch([{ id: '900013' }]);
  await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.equal(calls.length, 0, 'a complete game must not ask the provider again');
});

test('session start backfills the drawn games in one batched request', async () => {
  const rid = await makeRound('Info-Session');
  const g1 = await repo.createGame('default', rid, {
    title: 'Eins', minPlayers: 1, maxPlayers: 6, image: null,
    source: { provider: 'bgg', externalId: '900005', url: null },
  });
  const g2 = await repo.createGame('default', rid, {
    title: 'Zwei', minPlayers: 1, maxPlayers: 6, image: null,
    source: { provider: 'bgg', externalId: '900006', url: null },
  });
  const calls = stubFetch([
    { id: '900005', weight: '2.5', desc: 'Erstes.' },
    { id: '900006', weight: '4.1', desc: 'Zweites.' },
  ]);

  const res = await request(app).post(`/api/rounds/${rid}/sessions`).send({ count: 2 });
  assert.equal(res.status, 201);

  // Fire-and-forget: poll the store until the backfill lands.
  let stored;
  for (let i = 0; i < 50; i++) {
    stored = (await repo.getRound('default', rid)).games;
    if (stored.every((g) => g.weight != null)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const byId = new Map(stored.map((g) => [g.id, g]));
  assert.equal(byId.get(g1.id).weight, 2.5);
  assert.equal(byId.get(g1.id).description, 'Erstes.');
  assert.equal(byId.get(g2.id).weight, 4.1);
  // One batched /thing call carrying both ids (the draw shuffles, so in
  // either order).
  assert.equal(calls.length, 1, 'both games ride one batched /thing call');
  assert.match(calls[0], /900005/);
  assert.match(calls[0], /900006/);
});

test('the vote-link ballot projects the metadata but NEVER the rating', async () => {
  const rid = await makeRound('Info-Ballot');
  await repo.createGame('default', rid, {
    title: 'Drei', minPlayers: 1, maxPlayers: 6, image: null,
    source: { provider: 'bgg', externalId: '900007', url: null },
    weight: 3.2, description: 'Ballot-Text.', providerInfoAt: new Date().toISOString(),
    minPlaytime: 30, maxPlaytime: 90, minAge: 12,
    categories: ['Economic'], mechanics: ['Worker Placement'],
    rating: 8.4,
  });
  stubFetch([]);
  const start = await request(app).post(`/api/rounds/${rid}/sessions`).send({ count: 1 });
  const sid = start.body.session.id;
  const mint = await request(app).post(`/api/rounds/${rid}/sessions/${sid}/vote-link`).send({});
  assert.equal(mint.status, 201);
  const ballot = await request(app).get(`/api/vote/${mint.body.token}`);
  assert.equal(ballot.status, 200);
  const [g] = ballot.body.games;
  assert.equal(g.weight, 3.2);
  assert.equal(g.description, 'Ballot-Text.');
  assert.equal(g.minPlaytime, 30);
  assert.equal(g.maxPlaytime, 90);
  assert.equal(g.minAge, 12);
  assert.deepEqual(g.categories, ['Economic']);
  assert.deepEqual(g.mechanics, ['Worker Placement']);

  // THE guarantee (#724). The game genuinely carries rating 8.4 — asserted
  // above via the store — so this is a real exclusion, not a game that had
  // nothing to leak. A link voter can read this JSON whether or not any view
  // renders it, which is why the whitelist and not the client is the control.
  assert.equal('rating' in g, false, 'the community rating reached a voting surface');
  assert.doesNotMatch(JSON.stringify(ballot.body), /8\.4/, 'the rating leaked somewhere else in the ballot');
});

test('PATCH apply flags take the resolved info on link — and only what was chosen', async () => {
  const rid = await makeRound('Info-Link');
  const game = await repo.createGame('default', rid, {
    title: 'Unverlinkt', minPlayers: 2, maxPlayers: 4, image: null, source: null,
  });
  stubFetch([{ id: '900008', weight: '2.9', desc: 'Verlinkt.' }]);
  const res = await request(app).patch(`/api/rounds/${rid}/games/${game.id}`).send({
    ...bggSource('900008'),
    applyWeight: true,
    // applyDescription deliberately absent -> the description must NOT land.
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.weight, 2.9);
  assert.equal('description' in res.body, false);

  // And the values themselves cannot be dictated: a PATCH carrying literals
  // changes nothing without the resolved link.
  const forged = await request(app).patch(`/api/rounds/${rid}/games/${game.id}`).send({
    weight: 5, description: 'forged',
  });
  assert.equal(forged.status, 200);
  assert.equal(forged.body.weight, 2.9);
  assert.equal('description' in forged.body, false);
});
