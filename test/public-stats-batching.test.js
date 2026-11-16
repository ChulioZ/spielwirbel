'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

const publicStats = require('../lib/public-stats');
const repo = require('../lib/repo');
const { logger } = require('../lib/observability');

/*
 * The Discover rebuild's upstream cost (#1832). After a restart the memo is
 * empty, and the rebuild used to send one /thing request per game, up to 120 in
 * a row — which BGG answered with 429s, on the token every user's search uses.
 *
 * UNLIKE the other public-stats specs this one goes through global.fetch and the
 * real `bgg.details`, because the request count and the ids per request ARE the
 * subject: a per-game stub at the module boundary cannot see a batch.
 *
 * Every fixture here holds MORE than 20 games (25), since a fixture inside one
 * batch passes whatever the batch size is
 * (.claude/rules/provider-info-triggers-and-stamping.md §4).
 */

const ENV = [
  'PUBLIC_STATS_MIN_RATINGS', 'PUBLIC_STATS_MIN_RATING_TENANTS', 'PUBLIC_STATS_RESOLVE_MAX',
  'PUBLIC_STATS_MIN_NAME_GAMES', 'PUBLIC_STATS_MIN_NAME_TENANTS', 'BGG_API_TOKEN',
];
const realFetch = global.fetch;
const realWarn = logger.warn;
const seeded = [];

afterEach(async () => {
  global.fetch = realFetch;
  logger.warn = realWarn;
  for (const name of ENV) delete process.env[name];
  publicStats.resetForTests();
  await repo.replaceCorpus([], {});
  while (seeded.length) await request(app).delete(`/api/rounds/${seeded.pop()}`);
});

// Only „Bestbewertet" and the favourites can qualify: every other floor stays
// at its (high) default, so the candidate set is exactly the rated games.
function openFloors() {
  process.env.PUBLIC_STATS_MIN_RATINGS = '1';
  process.env.PUBLIC_STATS_MIN_RATING_TENANTS = '1';
  process.env.PUBLIC_STATS_MIN_NAME_TENANTS = '1';
  process.env.PUBLIC_STATS_MIN_NAME_GAMES = '1';
}

// 25 BGG ids. 101 is rated best and 102 second, so a card's head is known.
const IDS = Array.from({ length: 25 }, (_, i) => String(101 + i));
const ratingOf = (id) => (id === '101' ? 5 : id === '102' ? 4 : 1 + (Number(id) % 3));

/*
 * Ann rates every game; Bo rates every game EXCEPT 101 and 102, with the same
 * rating. So the two podium leaders carry the LEAST evidence and the favourites
 * (best evidence first) would ask about them LAST — which is what lets the
 * podiums-first spec tell the two priorities apart. Left at one vote each, the
 * favourites happened to list 101 and 102 first too, and reversing the
 * priority on purpose stayed green.
 */
async function seedRated(ids = IDS) {
  const round = await createRound(request, { name: 'Stapelrunde', members: ['Ann', 'Bo'] });
  seeded.push(round.id);
  const made = [];
  for (const id of ids) {
    const res = await request(app).post(`/api/rounds/${round.id}/games`).send({
      title: `GETIPPT ${id}`, minPlayers: '1', maxPlayers: '4', sourceProvider: 'bgg', sourceExternalId: id,
    });
    assert.equal(res.status, 201, `fixture step failed: ${JSON.stringify(res.body)}`);
    made.push(res.body);
  }
  const fresh = (await request(app).get(`/api/rounds/${round.id}`)).body;
  const { session } = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({
    gameIds: made.map((g) => g.id), memberIds: fresh.members.map((m) => m.id),
  })).body;
  const [ann, bo] = fresh.members.map((m) => m.id);
  const votes = { [ann]: {}, [bo]: {} };
  made.forEach((g, i) => {
    votes[ann][g.id] = { rating: ratingOf(ids[i]) };
    if (!['101', '102'].includes(ids[i])) votes[bo][g.id] = { rating: ratingOf(ids[i]) };
  });
  const res = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/results`)
    .send({ votes });
  assert.equal(res.status, 200, `fixture step failed: ${JSON.stringify(res.body)}`);
}

/*
 * A /thing endpoint answering every id it is asked for — except `unanswered` —
 * with one shared designer, so a favourite's game count shows how many games
 * were named. `status` forces every answer to that status instead.
 */
//
// It also sets BGG_API_TOKEN, and only here: with a token set while the
// fixture is SEEDED, adding a BGG game would reach the real network.
function stubThing({ unanswered = [], status = 200 } = {}) {
  process.env.BGG_API_TOKEN = 'test-token';
  const requests = [];
  global.fetch = async (url) => {
    const u = new URL(String(url));
    assert.equal(u.pathname, '/xmlapi2/thing', 'only /thing is ever asked');
    const ids = u.searchParams.get('id').split(',');
    requests.push(ids);
    if (status !== 200) return { status, text: async () => '' };
    const items = ids.filter((id) => !unanswered.includes(id)).map((id) => `<item type="boardgame" id="${id}">`
      + `<thumbnail>https://cf.geekdo-images.com/${id}.png</thumbnail>`
      + `<name type="primary" sortindex="1" value="BGG ${id}"/>`
      + '<link type="boardgamedesigner" id="7" value="Shared Designer"/></item>').join('');
    return { status: 200, text: async () => `<items>${items}</items>` };
  };
  return requests;
}

const ids = (list) => list.map((e) => e.url.split('/').pop());

test('a cold rebuild asks for 25 games in ceil(25/20) requests of at most 20 ids', async () => {
  openFloors();
  await seedRated();
  const requests = stubThing();

  const built = await publicStats.rebuild();
  assert.equal(requests.length, 2, `two requests, not one per game: ${requests.map((r) => r.length)}`);
  for (const r of requests) assert.ok(r.length <= 20, `${r.length} ids in one request`);
  assert.deepEqual(requests.flat().sort(), [...IDS].sort(), 'every game asked about exactly once');
  assert.equal(built.games.bestRated[0].title, 'BGG 101');
  assert.equal(built.names.favDesigner[0].games, 25);
});

test('the podiums are asked about FIRST, so they keep first claim on the budget', async () => {
  openFloors();
  await seedRated();
  const requests = stubThing();
  await publicStats.rebuild();
  // „Bestbewertet"'s seven candidates (STATS_LIST_MAX + SPARES) open the first
  // request, ahead of the favourites' games.
  assert.deepEqual(requests[0].slice(0, 2), ['101', '102']);
});

test('a warm rebuild, every candidate memoized, sends no request at all', async () => {
  openFloors();
  await seedRated();
  const requests = stubThing();
  await publicStats.rebuild();
  const cold = requests.length;
  await publicStats.rebuild();
  assert.equal(requests.length, cold);
});

test('PUBLIC_STATS_RESOLVE_MAX counts REQUESTS: 1 sends exactly one, and the lists come out shorter', async () => {
  openFloors();
  process.env.PUBLIC_STATS_RESOLVE_MAX = '1';
  await seedRated();
  const requests = stubThing();

  const built = await publicStats.rebuild();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].length, 20, 'a request carries a full batch, not one game');
  assert.equal(built.games.bestRated[0].title, 'BGG 101', 'the card was served first');
  assert.equal(built.names.favDesigner[0].games, 20, 'the favourites averaged only what was named');
});

test('PUBLIC_STATS_RESOLVE_MAX=0 sends nothing and is not replaced by the default', async () => {
  openFloors();
  process.env.PUBLIC_STATS_RESOLVE_MAX = '0';
  await seedRated();
  const requests = stubThing();
  const built = await publicStats.rebuild();
  assert.equal(requests.length, 0);
  assert.equal(built.games, undefined);
});

test('an id the batch does not answer is skipped, and the next candidate takes its place', async () => {
  openFloors();
  await seedRated();
  stubThing({ unanswered: ['101'] });
  const built = await publicStats.rebuild();
  assert.equal(built.games.bestRated[0].title, 'BGG 102');
  assert.ok(!ids(built.games.bestRated).includes('101'));
});

test('a game the corpus names costs no request, and its entry carries the corpus title, cover and url', async () => {
  openFloors();
  await seedRated();
  await repo.replaceCorpus(IDS.map((id, i) => ({ externalId: id, name: `Korpus ${id}`, rank: i + 1 })), {});
  await repo.updateCorpusEntries(IDS.map((id) => ({
    externalId: id,
    enrichedAt: '2026-11-01T00:00:00.000Z',
    info: { designers: ['Korpus Designer'], categories: [], mechanics: [], imageUrl: `https://cf.geekdo-images.com/k${id}.jpg` },
  })));
  const requests = stubThing();

  const built = await publicStats.rebuild();
  assert.equal(requests.length, 0, 'every game came from the corpus');
  const [top] = built.games.bestRated;
  assert.deepEqual([top.title, top.image, top.url],
    ['Korpus 101', 'https://cf.geekdo-images.com/k101.jpg', 'https://boardgamegeek.com/boardgame/101']);
  assert.equal(built.names.favDesigner[0].name, 'Korpus Designer');
});

test('a 429 stops every later request in that rebuild, warns once, and keeps a card that had entries', async (t) => {
  openFloors();
  process.env.PUBLIC_STATS_RESOLVE_MAX = '1';
  await seedRated();
  stubThing();
  const first = await publicStats.rebuild();
  assert.equal(first.games.bestRated[0].title, 'BGG 101');

  // The five games the first rebuild could not afford are still unknown.
  delete process.env.PUBLIC_STATS_RESOLVE_MAX;
  const requests = stubThing({ status: 429 });
  const warns = [];
  logger.warn = (o) => { warns.push(o); };
  t.after(() => { logger.warn = realWarn; });

  const built = await publicStats.rebuild();
  // fetchXml retries a 429 twice inside ONE call; those are the same request.
  assert.ok(requests.length >= 1);
  assert.ok(requests.every((r) => r.join() === requests[0].join()), 'no second batch was sent');
  const throttled = warns.filter((w) => w.event === 'public_stats_throttled');
  assert.equal(throttled.length, 1, 'exactly one throttle warn');
  assert.equal(throttled[0].unresolved, 5);
  assert.equal(warns.filter((w) => w.event === 'public_stats_resolve_failed').length, 0);
  assert.equal(built.games.bestRated[0].title, 'BGG 101', 'the card did not go blank');
  assert.equal(built.names.favDesigner[0].games, 20, 'and published what it knew');
});

test('a podium game the corpus can NAME but not LINK still gets the hop its favourite needs', async () => {
  // Rows enriched before designers were parsed (#1505): a name and a cover,
  // no `designers` key. The podium is satisfied by the corpus; the favourites
  // are not, so the same game has two needs and the hop must serve the second.
  openFloors();
  await seedRated();
  await repo.replaceCorpus(IDS.map((id, i) => ({ externalId: id, name: `Korpus ${id}`, rank: i + 1 })), {});
  await repo.updateCorpusEntries(IDS.map((id) => ({
    externalId: id, enrichedAt: '2026-11-01T00:00:00.000Z',
    info: { categories: [], mechanics: [], imageUrl: `https://cf.geekdo-images.com/k${id}.jpg` },
  })));
  const requests = stubThing();
  const built = await publicStats.rebuild();
  assert.equal(requests.length, 2);
  assert.equal(built.names.favDesigner[0].games, 25, 'every game, the podium leaders included');
  assert.equal(built.games.bestRated[0].title, 'BGG 101', 'the provider answer outranks the corpus name');
});
