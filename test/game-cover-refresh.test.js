'use strict';

/*
 * Issue #518: POST /api/rounds/:rid/games/:gid/cover/provider — re-fetch a
 * provider-linked game's cover from its provider.
 *
 * Its own file rather than more of test/games.test.js: that file was at its
 * 700-line budget, and this is an independently editable concern with its own
 * fixtures (.claude/rules/token-friendly-source-files.md).
 *
 * The provider's two hops are stubbed on the registry object the route resolves
 * through, so these specs test the ROUTE — its refusals, what it stores, and the
 * old-cover cleanup. WHICH hop yields the URL is resolveProviderCover's
 * contract and is pinned in test/provider-cover-refresh.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { app, store, createRound } = require('./helpers');
const { providers: registry } = require('../lib/providers');

const BGG_COVER = 'https://cf.geekdo-images.com/x/fresh.jpg';
const PS_COVER = 'https://image.api.playstation.com/vulcan/ap/rnd/hades.png';
const coverPath = (rid, gid) => `/api/rounds/${rid}/games/${gid}/cover/provider`;

// A minimal 1x1 PNG (signature + IHDR + IDAT + IEND), enough for the upload
// route's magic-byte check (#133).
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Chess', minPlayers: '2', maxPlayers: '4', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  return req;
}

// Every spec needs its OWN external id: the provider hop is cached for ten
// minutes keyed on provider+locale+id (lib/provider-cache.js), so two specs
// sharing an id would answer each other and prove nothing — the trap
// .claude/rules/storefront-lookup-locale.md records for test/lookup.test.js.
let nextId = 100;
const freshId = () => String(nextId++);

// A game linked to BGG, optionally carrying its hotlinked cover.
async function addLinkedGame(rid, image = 'https://cf.geekdo-images.com/x/pic.jpg', externalId = freshId()) {
  const fields = {
    sourceProvider: 'bgg',
    sourceExternalId: externalId,
    sourceUrl: `https://boardgamegeek.com/boardgame/${externalId}/catan`,
  };
  if (image) fields.imageUrl = image;
  return (await addGame(rid, fields)).body;
}

// A provider-linked game whose cover is the member's OWN upload — the case where
// the refresh replaces a file we host rather than a hotlink.
async function addLinkedGameWithUpload(rid, title = 'Catan') {
  const res = await request(app)
    .post(`/api/rounds/${rid}/games`)
    .field('title', title)
    .field('minPlayers', '2')
    .field('maxPlayers', '4')
    .field('sourceProvider', 'bgg')
    .field('sourceExternalId', freshId())
    .attach('image', PNG_BYTES, { filename: 'cover.png', contentType: 'image/png' });
  return res.body;
}

async function withStubbedBgg({ detail = null, search = [] }, fn) {
  const bgg = registry.bgg;
  const real = { detail: bgg.detail, search: bgg.search };
  const calls = [];
  bgg.detail = async (id, lang) => { calls.push({ hop: 'detail', id, lang }); return detail; };
  bgg.search = async (q, limit, lang) => { calls.push({ hop: 'search', q, lang }); return search; };
  try {
    return await fn(calls);
  } finally {
    Object.assign(bgg, real);
  }
}

test('the cover refresh stores the provider cover as a hotlink', async () => {
  const round = await createRound(request);
  const game = await addLinkedGame(round.id, null); // linked, no cover: the stuck case
  assert.equal(game.image, null);
  const objectCount = fs.readdirSync(store.UPLOAD_DIR).length;

  await withStubbedBgg({ detail: { title: 'Catan', imageUrl: BGG_COVER } }, async (calls) => {
    const res = await request(app).post(coverPath(round.id, game.id)).query({ lang: 'en' });
    assert.equal(res.status, 200);
    assert.equal(res.body.image, BGG_COVER);
    // The provider was asked about the STORED id, in the caller's language.
    assert.deepEqual(calls, [{ hop: 'detail', id: game.source.externalId, lang: 'en' }]);
  });

  const after = await request(app).get(`/api/rounds/${round.id}`);
  const stored = after.body.games.find((g) => g.id === game.id).image;
  assert.equal(stored, BGG_COVER);
  // Hotlinked, never re-hosted (#172): the stored value is the provider's own
  // absolute URL, and no object of ours was created to back it.
  assert.ok(stored.startsWith('https://'));
  assert.equal(objectCount, fs.readdirSync(store.UPLOAD_DIR).length, 'nothing was downloaded');
});

test('the cover refresh replaces an existing cover', async () => {
  const round = await createRound(request);
  const game = await addLinkedGame(round.id, 'https://cf.geekdo-images.com/x/stale.jpg');
  await withStubbedBgg({ detail: { title: 'Catan', imageUrl: BGG_COVER } }, async () => {
    const res = await request(app).post(coverPath(round.id, game.id));
    assert.equal(res.status, 200);
    assert.equal(res.body.image, BGG_COVER);
  });
});

test('a cover the provider does not vouch for is refused, not stored', async () => {
  const round = await createRound(request);
  const game = await addLinkedGame(round.id, null);
  await withStubbedBgg({ detail: { title: 'Catan', imageUrl: 'https://evil.example.com/x.png' } }, async () => {
    const res = await request(app).post(coverPath(round.id, game.id));
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'no_cover');
  });
  const after = await request(app).get(`/api/rounds/${round.id}`);
  assert.equal(after.body.games.find((g) => g.id === game.id).image, null);
});

test('a provider with no cover for the id answers no_cover, not a generic failure', async () => {
  const round = await createRound(request);
  const game = await addLinkedGame(round.id, null);
  await withStubbedBgg({ detail: { title: 'Catan', imageUrl: null }, search: [] }, async () => {
    const res = await request(app).post(coverPath(round.id, game.id));
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'no_cover');
  });
});

test('an unlinked game answers no_source', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  const res = await request(app).post(coverPath(round.id, game.id));
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'no_source');
});

test('a provider the round switched off is refused and never queried', async () => {
  const round = await createRound(request);
  const game = await addLinkedGame(round.id, null);
  await request(app).put(`/api/rounds/${round.id}/providers`).send({ providers: ['steam'] });

  await withStubbedBgg({ detail: { title: 'Catan', imageUrl: BGG_COVER } }, async (calls) => {
    const res = await request(app).post(coverPath(round.id, game.id));
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'provider_disabled');
    assert.deepEqual(calls, [], 'a disabled provider must not be contacted');
  });
});

test('an upstream failure is a 502, distinct from having no cover', async () => {
  const round = await createRound(request);
  const game = await addLinkedGame(round.id, null);
  const bgg = registry.bgg;
  const real = bgg.detail;
  bgg.detail = async () => { throw new Error('upstream down'); };
  try {
    const res = await request(app).post(coverPath(round.id, game.id));
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'provider_unreachable');
  } finally {
    bgg.detail = real;
  }
});

test('the cover refresh 404s for a missing round and a missing game', async () => {
  const round = await createRound(request);
  assert.equal((await request(app).post(coverPath('nope', 'x'))).status, 404);
  assert.equal((await request(app).post(coverPath(round.id, 'nope'))).status, 404);
});

test('refreshing over an uploaded cover frees the orphaned object', async () => {
  const round = await createRound(request);
  const game = await addLinkedGameWithUpload(round.id);
  assert.ok(game.image.startsWith('/uploads/'));
  const key = path.join(store.UPLOAD_DIR, path.basename(game.image));
  assert.ok(fs.existsSync(key));

  await withStubbedBgg({ detail: { title: 'Catan', imageUrl: BGG_COVER } }, async () => {
    const res = await request(app).post(coverPath(round.id, game.id));
    assert.equal(res.status, 200);
    assert.equal(res.body.image, BGG_COVER);
  });
  assert.equal(fs.existsSync(key), false, 'nothing references it any more — free it');
});

// The other half, and the reason the guard is not just `storage.remove(old)`:
// createRound's importFromRoundId copies the cover PATH, not the file, so one
// object can back games in several rounds (.claude/rules/deletion-paths-must-free-cover-objects.md).
test('refreshing keeps an uploaded cover another round still references', async () => {
  const round = await createRound(request);
  const game = await addLinkedGameWithUpload(round.id);
  const key = path.join(store.UPLOAD_DIR, path.basename(game.image));

  const copy = await createRound(request, { name: 'Imported', importFromRoundId: round.id });
  assert.equal(copy.games.find((g) => g.title === 'Catan').image, game.image, 'the import shares the path');

  await withStubbedBgg({ detail: { title: 'Catan', imageUrl: BGG_COVER } }, async () => {
    assert.equal((await request(app).post(coverPath(round.id, game.id))).status, 200);
  });
  assert.ok(fs.existsSync(key), 'the imported round still shows it — must be kept');

  // Other specs assert the shared upload dir is empty; clear what this one
  // deliberately left behind.
  fs.unlinkSync(key);
});

// --- The provider hop is cached, but only when it resolved ---

test('a repeated refresh of the same game costs one upstream call', async () => {
  const round = await createRound(request);
  const a = await addLinkedGame(round.id, null, 'shared-id');
  // A second game on the same provider id — the cache is keyed on the id, not
  // on our game, so this must be free too.
  const b = await addLinkedGame(round.id, null, 'shared-id');

  await withStubbedBgg({ detail: { title: 'Catan', imageUrl: BGG_COVER } }, async (calls) => {
    for (const g of [a, b, a]) {
      const res = await request(app).post(coverPath(round.id, g.id));
      assert.equal(res.status, 200);
      assert.equal(res.body.image, BGG_COVER);
    }
    assert.equal(calls.length, 1, `three refreshes, one hop — got ${calls.length}`);
  });
});

// The button exists to REPAIR a missing cover, so "there is none" must never be
// cached: the user's retry has to ask the provider again, not our own Map. Same
// rule as fetchCollection's 'queued' (.claude/rules/bgg-collection-import.md §3).
test('a failed resolve is not cached, so a retry can succeed', async () => {
  const round = await createRound(request);
  const game = await addLinkedGame(round.id, null);

  await withStubbedBgg({ detail: { title: 'Catan', imageUrl: null }, search: [] }, async (calls) => {
    assert.equal((await request(app).post(coverPath(round.id, game.id))).status, 404);
    assert.equal((await request(app).post(coverPath(round.id, game.id))).status, 404);
    assert.equal(calls.length, 4, 'both attempts really asked upstream (detail + search each)');
  });

  // The provider now has a cover — the retry must see it rather than the 404.
  await withStubbedBgg({ detail: { title: 'Catan', imageUrl: BGG_COVER } }, async () => {
    const res = await request(app).post(coverPath(round.id, game.id));
    assert.equal(res.status, 200, 'a cached null would have kept answering 404');
    assert.equal(res.body.image, BGG_COVER);
  });
});

// Two UI locales that map to different storefront locales must not share an
// entry — a French user would otherwise be served the German answer for the
// whole TTL (#505). BGG maps every locale to one constant, so the storefront
// case is what this asserts, via the key the route builds.
test('two UI locales that map to different store locales do not share an entry', async () => {
  const round = await createRound(request);
  const externalId = 'EP-LOCALE-1';
  const game = (await addGame(round.id, {
    title: 'Hades', sourceProvider: 'psstore', sourceExternalId: externalId,
  })).body;

  const psstore = registry.psstore;
  // Precondition: these two really do resolve to different storefront locales,
  // or the test proves nothing about the key.
  assert.notEqual(psstore.resolveLocale('de'), psstore.resolveLocale('fr'));

  const real = psstore.detail;
  const langs = [];
  psstore.detail = async (id, lang) => { langs.push(lang); return { title: 'Hades', imageUrl: PS_COVER }; };
  try {
    for (const lang of ['de', 'fr', 'de']) {
      const res = await request(app).post(coverPath(round.id, game.id)).query({ lang });
      assert.equal(res.status, 200);
      assert.equal(res.body.image, PS_COVER);
    }
    // de fetched, fr fetched (a different locale), de served from the cache.
    assert.deepEqual(langs, ['de', 'fr']);
  } finally {
    psstore.detail = real;
  }
});
