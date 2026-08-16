'use strict';

/*
 * The lookup provider registry over HTTP, after #744 retired the four digital
 * storefronts and the per-round `providers` setting with them.
 *
 * This file used to test that setting (issue #294) and the 403 it bought. What
 * replaces it is the property the retirement has to hold: BoardGameGeek answers
 * on every round with no configuration anywhere, and a request naming a retired
 * provider is refused CLEANLY — a 400, never a throw and never an upstream
 * request. Both matter because a stale tab is the normal way one arrives: the
 * client stopped offering those ids the moment this shipped, so anything asking
 * for one is a client that has not reloaded since.
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, createRound } = require('./helpers');
const { providers } = require('../lib/providers');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

// The ids #744 unregistered. Read as data rather than asserted one by one, so
// the "never reaches upstream" property is proven for all four rather than for
// whichever one someone thought of.
const RETIRED = ['psstore', 'steam', 'nintendo', 'xbox'];

test('BoardGameGeek is the whole registry', () => {
  assert.deepEqual(Object.keys(providers), ['bgg']);
});

test('a fresh round still has no providers key — nothing writes one any more', async () => {
  const round = await createRound(request);
  const res = await request(app).get(`/api/rounds/${round.id}`);
  assert.equal(res.status, 200);
  assert.equal('providers' in res.body, false);
});

test('the per-round providers route is gone', async () => {
  const round = await createRound(request);
  const res = await request(app)
    .put(`/api/rounds/${round.id}/providers`)
    .send({ providers: ['bgg'] });
  // Unmounted, so the SPA fallback answers — the point is only that it is not a
  // 200 that silently stores a setting nothing reads.
  assert.notEqual(res.status, 200);
});

test('a retired provider is a clean 400 and never reaches upstream', async () => {
  const round = await createRound(request);
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, text: async () => '' }; };

  for (const id of RETIRED) {
    const search = await request(app)
      .get(`/api/rounds/${round.id}/lookup/search?provider=${id}&q=witcher`);
    assert.equal(search.status, 400, `${id} search`);
    assert.equal(search.body.error, 'Unknown provider');

    const detail = await request(app)
      .get(`/api/rounds/${round.id}/lookup/game?provider=${id}&id=X`);
    assert.equal(detail.status, 400, `${id} detail`);

    const covers = await request(app)
      .get(`/api/rounds/${round.id}/lookup/covers?provider=${id}&id=13`);
    // The registry check runs before the capability check, so a retired provider
    // answers 400 `Unknown provider` rather than 400 `covers_unsupported` — it
    // never gets far enough to reveal what it could or could not do.
    assert.equal(covers.status, 400, `${id} covers`);
    assert.equal(covers.body.error, 'Unknown provider');
  }

  assert.equal(called, false, 'a retired provider must cost no upstream request');
});

test('BGG answers on an unconfigured round — the lookup is unconditional now', async () => {
  const round = await createRound(request);
  const previousToken = process.env.BGG_API_TOKEN;
  process.env.BGG_API_TOKEN = 'test-token'; // BGG answers nothing without one (#117)
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<items><item type="boardgame" id="13"><name type="primary" value="Catan"/><yearpublished value="1995"/></item></items>',
  });
  try {
    const res = await request(app)
      .get(`/api/rounds/${round.id}/lookup/search?provider=bgg&q=catan`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results, [{ providerId: '13', title: 'Catan', thumbnail: null, year: 1995 }]);
  } finally {
    if (previousToken === undefined) delete process.env.BGG_API_TOKEN;
    else process.env.BGG_API_TOKEN = previousToken;
  }
});

test('the lookup 404s for a round that does not exist', async () => {
  const res = await request(app).get('/api/rounds/nope/lookup/search?provider=bgg&q=catan');
  assert.equal(res.status, 404);
});

test('an id that never existed is a 400, like a retired one', async () => {
  const round = await createRound(request);
  const res = await request(app)
    .get(`/api/rounds/${round.id}/lookup/search?provider=nope&q=catan`);
  assert.equal(res.status, 400);
});
