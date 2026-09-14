'use strict';

/*
 * #1111 — the Spielwirbel-Score label vs. the Tafel row's narrow layout.
 *
 * The bug: below 720px `.tafel .trow` used to bind the `score` area to the 56px
 * COVER track. Measured in Chromium at 320px, every shipped locale but `ko`
 * overflowed that column by 15–21px, and `ko` instead split the brand name
 * („Spielwir / bel 점수") because the `:lang(ko)` `overflow-wrap: break-word`
 * escape hatch fires when a box genuinely is too narrow for its word.
 *
 * Neither failure is expressible as a DOM assertion — the label renders and the
 * node exists in both worlds — so this file guards the two halves that CAN be
 * checked without a browser:
 *
 *   1. the LAYOUT still gives the label more than the cover track, and
 *   2. no shipped `score.name` contains an unbreakable run longer than the one
 *      the measured floor has room for.
 *
 * The pixel half was measured by hand and is written into the CSS comment
 * beside the rule; see the PR for the full per-locale table.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { mediaBlocks, rulesOf, bodyOf } = require('./support/css');
const { SUPPORTED_LOCALES } = require('../public/js/locales');

/* The narrowest `score` box the layout can produce, measured in Chromium at a
   320px viewport with the widest action content (the „auf dem Tisch" chip):
   88px. The longest unbreakable run in any shipped label is the GERMAN one —
   „Spielwirbel-", 12 characters at ~77px, because a line broken after a hyphen
   keeps the hyphen. („Spielwirbel" alone is 11, and pinning that was this
   test's own first mistake.) A locale whose label holds a longer unbreakable
   word would overflow the column again, or be split by the `:lang(ko)` hatch,
   and nothing else in the suite would notice. */
const MAX_UNBREAKABLE_CHARS = 12;

function loadLocale(name) {
  const file = path.join(__dirname, '..', 'public', 'js', 'lang', `${name}.js`);
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.I18N[name];
}

/* Split on the opportunities a browser will actually take in this box: spaces
   and the hyphen (`Spielwirbel-Score` breaks after the hyphen, which is why the
   German chunk is „Spielwirbel-" rather than the whole string). Deliberately
   NOT counting a soft hyphen or a zero-width space — the labels use neither,
   and pretending they break would hide exactly the case this guards. */
const chunks = (s) => s.split(/\s+/).flatMap((w) => {
  const parts = w.split('-');
  return parts.map((p, i) => (i < parts.length - 1 ? `${p}-` : p)).filter(Boolean);
});

test('the narrow Tafel row gives the score label more than the 56px cover track', () => {
  const narrow = mediaBlocks().filter(([q]) => /max-width:\s*520px/.test(q));
  assert.ok(narrow.length, 'no max-width: 520px block found — has the breakpoint moved?');

  const body = narrow
    .map(([, css]) => bodyOf('.tafel .trow', rulesOf(css)))
    .find(Boolean);
  assert.ok(body, '.tafel .trow is not declared in the narrow block');

  const areas = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim().split(/\s+/));
  const scoreRow = areas.find((cells) => cells.includes('score'));
  assert.ok(scoreRow, 'no grid-template-areas row names `score`');

  const span = scoreRow.filter((c) => c === 'score').length;
  assert.ok(span > 1,
    `the score area still occupies one track (${scoreRow.join(' ')}) — at 56px the label `
    + 'overflows every shipped locale but ko, and splits the brand in ko (#1111)');

  // The action must not be what got squeezed instead: it needs its own track.
  assert.ok(scoreRow.includes('action'),
    'the action left the score row — that is a different layout than the one measured');
  const cols = (body.match(/grid-template-columns:\s*([^;]+);/) || [])[1];
  assert.ok(cols && cols.trim().split(/\s+(?![^(]*\))/).length === scoreRow.length,
    `grid-template-columns (${cols}) does not declare one track per area cell`);
});

test('no shipped score.name holds a word too long for the narrowest score box', () => {
  const offenders = [];
  for (const locale of SUPPORTED_LOCALES) {
    const label = loadLocale(locale)['score.name'];
    assert.ok(label, `${locale} has no score.name`);
    for (const chunk of chunks(label)) {
      if (chunk.length > MAX_UNBREAKABLE_CHARS) offenders.push(`${locale}: "${chunk}" (${chunk.length})`);
    }
  }
  assert.deepEqual(offenders, [],
    `score.name holds an unbreakable run over ${MAX_UNBREAKABLE_CHARS} characters, which cannot fit `
    + `the ~88px the Tafel row's score box narrows to at 320px:\n  ${offenders.join('\n  ')}`);
});
