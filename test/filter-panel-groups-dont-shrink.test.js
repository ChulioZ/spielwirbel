'use strict';

/* The filter popover's body is a capped flex column that scrolls
   (`.popover--filter .fpanel__body` in styles.css: `min-height: 0` +
   `overflow-y: auto`). Its groups are flex items, and a flex item's default
   `min-height: auto` is what keeps it at its content height while the BODY
   scrolls. A design that seats the groups on slips with an explicit
   `min-height` replaces that automatic minimum — so once the panel outgrows its
   cap the groups SHRINK to the explicit floor instead, and their content spills
   over the groups below. Live on Der Tisch with a round's tags: the Tags slip
   collapsed to its header and its chip cloud painted across Spieldauer,
   Komplexität and the rest.

   So in every design stylesheet: a rule that gives a filter group a min-height
   must also take it out of shrinking (`flex-shrink: 0`, or a `flex` shorthand
   whose shrink factor is 0). Swept across every file in css/designs/, so the
   next design that draws the same slips is covered without a new test. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rulesOf } = require('./support/css');

const DIR = path.join(__dirname, '..', 'public', 'css', 'designs');
const GROUP = /\.(fpanel__group|mfilter__row|mfilter__group)\b/;

const noShrink = (body) => /(^|[;\s{])flex-shrink\s*:\s*0\b/.test(body)
  || /(^|[;\s{])flex\s*:\s*(none|\S+\s+0\b)/.test(body);

const sheets = () => fs.readdirSync(DIR).filter((f) => f.endsWith('.css'))
  .map((f) => [f, fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]);

test('a design that floors a filter group\'s height also stops it shrinking', () => {
  const offenders = [];
  let checked = 0;
  for (const [file, css] of sheets()) {
    for (const [sel, body] of rulesOf(css)) {
      if (!GROUP.test(sel) || !/(^|[;\s{])min-height\s*:/.test(body)) continue;
      checked += 1;
      if (!noShrink(body)) offenders.push(`${file}: ${sel.trim()}`);
    }
  }
  // Der Tisch's slip rule is the known instance; a sweep that matched nothing
  // would be green by construction.
  assert.ok(checked >= 1, 'no design rule floors a filter group — did the selector pattern break?');
  assert.deepEqual(offenders, []);
});

test('the no-shrink predicate reads both spellings, and only a zero shrink', () => {
  assert.equal(noShrink('min-height: 44px; flex-shrink: 0;'), true);
  assert.equal(noShrink('min-height: 44px; flex: none;'), true);
  assert.equal(noShrink('min-height: 44px; flex: 0 0 auto;'), true);
  assert.equal(noShrink('min-height: 44px; flex: 1 1 auto;'), false);
  assert.equal(noShrink('min-height: 44px; flex-shrink: 1;'), false);
  assert.equal(noShrink('min-height: 44px;'), false);
});
