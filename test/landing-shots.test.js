'use strict';

/*
 * Landing-page product screenshots (issues #438, #457, #752, #1090).
 *
 * The hero and the walkthrough render committed static images. Nothing
 * else in the suite would notice if one of them broke, and both failure modes are
 * silent in exactly the way link-preview.test.js describes for og-image.png:
 *
 *  1. A renamed or missing file yields a blank hero with no server-side error —
 *     the visitor sees an empty box on the page that decides whether they stay.
 *  2. A regenerated asset whose real pixel size no longer matches the declared
 *     width/height reintroduces layout shift above the fold, which is precisely
 *     what those attributes exist to prevent. So the dimensions are read back out
 *     of the files rather than trusted.
 *
 * The weight cap is the third half of the issue's constraint ("budget it like a
 * cover"): it stops a future regeneration from quietly dropping a multi-megabyte
 * PNG into the hero. Since #457 it bounds ONE LOCALE's set — what a single
 * visitor actually downloads — because a flat total across every locale gets
 * laxer per visitor with each language added, which is the wrong direction for
 * the one budget guarding the page's first paint.
 *
 * #457's own guarantee is the parity one: every shipped locale has a COMPLETE
 * set. It is the direct analogue of i18n-parity.test.js, and without it a third
 * language ships English copy wrapped around English screenshots — silently,
 * because the fallback in landingShots() renders a perfectly valid page.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

const { app } = require('./helpers');
const { loadApp, translator } = require('./support/dom');
const { SUPPORTED_LOCALES } = require('../public/js/locales');
const { FACE_DESIGN, designById } = require('../public/js/designs');
const { metadataFilterOptions, hasMetadataFilterOptions } = require('../public/js/draw-pool');
const { METADATA } = require('../scripts/landing-seed-data');

const ROOT = path.join(__dirname, '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'public/js/views-landing.js'), 'utf8');

// Per-locale weight budget: what one visitor's landing page can cost. Generous
// next to today's ~120 KB per set so an honest re-crop never trips it, small
// enough that a full-resolution screenshot does. It covers the WALKTHROUGH's
// three phone shots — the budget it always was.
const WEIGHT_BUDGET = 200 * 1024;

// The desktop band's one capture (#1199), budgeted on its own: ~60–80 KB at
// 1800 px wide today, so 120 KB leaves an honest re-crop room while a 2x
// capture (2880 px) or a PNG trips it. Separate rather than folded into the
// walkthrough's cap, because raising that cap to make room would have let the
// three phone shots grow by the desktop's share unnoticed.
const DESKTOP_BUDGET = 120 * 1024;

// The four entries every locale owes — the walkthrough's three steps, in the
// order it renders them (#1090), and the desktop band's capture (#1199). Named
// here rather than derived from one locale's set, or a locale missing `result`
// would define the requirement as "the two I happen to have".
const WALK_SHOTS = ['shelfPhone', 'vote', 'result'];
const REQUIRED_SHOTS = [...WALK_SHOTS, 'desktop'];

// The LANDING_SHOTS table, read out of the view rather than restated here — a
// test constant hand-copied from the thing under test proves nothing
// (.claude/rules/shared-constants-across-the-stack.md). Returns
// { <locale>: [{ name, src, w, h }] }. `table` names which design's table (#1199:
// one per design whose app the landing can show — see designTables()).
function declaredShots(table = 'LANDING_SHOTS') {
  const found = [...VIEW.matchAll(new RegExp(`const ${table} = \\{([\\s\\S]*?)\\n\\};\\n`, 'g'))];
  assert.equal(found.length, 1, `views-landing.js declares exactly one ${table} table`);
  return parseTable(found[0][1]);
}

// Which table each design shows — LANDING_SHOT_SETS, parsed rather than restated.
function designTables() {
  const m = VIEW.match(/const LANDING_SHOT_SETS = \{([^}]*)\};/);
  assert.ok(m, 'views-landing.js declares LANDING_SHOT_SETS');
  const sets = Object.fromEntries([...m[1].matchAll(/(\w+):\s*(\w+)/g)].map(([, design, table]) => [design, table]));
  assert.ok(Object.keys(sets).length >= 2, 'at least Klassisch’s and Der Tisch’s sets are declared');
  return sets;
}

function parseTable(body) {
  const table = [null, body];
  const byLocale = {};
  for (const [, locale, body] of table[1].matchAll(/(\w+):\s*\{([\s\S]*?)\n {2}\},/g)) {
    byLocale[locale] = [...body.matchAll(
      /(\w+):\s*\{\s*src:\s*'([^']+)',\s*w:\s*(\d+),\s*h:\s*(\d+)\s*\}/g
    )].map(([, name, src, w, h]) => ({ name, src, w: Number(w), h: Number(h) }));
  }
  assert.ok(Object.keys(byLocale).length > 0, 'at least one locale set parsed');
  return byLocale;
}

// The capture script's METADATA profiles — the REAL ones, for the same reason
// declaredShots() parses the view: a hand-copied constant proves nothing.
//
// Required rather than matched out of source. It used to be a regex over
// capture-landing-shots.js, because that script starts a server and a browser
// the moment it is loaded and so cannot be required; #1047 moved the seed table
// into its own module (scripts/landing-seed-data.js), which can.
function captureMetadata() {
  assert.ok(METADATA.length > 0, 'METADATA holds at least one profile');
  return METADATA;
}

// Flattened, for the assertions that don't care which locale — or which design's
// set — an asset belongs to. Every design's table, so a Tisch file that is
// missing, mis-sized or over budget is caught exactly like a Klassisch one.
function allShots() {
  return Object.entries(designTables()).flatMap(([design, table]) =>
    Object.entries(declaredShots(table))
      .flatMap(([locale, shots]) => shots.map((s) => ({ ...s, locale, design }))));
}

// Minimal WebP dimension reader — enough for the chunk types Chrome's encoder
// emits, and it refuses anything else rather than guessing.
// RIFF....WEBP<fourcc>, then per-format bit packing.
function webpSize(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF', 'is a RIFF container');
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP', 'is a WebP file');
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') {
    // Extended format (what Chrome's screenshot encoder writes): the canvas size
    // lives in the VP8X header itself as two 24-bit LE values, each minus one.
    return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
  }
  if (fourcc === 'VP8 ') {
    // Lossy: 3-byte start code at 23..25, then 14-bit width and height.
    return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    // Lossless: 1-byte signature, then 14-bit width-1 and height-1, bit-packed.
    const bits = buf.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`unsupported WebP chunk ${fourcc}`);
}

test('every supported locale has a complete screenshot set, in every design\u2019s table', () => {
  for (const table of Object.values(designTables())) {
    const byLocale = declaredShots(table);
    for (const locale of SUPPORTED_LOCALES) {
      const shots = byLocale[locale];
      assert.ok(shots, `${table} has no set for the shipped locale '${locale}'`);
      assert.deepEqual(
        shots.map((s) => s.name).sort(),
        [...REQUIRED_SHOTS].sort(),
        `the ${table} '${locale}' set must declare exactly ${REQUIRED_SHOTS.join(', ')}`
      );
    }
    // …and nothing may ship a set for a locale the app does not offer: that asset
    // is dead weight in the repo and nothing would ever render it.
    for (const locale of Object.keys(byLocale)) {
      assert.ok(
        SUPPORTED_LOCALES.includes(locale),
        `${table} declares a set for '${locale}', which is not a shipped locale`
      );
    }
  }
});

test('every design with a set is registered, and the FACE has one (#1199)', () => {
  // The landing shows the face's app — Der Tisch's since the flip (#1202) — and
  // landingShotSet() falls back to Klassisch's pictures for a design without a
  // set, silently, on the most public page there is. So the face must own a set.
  const sets = designTables();
  for (const design of Object.keys(sets)) {
    assert.ok(designById(design), `LANDING_SHOT_SETS names '${design}', which is not a registered design`);
  }
  assert.ok(sets[FACE_DESIGN], `the face (${FACE_DESIGN}) has no landing screenshot set`);
  assert.equal(sets.klassisch, 'LANDING_SHOTS', 'Klassisch keeps its own set, for an account that wears it');
  // Every set lives in its own folder, so two designs can never overwrite each
  // other's files — and Klassisch's stays exactly where it always was.
  for (const shot of allShots()) {
    const want = shot.design === 'klassisch' ? /^\/img\/landing-/ : new RegExp(`^/img/${shot.design}/landing-`);
    assert.match(shot.src, want, `${shot.src} belongs to ${shot.design}'s folder`);
  }
});

test('the landing shows the worn design’s pictures, and the face’s by default', () => {
  // Boot state untouched: a logged-out visitor wears the face.
  const dom = loadApp({ locale: 'fr', design: null });
  try {
    const src = () => dom.run('landingShots().vote.src');
    const tisch = declaredShots('LANDING_SHOTS_TISCH').fr.find((s) => s.name === 'vote').src;
    assert.equal(FACE_DESIGN, 'tisch');
    assert.equal(src(), tisch, 'a visitor wearing the face (Der Tisch since #1202) sees its pictures');
    dom.call('applyDesign', 'klassisch');
    assert.equal(src(), declaredShots('LANDING_SHOTS').fr.find((s) => s.name === 'vote').src,
      'an account on Klassisch opening the landing sees Klassisch');
    dom.call('applyDesign', 'no-such-design');
    assert.equal(src(), tisch, 'an unknown design falls back to the face');
  } finally { dom.close(); }
});

test('every landing screenshot the view references is actually served', async () => {
  for (const shot of allShots()) {
    const res = await request(app).get(shot.src);
    assert.equal(res.status, 200, `${shot.src} is served`);
    assert.match(res.headers['content-type'], /^image\//, `${shot.src} is served as an image`);
  }
});

test('the declared width/height match the real pixels, so the hero reserves its box', () => {
  for (const shot of allShots()) {
    const buf = fs.readFileSync(path.join(ROOT, 'public', shot.src));
    const real = webpSize(buf);
    assert.deepEqual(
      { w: real.w, h: real.h },
      { w: shot.w, h: shot.h },
      `${shot.src} is ${real.w}x${real.h} but the view declares ${shot.w}x${shot.h}`
    );
  }
});

test("each locale's screenshot set stays inside its weight budget", () => {
  // Per locale, because that is what a visitor downloads. Budgeting the
  // committed total instead would halve this cap's strictness with every
  // language added. Since #1090 the visitor downloads the WHOLE set — the hero
  // and the walkthrough's first step share one <img src>, and the other two are
  // the steps beside it — where the retired <picture> used to fetch one of two
  // shelf widths, so the budget binds harder than it did.
  // Per DESIGN too: a visitor downloads one design's set, never two.
  const perSet = Object.values(designTables())
    .flatMap((table) => Object.entries(declaredShots(table)).map(([l, v]) => [`${table}/${l}`, v]));
  for (const [locale, all] of perSet) {
    const shots = all.filter((s) => WALK_SHOTS.includes(s.name));
    assert.equal(shots.length, WALK_SHOTS.length, `'${locale}' has its three walkthrough shots`);
    const bytes = shots.reduce(
      (sum, s) => sum + fs.statSync(path.join(ROOT, 'public', s.src)).size,
      0
    );
    assert.ok(
      bytes <= WEIGHT_BUDGET,
      `the '${locale}' screenshots total ${(bytes / 1024).toFixed(0)} KB, budget is ${WEIGHT_BUDGET / 1024} KB`
    );
  }
});

test('each desktop capture stays inside its own weight budget (#1199)', () => {
  const desktops = allShots().filter((s) => s.name === 'desktop');
  // Anti-vacuous: one per locale per design, or a table that lost its entries
  // would pass over nothing.
  assert.equal(desktops.length, SUPPORTED_LOCALES.length * Object.keys(designTables()).length);
  for (const shot of desktops) {
    const bytes = fs.statSync(path.join(ROOT, 'public', shot.src)).size;
    assert.ok(bytes <= DESKTOP_BUDGET,
      `${shot.src} is ${(bytes / 1024).toFixed(0)} KB, budget is ${DESKTOP_BUDGET / 1024} KB`);
    // …and it IS a desktop capture: the band exists to show the wide layout, so
    // a phone-shaped file under this name would pass every other assertion.
    assert.ok(shot.w > shot.h, `${shot.src} is ${shot.w}x${shot.h} — the desktop band needs a landscape capture`);
  }
});

test('every narrow landing block stops below the hero visual\u2019s own breakpoint', () => {
  // What this used to pin was the <picture> `media` against the stylesheet. The
  // <picture> went with #1090 and the hero's <img> itself with #1091 — the hero
  // plays the app's own moments now (public/js/landing-moments.js) — and the
  // adjacency survives both: the hero's visual is capped at 340px below 720 and
  // 520 above, so a narrow landing block that reached 720 would apply the phone
  // rhythm at a width where the wider cap is already in force. Same discipline
  // as the dock clearance (.claude/rules/responsive-hub-tabs.md §2), and just as
  // invisible.
  //
  // `<`, not `===`: the landing legitimately has more than one narrow
  // breakpoint since #1090 (719 for the walkthrough strip, 519 for the primary
  // button's size), so pinning equality would forbid the second one rather than
  // catch a straddle. Comments stripped first, or a selector regex matches
  // inside prose that merely mentions the class
  // (.claude/rules/css-text-assertions-strip-comments.md).
  const css = fs
    .readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // Derived from the stylesheet, never restated: the wide branch is whatever
  // block re-caps the hero's visual, so a retune of that breakpoint moves both
  // sides.
  const wideRule = css.match(
    /@media \(min-width: (\d+)px\)\s*\{[^}]*\.landing-hero__visual \.landing-moments/
  );
  assert.ok(wideRule, 'styles.css re-caps the hero visual in a min-width block');
  const wide = Number(wideRule[1]);

  let checked = 0;
  for (const m of css.matchAll(/@media \(max-width: (\d+)px\)\s*\{/g)) {
    // Inner rules are indented, so a newline followed by an unindented `}` is
    // the @media block's own close.
    const body = css.slice(m.index + m[0].length, css.indexOf('\n}', m.index));
    if (!/\.landing[\w-]*\s*\{|\.landing[\w-]*\s+\./.test(body)) continue;
    /* One documented exception (#1091): the hero stage trims the Tafel to two
       rows below 1280, and that number is not the landing's own rhythm — it is
       the width where the app's `.tafel .trow` stops being one line, so the two
       MUST straddle this breakpoint together. It has its own guard, which pins
       it to the Tafel's block rather than to this one:
       test/landing-moments.test.js, "the stage trims its rows exactly where the
       app's row stops being one line". */
    if (/\.landing-moments \.tafel > \.trow:last-child/.test(body)) continue;
    checked++;
    assert.ok(
      Number(m[1]) < wide,
      `a landing @media (max-width: ${m[1]}px) block must stop below ${wide}px to tile with it`
    );
  }
  // Without this the loop passes vacuously the moment the stylesheet's
  // formatting changes enough that the slice above stops matching — the exact
  // silent-green failure .claude/rules/css-text-assertions-strip-comments.md
  // describes, in a test whose whole job is catching an invisible 1px straddle.
  assert.ok(checked > 0, 'found at least one narrow landing @media block to check');
});

test('the desktop band is given close to the page width, not a column (#1199)', () => {
  // #1090 retired the last wide capture because the hero column gave it
  // 660–800px, where its labels shrank to ~9px. The band's whole licence is the
  // width it gets instead, and that is a CSS fact jsdom cannot see — so the cap
  // is read from the stylesheet (comments stripped: a prose mention of the class
  // must not satisfy the match).
  const css = fs
    .readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = css.match(/\.landing-desktop__figure \{([^}]*)\}/);
  assert.ok(rule, '.landing-desktop__figure is declared');
  const cap = rule[1].match(/max-width:\s*(\d+)px/);
  assert.ok(cap, 'the band caps its width in px');
  // 1440 CSS px of layout at >= 1100 renders app text at >= ~10.5px.
  assert.ok(Number(cap[1]) >= 1100, `the band is capped at ${cap[1]}px — too narrow to read a desktop capture`);
  assert.doesNotMatch(css, /\.landing-hero[^{]*\.landing-desktop/, 'no rule places the band inside the hero');
});

test('the walkthrough renders all three shots to ONE height (#1090)', () => {
  // The three crops are not one aspect ratio and cannot be made into one: each
  // is cut where that screen has whitespace to cut in, and the result shot's cut
  // is measured PER LOCALE (resultCrop in scripts/capture-landing-shots.js),
  // because the table band above the ranking is 100px taller in Dutch than in
  // Korean. So the row is levelled in CSS instead, by bounding the height as
  // well as the width — without which the three columns' captions sit at three
  // different heights and the section reads as broken.
  //
  // Asserted because it is invisible everywhere else: jsdom applies no external
  // stylesheet, and each image on its own is perfectly correct.
  const css = fs
    .readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = css.match(/\.landing-walk \.landing-shot \{([^}]*)\}/);
  assert.ok(rule, '.landing-walk .landing-shot is declared');
  assert.match(rule[1], /max-height:[^;]*\d+px/, 'the walkthrough shots are bounded by height');
  // …and that bound has to give way on a narrow three-column row, or the shots
  // outgrow their tracks and overlap. Measured at 768px before the `vw` term:
  // 272px and 251px shots in 224px tracks, with no page overflow to notice.
  assert.match(rule[1], /max-height:\s*min\(/,
    'a flat max-height is taller than a tablet track can carry — it must be fluid');
  assert.match(rule[1], /width:\s*auto/,
    'width must give way, or the height cap cannot bind on the taller shot');

  // …and the heights really do differ, so the rule above is not decoration. A
  // set that happened to be uniform would make it vacuous.
  const heights = new Set(allShots().filter((s) => WALK_SHOTS.includes(s.name)).map((s) => s.h));
  assert.ok(heights.size > 1, 'the shots have different heights — that is why the cap exists');
});

test('the render sites read the set through the locale resolver, never a fixed one', () => {
  // The whole feature is that getLocale() decides at render time. A single
  // `LANDING_SHOTS.de.shelfPhone` left behind renders a valid page in the wrong
  // language — no error, no broken image, just the half-translated result #457
  // exists to remove. So: the table is read exactly once, by the resolver.
  // Since #1199 the table is picked per design first (landingShotSet), then
  // subscripted by locale — still in exactly one place.
  assert.match(
    VIEW,
    /function landingShots\(\)\s*\{\s*\n\s*const set = landingShotSet\(\);\s*\n\s*return set\[getLocale\(\)\]/,
    'landingShots() resolves the set from getLocale()'
  );
  assert.equal([...VIEW.matchAll(/\bset\[/g)].length, 2, 'the chosen set is subscripted only inside landingShots()');
  assert.doesNotMatch(VIEW, /LANDING_SHOTS(?:_TISCH)?\[/, 'no render site subscripts a table directly');
  assert.doesNotMatch(VIEW, /LANDING_SHOTS(?:_TISCH)?\.\w/, 'no render site reaches into a fixed locale');
});

test('the screenshots are informative images, not decoration', () => {
  // Both carry localized alt text and neither is aria-hidden — the pre-#438 hero
  // was aria-hidden decoration, which is the wrong answer once the image is the
  // thing explaining the product.
  // The walkthrough interpolates its alt key from LANDING_WALK, so the three are
  // asserted through that table rather than as three literals — which is also
  // what makes a fourth step arrive covered.
  const walk = VIEW.match(/const LANDING_WALK = \[([\s\S]*?)\];/);
  assert.ok(walk, 'views-landing.js declares LANDING_WALK');
  const altKeys = [...walk[1].matchAll(/'(landing\.shot\.\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(altKeys, ['landing.shot.shelfAlt', 'landing.shot.voteAlt', 'landing.shot.resultAlt']);
  assert.match(VIEW, /alt="\$\{esc\(t\(altKey\)\)\}"/, 'the walkthrough renders its alt from the table');
  // The desktop band's capture is informative too (#1199), in every language —
  // its alt says what the wide layout holds, which is the band's whole point.
  assert.match(VIEW, /alt="\$\{esc\(t\('landing\.desktop\.alt'\)\)\}"/,
    'the desktop band renders a translated alt');
  for (const locale of SUPPORTED_LOCALES) {
    const alt = translator(locale)('landing.desktop.alt');
    assert.ok(alt !== 'landing.desktop.alt' && alt.length > 40,
      `'${locale}' has a real alt for the desktop capture, got: ${alt}`);
  }
  // The hero holds no image at all since #1091 — it plays the app's own moments
  // — so the pre-#438 failure it used to guard against (an aria-hidden hero
  // picture) cannot recur there. What replaces the assertion is its inverse: the
  // hero's slot must stay EMPTY in the markup, because the stage is appended
  // into it after the view is in the document. A stray <img> here would be a
  // second, undescribed picture sitting under the stage.
  const slot = VIEW.match(/<div class="landing-hero__visual"([^>]*)><\/div>/);
  assert.ok(slot, 'the hero visual is an empty slot the stage is mounted into');
  assert.doesNotMatch(slot[1], /aria-hidden/,
    'the slot holds the stage, which names itself — hiding the slot would hide that name');
});

test('the capture seed can still make the metadata-gated affordances render', () => {
  // #752's actual finding. Two of the things these screenshots exist to show are
  // gated on a game HAVING provider metadata — the vote card's ⓘ (#724/#730) and
  // the Regal's „Weitere Filter" disclosure (#725) — and the seed carried none,
  // so the reshoot depicted an app two feature-generations old however current
  // the code was. Neither gate can go red on its own: the app is correct, and
  // this file's other six tests check parity, pixels and weight, none of which
  // can see WHAT a picture shows.
  //
  // So it asserts against the two REAL predicates rather than restating their
  // field lists, which would drift the moment either gate widened.
  const games = captureMetadata().map((p, i) => ({ id: `g${i}`, title: `Game ${i}`, ...p }));

  assert.ok(
    hasMetadataFilterOptions(metadataFilterOptions(games)),
    'the seeded shelf can offer metadata filters, so the Regal renders their half of „Filter"'
  );

  // game-info.js builds DOM and deliberately carries no module.exports guard
  // (requiring it would drag a DOM file into the coverage report), so the real
  // hasGameInfo is reached through the jsdom harness. No options: that is
  // exactly how the vote card calls it, and its `rating` flag defaults to off.
  const dom = loadApp();
  try {
    for (const game of games) {
      assert.ok(dom.call('hasGameInfo', game),
        `a game seeded with ${JSON.stringify(game)} shows the ⓘ on the vote card`);
    }
  } finally {
    dom.close();
  }
});
