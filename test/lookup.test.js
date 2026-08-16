'use strict';

const { test, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

// The lookup is round-scoped (mergeParams), so every request needs a round.
// Since #744 BoardGameGeek is the only provider and the per-round `providers`
// setting is gone — test/providers.test.js covers what a retired id now does.
let rid;
before(async () => { rid = (await createRound(request)).id; });
const L = (p) => `/api/rounds/${rid}/lookup${p}`;

// Replace global.fetch (used by lib/providers/bgg) with a stub.
function stubFetch(handler) {
  global.fetch = async (url, init) => handler(String(url), init);
}
const htmlRes = (text) => ({ ok: true, status: 200, text: async () => text });

// Register a bare-minimum provider for the duration of one spec. `providers` is
// a plain exported object and `getProvider` reads it per call, so this is enough
// to reach the route's optional-capability branches — which no REGISTERED
// provider can exercise while BGG (which has every capability) is the only one.
const { providers } = require('../lib/providers');
async function withStubProvider(fn) {
  providers.stub = {
    id: 'stub',
    resolveLocale: () => '',
    search: async () => [],
    detail: async () => null,
    imageHosts: [],
    imageHostAllowed: () => false,
  };
  try { await fn(); } finally { delete providers.stub; }
}

test('search with a too-short query short-circuits without calling the provider', async () => {
  let called = false;
  stubFetch(() => { called = true; return htmlRes(''); });
  const res = await request(app).get(L('/search?provider=bgg&q=a'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, []);
  assert.equal(called, false);
});

test('game requires an id', async () => {
  const res = await request(app).get(L('/game?provider=bgg'));
  assert.equal(res.status, 400);
});

// --- BoardGameGeek provider (XML API2 search + thing, token-authorized, #117) --

// One item carries a <yearpublished> and one does not, so the assertion below
// discriminates "the route passes the year through" from "the year is always
// null" — a fixture where nobody has one is green either way (#790).
const BGG_SEARCH_XML = `<items total="2">
  <item type="boardgame" id="13"><name type="primary" value="CATAN"/><yearpublished value="1995"/></item>
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
      { providerId: '13', title: 'CATAN', thumbnail: null, year: 1995 },
      { providerId: '926', title: 'Catan: Cities & Knights', thumbnail: null, year: null },
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

// --- edition covers (#519) ------------------------------------------------
//
// NOTE the cache: this file shares one 10-minute provider cache, keyed
// `bgg:covers:<id>`, so every spec below uses its OWN id or it is silently
// answered from an earlier one and proves nothing
// (.claude/rules/bgg-collection-import.md §4).

const BGG_VERSIONS_XML = `<?xml version="1.0" encoding="utf-8"?>
<items><item type="boardgame" id="13">
    <thumbnail>https://cf.geekdo-images.com/game__thumb/img/y=/fit-in/200x150/pic.png</thumbnail>
    <name type="primary" value="CATAN"/>
    <versions>
      <item type="boardgameversion" id="1">
        <thumbnail>https://cf.geekdo-images.com/de__thumb/img/y=/fit-in/200x150/pic1.png</thumbnail>
        <image>https://cf.geekdo-images.com/de__original/img/z=/0x0/pic1.png</image>
        <name type="primary" value="German edition"/>
        <yearpublished value="2015"/>
        <link type="language" id="2188" value="German"/>
      </item>
      <item type="boardgameversion" id="2">
        <thumbnail>https://evil.example.com/not-a-bgg-host.png</thumbnail>
        <name type="primary" value="Off-allowlist edition"/>
        <yearpublished value="2016"/>
        <link type="language" id="2184" value="English"/>
      </item>
    </versions>
  </item>
</items>`;

test('GET …/lookup/covers?provider=bgg returns the edition covers, versions=1', async () => {
  await withToken('test-token', async () => {
    let seen = '';
    stubFetch((url) => { seen = url; return htmlRes(BGG_VERSIONS_XML); });
    const res = await request(app).get(L('/covers?provider=bgg&id=cov1'));
    assert.equal(res.status, 200);
    assert.match(seen, /^https:\/\/boardgamegeek\.com\/xmlapi2\/thing\?/);
    // Without versions=1 the answer is the plain detail body and the picker is
    // empty — the one parameter the whole feature rests on.
    assert.match(seen, /versions=1/);
    // The off-allowlist host is dropped by providerCoverUrl, so nothing the
    // client could send back on save is ever offered here; the game item's own
    // cover is not an edition and must not appear either.
    assert.deepEqual(res.body.covers, [{
      imageUrl: 'https://cf.geekdo-images.com/de__thumb/img/y=/fit-in/200x150/pic1.png',
      edition: 'German edition',
      year: 2015,
      languages: ['German'],
    }]);
  });
});

test('covers is cached separately from the detail hop for the same id', async () => {
  await withToken('test-token', async () => {
    let versionCalls = 0;
    stubFetch((url) => {
      if (/versions=1/.test(url)) { versionCalls += 1; return htmlRes(BGG_VERSIONS_XML); }
      return htmlRes(BGG_THING_XML);
    });
    // A shared cache key would make one of these answer with the other's body.
    const detail = await request(app).get(L('/game?provider=bgg&id=cov2'));
    assert.equal(detail.body.title, 'CATAN');
    const covers = await request(app).get(L('/covers?provider=bgg&id=cov2'));
    assert.equal(covers.body.covers.length, 1);
    // And the second identical call is served from the cache, not from BGG.
    await request(app).get(L('/covers?provider=bgg&id=cov2'));
    assert.equal(versionCalls, 1);
  });
});

test('covers refuses a provider that has no edition-cover capability', async () => {
  // The capability guard is the contract a SECOND provider would arrive under,
  // and with BGG alone (#744) nothing registered can exercise it — the four
  // storefronts that used to stand in here are gone. So the spec registers a
  // minimal provider of its own, the same "invent the missing member" move
  // .claude/rules/locale-set-is-data.md uses for a locale. Without it this
  // branch would simply stop being tested while still looking covered.
  await withStubProvider(async () => {
    let called = false;
    stubFetch(() => { called = true; return htmlRes(''); });
    const res = await request(app).get(L('/covers?provider=stub&id=1'));
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'covers_unsupported');
    assert.equal(called, false);
  });
});

test('covers rejects a missing id and an unknown provider', async () => {
  const noId = await request(app).get(L('/covers?provider=bgg'));
  assert.equal(noId.status, 400);
  const unknown = await request(app).get(L('/covers?provider=nope&id=13'));
  assert.equal(unknown.status, 400);
});

test('covers returns 502 when BGG is unreachable', async () => {
  await withToken('test-token', async () => {
    stubFetch(() => { throw new Error('network down'); });
    const res = await request(app).get(L('/covers?provider=bgg&id=cov3'));
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'provider_unreachable');
  });
});

test('covers degrades to an empty list without a token, and never calls out', async () => {
  await withToken(null, async () => {
    let called = false;
    stubFetch(() => { called = true; return htmlRes(BGG_VERSIONS_XML); });
    const res = await request(app).get(L('/covers?provider=bgg&id=cov4'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.covers, []);
    assert.equal(called, false);
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

// --- the locale a provider is asked for (#505) -------------------------------
//
// Four digital storefronts answered in the caller's UI language and were the
// reason this parameter exists. #744 retired them, so what is left to pin is the
// property BGG has always had and that the cache key still depends on.

test('BGG ignores the locale entirely and keeps ONE cache entry', async () => {
  await withToken('test-token', async () => {
    let calls = 0;
    global.fetch = async () => { calls += 1; return htmlRes(BGG_SEARCH_XML); };

    const de = await request(app).get(L('/search?provider=bgg&q=bgglocale&lang=de'));
    const en = await request(app).get(L('/search?provider=bgg&q=bgglocale&lang=en'));
    assert.equal(calls, 1, 'a locale must not fragment BGG’s cache — its answers are identical');
    assert.deepEqual(de.body.results, en.body.results);
  });
});

/* --------------------------- expansions (#653) ---------------------------- */

// A /thing body carrying the expansion links parseThing has always had access
// to. The `id` here has to be unique per spec: this file shares one 10-minute
// cache, so a reused id is answered from an earlier test's entry and the stub
// silently proves nothing (.claude/rules/bgg-collection-import.md §4).
const EXPANSIONS_XML = `<items><item type="boardgame" id="exp1">
  <name type="primary" value="CATAN"/>
  <minplayers value="3"/><maxplayers value="4"/>
  <link type="boardgameexpansion" id="325" value="Seafarers"/>
  <link type="boardgameexpansion" id="99" value="Basis" inbound="true"/>
</item></items>`;

test('GET …/lookup/expansions lists what BGG knows, dropping the inbound link', async () => {
  await withToken('test-token', async () => {
    stubFetch(() => htmlRes(EXPANSIONS_XML));
    const res = await request(app).get(L('/expansions?provider=bgg&id=exp1'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.expansions, [{ providerId: '325', title: 'Seafarers' }]);
  });
});

test('the expansion list reuses the detail hop’s cache entry — no extra request', async () => {
  await withToken('test-token', async () => {
    let calls = 0;
    global.fetch = async () => { calls += 1; return htmlRes(EXPANSIONS_XML.replace('exp1', 'exp2')); };

    await request(app).get(L('/game?provider=bgg&id=exp2'));
    assert.equal(calls, 1);
    const res = await request(app).get(L('/expansions?provider=bgg&id=exp2'));
    assert.equal(calls, 1, 'the same /thing body answers both — that is the whole point');
    assert.equal(res.body.expansions.length, 1);
  });
});

test('expansions are an OPTIONAL capability: a provider without one answers 400, never a fetch', async () => {
  await withStubProvider(async () => {
    let called = false;
    stubFetch(() => { called = true; return htmlRes(''); });
    const res = await request(app).get(L('/expansions?provider=stub&id=X'));
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'expansions_unsupported');
    assert.equal(called, false, 'refused before any upstream call');
  });

  assert.equal((await request(app).get(L('/expansions?provider=bgg'))).status, 400, 'missing id');
  assert.equal((await request(app).get(L('/expansions?provider=nope&id=1'))).status, 400);
});

test('expansions degrade to an empty list without a token, and 502 on an outage', async () => {
  await withToken(null, async () => {
    let called = false;
    stubFetch(() => { called = true; return htmlRes(EXPANSIONS_XML); });
    const res = await request(app).get(L('/expansions?provider=bgg&id=exp3'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.expansions, []);
    assert.equal(called, false);
  });
  await withToken('test-token', async () => {
    stubFetch(() => { throw new Error('network down'); });
    const res = await request(app).get(L('/expansions?provider=bgg&id=exp4'));
    assert.equal(res.status, 502);
  });
});
