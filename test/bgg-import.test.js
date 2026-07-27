'use strict';

/*
 * The BoardGameGeek collection import (issue #481) — the two round-scoped routes
 * under /api/rounds/:rid/lookup.
 *
 * Accounts are ON here, because the whole feature hangs off the ACTING account:
 * the BGG handle is read from the account, never from the request, so a
 * legacy/accounts-off instance can only ever reach the 'no_username' state.
 * Quotas are only enforced in that mode too (#139), so the refusal path needs it.
 *
 * `fetch` is stubbed throughout — no test here touches BGG.
 */

// Flags before the app is built. A tiny games ceiling so the cap trips on a
// three-game collection instead of needing a thousand.
process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.MAX_GAMES_PER_ROUND = '4';
process.env.BGG_API_TOKEN = 'test-token';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const PASSWORD = 'correct horse battery';
const handle = (email) => email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');

async function makeAccount(email) {
  await request(app).post('/api/account/register').send({ email, username: handle(email), password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function makeRound(token, over = {}) {
  const res = await request(app).post('/api/rounds').set(auth(token))
    .send({ name: 'R', members: ['Alice'], ...over });
  assert.equal(res.status, 201);
  return res.body;
}

// One <item> in the collection shape (name as a text node, players on <stats>).
const item = (objectid, name) => `
  <item objecttype="thing" objectid="${objectid}" subtype="boardgame" collid="c${objectid}">
    <name sortindex="1">${name}</name>
    <thumbnail>https://cf.geekdo-images.com/x__thumb/img/y=/fit-in/200x150/pic${objectid}.png</thumbnail>
    <stats minplayers="2" maxplayers="4"/>
    <status own="1"/>
  </item>`;

const collectionXml = (...items) => `<?xml version="1.0" encoding="utf-8"?>
<items totalitems="${items.length}">${items.join('')}</items>`;

const THREE = collectionXml(item('13', 'CATAN'), item('822', 'Carcassonne'), item('9209', 'Ticket to Ride'));

// Stub BGG. Every call is answered with the same body, and the requested URLs
// are collected so a test can assert what was (or was not) asked for.
function stubBgg(body, status = 200) {
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return { status, text: async () => body };
  };
  return urls;
}

const link = (token, bggUsername) => request(app).patch('/api/account/me').set(auth(token)).send({ bggUsername });

/* ------------------------------- the listing ------------------------------- */

test('the collection lists the account\'s owned games and marks what is already on the shelf', async () => {
  const a = await makeAccount('imp-list@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerList');

  const urls = stubBgg(THREE);
  const res = await request(app).get(`/api/rounds/${round.id}/lookup/collection?provider=bgg`).set(auth(a.token));
  assert.equal(res.status, 200);
  assert.equal(res.body.state, 'ok');
  assert.deepEqual(res.body.games.map((g) => g.title), ['CATAN', 'Carcassonne', 'Ticket to Ride']);
  assert.deepEqual(res.body.games[0], {
    externalId: '13',
    title: 'CATAN',
    minPlayers: 2,
    maxPlayers: 4,
    imageUrl: 'https://cf.geekdo-images.com/x__thumb/img/y=/fit-in/200x150/pic13.png',
    url: 'https://boardgamegeek.com/boardgame/13',
    present: false,
  });

  // The handle came from the ACCOUNT, and only owned base games were requested.
  assert.equal(urls.length, 1);
  assert.match(urls[0], /username=GamerList/);
  assert.match(urls[0], /own=1/);

  // Import one, then re-list: it comes back marked rather than dropped, so the
  // list still reads as the user's whole collection.
  await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token)).send({ externalIds: ['13'] });
  const again = await request(app).get(`/api/rounds/${round.id}/lookup/collection?provider=bgg`).set(auth(a.token));
  assert.equal(again.body.games.length, 3);
  assert.deepEqual(again.body.games.map((g) => g.present), [true, false, false]);
});

test('the five collection states are distinguishable, and none of them throws', async () => {
  const a = await makeAccount('imp-states@example.com');
  const round = await makeRound(a.token);
  const url = `/api/rounds/${round.id}/lookup/collection?provider=bgg`;

  // A distinct handle per state: a settled collection is cached for ten minutes
  // keyed by the handle, so reusing one would answer the next state from the
  // cache. (That the cache works is asserted at the end.)
  const ask = async (handleName, body, status) => {
    await link(a.token, handleName);
    stubBgg(body, status);
    return request(app).get(url).set(auth(a.token));
  };

  // 1. nothing linked yet
  stubBgg(THREE);
  const none = await request(app).get(url).set(auth(a.token));
  assert.equal(none.status, 200);
  assert.equal(none.body.state, 'no_username');
  assert.deepEqual(none.body.games, []);

  // 2. BGG does not know the handle (served as HTTP 200, so it can only be told
  //    from an empty collection by parsing the error document)
  const bad = await ask('StatesInvalid', '<errors><error><message>Invalid username specified</message></error></errors>');
  assert.equal(bad.body.state, 'invalid_user');

  // 3. a real collection with nothing marked as owned
  const empty = await ask('StatesEmpty', collectionXml());
  assert.equal(empty.body.state, 'ok');
  assert.deepEqual(empty.body.games, []);

  // 4. BGG is still building the export
  const queued = await ask('StatesQueued', '', 202);
  assert.equal(queued.body.state, 'queued');

  // …and that answer must NOT be cached, or "try again shortly" would be a lie
  // for the next ten minutes: the retry the message asks for would be served
  // from the cache instead of asking BGG whether it had finished.
  stubBgg(THREE);
  const retry = await request(app).get(url).set(auth(a.token));
  assert.equal(retry.body.state, 'ok');
  assert.equal(retry.body.games.length, 3);

  // A settled collection, by contrast, IS cached — the provider is not asked again.
  const urls = stubBgg(collectionXml());
  const cachedRes = await request(app).get(url).set(auth(a.token));
  assert.equal(cachedRes.body.games.length, 3, 'served from the cache, not the new stub');
  assert.equal(urls.length, 0, 'and BGG was not called again');

  // 5. a genuine outage is a 502, like every other provider hop
  const down = await ask('StatesDown', '', 500);
  assert.equal(down.status, 502);
  assert.equal(down.body.error, 'provider_unreachable');
});

test('a round with the bgg provider switched off refuses the import outright (#294)', async () => {
  const a = await makeAccount('imp-disabled@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerDisabled');
  await request(app).put(`/api/rounds/${round.id}/providers`).set(auth(a.token)).send({ providers: ['steam'] });

  let called = false;
  global.fetch = async () => { called = true; return { status: 200, text: async () => THREE }; };

  for (const res of [
    await request(app).get(`/api/rounds/${round.id}/lookup/collection?provider=bgg`).set(auth(a.token)),
    await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
      .set(auth(a.token)).send({ externalIds: ['13'] }),
  ]) {
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'provider_disabled');
  }
  // The setting is ENFORCED, not merely hidden: the provider is never reached.
  assert.equal(called, false);
});

/* -------------------------------- the import ------------------------------- */

test('importing writes full game records, ONE Chronik entry and one product event', async () => {
  const a = await makeAccount('imp-write@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerWrite');
  stubBgg(THREE);

  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token)).send({ externalIds: ['13', '9209'] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { imported: 2, skipped: 0 });

  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  const games = full.body.games;
  assert.equal(games.length, 2);
  // Collection order, not request order.
  assert.deepEqual(games.map((g) => g.title), ['CATAN', 'Ticket to Ride']);
  assert.equal(games[0].minPlayers, 2);
  assert.equal(games[0].maxPlayers, 4);
  // Hotlinked, never re-hosted (#172).
  assert.equal(games[0].image, 'https://cf.geekdo-images.com/x__thumb/img/y=/fit-in/200x150/pic13.png');
  // Linked, so "View on BoardGameGeek" works.
  assert.deepEqual(games[0].source, {
    provider: 'bgg',
    externalId: '13',
    url: 'https://boardgamegeek.com/boardgame/13',
  });

  // One bulk entry, not one per game — the flood a loop over POST /games would
  // put in the Chronik and in every friend's feed.
  const feed = await request(app).get(`/api/rounds/${round.id}/activities`).set(auth(a.token));
  const acts = feed.body.filter((x) => x.type === 'games_imported');
  assert.equal(acts.length, 1);
  assert.equal(acts[0].count, 2);
  assert.equal(feed.body.filter((x) => x.type === 'game_added').length, 0);
});

test('re-running an unchanged collection adds nothing', async () => {
  const a = await makeAccount('imp-idempotent@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerIdem');
  stubBgg(THREE);
  const url = `/api/rounds/${round.id}/lookup/import?provider=bgg`;

  const first = await request(app).post(url).set(auth(a.token)).send({ externalIds: ['13', '822'] });
  assert.deepEqual(first.body, { imported: 2, skipped: 0 });

  const again = await request(app).post(url).set(auth(a.token)).send({ externalIds: ['13', '822'] });
  assert.deepEqual(again.body, { imported: 0, skipped: 2 });

  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  assert.equal(full.body.games.length, 2);
  // And no second Chronik row for an import that imported nothing.
  const feed = await request(app).get(`/api/rounds/${round.id}/activities`).set(auth(a.token));
  assert.equal(feed.body.filter((x) => x.type === 'games_imported').length, 1);
});

test('an import that would exceed the games cap is refused WHOLE (#139)', async () => {
  const a = await makeAccount('imp-quota@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerQuota');
  // MAX_GAMES_PER_ROUND is 4 here; park three games so a 3-game import overflows.
  for (const title of ['A', 'B', 'C']) {
    const res = await request(app).post(`/api/rounds/${round.id}/games`).set(auth(a.token))
      .send({ title, minPlayers: '2', maxPlayers: '4' });
    assert.equal(res.status, 201);
  }
  stubBgg(THREE);

  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token)).send({ externalIds: ['13', '822', '9209'] });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'quota_games');
  assert.equal(res.body.limit, 4);

  // Nothing was written — a bulk add has no undo, so it must be all or nothing.
  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  assert.equal(full.body.games.length, 3);
});

test('the import takes its handle from the ACCOUNT, never from the request', async () => {
  const a = await makeAccount('imp-handle@example.com');
  const round = await makeRound(a.token);

  // No handle linked: refused, and BGG is never called.
  let called = false;
  global.fetch = async () => { called = true; return { status: 200, text: async () => THREE }; };
  const none = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token)).send({ externalIds: ['13'] });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, 'no_bgg_username');
  assert.equal(called, false);

  // With one linked, a username supplied in the body is ignored — otherwise this
  // route is an arbitrary-BGG-user scraper running under our API token.
  await link(a.token, 'GamerHandle');
  const urls = stubBgg(THREE);
  await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token)).send({ externalIds: ['13'], username: 'someone-else', bggUsername: 'someone-else' });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /username=GamerHandle/);
  assert.doesNotMatch(urls[0], /someone-else/);
});

test('the import only ever writes what the collection actually holds', async () => {
  const a = await makeAccount('imp-forge@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerForge');
  stubBgg(THREE);

  // An id the collection does not list is ignored rather than trusted, so a
  // hand-rolled request cannot invent a game.
  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token)).send({ externalIds: ['13', '999999'] });
  assert.deepEqual(res.body, { imported: 1, skipped: 0 });

  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  assert.deepEqual(full.body.games.map((g) => g.title), ['CATAN']);

  // An empty selection is a client bug, not a silent no-op.
  const empty = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token)).send({ externalIds: [] });
  assert.equal(empty.status, 400);
});

test('importing while BGG is mid-export is a distinct refusal, not a partial write', async () => {
  const a = await makeAccount('imp-queued@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerQueued');
  stubBgg('', 202);

  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token)).send({ externalIds: ['13'] });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'queued');

  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  assert.equal(full.body.games.length, 0);
});

test('another account cannot import into a round it does not own', async () => {
  const a = await makeAccount('imp-owner@example.com');
  const b = await makeAccount('imp-stranger@example.com');
  const round = await makeRound(a.token);
  await link(b.token, 'GamerStranger');
  stubBgg(THREE);

  // Tenant-scoped like every other round route: another tenant's round is
  // indistinguishable from a missing one.
  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(b.token)).send({ externalIds: ['13'] });
  assert.equal(res.status, 404);

  const list = await request(app).get(`/api/rounds/${round.id}/lookup/collection?provider=bgg`).set(auth(b.token));
  assert.equal(list.status, 404);
});
