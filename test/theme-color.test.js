'use strict';

// <meta name="theme-color"> follows the worn design (#523), and every page that
// ships the manifest starts from the theme_color its manifest URL answers with
// (#597).
//
// The tag tints the mobile browser toolbar and the installed PWA's chrome.
// Rounds could move it with their own palette until the flip (#1202); since
// then only the account's design does, through `paintDesign`.
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
/* What the BARE manifest URL — the one every install surface links — answers
   with: the FACE's manifest (lib/web-manifest.js), which since the flip (#1202)
   is Der Tisch's, derived from the static file. The static file itself is now
   Klassisch's (`?design=klassisch`). Resolved through the route's own helper so
   this spec cannot disagree with what the server sends. */
const { manifestFor } = require('../lib/web-manifest');
const { FACE_DESIGN, designById } = require('../public/js/designs');
const STATIC_MANIFEST = JSON.parse(
  fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.webmanifest'), 'utf8'),
);
const MANIFEST = manifestFor(STATIC_MANIFEST, designById(FACE_DESIGN)) || STATIC_MANIFEST;
const INDEX_THEME_COLORS = PAGES.find((p) => p.file === 'index.html').themeColors;

const metaColor = (dom) =>
  dom.document.querySelector('meta[name="theme-color"]').getAttribute('content');
const brandVar = (dom) =>
  dom.document.documentElement.style.getPropertyValue('--brand');

test('the static default in index.html is the FACE design\'s accent', (t) => {
  // Boot state: the face, which is what a visitor sees before any script runs.
  const dom = loadApp({ design: null });
  t.after(() => dom.close());

  // Not a literal on either side: the markup's value is parsed out and compared
  // to the constant the code restores, so the two cannot drift apart.
  // Exactly one, so no second tag further down can silently win in the browser
  // while this reads the first — and so a live tag that went missing is a
  // failure rather than a value read off some commented-out remnant.
  assert.equal(INDEX_THEME_COLORS.length, 1,
    `index.html declares ${INDEX_THEME_COLORS.length} live theme-color tags, expected exactly 1`);
  const face = designById(FACE_DESIGN);
  assert.equal(INDEX_THEME_COLORS[0], face.accent || dom.get('STANDARD_ACCENT'));
  assert.equal(metaColor(dom), INDEX_THEME_COLORS[0], 'boot paints exactly what the markup declared');
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

test('wearing a design moves the chrome to its accent, in lockstep with --brand', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  const tisch = designById('tisch');
  dom.call('applyDesign', 'tisch');
  assert.equal(metaColor(dom), tisch.accent);
  assert.equal(brandVar(dom), tisch.accent, 'the tag and the accent variable must not disagree');

  // Klassisch declares no accent: back to the :root --brand, and the chrome
  // follows it rather than keeping the previous design's.
  dom.call('applyDesign', 'klassisch');
  assert.equal(metaColor(dom), dom.get('STANDARD_ACCENT'));
  assert.equal(brandVar(dom), '');
});

test('a round no longer moves the chrome — only the worn design does (#1202)', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  dom.call('applyDesign', 'klassisch');
  // A round that stored a Schiefer palette before the flip.
  dom.call('applyMarker', { id: 'r1', background: { type: 'theme', id: 'schiefer', page: '#e9eef3', accent: '#33688f' } });
  assert.equal(metaColor(dom), dom.get('STANDARD_ACCENT'), 'the retired round design must not tint the chrome');
  assert.equal(brandVar(dom), '');
  dom.call('applyMarker', null);
  assert.equal(metaColor(dom), dom.get('STANDARD_ACCENT'));
});
