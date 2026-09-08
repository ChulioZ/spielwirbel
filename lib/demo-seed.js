'use strict';

/*
 * The content a guest demo tenant is seeded with (issue #427, grown to three
 * rounds by #953) — data only; the minting/seeding/purging logic lives in
 * lib/demo.js.
 *
 * Split from lib/demo.js on purpose: this half is a table that gets re-resolved
 * against the providers from time to time (scripts/resolve-demo-covers.js
 * regenerates the games), while that half is logic nobody regenerates. Keeping
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
 *
 * THE PROVIDER METADATA IS SEEDED, and that is not decoration either (#953).
 * `metadataFilterOptions` derives which filter controls EXIST from the values
 * actually stored, so an unseeded shelf offers the visitor no complexity,
 * playtime or age control until the lazy backfill has hopped BGG and the screen
 * has re-rendered — on the one surface the app exists to show itself off on.
 * Seeding it also means a demo mint costs BGG nothing, which matters when the
 * landing CTA is public and a hundred demos can be live at once. Like the
 * covers, these values are RESOLVED by the script, never hand-written.
 */

// The design registry, required rather than hand-copied: a round's stored design
// is `{ type: 'theme', id, page, accent }`, and re-typing the hexes here would be
// the palette bug with the demo's home screen as its blast radius
// (.claude/rules/shared-constants-across-the-stack.md). Dependency-free with the
// module.exports guard, which is what makes it requirable from the server at all.
const { DESIGNS } = require('../public/js/round-designs');

// The stored shape for one registry id. Throws on an unknown id rather than
// returning null: a typo would otherwise seed `background: null`, i.e. a round
// that silently renders on the standard palette — which is exactly the "world is
// invisible" state #953 exists to end, reintroduced with no error anywhere.
function designFor(id) {
  const design = DESIGNS.find((d) => d.id === id);
  if (!design) throw new Error(`demo seed references unknown design '${id}'`);
  return { type: 'theme', id: design.id, page: design.page, accent: design.accent };
}

/* ---------------------------------- games ---------------------------------- */

// `minPlayers`/`maxPlayers` are load-bearing, not decoration: the draw pool
// filters on them (lib/routes/sessions.js), so a game whose range excludes its
// round's seated size can never be drawn. Each round below is asserted drawable
// at ITS OWN table size in test/demo.test.js — per round, not just the first,
// which is what a shared assertion over one flat list could never see.
//
// Titles are identical across the shipped languages by selection, so the shelves
// need no per-locale variant — only the round/member/guest/tag text does.
//
// Every `image` AND every metadata field below was RESOLVED, never hand-written
// — regenerate the block with
// `node --env-file-if-exists=.env scripts/resolve-demo-covers.js`. That is not a
// convenience: BGG's cover URLs are unguessable (their transform paths are
// signed — .claude/rules/provider-cover-sizing.md) and their API 401s without
// BGG_API_TOKEN, so anything typed by hand here renders nothing at all. A cover
// that later rots degrades to the app's own coverPlaceholder() gradient, so it
// is a cosmetic loss and never a broken screen.
//
// `retired: true` / `wish: true` mark the two rows that are NOT on the active
// shelf. They are deliberately not what keeps any round drawable — `isActiveGame`
// (public/js/draw-pool.js) excludes both from every pool — so the drawability
// assertion ignores them.

// Resolved 2026-09-06 by scripts/resolve-demo-covers.js — regenerate, never hand-edit.
// Round 1 — the round the visitor lands in.
const MAIN_GAMES = [
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
    weight: 2.2808,
    minPlaytime: 60,
    maxPlaytime: 120,
    minAge: 10,
    categories: ['Economic', 'Negotiation'],
    mechanics: ['Chaining', 'Dice Rolling', 'Hand Management', 'Hexagon Grid', 'Hidden Victory Points', 'Income', 'Market', 'Modular Board', 'Negotiation', 'Network and Route Building', 'Race', 'Random Production', 'Take That', 'Trading', 'Variable Set-up'],
    rating: 7.09047,
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
    weight: 1.7732,
    minPlaytime: 30,
    maxPlaytime: 45,
    minAge: 8,
    categories: ['Abstract Strategy', 'Renaissance'],
    mechanics: ['Chaining', 'End Game Bonuses', 'Grid Coverage', 'Open Drafting', 'Pattern Building', 'Set Collection', 'Square Grid', 'Tile Placement', 'Turn Order: Claim Action'],
    rating: 7.71162,
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
    weight: 1.8839,
    minPlaytime: 30,
    maxPlaytime: 45,
    minAge: 7,
    categories: ['Medieval', 'Territory Building'],
    mechanics: ['Area Majority / Influence', 'Enclosure', 'Kill Steal', 'Map Addition', 'Pattern Building', 'Square Grid', 'Tile Placement'],
    rating: 7.41657,
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
    weight: 1.2525,
    minPlaytime: 15,
    maxPlaytime: 15,
    minAge: 10,
    categories: ['Card Game', 'Deduction', 'Party Game', 'Spies / Secret Agents', 'Word Game'],
    mechanics: ['Communication Limits', 'Deduction', 'Memory', 'Race', 'Team-Based Game'],
    rating: 7.52373,
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
    weight: 1.0326,
    minPlaytime: 20,
    maxPlaytime: 60,
    minAge: 8,
    categories: ['Deduction', 'Party Game', 'Word Game'],
    mechanics: ['Communication Limits', 'Cooperative Game', 'Deduction', 'Paper-and-Pencil', 'Score-and-Reset Game'],
    rating: 7.58793,
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
    weight: 2.2272,
    minPlaytime: 30,
    maxPlaytime: 30,
    minAge: 10,
    categories: ['Ancient', 'Card Game', 'City Building', 'Civilization', 'Economic'],
    mechanics: ['End Game Bonuses', 'Income', 'Melding and Splaying', 'Modular Board', 'Multi-Use Cards', 'Once-Per-Game Abilities', 'Open Drafting', 'Score-and-Reset Game', 'Set Collection', 'Sudden Death Ending', 'Tags', 'Tech Trees / Tech Tracks', 'Track Movement', 'Tug of War', 'Variable Set-up'],
    rating: 8.07428,
  },
  // These three replaced the PS Store / Steam rows the seed carried until #744
  // retired those providers. They sat on `image: null` — rendering the app's own
  // coverPlaceholder() gradient — from then until #953, because nobody with the
  // token had re-run the resolver; that is the whole cost of a missed run, and
  // it is cosmetic rather than a broken screen.
  {
    title: 'Ticket to Ride',
    minPlayers: 2,
    maxPlayers: 5,
    source: {
      provider: 'bgg',
      externalId: '9209',
      url: 'https://boardgamegeek.com/boardgame/9209',
    },
    image: 'https://cf.geekdo-images.com/kdWYkW-7AqG63HhqPL6ekA__small/img/5G46jv8MFh_BfX67iMSouTMhKxc=/fit-in/200x150/filters:strip_icc()/pic8937637.jpg',
    tags: ['classic', 'family'],
    weight: 1.8188,
    minPlaytime: 30,
    maxPlaytime: 60,
    minAge: 8,
    categories: ['Trains'],
    mechanics: ['Connections', 'Contracts', 'End Game Bonuses', 'Hand Management', 'Network and Route Building', 'Open Drafting', 'Push Your Luck', 'Set Collection'],
    rating: 7.38392,
  },
  {
    title: 'Wingspan',
    minPlayers: 1,
    maxPlayers: 5,
    source: {
      provider: 'bgg',
      externalId: '266192',
      url: 'https://boardgamegeek.com/boardgame/266192',
    },
    image: 'https://cf.geekdo-images.com/yLZJCVLlIx4c7eJEWUNJ7w__small/img/VNToqgS2-pOGU6MuvIkMPKn_y-s=/fit-in/200x150/filters:strip_icc()/pic4458123.jpg',
    tags: ['family'],
    weight: 2.481,
    minPlaytime: 40,
    maxPlaytime: 70,
    minAge: 10,
    categories: ['Animals', 'Card Game', 'Educational', 'Environmental'],
    mechanics: ['Action Queue', 'Dice Rolling', 'End Game Bonuses', 'Hand Management', 'Once-Per-Game Abilities', 'Open Drafting', 'Set Collection', 'Solo / Solitaire Game', 'Turn Order: Progressive'],
    rating: 7.99415,
  },
  {
    title: 'Dixit',
    minPlayers: 3,
    maxPlayers: 6,
    source: {
      provider: 'bgg',
      externalId: '39856',
      url: 'https://boardgamegeek.com/boardgame/39856',
    },
    image: 'https://cf.geekdo-images.com/J0PlHArkZDJ57H-brXW2Fw__small/img/QVwPXskFikQwBQlrdLJBAiRGgdg=/fit-in/200x150/filters:strip_icc()/pic6738336.jpg',
    tags: ['party'],
    weight: 1.1909,
    minPlaytime: 30,
    maxPlaytime: 30,
    minAge: 8,
    categories: ['Card Game', 'Humor', 'Party Game'],
    mechanics: ['Race', 'Simultaneous Action Selection', 'Singing', 'Storytelling', 'Targeted Clues', 'Voting'],
    rating: 7.17809,
  },
  // The two off-shelf rows (#953). A demo that shows only an active shelf hides
  // the Archiv and the Wunschliste entirely, and both are screens a visitor
  // deciding whether to keep the app would want to have seen.
  {
    title: 'Monopoly',
    minPlayers: 2,
    maxPlayers: 8,
    source: {
      provider: 'bgg',
      externalId: '1406',
      url: 'https://boardgamegeek.com/boardgame/1406',
    },
    image: 'https://cf.geekdo-images.com/9nGoBZ0MRbi6rdH47sj2Qg__small/img/ezXcyEsHhS9iRxmuGe8SmiLLXlM=/fit-in/200x150/filters:strip_icc()/pic5786795.jpg',
    tags: ['classic'],
    weight: 1.6164,
    minPlaytime: 60,
    maxPlaytime: 180,
    minAge: 8,
    categories: ['Economic'],
    mechanics: ['Auction / Bidding', 'Auction: English', 'Income', 'Loans', 'Lose a Turn', 'Ownership', 'Player Elimination', 'Roll / Spin and Move', 'Set Collection', 'Track Movement', 'Trading'],
    rating: 4.36737,
    retired: true,
  },
  {
    title: 'Cascadia',
    minPlayers: 1,
    maxPlayers: 4,
    source: {
      provider: 'bgg',
      externalId: '295947',
      url: 'https://boardgamegeek.com/boardgame/295947',
    },
    image: 'https://cf.geekdo-images.com/MjeJZfulbsM1DSV3DrGJYA__small/img/tVSFjSxYEcw7sKj3unIIQV8kxoc=/fit-in/200x150/filters:strip_icc()/pic5100691.jpg',
    tags: ['family'],
    weight: 1.8445,
    minPlaytime: 30,
    maxPlaytime: 45,
    minAge: 10,
    categories: ['Animals', 'Environmental'],
    mechanics: ['Chaining', 'End Game Bonuses', 'Hexagon Grid', 'Line of Sight', 'Open Drafting', 'Pattern Building', 'Solo / Solitaire Game', 'Tile Placement', 'Variable Set-up'],
    rating: 7.88272,
    wish: true,
  },
];

// Round 2 — the two-player shelf. Every entry has to admit exactly 2, which is
// also what makes it the round that proves the player-range filter does
// something: none of these can be drawn by round 3, and only one of them by
// round 1.
const DUO_GAMES = [
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
    weight: 2.2272,
    minPlaytime: 30,
    maxPlaytime: 30,
    minAge: 10,
    categories: ['Ancient', 'Card Game', 'City Building', 'Civilization', 'Economic'],
    mechanics: ['End Game Bonuses', 'Income', 'Melding and Splaying', 'Modular Board', 'Multi-Use Cards', 'Once-Per-Game Abilities', 'Open Drafting', 'Score-and-Reset Game', 'Set Collection', 'Sudden Death Ending', 'Tags', 'Tech Trees / Tech Tracks', 'Track Movement', 'Tug of War', 'Variable Set-up'],
    rating: 8.07428,
  },
  {
    title: 'Patchwork',
    minPlayers: 2,
    maxPlayers: 2,
    source: {
      provider: 'bgg',
      externalId: '163412',
      url: 'https://boardgamegeek.com/boardgame/163412',
    },
    image: 'https://cf.geekdo-images.com/xNSaIHCKr_cc7Q2rQSSJPQ__small/img/9Kf3YKiVIJxd_EbqJEJFdlGfj7I=/fit-in/200x150/filters:strip_icc()/pic9273518.jpg',
    tags: ['duel'],
    weight: 1.6002,
    minPlaytime: 15,
    maxPlaytime: 30,
    minAge: 8,
    categories: ['Abstract Strategy', 'Economic', 'Puzzle'],
    mechanics: ['Grid Coverage', 'Income', 'Open Drafting', 'Rondel', 'Square Grid', 'Tile Placement', 'Turn Order: Stat-Based', 'Turn Order: Time Track', 'Victory Points as a Resource'],
    rating: 7.57648,
  },
  {
    title: 'Jaipur',
    minPlayers: 2,
    maxPlayers: 2,
    source: {
      provider: 'bgg',
      externalId: '54043',
      url: 'https://boardgamegeek.com/boardgame/54043',
    },
    image: 'https://cf.geekdo-images.com/_LTujSe_o16nvjDC-J0seA__small/img/82vhODfpxIT03BzW4NkisJ5Unzs=/fit-in/200x150/filters:strip_icc()/pic5100947.jpg',
    tags: ['duel'],
    weight: 1.4633,
    minPlaytime: 30,
    maxPlaytime: 30,
    minAge: 10,
    categories: ['Arabian', 'Card Game', 'Economic'],
    mechanics: ['End Game Bonuses', 'Hand Management', 'Hidden Victory Points', 'Market', 'Open Drafting', 'Push Your Luck', 'Race', 'Score-and-Reset Game', 'Set Collection', 'Sudden Death Ending', 'Turn Order: Progressive', 'Variable Set-up'],
    rating: 7.47828,
  },
  {
    title: 'Kingdomino',
    minPlayers: 2,
    maxPlayers: 4,
    source: {
      provider: 'bgg',
      externalId: '204583',
      url: 'https://boardgamegeek.com/boardgame/204583',
    },
    image: 'https://cf.geekdo-images.com/c0m3gwZTcfKoLI63ASio8g__small/img/4p4Xydg0tze9UFcd6oUbCnVyxCw=/fit-in/200x150/filters:strip_icc()/pic8443569.png',
    tags: ['family'],
    weight: 1.242,
    minPlaytime: 15,
    maxPlaytime: 25,
    minAge: 8,
    categories: ['Abstract Strategy', 'Medieval', 'Puzzle', 'Territory Building'],
    mechanics: ['Enclosure', 'Matching', 'Open Drafting', 'Tile Placement', 'Turn Order: Claim Action'],
    rating: 7.28653,
  },
];

// Round 3 — the big group. Its shelf must admit a TWO-TABLE split at its party
// count (see DEMO_SPLIT below), so every entry here reaches at least 3 and the
// three the session draws all admit both 3 and 4.
const GROUP_GAMES = [
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
    weight: 1.2525,
    minPlaytime: 15,
    maxPlaytime: 15,
    minAge: 10,
    categories: ['Card Game', 'Deduction', 'Party Game', 'Spies / Secret Agents', 'Word Game'],
    mechanics: ['Communication Limits', 'Deduction', 'Memory', 'Race', 'Team-Based Game'],
    rating: 7.52373,
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
    weight: 1.0326,
    minPlaytime: 20,
    maxPlaytime: 60,
    minAge: 8,
    categories: ['Deduction', 'Party Game', 'Word Game'],
    mechanics: ['Communication Limits', 'Cooperative Game', 'Deduction', 'Paper-and-Pencil', 'Score-and-Reset Game'],
    rating: 7.58793,
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
    weight: 1.8839,
    minPlaytime: 30,
    maxPlaytime: 45,
    minAge: 7,
    categories: ['Medieval', 'Territory Building'],
    mechanics: ['Area Majority / Influence', 'Enclosure', 'Kill Steal', 'Map Addition', 'Pattern Building', 'Square Grid', 'Tile Placement'],
    rating: 7.41657,
  },
  {
    title: 'Dixit',
    minPlayers: 3,
    maxPlayers: 6,
    source: {
      provider: 'bgg',
      externalId: '39856',
      url: 'https://boardgamegeek.com/boardgame/39856',
    },
    image: 'https://cf.geekdo-images.com/J0PlHArkZDJ57H-brXW2Fw__small/img/QVwPXskFikQwBQlrdLJBAiRGgdg=/fit-in/200x150/filters:strip_icc()/pic6738336.jpg',
    tags: ['party'],
    weight: 1.1909,
    minPlaytime: 30,
    maxPlaytime: 30,
    minAge: 8,
    categories: ['Card Game', 'Humor', 'Party Game'],
    mechanics: ['Race', 'Simultaneous Action Selection', 'Singing', 'Storytelling', 'Targeted Clues', 'Voting'],
    rating: 7.17809,
  },
  {
    title: 'Ticket to Ride',
    minPlayers: 2,
    maxPlayers: 5,
    source: {
      provider: 'bgg',
      externalId: '9209',
      url: 'https://boardgamegeek.com/boardgame/9209',
    },
    image: 'https://cf.geekdo-images.com/kdWYkW-7AqG63HhqPL6ekA__small/img/5G46jv8MFh_BfX67iMSouTMhKxc=/fit-in/200x150/filters:strip_icc()/pic8937637.jpg',
    tags: ['classic', 'family'],
    weight: 1.8188,
    minPlaytime: 30,
    maxPlaytime: 60,
    minAge: 8,
    categories: ['Trains'],
    mechanics: ['Connections', 'Contracts', 'End Game Bonuses', 'Hand Management', 'Network and Route Building', 'Open Drafting', 'Push Your Luck', 'Set Collection'],
    rating: 7.38392,
  },
];

/* --------------------------------- sessions -------------------------------- */

// Round 1's finished sessions, so Chronik and Pokale have content the moment the
// visitor arrives rather than two empty states. Indices into the round's games;
// `winners` and `ratings` index into the seat list (0 = the visitor's own seat).
//
// Kept small and explicit — the point is that the history screens have something
// to render, not to simulate a plausible year of play. #953 deliberately did NOT
// deepen it: the new rounds carry sessions that demonstrate a FEATURE, and a
// longer history would only make the Chronik's period recap busier.
const MAIN_SESSIONS = [
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
    /* The 1 in the last column is a „gar nicht" — the bottom of the scale. One
       of the four, on purpose; see the arithmetic in lib/demo.js's
       seedSessions. */
    ratings: [
      [4, 5, 1],
      [3, 5, 4],
      [5, 5, 5],
      [4, 4, 3],
    ],
  },
];

/* Round 3's one session, which was SPLIT across two tables (#796).

   Its shape differs from the sessions above because a split is not something a
   rating table can express: the parent holds the votes and no chosen game, and
   the two children hold the games actually played. lib/demo.js seeds it through
   the real machinery — computeTableProposals() picks the tables and
   buildChildSessions() builds them — rather than hand-writing the arrangement,
   so a seeded split is by construction one the app itself would have produced,
   and it follows the objective automatically if that is ever retuned.

   `ratings` is [seat][game] over members ∪ guests, in sessionPeople order — so
   the row count is 1 (the visitor's own seat) + the round's fellow members + the
   guests, EIGHT here, and the columns are `gameIndexes` into GROUP_GAMES. A
   short table does not fail: lib/demo.js falls back to a neutral 3 per missing
   cell, so an off-by-one silently flattens somebody's taste instead of throwing.
   test/demo.test.js asserts the row count against the seat arithmetic for that
   reason.

   The numbers are what makes the split worth showing. Four of the eight rate the
   two party games top and Carcassonne low; the other four do the reverse. A
   single table would have to disappoint one of those halves, which is the
   situation multi-table mode exists for — so the recommendation the visitor sees
   is a real one rather than an arbitrary cut. Nothing here reaches an all-2s
   column, which would put the game at LOW_SCORE exactly and open the demo by
   proposing it for the archive (test/retire-score-threshold.test.js asserts that
   over every round). */
const GROUP_SPLIT = {
  daysAgo: 6,
  gameIndexes: [0, 1, 2],
  // The team is two of the five members, by seat index. One team, so the eight
  // people form seven parties — which is what admits a 4 + 3 split and nothing
  // finer (MIN_TABLE_PARTIES is 3, so three tables would need nine).
  team: [3, 4],
  // NOTE there are deliberately no winners here. Which party sits at which table
  // is decided by the objective rather than by this table, so a hand-written
  // winner index would name a person who may not be at that table at all — and
  // `finishSession` stores `winnerIds` verbatim, so nothing would report it.
  // lib/demo.js derives each child's winners from the child itself instead.
  ratings: [
    [5, 5, 2], // the visitor
    [5, 4, 3],
    [4, 5, 2],
    [2, 3, 5], // ── the team, which the objective therefore seats together
    [3, 2, 5], // ─┘
    [2, 3, 5],
    [5, 5, 3], // the two guests
    [3, 2, 5],
  ],
};

/* ----------------------------------- tags ----------------------------------- */

// The tag ids referenced above, resolved to a display name per locale. Keys —
// not names — are what the games carry, so renaming a tag in one language
// cannot desynchronise it from the games that use it.
//
// `icon` is a TAG_ICONS key (lib/tag-icons.js) — the short form WITHOUT the
// `ti-` prefix, which is how a tag stores it and how the frontend renders it.
// The allowlist is closed: an off-list key renders as nothing at all, with no
// error anywhere (.claude/rules/tabler-icon-codepoints.md). test/demo.test.js
// pins every key here against TAG_ICONS so a typo fails loudly.
const DEMO_TAGS = {
  classic: { icon: 'cards', de: 'Klassiker', en: 'Classic', es: 'Clásicos', fr: 'Classiques', it: 'Classici', nl: 'Klassiekers', pt: 'Clássicos' },
  family: { icon: 'users', de: 'Familie', en: 'Family', es: 'Familiar', fr: 'Famille', it: 'Famiglia', nl: 'Familie', pt: 'Família' },
  party: { icon: 'sparkles', de: 'Party', en: 'Party', es: 'Fiesta', fr: 'Ambiance', it: 'Festa', nl: 'Feest', pt: 'Festa' },
  duel: { icon: 'sword', de: 'Zu zweit', en: 'Two player', es: 'Para dos', fr: 'À deux', it: 'In due', nl: 'Met z’n tweeën', pt: 'Para dois' },
};

/* --------------------------------- the rounds ------------------------------- */

/* The three rounds a demo tenant is seeded with, in home-screen order.

   TWO of them carry a WORLD and one deliberately does not. The home screen
   renders each round card in its own world's backdrop, emblem and display face
   (public/js/views-home.js), so a seed on the standard palette showed a visitor
   none of #903/#904/#905 unless they went looking for the design picker — while
   three identical worlds would misrepresent the plain palettes as legacy. Forest
   is light and Sci-Fi is dark, so the pair also shows that a design carries its
   own scheme rather than following the OS (.claude/rules/dark-designs-and-the-on-accent-flip.md).

   `key` indexes DEMO_TEXT's per-locale `rounds` table. `seats` is derived from
   that text rather than declared here, so a locale that seeds a different number
   of fellow players cannot silently change a round's drawability — the parity
   assertion in test/demo.test.js is per round for the same reason. */
const DEMO_ROUNDS = [
  { key: 'main', design: designFor('forest'), games: MAIN_GAMES, sessions: MAIN_SESSIONS },
  { key: 'duo', design: designFor('scifi'), games: DUO_GAMES, sessions: [] },
  { key: 'group', design: designFor('salbei'), games: GROUP_GAMES, sessions: [], split: GROUP_SPLIT },
];

/* ----------------------------------- text ----------------------------------- */

// Per-locale text. The visitor's own seat is named by lib/demo.js (it reuses the
// account's generated username the way a real round does), so only the fellow
// players are named here.
//
// Names are ordinary given names that read naturally in each language rather
// than being "neutral" — a demo round called "Game night" full of German names
// reads as a half-translated app, which is precisely the impression the demo
// exists to avoid.
//
// `guests` are the two people who joined round 3's evening without being members
// of the round (#458). They must NOT repeat a member name of that round: the
// only thing distinguishing them on screen is the „(Gast)" marker, so a repeated
// name reads as one person appearing twice.
//
// `ownerSeat` MUST BE AN ORDINARY NAME, never a pronoun. It was „Du" / „Tú" /
// „Tu" / „Jij" until 2026-09-08, which reads well standing alone („Es bewertet:
// Du") and is wrong the moment a sentence puts it after a preposition: #973's
// member heading „{n} Spiele von {name}" rendered „4 Spiele von Du" — and „de
// Tú", „di Tu", „van Jij" — on the public demo, in four languages at once. A
// pronoun inflects where a name does not, and no single form is right in both
// positions (German needs „Du" nominative and „dir" after „von"), so the seat
// name is the end that has to give. Keep the initials distinct from every member
// and guest of that locale too — the avatar circles are two letters.
// See .claude/rules/interpolated-names-must-not-be-case-governed.md.
const DEMO_TEXT = {
  de: {
    ownerSeat: 'Max',
    rounds: {
      main: { name: 'Spieleabend (Demo)', members: ['Anna', 'Ben', 'Clara'] },
      duo: { name: 'Zu zweit (Demo)', members: ['Ben'] },
      group: { name: 'Große Runde (Demo)', members: ['Anna', 'Ben', 'Clara', 'David', 'Eva'] },
    },
    guests: ['Jonas', 'Mia'],
  },
  en: {
    ownerSeat: 'Max',
    rounds: {
      main: { name: 'Game night (demo)', members: ['Anna', 'Ben', 'Clara'] },
      duo: { name: 'Two-player shelf (demo)', members: ['Ben'] },
      group: { name: 'Big group (demo)', members: ['Anna', 'Ben', 'Clara', 'David', 'Eva'] },
    },
    guests: ['Jonas', 'Mia'],
  },
  es: {
    ownerSeat: 'Marta',
    rounds: {
      main: { name: 'Noche de juegos (demo)', members: ['Ana', 'Bruno', 'Clara'] },
      duo: { name: 'Para dos (demo)', members: ['Bruno'] },
      group: { name: 'Grupo grande (demo)', members: ['Ana', 'Bruno', 'Clara', 'Diego', 'Elena'] },
    },
    guests: ['Pablo', 'Lucía'],
  },
  fr: {
    ownerSeat: 'Manon',
    rounds: {
      main: { name: 'Soirée jeux (démo)', members: ['Camille', 'Bastien', 'Chloé'] },
      duo: { name: 'À deux (démo)', members: ['Bastien'] },
      group: { name: 'Grande tablée (démo)', members: ['Camille', 'Bastien', 'Chloé', 'Damien', 'Élise'] },
    },
    guests: ['Théo', 'Léa'],
  },
  it: {
    ownerSeat: 'Paolo',
    rounds: {
      main: { name: 'Serata giochi (demo)', members: ['Giulia', 'Matteo', 'Sara'] },
      duo: { name: 'In due (demo)', members: ['Matteo'] },
      group: { name: 'Gruppo numeroso (demo)', members: ['Giulia', 'Matteo', 'Sara', 'Davide', 'Elena'] },
    },
    guests: ['Luca', 'Chiara'],
  },
  nl: {
    ownerSeat: 'Roos',
    rounds: {
      main: { name: 'Spelletjesavond (demo)', members: ['Sanne', 'Bram', 'Femke'] },
      duo: { name: 'Met z’n tweeën (demo)', members: ['Bram'] },
      group: { name: 'Grote groep (demo)', members: ['Sanne', 'Bram', 'Femke', 'Daan', 'Lotte'] },
    },
    guests: ['Tim', 'Noor'],
  },
  pt: {
    ownerSeat: 'Miguel',
    rounds: {
      main: { name: 'Noite de jogos (demo)', members: ['Ana', 'Bruno', 'Carla'] },
      duo: { name: 'Para dois (demo)', members: ['Bruno'] },
      group: { name: 'Turma grande (demo)', members: ['Ana', 'Bruno', 'Carla', 'Diego', 'Lívia'] },
    },
    guests: ['Rafa', 'Nina'],
  },
};

// Which locales have seed text — deliberately NOT the app's SUPPORTED_LOCALES
// (public/js/locales.js), and named apart from it so the two cannot be confused.
// A shipped UI locale may legitimately have no demo text yet; it falls back
// below rather than blocking the language.
const DEMO_LOCALES = Object.keys(DEMO_TEXT);

// Fall back to ENGLISH for anything unrecognised — including a UI locale that
// has no seed text of its own yet. German was the right default while the app
// shipped two languages and German was one of them; as the locale list grows,
// handing a Dutch or Italian visitor a German round is the "half-translated app"
// impression the per-locale text above exists to avoid, whereas English is the
// language such a visitor is most likely to read.
function textFor(locale) {
  const key = String(locale || '').slice(0, 2).toLowerCase();
  return DEMO_TEXT[key] || DEMO_TEXT.en;
}

// The text for ONE round of the seed, in the caller's locale. Falls back through
// textFor(), so an unrecognised locale gets the English round rather than a
// round with no name at all.
function roundTextFor(key, locale) {
  return textFor(locale).rounds[key];
}

function tagNameFor(key, locale) {
  const tag = DEMO_TAGS[key];
  if (!tag) return null;
  const lang = String(locale || '').slice(0, 2).toLowerCase();
  return tag[lang] || tag.en;
}

// Every tag key some round's shelf actually references — what lib/demo.js
// creates per round, so a round never grows a tag none of its games carries.
function tagKeysFor(games) {
  return Object.keys(DEMO_TAGS).filter((key) => games.some((g) => (g.tags || []).includes(key)));
}

module.exports = {
  DEMO_ROUNDS,
  DEMO_TAGS,
  DEMO_TEXT,
  DEMO_LOCALES,
  designFor,
  textFor,
  roundTextFor,
  tagNameFor,
  tagKeysFor,
};
