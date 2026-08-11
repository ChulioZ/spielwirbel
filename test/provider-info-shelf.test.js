'use strict';

/* The SHELF-WIDE backfill trigger (#736): POST …/games/provider-info, and the
 * blocking pre-draw fill a filtered session start now performs.
 *
 * Its own file rather than more of test/provider-info.test.js, which already
 * covers the create-time resolution plus the two per-game triggers and sits well
 * into its budget (.claude/rules/token-friendly-source-files.md).
 *
 * What only these specs can answer is the defect #736 was filed for: the #725
 * metadata filters silently did not filter, because `fitsMetadataFilters` lets
 * an absent value pass every filter on purpose and neither filter screen ever
 * asked the provider for one.
 *
 * The provider cache is per-process and keyed on the external id, so every spec
 * uses its own ids — reuse one and a spec is answered from an earlier spec's
 * entry and proves nothing (the test/lookup.test.js trap). */

process.env.BGG_API_TOKEN = 'test-token';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, store } = require('./helpers');
const repo = require('../lib/repo');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.DRAW_BACKFILL_TIMEOUT_MS;
});

// A /thing?stats=1 body, one <item> per entry. `average` rides along on every
// item so a spec that leaked the rating into the response would show it as a
// number rather than as an absent key.
const thingXml = (items) => `<?xml version="1.0" encoding="utf-8"?><items>${items
  .map(({ id, weight, playtime, age, cats }) => `<item type="boardgame" id="${id}">
    <name type="primary" value="Game ${id}"/>
    ${playtime ? `<minplaytime value="${playtime[0]}"/><maxplaytime value="${playtime[1]}"/>` : ''}
    ${age ? `<minage value="${age}"/>` : ''}
    ${(cats || []).map((c) => `<link type="boardgamecategory" id="1" value="${c}"/>`).join('')}
    <statistics><ratings><average value="7.4"/>
      <averageweight value="${weight == null ? 0 : weight}"/>
    </ratings></statistics>
  </item>`)
  .join('')}</items>`;

const stubFetch = (items) => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return { status: 200, text: async () => thingXml(items) };
  };
  return calls;
};

async function makeRound(name) {
  const res = await request(app).post('/api/rounds').send({ name, members: ['Anna', 'Ben'] });
  return res.body.id;
}

// Created through the repo so the spec states the game's stored shape directly —
// nothing user-facing writes provider metadata, it only ever arrives here.
const addLinked = (rid, title, externalId, over = {}) =>
  repo.createGame('default', rid, {
    title, minPlayers: 1, maxPlayers: 8, image: null,
    source: { provider: 'bgg', externalId, url: null },
    ...over,
  });

const stored = async (rid, gid) => repo.getGame('default', rid, gid);

/* ------------------------------ the route -------------------------------- */

test('the shelf trigger fills every unfilled active game in one upstream call', async () => {
  const rid = await makeRound('Regal-Fill');
  const a = await addLinked(rid, 'Agricola', '930001');
  const b = await addLinked(rid, 'Azul', '930002');
  const calls = stubFetch([
    { id: '930001', weight: '3.6', playtime: [30, 210], age: 12, cats: ['Economic'] },
    { id: '930002', weight: '1.8', playtime: [30, 45], age: 8, cats: ['Abstract Strategy'] },
  ]);

  const res = await request(app).post(`/api/rounds/${rid}/games/provider-info`);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1, 'a shelf-wide fill must cost ONE batched request, not one per game');

  const byId = Object.fromEntries(res.body.games.map((g) => [g.id, g]));
  assert.deepEqual(byId[a.id], {
    id: a.id, weight: 3.6, minPlaytime: 30, maxPlaytime: 210, minAge: 12,
    categories: ['Economic'], mechanics: [],
  });
  assert.equal(byId[b.id].weight, 1.8);
  // The store, not just the response — the whole point is that the next draw
  // reads these.
  assert.equal((await stored(rid, a.id)).weight, 3.6);
});

test('the shelf trigger withholds the community rating', async () => {
  /* The setup screen is a voting surface's antechamber, so the rating must not
   * reach it — and the guarantee is the SERVER omitting the key, not a view
   * declining to render it (.claude/rules/provider-info-is-a-field-set.md). The
   * stub serves <average value="7.4"/> on every item, so this discriminates a
   * withheld field from a provider that sent none. */
  const rid = await makeRound('Regal-Kein-Rating');
  await addLinked(rid, 'Catan', '930010');
  stubFetch([{ id: '930010', weight: '2.3' }]);

  const res = await request(app).post(`/api/rounds/${rid}/games/provider-info`);
  assert.equal(res.body.games.length, 1);
  assert.equal('rating' in res.body.games[0], false, 'the community rating reached a filter screen');
  // It IS stored — withholding is a projection decision, not a decision to skip
  // the field, or the game detail screen would lose it.
  const game = (await repo.getRound('default', rid)).games[0];
  assert.equal(game.rating, 7.4);
});

test('the shelf trigger asks about the ACTIVE shelf only', async () => {
  /* Retired, completed and wished games cannot reach a draw pool or either
   * filter screen, so asking about them spends the one batched request on games
   * nobody is filtering (.claude/rules/active-games-filter-sites.md). */
  const rid = await makeRound('Regal-Aktiv');
  const active = await addLinked(rid, 'Aktiv', '930020');
  const retired = await addLinked(rid, 'Aussortiert', '930021');
  const wished = await addLinked(rid, 'Wunsch', '930022', { wish: true });
  // Through the MUTATOR: `createGame` honours `wish` but ignores `retired`, so
  // a `{ retired: true }` in the create payload is silently dropped and this
  // spec would assert over an ordinary active game — green either way.
  await repo.retireGame('default', rid, retired.id, true);
  const calls = stubFetch([{ id: '930020', weight: '2.0' }]);

  const res = await request(app).post(`/api/rounds/${rid}/games/provider-info`);
  assert.deepEqual(res.body.games.map((g) => g.id), [active.id]);
  const asked = new URL(calls[0]).searchParams.get('id').split(',');
  assert.deepEqual(asked, ['930020'], 'an off-shelf game was asked about');
  assert.equal('providerInfoAt' in (await stored(rid, retired.id)), false);
  assert.equal('providerInfoAt' in (await stored(rid, wished.id)), false);
});

test('a big shelf fills ONE batch per open, and resumes on the next', async () => {
  /* The route's `maxBatches: 1`. Deliberately more than 60 games, because the
   * two-game spec above cannot see this bound at all — one batch is what an
   * unbounded call would issue there too, so it is green either way.
   *
   * Progressive filling is the point: each filled game drops out of
   * `needsProviderInfo`, so the second open starts where the first stopped and a
   * 300-game shelf never costs one screen open five upstream requests. */
  const rid = await makeRound('Regal-Gross');
  for (let i = 0; i < 70; i += 1) await addLinked(rid, `Spiel ${i}`, String(931000 + i));
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    const ids = new URL(String(url)).searchParams.get('id').split(',');
    return { status: 200, text: async () => thingXml(ids.map((id) => ({ id, weight: '2.5' }))) };
  };

  const first = await request(app).post(`/api/rounds/${rid}/games/provider-info`);
  assert.equal(calls.length, 1, 'one screen open must cost one upstream request');
  assert.equal(first.body.games.filter((g) => g.weight !== null).length, 60);

  const second = await request(app).post(`/api/rounds/${rid}/games/provider-info`);
  assert.equal(calls.length, 2, 'the second open must resume, not stop');
  assert.equal(second.body.games.length, 10, 'only the still-unfilled tail is eligible');
  assert.equal(second.body.games.every((g) => g.weight === 2.5), true);

  const third = await request(app).post(`/api/rounds/${rid}/games/provider-info`);
  assert.equal(calls.length, 2, 'a fully filled shelf must ask nothing');
  assert.deepEqual(third.body.games, []);
});

test('a second open of the screen costs no upstream request', async () => {
  /* The TTL/completeness gate in needsProviderInfo. Without it every open of the
   * Regal would hit BGG, on a shelf that already has everything — the opposite
   * of what their terms ask for. */
  const rid = await makeRound('Regal-TTL');
  await addLinked(rid, 'Fertig', '930030');
  const calls = stubFetch([{ id: '930030', weight: '2.7', playtime: [45, 60], age: 10, cats: ['Family'] }]);

  await request(app).post(`/api/rounds/${rid}/games/provider-info`);
  assert.equal(calls.length, 1);

  const second = await request(app).post(`/api/rounds/${rid}/games/provider-info`);
  assert.equal(second.status, 200);
  assert.equal(calls.length, 1, 'the filled shelf asked the provider again');
  assert.deepEqual(second.body.games, [], 'a filled shelf must report nothing to fold in');
});

test('the shelf trigger never fails on the provider, and 404s an unknown round', async () => {
  const rid = await makeRound('Regal-Kaputt');
  const game = await addLinked(rid, 'Unerreichbar', '930040');
  global.fetch = async () => ({ status: 404, text: async () => '' });

  const res = await request(app).post(`/api/rounds/${rid}/games/provider-info`);
  assert.equal(res.status, 200, 'an upstream failure must not fail the screen');
  assert.deepEqual(res.body.games, [{
    id: game.id, weight: null, minPlaytime: null, maxPlaytime: null,
    minAge: null, categories: [], mechanics: [],
  }]);
  // An upstream failure stamps nothing, so the next open retries rather than
  // being suppressed for the whole TTL.
  assert.equal('providerInfoAt' in (await stored(rid, game.id)), false);

  const missing = await request(app).post('/api/rounds/does-not-exist/games/provider-info');
  assert.equal(missing.status, 404);
});

test('a shelf of hand-typed games asks nothing and answers an empty list', async () => {
  const rid = await makeRound('Regal-Handgetippt');
  await repo.createGame('default', rid, {
    title: 'Hausregel', minPlayers: 2, maxPlayers: 4, image: null, source: null,
  });
  const calls = stubFetch([]);

  const res = await request(app).post(`/api/rounds/${rid}/games/provider-info`);
  assert.deepEqual(res.body.games, []);
  assert.equal(calls.length, 0);
});

/* --------------------- the draw's blocking pre-fill ----------------------- */

const start = (rid, body) => request(app).post(`/api/rounds/${rid}/sessions`).send({ count: 9, ...body });
const drawn = (res) => res.body.games.map((g) => g.title).sort();

test('a filtered draw waits for the metadata — the reported Agricola case', async () => {
  /* THE defect. Before #736 the shelf-wide fill did not exist and the
   * session-start backfill ran AFTER the draw, so a shelf nobody had opened the
   * detail pages of had no stored weights at all — and an absent weight passes
   * every filter. „max. Komplexität 1" therefore drew Agricola. */
  const rid = await makeRound('Draw-Agricola');
  await addLinked(rid, 'Agricola', '930100');
  await addLinked(rid, 'Leicht', '930101');
  stubFetch([
    { id: '930100', weight: '3.6' },
    { id: '930101', weight: '1.0' },
  ]);

  const res = await start(rid, { metadata: { weightMax: 1 } });
  assert.equal(res.status, 201);
  assert.deepEqual(drawn(res), ['Leicht'], 'a heavy game survived „max. Komplexität 1"');
});

test('an unfiltered draw does not wait on the provider', async () => {
  /* The fast path: no metadata filter, no reason to pay provider latency for
   * values the draw will not consult.
   *
   * Asserted by ELAPSED TIME against a hanging provider, not by counting
   * requests: the post-draw fire-and-forget backfill (#717) issues its own hop
   * regardless, so a request count taken after the response cannot tell "waited"
   * from "did not wait". With the budget at 900 ms, a draw that awaited would
   * take at least that; one that did not answers in a few ms. */
  process.env.DRAW_BACKFILL_TIMEOUT_MS = '900';
  const rid = await makeRound('Draw-Ungefiltert');
  await addLinked(rid, 'Egal', '930110');
  global.fetch = () => new Promise(() => {});

  const began = process.hrtime.bigint();
  const res = await start(rid, {});
  const elapsedMs = Number(process.hrtime.bigint() - began) / 1e6;

  assert.equal(res.status, 201);
  assert.deepEqual(drawn(res), ['Egal']);
  assert.ok(elapsedMs < 400, `an unfiltered draw waited on the provider (${Math.round(elapsedMs)} ms)`);
});

test('a hanging provider never hangs the draw', async () => {
  process.env.DRAW_BACKFILL_TIMEOUT_MS = '40';
  const rid = await makeRound('Draw-Haenger');
  await addLinked(rid, 'Schwer', '930120', { weight: 4 });
  await addLinked(rid, 'Leicht', '930121', { weight: 1 });
  // Never resolves. The draw must fall back to what is stored.
  global.fetch = () => new Promise(() => {});

  const res = await start(rid, { metadata: { weightMax: 1 } });
  assert.equal(res.status, 201);
  // Both games already carry a weight, so the stored values still filter
  // correctly — the timeout costs freshness, never the draw.
  assert.deepEqual(drawn(res), ['Leicht']);
});

test('a failing provider draws on what is stored', async () => {
  const rid = await makeRound('Draw-Fehler');
  await addLinked(rid, 'Schwer', '930130', { weight: 4 });
  await addLinked(rid, 'Leicht', '930131', { weight: 1 });
  global.fetch = async () => ({ status: 404, text: async () => '' });

  const res = await start(rid, { metadata: { weightMax: 2 } });
  assert.equal(res.status, 201);
  assert.deepEqual(drawn(res), ['Leicht']);
});

test('the pre-fill runs BEFORE normalization, or the filter is dropped unseen', async () => {
  /* The ordering trap. `metadataFilterOptions` reports a field unavailable when
   * no game on the shelf carries it, and `normalizeMetadataFilters` then drops
   * every filter over it. So on a shelf with no stored weights — exactly the
   * shelf this feature exists for — normalizing first collapses „max.
   * Komplexität 1" to "unfiltered" before anything has a chance to fetch a
   * weight, and the draw returns the whole shelf while looking entirely healthy.
   *
   * The tell is the stored PRESET (#252): a dropped filter is remembered as an
   * unfiltered draw. */
  const rid = await makeRound('Draw-Reihenfolge');
  await addLinked(rid, 'Schwer', '930140');
  await addLinked(rid, 'Leicht', '930141');
  stubFetch([
    { id: '930140', weight: '4.4' },
    { id: '930141', weight: '1.1' },
  ]);

  const res = await start(rid, { metadata: { weightMax: 2 } });
  assert.deepEqual(drawn(res), ['Leicht']);

  const round = store.data.rounds.find((r) => r.id === rid);
  assert.deepEqual(round.lastSessionFilters.metadata.weightMax, 2,
    'the filter was dropped before the shelf could be filled');
});
