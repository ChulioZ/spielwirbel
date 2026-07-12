'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('./helpers');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

// Replace global.fetch (used by lib/providers/bgg) with a stub returning XML.
function stubFetch(handler) {
  global.fetch = async (url) => handler(String(url));
}
const xmlRes = (text) => ({ ok: true, status: 200, text: async () => text });

const SEARCH_XML = `<items>
  <item type="boardgame" id="13"><name type="primary" value="Catan"/><yearpublished value="1995"/></item>
</items>`;
const THING_XML = `<items><item type="boardgame" id="13">
  <image>https://cf.geekdo-images.com/catan.png</image>
  <name type="primary" value="Catan"/>
  <minplayers value="3"/><maxplayers value="4"/><playingtime value="75"/>
</item></items>`;

test('GET /api/lookup/search returns normalized results', async () => {
  stubFetch((url) => {
    assert.match(url, /\/search\?/);
    return xmlRes(SEARCH_XML);
  });
  const res = await request(app).get('/api/lookup/search?provider=bgg&q=catan');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, [
    { providerId: '13', title: 'Catan', year: '1995', thumbnail: null },
  ]);
});

test('search with a too-short query short-circuits without calling the provider', async () => {
  let called = false;
  stubFetch(() => { called = true; return xmlRes(SEARCH_XML); });
  const res = await request(app).get('/api/lookup/search?provider=bgg&q=a');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, []);
  assert.equal(called, false);
});

test('search rejects an unknown provider', async () => {
  const res = await request(app).get('/api/lookup/search?provider=nope&q=catan');
  assert.equal(res.status, 400);
});

test('search returns 502 when the provider is unreachable', async () => {
  stubFetch(() => { throw new Error('network down'); });
  const res = await request(app).get('/api/lookup/search?provider=bgg&q=zzzunreachable');
  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'provider_unreachable');
});

test('GET /api/lookup/game returns normalized detail (75 min -> medium)', async () => {
  stubFetch((url) => {
    assert.match(url, /\/thing\?id=13/);
    return xmlRes(THING_XML);
  });
  const res = await request(app).get('/api/lookup/game?provider=bgg&id=13');
  assert.equal(res.status, 200);
  assert.equal(res.body.title, 'Catan');
  assert.equal(res.body.minPlayers, 3);
  assert.equal(res.body.maxPlayers, 4);
  assert.equal(res.body.duration, 'medium');
  assert.equal(res.body.type, 'analog');
  assert.equal(res.body.imageUrl, 'https://cf.geekdo-images.com/catan.png');
  assert.equal(res.body.url, 'https://boardgamegeek.com/boardgame/13');
});

test('game returns 404 when the provider has no such item', async () => {
  stubFetch(() => xmlRes('<items></items>'));
  const res = await request(app).get('/api/lookup/game?provider=bgg&id=999999');
  assert.equal(res.status, 404);
});

test('game requires an id', async () => {
  const res = await request(app).get('/api/lookup/game?provider=bgg');
  assert.equal(res.status, 400);
});
