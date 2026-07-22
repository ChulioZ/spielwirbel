'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const bgg = require('../lib/providers/bgg');

// Sample bodies in the exact shape BGG's XML API2 returns (#117).

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
    <link type="boardgamecategory" id="1015" value="Civilization"/>
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
  });
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
