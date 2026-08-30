'use strict';

/* The metadata filters (#725) at the ROUTE — its own file rather than more of
   test/sessions.test.js, which already spans four independently editable
   concerns and sits near the 700-line budget
   (.claude/rules/token-friendly-source-files.md).

   The predicate is unit-tested in test/draw-pool.test.js and the two client
   surfaces in test/metadata-filter.test.js. What only the route can answer is
   here: that the field is lenient enough never to 400, that an unknown category
   is dropped exactly like an unknown tag id, that an unfiltered draw's stored
   blob is byte-identical to a pre-#725 one, and that the preset round-trips.

   The metadata is seeded straight into the store because nothing user-facing
   writes it: it arrives from the provider backfill (#717/#724), so there is no
   request body that could put a weight on a game. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, store, createRound } = require('./helpers');

async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Game', minPlayers: '1', maxPlayers: '8', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  return (await req).body;
}

// Write provider metadata onto a stored game the way the backfill does — in
// place on the JSON backend's own tree, which is what the repo clones its reads
// from (.claude/rules/data-access-layer.md).
function seedMeta(rid, gid, meta) {
  const round = store.data.rounds.find((r) => r.id === rid);
  Object.assign(round.games.find((g) => g.id === gid), meta);
}

/* Three described games plus one with nothing at all. The bare one is in every
   expected set below, which is how each assertion also states the rule the whole
   feature hangs on: an absent field passes every filter. */
async function shelf() {
  const round = await createRound(request);
  const kurz = await addGame(round.id, { title: 'Kurz' });
  const mittel = await addGame(round.id, { title: 'Mittel' });
  const lang = await addGame(round.id, { title: 'Lang' });
  await addGame(round.id, { title: 'Blank' });
  seedMeta(round.id, kurz.id, {
    minPlaytime: 30, weight: 2, minAge: 8, categories: ['Abstract Strategy'], mechanics: ['Tile Placement'],
  });
  seedMeta(round.id, mittel.id, {
    minPlaytime: 60, weight: 3, minAge: 10, categories: ['Economic'], mechanics: ['Trading'],
  });
  seedMeta(round.id, lang.id, {
    minPlaytime: 120, weight: 4, minAge: 14, categories: ['Adventure'], mechanics: ['Deck Building'],
  });
  return round;
}

const drawn = (res) => res.body.games.map((g) => g.title).sort();
const start = (rid, body) =>
  request(app).post(`/api/rounds/${rid}/sessions`).send({ count: 9, ...body });
const presetOf = async (rid) =>
  (await request(app).get(`/api/rounds/${rid}`)).body.lastSessionFilters;

test('the draw applies each metadata filter, and the described-less game survives', async () => {
  const round = await shelf();

  assert.deepEqual(drawn(await start(round.id, { metadata: { maxPlaytime: 60 } })),
    ['Blank', 'Kurz', 'Mittel']);
  assert.deepEqual(drawn(await start(round.id, { metadata: { weightMin: 3, weightMax: 4 } })),
    ['Blank', 'Lang', 'Mittel']);
  assert.deepEqual(drawn(await start(round.id, { metadata: { youngestAge: 10 } })),
    ['Blank', 'Kurz', 'Mittel']);
  assert.deepEqual(drawn(await start(round.id, { metadata: { categories: ['Economic', 'Adventure'] } })),
    ['Blank', 'Lang', 'Mittel'], 'OR within the list');
  assert.deepEqual(
    drawn(await start(round.id, { metadata: { categories: ['Economic'], mechanics: ['Deck Building'] } })),
    ['Blank'], 'AND between the two lists');
});

test('an unfiltered draw is byte-identical to a pre-#725 one', async () => {
  const round = await shelf();

  const without = await start(round.id, {});
  const withEmpty = await start(round.id, { metadata: {} });
  assert.deepEqual(drawn(without), ['Blank', 'Kurz', 'Lang', 'Mittel']);
  assert.deepEqual(drawn(withEmpty), drawn(without));
  // The stored blob must grow no `metadata` key, or every session written after
  // this change differs from every one written before it for no reason.
  assert.equal('metadata' in without.body.session, false);
  assert.equal('metadata' in withEmpty.body.session, false);
  assert.deepEqual(await presetOf(round.id), { tagIds: [], excludeTagIds: [], count: 9 });
});

test('an unknown category is DROPPED, exactly like an unknown tag id', async () => {
  const round = await shelf();

  // 'Wargame' is on no game in this round. Rejecting the request would be wrong
  // (the client can hold a stale preset); honouring it would empty the pool.
  const res = await start(round.id, { metadata: { categories: ['Economic', 'Wargame'] } });
  assert.equal(res.status, 201);
  assert.deepEqual(drawn(res), ['Blank', 'Mittel']);
  assert.deepEqual((await presetOf(round.id)).metadata.categories, ['Economic']);
});

test('the schema never 400s, whatever shape the metadata field arrives in', async () => {
  const round = await shelf();
  const junk = [
    undefined, null, 'nope', 42, [], true,
    { categories: 'Economic' },                       // a bare string, not a list
    { maxPlaytime: '60' },                            // a numeric string
    { maxPlaytime: 37, weightMin: 2.3, youngestAge: 7 }, // off-ladder steps
    { weightMin: 4, weightMax: 2 },                   // inverted
    { categories: [null, 7, { x: 1 }] },
    { maxPlaytime: Number.POSITIVE_INFINITY },
  ];
  for (const metadata of junk) {
    const res = await start(round.id, { metadata });
    assert.equal(res.status, 201, `metadata ${JSON.stringify(metadata) ?? 'undefined'} must not 400`);
  }
});

test('a half-step band narrows to what no integer bound could say (#855)', async () => {
  const round = await shelf();

  // The whole point of the finer ladder: 2.5-3.5 keeps the weight-3 game while
  // dropping the 2 and the 4. Neither integer band can express that -- 2-3 drags
  // Kurz in, 3-4 drags Lang in -- so this assertion is red on the old ladder for
  // the right reason, namely that both bounds collapse to "unfiltered".
  assert.deepEqual(drawn(await start(round.id, { metadata: { weightMin: 2.5, weightMax: 3.5 } })),
    ['Blank', 'Mittel']);
  // A half step is now ON the ladder, so it survives into the preset rather
  // than normalizing away.
  assert.deepEqual((await presetOf(round.id)).metadata, {
    maxPlaytime: null, weightMin: 2.5, weightMax: 3.5,
    youngestAge: null, categories: [], mechanics: [],
  });
  // ...and an inverted half-step pair is still swapped, not dropped.
  assert.deepEqual(drawn(await start(round.id, { metadata: { weightMin: 3.5, weightMax: 2.5 } })),
    ['Blank', 'Mittel']);
});

test('an off-ladder or inverted value cannot empty the pool', async () => {
  const round = await shelf();

  // Off the ladder -> unfiltered, rather than a filter nothing satisfies.
  assert.deepEqual(drawn(await start(round.id, { metadata: { maxPlaytime: 37 } })),
    ['Blank', 'Kurz', 'Lang', 'Mittel']);
  // Inverted -> swapped, so it means 2–4 rather than admitting nothing.
  assert.deepEqual(drawn(await start(round.id, { metadata: { weightMin: 4, weightMax: 2 } })),
    ['Blank', 'Kurz', 'Lang', 'Mittel']);
});

test('the filters survive into the preset, normalized and canonical', async () => {
  const round = await shelf();
  await start(round.id, { count: 3, metadata: { maxPlaytime: 60, categories: ['Economic'] } });

  assert.deepEqual(await presetOf(round.id), {
    tagIds: [], excludeTagIds: [], count: 3,
    metadata: {
      maxPlaytime: 60, weightMin: null, weightMax: null,
      youngestAge: null, categories: ['Economic'], mechanics: [],
    },
  });

  // The preset is replaced wholesale on every draw, so a later unfiltered draw
  // must clear it — otherwise the next setup sheet opens with a filter the user
  // has already abandoned.
  await start(round.id, { count: 3 });
  assert.equal('metadata' in (await presetOf(round.id)), false);
});

test('a filter that empties the pool answers the ordinary 400', async () => {
  // Every game described, so nothing can slip through on an absent field — which
  // is the only way a metadata filter can empty a pool at all.
  const round = await createRound(request);
  const g = await addGame(round.id, { title: 'Nur eins' });
  seedMeta(round.id, g.id, { minPlaytime: 120, categories: ['Adventure'] });

  const res = await start(round.id, { metadata: { maxPlaytime: 30 } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'No matching games in this round');
  // The refusal is the pre-existing one, so nothing was drawn and no preset was
  // written over the round's last real draw.
  assert.equal(await presetOf(round.id), undefined);
});

test('direct-pick mode ignores the metadata filters entirely', async () => {
  const round = await shelf();
  const lang = store.data.rounds.find((r) => r.id === round.id).games.find((g) => g.title === 'Lang');

  // Same standing rule as the player range (#532): choosing a game by id is an
  // explicit act, so no pool filter may refuse it.
  const res = await start(round.id, { gameId: lang.id, metadata: { maxPlaytime: 30 } });
  assert.equal(res.status, 201);
  assert.deepEqual(drawn(res), ['Lang']);
});
