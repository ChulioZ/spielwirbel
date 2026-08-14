'use strict';

/*
 * parseCorpusThing (issue #681) — the per-game attributes the local BGG corpus
 * scores on, read out of a /thing?stats=1 body.
 *
 * It runs against a CAPTURED REAL body (test/fixtures/bgg-thing-stats.xml,
 * fetched 2026-08-14 for Ark Nova 342942 and Toriki 417403), not a hand-written
 * one, because this repo has been bitten three times by a fixture that stamped
 * the shape the code assumed and hid a dead code path in production
 * (.claude/rules/bgg-collection-import.md). The two games are chosen to differ:
 * Ark Nova is heavily voted with implementations and a decided poll, Toriki is
 * a thin one.
 *
 * The one deliberately MODIFIED body is the poll-absent case at the bottom, and
 * it says so — absence is not something BGG will serve on request.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bgg = require('../lib/providers/bgg');
const { providerCoverUrl } = require('../lib/providers');

const XML = fs.readFileSync(path.join(__dirname, 'fixtures', 'bgg-thing-stats.xml'), 'utf8');
const rows = bgg.parseCorpusThing(XML);
const byId = (id) => rows.find((r) => r.providerId === id);

test('both items are parsed, keyed by their BGG id', () => {
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.providerId), ['342942', '417403']);
});

test('the numeric attributes come through as numbers, weight as a float', () => {
  const ark = byId('342942');
  assert.equal(ark.minPlayers, 1);
  assert.equal(ark.maxPlayers, 4);
  assert.equal(ark.minPlaytime, 90);
  assert.equal(ark.maxPlaytime, 150);
  assert.equal(ark.minAge, 14);
  // The community weight is a 1-5 FLOAT: parseInt would round every game down
  // to its integer and flatten the whole complexity axis the corpus exists for.
  assert.ok(ark.weight > 3.7 && ark.weight < 3.9, `weight ${ark.weight}`);
  assert.ok(Number.isInteger(ark.numWeights) && ark.numWeights > 100);
});

test('the link families are kept verbatim, in BGG\'s own vocabulary', () => {
  const ark = byId('342942');
  assert.ok(ark.categories.includes('Animals'), ark.categories.join(', '));
  assert.ok(ark.mechanics.length > 3);
  assert.ok(ark.designers.length >= 1);
  assert.ok(ark.families.length >= 1);
  // The licence forbids modifying retrieved data, so nothing is translated or
  // normalised — a category arrives exactly as BGG spells it.
  for (const c of ark.categories) assert.equal(typeof c, 'string');
});

test('implementations are read, and absent ones are an empty list rather than null', () => {
  assert.ok(byId('342942').implementations.length >= 1);
  assert.deepEqual(byId('417403').implementations, []);
});

/*
 * The poll is the part that needed its own machinery: parseItems flattens every
 * descendant of <item> into ONE child list, so a two-item body's polls would
 * merge and every <result> would lose the <results numplayers=N> it belongs to.
 */

test('the suggested-players poll is read PER ITEM, not merged across the body', () => {
  // BGG's own poll-summary for this capture says "Best with 2 players" and
  // "Recommended with 1-3 players" — derived here from the raw votes instead of
  // scraped out of that English prose.
  assert.deepEqual(byId('342942').bestWith, [2]);
  assert.deepEqual(byId('342942').recommendedWith, [1, 2, 3]);
  // The second item has its own, different verdict. Under a body-wide parse the
  // two would be identical, which is exactly the bug that would not throw.
  assert.notDeepEqual(byId('417403').bestWith, byId('342942').bestWith);
});

test('the "N+" bucket is dropped, never parsed as N', () => {
  // The capture carries a <results numplayers="4+"> row alongside the real 4.
  // parseInt('4+') is 4, so a naive read merges the "more than 4 players" votes
  // into the 4-player row — a plausible verdict that is simply wrong.
  assert.ok(/numplayers="4\+"/.test(XML), 'fixture no longer holds the "4+" bucket');

  // THE RAW CAPTURE CANNOT SEE THIS, and that is the point of doing it this way.
  // Ark Nova's 4+ bucket is 4/9/1199, so admitting it changes neither verdict —
  // an assertion over the capture alone stays green against a parser that reads
  // "4+" as 4. Verified by making exactly that change and watching this file
  // stay green. So the discriminating case is built: give the 4+ bucket a
  // landslide of Best votes, which only a parser that admits it can report.
  const loaded = XML.replace(
    /(<results numplayers="4\+">\s*<result value="Best" numvotes=")\d+(")/,
    '$19999$2',
  );
  assert.notEqual(loaded, XML, 'the 4+ bucket rewrite did not apply');
  assert.deepEqual(bgg.parseCorpusThing(loaded)[0].bestWith, [2],
    '"more than 4 players" was read as the number 4');

  for (const r of rows) {
    for (const n of [...r.bestWith, ...r.recommendedWith]) {
      assert.ok(Number.isInteger(n), `${n} is not an integer player count`);
    }
  }
  // Ark Nova maxes at 4 and its 4-player row is voted DOWN (1051 not-recommended
  // against 783 positive), so 4 must be absent from both verdicts.
  assert.ok(!byId('342942').recommendedWith.includes(4));
});

test('the player poll is picked by NAME — the sibling polls are not seats', () => {
  // Every item ships three polls (suggested_numplayers, suggested_playerage,
  // language_dependence) in that order. Taking the first block by position
  // happens to work; taking any block would read player AGES as player counts.
  assert.ok(/name="suggested_playerage"/.test(XML));
  const reordered = XML.replace(
    /(<poll name="suggested_numplayers"[\s\S]*?<\/poll>)([\s\S]*?)(<poll name="suggested_playerage"[\s\S]*?<\/poll>)/,
    '$3$2$1',
  );
  assert.notEqual(reordered, XML, 'the poll reorder did not apply');
  assert.deepEqual(bgg.parseCorpusThing(reordered)[0].bestWith, [2]);
});

test('a body with NO suggested-players poll yields empty verdicts, not a throw', () => {
  // Hand-modified on purpose: BGG serves the poll block on every item, so the
  // absent case cannot be captured live.
  const stripped = XML.replace(/<poll name="suggested_numplayers"[\s\S]*?<\/poll>/g, '');
  assert.ok(!/<poll name="suggested_numplayers"/.test(stripped));
  // The <poll-summary> of the same name SURVIVES the strip, which is the point:
  // it carries the identical `name` attribute, so a parser that matched `<poll`
  // loosely would read the summary's prose block and report a verdict here.
  assert.ok(/<poll-summary name="suggested_numplayers"/.test(stripped));
  const [ark] = bgg.parseCorpusThing(stripped);
  assert.deepEqual(ark.bestWith, []);
  assert.deepEqual(ark.recommendedWith, []);
  // Everything else still parses — a missing poll is not a missing game.
  assert.equal(ark.maxPlayers, 4);
});

test('an unvoted poll answers nothing rather than claiming 1 player', () => {
  // A brand-new game's poll is present with every count at zero votes. "Best
  // with 1" would be a confident wrong answer; the empty list is the honest one.
  const unvoted = XML.replace(/numvotes="\d+"/g, 'numvotes="0"');
  const [ark] = bgg.parseCorpusThing(unvoted);
  assert.deepEqual(ark.bestWith, []);
  assert.deepEqual(ark.recommendedWith, []);
});

test('junk and empty input yield [] rather than throwing', () => {
  assert.deepEqual(bgg.parseCorpusThing(''), []);
  assert.deepEqual(bgg.parseCorpusThing(null), []);
  assert.deepEqual(bgg.parseCorpusThing('<items><item type="x" id="abc"></item></items>'), []);
  // A truncated body: the item never closes, so there is nothing to report.
  assert.deepEqual(bgg.parseCorpusThing(XML.slice(0, 400)), []);
});

test('a field BGG has no data for is null, never 0', () => {
  const blanked = XML.replace(/<averageweight value="[^"]*"/, '<averageweight value="0"')
    .replace(/<minage value="[^"]*"/, '<minage value="0"');
  const [ark] = bgg.parseCorpusThing(blanked);
  // "0" is BGG's "no data yet" everywhere in this API. Stored as 0 it would read
  // as "the lightest game in the corpus" and win every low-complexity match.
  assert.equal(ark.weight, null);
  assert.equal(ark.minAge, null);
});

test('the box art is read off the same body, as the fit-in thumbnail (#779)', () => {
  const ark = byId('342942');
  const toriki = byId('417403');
  // The THUMBNAIL, never <image>: the master is 68 KB – 2 MB and BGG's transform
  // paths are signed, so the right-sized variant can only be picked here
  // (.claude/rules/provider-cover-sizing.md).
  assert.match(ark.imageUrl, /^https:\/\/cf\.geekdo-images\.com\//);
  assert.ok(ark.imageUrl.includes('/fit-in/200x150/'), ark.imageUrl);
  assert.notEqual(toriki.imageUrl, ark.imageUrl);
  // It must survive the write gate the route applies before it reaches a card —
  // BGG's real paths carry `filters:strip_icc()`, and an over-strict guard that
  // refused parens would silently drop every cover with nothing logged.
  assert.equal(providerCoverUrl(ark.imageUrl), ark.imageUrl);
});

test('a game BGG has no thumbnail for is null — a settled answer, not a gap', () => {
  // Deliberately MODIFIED, like the poll-absent body below: BGG serves a
  // thumbnail for both captured items, so absence cannot be fetched. null here
  // is what listCorpusPending's backfill clause must NOT re-queue — it tests for
  // the key's absence precisely so this row is answered once and left alone.
  const [ark] = bgg.parseCorpusThing(XML.replace(/<thumbnail>[^<]*<\/thumbnail>/, ''));
  assert.equal(ark.imageUrl, null);
  assert.ok('imageUrl' in ark, 'the key is written even when the answer is null');
});

test('corpus() asks in batches of at most 20 and reports what it asked', async () => {
  // BGG documents the /thing id limit as 20. Without a token nothing is asked —
  // and nothing may be reported as asked either, or a tokenless instance would
  // stamp its whole corpus as "BGG had nothing".
  assert.equal(bgg.MAX_CORPUS_BATCH, 20);
  const token = process.env.BGG_API_TOKEN;
  delete process.env.BGG_API_TOKEN;
  try {
    assert.deepEqual(await bgg.corpus(['1', '2']), { items: [], asked: [] });
  } finally {
    if (token !== undefined) process.env.BGG_API_TOKEN = token;
  }
});

test('corpus() sends at most 20 ids, stats=1, and parses the answer', async () => {
  const calls = [];
  const realFetch = global.fetch;
  process.env.BGG_API_TOKEN = 'test-token';
  global.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, text: async () => XML };
  };
  try {
    const ids = Array.from({ length: 25 }, (_, i) => String(i + 1));
    const { items, asked } = await bgg.corpus(ids);
    assert.equal(calls.length, 1);
    assert.equal(asked.length, 20);
    assert.ok(calls[0].includes('stats=1'));
    assert.equal(new URL(calls[0]).searchParams.get('id').split(',').length, 20);
    assert.equal(items.length, 2);
  } finally {
    global.fetch = realFetch;
    delete process.env.BGG_API_TOKEN;
  }
});
