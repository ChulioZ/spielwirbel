'use strict';

/* #1578 — the scope strip (Regal · Wunschliste · Aussortiert · Durchgespielt ·
   Könnte euch gefallen) on a phone, in the four designs that draw it as a
   one-row segmented tray: Klassisch, Der Tisch, Ocean and Forest.

   Up to 639px the tray scrolled sideways and cut the third segment off, so two
   lists were out of sight. Below that width each of the four now draws the strip
   as Das Programmheft does: wrapped text tabs, name and count, the current one
   underlined. From 640px the tray is untouched — the top-level rule still
   scrolls, and nothing outside the phone block changed.

   CSS text, because jsdom applies no external stylesheet: a view spec cannot see
   any of this. The markup is unchanged (the counted label already carries the
   count), so the existing view specs still pin which segments exist, their
   routes and `aria-current`. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rulesOf, declaredValue, mediaBlocks, topLevel } = require('./support/css');

const ROOT = path.join(__dirname, '..');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const sheet = (rel) => stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const PHONE = /^\(max-width:\s*639px\)$/;

const DESIGNS = [
  {
    id: 'klassisch',
    file: 'public/styles.css',
    strip: ':root[data-design="klassisch"] .offshelf-seg',
    item: ':root[data-design="klassisch"] .offshelf-seg__item',
  },
  {
    id: 'tisch',
    file: 'public/css/designs/tisch.css',
    strip: ':root[data-design="tisch"][data-scheme="dark"] .offshelf-seg',
    item: ':root[data-design="tisch"][data-scheme="dark"] .offshelf-seg__item',
  },
  {
    id: 'ocean',
    file: 'public/css/designs/ocean.css',
    strip: ':root[data-design="ocean"]:not([data-scheme="dark"]) .offshelf-seg',
    item: ':root[data-design="ocean"]:not([data-scheme="dark"]) .offshelf-seg__item',
  },
  {
    id: 'forest',
    file: 'public/css/designs/forest.css',
    strip: ':root[data-design="forest"] .app > .offshelf-seg',
    item: ':root[data-design="forest"] .app > .offshelf-seg .offshelf-seg__item',
  },
];

// Every rule naming `selector` (as one member of its group) inside the phone
// blocks of `css`, in source order.
const phoneBodies = (css, selector) => mediaBlocks(css)
  .filter(([q]) => PHONE.test(q))
  .flatMap(([, body]) => rulesOf(body))
  .filter(([sel]) => sel.split(',').map((s) => s.trim()).includes(selector))
  .map(([, body]) => body);

// The LAST value a phone block declares for `prop` on `selector` — what wins
// at equal specificity, since the phone block follows the top-level rule.
const phoneValue = (css, selector, prop) => phoneBodies(css, selector)
  .map((b) => declaredValue(b, prop))
  .filter((v) => v != null)
  .pop();

for (const d of DESIGNS) {
  const css = sheet(d.file);

  test(`${d.id}: on a phone the strip wraps instead of scrolling`, () => {
    assert.equal(phoneValue(css, d.strip, 'flex-wrap'), 'wrap', `${d.id}: the phone strip does not wrap`);
    assert.equal(phoneValue(css, d.strip, 'overflow-x'), 'visible', `${d.id}: the phone strip still scrolls sideways`);
    // A tab whose own label is wider than the phone must break inside itself
    // rather than push the page wider (Finnish „Saattaisit pitää myös näistä").
    assert.equal(phoneValue(css, d.item, 'white-space'), 'normal', `${d.id}: a phone tab cannot wrap its own label`);
    assert.equal(phoneValue(css, d.item, 'max-width'), '100%', `${d.id}: a phone tab may grow wider than the strip`);
  });

  test(`${d.id}: the current tab is marked by an underline, not only a fill`, () => {
    // The phone rule must restate the SAME selector that raises the current
    // tab at the top level — a less specific one (Forest's light gate adds an
    // attribute) loses the `background` to it however late it is declared.
    const raised = rulesOf(topLevel(css))
      .filter(([sel, body]) => /\.offshelf-seg__item\.is-on$/.test(sel) && declaredValue(body, 'background') != null)
      .map(([sel]) => sel);
    assert.ok(raised.length >= 1, `${d.id}: no top-level rule raises the current tab — check the fixture`);
    for (const sel of raised) {
      assert.equal(phoneValue(css, sel, 'background'), 'none', `${d.id}: the phone block does not undo ${sel}`);
    }
    const on = raised[0];
    const colour = phoneValue(css, on, 'border-bottom-color');
    assert.ok(colour && colour !== 'transparent', `${d.id}: the current phone tab carries no underline`);
  });

  test(`${d.id}: from 640px the tray is untouched — still one row that scrolls`, () => {
    // Anti-vacuous: the top-level rule must still exist and still scroll, so the
    // phone override is an override, not a rewrite of the desktop switcher.
    const base = rulesOf(topLevel(css)).find(([sel]) => sel === d.strip);
    assert.ok(base, `${d.id}: the top-level strip rule is gone`);
    assert.equal(declaredValue(base[1], 'overflow-x'), 'auto');
    assert.equal(declaredValue(base[1], 'flex-wrap'), null, `${d.id}: the desktop strip now wraps`);
  });
}
