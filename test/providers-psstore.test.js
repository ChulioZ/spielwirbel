'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ps = require('../lib/providers/psstore');

// A minimal store page: the __NEXT_DATA__ blob holds an Apollo cache with a mix
// of playable games and add-on noise (which must be filtered out).
function pageHtml(apolloState, extraBody = '') {
  const next = { props: { pageProps: { apolloState } } };
  return `<!doctype html><html><head></head><body>${extraBody}
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>
    </body></html>`;
}

const SEARCH_STATE = {
  'Product:AAA': {
    __typename: 'Product',
    id: 'AAA',
    name: 'The Witcher 3: Wild Hunt',
    storeDisplayClassification: 'FULL_GAME',
    media: [
      { __typename: 'Media', role: 'SCREENSHOT', type: 'IMAGE', url: 'https://image.api.playstation.com/vulcan/shot.jpg' },
      { __typename: 'Media', role: 'GAMEHUB_COVER_ART', type: 'IMAGE', url: 'https://image.api.playstation.com/vulcan/witcher.png' },
    ],
  },
  'Product:BBB': {
    __typename: 'Product',
    id: 'BBB',
    name: 'The Witcher 3 - Expansion Pass',
    storeDisplayClassification: 'GAME_CONSUMABLE', // DLC -> excluded
    media: [],
  },
  'Product:CCC': {
    __typename: 'Product',
    id: 'CCC',
    name: 'Rocket League',
    storeDisplayClassification: 'FULL_GAME',
    media: [{ __typename: 'Media', role: 'MASTER', type: 'IMAGE', url: 'https://image.api.playstation.com/vulcan/rl.png' }],
  },
};

test('parseSearch returns playable games, with best cover thumbnail', () => {
  const out = ps.parseSearch(pageHtml(SEARCH_STATE));
  assert.equal(out.length, 2); // DLC filtered out
  assert.deepEqual(out[0], {
    providerId: 'AAA',
    title: 'The Witcher 3: Wild Hunt',
    thumbnail: 'https://image.api.playstation.com/vulcan/witcher.png', // cover role beats screenshot
  });
  assert.equal(out[1].title, 'Rocket League');
});

// Sony files a large share of ordinary standard editions under GAME_BUNDLE
// ("Spielpaket"), not FULL_GAME — measured live on Split Fiction, Gran Turismo 7,
// It Takes Two, EA SPORTS FC 25 and Fortnite, the last two of which returned an
// empty PlayStation list entirely. Keeping only FULL_GAME silently loses them:
// there is no error, the dropdown just fills with unrelated near-matches.
// See .claude/rules/psstore-full-game-is-not-every-game.md.
test('parseSearch keeps GAME_BUNDLE standard editions, drops add-on classes', () => {
  const state = {
    // Shaped after the live blob for the query "Split Fiction".
    'Product:SPLIT': {
      __typename: 'Product',
      id: 'UP0006-PPSA08560_00-SPLITSTANDARDED0',
      name: 'Split Fiction',
      storeDisplayClassification: 'GAME_BUNDLE',
      media: [
        { __typename: 'Media', role: 'GAMEHUB_COVER_ART', type: 'IMAGE', url: 'https://image.api.playstation.com/vulcan/split.png' },
      ],
    },
    'Product:COIN': {
      __typename: 'Product',
      id: 'COIN',
      name: 'SPLITGATE - 100 Splitcoin',
      storeDisplayClassification: 'VIRTUAL_CURRENCY',
      media: [],
    },
    'Product:PACK': {
      __typename: 'Product',
      id: 'PACK',
      name: 'Splitgate - Starter Weapon Pack',
      // PREMIUM_EDITION also carries plain DLC, so it stays excluded.
      storeDisplayClassification: 'PREMIUM_EDITION',
      media: [],
    },
  };
  const out = ps.parseSearch(pageHtml(state));
  assert.deepEqual(
    out.map((h) => h.title),
    ['Split Fiction']
  );
  assert.equal(out[0].thumbnail, 'https://image.api.playstation.com/vulcan/split.png');
});

// #527 — captured live from store.playstation.com/de-de on 2026-07-31 for the
// query "It Takes Two". This fixture pins a NEGATIVE result, which is why it is
// worth keeping: `storeDisplayClassification` cannot tell a game from its free
// companion pass, so the ranking tiebreak must not be built on it.
//
// Note which way round it is — the obvious reading is backwards. The GAME is
// the GAME_BUNDLE ("Spielpaket", €39,99) and both PASSES are FULL_GAME
// ("Vollversion", Kostenlos), so preferring FULL_GAME would rank the two passes
// ABOVE the game. And it does not even fail consistently: for "Split Fiction"
// (the fixture above) the game and its pass are both GAME_BUNDLE, so there the
// same signal separates nothing at all. The tiebreak that actually works lives
// in public/js/lookup-group.js and keys on title length.
const IT_TAKES_TWO_STATE = {
  'Product:GAME': {
    __typename: 'Product',
    id: 'EP0006-PPSA02343_00-ITTAKESTWORETAIL',
    name: 'It Takes Two PS4™ & PS5™',
    storeDisplayClassification: 'GAME_BUNDLE',
    media: [
      { __typename: 'Media', role: 'GAMEHUB_COVER_ART', type: 'IMAGE', url: 'https://image.api.playstation.com/vulcan/itt.png' },
    ],
  },
  'Product:PASS5': {
    __typename: 'Product',
    id: 'EP0006-PPSA02343_00-HAZELIGHTNUTS000',
    name: 'It Takes Two – Freunde-Pass PS5™',
    storeDisplayClassification: 'FULL_GAME',
    media: [],
  },
};

test('#527 parseSearch keeps both a game and its free pass — only ranking can separate them', () => {
  const out = ps.parseSearch(pageHtml(IT_TAKES_TWO_STATE));
  // Both survive the classification filter, and correctly so: the pass really is
  // a product someone may want. That is precisely why the provider layer cannot
  // fix this and the tie has to be broken client-side, at equal scoreHit.
  assert.deepEqual(out.map((h) => h.title), [
    'It Takes Two PS4™ & PS5™',
    'It Takes Two – Freunde-Pass PS5™',
  ]);
  // Guard the trap itself: were anyone to re-narrow the filter to FULL_GAME, the
  // game — not the pass — is what would disappear.
  assert.equal(IT_TAKES_TWO_STATE['Product:GAME'].storeDisplayClassification, 'GAME_BUNDLE');
  assert.equal(IT_TAKES_TWO_STATE['Product:PASS5'].storeDisplayClassification, 'FULL_GAME');
});

test('parseSearch respects the limit and tolerates a missing blob', () => {
  assert.equal(ps.parseSearch(pageHtml(SEARCH_STATE), 1).length, 1);
  assert.deepEqual(ps.parseSearch('<html>no next data</html>'), []);
});

test('pickImage prefers cover roles then falls back to any image', () => {
  assert.equal(
    ps.pickImage([
      { type: 'IMAGE', role: 'SCREENSHOT', url: 'a' },
      { type: 'IMAGE', role: 'MASTER', url: 'b' },
    ]),
    'b'
  );
  assert.equal(ps.pickImage([{ type: 'IMAGE', role: 'SCREENSHOT', url: 'only' }]), 'only');
  assert.equal(ps.pickImage([{ type: 'VIDEO', role: 'PREVIEW', url: 'v' }]), null);
  assert.equal(ps.pickImage(null), null);
});

test('parsePlayers reads single counts and ranges, prefers the widest', () => {
  assert.deepEqual(ps.parsePlayers('x compatText">1 player</span> y'), { min: 1, max: 1 });
  assert.deepEqual(ps.parsePlayers('compatText">1 - 4 players</span>'), { min: 1, max: 4 });
  // widest range wins over a bare single count elsewhere on the page
  assert.deepEqual(
    ps.parsePlayers('compatText">4 players</span> ... compatText">1 - 4 players</span>'),
    { min: 1, max: 4 }
  );
  assert.deepEqual(ps.parsePlayers('no players spec here'), { min: null, max: null });
});

test('parsePlayers handles the German store (Spieler + en-dash) and skips online counts', () => {
  assert.deepEqual(ps.parsePlayers('compatText">1 Spieler</span>'), { min: 1, max: 1 });
  assert.deepEqual(ps.parsePlayers('compatText">1 – 4 Spieler</span>'), { min: 1, max: 4 }); // en-dash
  // "8 Online-Spieler" must not be read as the local player count
  assert.deepEqual(ps.parsePlayers('compatText">8 Online-Spieler</span>'), { min: null, max: null });
  assert.deepEqual(
    ps.parsePlayers('compatText">1 – 4 Spieler</span> compatText">8 Online-Spieler</span>'),
    { min: 1, max: 4 }
  );
});

// The store's own wording, captured live from store.playstation.com on
// 2026-07-28 (It Takes Two: EP0006-PPSA02343_00-ITTAKESTWORETAIL for the
// European locales, UP0006-PPSA02342_00-ITTAKESTWORETAIL for en-us/pt-br).
// Hand-written fixtures are worthless here — the point is what Sony ACTUALLY
// renders, and it varies in the separator, not just the noun (#505).
const CAPTURED = {
  'de-de': { local: '1 – 2 Spieler', online: 'Unterstützt bis zu 2 Online-Spieler mit PS Plus' },
  'en-us': { local: '1 - 2 players', online: 'Supports up to 2 online players with PS Plus' },
  'fr-fr': { local: 'De 1 à 2 joueurs', online: 'Prend en charge jusqu’à 2 joueurs en ligne avec PS Plus' },
  'es-es': { local: '1/2 jugadores', online: 'Admite hasta 2 jugadores online que tengan PS Plus' },
  'it-it': { local: '1 - 2 giocatori', online: 'Supporta fino a 2 giocatori online con PS Plus' },
  'nl-nl': { local: '1 - 2 spelers', online: 'Speel met maximaal 2 onlinespelers met PS Plus' },
  'pt-br': { local: '1 a 2 jogadores', online: 'Compatível com até 2 jogadores online com o PS Plus' },
};
const compat = (s) => `<span class="compatText">${s}</span>`;

test('parsePlayers reads the real player spec in every supported storefront language', () => {
  for (const [locale, { local }] of Object.entries(CAPTURED)) {
    assert.deepEqual(ps.parsePlayers(compat(local)), { min: 1, max: 2 }, locale);
  }
});

test('parsePlayers ignores the ONLINE-play notice in every language', () => {
  // Each of these embeds "<n> <players-word>" inside a sentence — Spanish even
  // adjacently ("hasta 2 jugadores online"). They are excluded because the count
  // must follow `compatText">` immediately and every one of them opens with a
  // word, which is what keeps the widened language set from reading an online
  // cap as the local player count.
  for (const [locale, { online }] of Object.entries(CAPTURED)) {
    assert.deepEqual(ps.parsePlayers(compat(online)), { min: null, max: null }, locale);
  }
});

test('parsePlayers picks the local spec out of a full localized notice block', () => {
  // The real page order: the online notices come first, the local count last.
  for (const [locale, { local, online }] of Object.entries(CAPTURED)) {
    const html = compat(online) + compat('Remote Play') + compat(local);
    assert.deepEqual(ps.parsePlayers(html), { min: 1, max: 2 }, locale);
  }
});

test('parseProduct maps the matching product + players, digital', () => {
  const html = pageHtml(
    { 'Product:CCC': SEARCH_STATE['Product:CCC'] },
    '<div><span class="compatText">1 - 4 players</span></div>'
  );
  const d = ps.parseProduct(html, 'CCC', 'de-de');
  assert.equal(d.provider, 'psstore');
  assert.equal(d.externalId, 'CCC');
  assert.equal(d.title, 'Rocket League');
  assert.equal(d.type, 'digital');
  assert.equal(d.minPlayers, 1);
  assert.equal(d.maxPlayers, 4);
  assert.equal(d.imageUrl, 'https://image.api.playstation.com/vulcan/rl.png');
  assert.equal(d.url, 'https://store.playstation.com/de-de/product/CCC');
});

test('parseProduct still returns a usable object when the page has no product stub', () => {
  // Real product pages sometimes carry no rich Product; we still return the
  // digital type, the source url, and any scraped player count.
  const d = ps.parseProduct('<span class="compatText">1 – 4 Spieler</span>', 'CCC', 'de-de');
  assert.equal(d.provider, 'psstore');
  assert.equal(d.externalId, 'CCC');
  assert.equal(d.title, null);
  assert.equal(d.imageUrl, null);
  assert.equal(d.type, 'digital');
  assert.equal(d.minPlayers, 1);
  assert.equal(d.maxPlayers, 4);
  assert.equal(d.url, 'https://store.playstation.com/de-de/product/CCC');
});

test('imageHostAllowed only vouches for Sony image hosts', () => {
  assert.equal(ps.imageHostAllowed('https://image.api.playstation.com/vulcan/x.png'), true);
  assert.equal(ps.imageHostAllowed('https://gs2.ww.prod.dl.playstation.net/x.png'), true);
  assert.equal(ps.imageHostAllowed('https://evil.example.com/x.png'), false);
  assert.equal(ps.imageHostAllowed('file:///etc/passwd'), false);
  assert.equal(ps.imageHostAllowed('not a url'), false);
  // suffix-spoofing guard
  assert.equal(ps.imageHostAllowed('https://playstation.net.evil.com/x'), false);
});
