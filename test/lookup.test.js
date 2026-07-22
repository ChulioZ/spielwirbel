'use strict';

const { test, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

// The lookup is round-scoped since #294 (a round configures which providers it
// queries), so every request needs a round. This one is never configured, i.e.
// all providers stay enabled — test/providers.test.js covers the filtering.
let rid;
before(async () => { rid = (await createRound(request)).id; });
const L = (p) => `/api/rounds/${rid}/lookup${p}`;

// Replace global.fetch (used by lib/providers/psstore) with a stub returning
// store HTML built from an Apollo-cache-shaped object.
function stubFetch(handler) {
  global.fetch = async (url, init) => handler(String(url), init);
}
const htmlRes = (text) => ({ ok: true, status: 200, text: async () => text });
const jsonRes = (obj) => ({ ok: true, status: 200, json: async () => obj });

function page(apolloState, body = '') {
  const next = { props: { pageProps: { apolloState } } };
  return `<html><body>${body}<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script></body></html>`;
}

const PROD = {
  __typename: 'Product',
  id: 'UP4497-PPSA10407_00-0000000000000001',
  name: 'The Witcher 3: Wild Hunt',
  storeDisplayClassification: 'FULL_GAME',
  media: [{ __typename: 'Media', role: 'MASTER', type: 'IMAGE', url: 'https://image.api.playstation.com/vulcan/w.png' }],
};

test('GET …/lookup/search returns normalized results', async () => {
  stubFetch((url) => {
    assert.match(url, /\/search\//);
    return htmlRes(page({ 'Product:X': PROD }));
  });
  const res = await request(app).get(L('/search?provider=psstore&q=witcher'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, [
    { providerId: PROD.id, title: 'The Witcher 3: Wild Hunt', thumbnail: 'https://image.api.playstation.com/vulcan/w.png' },
  ]);
});

test('search with a too-short query short-circuits without calling the provider', async () => {
  let called = false;
  stubFetch(() => { called = true; return htmlRes(page({})); });
  const res = await request(app).get(L('/search?provider=psstore&q=a'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, []);
  assert.equal(called, false);
});

test('search rejects an unknown provider', async () => {
  const res = await request(app).get(L('/search?provider=nope&q=witcher'));
  assert.equal(res.status, 400);
});

test('search returns 502 when the provider is unreachable', async () => {
  stubFetch(() => { throw new Error('network down'); });
  const res = await request(app).get(L('/search?provider=psstore&q=zzzunreachable'));
  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'provider_unreachable');
});

test('GET …/lookup/game returns normalized detail (digital, players)', async () => {
  stubFetch((url) => {
    assert.match(url, /\/product\//);
    return htmlRes(page({ 'Product:X': PROD }, '<span class="compatText">1 - 4 players</span>'));
  });
  const res = await request(app).get(L(`/game?provider=psstore&id=${PROD.id}`));
  assert.equal(res.status, 200);
  assert.equal(res.body.title, 'The Witcher 3: Wild Hunt');
  assert.equal(res.body.type, 'digital');
  assert.equal(res.body.minPlayers, 1);
  assert.equal(res.body.maxPlayers, 4);
  assert.equal(res.body.imageUrl, 'https://image.api.playstation.com/vulcan/w.png');
  assert.match(res.body.url, /\/product\/UP4497-PPSA10407_00-0000000000000001$/);
});

test('game still returns a usable digital detail when the page has no product stub', async () => {
  stubFetch(() => htmlRes('<html><body><span class="compatText">1 - 4 players</span></body></html>'));
  const res = await request(app).get(L('/game?provider=psstore&id=NOPE'));
  assert.equal(res.status, 200);
  assert.equal(res.body.type, 'digital');
  assert.equal(res.body.minPlayers, 1);
  assert.equal(res.body.maxPlayers, 4);
  assert.equal(res.body.title, null);
});

test('game requires an id', async () => {
  const res = await request(app).get(L('/game?provider=psstore'));
  assert.equal(res.status, 400);
});

// --- BoardGameGeek provider (XML API2 search + thing, token-authorized, #117) --

const BGG_SEARCH_XML = `<items total="2">
  <item type="boardgame" id="13"><name type="primary" value="CATAN"/></item>
  <item type="boardgameexpansion" id="926"><name type="primary" value="Catan: Cities &amp; Knights"/></item>
</items>`;
const BGG_THING_XML = `<items>
  <item type="boardgame" id="13">
    <thumbnail>https://cf.geekdo-images.com/x__thumb/img/y=/fit-in/200x150/filters:strip_icc()/pic.png</thumbnail>
    <image>https://cf.geekdo-images.com/x__original/img/z=/0x0/filters:format(png)/pic.png</image>
    <name type="primary" value="CATAN"/>
    <minplayers value="3"/>
    <maxplayers value="4"/>
  </item>
</items>`;

// The token is read per call, so tests drive it through the env directly.
function withToken(value, fn) {
  const previous = process.env.BGG_API_TOKEN;
  if (value === null) delete process.env.BGG_API_TOKEN;
  else process.env.BGG_API_TOKEN = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) delete process.env.BGG_API_TOKEN;
      else process.env.BGG_API_TOKEN = previous;
    });
}

test('GET …/lookup/search?provider=bgg queries the token-authorized XML API', async () => {
  await withToken('test-token', async () => {
    let seen = null;
    global.fetch = async (url, init) => {
      seen = { url: String(url), init };
      return htmlRes(BGG_SEARCH_XML);
    };
    const res = await request(app).get(L('/search?provider=bgg&q=catan'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results, [
      { providerId: '13', title: 'CATAN', thumbnail: null },
      { providerId: '926', title: 'Catan: Cities & Knights', thumbnail: null },
    ]);
    // The host must carry no www (BGG's docs: www breaks authorization), and the
    // bearer token must actually be attached.
    assert.match(seen.url, /^https:\/\/boardgamegeek\.com\/xmlapi2\/search\?/);
    assert.equal(seen.init.headers.Authorization, 'Bearer test-token');
  });
});

test('GET …/lookup/game?provider=bgg returns analog detail with players and the small cover', async () => {
  await withToken('test-token', async () => {
    let seen = '';
    stubFetch((url) => { seen = url; return htmlRes(BGG_THING_XML); });
    const res = await request(app).get(L('/game?provider=bgg&id=13'));
    assert.equal(res.status, 200);
    assert.match(seen, /^https:\/\/boardgamegeek\.com\/xmlapi2\/thing\?/);
    assert.equal(res.body.title, 'CATAN');
    assert.equal(res.body.type, 'analog');
    assert.equal(res.body.minPlayers, 3);
    assert.equal(res.body.maxPlayers, 4);
    // The pre-sized thumbnail, never the multi-megabyte <image> master.
    assert.match(res.body.imageUrl, /__thumb\//);
    assert.equal(res.body.url, 'https://boardgamegeek.com/boardgame/13');
  });
});

test('bgg degrades to an empty result set (never an error) when no token is configured', async () => {
  await withToken(null, async () => {
    let called = false;
    stubFetch(() => { called = true; return htmlRes(BGG_SEARCH_XML); });
    const res = await request(app).get(L('/search?provider=bgg&q=untokened'));
    // A 502 here would surface as "couldn't reach provider" in a UI that merges
    // providers with Promise.allSettled — an empty list keeps the other four clean.
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results, []);
    assert.equal(called, false, 'must not call BGG without a token');
  });
});

test('bgg detail without a token still yields a working BoardGameGeek link', async () => {
  await withToken(null, async () => {
    stubFetch(() => { throw new Error('must not be called'); });
    const res = await request(app).get(L('/game?provider=bgg&id=77'));
    assert.equal(res.status, 200);
    assert.equal(res.body.title, null);
    assert.equal(res.body.url, 'https://boardgamegeek.com/boardgame/77');
  });
});

test('bgg retries a throttled answer within its budget, then succeeds', async () => {
  await withToken('test-token', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      // BGG signals "too busy" with 503 rather than queueing.
      if (calls === 1) return { ok: false, status: 503, text: async () => '' };
      return htmlRes(BGG_SEARCH_XML);
    });
    const res = await request(app).get(L('/search?provider=bgg&q=throttled'));
    assert.equal(res.status, 200);
    assert.equal(calls, 2);
    assert.equal(res.body.results.length, 2);
  });
});

test('bgg gives up after its bounded retries rather than looping', async () => {
  await withToken('test-token', async () => {
    let calls = 0;
    stubFetch(() => { calls += 1; return { ok: false, status: 429, text: async () => '' }; });
    const res = await request(app).get(L('/search?provider=bgg&q=alwaysthrottled'));
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'provider_unreachable');
    assert.equal(calls, 3, 'one attempt plus the two bounded retries');
  });
});

test('bgg does not retry a rejected token (401 is final)', async () => {
  await withToken('bad-token', async () => {
    let calls = 0;
    stubFetch(() => { calls += 1; return { ok: false, status: 401, text: async () => 'Unauthorized' }; });
    const res = await request(app).get(L('/search?provider=bgg&q=unauthorized'));
    assert.equal(res.status, 502);
    assert.equal(calls, 1);
  });
});

test('bgg search returns 502 when BGG is unreachable', async () => {
  await withToken('test-token', async () => {
    stubFetch(() => { throw new Error('network down'); });
    const res = await request(app).get(L('/search?provider=bgg&q=zzzunreachable'));
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'provider_unreachable');
  });
});

// --- Steam provider (storesearch -> appdetails, both public JSON) ----------

const STEAM_SEARCH = {
  total: 2,
  items: [
    { type: 'app', id: 413150, name: 'Stardew Valley', tiny_image: 'https://shared.akamai.steamstatic.com/apps/413150/capsule.jpg' },
    { type: 'sub', id: 999, name: 'Some Bundle', tiny_image: 'https://shared.akamai.steamstatic.com/subs/999/capsule.jpg' },
  ],
};
const STEAM_DETAIL = {
  413150: {
    success: true,
    data: {
      type: 'game',
      name: 'Stardew Valley',
      header_image: 'https://shared.akamai.steamstatic.com/apps/413150/header.jpg',
      categories: [{ id: 2, description: 'Single-player' }, { id: 9, description: 'Co-op' }],
    },
  },
};

test('GET …/lookup/search?provider=steam returns only full games (type app)', async () => {
  stubFetch((url) => {
    assert.match(url, /store\.steampowered\.com\/api\/storesearch/);
    return jsonRes(STEAM_SEARCH);
  });
  const res = await request(app).get(L('/search?provider=steam&q=stardew'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, [
    { providerId: '413150', title: 'Stardew Valley', thumbnail: 'https://shared.akamai.steamstatic.com/apps/413150/capsule.jpg' },
  ]);
});

test('GET …/lookup/game?provider=steam returns digital detail (players)', async () => {
  stubFetch((url) => {
    assert.match(url, /store\.steampowered\.com\/api\/appdetails/);
    return jsonRes(STEAM_DETAIL);
  });
  const res = await request(app).get(L('/game?provider=steam&id=413150'));
  assert.equal(res.status, 200);
  assert.equal(res.body.title, 'Stardew Valley');
  assert.equal(res.body.type, 'digital');
  assert.equal(res.body.minPlayers, 1); // co-op present -> multiplayer, upper bound unknown
  assert.equal(res.body.maxPlayers, null);
  assert.equal(res.body.imageUrl, 'https://shared.akamai.steamstatic.com/apps/413150/header.jpg');
  assert.equal(res.body.url, 'https://store.steampowered.com/app/413150/');
});

test('steam search returns 502 when Steam is unreachable', async () => {
  stubFetch(() => { throw new Error('network down'); });
  const res = await request(app).get(L('/search?provider=steam&q=zzzunreachable'));
  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'provider_unreachable');
});

// --- Nintendo eShop provider (NoE Solr search, both hops the same endpoint) --

const NINTENDO_DOC = {
  fs_id: '70010000000153',
  title: 'Mario Kart 8 Deluxe',
  url: '/de-de/Spiele/Nintendo-Switch-Spiele/mk8-5678.html',
  players_from: 1,
  players_to: 8,
  image_url_sq_s: 'https://www.nintendo.com/eu/media/images/mk8_square.jpg',
};
const NINTENDO_JSON = { response: { numFound: 1, docs: [NINTENDO_DOC] } };

test('GET …/lookup/search?provider=nintendo returns normalized Switch results', async () => {
  stubFetch((url) => {
    assert.match(url, /searching\.nintendo-europe\.com/);
    assert.match(url, /system_type%3Anintendoswitch/); // Switch-only filter
    return jsonRes(NINTENDO_JSON);
  });
  const res = await request(app).get(L('/search?provider=nintendo&q=mario'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, [
    { providerId: '70010000000153', title: 'Mario Kart 8 Deluxe', thumbnail: 'https://www.nintendo.com/eu/media/images/mk8_square.jpg' },
  ]);
});

test('GET …/lookup/game?provider=nintendo returns digital detail (players)', async () => {
  stubFetch((url) => {
    assert.match(url, /searching\.nintendo-europe\.com/);
    assert.match(url, /fs_id/); // detail filters the index down to one item
    return jsonRes(NINTENDO_JSON);
  });
  const res = await request(app).get(L('/game?provider=nintendo&id=70010000000153'));
  assert.equal(res.status, 200);
  assert.equal(res.body.title, 'Mario Kart 8 Deluxe');
  assert.equal(res.body.type, 'digital');
  assert.equal(res.body.minPlayers, 1);
  assert.equal(res.body.maxPlayers, 8);
  assert.equal(res.body.imageUrl, 'https://www.nintendo.com/eu/media/images/mk8_square.jpg');
  assert.equal(res.body.url, 'https://www.nintendo.com/de-de/Spiele/Nintendo-Switch-Spiele/mk8-5678.html');
});

test('nintendo search returns 502 when Nintendo is unreachable', async () => {
  stubFetch(() => { throw new Error('network down'); });
  const res = await request(app).get(L('/search?provider=nintendo&q=zzzunreachable'));
  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'provider_unreachable');
});

// --- Xbox / Microsoft Store provider (autosuggest search -> catalog detail) --

const XBOX_SEARCH = {
  ResultSets: [
    {
      Suggests: [
        {
          Source: 'Game',
          Title: 'Halo Infinite',
          ImageUrl: '//store-images.s-microsoft.com/image/apps.9999.infinite.jpg',
          Metas: [{ Key: 'BigCatalogId', Value: '9PP5G1F0C2GV' }],
        },
        // A non-game suggestion is dropped by the provider.
        { Source: 'App', Title: 'Halo Companion', Metas: [{ Key: 'BigCatalogId', Value: '9ABC' }] },
      ],
    },
  ],
};
const XBOX_DETAIL = {
  Product: {
    LocalizedProperties: [
      {
        ProductTitle: 'Halo Infinite',
        Images: [{ ImagePurpose: 'BoxArt', Uri: '//store-images.s-microsoft.com/image/box' }],
      },
    ],
    Properties: {
      Attributes: [
        { Name: 'SinglePlayer' },
        { Name: 'XblOnlineMultiplayer', Minimum: 2, Maximum: 8 },
      ],
    },
  },
};

test('GET …/lookup/search?provider=xbox returns only game suggestions', async () => {
  stubFetch((url) => {
    assert.match(url, /msstoreapiprod\/api\/autosuggest/);
    return jsonRes(XBOX_SEARCH);
  });
  const res = await request(app).get(L('/search?provider=xbox&q=halo'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, [
    { providerId: '9PP5G1F0C2GV', title: 'Halo Infinite', thumbnail: 'https://store-images.s-microsoft.com/image/apps.9999.infinite.jpg' },
  ]);
});

test('GET …/lookup/game?provider=xbox returns digital detail (players)', async () => {
  stubFetch((url) => {
    assert.match(url, /displaycatalog\.mp\.microsoft\.com/);
    return jsonRes(XBOX_DETAIL);
  });
  const res = await request(app).get(L('/game?provider=xbox&id=9PP5G1F0C2GV'));
  assert.equal(res.status, 200);
  assert.equal(res.body.title, 'Halo Infinite');
  assert.equal(res.body.type, 'digital');
  assert.equal(res.body.minPlayers, 1); // SinglePlayer floors the minimum
  assert.equal(res.body.maxPlayers, 8);
  assert.equal(res.body.imageUrl, 'https://store-images.s-microsoft.com/image/box');
  assert.equal(res.body.url, 'https://www.xbox.com/de-de/games/store/_/9PP5G1F0C2GV');
});

test('xbox search returns 502 when the provider is unreachable', async () => {
  stubFetch(() => { throw new Error('network down'); });
  const res = await request(app).get(L('/search?provider=xbox&q=zzzunreachable'));
  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'provider_unreachable');
});
