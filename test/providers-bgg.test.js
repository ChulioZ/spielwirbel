'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const bgg = require('../lib/providers/bgg');

// Sample bodies in the exact shape BGG's XML API2 returns (#117).
// PROVENANCE: hand-written when #117 moved the provider onto the licensed XML
// API2 (2026-07-22) — NOT a live capture. Load-bearing premises: /search and
// /thing carry names/counts as `value` ATTRIBUTES while /collection uses text
// nodes + `objectid` (see test/bgg-import.test.js and
// .claude/rules/bgg-collection-import.md §1), and an unknown username is an
// HTTP 200 error document. A fixture can only prove the parser, never what BGG
// serves today — probe live when touching it.

const SEARCH_XML = `<?xml version="1.0" encoding="utf-8"?>
<items total="3" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item type="boardgame" id="13">
    <name type="primary" value="CATAN"/>
    <yearpublished value="1995"/>
  </item>
  <item type="boardgameexpansion" id="926">
    <name type="primary" value="Catan: Cities &amp; Knights"/>
    <yearpublished value="1998"/>
  </item>
  <item type="boardgame" id="325">
    <name type="alternate" value="Die Siedler von Catan"/>
    <yearpublished value="1995"/>
  </item>
</items>`;

const THING_XML = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item type="boardgame" id="13">
    <thumbnail>https://cf.geekdo-images.com/abc__thumb/img/xyz=/fit-in/200x150/filters:strip_icc()/pic9156909.png</thumbnail>
    <image>https://cf.geekdo-images.com/abc__original/img/uvw=/0x0/filters:format(png)/pic9156909.png</image>
    <name type="primary" sortindex="1" value="CATAN"/>
    <name type="alternate" sortindex="1" value="Die Siedler von Catan"/>
    <description>Sammle Rohstoffe &amp; baue St&#228;dte.</description>
    <yearpublished value="1995"/>
    <minplayers value="3"/>
    <maxplayers value="4"/>
    <playingtime value="120"/>
    <minplaytime value="60"/>
    <maxplaytime value="120"/>
    <statistics page="1">
      <ratings>
        <usersrated value="143634"/>
        <average value="7.09054"/>
        <bayesaverage value="6.90221"/>
        <ranks>
          <rank type="subtype" id="1" name="boardgame" friendlyname="Board Game Rank" value="627" bayesaverage="6.90221"/>
        </ranks>
        <numweights value="8594"/>
        <averageweight value="2.2809"/>
      </ratings>
    </statistics>
    <link type="boardgamecategory" id="1015" value="Civilization"/>
    <link type="boardgameexpansion" id="325" value="CATAN: Seafarers"/>
    <link type="boardgameexpansion" id="926" value="CATAN: Cities &amp; Knights"/>
  </item>
</items>`;

// A /xmlapi2/collection?…&stats=1 answer. Structurally UNLIKE the two above:
// the name is a text node, not a `value` attribute, and the player counts are
// attributes of the <stats> child (see parseCollection).
const COLLECTION_XML = `<?xml version="1.0" encoding="utf-8"?>
<items totalitems="3" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item objecttype="thing" objectid="13" subtype="boardgame" collid="1">
    <name sortindex="1">CATAN</name>
    <yearpublished>1995</yearpublished>
    <image>https://cf.geekdo-images.com/abc__original/img/uvw=/0x0/pic9156909.png</image>
    <thumbnail>https://cf.geekdo-images.com/abc__thumb/img/xyz=/fit-in/200x150/pic9156909.png</thumbnail>
    <stats minplayers="3" maxplayers="4" playingtime="120">
      <rating value="N/A"><average value="7.1"/></rating>
    </stats>
    <status own="1" prevowned="0"/>
    <numplays>4</numplays>
  </item>
  <item objecttype="thing" objectid="822" subtype="boardgame" collid="2">
    <name sortindex="1">Tigris &amp; Euphrates</name>
    <stats minplayers="0" maxplayers="0"/>
    <status own="1"/>
  </item>
  <item objecttype="thing" objectid="2093" subtype="boardgameaccessory" collid="3">
    <name sortindex="1">Spielbrett</name>
    <stats minplayers="1" maxplayers="6"/>
    <status own="1"/>
  </item>
</items>`;

// --- decodeXml -----------------------------------------------------------

test('decodeXml resolves named and numeric entities, and leaves unknown ones alone', () => {
  assert.equal(bgg.decodeXml('Tigris &amp; Euphrates'), 'Tigris & Euphrates');
  assert.equal(bgg.decodeXml('&lt;b&gt;&quot;x&quot;&apos;'), '<b>"x"\'');
  assert.equal(bgg.decodeXml('St&#228;dte &#x26; Ritter'), 'Städte & Ritter');
  // An entity we don't know must survive verbatim rather than vanish.
  assert.equal(bgg.decodeXml('a&nbsp;b'), 'a&nbsp;b');
  // Out-of-range code points can't be allowed to throw.
  assert.equal(bgg.decodeXml('&#x110000;'), '&#x110000;');
});

// --- parseItems ----------------------------------------------------------

test('parseItems reads attributes and text nodes, and never throws on junk', () => {
  const [item] = bgg.parseItems(THING_XML);
  assert.equal(item.attrs.id, '13');
  assert.equal(item.attrs.type, 'boardgame');
  assert.equal(item.children.filter((c) => c.name === 'name').length, 2);
  assert.match(item.children.find((c) => c.name === 'thumbnail').text, /__thumb/);
  assert.equal(item.children.find((c) => c.name === 'minplayers').attrs.value, '3');
  assert.deepEqual(bgg.parseItems(''), []);
  assert.deepEqual(bgg.parseItems(null), []);
  assert.deepEqual(bgg.parseItems('<items>truncated'), []);
  assert.deepEqual(bgg.parseItems('not xml at all'), []);
  // A childless item may arrive self-closing; it must still be seen (and then
  // dropped by parseSearch for having no name, rather than swallow the next one).
  const [empty, named] = bgg.parseItems('<items><item id="1"/><item id="2"><name value="X"/></item></items>');
  assert.deepEqual(empty, { attrs: { id: '1' }, children: [] });
  assert.equal(named.attrs.id, '2');
});

test('parseItems cannot be made to backtrack exponentially (js/redos)', () => {
  // An unterminated tag full of empty quoted runs is the shape CodeQL flagged:
  // with overlapping alternatives ("" matchable as one quoted run OR as two
  // bare characters) this hangs the request instead of degrading to []. A
  // truncated upstream body is not hypothetical, which is what makes it a DoS.
  const evil = '<-' + '""'.repeat(2000);
  const started = Date.now();
  assert.deepEqual(bgg.parseItems(evil), []);
  assert.ok(Date.now() - started < 1000, 'parse must stay linear on a pathological body');
});

test('parseItems survives a raw ">" inside an attribute value', () => {
  // XML permits an unescaped '>' in an attribute value, and game titles use it
  // ("6 nimmt! > 10"). A naive /<[^>]*>/ scan would cut the tag in half and
  // silently drop the item.
  const xml = '<items><item type="boardgame" id="7"><name type="primary" value="A > B"/></item></items>';
  const [item] = bgg.parseItems(xml);
  assert.equal(item.attrs.id, '7');
  assert.equal(item.children[0].attrs.value, 'A > B');
});

// --- scoreName (search relevance) ----------------------------------------

test('scoreName ranks exact over prefix over substring, ignoring case/diacritics', () => {
  assert.equal(bgg.scoreName('CATAN', 'catan'), 4);
  assert.equal(bgg.scoreName('Catan: Cities & Knights', 'catan'), 3);
  assert.equal(bgg.scoreName('Catania', 'catan'), 2);
  assert.equal(bgg.scoreName('Die Siedler von Catan', 'catan'), 1);
  assert.equal(bgg.scoreName('Wingspan', 'catan'), 0);
  // Punctuation, umlauts and ß fold away, so a typed query still matches.
  assert.equal(bgg.scoreName('Noch mal so gut!', 'noch mal so gut'), 4);
  assert.equal(bgg.scoreName('Mörderische Straße', 'morderische strasse'), 4);
  assert.equal(bgg.scoreName('anything', ''), 0);
  // Non-Latin scripts must SURVIVE the fold. Stripping them would reduce this
  // real BGG title to a bare "catan" and rank an obscure edition as an exact
  // match for the base game (seen live).
  assert.equal(bgg.scoreName('Catan Двубоят', 'catan'), 3);
  assert.equal(bgg.scoreName('Catan', 'catan'), 4);
});

// --- parseSearch ---------------------------------------------------------

test('parseSearch normalizes items to { providerId, title, thumbnail:null }', () => {
  const out = bgg.parseSearch(SEARCH_XML, 8, 'catan');
  assert.deepEqual(out, [
    { providerId: '13', title: 'CATAN', thumbnail: null },
    { providerId: '926', title: 'Catan: Cities & Knights', thumbnail: null },
    { providerId: '325', title: 'Die Siedler von Catan', thumbnail: null },
  ]);
});

test('parseSearch ranks by relevance, not by BGG response order', () => {
  // BGG's search has no relevance order of its own, so an unranked slice would
  // drop the game the user meant behind arbitrary near-matches.
  const xml = `<items>
    <item type="boardgame" id="1"><name type="primary" value="Wingspan: Oceania Expansion"/></item>
    <item type="boardgame" id="2"><name type="primary" value="Wingspan Asia"/></item>
    <item type="boardgame" id="3"><name type="primary" value="Wingspan"/></item>
  </items>`;
  assert.deepEqual(bgg.parseSearch(xml, 8, 'wingspan').map((r) => r.providerId), ['3', '2', '1']);
});

test('parseSearch keeps the name that MATCHED, so a German query yields the German title', () => {
  // The German name is an alternate; taking the primary would hand back "CATAN"
  // and undo the localization the user typed (#117).
  const xml = `<items><item type="boardgame" id="13">
      <name type="alternate" value="Die Siedler von Catan"/>
      <name type="primary" value="CATAN"/>
    </item></items>`;
  assert.equal(bgg.parseSearch(xml, 8, 'siedler')[0].title, 'Die Siedler von Catan');
  // …and an English query on the same item still gets the primary name.
  assert.equal(bgg.parseSearch(xml, 8, 'catan')[0].title, 'CATAN');
});

test('parseSearch dedupes by id, drops nameless/non-numeric items, respects the limit', () => {
  const xml = `<items>
    <item type="boardgame" id="13"><name type="primary" value="Catan"/></item>
    <item type="boardgame" id="13"><name type="primary" value="Catan (dupe)"/></item>
    <item type="boardgame" id="x9"><name type="primary" value="Bad id"/></item>
    <item type="boardgame" id="42"></item>
    <item type="boardgame" id="43"><name type="primary" value="Catan Junior"/></item>
  </items>`;
  assert.deepEqual(bgg.parseSearch(xml, 8, 'catan').map((r) => r.providerId), ['13', '43']);
  assert.equal(bgg.parseSearch(xml, 1, 'catan').length, 1);
  assert.deepEqual(bgg.parseSearch('', 8, 'catan'), []);
});

// --- parseThing ----------------------------------------------------------

test('parseThing normalizes a BGG item (analog, players, cover, url)', () => {
  assert.deepEqual(bgg.parseThing(THING_XML, '13'), {
    provider: 'bgg',
    externalId: '13',
    title: 'CATAN',
    minPlayers: 3,
    maxPlayers: 4,
    type: 'analog',
    imageUrl: 'https://cf.geekdo-images.com/abc__thumb/img/xyz=/fit-in/200x150/filters:strip_icc()/pic9156909.png',
    url: 'https://boardgamegeek.com/boardgame/13',
    // The 1–5 float, NOT the community `average` (7.09054) sitting right beside
    // it in the flattened child list — the deepEqual is what proves the exact-
    // name match, and 2.2809 also proves the float survives (parseInt would
    // store 2). The description is the decoded text node, stored unmodified.
    weight: 2.2809,
    description: 'Sammle Rohstoffe & baue Städte.',
    expansions: [
      { providerId: '325', title: 'CATAN: Seafarers' },
      { providerId: '926', title: 'CATAN: Cities & Knights' },
    ],
  });
});

// --- weight + description (#717) ------------------------------------------

test('weight and description are null-shaped when the body lacks them', () => {
  // The token-absent path (empty body) and a bare item — the fields must exist
  // as nulls so the null-shaped-product contract holds (`detail()` without a
  // token, a game with no weight votes yet).
  const empty = bgg.parseThing('', '13');
  assert.equal(empty.weight, null);
  assert.equal(empty.description, null);
  // averageweight="0" is BGG's "no votes yet" and must read as null, like every
  // other zero-means-unknown attribute in the file.
  const zero = `<items><item type="boardgame" id="1">
    <name type="primary" value="X"/>
    <statistics><ratings><average value="6.5"/><averageweight value="0"/></ratings></statistics>
  </item></items>`;
  assert.equal(bgg.parseThing(zero, '1').weight, null);
});

test('no community score is ever imported — rank, average, bayesaverage stay out', () => {
  // The user feedback explicitly called rank and average rating
  // counterproductive; the fixture carries all three siblings, so their absence
  // here is a real exclusion rather than a vacuous one.
  const d = bgg.parseThing(THING_XML, '13');
  for (const key of ['average', 'bayesaverage', 'rank', 'usersrated']) {
    assert.ok(!(key in d), `parseThing imported the community score "${key}"`);
  }
});

test('gameInfo batches past 60 ids like expansionParents, sequentially', async (t) => {
  /* An import is the one bulk entry point (#717 follow-up): a 130-game shelf
   * must not silently fill only the first 60 — the rest would stay field-less
   * AND unstamped, invisible until someone opens each detail page. Same batch
   * size and ceiling as expansionParents. */
  process.env.BGG_API_TOKEN = 'test-token';
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    const ids = new URL(String(url)).searchParams.get('id').split(',');
    return { status: 200, text: async () => `<items>${ids
      .map((id) => `<item type="boardgame" id="${id}"><name type="primary" value="G${id}"/>
        <statistics><ratings><averageweight value="2.5"/></ratings></statistics></item>`)
      .join('')}</items>` };
  };
  t.after(() => { global.fetch = original; delete process.env.BGG_API_TOKEN; });

  const ids = Array.from({ length: 130 }, (_, i) => String(100000 + i));
  const out = await bgg.gameInfo(ids);
  assert.equal(calls.length, 3, '130 ids ride three batches of <= 60');
  for (const u of calls) {
    assert.ok(new URL(u).searchParams.get('id').split(',').length <= 60);
    assert.match(u, /stats=1/);
  }
  assert.equal(out.length, 130, 'every batch\'s items are concatenated');
});

test('parseGameInfo reads a MULTI-item stats body for the backfill', () => {
  const xml = `<items>
    <item type="boardgame" id="13">
      <name type="primary" value="CATAN"/>
      <description>Handel &amp; Bau.</description>
      <statistics><ratings><average value="7.1"/><averageweight value="2.28"/></ratings></statistics>
    </item>
    <item type="boardgame" id="822">
      <name type="primary" value="Carcassonne"/>
      <statistics><ratings><averageweight value="0"/></ratings></statistics>
    </item>
  </items>`;
  assert.deepEqual(bgg.parseGameInfo(xml), [
    { providerId: '13', weight: 2.28, description: 'Handel & Bau.' },
    // A game the community has not weighted, with no description: both null, so
    // the backfill can stamp the attempt without inventing data.
    { providerId: '822', weight: null, description: null },
  ]);
  assert.deepEqual(bgg.parseGameInfo(''), []);
});

// --- expansions (#653) ----------------------------------------------------

test('parseThing drops the INBOUND expansion link, so a game is never its own expansion', () => {
  // What /thing?id=<an expansion> answers: the same link type, pointing BACK at
  // the base game. Without the filter, opening the tick-list for an expansion
  // offers the base game as one of its expansions.
  const xml = `<items><item type="boardgameexpansion" id="926">
    <name type="primary" value="Cities &amp; Knights"/>
    <link type="boardgameexpansion" id="13" value="CATAN" inbound="true"/>
    <link type="boardgameexpansion" id="2000" value="Cities &amp; Knights: 5-6 Player Extension"/>
  </item></items>`;
  assert.deepEqual(bgg.parseThing(xml, '926').expansions, [
    { providerId: '2000', title: 'Cities & Knights: 5-6 Player Extension' },
  ]);
});

test('parseThing reports an empty expansion list rather than omitting the key', () => {
  // The token-absent and empty-body paths answer with this shape too, so the
  // client can render the section without a presence check.
  assert.deepEqual(bgg.parseThing('', '13').expansions, []);
  const bare = '<items><item type="boardgame" id="1"><name type="primary" value="X"/></item></items>';
  assert.deepEqual(bgg.parseThing(bare, '1').expansions, []);
});

test('parseExpansionDetails reads a MULTI-item /thing body into stored-expansion shape', () => {
  // One request for every ticked box: /thing?id=325,926 answers both items.
  const xml = `<items>
    <item type="boardgameexpansion" id="325">
      <name type="primary" value="CATAN: Seafarers"/>
      <minplayers value="3"/><maxplayers value="4"/>
    </item>
    <item type="boardgameexpansion" id="2000">
      <name type="alternate" value="Nur alternativ"/>
      <minplayers value="0"/><maxplayers value="0"/>
    </item>
  </items>`;
  assert.deepEqual(bgg.parseExpansionDetails(xml), [
    {
      providerId: '325',
      title: 'CATAN: Seafarers',
      minPlayers: 3,
      maxPlayers: 4,
      url: 'https://boardgamegeek.com/boardgameexpansion/325',
    },
    {
      // BGG's "0 = unknown" must read as null — and a null range widens NOTHING
      // on an expansion, which is the opposite of what it means on a base game.
      providerId: '2000',
      title: 'Nur alternativ',
      minPlayers: null,
      maxPlayers: null,
      url: 'https://boardgamegeek.com/boardgameexpansion/2000',
    },
  ]);
  assert.deepEqual(bgg.parseExpansionDetails(''), []);
  assert.deepEqual(bgg.parseExpansionDetails('not xml'), []);
});

test('expansionDetails batches every id into ONE request and degrades without a token', async () => {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, text: async () => '<items></items>' };
  };
  const originalToken = process.env.BGG_API_TOKEN;
  try {
    process.env.BGG_API_TOKEN = 'tok';
    await bgg.expansionDetails(['325', '926', '325', '', null]);
    assert.equal(calls.length, 1, 'one request for the whole batch');
    // Deduped, and the ids ride in one comma-separated `id` parameter.
    assert.equal(new URL(calls[0]).searchParams.get('id'), '325,926');

    delete process.env.BGG_API_TOKEN;
    assert.deepEqual(await bgg.expansionDetails(['325']), []);
    assert.deepEqual(await bgg.expansionDetails([]), []);
    assert.equal(calls.length, 1, 'neither made a request');
  } finally {
    global.fetch = original;
    if (originalToken === undefined) delete process.env.BGG_API_TOKEN;
    else process.env.BGG_API_TOKEN = originalToken;
  }
});

// --- parseExpansionParents / expansionParents (#664) ----------------------

test('parseExpansionParents reads the INBOUND links, i.e. the inverse of parseExpansionLinks', () => {
  // On an expansion item BGG marks the "expands X" relation with inbound="true"
  // and the SAME type it uses for "is expanded by Y" on a base game. Reading
  // both would report an expansion's own sub-expansion as its base game.
  const xml = `<items>
    <item type="boardgameexpansion" id="325">
      <name type="primary" value="CATAN: Seafarers"/>
      <link type="boardgameexpansion" id="13" value="CATAN" inbound="true"/>
      <link type="boardgameexpansion" id="99999" value="Seafarers Scenario Pack"/>
      <link type="boardgamecategory" id="1029" value="City Building" inbound="true"/>
    </item>
    <item type="boardgameexpansion" id="4001">
      <name type="primary" value="Promo fitting two games"/>
      <link type="boardgameexpansion" id="13" value="CATAN" inbound="true"/>
      <link type="boardgameexpansion" id="822" value="Tigris &amp; Euphrates" inbound="true"/>
    </item>
    <item type="boardgameexpansion" id="4002">
      <name type="primary" value="Orphan"/>
    </item>
    <item type="boardgame" id="13">
      <name type="primary" value="CATAN"/>
      <link type="boardgameexpansion" id="325" value="CATAN: Seafarers"/>
    </item>
  </items>`;
  assert.deepEqual(bgg.parseExpansionParents(xml), [
    { providerId: '325', parents: [{ providerId: '13', title: 'CATAN' }], expansion: true },
    // An expansion's inbound links are a LIST — a promo can fit two base games,
    // so all of them are kept and the acquire flow asks which one it belongs to.
    {
      providerId: '4001',
      parents: [
        { providerId: '13', title: 'CATAN' },
        { providerId: '822', title: 'Tigris & Euphrates' },
      ],
      expansion: true,
    },
    // No inbound link at all: an UNATTACHED wish, never dropped from the
    // import. `expansion` is what keeps it distinguishable from a base game,
    // which ALSO yields no inbound links (#703) — parents alone cannot answer
    // "is this an expansion?".
    { providerId: '4002', parents: [], expansion: true },
    // The base-game control: outbound links only, and expansion: false.
    { providerId: '13', parents: [], expansion: false },
  ]);
  assert.deepEqual(bgg.parseExpansionParents(''), []);
  assert.deepEqual(bgg.parseExpansionParents('not xml'), []);
});

test('expansionParents batches ids and degrades to [] without a token', async () => {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, text: async () => '<items></items>' };
  };
  const originalToken = process.env.BGG_API_TOKEN;
  try {
    process.env.BGG_API_TOKEN = 'tok';
    await bgg.expansionParents(['325', '926', '325', '', null]);
    assert.equal(calls.length, 1, 'one request for the whole batch');
    assert.equal(new URL(calls[0]).searchParams.get('id'), '325,926');

    // Over one batch it splits rather than building an unbounded URL.
    calls.length = 0;
    await bgg.expansionParents(Array.from({ length: 61 }, (_, i) => String(i + 1)));
    assert.equal(calls.length, 2, 'a 61-id list is two requests, not one');
    assert.equal(new URL(calls[0]).searchParams.get('id').split(',').length, 60);
    assert.equal(new URL(calls[1]).searchParams.get('id'), '61');

    delete process.env.BGG_API_TOKEN;
    calls.length = 0;
    assert.deepEqual(await bgg.expansionParents(['325']), []);
    assert.deepEqual(await bgg.expansionParents([]), []);
    assert.equal(calls.length, 0, 'neither made a request');
  } finally {
    global.fetch = original;
    if (originalToken === undefined) delete process.env.BGG_API_TOKEN;
    else process.env.BGG_API_TOKEN = originalToken;
  }
});

test('collection() excludes expansions from the OWNED shelf only (#664)', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url) => {
    calls.push(new URL(String(url)));
    return { ok: true, status: 200, text: async () => '<items></items>' };
  });
  const originalToken = process.env.BGG_API_TOKEN;
  process.env.BGG_API_TOKEN = 'tok';
  t.after(() => {
    if (originalToken === undefined) delete process.env.BGG_API_TOKEN;
    else process.env.BGG_API_TOKEN = originalToken;
  });

  await bgg.collection('someone', 'own');
  assert.equal(calls[0].searchParams.get('excludesubtype'), 'boardgameexpansion');
  assert.equal(calls.length, 1, 'the owned shelf needs no expansion probe (#702)');
  // The wishlist is where an expansion is exactly what the group means to record
  // ("we own Catan, we want Seefahrer"), so it must NOT be filtered out.
  await bgg.collection('someone', 'wishlist');
  assert.equal(calls[1].searchParams.get('wishlist'), '1');
  assert.equal(calls[1].searchParams.get('excludesubtype'), null);
  // …and a SECOND, subtype-scoped request marks which items are expansions,
  // because the main body's subtype attribute lies (#702). Same shelf, no stats.
  assert.equal(calls.length, 3);
  assert.equal(calls[2].searchParams.get('wishlist'), '1');
  assert.equal(calls[2].searchParams.get('subtype'), 'boardgameexpansion');
  assert.equal(calls[2].searchParams.get('stats'), null);
  // An unrecognised status still falls back to the owned shelf, filter included.
  await bgg.collection('someone', '__proto__');
  assert.equal(calls[3].searchParams.get('own'), '1');
  assert.equal(calls[3].searchParams.get('excludesubtype'), 'boardgameexpansion');
});

test('parseThing links an expansion under its own BGG path', () => {
  const xml = '<items><item type="boardgameexpansion" id="926"><name type="primary" value="Cities &amp; Knights"/></item></items>';
  assert.equal(bgg.parseThing(xml, '926').url, 'https://boardgamegeek.com/boardgameexpansion/926');
});

test('parseThing falls back to a constructed url and never throws on an empty body', () => {
  // Also the token-absent path: detail() answers with exactly this shape, so an
  // already-linked game keeps its working "View on BoardGameGeek" link.
  const d = bgg.parseThing('', '13');
  assert.equal(d.provider, 'bgg');
  assert.equal(d.title, null);
  assert.equal(d.minPlayers, null);
  assert.equal(d.type, 'analog');
  assert.equal(d.imageUrl, null);
  assert.equal(d.url, 'https://boardgamegeek.com/boardgame/13');
});

test('parseThing treats BGG "0"/unknown numbers as null', () => {
  const xml = '<items><item type="boardgame" id="1"><name type="primary" value="X"/><minplayers value="0"/><maxplayers value="0"/></item></items>';
  const d = bgg.parseThing(xml, '1');
  assert.equal(d.minPlayers, null);
  assert.equal(d.maxPlayers, null);
});

// --- parseCollection (#481) ----------------------------------------------

test('parseCollection reads the collection shape into the same record parseThing produces', () => {
  const { invalidUser, items } = bgg.parseCollection(COLLECTION_XML);
  assert.equal(invalidUser, false);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    provider: 'bgg',
    externalId: '13',
    title: 'CATAN',
    minPlayers: 3,
    maxPlayers: 4,
    type: 'analog',
    imageUrl: 'https://cf.geekdo-images.com/abc__thumb/img/xyz=/fit-in/200x150/pic9156909.png',
    url: 'https://boardgamegeek.com/boardgame/13',
    expansion: false,
  });
  // The name is a TEXT node here, so an entity in it must still be decoded, and
  // BGG's "0 = unknown" player counts must read as null exactly as in parseThing.
  assert.equal(items[1].title, 'Tigris & Euphrates');
  assert.equal(items[1].minPlayers, null);
  assert.equal(items[1].maxPlayers, null);
  assert.equal(items[1].imageUrl, null);
  // The item's own subtype keeps the link canonical rather than assuming /boardgame/.
  assert.equal(items[2].url, 'https://boardgamegeek.com/boardgameaccessory/2093');
});

test('parseCollection marks which items are expansions (#664)', () => {
  // A collection item names its own subtype, which is the ONLY thing the
  // response says about an expansion — it carries no <link> elements at all, so
  // *which* game it expands needs the separate /thing hop below.
  const xml = `<items>
    <item objectid="13" subtype="boardgame"><name>CATAN</name></item>
    <item objectid="325" subtype="boardgameexpansion"><name>CATAN: Seafarers</name></item>
    <item objectid="2093" subtype="boardgameaccessory"><name>Spielbrett</name></item>
  </items>`;
  assert.deepEqual(bgg.parseCollection(xml).items.map((g) => g.expansion), [false, true, false]);
  // Absent subtype falls back to 'boardgame', so it must not read as an expansion.
  const bare = '<items><item objectid="7"><name>Ohne Subtype</name></item></items>';
  assert.equal(bgg.parseCollection(bare).items[0].expansion, false);
});

test('parseCollection skips junk and dupes, and never throws on an empty body', () => {
  const xml = `<items>
    <item objectid="13" subtype="boardgame"><name>Catan</name></item>
    <item objectid="13" subtype="boardgame"><name>Catan (dupe collid)</name></item>
    <item objectid="x9" subtype="boardgame"><name>Bad id</name></item>
    <item objectid="42" subtype="boardgame"></item>
  </items>`;
  assert.deepEqual(bgg.parseCollection(xml).items.map((g) => g.externalId), ['13']);
  assert.deepEqual(bgg.parseCollection('').items, []);
  assert.deepEqual(bgg.parseCollection(null).items, []);
});

test('parseCollection tells an unknown username apart from an empty collection', () => {
  // BGG serves this with HTTP 200, so it parses to zero items and is otherwise
  // indistinguishable from a real collection with nothing marked as owned — and
  // the two need opposite messages.
  const err = '<?xml version="1.0"?><errors><error><message>Invalid username specified</message></error></errors>';
  assert.equal(bgg.parseCollection(err).invalidUser, true);
  assert.equal(bgg.parseCollection('<items totalitems="0"></items>').invalidUser, false);
  // A title containing the word cannot fake the error document: '<' is encoded
  // inside every text node and attribute.
  const safe = '<items><item objectid="7" subtype="boardgame"><name>Error 404: The Game</name></item></items>';
  assert.equal(bgg.parseCollection(safe).invalidUser, false);
  assert.equal(bgg.parseCollection(safe).items.length, 1);
});

// --- parseVersions (#519) -------------------------------------------------

// PROVENANCE: captured live from
// `GET /xmlapi2/thing?id=342942&versions=1` (Ark Nova) on 2026-07-28 with this
// repo's BGG_API_TOKEN, then trimmed to six versions — the real body carries 37.
// The whitespace soup between elements is BGG's own and is kept deliberately:
// it is what a text-node scanner has to survive.
//
// The trimmed set keeps every shape the parser has to handle: a German edition,
// an English one, a non-Latin one, a version whose thumbnail is MISSING (10 of
// 145 on Catan), two versions sharing ONE thumbnail URL (Ark Nova's 35 covers
// are 19 distinct URLs), and a `yearpublished value="0"` unknown year.
const VERSIONS_XML = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse"><item type="boardgame" id="342942">
      <thumbnail>https://cf.geekdo-images.com/SoU8p28Sk1s8MSvoM4N8pQ__small/img/x=/fit-in/200x150/filters:strip_icc()/pic6293412.jpg</thumbnail>
      <image>https://cf.geekdo-images.com/SoU8p28Sk1s8MSvoM4N8pQ__original/img/y=/0x0/pic6293412.jpg</image>
      <name type="primary" sortindex="1" value="Ark Nova" />
      <minplayers value="1" />
      <maxplayers value="4" />
      <versions><item type="boardgameversion" id="591904">
         <thumbnail>https://cf.geekdo-images.com/tCZw__small/img/a=/fit-in/200x150/filters:strip_icc()/pic6569437.jpg</thumbnail>
      <image>https://cf.geekdo-images.com/tCZw__original/img/b=/0x0/pic6569437.jpg</image>
   \t\t\t<canonicalname value="方舟动物园"></canonicalname>

\t\t\t\t\t<link type="boardgameversion" id="342942" value="Ark Nova" inbound="true"/>

\t\t\t\t<name type="primary" sortindex="1" value="Chinese edition" />

\t\t\t\t\t<link type="boardgamepublisher" id="12540" value="Game Harbor" />

\t\t\t\t<yearpublished value="2021" />
\t\t\t\t<productcode value="" />

\t\t\t\t\t<link type="language" id="2181" value="Chinese" />

</item>
<item type="boardgameversion" id="623699">
         <thumbnail>https://cf.geekdo-images.com/4YNq__small/img/c=/fit-in/200x150/filters:strip_icc()/pic7100185.jpg</thumbnail>
      <image>https://cf.geekdo-images.com/4YNq__original/img/d=/0x0/pic7100185.jpg</image>
\t\t\t\t<name type="primary" sortindex="1" value="German edition, fifth printing" />
\t\t\t\t<yearpublished value="2022" />
\t\t\t\t\t<link type="language" id="2188" value="German" />
</item>
<item type="boardgameversion" id="623700">
         <thumbnail>https://cf.geekdo-images.com/4YNq__small/img/c=/fit-in/200x150/filters:strip_icc()/pic7100185.jpg</thumbnail>
\t\t\t\t<name type="primary" sortindex="1" value="German edition, eigth printing" />
\t\t\t\t<yearpublished value="2023" />
\t\t\t\t\t<link type="language" id="2188" value="German" />
</item>
<item type="boardgameversion" id="789012">
   \t\t\t<canonicalname value="Ark Nova"></canonicalname>
\t\t\t\t<name type="primary" sortindex="1" value="English 2.1 edition" />
\t\t\t\t<yearpublished value="2025" />
\t\t\t\t\t<link type="language" id="2184" value="English" />
</item>
<item type="boardgameversion" id="591905">
         <thumbnail>https://cf.geekdo-images.com/eNgL__small/img/e=/fit-in/200x150/filters:strip_icc()/pic5000001.jpg</thumbnail>
\t\t\t\t<name type="primary" sortindex="1" value="English first edition" />
\t\t\t\t<yearpublished value="2021" />
\t\t\t\t\t<link type="language" id="2184" value="English" />
</item>
<item type="boardgameversion" id="591906">
         <thumbnail>https://cf.geekdo-images.com/uKNw__small/img/f=/fit-in/200x150/filters:strip_icc()/pic5000002.jpg</thumbnail>
\t\t\t\t<name type="primary" sortindex="1" value="Multilingual first edition" />
\t\t\t\t<yearpublished value="0" />
\t\t\t\t\t<link type="language" id="2184" value="English" />
\t\t\t\t\t<link type="language" id="2188" value="German" />
</item>
</versions>
</item>
</items>`;

test('parseVersions reads every edition of a real versions=1 body', () => {
  const versions = bgg.parseVersions(VERSIONS_XML);
  // The game's own <thumbnail>/<name> sit OUTSIDE <versions> and must not arrive
  // here as a sixth "edition". Note what does and does not prove the slice: on
  // THIS body parseItems already loses the game item (that IS the trap, pinned
  // below), so dropping the slice changes nothing here — what the slice actually
  // buys is the empty answer for a body with no <versions> at all, which the
  // fourth test pins and which does go red without it. Verified by removing the
  // slice on purpose.
  assert.deepEqual(versions.map((v) => v.edition), [
    'Chinese edition',
    'German edition, fifth printing',
    'German edition, eigth printing',
    'English first edition',
    'Multilingual first edition',
  ]);
  assert.equal(versions.every((v) => !/pic6293412/.test(v.imageUrl)), true);
  assert.deepEqual(versions[1], {
    imageUrl: 'https://cf.geekdo-images.com/4YNq__small/img/c=/fit-in/200x150/filters:strip_icc()/pic7100185.jpg',
    edition: 'German edition, fifth printing',
    year: 2022,
    languages: ['German'],
  });
  // A version may be published in more than one language.
  assert.deepEqual(versions[4].languages, ['English', 'German']);
});

test('parseVersions drops versions with no thumbnail, and treats year "0" as unknown', () => {
  const versions = bgg.parseVersions(VERSIONS_XML);
  // "English 2.1 edition" has no <thumbnail> — measured 10 of 145 on Catan.
  // Kept, it renders as an empty tile.
  assert.equal(versions.some((v) => v.edition === 'English 2.1 edition'), false);
  assert.equal(versions.every((v) => typeof v.imageUrl === 'string' && v.imageUrl), true);
  assert.equal(versions.find((v) => v.edition === 'Multilingual first edition').year, null);
});

test('parseVersions takes the thumbnail, never the untouchable full-size master', () => {
  // Same reasoning as pickImage: geekdo signs its resize paths, so a stored
  // <image> master (68 KB – 2.0 MB) can never be shrunk at render time.
  assert.equal(bgg.parseVersions(VERSIONS_XML).every((v) => v.imageUrl.includes('__small/')), true);
});

test('parseVersions never throws, and yields [] for a body with no <versions>', () => {
  // A plain /thing body — the shape every other hop gets — must produce nothing
  // rather than mistaking the game for one of its own editions.
  assert.deepEqual(bgg.parseVersions(THING_XML), []);
  assert.deepEqual(bgg.parseVersions(''), []);
  assert.deepEqual(bgg.parseVersions(null), []);
  assert.deepEqual(bgg.parseVersions('<items><versions>'), []); // truncated
});

test('parseThing is unchanged by the versions body it must never be handed', () => {
  // The trap this whole slice exists for: parseItems handles a FLAT item list,
  // so on a versions=1 body the nested items overwrite `current` and the game
  // item disappears entirely — parseThing would then report a VERSION's title
  // as the game's. Reproduced live on 2026-07-28 (Catan: 145 items, first one a
  // boardgameversion, no game item anywhere).
  const items = bgg.parseItems(VERSIONS_XML);
  assert.equal(items[0].attrs.type, 'boardgameversion');
  assert.equal(items.some((i) => i.attrs.type === 'boardgame'), false);
  // parseThing's own contract on a PLAIN body is untouched by #519.
  assert.equal(bgg.parseThing(THING_XML, '13').title, 'CATAN');
});

// --- covers() transport (#519) --------------------------------------------

test('covers() asks for versions=1 and normalizes the answer', async (t) => {
  const realFetch = global.fetch;
  const realToken = process.env.BGG_API_TOKEN;
  t.after(() => {
    global.fetch = realFetch;
    if (realToken === undefined) delete process.env.BGG_API_TOKEN;
    else process.env.BGG_API_TOKEN = realToken;
  });
  process.env.BGG_API_TOKEN = 'test-token';
  let seenUrl = '';
  global.fetch = async (url) => {
    seenUrl = String(url);
    return { status: 200, text: async () => VERSIONS_XML };
  };
  const covers = await bgg.covers('342942');
  assert.equal(covers.length, 5);
  assert.match(seenUrl, /\/thing\?/);
  assert.match(seenUrl, /id=342942/);
  // Without this the answer is the ordinary detail body and the picker is empty.
  assert.match(seenUrl, /versions=1/);
});

test('covers() degrades to an empty list without a token, and never calls out', async (t) => {
  const realFetch = global.fetch;
  const realToken = process.env.BGG_API_TOKEN;
  t.after(() => {
    global.fetch = realFetch;
    if (realToken === undefined) delete process.env.BGG_API_TOKEN;
    else process.env.BGG_API_TOKEN = realToken;
  });
  delete process.env.BGG_API_TOKEN;
  let called = false;
  global.fetch = async () => { called = true; return { status: 200, text: async () => VERSIONS_XML }; };
  assert.deepEqual(await bgg.covers('342942'), []);
  assert.equal(called, false);
});

// --- collection() transport (#481) ---------------------------------------
//
// The four outcomes the import UI has to tell apart. `fetch` is stubbed, so no
// test here touches the network.

test('collection() maps the BGG answers onto its four states', async (t) => {
  const realFetch = global.fetch;
  const realToken = process.env.BGG_API_TOKEN;
  t.after(() => {
    global.fetch = realFetch;
    if (realToken === undefined) delete process.env.BGG_API_TOKEN;
    else process.env.BGG_API_TOKEN = realToken;
  });
  process.env.BGG_API_TOKEN = 'test-token';

  let seenUrl = '';
  global.fetch = async (url) => {
    seenUrl = String(url);
    return { status: 200, text: async () => COLLECTION_XML };
  };
  const ok = await bgg.collection('someuser');
  assert.equal(ok.state, 'ok');
  assert.equal(ok.items.length, 3);
  // Owned base games only: an expansion-laden shelf would otherwise bury the
  // games it belongs to in a bulk import.
  assert.match(seenUrl, /\/collection\?/);
  assert.match(seenUrl, /username=someuser/);
  assert.match(seenUrl, /own=1/);
  assert.match(seenUrl, /excludesubtype=boardgameexpansion/);
  assert.match(seenUrl, /stats=1/);

  global.fetch = async () => ({
    status: 200,
    text: async () => '<errors><error><message>Invalid username specified</message></error></errors>',
  });
  assert.equal((await bgg.collection('nobody')).state, 'invalid_user');

  global.fetch = async () => ({ status: 200, text: async () => '<items totalitems="0"></items>' });
  const empty = await bgg.collection('someuser');
  assert.equal(empty.state, 'ok');
  assert.deepEqual(empty.items, []);

  // A genuine upstream failure still throws, so the route can answer 502.
  global.fetch = async () => ({ status: 500, text: async () => '' });
  await assert.rejects(() => bgg.collection('someuser'));
});

test('collection() answers "queued" while BGG is still building the export', async (t) => {
  const realFetch = global.fetch;
  const realToken = process.env.BGG_API_TOKEN;
  t.after(() => {
    global.fetch = realFetch;
    if (realToken === undefined) delete process.env.BGG_API_TOKEN;
    else process.env.BGG_API_TOKEN = realToken;
  });
  process.env.BGG_API_TOKEN = 'test-token';
  // 202 is retried inside the shared 8 s budget and, if it never resolves, must
  // surface as its own state — NOT as an outage, and not by widening the budget
  // every search shares.
  global.fetch = async () => ({ status: 202, text: async () => '' });
  const res = await bgg.collection('someuser');
  assert.equal(res.state, 'queued');
  assert.deepEqual(res.items, []);
});

test('collection() degrades to an empty list without a token, and never calls out', async (t) => {
  const realFetch = global.fetch;
  const realToken = process.env.BGG_API_TOKEN;
  t.after(() => {
    global.fetch = realFetch;
    if (realToken === undefined) delete process.env.BGG_API_TOKEN;
    else process.env.BGG_API_TOKEN = realToken;
  });
  delete process.env.BGG_API_TOKEN;
  let called = false;
  global.fetch = async () => { called = true; return { status: 200, text: async () => '' }; };
  assert.deepEqual(await bgg.collection('someuser'), { state: 'ok', items: [] });
  // An empty username is the same no-op — the route resolves it from the
  // account, so a user who never linked one must not produce a request.
  assert.deepEqual(await bgg.collection(''), { state: 'ok', items: [] });
  assert.equal(called, false);
});

// --- pickImage -----------------------------------------------------------

test('pickImage takes the thumbnail, never the untouchable full-size master', () => {
  // <image> is the print master (68 KB – 2.0 MB) and geekdo signs its resize
  // paths, so cover-size.js cannot shrink it at render time — storing it would
  // reintroduce exactly the cover weight #298 removed.
  const [item] = bgg.parseItems(THING_XML);
  assert.match(bgg.pickImage(item.children), /__thumb\//);
  assert.equal(bgg.pickImage([{ name: 'image', attrs: {}, text: 'https://x/master.png' }]), null);
  assert.equal(bgg.pickImage([]), null);
  assert.equal(bgg.pickImage(null), null);
});

// --- imageHostAllowed (SSRF / cover-host guard) --------------------------

test('imageHostAllowed accepts BGG image hosts and rejects everything else', () => {
  assert.equal(bgg.imageHostAllowed('https://cf.geekdo-images.com/x/pic.png'), true);
  assert.equal(bgg.imageHostAllowed('https://geekdo-images.com/x/pic.png'), true);
  assert.equal(bgg.imageHostAllowed('https://sub.geekdo-images.com/x/pic.png'), true);
  assert.equal(bgg.imageHostAllowed('https://evil.com/x.png'), false);
  assert.equal(bgg.imageHostAllowed('https://notgeekdo-images.com/x.png'), false);
  assert.equal(bgg.imageHostAllowed('file:///etc/passwd'), false);
  assert.equal(bgg.imageHostAllowed('not a url'), false);
});
