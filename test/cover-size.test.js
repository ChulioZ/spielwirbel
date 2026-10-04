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
  COVER_UNSAFE_RE,
  coverUrl,
  COVER_RESIZERS,
} = require('../public/js/cover-size');

const { isAllowedImageUrl, providerCoverUrl } = require('../lib/providers');




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
  // A pre-sized URL (the retired Xbox provider's search hits arrived as ?w=150…)
  // must not get a second w=, which would produce a malformed query.
  const url = 'https://store-images.s-microsoft.com/image/apps.1.abc?w=150';
  assert.strictEqual(coverUrl(url, COVER_CARD), url);
});

/* The render-time half of the cover URL character check. Every render site
   interpolates coverUrl(...) into background-image:url('…'), so refusing here
   makes a value stored before the store-time check last tightened inert, with
   no migration. */
test('renders nothing for a stored value carrying a character the cover check refuses', () => {
  for (const bad of [
    'https://cf.geekdo-images.com/x&#39;.jpg',
    'https://cf.geekdo-images.com/x&quot;.jpg',
    "https://cf.geekdo-images.com/x'.jpg",
    'https://cf.geekdo-images.com/x".jpg',
    '/uploads/a b.jpg',
  ]) {
    assert.strictEqual(coverUrl(bad, COVER_CARD), '', `must not render ${bad}`);
  }
  // Anti-vacuous: the same URL without the character renders untouched.
  const ok = 'https://cf.geekdo-images.com/x.jpg';
  assert.strictEqual(coverUrl(ok, COVER_CARD), ok);
});

test('the render-time and the store-time checks refuse exactly the same characters', () => {
  /* One shared constant: lib/providers requires it for the store-time check and
     coverUrl applies it at render time. Walking every ASCII character through
     BOTH entry points is what notices a hand-copied second list drifting from
     it — comparing the constant with itself could not. */
  let refused = 0;
  for (let c = 0; c < 128; c += 1) {
    const url = `https://cf.geekdo-images.com/x${String.fromCharCode(c)}.jpg`;
    const atRender = coverUrl(url, COVER_CARD) === '';
    const atStore = providerCoverUrl(url) === null;
    assert.strictEqual(atRender, atStore, `char ${c}: render-time ${atRender}, store-time ${atStore}`);
    assert.strictEqual(atRender, COVER_UNSAFE_RE.test(url), `char ${c} disagrees with COVER_UNSAFE_RE`);
    if (atRender) refused += 1;
  }
  // Anti-vacuous floor: the seven refused printables plus ASCII whitespace.
  assert.ok(refused >= 12, `only ${refused} characters refused — is the check wired at all?`);
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

/* #981 removed the three storefront resizers with the rows that needed them, so
   `COVER_RESIZERS` is empty today and every case below is a PASS-THROUGH case.
   That makes the pass-throughs vacuous on their own — a coverUrl() that returned
   its argument unconditionally would satisfy all of them — so this file pins the
   MACHINERY instead: a synthetic rule proves the rewrite still happens, and the
   real hosts prove nothing is rewritten by accident. */
test('the rewrite machinery still works — proved against a synthetic rule', () => {
  // Reaching into the module's own table rather than inventing a second
  // implementation: this is the exact list a future provider adds a row to.
  COVER_RESIZERS.push({ host: 'sized.test', query: (w) => `w=${w}` });
  try {
    assert.strictEqual(coverUrl('https://img.sized.test/a.png', 300), 'https://img.sized.test/a.png?w=300');
    assert.strictEqual(coverUrl('https://sized.test/a.png', 300), 'https://sized.test/a.png?w=300',
      'the apex matches too, like every provider download guard');
    assert.strictEqual(coverUrl('https://notsized.test/a.png', 300), 'https://notsized.test/a.png',
      'and a host that merely ENDS in the name does not');
  } finally {
    COVER_RESIZERS.pop();
  }
});

test('no cover host is rewritten today — the storefront rules went with their data (#981)', () => {
  assert.deepEqual(COVER_RESIZERS, [],
    'a rule here without a provider behind it rewrites a URL nothing can produce');
  for (const url of [
    'https://image.api.playstation.com/vulcan/ap/rnd/202309/1215/abc.png',
    'https://store-images.s-microsoft.com/image/apps.64416.138287.abc',
  ]) {
    assert.strictEqual(coverUrl(url, COVER_CARD), url, 'the rows pointing here are gone');
    assert.equal(isAllowedImageUrl(url), false, 'and no provider vouches for the host');
  }
});

test('a sized URL carries no character the server-side guard refuses', () => {
  /* COVER_UNSAFE_RE is what providerCoverUrl() and coverUrl() both refuse,
     because game.image is interpolated into background-image:url('…'). Verify
     rather than assume that an appended query trips none of it (#298 §4) —
     against the shared constant itself, so this cannot drift from the check.

     Checked against a SYNTHETIC rule since #981 emptied the table: the two hosts
     this used to use are gone with their data, and a rule that rewrites nothing
     cannot be asked whether what it writes is safe. The `query` shape is the
     retired PS Store entry's. One joining several parameters with `&` fails
     here, because `&` is refused too — a resizer that needs one is a
     deliberate change to the check, not a new row in the table. */
  COVER_RESIZERS.push({ host: 'sized.test', query: (w) => `w=${w}` });
  try {
    [COVER_THUMB, COVER_CARD, COVER_HERO].forEach((w) => {
      const sized = coverUrl('https://img.sized.test/a.png', w);
      assert.notStrictEqual(sized, 'https://img.sized.test/a.png', 'expected the URL to be rewritten');
      assert.doesNotMatch(sized, COVER_UNSAFE_RE, `${sized} carries a character the cover guard refuses`);
      assert.ok(sized.startsWith('https://'), 'the resizer must not change the scheme');
    });
  } finally {
    COVER_RESIZERS.pop();
  }
});

