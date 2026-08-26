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
    // Uniform on both shelves (#664), and false by construction on this one —
    // the owned hop still asks BGG to exclude expansions.
    expansion: false,
    expansionOf: [],
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

// #744 retired the four storefronts, so `provider=steam` on these two hops is
// now an unknown id rather than a disabled one. The property that matters is
// unchanged and is what this asserts: the refusal happens BEFORE any upstream
// call, so a stale tab cannot make us fetch anything.
test('a retired provider id is refused before the collection is fetched (#744)', async () => {
  const a = await makeAccount('imp-retired@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerRetired');

  let called = false;
  global.fetch = async () => { called = true; return { status: 200, text: async () => THREE }; };

  for (const res of [
    await request(app).get(`/api/rounds/${round.id}/lookup/collection?provider=steam`).set(auth(a.token)),
    await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=steam`)
      .set(auth(a.token)).send({ externalIds: ['13'] }),
  ]) {
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Unknown provider');
  }
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

test('the import fires the provider-info backfill, so the first draw already has it (#717)', async (t) => {
  /* The reported gap: import -> draw -> vote showed no info anywhere, because
   * the session-start backfill races the first voter and a collection body
   * carries none of the fields. Import time is the polite place to fill them — a
   * paced pass of /thing?stats=1 batches, long before anyone draws. The stub
   * branches on the URL the way BGG does: the collection body for /collection,
   * a stats body for /thing. */
  const a = await makeAccount('imp-backfill@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerBackfill');

  const thingCalls = [];
  global.fetch = async (url) => {
    const u = String(url);
    if (/\/thing\?/.test(u)) {
      thingCalls.push(u);
      return { status: 200, text: async () => `<items>
        <item type="boardgame" id="13"><name type="primary" value="CATAN"/>
          <description>Handel &amp; Bau.</description>
          <statistics><ratings><average value="7.1"/><averageweight value="2.28"/></ratings></statistics></item>
        <item type="boardgame" id="9209"><name type="primary" value="Ticket to Ride"/>
          <description>Zugstrecken.</description>
          <statistics><ratings><average value="7.4"/><averageweight value="1.85"/></ratings></statistics></item>
      </items>` };
    }
    return { status: 200, text: async () => THREE };
  };
  t.after(() => { global.fetch = realFetch; });

  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token)).send({ externalIds: ['13', '9209'] });
  assert.equal(res.status, 200);

  // Fire-and-forget: poll until the batched backfill lands in the store.
  let games;
  for (let i = 0; i < 50; i++) {
    games = (await repo.getRound(a.user.tenantId, round.id)).games;
    if (games.every((g) => g.weight != null)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const byExt = new Map(games.map((g) => [g.source.externalId, g]));
  assert.equal(byExt.get('13').weight, 2.28);
  assert.equal(byExt.get('13').rating, 7.1);
  // The stub bodies carry a <description>; #729 means none of it is stored.
  assert.equal('description' in byExt.get('13'), false);
  assert.equal(byExt.get('9209').weight, 1.85);
  assert.equal(thingCalls.length, 1, 'both imported games ride one batched /thing call');
  assert.match(thingCalls[0], /stats=1/);
});

test('an import of MORE than one batch fills every game (#828)', async (t) => {
  /* The reported bug at its own entry point. BGG answers `400 Cannot load more
   * than 20 items` to any /thing over 20 ids, and the import asked for 60 — so
   * an imported collection got no provider metadata at all, "Weitere Filter"
   * never appeared, and only the nine-game demo round worked.
   *
   * 25 games is deliberately just over one batch: a 20-game import is green
   * whatever the bound is, which is why the spec above could not see this. */
  process.env.MAX_GAMES_PER_ROUND = '100';
  process.env.PROVIDER_INFO_BATCH_PAUSE_MS = '0';
  t.after(() => {
    process.env.MAX_GAMES_PER_ROUND = '4';
    delete process.env.PROVIDER_INFO_BATCH_PAUSE_MS;
    global.fetch = realFetch;
  });

  const a = await makeAccount('imp-two-batches@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerTwoBatches');

  const ids = Array.from({ length: 25 }, (_, i) => String(870000 + i));
  const collection = `<?xml version="1.0"?><items totalitems="${ids.length}">${ids
    .map((id) => `<item objecttype="thing" objectid="${id}"><name>Spiel ${id}</name>
      <status own="1"/></item>`).join('')}</items>`;
  const thingCalls = [];
  global.fetch = async (url) => {
    const u = String(url);
    if (!/\/thing\?/.test(u)) return { status: 200, text: async () => collection };
    const batch = new URL(u).searchParams.get('id').split(',');
    thingCalls.push(batch);
    return { status: 200, text: async () => `<items>${batch.map((id) =>
      `<item type="boardgame" id="${id}"><name type="primary" value="Spiel ${id}"/>
        <statistics><ratings><averageweight value="2.5"/></ratings></statistics></item>`).join('')}</items>` };
  };

  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token)).send({ externalIds: ids });
  assert.equal(res.status, 200);
  assert.equal(res.body.imported, 25);

  // Fire-and-forget, like the spec above: poll until the paced pass lands.
  let games;
  for (let i = 0; i < 100; i++) {
    games = (await repo.getRound(a.user.tenantId, round.id)).games;
    if (games.every((g) => g.weight != null)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(games.filter((g) => g.weight === 2.5).length, 25,
    'a game past the first batch was left without provider metadata');
  assert.ok(thingCalls.length >= 2, 'the import must batch, not ask once');
  for (const batch of thingCalls) {
    assert.ok(batch.length <= 20, `a /thing request carried ${batch.length} ids — BGG answers 400 over 20`);
  }
});

test('the listing never offers a cover the import would refuse to store (#519)', async () => {
  const a = await makeAccount('imp-listing-cover@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerListing');
  // A thumbnail on a host no provider vouches for. The client renders this into
  // `background-image: url('…')`, so an ungated value is a CSS-injection
  // context as well as a cover that would vanish on import.
  stubBgg(collectionXml(`
    <item objecttype="thing" objectid="13" subtype="boardgame" collid="c13">
      <name sortindex="1">CATAN</name>
      <thumbnail>https://evil.example.com/a'); background:url(x</thumbnail>
      <stats minplayers="2" maxplayers="4"/>
      <status own="1"/>
    </item>`, item('822', 'Carcassonne')));

  const res = await request(app).get(`/api/rounds/${round.id}/lookup/collection?provider=bgg`)
    .set(auth(a.token));
  assert.equal(res.status, 200);
  const byTitle = Object.fromEntries(res.body.games.map((g) => [g.title, g]));
  assert.equal(byTitle.CATAN.imageUrl, null);
  // Anti-vacuous: a legitimate BGG cover still comes through.
  assert.equal(byTitle.Carcassonne.imageUrl, 'https://cf.geekdo-images.com/x__thumb/img/y=/fit-in/200x150/pic822.png');
});

test('a per-game edition cover picked on the import screen is stored (#519)', async () => {
  const a = await makeAccount('imp-cover@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerCover');
  stubBgg(THREE);

  const chosen = 'https://cf.geekdo-images.com/de__thumb/img/y=/fit-in/200x150/german-edition.png';
  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token))
    .send({ externalIds: ['13', '822'], covers: { 13: chosen } });
  assert.equal(res.status, 200);

  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  const byTitle = Object.fromEntries(full.body.games.map((g) => [g.title, g]));
  assert.equal(byTitle.CATAN.image, chosen);
  // A game the user did not touch keeps the cover the collection reported —
  // the choice is per game, never a blanket override.
  assert.equal(byTitle.Carcassonne.image, 'https://cf.geekdo-images.com/x__thumb/img/y=/fit-in/200x150/pic822.png');
  // Only the cover is client-supplied: the title and the player range are still
  // re-resolved against the collection server-side.
  assert.equal(byTitle.CATAN.minPlayers, 2);
});

test('an import cover outside the allowlist costs the CHOICE, never the cover', async () => {
  const a = await makeAccount('imp-cover-bad@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerCoverBad');
  stubBgg(THREE);

  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token))
    .send({
      externalIds: ['13', '822', '9209'],
      covers: {
        13: 'https://evil.example.com/tracker.png',      // wrong host
        822: 'http://cf.geekdo-images.com/pic.png',      // not https
        9209: "https://cf.geekdo-images.com/a'); x.png", // CSS-injection shape
      },
    });
  assert.equal(res.status, 200);

  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  // Each falls back to the collection's own cover rather than to nothing, so a
  // refused URL never leaves the game coverless.
  for (const g of full.body.games) {
    assert.match(g.image, /^https:\/\/cf\.geekdo-images\.com\/x__thumb\//);
  }
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
  // Exactly one COLLECTION request (the #717 backfill adds a /thing hop after
  // the import, which is not a collection read), carrying the account's
  // handle — and the forged one reaches no upstream URL at all.
  const collections = urls.filter((u) => /\/collection\?/.test(u));
  assert.equal(collections.length, 1);
  assert.match(collections[0], /username=GamerHandle/);
  urls.forEach((u) => assert.doesNotMatch(u, /someone-else/));
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

/* -------------------------- the wishlist import (#560) --------------------- */

/* The same two hops against BGG's OTHER shelf. Three things separate it from
   the owned import above, and each fails silently:
   the query parameter, the 10-minute cache key, and the fact that the created
   games must land outside the active collection. */

test('the wishlist import asks BGG for wishlist=1 and creates wishes, silently', async () => {
  const a = await makeAccount('imp-wish@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerWish');

  const urls = stubBggRouted({ collection: THREE });
  const list = await request(app)
    .get(`/api/rounds/${round.id}/lookup/collection?provider=bgg&status=wishlist`)
    .set(auth(a.token));
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.games.map((g) => g.title), ['CATAN', 'Carcassonne', 'Ticket to Ride']);
  // TWO requests since #702: the wishlist body plus the subtype-scoped probe
  // that says which of its items are expansions (none here).
  assert.equal(urls.length, 2);
  assert.match(urls[0], /wishlist=1/);
  assert.equal(/[?&]own=1/.test(urls[0]), false, 'the wishlist hop must not also ask for the owned shelf');
  // Expansions are NOT excluded here (#664, reversing what #560 shipped): on a
  // wishlist an expansion is exactly what the group means to record, so
  // filtering them out silently dropped a large share of every import. The
  // OWNED shelf still excludes them — asserted in the listing spec above.
  assert.equal(/excludesubtype/.test(urls[0]), false);
  assert.match(urls[1], /subtype=boardgameexpansion/);
  assert.match(urls[1], /wishlist=1/);

  // Re-stubbed for the import hop; the listing's URLs have been asserted above.
  stubBggRouted({ collection: THREE });
  const res = await request(app)
    .post(`/api/rounds/${round.id}/lookup/import?provider=bgg&status=wishlist`)
    .set(auth(a.token)).send({ externalIds: ['13', '9209'] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { imported: 2, skipped: 0 });

  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  assert.deepEqual(full.body.games.map((g) => g.title), ['CATAN', 'Ticket to Ride']);
  full.body.games.forEach((g) => {
    assert.equal(g.wish, true, `${g.title} must be a wish`);
    assert.ok(g.wishAt);
    assert.equal(g.retired, false);
    assert.equal(g.completed, false);
    // Absent-key parity: only an expansion may carry expansionOf (#664).
    assert.equal('expansionOf' in g, false, `${g.title} must stay keyless`);
  });
  // Invisible to the shelf's own count.
  const home = (await request(app).get('/api/rounds').set(auth(a.token))).body.find((r) => r.id === round.id);
  assert.equal(home.gameCount, 0);

  // And silent: no bulk Chronik entry, no per-game one either. The group has
  // acquired nothing, so there is nothing for the round to report.
  const feed = await request(app).get(`/api/rounds/${round.id}/activities`).set(auth(a.token));
  assert.equal(feed.body.filter((x) => x.type === 'games_imported').length, 0);
  assert.equal(feed.body.filter((x) => x.type === 'game_added').length, 0);
});

/* --------------- expansions on the wish list (#664) ------------------------ */

// A wishlist item that IS an expansion — carrying subtype="boardgame", because
// that is what BGG actually serves (#702): an unscoped /collection query
// includes expansions but mislabels every one of them. Shaped from a live
// capture of the operator's wishlist, 2026-08-09 (Forest Shuffle: Alpine
// arrived exactly like this). The truthful label only ever appears in the
// subtype-scoped probe body below — fixtures stamping it here encode the very
// assumption this bug lived behind.
const expansionItem = (objectid, name) => `
  <item objecttype="thing" objectid="${objectid}" subtype="boardgame" collid="c${objectid}">
    <name sortindex="1">${name}</name>
    <stats minplayers="5" maxplayers="6"/>
    <status wishlist="1"/>
  </item>`;

// The subtype=boardgameexpansion probe's answer: the same items, truthfully
// labeled, no <stats> (the probe asks for none — ids are all that matters).
const probeXml = (...entries) => collectionXml(...entries.map(([objectid, name]) => `
  <item objecttype="thing" objectid="${objectid}" subtype="boardgameexpansion" collid="c${objectid}">
    <name sortindex="1">${name}</name>
    <status wishlist="1"/>
  </item>`));

// The /thing answer for those expansions: inbound="true" is "expands X".
const PARENTS_XML = `<items>
  <item type="boardgameexpansion" id="325">
    <name type="primary" value="CATAN: Seafarers"/>
    <link type="boardgameexpansion" id="13" value="CATAN" inbound="true"/>
  </item>
  <item type="boardgameexpansion" id="4002">
    <name type="primary" value="Orphan Promo"/>
  </item>
</items>`;

const WISH_WITH_EXPANSIONS = collectionXml(
  item('13', 'CATAN'), expansionItem('325', 'CATAN: Seafarers'), expansionItem('4002', 'Orphan Promo'));
const WISH_PROBE = probeXml(['325', 'CATAN: Seafarers'], ['4002', 'Orphan Promo']);

// Route by endpoint: the wishlist path needs the main collection, the
// subtype-scoped expansion probe (#702) AND the /thing parent resolution —
// which the single-body stub above cannot express. probeStatus lets a spec fail
// exactly the probe while the main body stays healthy.
function stubBggRouted({ collection, probe = probeXml(), thing = '', probeStatus = 200 }) {
  const urls = [];
  global.fetch = async (url) => {
    const u = String(url);
    urls.push(u);
    if (!u.includes('/collection?')) return { status: 200, text: async () => thing };
    if (u.includes('subtype=boardgameexpansion')) return { status: probeStatus, text: async () => probe };
    return { status: 200, text: async () => collection };
  };
  return urls;
}

test('a wished expansion is listed with the base game it belongs to (#664)', async () => {
  const a = await makeAccount('imp-exp-list@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerExpList');

  const urls = stubBggRouted({ collection: WISH_WITH_EXPANSIONS, probe: WISH_PROBE, thing: PARENTS_XML });
  const res = await request(app)
    .get(`/api/rounds/${round.id}/lookup/collection?provider=bgg&status=wishlist`)
    .set(auth(a.token));
  assert.equal(res.status, 200);
  // The main body labels ALL THREE "boardgame" (#702) — these flags can only
  // come from membership in the probe's answer.
  assert.deepEqual(res.body.games.map((g) => g.expansion), [false, true, true]);
  assert.deepEqual(res.body.games[1].expansionOf, [{ providerId: '13', title: 'CATAN' }]);
  // BGG reported no inbound link for this one — an empty list, never a dropped
  // candidate: it is still a game the group wants.
  assert.deepEqual(res.body.games[2].expansionOf, []);
  assert.equal(res.body.games[0].expansion, false, 'a base game on the wishlist is not an expansion');
  // The mislabeled subtype also built a /boardgame/ link; membership corrects it.
  assert.equal(res.body.games[1].url, 'https://boardgamegeek.com/boardgameexpansion/325');

  // The probe went to the same wishlist, scoped to expansions.
  const probes = urls.filter((u) => u.includes('subtype=boardgameexpansion'));
  assert.equal(probes.length, 1);
  assert.match(probes[0], /wishlist=1/);

  // The parent hop asked for exactly the expansions, in ONE request.
  const thing = urls.filter((u) => u.includes('/thing?'));
  assert.equal(thing.length, 1);
  assert.equal(new URL(thing[0]).searchParams.get('id'), '325,4002');
});

test('importing a wished expansion stores its base games, resolved SERVER-side', async () => {
  const a = await makeAccount('imp-exp-write@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerExpWrite');

  stubBggRouted({ collection: WISH_WITH_EXPANSIONS, probe: WISH_PROBE, thing: PARENTS_XML });
  const res = await request(app)
    .post(`/api/rounds/${round.id}/lookup/import?provider=bgg&status=wishlist`)
    .set(auth(a.token))
    // The body names an arbitrary parent; the route must ignore it entirely, or
    // a hand-rolled request could graft a row onto any game of the round.
    .send({ externalIds: ['13', '325', '4002'], expansionOf: [{ providerId: '9999', title: 'Evil' }] });
  assert.equal(res.status, 200);
  assert.equal(res.body.imported, 3);

  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  const byTitle = Object.fromEntries(full.body.games.map((g) => [g.title, g]));
  assert.deepEqual(byTitle['CATAN: Seafarers'].expansionOf, [{ providerId: '13', title: 'CATAN' }]);
  assert.deepEqual(byTitle['Orphan Promo'].expansionOf, []);
  // The key marks a row as an expansion, so a plain wished game must not have it.
  assert.equal('expansionOf' in byTitle.CATAN, false);
  // The expansion's own range rides along — it is what widens the base game's
  // pool once the expansion is acquired.
  assert.equal(byTitle['CATAN: Seafarers'].minPlayers, 5);
  assert.equal(byTitle['CATAN: Seafarers'].maxPlayers, 6);
});

test('an expansion the round has already ACQUIRED shows as present, not as a fresh wish', async () => {
  const a = await makeAccount('imp-exp-present@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerExpPresent');

  // Catan on the shelf, with Seafarers already recorded on its row — which is
  // where an acquired expansion lives, so the plain game-level `present` check
  // cannot see it.
  const base = (await request(app).post(`/api/rounds/${round.id}/games`).set(auth(a.token))
    .field('title', 'Catan').field('minPlayers', '3').field('maxPlayers', '4')
    .field('sourceProvider', 'bgg').field('sourceExternalId', '13')).body;
  await repo.forTenant((await repo.getUserByEmail('imp-exp-present@example.com')).tenantId)
    .setGameExpansions(round.id, base.id, [{
      title: 'CATAN: Seafarers', minPlayers: 5, maxPlayers: 6,
      source: { provider: 'bgg', externalId: '325', url: null },
    }]);

  stubBggRouted({ collection: WISH_WITH_EXPANSIONS, probe: WISH_PROBE, thing: PARENTS_XML });
  const res = await request(app)
    .get(`/api/rounds/${round.id}/lookup/collection?provider=bgg&status=wishlist`)
    .set(auth(a.token));
  assert.deepEqual(res.body.games.map((g) => g.present), [true, true, false]);
});

/* THE PROBE IS HALF OF ONE FETCH (#702). A probe that fails while the main body
   succeeded must fail (or queue) the whole listing: degrading to "no expansions
   here" would recreate the very bug the probe exists to fix — a bulk import
   silently creating unmarked expansion rows — through the error path. Contrast
   the parents hop, where degrading to "no parents known" is a good answer. */
test('a failed expansion probe fails the listing rather than importing unmarked rows (#702)', async () => {
  const a = await makeAccount('imp-probe-down@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerProbeDown');

  stubBggRouted({ collection: WISH_WITH_EXPANSIONS, probe: '', probeStatus: 500, thing: PARENTS_XML });
  const list = await request(app)
    .get(`/api/rounds/${round.id}/lookup/collection?provider=bgg&status=wishlist`).set(auth(a.token));
  assert.equal(list.status, 502);
  assert.equal(list.body.error, 'provider_unreachable');

  const res = await request(app)
    .post(`/api/rounds/${round.id}/lookup/import?provider=bgg&status=wishlist`)
    .set(auth(a.token)).send({ externalIds: ['325'] });
  assert.equal(res.status, 502);

  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  assert.equal(full.body.games.length, 0, 'no unmarked expansion row may be created');
});

test('a queued probe reports queued, is not cached, and the retry marks the rows (#702)', async () => {
  const a = await makeAccount('imp-probe-queued@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerProbeQueued');
  const url = `/api/rounds/${round.id}/lookup/collection?provider=bgg&status=wishlist`;

  // Observed live 2026-08-09: the main body answered 200 while the probe 202'd.
  stubBggRouted({ collection: WISH_WITH_EXPANSIONS, probe: '', probeStatus: 202 });
  const queued = await request(app).get(url).set(auth(a.token));
  assert.equal(queued.status, 200);
  assert.equal(queued.body.state, 'queued');
  assert.deepEqual(queued.body.games, []);

  // The pair settles together: the retry re-fetches BOTH and the rows arrive
  // marked — which is exactly what caching the queued answer would prevent.
  stubBggRouted({ collection: WISH_WITH_EXPANSIONS, probe: WISH_PROBE, thing: PARENTS_XML });
  const retry = await request(app).get(url).set(auth(a.token));
  assert.equal(retry.body.state, 'ok');
  assert.deepEqual(retry.body.games.map((g) => g.expansion), [false, true, true]);
});

/* THE CACHE-KEY TRAP. The two shelves are different BGG documents for one
   handle, behind a 10-minute cache. Keyed on the handle alone, whichever import
   ran first answers the other for the rest of the window — a full, plausible,
   completely wrong list with no error anywhere.

   The two shelves here share no game at all, so a leak is unmistakable; and the
   second stub returns a DIFFERENT body, so being served the first one is the
   only way the wrong titles could appear. */
test('the owned and wishlist shelves do not share a cache entry', async () => {
  const a = await makeAccount('imp-wish-cache@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerBothShelves');

  stubBgg(collectionXml(item('13', 'CATAN')));
  const owned = await request(app)
    .get(`/api/rounds/${round.id}/lookup/collection?provider=bgg`).set(auth(a.token));
  assert.deepEqual(owned.body.games.map((g) => g.title), ['CATAN']);

  const urls = stubBggRouted({ collection: collectionXml(item('9209', 'Ticket to Ride')) });
  const wished = await request(app)
    .get(`/api/rounds/${round.id}/lookup/collection?provider=bgg&status=wishlist`).set(auth(a.token));
  assert.equal(urls.length, 2, 'the wishlist (with its expansion probe, #702) must be fetched, not served from the owned entry');
  assert.deepEqual(wished.body.games.map((g) => g.title), ['Ticket to Ride']);

  // ...and the owned shelf is still cached rather than refetched, so the key
  // gained a component instead of being defeated altogether.
  const again = stubBgg(collectionXml(item('999', 'Wrong')));
  const owned2 = await request(app)
    .get(`/api/rounds/${round.id}/lookup/collection?provider=bgg`).set(auth(a.token));
  assert.equal(again.length, 0, 'the owned shelf must still come from its own cache entry');
  assert.deepEqual(owned2.body.games.map((g) => g.title), ['CATAN']);
});

/* A game the round already holds is "present" whatever state it is in — so the
   wishlist import cannot re-add a game the group has since bought, which would
   land as a wish for something already on their own shelf. */
test('a game already on the shelf shows as present in the wishlist import and is skipped', async () => {
  const a = await makeAccount('imp-wish-present@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerPresentWish');

  // Buy it first, through the ordinary owned import.
  stubBgg(collectionXml(item('13', 'CATAN')));
  await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token)).send({ externalIds: ['13'] });

  stubBggRouted({ collection: collectionXml(item('13', 'CATAN'), item('822', 'Carcassonne')) });
  const list = await request(app)
    .get(`/api/rounds/${round.id}/lookup/collection?provider=bgg&status=wishlist`).set(auth(a.token));
  const catan = list.body.games.find((g) => g.externalId === '13');
  assert.equal(catan.present, true, 'a game already owned must show as present on the wish list');

  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg&status=wishlist`)
    .set(auth(a.token)).send({ externalIds: ['13', '822'] });
  assert.deepEqual(res.body, { imported: 1, skipped: 1 });

  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  const stored = full.body.games.find((g) => g.title === 'CATAN');
  assert.equal(stored.wish, false, 'the owned copy must stay on the shelf, not become a wish');
  assert.equal(full.body.games.find((g) => g.title === 'Carcassonne').wish, true);
});

/* An unrecognised status must fall back to the owned shelf rather than reaching
   BGG's query string: the value is interpolated into a fetched URL. */
test('an unknown status falls back to the owned shelf', async () => {
  const a = await makeAccount('imp-wish-status@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerOddStatus');

  const urls = stubBgg(THREE);
  const res = await request(app)
    .get(`/api/rounds/${round.id}/lookup/collection?provider=bgg&status=__proto__`).set(auth(a.token));
  assert.equal(res.status, 200);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /own=1/);
  assert.equal(/wishlist/.test(urls[0]), false);
  assert.equal(/__proto__/.test(urls[0]), false, 'a request value must never reach the provider URL');
});

test('the edition behind a picked import cover is stored beside it (#742)', async () => {
  const a = await makeAccount('imp-edition@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerEdition');
  stubBgg(THREE);

  const chosen = 'https://cf.geekdo-images.com/de__thumb/img/y=/fit-in/200x150/german-edition.png';
  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token))
    .send({
      externalIds: ['13', '822'],
      covers: { 13: chosen },
      editions: { 13: { name: 'Deutsche Erstausgabe', year: 2015, languages: ['German'] } },
    });
  assert.equal(res.status, 200);

  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  const byTitle = Object.fromEntries(full.body.games.map((g) => [g.title, g]));
  assert.deepEqual(byTitle.CATAN.edition, { name: 'Deutsche Erstausgabe', year: 2015, languages: ['German'] });
  // A game whose cover the user did not pick keeps the key ABSENT, exactly like
  // every other optional field on an imported row.
  assert.equal('edition' in byTitle.Carcassonne, false);
});

test('an import edition without a surviving cover is dropped, not stored alone', async () => {
  const a = await makeAccount('imp-edition-orphan@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerEditionOrphan');
  stubBgg(THREE);

  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token))
    .send({
      externalIds: ['13', '822'],
      // 13's URL is refused by the host allowlist, so the row falls back to the
      // collection's own art; 822 never had a cover choice at all. In both cases
      // an edition would name a printing that is not the box on screen.
      covers: { 13: 'https://evil.example.com/tracker.png' },
      editions: {
        13: { name: 'Deutsche Erstausgabe', languages: ['German'] },
        822: { name: 'Erweiterte Ausgabe', languages: ['German'] },
      },
    });
  assert.equal(res.status, 200);

  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  for (const g of full.body.games) {
    assert.match(g.image, /^https:\/\/cf\.geekdo-images\.com\/x__thumb\//, 'sanity: the collection cover won');
    assert.equal('edition' in g, false);
  }
});

test('the import bounds an edition exactly as a single add does', async () => {
  // One normalizer for both entry points, so the bulk path cannot accept what a
  // single add refuses (.claude/rules/shared-constants-across-the-stack.md).
  const a = await makeAccount('imp-edition-caps@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerEditionCaps');
  stubBgg(THREE);

  const chosen = 'https://cf.geekdo-images.com/de__thumb/img/y=/fit-in/200x150/german-edition.png';
  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token))
    .send({
      externalIds: ['13'],
      covers: { 13: chosen },
      editions: {
        13: {
          name: 'ä'.repeat(400),
          year: 0,
          languages: Array.from({ length: 40 }, (_, i) => `Lang${i}`),
        },
      },
    });
  assert.equal(res.status, 200);

  const full = await request(app).get(`/api/rounds/${round.id}`).set(auth(a.token));
  const catan = full.body.games.find((g) => g.title === 'CATAN');
  assert.equal(catan.edition.name.length, 200);
  assert.equal(catan.edition.year, null);
  assert.equal(catan.edition.languages.length, 12);
});

test('a malformed editions map is a 400, like every other body-shape error', async () => {
  const a = await makeAccount('imp-edition-bad@example.com');
  const round = await makeRound(a.token);
  await link(a.token, 'GamerEditionBad');
  stubBgg(THREE);

  const res = await request(app).post(`/api/rounds/${round.id}/lookup/import?provider=bgg`)
    .set(auth(a.token))
    .send({ externalIds: ['13'], editions: { 13: { languages: 'German' } } });
  assert.equal(res.status, 400);
});
