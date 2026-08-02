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

const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'index.html'),
  'utf8',
);

const metaColor = (dom) =>
  dom.document.querySelector('meta[name="theme-color"]').getAttribute('content');
const brandVar = (dom) =>
  dom.document.documentElement.style.getPropertyValue('--brand');

test('the static default in index.html is the standard accent core.js falls back to', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  // Not a literal on either side: the markup's value is parsed out and compared
  // to the constant the code restores, so the two cannot drift apart.
  const declared = INDEX_HTML.match(/<meta name="theme-color" content="([^"]+)"/)[1];
  assert.equal(declared, dom.get('STANDARD_ACCENT'));
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

  // Sand's pre-#145 accent, still carried by rounds that picked it back then.
  // The page paints with the corrected value, so the chrome has to as well.
  dom.call('applyBackground', { type: 'theme', page: '#f6efe2', accent: '#a2701d' });
  assert.equal(metaColor(dom), '#91641a');
  assert.equal(brandVar(dom), '#91641a');
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
