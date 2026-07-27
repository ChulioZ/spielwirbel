'use strict';

/*
 * The content a guest demo tenant is seeded with (issue #427) — data only; the
 * minting/seeding/purging logic lives in lib/demo.js.
 *
 * Split from lib/demo.js on purpose: this half is a table that gets re-resolved
 * against the providers from time to time (scripts/resolve-demo-covers.js
 * regenerates DEMO_GAMES), while that half is logic nobody regenerates. Keeping
 * them apart means a cover refresh touches one file with no code in it.
 *
 * THE COVERS ARE HOTLINKS, NOT COPIES. Every `image` below is the provider's own
 * https URL, exactly as a real user's round stores it when they add a game
 * through the lookup — the app never downloads cover bytes
 * (.claude/rules/provider-cover-hotlinking.md). Do NOT "fix" a rotted URL by
 * saving the image into public/img: that turns a link into a reproduction of
 * someone else's artwork on our most public surface, which is the one thing that
 * rule exists to prevent. Re-run the resolver instead — and note a rotted URL
 * degrades gracefully to the app's own coverPlaceholder() gradient, so this is
 * never urgent.
 *
 * Every `image` host must be on some provider's IMAGE_HOSTS, or the CSP blocks
 * it and the cover silently renders nothing (.claude/rules/security-middleware.md).
 * test/demo.test.js asserts each one passes providerCoverUrl(), which is the
 * same guard the add-game route applies.
 */

// Seeded games. `minPlayers`/`maxPlayers` are load-bearing, not decoration: the
// draw pool filters on them (routes/sessions.js), so a game whose range excludes
// the seeded table size can never be drawn. The demo seats FOUR people (the
// visitor's own seat plus three), so most entries must reach 4 — otherwise the
// visitor's first "Session wirbeln" answers "No matching games in this round",
// which reads as the app being broken on the one screen the demo exists to show.
// One deliberately narrow entry (7 Wonders Duel, strictly 2) is kept because a
// real shelf has those, and it demonstrates that the filter does something.
//
// Titles are identical in German and English by selection, so the shelf needs no
// per-locale variant — only the round/member/tag text below does.
//
// Every `image` below was RESOLVED, never hand-written — regenerate the block
// with `node --env-file-if-exists=.env scripts/resolve-demo-covers.js`. That is
// not a convenience: BGG's cover URLs are unguessable (their transform paths are
// signed — .claude/rules/provider-cover-sizing.md) and their API 401s without
// BGG_API_TOKEN, so anything typed by hand here renders nothing at all. A cover
// that later rots degrades to the app's own coverPlaceholder() gradient, so it
// is a cosmetic loss and never a broken screen.
const DEMO_GAMES = [
  {
    title: 'CATAN',
    minPlayers: 3,
    maxPlayers: 4,
    source: {
      provider: 'bgg',
      externalId: '13',
      url: 'https://boardgamegeek.com/boardgame/13',
    },
    image: 'https://cf.geekdo-images.com/0XODRpReiZBFUffEcqT5-Q__small/img/SNVfF23OQafv3u8xdFolJnMkBoM=/fit-in/200x150/filters:strip_icc()/pic9156909.png',
    tags: ['classic'],
  },
  {
    title: 'Azul',
    minPlayers: 2,
    maxPlayers: 4,
    source: {
      provider: 'bgg',
      externalId: '230802',
      url: 'https://boardgamegeek.com/boardgame/230802',
    },
    image: 'https://cf.geekdo-images.com/aPSHJO0d0XOpQR5X-wJonw__small/img/ccsXKrdGJw-YSClWwzVUwk5Nh9Y=/fit-in/200x150/filters:strip_icc()/pic6973671.png',
    tags: ['family'],
  },
  {
    title: 'Carcassonne',
    minPlayers: 2,
    maxPlayers: 5,
    source: {
      provider: 'bgg',
      externalId: '822',
      url: 'https://boardgamegeek.com/boardgame/822',
    },
    image: 'https://cf.geekdo-images.com/peUgu3A20LRmAXAMyDQfpQ__small/img/oEEslN-EGqh82sNI6Aj4_MFXYg0=/fit-in/200x150/filters:strip_icc()/pic8621446.jpg',
    tags: ['classic', 'family'],
  },
  {
    title: 'Codenames',
    minPlayers: 2,
    maxPlayers: 8,
    source: {
      provider: 'bgg',
      externalId: '178900',
      url: 'https://boardgamegeek.com/boardgame/178900',
    },
    image: 'https://cf.geekdo-images.com/nC6ifPCDnAItwoKSKXVrnw__small/img/1iZav_8ZqurrDbvkZA9GcFhB5x0=/fit-in/200x150/filters:strip_icc()/pic8907965.jpg',
    tags: ['party'],
  },
  {
    title: 'Just One',
    minPlayers: 3,
    maxPlayers: 7,
    source: {
      provider: 'bgg',
      externalId: '254640',
      url: 'https://boardgamegeek.com/boardgame/254640',
    },
    image: 'https://cf.geekdo-images.com/74haNunMBn85beBi-yIKwA__small/img/feIV-gqMeza43ycvxh6PGx4lA_w=/fit-in/200x150/filters:strip_icc()/pic8669313.png',
    tags: ['party'],
  },
  {
    title: '7 Wonders Duel',
    minPlayers: 2,
    maxPlayers: 2,
    source: {
      provider: 'bgg',
      externalId: '173346',
      url: 'https://boardgamegeek.com/boardgame/173346',
    },
    image: 'https://cf.geekdo-images.com/zdagMskTF7wJBPjX74XsRw__small/img/gV1-ckZSIC-dCxxpq1Y7GmPITzQ=/fit-in/200x150/filters:strip_icc()/pic2576399.jpg',
    tags: ['duel'],
  },
  {
    title: 'Overcooked! All You Can Eat',
    minPlayers: 1,
    maxPlayers: 4,
    source: {
      provider: 'psstore',
      externalId: 'EP4064-PPSA01528_00-0538983162460184',
      url: 'https://store.playstation.com/de-de/product/EP4064-PPSA01528_00-0538983162460184',
    },
    image: 'https://image.api.playstation.com/vulcan/img/rnd/202109/2814/KBjM7tWNPQIy2nca7OhRRwlf.jpg',
    tags: ['digital', 'party'],
  },
  {
    title: 'Stardew Valley',
    minPlayers: 1,
    maxPlayers: 4,
    source: {
      provider: 'psstore',
      externalId: 'EP2319-CUSA26625_00-2010147637670638',
      url: 'https://store.playstation.com/de-de/product/EP2319-CUSA26625_00-2010147637670638',
    },
    image: 'https://image.api.playstation.com/vulcan/img/rnd/202102/1922/ajZXwKlWvBPfznci6hSGZoOr.png',
    tags: ['digital'],
  },
  {
    title: 'Human Fall Flat',
    minPlayers: 1,
    maxPlayers: 8,
    source: {
      provider: 'steam',
      externalId: '477160',
      url: 'https://store.steampowered.com/app/477160/',
    },
    image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/477160/17b69c11171352dbe4be91b25414efd8be3ff1f4/header_alt_assets_27_german.jpg?t=1784801515',
    tags: ['digital', 'party'],
  },
];

// The tag ids referenced above, resolved to a display name per locale. Keys —
// not names — are what DEMO_GAMES carries, so renaming a tag in one language
// cannot desynchronise it from the games that use it.
//
// `icon` is a TAG_ICONS key (lib/tag-icons.js) — the short form WITHOUT the
// `ti-` prefix, which is how a tag stores it and how the frontend renders it.
// The allowlist is closed: an off-list key renders as nothing at all, with no
// error anywhere (.claude/rules/tabler-icon-codepoints.md). test/demo.test.js
// pins every key here against TAG_ICONS so a typo fails loudly.
const DEMO_TAGS = {
  classic: { icon: 'cards', de: 'Klassiker', en: 'Classic' },
  family: { icon: 'users', de: 'Familie', en: 'Family' },
  party: { icon: 'sparkles', de: 'Party', en: 'Party' },
  duel: { icon: 'sword', de: 'Zu zweit', en: 'Two player' },
  digital: { icon: 'device-gamepad-2', de: 'Digital', en: 'Digital' },
};

// Per-locale text. The visitor's own seat is named by lib/demo.js (it reuses the
// account's generated username the way a real round does), so only the three
// fellow players are named here.
//
// Names are ordinary given names that read naturally in each language rather
// than being "neutral" — a demo round called "Game night" full of German names
// reads as a half-translated app, which is precisely the impression the demo
// exists to avoid.
const DEMO_TEXT = {
  de: {
    roundName: 'Spieleabend (Demo)',
    ownerSeat: 'Du',
    members: ['Anna', 'Ben', 'Clara'],
  },
  en: {
    roundName: 'Game night (demo)',
    ownerSeat: 'You',
    members: ['Anna', 'Ben', 'Clara'],
  },
};

// Which finished sessions to seed, so Chronik and Pokale have content the moment
// the visitor arrives rather than two empty states. Indices into DEMO_GAMES;
// `winners` and `ratings` index into the seat list (0 = the visitor's own seat).
//
// Kept small and explicit — the point is that the history screens have something
// to render, not to simulate a plausible year of play.
const DEMO_SESSIONS = [
  {
    daysAgo: 12,
    gameIndexes: [0, 2, 3],
    chosenIndex: 2,
    winners: [1],
    ratings: [
      [4, 3, 5],
      [5, 4, 4],
      [3, 5, 4],
      [4, 4, 5],
    ],
  },
  {
    daysAgo: 4,
    gameIndexes: [3, 4, 6],
    chosenIndex: 4,
    winners: [0, 2],
    ratings: [
      [4, 5, 3],
      [3, 5, 4],
      [5, 5, 5],
      [4, 4, 3],
    ],
  },
];

const SUPPORTED_LOCALES = Object.keys(DEMO_TEXT);

// Fall back to German for anything unrecognised: it is the app's product
// language and the one the screenshots are in.
function textFor(locale) {
  const key = String(locale || '').slice(0, 2).toLowerCase();
  return DEMO_TEXT[key] || DEMO_TEXT.de;
}

function tagNameFor(key, locale) {
  const tag = DEMO_TAGS[key];
  if (!tag) return null;
  const lang = String(locale || '').slice(0, 2).toLowerCase();
  return tag[lang] || tag.de;
}

module.exports = {
  DEMO_GAMES,
  DEMO_TAGS,
  DEMO_TEXT,
  DEMO_SESSIONS,
  SUPPORTED_LOCALES,
  textFor,
  tagNameFor,
};
