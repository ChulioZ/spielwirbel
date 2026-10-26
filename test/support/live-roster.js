'use strict';

/* The lobby roster's reflow at the detail width (#1719), asserted the same way
   for every design that composes its roster as rows (Der Tisch, Ocean). Each
   claim is derived from the design sheet's own numbers, so retuning one of
   them without the others goes red. `sel` names the design's selectors, which
   differ in where the design scopes them. */

const assert = require('node:assert/strict');
const css = require('./css');

const px = (body, re, what) => {
  const m = body && body.match(re);
  assert.ok(m, `could not read ${what}`);
  return Number(m[1]);
};
const tracks = (body) => css.declaredValue(body, 'grid-template-columns').split(/\s+(?![^(]*\))/).length;

function assertRosterReflow(sheet, { container, sel }) {
  const wide = css.rulesOf(css.mediaBlocks(sheet).filter(([q]) => /min-width:\s*1280px/.test(q)).map(([, b]) => b).join('\n'));
  const all = css.rulesOf(sheet);
  const top = css.rulesOf(css.topLevel(sheet));

  const roster = css.bodyOf(sel.roster, wide);
  assert.ok(roster, 'the roster stays one column at the detail width');
  assert.match(roster, new RegExp(`container:\\s*${container}\\s*/\\s*inline-size`));
  const { floor } = css.gridSpec(roster);
  const { gap } = css.gridSpec(css.bodyOf(sel.people, top));

  // Two columns at 1440: the lobby at --w-detail minus the panel track and gap.
  const split = css.bodyOf(sel.split, all);
  const panel = px(split, /minmax\(0,\s*1fr\)\s+(\d+)px/, 'the panel track');
  const colGap = px(split, /gap:\s*(?:\d+px\s+)?(\d+)px/, 'the split\'s column gap');
  assert.ok(css.columnsIn(css.rootPx('--w-detail') - panel - colGap, { floor, gap }) >= 2,
    'the roster holds one column at 1440');

  // The count goes exactly where two columns start: a wide single row has the
  // room for it, a two-up row does not.
  const cq = css.atBlocks(sheet, 'container').find(([p]) => p.startsWith(container));
  assert.ok(cq, 'no container block answers the roster');
  assert.equal(px(cq[0], /min-width:\s*(\d+)px/, 'the container threshold'), 2 * floor + gap,
    'the threshold that drops the count is not where the roster turns two-up');
  const narrow = css.rulesOf(cq[1]);
  assert.equal(css.declaredValue(css.bodyOf(sel.progress, narrow), 'display'), 'none');
  assert.equal(tracks(css.bodyOf(sel.row, wide)), 5, 'a single wide row lost its count track');
  assert.equal(tracks(css.bodyOf(sel.row, narrow)), 4);

  // „Für …" on the state line, the name spanning both text tracks above it.
  const key = css.bodyOf(sel.key, wide);
  assert.equal(css.declaredValue(key, 'grid-row'), '2', 'the key is back on a line of its own');
  assert.equal(css.declaredValue(key, 'grid-column'), '3');
  assert.equal(css.declaredValue(css.bodyOf(sel.name, wide), 'grid-column'), '2 / 4',
    'the name no longer spans the key\'s track, so a key takes its width');

  // What a two-up row at its floor leaves the name, with the marks at their cap.
  const row = css.bodyOf(sel.rowBase, top);
  const pad = px(row, /padding:\s*\d+px\s+(\d+)px/, 'the row padding');
  const rowGap = px(row, /column-gap:\s*(\d+)px/, 'the row gap');
  const avatar = px(css.bodyOf(sel.avatar, top), /width:\s*(\d+)px/, 'the avatar');
  const marks = px(css.bodyOf(sel.dots, top), /max-width:\s*(\d+)px/, 'the marks cap');
  const name = floor - 2 * pad - avatar - marks - 2 * rowGap;
  assert.ok(name >= 140, `a two-up row leaves the name ${name}px — an 11-character name clips`);

  // The panel spans the actions' row too, so „Jetzt abstimmen" follows the roster.
  assert.equal(css.declaredValue(css.bodyOf(sel.panel, wide), 'grid-row'), '2 / span 2');
}

module.exports = { assertRosterReflow };
