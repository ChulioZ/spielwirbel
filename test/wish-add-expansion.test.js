'use strict';

/* Adding a BGG expansion to the Wunschliste by hand (#703): POST /games with
 * `wish: true` and a bgg source resolves server-side — one /thing hop — whether
 * the picked item is an expansion, and writes `expansionOf` when it is. Without
 * that, the row is indistinguishable from an ordinary wished game and "Ins
 * Regal" puts an expansion on the shelf as a standalone votable/drawable game
 * (.claude/rules/expansions-widen-by-union.md).
 *
 * Every spec drives its own externalId: the /thing hop rides the shared
 * 10-minute provider cache keyed `bgg:expparents:<id>`, so a reused id is
 * answered from an earlier spec's entry and the stubbed fetch silently proves
 * nothing (.claude/rules/bgg-collection-import.md §4).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

// The token is read per call (lib/providers/bgg.js), so setting it here is
// enough — without it expansionParents degrades to [] and every add would land
// unmarked, i.e. the specs would pass against a broken resolution.
process.env.BGG_API_TOKEN = 'test-token';

async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Seafarers', minPlayers: '3', maxPlayers: '4', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  return req;
}

const bggWish = (externalId, over = {}) => ({
  wish: 'true',
  sourceProvider: 'bgg',
  sourceExternalId: externalId,
  sourceUrl: `https://boardgamegeek.com/boardgameexpansion/${externalId}`,
  ...over,
});

// Captured-shape /xmlapi2/thing bodies (see test/providers-bgg.test.js): an
// expansion item marks "expands X" with inbound="true"; a base game carries the
// same link type WITHOUT the flag for "is expanded by Y".
const thingBody = (type, id, links) => `<items>
  <item type="${type}" id="${id}">
    <name type="primary" value="Thing ${id}"/>
    <minplayers value="3"/><maxplayers value="4"/>
    ${links}
    <link type="boardgamecategory" id="1029" value="Negotiation"/>
  </item>
</items>`;

const inbound = (parents) => parents
  .map((p) => `<link type="boardgameexpansion" id="${p.providerId}" value="${p.title}" inbound="true"/>`)
  .join('\n');

function stubFetch(t, body) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, text: async () => body };
  };
  t.after(() => { global.fetch = original; });
  return calls;
}

test('a BGG expansion wished via the add search carries expansionOf', async (t) => {
  const parents = [
    { providerId: '13', title: 'CATAN' },
    { providerId: '822', title: 'Tigris & Euphrates' },
  ];
  const calls = stubFetch(t, thingBody('boardgameexpansion', '703001', inbound(parents)));
  const round = await createRound(request);

  const res = await addGame(round.id, bggWish('703001'));
  assert.equal(res.status, 201);
  assert.equal(res.body.wish, true);
  // The full inbound list, in order — a promo can fit two base games, and the
  // acquire flow is what asks which one it joins.
  assert.deepEqual(res.body.expansionOf, parents);
  // Two hops since #717: the expansionParents resolution, then the stats
  // detail the weight/description resolution reads (cache-cold here; in real
  // use the add-game lookup has just filled that cache entry).
  assert.equal(calls.length, 2, 'the expparents hop plus the stats detail hop');
  assert.match(calls[0], /\/thing\?/);
  assert.equal(new URL(calls[0]).searchParams.get('id'), '703001');
  assert.equal(new URL(calls[1]).searchParams.get('stats'), '1');

  const stored = (await request(app).get(`/api/rounds/${round.id}`)).body.games
    .find((g) => g.id === res.body.id);
  assert.deepEqual(stored.expansionOf, parents, 'and it survives a re-read');
});

test('a BGG BASE game wished via the add search stays keyless (control)', async (t) => {
  // A base game's expansion links point OUTWARD (no inbound flag) — reading
  // them as parents would report a game as an expansion of its own expansions.
  stubFetch(t, thingBody('boardgame', '703002',
    '<link type="boardgameexpansion" id="325" value="Seafarers"/>'));
  const round = await createRound(request);

  const res = await addGame(round.id, bggWish('703002'));
  assert.equal(res.status, 201);
  assert.equal(res.body.wish, true);
  assert.equal('expansionOf' in res.body, false);
  const stored = (await request(app).get(`/api/rounds/${round.id}`)).body.games
    .find((g) => g.id === res.body.id);
  assert.equal('expansionOf' in stored, false, 'absent after a re-read too');
});

test('an expansion BGG names no base game for lands as an unattached wish ([])', async (t) => {
  stubFetch(t, thingBody('boardgameexpansion', '703003', ''));
  const round = await createRound(request);

  const res = await addGame(round.id, bggWish('703003'));
  assert.equal(res.status, 201);
  // [] is a real state, distinct from absent: it marks the row as an expansion
  // whose parent is unknown, so "Ins Regal" asks instead of flat-flipping.
  assert.deepEqual(res.body.expansionOf, []);
});

test('expansionOf in the request body is ignored, never stored', async (t) => {
  const parents = [{ providerId: '13', title: 'CATAN' }];
  stubFetch(t, thingBody('boardgameexpansion', '703004', inbound(parents)));
  const round = await createRound(request);

  // On an expansion the SERVER-resolved parents win over whatever rode in.
  const forged = await addGame(round.id, bggWish('703004', {
    expansionOf: JSON.stringify([{ providerId: '9999', title: 'Forged' }]),
  }));
  assert.equal(forged.status, 201);
  assert.deepEqual(forged.body.expansionOf, parents);
});

test('a client-sent expansionOf on a base game grafts nothing', async (t) => {
  stubFetch(t, thingBody('boardgame', '703005', ''));
  const round = await createRound(request);
  const res = await addGame(round.id, bggWish('703005', {
    expansionOf: JSON.stringify([{ providerId: '13', title: 'CATAN' }]),
  }));
  assert.equal(res.status, 201);
  assert.equal('expansionOf' in res.body, false);
});

test('a failed /thing hop degrades to an unmarked wish, not a failed add', async (t) => {
  // A network throw propagates out of fetchXml immediately (no retry statuses
  // involved), which keeps the spec off the provider's retry delays.
  stubFetch(t, new Error('boom'));
  const round = await createRound(request);

  const res = await addGame(round.id, bggWish('703006'));
  assert.equal(res.status, 201, 'the add itself must survive the enrichment hop');
  assert.equal(res.body.wish, true);
  assert.equal('expansionOf' in res.body, false);
});

test('no expparents hop for shelf adds, and no hop at all for non-BGG or sourceless adds', async (t) => {
  const calls = stubFetch(t, thingBody('boardgameexpansion', '703007', ''));
  const round = await createRound(request);

  // Shelf add with a bgg source: owned expansions live on their base game's
  // row, so a wish:false add resolves NO parents — its one request is the
  // stats detail the weight/description resolution reads (#717).
  const shelf = await addGame(round.id, { sourceProvider: 'bgg', sourceExternalId: '703007' });
  assert.equal(shelf.status, 201);
  assert.equal('expansionOf' in shelf.body, false);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).searchParams.get('stats'), '1');
  assert.doesNotMatch(calls[0], /inbound/i);

  // The four storefronts have no expansion concept (no expansionParents) and
  // no weight/description capability (no gameInfo) — zero requests.
  const steam = await addGame(round.id, bggWish('703008', { sourceProvider: 'steam' }));
  assert.equal(steam.status, 201);
  assert.equal('expansionOf' in steam.body, false);

  const plain = await addGame(round.id, { title: 'Typed by hand', wish: 'true' });
  assert.equal(plain.status, 201);
  assert.equal('expansionOf' in plain.body, false);

  assert.equal(calls.length, 1, 'neither the storefront wish nor the sourceless add issued a request');
});

test('the created row goes through the acquire flow onto its base game', async (t) => {
  stubFetch(t, thingBody('boardgameexpansion', '703009',
    '<link type="boardgameexpansion" id="703010" value="Base Game" inbound="true"/>'));
  const round = await createRound(request);
  const base = (await addGame(round.id, {
    title: 'Base Game', sourceProvider: 'bgg', sourceExternalId: '703010',
  })).body;
  const wish = (await addGame(round.id, bggWish('703009', { title: 'The Expansion' }))).body;
  assert.deepEqual(wish.expansionOf, [{ providerId: '703010', title: 'Base Game' }]);

  // "Ins Regal" for this row is the acquire route (#664), which requires
  // expansionOf — the guard that never bound on an unmarked row.
  const res = await request(app)
    .post(`/api/rounds/${round.id}/games/${wish.id}/acquire-expansion`)
    .send({ baseGameId: base.id });
  assert.equal(res.status, 200);
  const games = (await request(app).get(`/api/rounds/${round.id}`)).body.games;
  assert.equal(games.some((g) => g.id === wish.id), false, 'the wish row is gone');
  const owned = games.find((g) => g.id === base.id);
  assert.deepEqual(owned.expansions.map((e) => e.title), ['The Expansion']);
});
