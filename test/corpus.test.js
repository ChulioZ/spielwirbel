'use strict';

/*
 * The licensed BGG game corpus (issue #681): ingest, the enrichment pass, and
 * the operator routes that drive both.
 *
 * The two things worth stating up front, because they shape every case below:
 *
 *  - the corpus is GLOBAL and un-scoped. There is no tenant argument anywhere,
 *    and nothing in this issue makes it reachable from a round route — so the
 *    specs drive the admin surface and the repo directly, never req.repo.
 *  - the enrichment pass is BOUNDED and RESUMABLE, and the queue itself is the
 *    resume point. Most of these cases are about the states a half-finished pass
 *    can leave behind, since none of them throws.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.ADMIN_PASSWORD = 'operator-secret-pw';
// Enrichment is gated on the token; the batches are all stubbed below, so no
// request ever leaves the process.
process.env.BGG_API_TOKEN = 'test-token';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const corpus = require('../lib/corpus');
const scheduler = require('../lib/scheduler');

const ADMIN_PW = 'operator-secret-pw';

const adminCookie = async () => {
  const res = await request(app).post('/api/admin/login').send({ password: ADMIN_PW });
  assert.equal(res.status, 200);
  return res.headers['set-cookie'];
};

/* ------------------------------- the CSV shape ------------------------------ */

// The real dump's header, in BGG's own order and spelling.
const HEADER = 'id,name,yearpublished,rank,bayesaverage,average,usersrated,is_expansion';
const row = (o) => [
  o.id, o.name, o.year ?? 2000, o.rank, o.bayes ?? 6.5, o.avg ?? 7.5,
  o.rated ?? 5000, o.expansion ?? 0,
].join(',');
const csv = (rows) => `${HEADER}\r\n${rows.map(row).join('\r\n')}\r\n`;

test('parseRanksCsv keeps the ranked base games and drops the rest', () => {
  const out = corpus.parseRanksCsv(csv([
    { id: 13, name: 'CATAN', rank: 1 },
    { id: 325, name: 'Seafarers', rank: 2, expansion: 1 },
    { id: 999, name: 'Unranked thing', rank: 0 },
    { id: 111, name: 'Barely rated', rank: 3, rated: 4 },
    { id: 342942, name: 'Ark Nova', rank: 4 },
  ]));
  assert.deepEqual(out.entries.map((e) => e.externalId), ['13', '342942']);
  assert.equal(out.total, 5);
  assert.equal(out.dropped, 3);
});

test('a title containing a comma survives the parse intact', () => {
  // The reason the reader is a state machine: `"Tigris, Euphrates"` is ONE
  // field, and a split(',') would shift every later column by one — turning the
  // rank into a year and the whole row into plausible nonsense.
  const out = corpus.parseRanksCsv(
    `${HEADER}\r\n42,"Tigris, Euphrates",1997,5,7.1,7.5,60000,0\r\n`,
  );
  assert.equal(out.entries[0].name, 'Tigris, Euphrates');
  assert.equal(out.entries[0].rank, 5);
  assert.equal(out.entries[0].year, 1997);
  assert.equal(out.entries[0].usersRated, 60000);
});

test('the corpus is capped at BGG_CORPUS_SIZE, keeping the BEST-ranked rows', () => {
  const prev = process.env.BGG_CORPUS_SIZE;
  process.env.BGG_CORPUS_SIZE = '2';
  try {
    // Deliberately out of rank order in the file: the cap must be applied after
    // sorting, or "the best 2" becomes "the first 2 lines".
    const out = corpus.parseRanksCsv(csv([
      { id: 3, name: 'Third', rank: 30 },
      { id: 1, name: 'First', rank: 1 },
      { id: 2, name: 'Second', rank: 2 },
    ]));
    assert.deepEqual(out.entries.map((e) => e.name), ['First', 'Second']);
  } finally {
    if (prev === undefined) delete process.env.BGG_CORPUS_SIZE; else process.env.BGG_CORPUS_SIZE = prev;
  }
});

test('anything that is not the ranks dump is refused, by marker', () => {
  assert.equal(corpus.parseRanksCsv(''), 'invalid_csv');
  assert.equal(corpus.parseRanksCsv('not,a,dump\r\n1,2,3\r\n'), 'invalid_csv');
  // The columns are there but every row is unusable — an empty corpus is not a
  // successful upload.
  assert.equal(corpus.parseRanksCsv(csv([{ id: 1, name: 'x', rank: 0 }])), 'invalid_csv');
  // A header alone, which is what a truncated download looks like.
  assert.equal(corpus.parseRanksCsv(`${HEADER}\r\n`), 'invalid_csv');
});

/* --------------------------------- the routes ------------------------------- */

const upload = async (cookie, text, filename = 'boardgames_ranks_2026-08-01.csv') => request(app)
  .post('/api/admin/corpus')
  .set('Cookie', cookie)
  .attach('file', Buffer.from(text, 'utf8'), filename);

test('uploading a dump stores it and reports the counts and the dump date', async () => {
  const cookie = await adminCookie();
  const res = await upload(cookie, csv([
    { id: 13, name: 'CATAN', rank: 1 },
    { id: 342942, name: 'Ark Nova', rank: 2 },
    { id: 325, name: 'Seafarers', rank: 3, expansion: 1 },
  ]));
  assert.equal(res.status, 200);
  assert.equal(res.body.upload.rows, 2);
  assert.equal(res.body.upload.dropped, 1);
  // BGG puts the date on the ZIP, not on the CSV inside it — so it is read off
  // the uploaded file name when it survived, and is null otherwise.
  assert.equal(res.body.upload.dumpDate, '2026-08-01');
  assert.equal(res.body.corpus.rows, 2);
  assert.equal(res.body.corpus.enriched, 0);
});

test('a file with no date in its name uploads fine and reports a null dump date', async () => {
  const cookie = await adminCookie();
  // The name inside BGG's own zip. This is the ordinary case, not the edge one.
  const res = await upload(cookie, csv([{ id: 13, name: 'CATAN', rank: 1 }]), 'boardgames_ranks.csv');
  assert.equal(res.status, 200);
  assert.equal(res.body.upload.dumpDate, null);
  assert.ok(res.body.upload.uploadedAt, 'the upload time is always known');
});

test('a bad upload is refused AND leaves the previous corpus intact', async () => {
  const cookie = await adminCookie();
  await upload(cookie, csv([{ id: 13, name: 'CATAN', rank: 1 }]));
  const before = await repo.corpusStats();
  assert.equal(before.rows, 1);

  for (const [body, name] of [['id,name\r\n1,x\r\n', 'wrong.csv'], ['', 'empty.csv']]) {
    const res = await upload(cookie, body, name);
    assert.equal(res.status, 400, name);
    assert.equal(res.body.error, name === 'empty.csv' ? 'no_file' : 'invalid_csv');
  }
  // The acceptance criterion: picking the wrong file must not cost the operator
  // the corpus the features are reading.
  assert.deepEqual(await repo.corpusStats(), before);
});

test('the corpus card reads counts and ceilings, and no secret', async () => {
  const cookie = await adminCookie();
  await upload(cookie, csv([{ id: 13, name: 'CATAN', rank: 1 }]));
  const res = await request(app).get('/api/admin/corpus').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.corpus.rows, 1);
  assert.equal(res.body.corpus.limit, corpus.corpusSize());
  // tokenSet is a BOOLEAN about BGG_API_TOKEN, never the value — this response
  // reaches a browser.
  assert.equal(res.body.corpus.tokenSet, true);
  assert.ok(!JSON.stringify(res.body).includes('test-token'));
});

test('every corpus route is behind the operator gate', async () => {
  for (const [method, path] of [['get', '/api/admin/corpus'], ['post', '/api/admin/corpus'], ['post', '/api/admin/corpus/enrich']]) {
    const res = await request(app)[method](path);
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

/* ------------------------------- enrichment --------------------------------- */

// One /thing body per requested id. Built rather than captured on purpose: the
// PARSER is tested against a real captured body in test/bgg-corpus-parse.test.js,
// and what these cases are about is which ids get asked and stamped.
const thingBody = (ids) => `<items>${ids.map((id) => `<item type="boardgame" id="${id}">
  <minplayers value="2"/><maxplayers value="4"/>
  <statistics><ratings><averageweight value="2.5"/><numweights value="900"/></ratings></statistics>
  <link type="boardgamecategory" value="Economic"/>
</item>`).join('')}</items>`;

let realFetch;
let fetchCalls;
// `answer` decides which of the asked ids the stub reports back, so a spec can
// model "BGG knows nothing about this one" without a second stub.
let answerIds = (ids) => ids;

beforeEach(() => {
  realFetch = global.fetch;
  fetchCalls = [];
  answerIds = (ids) => ids;
  global.fetch = async (url) => {
    const ids = new URL(String(url)).searchParams.get('id').split(',');
    fetchCalls.push(ids);
    return { ok: true, status: 200, text: async () => thingBody(answerIds(ids)) };
  };
});

afterEach(() => { global.fetch = realFetch; });

// Every enrichment spec seeds its own corpus. replaceCorpus is wholesale, so a
// re-seed clears the previous spec's rows — but each spec needs its OWN IDS too,
// and that is not fussiness: an upload deliberately CARRIES OVER the enrichment
// of every id that survives it (which is what makes the operator's monthly
// refresh cheap). Reuse an id and the next spec starts with rows already
// enriched, which presents as "the pass asked nothing" three specs later, in
// tests that have nothing to do with re-uploading.
let seedRun = 0;
const seed = (n) => {
  seedRun += 1;
  return repo.replaceCorpus(
    Array.from({ length: n }, (_, i) => ({
      externalId: String(seedRun * 100000 + i), name: `Game ${i}`, year: 2000, rank: i + 1,
      rating: 7, bayesRating: 6, usersRated: 5000,
    })),
    { dumpDate: '2026-08-01', uploadedAt: new Date().toISOString() },
  );
};

test('a pass asks in batches of 20 and stops at the batch bound', async () => {
  await seed(60);
  const run = await corpus.enrich({ maxBatches: 2, pauseMs: 0 });

  assert.equal(fetchCalls.length, 2, 'exactly the batches asked for');
  assert.deepEqual(fetchCalls.map((c) => c.length), [20, 20]);
  assert.equal(run.asked, 40);
  assert.equal(run.enriched, 40);
  // 20 rows are still owed — the bound is what spreads a full corpus over hours
  // rather than firing 250 requests in one tick.
  assert.equal((await repo.corpusStats()).enriched, 40);
});

test('a second pass RESUMES rather than starting over', async () => {
  await seed(60);
  await corpus.enrich({ maxBatches: 2, pauseMs: 0 });
  const firstIds = fetchCalls.flat();
  fetchCalls = [];

  await corpus.enrich({ maxBatches: 2, pauseMs: 0 });
  const secondIds = fetchCalls.flat();

  // The queue itself is the resume point: an already-stamped row is not pending,
  // so nothing is asked twice. That is what makes a restart mid-pass free.
  assert.equal(secondIds.length, 20);
  assert.equal(secondIds.filter((id) => firstIds.includes(id)).length, 0);
  assert.equal((await repo.corpusStats()).enriched, 60);
});

test('running it twice over a finished corpus asks nothing and duplicates nothing', async () => {
  await seed(20);
  await corpus.enrich({ maxBatches: 5, pauseMs: 0 });
  const after = await repo.corpusStats();
  fetchCalls = [];

  const run = await corpus.enrich({ maxBatches: 5, pauseMs: 0 });
  assert.equal(fetchCalls.length, 0, 'nothing was pending');
  assert.deepEqual(run, { batches: 0, asked: 0, enriched: 0, failed: false });
  assert.deepEqual(await repo.corpusStats(), after);
});

test('a row BGG answers nothing for is still STAMPED, so it cannot block the queue', async () => {
  await seed(20);
  // BGG knows about half the batch — a perfectly ordinary answer for ids that
  // have since been merged or deleted upstream.
  answerIds = (ids) => ids.slice(0, 10);
  const run = await corpus.enrich({ maxBatches: 1, pauseMs: 0 });

  assert.equal(run.asked, 20);
  assert.equal(run.enriched, 10);
  // All twenty are stamped. Stamping only the answered ten would put the other
  // ten back at the head of the queue on every future tick, forever, ahead of
  // every row behind them — and nothing would ever report it.
  assert.equal((await repo.corpusStats()).enriched, 20);
  fetchCalls = [];
  await corpus.enrich({ maxBatches: 1, pauseMs: 0 });
  assert.equal(fetchCalls.length, 0);
});

test('a transient BGG failure keeps the batches already written and stops the pass', async () => {
  await seed(60);
  let n = 0;
  global.fetch = async (url) => {
    const ids = new URL(String(url)).searchParams.get('id').split(',');
    n += 1;
    if (n > 1) throw new Error('upstream down');
    fetchCalls.push(ids);
    return { ok: true, status: 200, text: async () => thingBody(ids) };
  };

  const run = await corpus.enrich({ maxBatches: 3, pauseMs: 0 });
  assert.equal(run.failed, true);
  // The first batch is persisted rather than rolled back: the pass is resumable,
  // so partial progress is progress. Throwing the batch away would mean a flaky
  // upstream leaves the corpus permanently empty.
  assert.equal(run.enriched, 20);
  assert.equal((await repo.corpusStats()).enriched, 20);
});

test('a re-enrichment never ERASES what an earlier pass learned', async () => {
  await seed(1);
  await corpus.enrich({ maxBatches: 1, pauseMs: 0 });
  const [stored] = await repo.listCorpusPending(1, '9999-12-31');
  assert.equal(stored.info.weight, 2.5);

  // The same row comes round again after the staleness window, and this time BGG
  // has nothing to say about it. Nulling the attributes here would silently
  // empty the corpus one outage at a time.
  answerIds = () => [];
  await corpus.enrich({ maxBatches: 1, pauseMs: 0, now: new Date(Date.now() + 400 * 86400000) });
  const [again] = await repo.listCorpusPending(1, '9999-12-31');
  assert.equal(again.info.weight, 2.5);
});

test('a stale row comes back into the queue after BGG_CORPUS_STALE_DAYS', async () => {
  await seed(1);
  await corpus.enrich({ maxBatches: 1, pauseMs: 0 });
  fetchCalls = [];

  // Same instant: nothing is stale yet.
  await corpus.enrich({ maxBatches: 1, pauseMs: 0 });
  assert.equal(fetchCalls.length, 0);

  // Far enough in the future that the default 30-day window has passed. This is
  // what keeps the corpus current between the operator's monthly uploads.
  await corpus.enrich({ maxBatches: 1, pauseMs: 0, now: new Date(Date.now() + 400 * 86400000) });
  assert.equal(fetchCalls.length, 1);
});

test('with no BGG token nothing is fetched and nothing is stamped', async () => {
  await seed(20);
  delete process.env.BGG_API_TOKEN;
  try {
    assert.equal(corpus.enrichEnabled(), false);
    // Called anyway, because `enabled()` is the scheduler's guard and this
    // module must not depend on it: a tokenless instance that stamped its corpus
    // as "asked" would leave every row waiting out a staleness window for data
    // it could have had the moment a token was configured.
    const run = await corpus.enrich({ maxBatches: 2, pauseMs: 0 });
    assert.equal(fetchCalls.length, 0);
    assert.equal(run.asked, 0);
    assert.equal((await repo.corpusStats()).enriched, 0);
  } finally {
    process.env.BGG_API_TOKEN = 'test-token';
  }
});

test('BGG_CORPUS_BATCHES_PER_TICK=0 pauses enrichment without touching the corpus', async () => {
  await seed(20);
  const prev = process.env.BGG_CORPUS_BATCHES_PER_TICK;
  process.env.BGG_CORPUS_BATCHES_PER_TICK = '0';
  try {
    const run = await corpus.enrich({ pauseMs: 0 });
    assert.equal(fetchCalls.length, 0);
    assert.equal(run.batches, 0);
    assert.equal((await repo.corpusStats()).rows, 20, 'the stored corpus is untouched');
  } finally {
    if (prev === undefined) delete process.env.BGG_CORPUS_BATCHES_PER_TICK;
    else process.env.BGG_CORPUS_BATCHES_PER_TICK = prev;
  }
});

/* -------------------------------- the wiring -------------------------------- */

test('the scheduler runs the pass as a named job, gated on the token', async () => {
  await seed(20);
  // Driven through runJob rather than by waiting on a timer, which is the
  // contract every job in lib/scheduler.js keeps.
  const prev = process.env.BGG_CORPUS_BATCHES_PER_TICK;
  process.env.BGG_CORPUS_BATCHES_PER_TICK = '1';
  try {
    const run = await scheduler.runJob('enrichBggCorpus');
    assert.equal(run.asked, 20);

    delete process.env.BGG_API_TOKEN;
    // A disabled job answers null and makes no request at all — an instance with
    // no token must not spend a database query per tick discovering that.
    assert.equal(await scheduler.runJob('enrichBggCorpus'), null);
  } finally {
    process.env.BGG_API_TOKEN = 'test-token';
    if (prev === undefined) delete process.env.BGG_CORPUS_BATCHES_PER_TICK;
    else process.env.BGG_CORPUS_BATCHES_PER_TICK = prev;
  }
});

test('the panel button runs the same bounded pass and reports what it did', async () => {
  const cookie = await adminCookie();
  await seed(20);
  const prev = process.env.BGG_CORPUS_BATCHES_PER_TICK;
  process.env.BGG_CORPUS_BATCHES_PER_TICK = '1';
  try {
    const res = await request(app).post('/api/admin/corpus/enrich').set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.run.asked, 20);
    assert.equal(res.body.corpus.enriched, 20);
  } finally {
    if (prev === undefined) delete process.env.BGG_CORPUS_BATCHES_PER_TICK;
    else process.env.BGG_CORPUS_BATCHES_PER_TICK = prev;
  }
});

test('the enrich button says so when the token is missing, rather than no-opping', async () => {
  const cookie = await adminCookie();
  delete process.env.BGG_API_TOKEN;
  try {
    const res = await request(app).post('/api/admin/corpus/enrich').set('Cookie', cookie);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'bgg_token_missing');
  } finally {
    process.env.BGG_API_TOKEN = 'test-token';
  }
});

test('a corpus write never touches data.json', async () => {
  // The hard constraint behind lib/repo/corpus-file.js. store.js's saveData()
  // rewrites the ENTIRE data.json on every mutation, so 5000 corpus rows in
  // there would make every game add and every vote re-serialize megabytes of BGG
  // facts that never change. Nothing else can see this: the app works either
  // way, and the cost only shows up as latency on an instance with real data.
  const dataFile = path.join(process.env.DATA_DIR, 'data.json');
  // The JSON store only writes on mutation, so a round has to exist first — a
  // never-written data.json would make the comparison below vacuously true.
  await repo.createRound('tenant-corpus', { name: 'Spielrunde', members: ['Ann'] });
  const before = fs.readFileSync(dataFile);

  await seed(50);
  await corpus.enrich({ maxBatches: 1, pauseMs: 0 });

  assert.deepEqual(fs.readFileSync(dataFile), before, 'data.json was rewritten');
  // …and the rows really did land somewhere, or the assertion above is vacuous.
  const corpusFile = path.join(process.env.DATA_DIR, 'bgg-corpus.json');
  assert.equal(JSON.parse(fs.readFileSync(corpusFile, 'utf8')).entries.length, 50);
});

test('nothing about the corpus is reachable from a round route', async () => {
  // The issue's own boundary: this ships the data layer, not a consumer. A
  // tenant-scoped repo view must not carry the corpus methods at all — the
  // absence from TENANT_METHODS is the enforcement, not a convention.
  const scoped = repo.forTenant('tenant-a');
  for (const name of ['replaceCorpus', 'corpusStats', 'listCorpusPending', 'updateCorpusEntries']) {
    assert.equal(scoped[name], undefined, name);
  }
});
