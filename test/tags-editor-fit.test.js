'use strict';

/* The game-detail tags editor has to stay usable in a round with MANY tags (#722).
 *
 * Reported from production: in a round with ~34 tags, „Ich kann … keine Tags mehr
 * erstellen, außer bei Spielen, die noch keine Tags haben." `openTagsPopover`
 * appends the round's chips first and the create row — input, „Hinzufügen", OK —
 * last, and `.popover--tags` had no height cap at all, so the card grew past the
 * bottom of the viewport. That is not merely off-screen: a page scroll CLOSES a
 * popover (`onScroll` in `openPopover`), so the create row was unreachable.
 *
 * The asymmetry in the report is the tell, and it is about the ANCHOR: a game
 * with tags is edited from a chip in its <h1>, high on the page, where `place()`
 * has no room above and must go below; a sparse game's trigger sits far down in
 * the onboarding panel, so the card flipped above and fitted.
 *
 * The CSS half is a text assertion because jsdom applies no external stylesheet
 * and the Browser pane's viewport height is degenerate — `45vh` resolves to 0
 * there, which is precisely the collapse the `max()` floor exists to prevent, so
 * neither instrument can measure the real behaviour
 * (`.claude/rules/testing-views-under-jsdom.md`). The JS half runs the real view.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { bodyOf } = require('./support/css');
const { loadApp } = require('./support/dom');

/* ------------------------------------------------------------------ CSS half */

const CHIPS = '.popover--tags .filter-chips';
const GRID = '.popover--tags .icon-picker';

test('the anchored tags editor is capped, WITH a floor', () => {
  const card = bodyOf('.popover--tags');
  assert.ok(card, 'the rule exists');
  assert.match(card, /max-height:\s*max\(/,
    'a bare min(…vh, …) computes to 0 on a degenerate viewport and collapses the card '
    + 'to nothing, leaving its own children rendering outside it (measured on #653)');
  assert.match(card, /vh/, 'and it must track the viewport, not just a constant');
});

test('the cap fits the room place() can actually count on — half the viewport', () => {
  /* `openPopover`'s place() puts the card wholly above or wholly below its
     anchor and falls back to BELOW when neither side fits, so the room it can
     rely on is the larger of the two — worst case, an anchor in the vertical
     middle, half the viewport. A vh term above 50 leaves a band of anchor
     positions where the card runs past the fold again, and the tag chip in the
     game's <h1> sits inside that band. */
  const vh = Number((bodyOf('.popover--tags').match(/min\(\s*(\d+)vh/) || [])[1]);
  assert.ok(vh > 0, 'the cap has no vh term to check');
  assert.ok(vh <= 50, `the card may claim at most half the viewport, not ${vh}vh`);
});

test('the chip list is the part that gives way, so the create row stays visible', () => {
  const chips = bodyOf(CHIPS);
  assert.ok(chips, `${CHIPS} not found — the cap has nothing to absorb it`);
  // Without a shrink factor the chips keep their natural height and the card's
  // cap pushes the create row out of the card instead of shortening the list.
  assert.match(chips, /flex:\s*1\s+\d+\s+auto/);
  assert.match(chips, /overflow-y:\s*auto/);
  // A flex item's default `min-height: auto` is its CONTENT size, so the cap is
  // silently inert without an explicit one — which doubles as the floor.
  assert.match(chips, /min-height:\s*\d+px/, 'no explicit min-height: the cap cannot shrink this box at all');
});

test('the icon-picker grid gives way too, so opening it cannot push the card open', () => {
  /* The grid is appended AFTER the create row and expands in place, so with the
     card capped it is the second thing that has to shrink — otherwise its rows
     render outside the card's bottom edge. */
  const grid = bodyOf(GRID);
  assert.ok(grid, `${GRID} not found — an open icon grid overflows the capped card`);
  assert.match(grid, /min-height:\s*\d+px/);
  assert.match(grid, /overflow-y:\s*auto/);
});

test('an empty chip row takes no space at all', () => {
  /* `.filter-chips { display: flex }` is an AUTHOR rule, and author styles beat
     the UA sheet's `[hidden] { display: none }` at any specificity — so a chip
     row hidden because the round has no tags kept its box and its margins. Once
     the row above carries a min-height that box is an empty 40px scroll well in
     the editor of every untagged round. Same trap `.icon-picker[hidden]`
     records one component over. */
  assert.match(bodyOf('.filter-chips[hidden]') || '', /display:\s*none/,
    'a hidden .filter-chips still renders as a flex box');
});

/* ------------------------------------------------------------------- JS half */

const ROUND = {
  id: 1,
  name: 'Donnerstagsrunde',
  shared: false,
  games: [{
    id: 7, title: 'Catan', tagIds: [3], minPlayers: 2, maxPlayers: 4,
    image: '/uploads/catan.jpg', retired: false, completed: false,
  }],
  members: [],
  sessions: [],
  activity: [],
  tags: [{ id: 3, name: 'Strategie', icon: 'chess' }],
  providers: [],
};

/** The game-detail screen at desktop width, with the tags editor already open. */
async function tagsPopover(t) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => ROUND);
  // jsdom has no layout, so matchMedia never matches on its own; the stub is
  // what stands in for a viewport above the 860px sheet breakpoint.
  dom.run('window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });');
  await dom.call('showGameDetail', ROUND.id, 7);
  // The editors are nested inside showGameDetail and not callable from a spec,
  // so the only way in is the one a user takes.
  dom.document.querySelector('#app h1 .tag--custom').click();
  const popover = dom.document.querySelector('.popover--tags');
  assert.ok(popover, 'the tags editor did not open as a popover');
  return { dom, popover };
}

test('toggling the icon picker re-places the popover', async (t) => {
  /* A popover's `top` is decided ONCE from its height at build time, and content
     that grows afterwards hangs off a fold it cannot be scrolled back from
     (#519). The grid is `hidden` when the editor opens, so every toggle changes
     the card's height. */
  const { dom, popover } = await tagsPopover(t);
  const calls = [];
  dom.set('repositionPopover', () => calls.push(1));

  const trigger = popover.querySelector('.icon-picker__trigger');
  assert.ok(trigger, 'the tags editor has no icon-picker trigger');
  assert.equal(popover.querySelector('.icon-picker').hidden, true, 'the grid should start collapsed');

  trigger.click();
  assert.equal(popover.querySelector('.icon-picker').hidden, false, 'the trigger did not expand the grid');
  assert.equal(calls.length, 1, 'expanding the grid grew the card without re-placing it');

  trigger.click();
  assert.equal(calls.length, 2, 'collapsing the grid shrank the card without re-placing it');
});

test('picking an icon collapses the grid and re-places the popover', async (t) => {
  // The collapse branch inside the button handler is a second, separate height
  // change — `.claude/rules/anchored-popover-is-placed-once.md` records exactly
  // this one being missed for the cover picker's own toggle.
  const { dom, popover } = await tagsPopover(t);
  popover.querySelector('.icon-picker__trigger').click();
  const calls = [];
  dom.set('repositionPopover', () => calls.push(1));

  popover.querySelector('.icon-picker__btn[data-icon="rocket"]').click();
  assert.equal(popover.querySelector('.icon-picker').hidden, true, 'picking an icon should collapse the grid');
  assert.equal(calls.length, 1, 'the collapse after a pick left the card mis-placed');
});
