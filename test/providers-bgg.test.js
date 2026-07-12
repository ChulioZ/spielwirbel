'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const bgg = require('../lib/providers/bgg');

// A trimmed but realistic BGG /search response.
const SEARCH_XML = `<?xml version="1.0" encoding="utf-8"?>
<items total="2" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item type="boardgame" id="13">
    <name type="primary" value="Catan"/>
    <yearpublished value="1995"/>
  </item>
  <item type="boardgame" id="13">
    <name type="alternate" value="Die Siedler von Catan"/>
    <yearpublished value="1995"/>
  </item>
  <item type="boardgame" id="822">
    <name type="primary" value="Carcassonne &amp; Friends"/>
    <yearpublished value="2000"/>
  </item>
</items>`;

// A trimmed BGG /thing response.
const THING_XML = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item type="boardgame" id="13">
    <thumbnail>https://cf.geekdo-images.com/thumb/catan.jpg</thumbnail>
    <image>https://cf.geekdo-images.com/original/catan.png</image>
    <name type="primary" sortindex="1" value="Catan"/>
    <name type="alternate" sortindex="1" value="Settlers"/>
    <yearpublished value="1995"/>
    <minplayers value="3"/>
    <maxplayers value="4"/>
    <playingtime value="120"/>
    <minplaytime value="60"/>
    <maxplaytime value="120"/>
  </item>
</items>`;

test('parseSearch dedupes ids, keeps primary name, decodes entities', () => {
  const out = bgg.parseSearch(SEARCH_XML);
  assert.equal(out.length, 2); // id 13 collapsed to one entry
  assert.deepEqual(out[0], { providerId: '13', title: 'Catan', year: '1995', thumbnail: null });
  assert.equal(out[1].title, 'Carcassonne & Friends');
});

test('parseSearch respects the limit', () => {
  assert.equal(bgg.parseSearch(SEARCH_XML, 1).length, 1);
});

test('parseSearch returns [] for an empty response', () => {
  assert.deepEqual(bgg.parseSearch('<items total="0"></items>'), []);
});

test('parseThing maps fields and picks the long duration bucket', () => {
  const d = bgg.parseThing(THING_XML);
  assert.equal(d.provider, 'bgg');
  assert.equal(d.externalId, '13');
  assert.equal(d.title, 'Catan');
  assert.equal(d.minPlayers, 3);
  assert.equal(d.maxPlayers, 4);
  assert.equal(d.type, 'analog');
  assert.equal(d.duration, 'long'); // 120 min > 90
  assert.equal(d.imageUrl, 'https://cf.geekdo-images.com/original/catan.png');
  assert.equal(d.url, 'https://boardgamegeek.com/boardgame/13');
});

test('parseThing returns null for an empty response', () => {
  assert.equal(bgg.parseThing('<items></items>'), null);
});

test('bucketDuration thresholds', () => {
  assert.equal(bgg.bucketDuration(20), 'short'); // < 30
  assert.equal(bgg.bucketDuration(30), 'medium'); // 30..90
  assert.equal(bgg.bucketDuration(90), 'medium');
  assert.equal(bgg.bucketDuration(91), 'long'); // > 90
  assert.equal(bgg.bucketDuration(0), null);
  assert.equal(bgg.bucketDuration('nope'), null);
});

test('imageHostAllowed only vouches for BGG image hosts', () => {
  assert.equal(bgg.imageHostAllowed('https://cf.geekdo-images.com/x.png'), true);
  assert.equal(bgg.imageHostAllowed('https://boardgamegeek.com/x.png'), true);
  assert.equal(bgg.imageHostAllowed('http://geekdo.com/x.png'), true);
  assert.equal(bgg.imageHostAllowed('https://evil.example.com/x.png'), false);
  assert.equal(bgg.imageHostAllowed('file:///etc/passwd'), false);
  assert.equal(bgg.imageHostAllowed('not a url'), false);
  // guards against a suffix-spoofing host
  assert.equal(bgg.imageHostAllowed('https://geekdo-images.com.evil.com/x'), false);
});
