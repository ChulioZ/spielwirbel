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

  // #1817: the composition that is safe at ANY row width is the DEFAULT — no
  // count, „Für …" whole on a line of its own — so that a browser which ignores
  // `@container` (Safari before 16), or a roster the query does not answer,
  // falls back to it. The inline key used to be the default, and a two-up row
  // without the query starved its track to a few px.
  const defKey = css.bodyOf(sel.key, wide);
  assert.equal(css.declaredValue(defKey, 'grid-row'), '3',
    'the inline key is the default again — any row the container query misses starves it (#1817)');
  assert.equal(css.declaredValue(defKey, 'grid-column'), '2 / -1');
  assert.equal(css.declaredValue(defKey, 'white-space'), 'nowrap', 'the default key may break its label');
  assert.equal(tracks(css.bodyOf(sel.row, wide)), 4, 'the default row carries the count track');
  assert.equal(css.declaredValue(css.bodyOf(sel.progress, wide), 'display'), 'none');
  assert.equal(css.declaredValue(css.bodyOf(sel.name, wide), 'grid-column'), '2 / 4',
    'the name no longer spans both text tracks, so an inline key takes its width');

  // The rich composition only inside a container query bounded on BOTH sides:
  // below 930 (= two floors and the gap) the rows are still one-up, and from
  // the lower bound the key's track keeps room for „Für Maximilian".
  const cq = css.atBlocks(sheet, 'container').find(([p]) => p.startsWith(container));
  assert.ok(cq, 'no container block answers the roster');
  const lower = px(cq[0], /min-width:\s*(\d+)px/, 'the inline lower bound');
  const upper = px(cq[0], /max-width:\s*([\d.]+)px/, 'the inline upper bound');
  assert.ok(upper < 2 * floor + gap && upper > 2 * floor + gap - 1,
    'the inline composition reaches into two-up rows, or stops short of them');
  const inline = css.rulesOf(cq[1]);
  const inlineRow = css.bodyOf(sel.row, inline);
  assert.equal(tracks(inlineRow), 5, 'a single wide row lost its count track');
  const count = px(inlineRow, /(\d+)px\s*;?\s*$/m, 'the count track');
  const prog = css.bodyOf(sel.progress, inline);
  assert.equal(css.declaredValue(prog, 'display'), 'block');
  assert.equal(css.declaredValue(prog, 'grid-column'), '5');
  const key = css.bodyOf(sel.key, inline);
  assert.equal(css.declaredValue(key, 'grid-row'), '2', 'a wide row puts the key back on a line of its own');
  assert.equal(css.declaredValue(key, 'grid-column'), '3');

  // What a two-up row at its floor leaves the name, with the marks at their cap.
  const row = css.bodyOf(sel.rowBase, top);
  const pad = px(row, /padding:\s*\d+px\s+(\d+)px/, 'the row padding');
  const rowGap = px(row, /column-gap:\s*(\d+)px/, 'the row gap');
  const avatar = px(css.bodyOf(sel.avatar, top), /width:\s*(\d+)px/, 'the avatar');
  const marks = px(css.bodyOf(sel.dots, top), /max-width:\s*(\d+)px/, 'the marks cap');
  // At the inline lower bound, with the marks at their cap, the count, four
  // gaps and ~100px for the state line, the key's track still holds a whole
  // „Für Maximilian" (~160px). Lower the bound and this is the #1817 sliver.
  const keyTrack = lower - 2 * pad - avatar - marks - count - 4 * rowGap - 100;
  assert.ok(keyTrack >= 150, `at its ${lower}px lower bound the inline key gets ${keyTrack}px`);
  const name = floor - 2 * pad - avatar - marks - 2 * rowGap;
  assert.ok(name >= 140, `a two-up row leaves the name ${name}px — an 11-character name clips`);

  // The panel spans the actions' row too, so „Jetzt abstimmen" follows the roster.
  assert.equal(css.declaredValue(css.bodyOf(sel.panel, wide), 'grid-row'), '2 / span 2');
}

module.exports = { assertRosterReflow };
