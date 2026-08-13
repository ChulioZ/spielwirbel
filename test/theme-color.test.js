'use strict';

// <meta name="theme-color"> follows the round's design (#523), and every page
// that ships the manifest starts from the manifest's own theme_color (#597).
//
// The tag tints the mobile browser toolbar and the installed PWA's chrome, and
// index.html ships it at the standard accent — so inside a themed round the
// frame around the app stayed brand-orange. `applyBackground` now moves it with
// the accent it applies.
//
// Driven through the jsdom harness rather than by matching core.js's source:
// what matters is the attribute the function actually leaves on the document,
// including on the way BACK to the default, which a regex cannot see.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { loadApp } = require('./support/dom');

/* PARSED, not matched as text. A commented-out <meta name="theme-color"> above
   the live tag would be the first match of any regex, so the assertion below
   would pin a dead value while the real tag drifted
   (`.claude/rules/css-text-assertions-strip-comments.md`, in HTML). A comment is
   not an element, so a parser cannot make that mistake at all.

   Stripping `<!--…-->` out of the text first would fix it too — but CodeQL reads
   that replace as sanitization and flags it `js/incomplete-multi-character-
   sanitization` (HIGH), correctly: one pass over `<!<!-- -->--` leaves `<!--`
   behind. Using the real parser is both the stronger tool and the quiet one.

   A bare JSDOM of the file, not the harness's document: the question is what the
   markup declares, which must stay separable from anything a script does to the
   tag after load. Nothing is executed here (no `runScripts`). */
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function parsePage(file) {
  const { document } = new JSDOM(fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8')).window;
  return {
    file,
    linksManifest: Boolean(document.querySelector('link[rel="manifest"]')),
    themeColors: [...document.querySelectorAll('meta[name="theme-color"]')]
      .map((el) => el.getAttribute('content')),
  };
}

/* DERIVED, never a hand-written page list: a fourth standalone document that
   links the manifest is covered the day it is added, which is the whole failure
   this guards — kontakt.html shipped at its own page background in #224 and
   stayed there while index.html and login.html carried the brand value (#597). */
const PAGES = fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html')).sort().map(parsePage);
const INSTALL_SURFACES = PAGES.filter((p) => p.linksManifest);
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.webmanifest'), 'utf8'),
);
const INDEX_THEME_COLORS = PAGES.find((p) => p.file === 'index.html').themeColors;

// Sand's accent before #145 darkened it for contrast. Deliberately a literal:
// it is a value rounds still carry in their stored design and that the code
// deliberately no longer holds anywhere.
const STALE_SAND_ACCENT = '#a2701d';

const metaColor = (dom) =>
  dom.document.querySelector('meta[name="theme-color"]').getAttribute('content');
const brandVar = (dom) =>
  dom.document.documentElement.style.getPropertyValue('--brand');

test('the static default in index.html is the standard accent core.js falls back to', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  // Not a literal on either side: the markup's value is parsed out and compared
  // to the constant the code restores, so the two cannot drift apart.
  // Exactly one, so no second tag further down can silently win in the browser
  // while this reads the first — and so a live tag that went missing is a
  // failure rather than a value read off some commented-out remnant.
  assert.equal(INDEX_THEME_COLORS.length, 1,
    `index.html declares ${INDEX_THEME_COLORS.length} live theme-color tags, expected exactly 1`);
  assert.equal(INDEX_THEME_COLORS[0], dom.get('STANDARD_ACCENT'));
});

/* Every page linking the manifest is a PWA install surface, so an install from
   it produces app chrome in that page's theme-color — from the same app, tinted
   differently depending only on which document the user happened to be on when
   they installed. The relationship is asserted against the manifest rather than
   against a hex per page: a literal restated per document is the copy problem
   these files already have one level up
   (`.claude/rules/shared-constants-across-the-stack.md`). */
test('the derived install-surface set discriminates, so the loop below is not vacuous', () => {
  // Without this the whole check passes by finding nothing — a broken readdir
  // filter or a renamed link rel would silently retire the guard.
  assert.ok(INSTALL_SURFACES.some((p) => p.file === 'index.html'),
    'index.html is the SPA and definitionally an install surface');
  assert.ok(INSTALL_SURFACES.length >= 2,
    `expected the standalone documents to be covered too, got ${INSTALL_SURFACES.length}`);

  /* admin.html is the discriminating case: it declares its own #eef1f5 and is
     deliberately outside the design system, which is only tolerable because it
     links no manifest and therefore installs nothing
     (`.claude/rules/admin-moderation-surface.md`). If it ever gains one, it
     joins the loop below rather than keeping its private value. */
  const admin = PAGES.find((p) => p.file === 'admin.html');
  assert.ok(admin, 'admin.html is gone — re-point this assertion at whatever replaced it');
  assert.equal(admin.linksManifest, false,
    'admin.html now links the manifest: it is an install surface and must match theme_color');
});

for (const page of INSTALL_SURFACES) {
  test(`${page.file} declares the manifest's theme_color`, () => {
    // Exactly one, for the same reason index.html's own tag is counted above:
    // a second live tag would win in the browser while this read the first.
    assert.equal(page.themeColors.length, 1,
      `${page.file} declares ${page.themeColors.length} live theme-color tags, expected exactly 1`);
    assert.equal(page.themeColors[0], MANIFEST.theme_color,
      `${page.file} would install chrome in ${page.themeColors[0]}, `
      + `the manifest says ${MANIFEST.theme_color}`);
  });
}

test('a themed round moves the chrome to its accent, in lockstep with --brand', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  dom.call('applyBackground', { type: 'theme', page: '#e9eef3', accent: '#33688f' });
  assert.equal(metaColor(dom), '#33688f');
  assert.equal(brandVar(dom), '#33688f', 'the tag and the accent variable must not disagree');
});

test('a stale stored accent is resolved against the current THEMES', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  /* Sand's pre-#145 accent, still carried by rounds that picked it back then.
     The page paints with the corrected value, so the chrome has to as well.

     Only the STALE hex is a literal here — it is history and exists nowhere in
     the code. Sand's current page and accent are read off THEMES, so the next
     legitimate contrast retune needs no hand-edit in this file
     (`.claude/rules/theme-derived-colors.md`). */
  const sand = JSON.parse(dom.run("JSON.stringify(THEMES.find((x) => x.labelKey === 'theme.sand'))"));
  assert.notEqual(sand.accent, STALE_SAND_ACCENT,
    'Sand\'s accent is back at its pre-#145 value, so this test no longer resolves anything');

  dom.call('applyBackground', { type: 'theme', page: sand.page, accent: STALE_SAND_ACCENT });
  assert.equal(metaColor(dom), sand.accent);
  assert.equal(brandVar(dom), sand.accent);
});

test('a legacy plain-color design keeps the standard accent', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  dom.call('applyBackground', { type: 'theme', page: '#eef2f7', accent: '#3a67b1' });
  assert.equal(metaColor(dom), '#3a67b1'); // or the restore below passes vacuously
  dom.call('applyBackground', { type: 'color', color: '#fff7ed' });
  // That design carries no accent, so the page falls back to the :root --brand
  // and the chrome must follow it back rather than keep the previous round's.
  assert.equal(metaColor(dom), dom.get('STANDARD_ACCENT'));
  assert.equal(brandVar(dom), '');
});

test('leaving a round restores the default chrome', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  // Entering first is the point: asserting the default on a fresh document
  // would pass against a function that never touches the tag at all.
  dom.call('applyBackground', { type: 'theme', page: '#efedf8', accent: '#6d55c4' });
  assert.equal(metaColor(dom), '#6d55c4');

  dom.call('applyBackground', null); // home, the landing, an unthemed round
  assert.equal(metaColor(dom), dom.get('STANDARD_ACCENT'));
  assert.equal(brandVar(dom), '');
});
