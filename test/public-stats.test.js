'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

const publicStats = require('../lib/public-stats');
const bgg = require('../lib/providers/bgg');
const scheduler = require('../lib/scheduler');
const repo = require('../lib/repo');

/*
 * Instance-wide public statistics (#564).
 *
 * THE PROVIDER IS STUBBED AT THE MODULE'S OWN `detail`, not at global.fetch.
 * What is under test here is the ranking, the thresholds and — above all — that
 * no user-authored byte reaches the payload; how BGG's XML parses is
 * test/providers-bgg.test.js's subject and has no bearing on any of that. Going
 * through fetch would mean maintaining a /thing fixture per case for no extra
 * assurance. `getProvider('bgg')` hands back this very module object, so
 * replacing the method is what the production path actually calls.
 */
const realDetail = bgg.detail;

// Every rebuild is driven explicitly; nothing here waits on the scheduler's timer.
const rebuild = (now) => publicStats.rebuild(now);

// Resolve like a healthy provider: a title nobody typed, plus a cover.
function stubProvider(byId = {}) {
  bgg.detail = async (externalId) => byId[externalId] || {
    provider: 'bgg', externalId, title: `Provider-Titel ${externalId}`,
    imageUrl: `https://cf.geekdo-images.com/${externalId}.png`,
    url: `https://boardgamegeek.com/boardgame/${externalId}`,
  };
}

const THRESHOLDS = [
  'PUBLIC_STATS_MIN_PLAYERS', 'PUBLIC_STATS_MIN_ROUNDS', 'PUBLIC_STATS_MIN_GAMES',
  'PUBLIC_STATS_MIN_SESSIONS', 'PUBLIC_STATS_MIN_SHELVES', 'PUBLIC_STATS_MIN_OWNER_TENANTS',
  'PUBLIC_STATS_MIN_PLAYS_WEEK', 'PUBLIC_STATS_MIN_PLAY_TENANTS_WEEK',
  'PUBLIC_STATS_MIN_PLAYS_MONTH', 'PUBLIC_STATS_MIN_PLAY_TENANTS_MONTH',
  'PUBLIC_STATS_MIN_PLAYS_YEAR', 'PUBLIC_STATS_MIN_PLAY_TENANTS_YEAR',
  'PUBLIC_STATS_MIN_RATINGS', 'PUBLIC_STATS_MIN_RATING_TENANTS', 'PUBLIC_STATS_RESOLVE_MAX',
];

/*
 * EVERY SEEDED ROUND IS DELETED AFTER ITS CASE, and that is load-bearing rather
 * than tidiness. The suite shares one store, and a podium is a MAXIMUM over the
 * whole instance — so a game seeded by an earlier case keeps competing for first
 * place in every later one. Left in, four cases here failed with a previous
 * case's game on the podium, and the two "this metric must be absent" cases
 * would have been satisfied by someone else's row. Deltas (the repo contract's
 * answer to the same shared store) cannot help: there is no delta of a maximum.
 */
const seeded = [];
const track = (round) => { seeded.push(round.id); return round; };

afterEach(async () => {
  bgg.detail = realDetail;
  delete process.env.PUBLIC_STATS_ENABLED;
  for (const name of THRESHOLDS) delete process.env[name];
  publicStats.resetForTests();
  while (seeded.length) await request(app).delete(`/api/rounds/${seeded.pop()}`);
});

// Lower every content floor to 1 so a small fixture can reach a podium; the
// counters keep their real defaults unless a case says otherwise.
function openContentFloors() {
  process.env.PUBLIC_STATS_MIN_SHELVES = '1';
  process.env.PUBLIC_STATS_MIN_OWNER_TENANTS = '1';
  for (const w of ['WEEK', 'MONTH', 'YEAR']) {
    process.env['PUBLIC_STATS_MIN_PLAYS_' + w] = '1';
    process.env['PUBLIC_STATS_MIN_PLAY_TENANTS_' + w] = '1';
  }
  process.env.PUBLIC_STATS_MIN_RATINGS = '1';
  process.env.PUBLIC_STATS_MIN_RATING_TENANTS = '1';
}

// One round holding one provider-linked game, played once and rated once.
// `title` is the USER-TYPED name, deliberately distinctive so the sweep below
// can look for it in the serialized payload.
async function seedPlayedGame({ externalId, title, rating = 5 }) {
  const round = track(await createRound(request, { name: 'Statistikrunde', members: ['Ann', 'Bo'] }));
  const game = (await request(app).post(`/api/rounds/${round.id}/games`).send({
    title, minPlayers: '1', maxPlayers: '4',
    sourceProvider: 'bgg', sourceExternalId: externalId,
  })).body;
  const fresh = (await request(app).get(`/api/rounds/${round.id}`)).body;
  // POST /sessions answers `{ session, … }`, not the session itself — read the
  // wrong one and every follow-up 404s while the fixture still looks fine, so
  // the case silently tests a game that was never played or rated.
  const { session } = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({
    gameIds: [game.id], memberIds: fresh.members.map((m) => m.id),
  })).body;
  const ok = async (res) => {
    assert.equal(res.status, 200, `fixture step failed: ${JSON.stringify(res.body)}`);
    return res;
  };
  await ok(await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/results`).send({
    votes: { [fresh.members[0].id]: { [game.id]: { rating } } },
  }));
  await ok(await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/choice`).send({ gameId: game.id }));
  await ok(await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/finish`).send({ finished: true, winnerIds: [] }));
  return { round, game };
}

/* ------------------------------- the gate ---------------------------------- */

/*
 * THE FLAG IS INVERTED relative to every other feature switch here: the block
 * publishes unless PUBLIC_STATS_ENABLED is exactly 'false'. That is the one
 * behaviour a spec must not establish for itself — setting the variable would
 * make these green against a flag written the wrong way round, which is the
 * defaulted-flag trap in .claude/rules/break-the-code-on-purpose.md. So the
 * first case touches nothing at all.
 */
test('the feature is LIVE with no env var set at all', async () => {
  assert.equal(process.env.PUBLIC_STATS_ENABLED, undefined, 'the spec must not set it');
  assert.equal(publicStats.publicStatsEnabled(), true, 'unset must publish, not hide');
});

test('PUBLIC_STATS_ENABLED=false is the kill switch: 404, and no provider call', async () => {
  let calls = 0;
  bgg.detail = async () => { calls += 1; return null; };
  process.env.PUBLIC_STATS_ENABLED = 'false';

  assert.equal(publicStats.publicStatsEnabled(), false);
  assert.equal(await scheduler.runJob('rebuildPublicStats'), null, 'the job is disabled, so it does not run');
  assert.equal(await rebuild(), null);
  assert.equal(calls, 0, 'a disabled instance must make NO provider request at all');

  const res = await request(app).get('/api/stats/public');
  assert.equal(res.status, 404);
});

test('only the literal "false" turns it off — a typo must not silently hide it', async () => {
  // The inverse of the usual opt-in guard, and it matters more in this
  // direction: a mistyped 'FALSE' that read as off would take a public page
  // down with nothing to indicate why.
  for (const value of ['0', 'no', 'FALSE', 'off', '', 'true']) {
    process.env.PUBLIC_STATS_ENABLED = value;
    assert.equal(publicStats.publicStatsEnabled(), true, `"${value}" must not disable it`);
  }
});

test('switching the feature off drops an already-built payload', async () => {
  process.env.PUBLIC_STATS_MIN_ROUNDS = '0';
  stubProvider();
  await rebuild();
  assert.ok(publicStats.publicStats(), 'built while on');

  process.env.PUBLIC_STATS_ENABLED = 'false';
  assert.equal(publicStats.publicStats(), null, 'and gone the moment it is switched off');
  assert.equal((await request(app).get('/api/stats/public')).status, 404);
});

/* ----------------------------- the payload --------------------------------- */

test('the podium names the game from the PROVIDER, never from the typed title', async () => {
  openContentFloors();
  const externalId = 'thing-provider-name';
  stubProvider();
  await seedPlayedGame({ externalId, title: 'MEIN GETIPPTER TITEL' });

  const built = await rebuild();
  assert.ok(built.games, 'the podium block is present');
  assert.equal(built.games.mostOwned.title, `Provider-Titel ${externalId}`);

  // The generic sweep: serialize the WHOLE payload and assert the user-authored
  // string is absent anywhere in it. Written this way — rather than checking the
  // one field — so a field added later that echoes user text fails here without
  // anyone remembering this test exists (the shape test/status.test.js uses for
  // secrets).
  assert.ok(!JSON.stringify(built).includes('MEIN GETIPPTER TITEL'));

  const res = await request(app).get('/api/stats/public');
  assert.equal(res.status, 200);
  assert.ok(!JSON.stringify(res.body).includes('MEIN GETIPPTER TITEL'));
  assert.equal(res.body.games.mostOwned.title, `Provider-Titel ${externalId}`);
});

test('the route serves the CACHED payload and never resolves per request', async () => {
  openContentFloors();
  stubProvider();
  await seedPlayedGame({ externalId: 'thing-cached', title: 'Gecacht' });
  await rebuild();

  let calls = 0;
  bgg.detail = async () => { calls += 1; return null; };
  const res = await request(app).get('/api/stats/public');
  assert.equal(res.status, 200);
  assert.ok(res.body.games.mostOwned);
  assert.equal(calls, 0, 'serving the payload must not touch a provider');
});

test('the games counter follows the SHELF: a wish moves it not at all', async () => {
  process.env.PUBLIC_STATS_MIN_GAMES = '0';
  stubProvider();
  const round = track(await createRound(request, { name: 'Zählrunde', members: ['Ann'] }));
  const add = async (over) => request(app).post(`/api/rounds/${round.id}/games`)
    .send({ title: 'Zähl mich', minPlayers: '1', maxPlayers: '4', ...over });

  const before = (await rebuild()).counters.games;
  await add({});
  const withShelfGame = (await rebuild()).counters.games;
  assert.equal(withShelfGame, before + 1, 'a shelf game moves the counter');

  // A wish is a game the round does NOT own, and an archived one is not out on
  // the table — neither belongs in a public "how many games" figure. Asserted as
  // deltas because the counter is instance-wide and the suite shares a store.
  await add({ wish: 'true' });
  const withWish = (await rebuild()).counters.games;
  assert.equal(withWish, withShelfGame, 'a wish must not move it');

  const shelfGame = (await request(app).get(`/api/rounds/${round.id}`)).body.games
    .find((g) => g.wish !== true);
  await request(app).post(`/api/rounds/${round.id}/games/${shelfGame.id}/retire`).send({ retired: true });
  assert.equal((await rebuild()).counters.games, before, 'retiring takes it back off');
});

test('most-owned needs several ACCOUNTS, not one account with several rounds', async () => {
  /*
   * The anti-skew control. `shelves` is what the card displays and a family
   * running three rounds really is on three shelves — but the podium is gated on
   * distinct accounts, so that family cannot put a game there by itself.
   */
  stubProvider();
  openContentFloors();
  process.env.PUBLIC_STATS_MIN_OWNER_TENANTS = '2';
  const externalId = 'thing-skew';
  const bggGame = { title: 'Geklont', minPlayers: '1', maxPlayers: '4', sourceProvider: 'bgg', sourceExternalId: externalId };

  // One account, two rounds, same game: two shelves, one owner.
  for (const name of ['Runde A', 'Runde B']) {
    const r = track(await createRound(request, { name, members: ['Ann'] }));
    await request(app).post(`/api/rounds/${r.id}/games`).send(bggGame);
  }
  const rows = await repo.publicGameAggregates();
  const row = rows.find((x) => x.externalId === externalId);
  assert.equal(row.shelves, 2, 'it really is on two shelves');
  assert.equal(row.owners, 1, 'but one account owns both');

  const built = await rebuild();
  // Coerced: `built.games` is ABSENT (undefined) when nothing qualifies, and
  // assert/strict rejects undefined against false.
  assert.equal(!!(built.games && 'mostOwned' in built.games), false,
    'one account must not reach the podium however many rounds it clones');

  // Drop the account floor and the very same data qualifies — so the assertion
  // above is about the gate, not about the fixture being too small.
  process.env.PUBLIC_STATS_MIN_OWNER_TENANTS = '1';
  assert.equal((await rebuild()).games.mostOwned.shelves, 2);
});

/* ---------------------------- the thresholds -------------------------------- */

test('a metric below its threshold is ABSENT — not a zero, not an empty row', async () => {
  openContentFloors();
  stubProvider();
  await seedPlayedGame({ externalId: 'thing-threshold', title: 'Unterschwellig' });

  // It sits on one shelf, so a floor of 2 shelves must remove exactly that
  // metric while the play metrics (floor 1) survive.
  process.env.PUBLIC_STATS_MIN_SHELVES = '2';
  const built = await rebuild();
  assert.equal('mostOwned' in built.games, false, 'absent, rather than a zero');
  assert.ok(built.games.playedWeek, 'the sibling metrics are unaffected');
});

test('raising a threshold removes the metric on the next rebuild — no restart', async () => {
  openContentFloors();
  stubProvider();
  await seedPlayedGame({ externalId: 'thing-retune', title: 'Nachjustiert' });

  assert.ok((await rebuild()).games.playedWeek, 'published at the low floor');
  // A live re-tune: the ceilings are read per call, so no deploy and no restart.
  process.env.PUBLIC_STATS_MIN_PLAYS_WEEK = '99';
  assert.equal('playedWeek' in ((await rebuild()).games || {}), false);
});

test('a floor of 0 is honoured, not swallowed back to the default', async () => {
  // The `Number(x) || DEFAULT` idiom would silently restore the default here,
  // and an operator would see no change and no error.
  openContentFloors();
  process.env.PUBLIC_STATS_MIN_ROUNDS = '0';
  process.env.PUBLIC_STATS_MIN_ROUNDS = '0';
  stubProvider();
  const built = await rebuild();
  assert.ok(built.counters, 'a zero floor publishes the counter whatever it says');
  assert.equal(typeof built.counters.rounds, 'number');
});

test('with every metric below its threshold the payload carries NO block at all', async () => {
  stubProvider();
  await seedPlayedGame({ externalId: 'thing-all-dark', title: 'Alles dunkel' });
  // The shipped counter defaults are far above a test fixture, and the content
  // floors are left at their defaults too.
  const built = await rebuild();
  assert.equal('counters' in built, false);
  assert.equal('games' in built, false);
  assert.deepEqual(Object.keys(built), ['generatedAt'], 'nothing for the client to render');
});

/* --------------------------- provider degradation --------------------------- */

test('a provider outage degrades to fewer entries; the counters still render', async () => {
  openContentFloors();
  process.env.PUBLIC_STATS_MIN_ROUNDS = '0';
  stubProvider();
  await seedPlayedGame({ externalId: 'thing-outage', title: 'Ausfall' });

  bgg.detail = async () => { throw new Error('upstream down'); };
  const built = await rebuild();
  assert.equal('games' in built, false, 'no podium can be named');
  assert.ok(built.counters, 'but the page still has something to render');
});

test('an unset BGG_API_TOKEN (a nameless answer) is not cached as the answer', async () => {
  openContentFloors();
  // What detail() returns with no token: the null-shaped product.
  bgg.detail = async (externalId) => ({ provider: 'bgg', externalId, title: null, imageUrl: null, url: null });
  await seedPlayedGame({ externalId: 'thing-token', title: 'Ohne Token' });
  assert.equal('games' in (await rebuild()), false);

  // The token comes back. A memoized "no name" would make the outage permanent
  // for the life of the process; the next rebuild must recover on its own.
  stubProvider();
  assert.ok((await rebuild()).games.mostOwned, 'recovers without a restart');
});

test('a game whose provider has left the registry can never reach a podium', async () => {
  // A storefront-linked game from before #744: the row still exists and is still
  // owned, but no module can name it, so it must not occupy a podium place.
  openContentFloors();
  stubProvider();
  const round = track(await createRound(request, { name: 'Altlast', members: ['Ann'] }));
  await request(app).post(`/api/rounds/${round.id}/games`).send({
    title: 'Retiriertes Storefront-Spiel', minPlayers: '1', maxPlayers: '4',
  });
  // Write the retired provider link straight into the store — the route refuses
  // an unknown provider now, which is exactly why such rows can only be legacy.
  const store = require('../lib/store');
  const stored = store.findRound(round.id);
  stored.games[0].source = { provider: 'psstore', externalId: 'EP0006-TEST_00-0', url: null };
  store.saveData();

  const built = await rebuild();
  assert.equal('games' in built, false, 'an unnameable game occupies no podium');
});

test('the runner-up is published when the leader cannot be resolved', async () => {
  openContentFloors();
  // The leader is owned twice, the runner-up once — so ranking is unambiguous
  // and independent of anything the provider says.
  await seedPlayedGame({ externalId: 'thing-leader', title: 'Anführer' });
  await seedPlayedGame({ externalId: 'thing-leader', title: 'Anführer nochmal' });
  await seedPlayedGame({ externalId: 'thing-runner', title: 'Zweiter' });

  stubProvider({ 'thing-leader': { provider: 'bgg', externalId: 'thing-leader', title: null } });
  const built = await rebuild();
  assert.equal(built.games.mostOwned.title, 'Provider-Titel thing-runner');
});

/* ------------------------------ the scheduler ------------------------------- */

test('the scheduler job rebuilds the payload when the feature is on', async () => {
  process.env.PUBLIC_STATS_MIN_ROUNDS = '0';
  stubProvider();
  assert.equal(publicStats.publicStats(), null, 'nothing built yet');
  const built = await scheduler.runJob('rebuildPublicStats');
  assert.ok(built, 'the job returns what it built');
  assert.ok(publicStats.publicStats(), 'and the route can now serve it');
});
