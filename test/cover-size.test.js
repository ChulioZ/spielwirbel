'use strict';

// Render-time cover URL sizing (#298). The sizer runs on every cover the app
// paints, so its pass-through behaviour matters as much as its rewriting: a
// stray query appended to an own upload or an unrecognised host would break a
// cover that works today.

const test = require('node:test');
const assert = require('node:assert');

const {
  COVER_THUMB,
  COVER_CARD,
  COVER_HERO,
  coverUrl,
} = require('../public/js/cover-size');

const { isAllowedImageUrl, providerCoverUrl } = require('../lib/providers');

test('resizes a PlayStation Store cover', () => {
  const url = 'https://image.api.playstation.com/vulcan/ap/rnd/202309/1215/abc.png';
  assert.strictEqual(coverUrl(url, COVER_CARD), `${url}?w=330`);
  assert.strictEqual(coverUrl(url, COVER_THUMB), `${url}?w=160`);
});

test('resizes a playstation.net subdomain cover', () => {
  const url = 'https://apollo2.dl.playstation.net/cdn/cover.jpg';
  assert.strictEqual(coverUrl(url, COVER_HERO), `${url}?w=480`);
});

test('resizes an Xbox cover with the width/height/quality triple', () => {
  const url = 'https://store-images.s-microsoft.com/image/apps.64416.138287.abc';
  assert.strictEqual(coverUrl(url, COVER_CARD), `${url}?w=330&h=330&q=90`);
});

test('passes through the providers that are already right-sized', () => {
  // BGG ships a fit-in transform, Steam a capsule crop, and Nintendo's CDN
  // ignores ?w= outright — appending to any of them would be pure noise.
  const urls = [
    'https://cf.geekdo-images.com/abc/fit-in/246x300/pic123.jpg',
    'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/c.jpg',
    'https://www.nintendo.com/eu/media/images/assets/game/cover.jpg',
  ];
  urls.forEach((u) => assert.strictEqual(coverUrl(u, COVER_CARD), u));
});

test('passes through own uploads byte-identically', () => {
  assert.strictEqual(coverUrl('/uploads/abc123.jpg', COVER_CARD), '/uploads/abc123.jpg');
});

test('passes through an unrecognised host', () => {
  const url = 'https://example.com/cover.jpg';
  assert.strictEqual(coverUrl(url, COVER_CARD), url);
});

test('leaves a URL that already carries a query string alone', () => {
  // Not hypothetical: the Xbox *search* hit arrives pre-sized as ?w=150&h=150,
  // and a second w= would produce a malformed query.
  const url = 'https://store-images.s-microsoft.com/image/apps.1.abc?w=150&h=150';
  assert.strictEqual(coverUrl(url, COVER_CARD), url);
});

test('passes through non-https and non-string values untouched', () => {
  assert.strictEqual(coverUrl('http://image.api.playstation.com/a.png', 330),
    'http://image.api.playstation.com/a.png');
  assert.strictEqual(coverUrl(null, 330), null);
  assert.strictEqual(coverUrl(undefined, 330), undefined);
  assert.strictEqual(coverUrl('', 330), '');
});

test('passes through an unparseable https value', () => {
  assert.strictEqual(coverUrl('https://', 330), 'https://');
});

test('the sized URLs still carry no character the server-side guard refuses', () => {
  // providerCoverUrl() rejects quotes, parens, backslashes and whitespace
  // because game.image is interpolated into background-image:url('…'). Verify
  // rather than assume that the appended query trips none of them (#298 §4).
  //
  // Since #744 the two resizer hosts are LEGACY: no provider vouches for them,
  // so providerCoverUrl() refuses them on the host check before it ever looks at
  // the characters. Asserting `providerCoverUrl(sized) === sized` would now be
  // asserting `null === null` — vacuously green against a resizer that appended
  // a quote. So the character rule is checked directly, and the host rule is
  // checked separately below, where it says the opposite thing on purpose.
  const UNSAFE = /['"<>\\\s]/;
  [
    'https://image.api.playstation.com/vulcan/ap/rnd/202309/1215/abc.png',
    'https://store-images.s-microsoft.com/image/apps.64416.138287.abc',
  ].forEach((url) => {
    [COVER_THUMB, COVER_CARD, COVER_HERO].forEach((w) => {
      const sized = coverUrl(url, w);
      assert.notStrictEqual(sized, url, 'expected the URL to be rewritten');
      assert.doesNotMatch(sized, UNSAFE, `${sized} carries a character the cover guard refuses`);
      assert.ok(sized.startsWith('https://'), 'the resizer must not change the scheme');
    });
  });

  // A BGG cover passes through untouched AND clears the real guard — the
  // anti-vacuous half: it proves providerCoverUrl still accepts something, so
  // the refusals above are about the host and not about the function being dead.
  const bggCover = 'https://cf.geekdo-images.com/x/fit-in/200x150/filters:strip_icc()/pic1.jpg';
  assert.strictEqual(coverUrl(bggCover, COVER_CARD), bggCover, 'geekdo paths are signed — never rewritten');
  assert.ok(isAllowedImageUrl(bggCover));
  assert.strictEqual(providerCoverUrl(bggCover), bggCover);
});

test('the two resizer hosts are legacy-render-only since #744', () => {
  // The rules stay in COVER_RESIZERS for the ~66 covers already stored on those
  // hosts — delete them and those games silently go back to serving a 1–2 MB
  // master. But nothing may WRITE one any more, and this is what pins that the
  // two halves disagree deliberately rather than by oversight.
  [
    'https://image.api.playstation.com/vulcan/ap/rnd/202309/1215/abc.png',
    'https://store-images.s-microsoft.com/image/apps.64416.138287.abc',
  ].forEach((url) => {
    assert.notStrictEqual(coverUrl(url, COVER_CARD), url, 'the resizer still sizes a stored cover');
    assert.equal(isAllowedImageUrl(url), false, 'no provider vouches for this host any more');
  });
});
