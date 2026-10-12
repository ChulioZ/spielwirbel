'use strict';

/*
 * The BGG link table (#1638), server side: the parser hands BGG's ids over
 * BESIDE the name arrays, the three fill paths record them best-effort, the
 * JSON backend keeps them out of data.json, and POST /api/bgg-links answers
 * names with ids.
 *
 * The parser half runs against the CAPTURED body (test/fixtures/
 * bgg-thing-stats.xml, Ark Nova + Toriki) for the reason test/bgg-corpus-parse
 * gives: a hand-written body stamps the shape the code assumes.
 */

process.env.BGG_API_TOKEN = 'test-token';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const bgg = require('../lib/providers/bgg');
const corpus = require('../lib/corpus');
const { DATA_FILE: STORE_FILE } = require('../lib/store');
const { LINKS_FILE } = require('../lib/repo/bgg-links-file');
const { backfillProviderInfo } = require('../lib/provider-info');
const { BGG_LINK_NAMES_MAX } = require('../public/js/bgg-links');

const XML = fs.readFileSync(path.join(__dirname, 'fixtures', 'bgg-thing-stats.xml'), 'utf8');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

/* --------------------------------- parse ---------------------------------- */

test('a /thing parse yields an { type, bggId, name } per category, mechanic and designer link', () => {
  const [ark] = bgg.parseCorpusThing(XML);
  const of = (type) => ark.links.filter((l) => l.type === type);
  // Ids, as numbers, and names that are EXACTLY the stored strings, in BGG's
  // order — so a game's stored list and the link table can never disagree
  // about how a name is spelled.
  assert.deepEqual(of('category').map((l) => l.name), ark.categories);
  assert.deepEqual(of('mechanic').map((l) => l.name), ark.mechanics);
  assert.deepEqual(of('designer').map((l) => l.name), ark.designers);
  assert.ok(ark.links.length >= 10, `only ${ark.links.length} links parsed`);
  for (const l of ark.links) assert.ok(Number.isSafeInteger(l.bggId) && l.bggId > 0, JSON.stringify(l));
  assert.deepEqual(of('category')[0], { type: 'category', bggId: 1089, name: 'Animals' });
  // Families and implementations are parsed for the corpus but are not linked.
  assert.equal(ark.links.some((l) => !['category', 'mechanic', 'designer'].includes(l.type)), false);
});

test('the stored name arrays are unchanged by the ids riding beside them', () => {
  // The literal arrays the captured body produced before #1638 — the parse
  // must be byte-identical for every reader of these lists.
  const [ark] = bgg.parseCorpusThing(XML);
  const [info] = bgg.parseGameInfo(XML);
  for (const key of ['categories', 'mechanics', 'designers']) {
    assert.deepEqual(info[key], ark[key], key);
    assert.ok(ark[key].every((v) => typeof v === 'string'), key);
  }
  assert.deepEqual(info.links, ark.links);
  // The detail shape stays exactly what it was: no ids on what gets stored.
  assert.equal('links' in bgg.parseThing(XML, '342942'), false);
});

test('(Uncredited) is never a link, and a link with no usable id is dropped', () => {
  const pairs = bgg.linkPairs([
    { name: 'link', attrs: { type: 'boardgamedesigner', id: '3', value: '(Uncredited)' } },
    { name: 'link', attrs: { type: 'boardgamedesigner', id: '42', value: 'Uwe Rosenberg' } },
    { name: 'link', attrs: { type: 'boardgamecategory', value: 'No id' } },
    { name: 'link', attrs: { type: 'boardgamecategory', id: '0', value: 'Zero' } },
    { name: 'link', attrs: { type: 'boardgamefamily', id: '9', value: 'A family' } },
  ]);
  assert.deepEqual(pairs, [{ type: 'designer', bggId: 42, name: 'Uwe Rosenberg' }]);
});

/* ------------------------------- the store -------------------------------- */

test('the JSON backend keeps the table in its OWN file — data.json is not rewritten', async () => {
  // A round first, so data.json exists and the comparison is not vacuously
  // equal (.claude/rules/bgg-corpus.md §4).
  await request(app).post('/api/rounds').send({ name: 'Links-Bytes', members: ['Anna'] });
  const before = fs.readFileSync(STORE_FILE);
  await repo.upsertBggLinks([{ type: 'category', bggId: 990001, name: 'Bytes Category' }]);
  assert.ok(fs.readFileSync(STORE_FILE).equals(before), 'data.json changed on a link write');
  const stored = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
  assert.ok(stored.entries.some((e) => e.bggId === 990001 && e.name === 'Bytes Category'));
});

/* --------------------------------- fill ----------------------------------- */

const thingXml = (id) => `<items><item type="boardgame" id="${id}">
  <minplayers value="2"/><maxplayers value="4"/>
  <link type="boardgamecategory" id="${id}1" value="Fill Category ${id}"/>
  <link type="boardgamemechanic" id="${id}2" value="Fill Mechanic ${id}"/>
  <link type="boardgamedesigner" id="${id}3" value="Fill Designer ${id}"/>
  <statistics><ratings><average value="7.0"/><averageweight value="2.5"/><numweights value="900"/></ratings></statistics>
</item></items>`;
const stub = (id) => { global.fetch = async () => ({ ok: true, status: 200, text: async () => thingXml(id) }); };

const linkedIds = (id) => repo.getBggLinks({
  category: [`Fill Category ${id}`], mechanic: [`Fill Mechanic ${id}`], designer: [`Fill Designer ${id}`],
});

test('the provider-info backfill records the links it parsed', async () => {
  const rid = (await request(app).post('/api/rounds').send({ name: 'Links-Backfill', members: ['Anna'] })).body.id;
  const game = await repo.createGame('default', rid, {
    title: 'Fill', minPlayers: 2, maxPlayers: 4, image: null,
    source: { provider: 'bgg', externalId: '77101', url: null },
  });
  stub('77101');
  await backfillProviderInfo(repo.forTenant('default'), rid, [game]);
  assert.deepEqual(await linkedIds('77101'), {
    category: { 'Fill Category 77101': 771011 },
    mechanic: { 'Fill Mechanic 77101': 771012 },
    designer: { 'Fill Designer 77101': 771013 },
  });
});

test('a link-table failure never fails the backfill', async (t) => {
  const rid = (await request(app).post('/api/rounds').send({ name: 'Links-Fail', members: ['Anna'] })).body.id;
  const game = await repo.createGame('default', rid, {
    title: 'Fill', minPlayers: 2, maxPlayers: 4, image: null,
    source: { provider: 'bgg', externalId: '77102', url: null },
  });
  stub('77102');
  t.mock.method(repo, 'upsertBggLinks', async () => { throw new Error('table down'); });
  const out = await backfillProviderInfo(repo.forTenant('default'), rid, [game]);
  assert.equal(out.filled, 1);
  assert.equal((await repo.getGame('default', rid, game.id)).weight, 2.5);
});

test('the corpus pass records the links and stores info WITHOUT them', async () => {
  await repo.replaceCorpus(
    [{ externalId: '77103', name: 'Corpus Fill', year: 2000, rank: 1, rating: 7, bayesRating: 6, usersRated: 9000 }],
    { dumpDate: '2026-10-12', uploadedAt: new Date().toISOString() },
  );
  stub('77103');
  await corpus.enrich({ maxBatches: 1, pauseMs: 0 });
  const [row] = await repo.getCorpusEntries(['77103']);
  assert.ok(row.info, 'the row was enriched');
  assert.equal('links' in row.info, false, 'the link ids leaked into the corpus row');
  assert.deepEqual(row.info.categories, ['Fill Category 77103']);
  assert.equal((await linkedIds('77103')).designer['Fill Designer 77103'], 771033);
});

/* --------------------------------- route ---------------------------------- */

test('POST /api/bgg-links answers known names with ids and leaves the rest out', async () => {
  await repo.upsertBggLinks([
    { type: 'category', bggId: 1021, name: 'Economic' },
    { type: 'designer', bggId: 9216, name: 'Uwe Rosenberg' },
  ]);
  const res = await request(app).post('/api/bgg-links')
    .send({ category: ['Economic', 'Nobody Heard Of This'], designer: ['Uwe Rosenberg'] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    category: { Economic: 1021 }, mechanic: {}, designer: { 'Uwe Rosenberg': 9216 },
  });
});

test('POST /api/bgg-links refuses an unknown type, a non-list and an over-long question', async () => {
  for (const body of [
    { family: ['x'] },
    { category: 'Economic' },
    { category: [''] },
    { category: Array.from({ length: BGG_LINK_NAMES_MAX + 1 }, (_, i) => `n${i}`) },
    // The cap is on the TOTAL, not per type.
    {
      category: Array.from({ length: 60 }, (_, i) => `c${i}`),
      mechanic: Array.from({ length: 60 }, (_, i) => `m${i}`),
    },
  ]) {
    const res = await request(app).post('/api/bgg-links').send(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
  }
  // The ceiling itself is accepted.
  const ok = await request(app).post('/api/bgg-links')
    .send({ category: Array.from({ length: BGG_LINK_NAMES_MAX }, (_, i) => `ok${i}`) });
  assert.equal(ok.status, 200);
});
