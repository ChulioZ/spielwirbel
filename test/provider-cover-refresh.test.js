'use strict';

// Issue #518: a provider-linked game can re-fetch its cover from the provider.
// The refresh starts from a STORED source link, so — unlike the add-game and
// link-provider flows — it has no search hit in hand and must produce one.
//
// That is what resolveProviderCover() is for, and why it is not a one-liner over
// detail(): PS Store answers imageUrl: null there (the product page's
// __NEXT_DATA__ stubs the product; the cover exists only on the search page —
// issue #281). The counterpart on the client is providerMatchCover(), which
// takes both sides because its callers already hold both.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveProviderCover, roundAllowsProvider, providerCoverUrl } = require('../lib/providers');
const psstore = require('../lib/providers/psstore');

const PS_IMG = 'https://image.api.playstation.com/vulcan/ap/rnd/hades.png';
const BGG_IMG = 'https://cf.geekdo-images.com/x/catan.jpg';

// A provider double recording what it was asked, so the tests can assert the
// query and the locale the helper passes on rather than only its return value.
function fakeProvider({ detail = null, search = [] } = {}) {
  const calls = { detail: [], search: [] };
  return {
    calls,
    detail: async (id, lang) => { calls.detail.push({ id, lang }); return detail; },
    search: async (q, limit, lang) => { calls.search.push({ q, limit, lang }); return search; },
  };
}

test('the detail image wins, and no search is made for it', async () => {
  const p = fakeProvider({ detail: { title: 'Catan', imageUrl: BGG_IMG } });
  assert.equal(await resolveProviderCover(p, '13', 'Catan'), BGG_IMG);
  assert.equal(p.calls.search.length, 0, 'a second upstream call for nothing');
});

test('falls back to the search thumbnail matched by the stored id', async () => {
  const p = fakeProvider({
    detail: { title: 'Hades', imageUrl: null },
    search: [
      { providerId: 'EP9999', title: 'Hades II', thumbnail: 'https://image.api.playstation.com/other.png' },
      { providerId: 'EP0001', title: 'Hades', thumbnail: PS_IMG },
    ],
  });
  assert.equal(await resolveProviderCover(p, 'EP0001', 'Hades'), PS_IMG);
});

// The whole reason the fallback matches by id rather than taking hits[0]: at the
// time this was written a PS Store search for "Gran Turismo 7" led with Grandia
// and "It Takes Two" with its friend-pass DLC. Taking the top hit would stamp
// another product's artwork onto the game, with nothing to notice it by.
test('a search whose top hit is a different product yields no cover', async () => {
  const p = fakeProvider({
    detail: { title: 'Gran Turismo 7', imageUrl: null },
    search: [{ providerId: 'EP-GRANDIA', title: 'Grandia', thumbnail: PS_IMG }],
  });
  assert.equal(await resolveProviderCover(p, 'EP-GT7', 'Gran Turismo 7'), null);
});

test('yields null when neither hop has an image, so the route can say so', async () => {
  assert.equal(await resolveProviderCover(fakeProvider(), 'EP1', 'X'), null);
  const noThumb = fakeProvider({
    detail: { title: 'X', imageUrl: null },
    search: [{ providerId: 'EP1', title: 'X', thumbnail: null }],
  });
  assert.equal(await resolveProviderCover(noThumb, 'EP1', 'X'), null);
});

test('the provider’s own title drives the search, not the locally stored one', async () => {
  const p = fakeProvider({ detail: { title: 'Hades', imageUrl: null }, search: [] });
  await resolveProviderCover(p, 'EP0001', 'the one with the underworld', 'de');
  assert.equal(p.calls.search[0].q, 'Hades');
  // …and the stored title is what is left when the provider offers no name.
  const bare = fakeProvider({ detail: null, search: [] });
  await resolveProviderCover(bare, 'EP0001', 'Hades');
  assert.equal(bare.calls.search[0].q, 'Hades');
});

test('with no title on either side there is nothing to search for', async () => {
  const p = fakeProvider({ detail: { title: '', imageUrl: null } });
  assert.equal(await resolveProviderCover(p, 'EP1', ''), null);
  assert.equal(p.calls.search.length, 0);
});

test('the caller’s language reaches both hops (#505)', async () => {
  const p = fakeProvider({ detail: { title: 'Hades', imageUrl: null }, search: [] });
  await resolveProviderCover(p, 'EP0001', 'Hades', 'fr');
  assert.equal(p.calls.detail[0].lang, 'fr');
  assert.equal(p.calls.search[0].lang, 'fr');
});

// Against the REAL parsers, so a Sony page change that starts shipping `media`
// on the product page — or stops shipping it on the search page — is noticed
// here rather than silently making the fallback dead code.
test('the PS Store asymmetry the fallback exists for is still real', async () => {
  const html = (data) =>
    `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
  const productHtml = html({
    props: { apolloState: { 'Product:EP0001': { __typename: 'Product', id: 'EP0001', name: 'Hades' } } },
  });
  const searchHtml = html({
    props: {
      apolloState: {
        'Product:EP0001': {
          __typename: 'Product',
          id: 'EP0001',
          name: 'Hades',
          storeDisplayClassification: 'FULL_GAME',
          media: [{ role: 'MASTER', type: 'IMAGE', url: PS_IMG }],
        },
      },
    },
  });

  const provider = {
    detail: async (id) => psstore.parseProduct(productHtml, id),
    search: async (q, limit) => psstore.parseSearch(searchHtml, limit),
  };
  assert.equal(await provider.detail('EP0001').then((d) => d.imageUrl), null);
  assert.equal(await resolveProviderCover(provider, 'EP0001', 'Hades'), PS_IMG);

  // The fallback is only useful because a search thumbnail passes the same
  // allowlist a detail cover does — otherwise the route would resolve a URL and
  // then refuse to store it.
  assert.equal(providerCoverUrl(PS_IMG), PS_IMG);
});

// --- roundAllowsProvider: the three states of round.providers (#294) ---

test('absent providers means every provider, an empty list means none', () => {
  assert.equal(roundAllowsProvider({}, 'bgg'), true, 'never configured = all');
  assert.equal(roundAllowsProvider({ providers: undefined }, 'bgg'), true);
  assert.equal(roundAllowsProvider({ providers: [] }, 'bgg'), false, 'a real "query nothing" setting');
  assert.equal(roundAllowsProvider({ providers: ['bgg', 'steam'] }, 'bgg'), true);
  assert.equal(roundAllowsProvider({ providers: ['steam'] }, 'bgg'), false);
});
