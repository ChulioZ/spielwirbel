'use strict';

// Issue #117: BGG answers a search with the name that MATCHED (for a German
// query, the game's German alternate name) while its detail hop always reports
// the item's primary name. Since the Wikidata label lookup that used to supply
// localized titles is gone, that matched name is now the only localized title
// the app gets — so it must survive the pick.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { pickedTitle } = require('../public/js/lookup-title');
const bgg = require('../lib/providers/bgg');

test('a picked BGG match keeps the matched name, not the primary one', () => {
  // Driven through the real parsers so a change in either side shows up here.
  const searchXml = `<items><item type="boardgame" id="13">
      <name type="alternate" value="Die Siedler von Catan"/>
      <name type="primary" value="CATAN"/>
    </item></items>`;
  const thingXml = '<items><item type="boardgame" id="13"><name type="primary" value="CATAN"/></item></items>';
  const r = Object.assign({ provider: 'bgg' }, bgg.parseSearch(searchXml, 8, 'siedler')[0]);
  const d = bgg.parseThing(thingXml, '13');
  assert.equal(r.title, 'Die Siedler von Catan');
  assert.equal(d.title, 'CATAN');
  assert.equal(pickedTitle(r, d), 'Die Siedler von Catan');
});

test('every other provider still lets the detail title win', () => {
  // A store's search listing is often shortened or decorated; the product page
  // carries the real name.
  const r = { provider: 'psstore', title: 'Hades – Standard Edition', thumbnail: null };
  const d = { title: 'Hades' };
  assert.equal(pickedTitle(r, d), 'Hades');
});

test('falls back across missing titles and never returns null/undefined', () => {
  assert.equal(pickedTitle({ provider: 'bgg', title: '' }, { title: 'CATAN' }), 'CATAN');
  assert.equal(pickedTitle({ provider: 'steam', title: 'Portal' }, { title: null }), 'Portal');
  assert.equal(pickedTitle({ provider: 'bgg' }, {}), '');
  assert.equal(pickedTitle(null, null), '');
});
