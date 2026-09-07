'use strict';

/*
 * The guest demo's SEED TABLE (issues #427, #953) — assertions about the data in
 * lib/demo-seed.js, with no app, no HTTP and no DATA_DIR.
 *
 * Split out of test/demo.test.js when #953 grew the seed from one round to three
 * and pushed that file past the 700-line budget
 * (.claude/rules/token-friendly-source-files.md). The seam is real rather than
 * arithmetic: everything here is a synchronous read of an exported table, so it
 * needs none of the sibling's setup — not the ACCOUNTS_ENABLED/DEMO_ENABLED app,
 * not supertest, and none of the three rate-limit ceilings that file has to
 * raise before it can mint anything. The lifecycle half (minting, the gate, the
 * caps, ending and purging a demo) stays there.
 *
 * Named for what it covers rather than for the module, because `demo-seed` is
 * not a unique basename risk today but the sibling `demo.test.js` already is the
 * obvious name — see .claude/rules/test-file-names-collide-silently.md.
 */

const test = require('node:test');
const assert = require('node:assert');

const seed = require('../lib/demo-seed');
const { providerCoverUrl } = require('../lib/providers');
const { TAG_ICONS } = require('../lib/tag-icons');
// The app's own predicates, never a re-derived copy: a spec that reimplements
// "is this drawable" asserts its own arithmetic rather than the pool's
// (.claude/rules/active-games-filter-sites.md).
const { isActiveGame, fitsPlayerCount } = require('../public/js/draw-pool');
const { resolveDesign } = require('../public/js/round-designs');
const { MIN_TABLE_PARTIES } = require('../public/js/table-split');
const { PROVIDER_INFO_FIELDS } = require('../lib/provider-info-fields');

// Every seeded game across every round, tagged with the round it belongs to, so
// a failure names which shelf is wrong rather than an index into a list that no
// longer exists. Derived, so a fourth round is covered by every spec below
// without anyone remembering they are here (#953).
const ALL_GAMES = seed.DEMO_ROUNDS.flatMap((r) => r.games.map((g) => ({ ...g, round: r.key })));

test('the seed still holds more than one round, so every derived loop below is non-vacuous', () => {
  // The anti-vacuous floor for this whole file. Almost every spec here now loops
  // DEMO_ROUNDS, and a seed collapsed back to one round would satisfy all of
  // them — including the per-round drawability assertion that #953 exists to
  // add. Asserting the floor separately is what keeps "it passed" meaningful.
  assert.ok(seed.DEMO_ROUNDS.length >= 3, `expected at least three seeded rounds, got ${seed.DEMO_ROUNDS.length}`);
  assert.ok(ALL_GAMES.length >= 15, `expected a real shelf across the rounds, got ${ALL_GAMES.length} games`);
});

test('the seed actually CARRIES covers and provider metadata', () => {
  // The anti-vacuous floor for the metadata, and it was genuinely needed: until
  // the resolver was run for #953 every row had `image: null` and no metadata at
  // all, so the end-to-end spec in test/demo.test.js compared 0 resolved rows
  // against 0 stored ones and passed against a seed carrying nothing.
  //
  // It is a FLOOR rather than an exact count on purpose: BGG legitimately has no
  // data for some games, and the resolver stores only what it got back — so
  // demanding every field of every row would fail for a reason nobody can fix.
  const withCover = ALL_GAMES.filter((g) => g.image);
  const withMeta = ALL_GAMES.filter((g) => PROVIDER_INFO_FIELDS.some((k) => g[k] != null));
  assert.ok(withCover.length >= ALL_GAMES.length - 2,
    `only ${withCover.length}/${ALL_GAMES.length} seeded games have a cover — re-run scripts/resolve-demo-covers.js`);
  assert.ok(withMeta.length >= ALL_GAMES.length - 2,
    `only ${withMeta.length}/${ALL_GAMES.length} seeded games carry provider metadata — the Regal would offer no filters until the backfill hops BGG`);
  // The three the Regal derives its filter controls from. Without a real value
  // somewhere on the shelf the control does not exist at all.
  for (const key of ['weight', 'minPlaytime', 'minAge']) {
    assert.ok(ALL_GAMES.some((g) => g[key] != null), `no seeded game carries '${key}' — that filter never renders`);
  }
});

test('every seeded cover passes the same guard the add-game route applies', () => {
  // Not a style check: an `image` that fails this is stored but never renders —
  // CSP blocks an off-allowlist host and the app shows a gradient with only a
  // console violation to explain it. Rendering nothing is the failure mode this
  // catches, and it is invisible from every other test.
  for (const game of ALL_GAMES) {
    if (game.image === null) continue;
    assert.strictEqual(
      providerCoverUrl(game.image),
      game.image,
      `${game.round}/${game.title}: cover URL is not one the app would store`
    );
  }
});

test('every seeded design is a real registry entry, stored in the shape the app reads', () => {
  // A design that does not resolve renders as the STANDARD palette with no error
  // anywhere — i.e. exactly the "the worlds are invisible" state #953 exists to
  // end, reintroduced silently. resolveDesign() is the app's own lookup, so this
  // asserts what the home tile will actually do rather than re-deriving it.
  for (const round of seed.DEMO_ROUNDS) {
    const design = resolveDesign(round.design);
    assert.ok(design, `round '${round.key}': design ${JSON.stringify(round.design)} resolves to nothing`);
    assert.strictEqual(round.design.type, 'theme');
    assert.strictEqual(round.design.page, design.page, `round '${round.key}': page hex is not the registry's`);
    assert.strictEqual(round.design.accent, design.accent, `round '${round.key}': accent is not the registry's`);
  }
});

test('the seed shows a world in each scheme, and at least one round without one', () => {
  // The point of seeding three rounds rather than one (#953): the home screen
  // renders each card in its own world's backdrop, emblem and display face, so a
  // seed whose rounds all share a design demonstrates none of that — and three
  // worlds would misrepresent the plain palettes as legacy. A light world, a
  // dark one and a palette is the smallest set that shows all three facts.
  const designs = seed.DEMO_ROUNDS.map((r) => resolveDesign(r.design));
  const worlds = designs.filter((d) => d.world);
  assert.ok(worlds.some((d) => d.scheme !== 'dark'), 'no LIGHT world is seeded');
  assert.ok(worlds.some((d) => d.scheme === 'dark'), 'no DARK world is seeded — #904 is then invisible in the demo');
  assert.ok(designs.some((d) => !d.world), 'every seeded round carries a world; a plain palette must be shown too');
});

test('the two off-shelf states are both seeded, and neither is what keeps a round drawable', () => {
  // A demo with no archived game and no wish never shows the Archiv or the
  // Wunschliste — two screens a visitor deciding whether to keep the app would
  // want to have seen. The second half is the trap: isActiveGame excludes both
  // from every draw pool, so an archived game counted as shelf stock would make
  // the drawability spec below pass over a round that cannot actually be drawn.
  assert.ok(ALL_GAMES.some((g) => g.retired), 'no retired game is seeded — the Archiv stays empty');
  assert.ok(ALL_GAMES.some((g) => g.wish), 'no wish game is seeded — the Wunschliste stays empty');
  for (const game of ALL_GAMES) {
    assert.ok(!(game.retired && game.wish), `${game.round}/${game.title}: retired and wished at once`);
    assert.strictEqual(isActiveGame(game), !game.retired && !game.wish);
  }
});

test('every seeded tag icon is on the TAG_ICONS allowlist', () => {
  // An off-list key renders NOTHING, with no error anywhere — so a typo here is
  // only ever caught by someone looking at the screen.
  for (const [key, tag] of Object.entries(seed.DEMO_TAGS)) {
    assert.ok(TAG_ICONS.includes(tag.icon), `tag ${key}: icon '${tag.icon}' is not in TAG_ICONS`);
  }
});

test('every tag a seeded game references exists', () => {
  for (const game of ALL_GAMES) {
    for (const key of game.tags || []) {
      assert.ok(seed.DEMO_TAGS[key], `${game.round}/${game.title} references unknown tag '${key}'`);
    }
  }
});

test('EVERY seeded round can actually be drawn from at its OWN table size', () => {
  // A shelf whose games all cap below (or start above) the round's seat count
  // makes "Session wirbeln" answer "No matching games in this round", which
  // reads as the app being broken on the one screen the demo exists to
  // demonstrate.
  //
  // Per ROUND is the whole point (#953): the flat version of this spec measured
  // the first round's shelf against the first round's seats and would have said
  // nothing about a two-player round seeded with six-player games. The predicate
  // is the app's own — fitsPlayerCount over isActiveGame — rather than a
  // re-derived range comparison, so an archived or wished row cannot be counted
  // as stock (.claude/rules/active-games-filter-sites.md).
  for (const round of seed.DEMO_ROUNDS) {
    const seats = 1 + seed.DEMO_TEXT.de.rounds[round.key].members.length;
    const drawable = round.games.filter((g) => isActiveGame(g) && fitsPlayerCount(g, seats));
    assert.ok(
      drawable.length >= 3,
      `round '${round.key}': only ${drawable.length} of ${round.games.length} games are drawable at ${seats} players`
    );
  }
});

test('every seeded locale seeds the same number of fellow players, per round', () => {
  // The seat count is what the draw pool's player ranges are sized against (see
  // the drawability spec above), so it must not vary by language — and it has to
  // be checked per ROUND, since the rounds deliberately seat different numbers.
  // A union over all rounds would be satisfied by any locale that happened to
  // total the same across a different split.
  for (const round of seed.DEMO_ROUNDS) {
    const counts = seed.DEMO_LOCALES.map((loc) => seed.DEMO_TEXT[loc].rounds[round.key].members.length);
    assert.ok(counts.length >= 2, 'expected at least two seeded locales');
    assert.deepEqual(
      [...new Set(counts)], [counts[0]],
      `round '${round.key}': fellow-player counts differ by locale: ${counts.join(', ')}`
    );
  }
});

test('every locale seeds the same number of guests, and none repeats a member name', () => {
  // A guest is distinguished from a member on screen by the „(Gast)" marker
  // alone, so a guest sharing a member's name in that round reads as one person
  // listed twice — on the results screen, in the winner picker and in the split.
  const counts = seed.DEMO_LOCALES.map((loc) => seed.DEMO_TEXT[loc].guests.length);
  assert.deepEqual([...new Set(counts)], [counts[0]], `guest counts differ by locale: ${counts.join(', ')}`);
  const guestRound = seed.DEMO_ROUNDS.find((r) => r.split);
  assert.ok(guestRound, 'no round carries a split, so the guests are seeded onto nothing');
  for (const loc of seed.DEMO_LOCALES) {
    const text = seed.DEMO_TEXT[loc];
    for (const guest of text.guests) {
      assert.ok(
        !text.rounds[guestRound.key].members.includes(guest),
        `${loc}: guest '${guest}' repeats a member of round '${guestRound.key}'`
      );
    }
  }
});

test('the split fixture rates exactly the people who sit at the table', () => {
  // lib/demo.js falls back to a neutral 3 for a missing cell, so a short
  // `ratings` table does not throw — it silently flattens somebody's taste, and
  // the split then reflects an opinion nobody expressed. The row count is the
  // only thing that can catch it, and it is seat arithmetic rather than a
  // literal so it follows the seed.
  for (const round of seed.DEMO_ROUNDS.filter((r) => r.split)) {
    const people = 1 + seed.DEMO_TEXT.de.rounds[round.key].members.length + seed.DEMO_TEXT.de.guests.length;
    assert.strictEqual(
      round.split.ratings.length, people,
      `round '${round.key}': ${round.split.ratings.length} rating rows for ${people} people`
    );
    for (const row of round.split.ratings) {
      assert.strictEqual(row.length, round.split.gameIndexes.length, 'a rating row is short of the drawn games');
    }
    // The parties have to admit a two-table split at all: MIN_TABLE_PARTIES is 3
    // per table, and a team counts as ONE party.
    const parties = people - round.split.team.length + 1;
    assert.ok(parties >= 2 * MIN_TABLE_PARTIES, `round '${round.key}': ${parties} parties cannot fill two tables`);
  }
});

test('a locale with no seed text falls back to English rather than throwing', () => {
  // English, not German (#504): a UI locale may ship before its demo text, and
  // handing a Dutch or Portuguese visitor a German round is the half-translated
  // impression the per-locale seed exists to avoid.
  //
  // The stand-in is the UNSHIPPED 'zx', as in test/i18n-locales.test.js. It used
  // to be 'it' — a language with an open translation issue, so shipping Italian
  // (#536) made textFor('it') return the Italian seed and this assertion assert
  // the opposite of its own name. Never stand in for "unshipped" with a code
  // some issue is about to ship (.claude/rules/locale-set-is-data.md).
  assert.strictEqual(seed.textFor('zx'), seed.DEMO_TEXT.en);
  assert.strictEqual(seed.textFor(''), seed.DEMO_TEXT.en);
  assert.strictEqual(seed.textFor(undefined), seed.DEMO_TEXT.en);
  assert.strictEqual(seed.tagNameFor('party', 'zx'), seed.DEMO_TAGS.party.en);
  // A locale that DOES have text still gets its own, region tag and all.
  assert.strictEqual(seed.textFor('en-GB'), seed.DEMO_TEXT.en);
  assert.strictEqual(seed.textFor('de'), seed.DEMO_TEXT.de);
  assert.strictEqual(seed.tagNameFor('party', 'de'), seed.DEMO_TAGS.party.de);
});

/* The three game blocks are a live-service fixture (signed BGG cover URLs that
   rot), and until the 2026-09-06 audit nothing in the file said WHEN they were
   last resolved (M-009). The script prints the stamp at the head of the block
   it emits, so it regenerates with the data; this pins that the seed carries
   one and that the script still emits the same line. */
test('the seed carries the date it was resolved, in the form the script emits', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const seedSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'demo-seed.js'), 'utf8');
  const stamp = seedSrc.match(/^\/\/ Resolved (\d{4}-\d{2}-\d{2}) by scripts\/resolve-demo-covers\.js/m);
  assert.ok(stamp, 'lib/demo-seed.js has no "// Resolved <date> by scripts/resolve-demo-covers.js" line');
  assert.ok(!Number.isNaN(Date.parse(stamp[1])), `not a date: ${stamp[1]}`);
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'resolve-demo-covers.js'), 'utf8');
  assert.match(script, /console\.log\(`\/\/ Resolved \$\{[^}]+\} by scripts\/resolve-demo-covers\.js/,
    'the script no longer prints the stamp the seed is pinned to');
});
