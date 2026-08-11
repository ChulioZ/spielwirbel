'use strict';

/*
 * BGG weight (#717) and the standard metadata (#724): the create-time
 * resolution, the two lazy
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
  weight: null, minPlaytime: null, maxPlaytime: null,
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

test('POST games with a BGG source stores the metadata, resolved server-side', async () => {
  const rid = await makeRound('Info-Create');
  stubFetch([{ id: '900001', weight: '2.2809', desc: 'Handel &amp; Bau.' }]);
  const res = await request(app).post(`/api/rounds/${rid}/games`).send({
    title: 'Catan', minPlayers: 3, maxPlayers: 4, ...bggSource('900001'),
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.weight, 2.2809);
  assert.equal(typeof res.body.providerInfoAt, 'string');
});

test('a client cannot dictate the provider fields on create', async () => {
  const rid = await makeRound('Info-Trust');
  // No provider link -> no resolution runs; the client-sent fields are ignored.
  const res = await request(app).post(`/api/rounds/${rid}/games`).send({
    title: 'Selbstgebaut', minPlayers: 2, maxPlayers: 4,
    weight: 4.9, rating: 9.9, categories: ['Attacker-controlled'],
  });
  assert.equal(res.status, 201);
  assert.equal('weight' in res.body, false);
  assert.equal('rating' in res.body, false);
  assert.equal('categories' in res.body, false);
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
  assert.deepEqual(res.body, infoBody({ weight: 3.5 }));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /stats=1/);

  // Persisted: the round read now carries the fields.
  const stored = (await repo.getRound('default', rid)).games.find((g) => g.id === game.id);
  assert.equal(stored.weight, 3.5);

  // A second open answers from the store — no further upstream request.
  const again = await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.deepEqual(again.body, infoBody({ weight: 3.5 }));
  assert.equal(calls.length, 1);
});

test('a game BGG has no data for is stamped and not re-fetched on every view', async () => {
  const rid = await makeRound('Info-NoData');
  const game = await repo.createGame('default', rid, {
    title: 'Obskur', minPlayers: 2, maxPlayers: 4, image: null,
    source: { provider: 'bgg', externalId: '900003', url: null },
  });
  const calls = stubFetch([{ id: '900003' }]); // averageweight=0, nothing else

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
  assert.deepEqual(retry.body, infoBody({ weight: 1.8 }));
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
   * old {weight} shape and every game the #717 backfill already
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
    weight: 2.5,
  });
  const calls = stubFetch([{
    id: '900012', weight: '2.5', desc: 'Bereits da.',
    playtime: [45, 75], age: 12, cats: ['Economic'], mechs: ['Worker Placement', 'Trading'],
  }]);

  const res = await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.equal(calls.length, 1, 'a game with only the old fields was treated as complete');
  assert.deepEqual(res.body, infoBody({
    weight: 2.5, minPlaytime: 45, maxPlaytime: 75,
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
    weight: 2.5, minPlaytime: 45, maxPlaytime: 75, minAge: 12,
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
    weight: 3.2, providerInfoAt: new Date().toISOString(),
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
  stubFetch([{
    id: '900008', weight: '2.9', desc: 'Verlinkt.',
    playtime: [45, 75], age: 12, cats: ['Economic'], mechs: ['Trading'],
  }]);
  const res = await request(app).patch(`/api/rounds/${rid}/games/${game.id}`).send({
    ...bggSource('900008'),
    applyWeight: true,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.weight, 2.9);
  // The provider body carries a <description>; #729 means it lands nowhere.
  assert.equal('description' in res.body, false);

  // The UNCHIPPED #724 fields land regardless of the chips, and that is not
  // symmetry — this handler stamps providerInfoAt, which suppresses the lazy
  // backfill for a whole TTL. Leave them out and the user who just asked for
  // BGG's data waits a week for most of it.
  assert.equal(res.body.minPlaytime, 45);
  assert.equal(res.body.maxPlaytime, 75);
  assert.equal(res.body.minAge, 12);
  assert.deepEqual(res.body.categories, ['Economic']);
  assert.deepEqual(res.body.mechanics, ['Trading']);
  assert.equal(res.body.rating, 7.0);
  assert.equal(typeof res.body.providerInfoAt, 'string');

  // A provider that answers with nothing writes NO key — updateGame
  // Object.assigns the patch verbatim, so without the accretion guards this path
  // would store `categories: []` and a wall of nulls on the row, splitting
  // absent-key parity between the two backends.
  const bare = await repo.createGame('default', rid, {
    title: 'Karg', minPlayers: 2, maxPlayers: 4, image: null, source: null,
  });
  stubFetch([{ id: '900014' }]); // no playtime, no age, no links, weight 0
  const empty = await request(app).patch(`/api/rounds/${rid}/games/${bare.id}`).send({
    ...bggSource('900014'), applyWeight: true,
  });
  assert.equal(empty.status, 200);
  for (const key of ['weight', 'minPlaytime', 'maxPlaytime', 'minAge', 'categories', 'mechanics']) {
    assert.equal(key in empty.body, false, `${key} written from an empty provider answer`);
  }

  // And the values themselves cannot be dictated: a PATCH carrying literals
  // changes nothing without the resolved link.
  const forged = await request(app).patch(`/api/rounds/${rid}/games/${game.id}`).send({
    weight: 5, rating: 9.9,
  });
  assert.equal(forged.status, 200);
  // Asserted as "the resolved values are UNCHANGED" rather than "the key is
  // absent": this game was linked by the successful PATCH above, so it really
  // does carry both fields — an absence check would be vacuously false here.
  assert.equal(forged.body.weight, 2.9, 'a client literal overwrote the resolved weight');
  assert.equal(forged.body.rating, 7.0, 'a client literal overwrote the resolved rating');
});

/* --- #729: the description is not imported, stored, served or projected ----
 *
 * Written before the removal (Route 1, .claude/rules/break-the-code-on-purpose.md).
 * Every stub body below deliberately CARRIES a <description>, so each assertion
 * discriminates "the field was dropped" from "the provider never sent one".
 */

test('a BGG add stores no description, though the provider body carries one', async () => {
  const rid = await makeRound('Kein-Text-Create');
  stubFetch([{ id: '900020', weight: '2.5', desc: 'Verlagstext.', playtime: [45, 90] }]);
  const res = await request(app).post(`/api/rounds/${rid}/games`).send({
    title: 'Neu', minPlayers: 2, maxPlayers: 4, ...bggSource('900020'),
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.weight, 2.5, 'the rest of the import still lands');
  assert.equal('description' in res.body, false, 'the description was stored on create');

  const stored = await repo.getGame('default', rid, res.body.id);
  assert.equal('description' in stored, false, 'the description reached the store');
  assert.doesNotMatch(JSON.stringify(stored), /Verlagstext/, 'the prose landed under some other key');
});

test('GET provider-info answers no description key', async () => {
  const rid = await makeRound('Kein-Text-Info');
  const game = await repo.createGame('default', rid, {
    title: 'Alt', minPlayers: 2, maxPlayers: 4, image: null,
    source: { provider: 'bgg', externalId: '900021', url: null },
  });
  stubFetch([{ id: '900021', weight: '1.8', desc: 'Auch Text.', age: 10 }]);
  const res = await request(app).get(`/api/rounds/${rid}/games/${game.id}/provider-info`);
  assert.equal(res.status, 200);
  assert.equal(res.body.weight, 1.8, 'the backfill still ran');
  assert.equal('description' in res.body, false, 'the response still carries a description key');
});

test('the vote-link ballot carries no description key', async () => {
  const rid = await makeRound('Kein-Text-Ballot');
  // Stored on the row on purpose: a game whose row predates the removal still
  // HOLDS the text (no purge — CLAUDE.md), so this proves the projection drops
  // it rather than that there was nothing to drop.
  await repo.createGame('default', rid, {
    title: 'Vier', minPlayers: 1, maxPlayers: 6, image: null,
    source: { provider: 'bgg', externalId: '900022', url: null },
    weight: 3.2, description: 'Alter Ballot-Text.', providerInfoAt: new Date().toISOString(),
  });
  stubFetch([]);
  const start = await request(app).post(`/api/rounds/${rid}/sessions`).send({ count: 1 });
  const mint = await request(app)
    .post(`/api/rounds/${rid}/sessions/${start.body.session.id}/vote-link`).send({});
  const ballot = await request(app).get(`/api/vote/${mint.body.token}`);
  assert.equal(ballot.status, 200);
  const [g] = ballot.body.games;
  assert.equal(g.weight, 3.2, 'the rest of the projection still lands');
  assert.equal('description' in g, false, 'the ballot still projects the description');
  assert.doesNotMatch(JSON.stringify(ballot.body), /Ballot-Text/, 'the prose leaked elsewhere in the ballot');
});

test('a game with weight and the #724 fields is COMPLETE — no weekly re-ask for a field nobody writes', () => {
  /* The silent trap this whole removal has to avoid (#724's rule file calls it
   * the mirror-image break): a field left in the completeness check that nothing
   * writes can never be satisfied, so every game re-asks BGG once per TTL
   * forever — no error, no red test, just a standing upstream request per game
   * per week against a provider whose terms ask for few. Asserted directly
   * because the failure is invisible from any route-level spec. */
  const { needsProviderInfo } = require('../lib/provider-info');
  const complete = {
    source: { provider: 'bgg', externalId: '13' },
    weight: 2.28, minPlaytime: 60, maxPlaytime: 120, minAge: 10,
    categories: ['Economic'], mechanics: ['Trading'], rating: 7.09,
  };
  assert.equal(needsProviderInfo(complete), false, 'a fully-filled game still asks the provider');
  // The control: still incomplete when a field that IS written is missing, so
  // the assertion above cannot pass by the check having been gutted.
  assert.equal(needsProviderInfo({ ...complete, minAge: null }), true);
});

test('a stale client still sending applyDescription writes nothing', async () => {
  /* The shell is cache-first, so a tab opened before this deploy keeps running
   * the old JS and keeps sending the flag. It must be inert rather than
   * resurrect the field — and the link itself must still apply, or the stale tab
   * silently stops being able to link a provider at all. */
  const rid = await makeRound('Kein-Text-Stale');
  const game = await repo.createGame('default', rid, {
    title: 'Unverlinkt', minPlayers: 2, maxPlayers: 4, image: null, source: null,
  });
  stubFetch([{ id: '900023', weight: '2.9', desc: 'Verlagstext.', age: 12 }]);
  const res = await request(app).patch(`/api/rounds/${rid}/games/${game.id}`).send({
    ...bggSource('900023'), applyWeight: true, applyDescription: true,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.weight, 2.9, 'the rest of the old body still works');
  assert.equal('description' in res.body, false, 'a stale flag resurrected the field');

  const stored = await repo.getGame('default', rid, game.id);
  assert.equal('description' in stored, false, 'a stale flag reached the store');
});

/* ------------------- The shelf-wide backfill's bounds (#736) --------------- */

/* bgg.gameInfo() caps the ids it will ever ask about, and until #736 the write
 * loop stamped `providerInfoAt` on EVERY eligible game regardless — so a game
 * past the cap was recorded as "asked, BGG had nothing" without having been
 * asked, and was suppressed for the full 7-day TTL. Driven against
 * backfillProviderInfo directly rather than through a route: the defect needs
 * more games than the cap, and 300+ HTTP round-trips would dominate the suite. */

const { backfillProviderInfo } = require('../lib/provider-info');

// A repo stub that records which games were written, so a spec can assert on the
// set that got stamped rather than on the store's contents.
const recordingRepo = () => {
  const stamped = [];
  return { stamped, setGameProviderInfo: async (rid, gid) => { stamped.push(gid); } };
};

// `n` provider-linked games, none of them filled, so all are eligible.
const unfilledGames = (n, base) =>
  Array.from({ length: n }, (_, i) => ({
    id: `g${base + i}`,
    source: { provider: 'bgg', externalId: String(base + i), url: null },
  }));

test('the backfill stamps only the games it actually asked about', async () => {
  // 305 > bgg.gameInfo's 300-id ceiling, so five games cannot have been asked
  // about however many batches it issues.
  const games = unfilledGames(305, 910000);
  const repoStub = recordingRepo();
  const calls = stubFetch([]); // a healthy answer that names no game
  await backfillProviderInfo(repoStub, 'r-bound', games);

  assert.equal(calls.length, 5, 'five batches of 60 is the provider ceiling');
  assert.equal(repoStub.stamped.length, 300,
    'a game past the provider ceiling was stamped without ever being asked about');
  // Named explicitly: the five that must be untouched are the TAIL, so the next
  // trigger picks them up rather than skipping them for the whole TTL.
  assert.deepEqual(repoStub.stamped.slice(-1), ['g910299']);
});

test('one batch is all the shelf-wide trigger spends per call', async () => {
  const games = unfilledGames(150, 920000);
  const repoStub = recordingRepo();
  const calls = stubFetch([]);
  await backfillProviderInfo(repoStub, 'r-one', games, { maxBatches: 1 });

  assert.equal(calls.length, 1, 'a screen open must cost exactly one upstream request');
  assert.equal(repoStub.stamped.length, 60, 'only the asked batch may be stamped');
});
