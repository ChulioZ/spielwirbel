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

/* Two provider-linked games rated by three people in one session, so a case can
   choose the exact vote spread it needs. `seedPlayedGame` above cannot: it casts
   ONE vote, and the whole point of the score is what happens when several
   disagree. */
async function seedRatedPair({ a, b, votesA, votesB }) {
  const round = track(await createRound(request, { name: 'Wertungsrunde', members: ['Ann', 'Bo', 'Cy'] }));
  const mk = async (externalId, title) => (await request(app).post(`/api/rounds/${round.id}/games`).send({
    title, minPlayers: '1', maxPlayers: '4',
    sourceProvider: 'bgg', sourceExternalId: externalId,
  })).body;
  const gA = await mk(a, 'Getippt A');
  const gB = await mk(b, 'Getippt B');
  const fresh = (await request(app).get(`/api/rounds/${round.id}`)).body;
  const { session } = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({
    gameIds: [gA.id, gB.id], memberIds: fresh.members.map((m) => m.id),
  })).body;
  const votes = {};
  fresh.members.forEach((m, i) => {
    votes[m.id] = { [gA.id]: { rating: votesA[i] }, [gB.id]: { rating: votesB[i] } };
  });
  const res = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/results`).send({ votes });
  assert.equal(res.status, 200, `fixture step failed: ${JSON.stringify(res.body)}`);
  return { round, gA, gB };
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

/* ----------------------------- the score ----------------------------------- */

/* The two vote spreads have the SAME raw arithmetic mean (11/3), which is what
   makes this fixture discriminating: under the mean the two games tie and the
   winner is whichever the sort happened to reach first, so a spec asserting a
   winner would have been a coin flip that passed. Under the Spielwirbel-Score
   the veto is decisive — (5+5−5)/3 = 1,67 against (4+4+3)/3 = 3,67, and since
   #928 both are then shrunk toward the neutral prior: 2,4 against 3,3. */
test('the podium ranks on the score, so a veto loses to a game nobody objects to', async () => {
  openContentFloors();
  stubProvider();
  await seedRatedPair({
    a: 'thing-veto', b: 'thing-content', votesA: [5, 5, 1], votesB: [4, 4, 3],
  });

  const built = await rebuild();
  assert.equal(built.games.bestRated.title, 'Provider-Titel thing-content');
  assert.equal(built.games.bestRated.score, 3.3);
  assert.equal(built.games.bestRated.ratings, 3);
});

/* #928's acceptance criterion for this surface, and the bug it names: until then
   `/entdecken` and the Regal printed the same label on the same 0–5 ring for two
   different quantities. This podium applied the raw curve — no prior, no
   shrinkage, no play lift — so five votes that were all 5s (5,0) beat any amount
   of evidence averaging less, however deep.

   The fixture is the smallest thing that can show it: three unanimous 5s against
   a much larger body of 4s and 5s averaging 4,5. Unshrunk the thin game wins by
   half a point; shrunk toward the neutral prior it loses, because three votes
   buy only three sevenths of a say and twelve buy twelve sixteenths.

   `PUBLIC_STATS_MIN_RATINGS` is lowered to 1 by `openContentFloors`, on purpose:
   with the shipped floor of 5 the thin game would be excluded before it could
   lose, and the case would pass without the shrinkage doing anything. What is
   under test is the SCORE, not the floor. */
test('#928 deep evidence outranks a thin unanimous verdict — the podium is shrunk', async () => {
  openContentFloors();
  stubProvider();
  const round = track(await createRound(request, {
    name: 'Tiefe', members: ['Ann', 'Bo', 'Cy'],
  }));
  const mk = async (externalId) => (await request(app).post(`/api/rounds/${round.id}/games`).send({
    title: 'Getippt', minPlayers: '1', maxPlayers: '4',
    sourceProvider: 'bgg', sourceExternalId: externalId,
  })).body;
  const thin = await mk('thing-thin');
  const deep = await mk('thing-deep');
  const ids = (await request(app).get(`/api/rounds/${round.id}`)).body.members.map((m) => m.id);

  // `count: 2` draws the whole two-game shelf, so every vote below is cast on a
  // game the session really holds. POST /sessions takes no explicit game list —
  // it DRAWS — which is why passing one is not an option here.
  const votingSession = async (votesFor) => {
    const { session } = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({
      count: 2, memberIds: ids,
    })).body;
    const res = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/results`)
      .send({ votes: Object.fromEntries(ids.map((id, i) => [id, votesFor(i)])) });
    assert.equal(res.status, 200, `fixture step failed: ${JSON.stringify(res.body)}`);
  };
  // Three unanimous 5s for the thin game, cast once…
  await votingSession(() => ({ [thin.id]: { rating: 5 } }));
  // …against twelve votes on the deep game averaging 4,5.
  for (const spread of [[5, 4, 5], [4, 5, 4], [5, 4, 5], [4, 5, 4]]) {
    await votingSession((i) => ({ [deep.id]: { rating: spread[i] } }));
  }

  const built = await rebuild();
  assert.equal(built.games.bestRated.ratings, 12, 'the deep game won');
  assert.equal(built.games.bestRated.title, 'Provider-Titel thing-deep');
  // 12 votes at Ø 4,5 shrink to 4,1; 3 votes at 5,0 shrink to 3,9. Unshrunk the
  // order is 5,0 against 4,5 — i.e. exactly reversed, which is what makes the
  // winner here evidence about the shrinkage rather than about the fixture.
  assert.equal(built.games.bestRated.score, 4.1);
});

/* Five vetoes score −5, and a negative on a public front door reads as a broken
   app rather than as a bad game — every other surface clamps for display, so
   this one must too (core.js's `displayScore`).

   Both games here are disliked, so the winner is genuinely below the floor: the
   raw mean would publish 1,0 and the score publishes the clamped 0,0. Ranking
   stays UNCLAMPED, which is what keeps `thing-bad` (−5) above `thing-worse`
   (−6) — two floored games must still sort, or the podium would name whichever
   the aggregate happened to reach first. */
test('a published score is clamped at the display floor, but the RANKING is not', async () => {
  openContentFloors();
  stubProvider();
  await seedRatedPair({
    a: 'thing-bad', b: 'thing-worse', votesA: [1, 1, 1], votesB: [0, 0, 0],
  });

  const built = await rebuild();
  assert.equal(built.games.bestRated.title, 'Provider-Titel thing-bad', 'the floor decided the ranking');
  assert.equal(built.games.bestRated.score, 0, 'a negative reached the public payload');
});

/* THE CURVE HAS ONE HOME (#914). The repo aggregate reports a per-tile histogram
   and never a score, precisely so the six tunable TILE_VALUE numbers are not
   hand-restated in SQL that cannot require() them — a restatement would freeze
   the public podium on the old curve the first time anybody retunes.
   
   Retuning the table in place is the only assertion that can see this: it moves
   with the shared module or it does not move at all. A spec pinning a literal
   score would pass just as well against a SQL copy.
   
   For the POSTGRES half specifically this composes with the repo contract, which
   asserts both backends bin the same votes into the same tiles — the score is
   then computed from those tiles in JS, here, by the code under test. */
test('retuning TILE_VALUE moves the published score — the curve is not restated in the aggregate', async () => {
  openContentFloors();
  stubProvider();
  await seedRatedPair({
    a: 'thing-tuned', b: 'thing-quiet', votesA: [5, 5, 1], votesB: [1, 1, 1],
  });
  const { TILE_VALUE } = require('../public/js/vote-score');
  const original = TILE_VALUE.slice();

  assert.equal((await rebuild()).games.bestRated.score, 2.4, 'the shipped curve');

  try {
    // Forgive the veto entirely: `{5,5,1}` becomes the raw mean again.
    TILE_VALUE[1] = 1;
    assert.equal((await rebuild()).games.bestRated.score, 3.3, 'the podium did not follow the retune');
  } finally {
    original.forEach((v, i) => { TILE_VALUE[i] = v; });
  }
  assert.equal((await rebuild()).games.bestRated.score, 2.4, 'the retune leaked out of the case');
});

/* THE PODIUM MAY NOT CROWN AN UNRATED GAME — a regression #928 introduced and
   this case closes.

   Until #928 the `bestRated` gate rested on `ratingScore(r) !== null`, which was
   sufficient because the raw curve has nothing to say about a row with no votes.
   Shrinkage broke that: `shelfScore` answers a played-but-unrated game with its
   lifted prior on purpose (it is what gives a direct-pick round a ranked shelf),
   so the null test stopped excluding anything.

   THE FLOORS ARE SET TO 0 HERE, and that is the whole case rather than an
   artifact of it. `openContentFloors` uses 1, which hides this — a game with no
   ratings has `ratings.count` 0 and `ratings.tenants` 0, so any floor above zero
   excludes it for the wrong reason and the case would pass against the bug.
   `threshold`'s own comment names 0 as a meaningful operator setting, so this is
   a reachable state and not a contrivance.

   The fixture pairs the unrated game with a POORLY rated one: the podium has to
   still name something, and it has to be the rated game. Asserting only "the
   unrated game is absent" would be satisfied by a build that published no
   podium at all. */
test('#928 a game with no ratings can never take the best-rated podium', async () => {
  openContentFloors();
  process.env.PUBLIC_STATS_MIN_RATINGS = '0';
  process.env.PUBLIC_STATS_MIN_RATING_TENANTS = '0';
  stubProvider();
  const round = track(await createRound(request, { name: 'Ungewertet', members: ['Ann'] }));
  const mk = async (externalId) => (await request(app).post(`/api/rounds/${round.id}/games`).send({
    title: 'Getippt', minPlayers: '1', maxPlayers: '4',
    sourceProvider: 'bgg', sourceExternalId: externalId,
  })).body;
  const unrated = await mk('thing-unrated');
  const meh = await mk('thing-meh');
  const ids = (await request(app).get(`/api/rounds/${round.id}`)).body.members.map((m) => m.id);
  const ok = async (res) => {
    assert.equal(res.status, 200, `fixture step failed: ${JSON.stringify(res.body)}`);
    return res;
  };

  // The unrated game is played twice and never rated — a direct-pick evening,
  // which writes `votes: {}` and can never collect a rating afterwards. Its
  // shelf score is the lifted prior, ~3,7, i.e. ABOVE the rated game below.
  for (let i = 0; i < 2; i += 1) {
    const s = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({
      gameId: unrated.id, memberIds: ids,
    })).body.session;
    await ok(await request(app).post(`/api/rounds/${round.id}/sessions/${s.id}/finish`).send({
      finished: true, winnerIds: [],
    }));
  }
  // The rated game gets one middling vote, scoring 3,0 — deliberately lower, so
  // a podium that admitted the unrated game would rank it FIRST and the title
  // assertion below is what catches it.
  const { session } = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({
    count: 2, memberIds: ids,
  })).body;
  await ok(await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/results`).send({
    votes: { [ids[0]]: { [meh.id]: { rating: 3 } } },
  }));

  const built = await rebuild();
  assert.equal(built.games.bestRated.title, 'Provider-Titel thing-meh',
    'an unrated game outranked a rated one on the best-rated podium');
  assert.equal(built.games.bestRated.ratings, 1);
});

/* THE PLAY LIFT REACHES THIS PODIUM TOO (#928), which is the half of the parity
   that needed a new column: the aggregate carried only `plays7/30/365`, and the
   lift is a fact about a game over its whole life, so `publicGameAggregates`
   grew an all-time count in both backends for it.

   The fixture is built so the two candidate implementations pick DIFFERENT
   winners rather than the same winner by different arithmetic. `thing-quiet` is
   rated better ({4,4,4} against {3,3,3}) and never played; `thing-staple` is
   rated worse and was put on the table six times. Shrinkage alone crowns the
   quiet game at 3,4; with the lift the staple takes it at 3,9. So a podium that
   shrank correctly but ignored plays would fail on the TITLE, not merely on a
   decimal.

   Not asserted via `seedRatedPair`, which never finishes a session — a play is a
   finished session with a chosen game, so the plays have to be real ones. */
test('#928 plays lift the published score, using the all-time count', async () => {
  openContentFloors();
  stubProvider();
  const round = track(await createRound(request, {
    name: 'Stapelrunde', members: ['Ann', 'Bo', 'Cy'],
  }));
  const mk = async (externalId) => (await request(app).post(`/api/rounds/${round.id}/games`).send({
    title: 'Getippt', minPlayers: '1', maxPlayers: '4',
    sourceProvider: 'bgg', sourceExternalId: externalId,
  })).body;
  const quiet = await mk('thing-quiet');
  const staple = await mk('thing-staple');
  const ids = (await request(app).get(`/api/rounds/${round.id}`)).body.members.map((m) => m.id);

  const ok = async (res) => {
    assert.equal(res.status, 200, `fixture step failed: ${JSON.stringify(res.body)}`);
    return res;
  };
  // One drawn evening over the whole two-game shelf (`count: 2`, since the route
  // draws rather than taking a game list), rating both games at once.
  const { session } = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({
    count: 2, memberIds: ids,
  })).body;
  await ok(await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/results`).send({
    votes: Object.fromEntries(ids.map((id) => [id, {
      [quiet.id]: { rating: 4 }, [staple.id]: { rating: 3 },
    }])),
  }));
  // Six DIRECT PICKS of the staple, each finished — the mode that writes
  // `chosenGameId` up front, which is what a play is.
  for (let i = 0; i < 6; i += 1) {
    const s = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({
      gameId: staple.id, memberIds: ids,
    })).body.session;
    await ok(await request(app).post(`/api/rounds/${round.id}/sessions/${s.id}/finish`).send({
      finished: true, winnerIds: [],
    }));
  }

  const built = await rebuild();
  assert.equal(built.games.bestRated.title, 'Provider-Titel thing-staple',
    'without the play lift the better-rated but unplayed game would win');
  // {3,3,3} shrunk toward a prior six plays lifted to 4,5 -> 3,9. The quiet
  // game's {4,4,4} shrinks to 3,4, which is what it would have won with.
  assert.equal(built.games.bestRated.score, 3.9);
  assert.equal(built.games.bestRated.ratings, 3);
});
