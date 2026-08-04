'use strict';

// <meta name="theme-color"> follows the round's design (#523).
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
const { loadApp } = require('./support/dom');

/* Comments are stripped before anything is matched out of this: a commented-out
   <meta name="theme-color"> above the live tag would be the FIRST match and the
   assertion below would then be pinning a dead value
   (`.claude/rules/css-text-assertions-strip-comments.md`, in HTML). */
const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'index.html'),
  'utf8',
).replace(/<!--[\s\S]*?-->/g, '');

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
  const tags = [...INDEX_HTML.matchAll(/<meta name="theme-color" content="([^"]+)"/g)];
  // Exactly one, so no second (live) tag further down can silently win in the
  // browser while this reads the first.
  assert.equal(tags.length, 1, `index.html declares ${tags.length} theme-color tags, expected exactly 1`);
  assert.equal(tags[0][1], dom.get('STANDARD_ACCENT'));
});

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
