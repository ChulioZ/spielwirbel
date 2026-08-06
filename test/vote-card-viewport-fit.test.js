'use strict';

/* The vote card fits the phone viewport (#666).

   Below 860px the card is one column, and it added up to ~720px at 390px wide
   against a ~558px budget — so „Weiter", the app's central action, sat below
   the fold on EVERY game and the voter scrolled once per rating for a whole
   session. The fix makes the cover the elastic part: it is sized from the
   viewport HEIGHT, with a floor, and everything else contributes a fixed trim.

   There is no headless layout here — jsdom applies no external stylesheet and
   has no layout engine (`.claude/rules/testing-views-under-jsdom.md`) — so these
   are CSS-TEXT assertions over the declarations that make the card fit, plus
   real arithmetic over the declared numbers where they are available. The
   browser pass is the proof and is recorded in the PR.

   The arithmetic ones matter more than usual here, because every selector
   assertion below stays green against a budget constant that pins the cover at
   its floor (or at its cap) forever — i.e. against a version where the whole
   elastic mechanism is dead. See `the cover actually TRACKS the viewport`.

   Parsing traps (stripped comments, whole-class matching) live in
   test/support/css.js — `.claude/rules/css-text-assertions-strip-comments.md`. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RULES, rulesOf, bodyOf, mediaBlocks, outranks } = require('./support/css');

// The phone block the card's height fix lives in, and the wide-layout block it
// hands over to. Both are found by CONTENT, never by position in the file.
const blocks = mediaBlocks();

const phoneBlock = blocks.find(([, css]) =>
  rulesOf(css).some(([sel]) => /^\.vote\s+\.vote__img$/.test(sel.trim())));
const splitBlock = blocks.find(([, css]) =>
  rulesOf(css).some(([sel]) => /^\.vote--split$/.test(sel.trim())));

const PHONE = phoneBlock ? rulesOf(phoneBlock[1]) : [];
const phoneBody = (sel) => bodyOf(sel, PHONE);

/* `max(<floor>px, min(<cap>px, calc(100svh - <budget>px)))` — the shape the
   cover's height is required to have, as numbers. Parsed rather than matched so
   the assertions below can do arithmetic with it. */
function coverHeightSpec() {
  const body = phoneBody('.vote .vote__img');
  if (!body) return null;
  const m = body.match(
    /height:\s*max\(\s*(\d+)px\s*,\s*min\(\s*(\d+)px\s*,\s*calc\(\s*100(svh|dvh|vh)\s*-\s*(\d+)px\s*\)\s*\)\s*\)/);
  if (!m) return null;
  return { floor: Number(m[1]), cap: Number(m[2]), unit: m[3], budget: Number(m[4]) };
}

// What the declared expression computes to at a given viewport height.
const coverAt = ({ floor, cap, budget }, svh) => Math.max(floor, Math.min(cap, svh - budget));

/* The three viewports the issue requires the card to fit in. Firefox for
   Android with its toolbar shown is the reported case, which is why the budget
   is spent against `svh` rather than `dvh`. */
const VIEWPORTS = [[390, 640], [360, 600], [414, 700]];

test('the card has a phone block, adjacent to the wide split layout', () => {
  assert.ok(phoneBlock, 'no media block sizes .vote .vote__img — the card no longer fits a phone (#666)');
  assert.ok(splitBlock, 'no media block builds the .vote--split wide layout');

  const below = phoneBlock[0].match(/max-width:\s*(\d+)px/);
  const above = splitBlock[0].match(/min-width:\s*(\d+)px/);
  assert.ok(below, `expected the vote phone block to be a max-width query, got "${phoneBlock[0]}"`);
  assert.ok(above, `expected the split block to be a min-width query, got "${splitBlock[0]}"`);

  /* They must tile the axis exactly. An OVERLAP is the damaging direction and
     the reason this is asserted at all: the phone block sets
     `aspect-ratio: auto` on the cover, and in an overlapping band that would
     apply to the split grid, whose cover is a fixed-ratio column. A GAP leaves
     a band with neither presentation's height handling. */
  assert.equal(Number(above[1]), Number(below[1]) + 1,
    `the vote card's phone rules apply up to ${below[1]}px but the split layout only from ${above[1]}px`);
});

test('the cover is sized from the viewport height, with a floor that cannot collapse', () => {
  const spec = coverHeightSpec();
  assert.ok(spec,
    '.vote .vote__img no longer declares `height: max(<floor>, min(<cap>, calc(100svh - <budget>)))` (#666)');

  /* `svh`, not `dvh`/`vh`. Firefox for Android hides its toolbar as you scroll:
     `dvh` would reflow the card mid-session, and the case that has to fit is
     the toolbar-SHOWN one, which is exactly what `svh` is. */
  assert.equal(spec.unit, 'svh',
    `the cover budget is spent against ${spec.unit}, which changes as a mobile toolbar hides (#666)`);

  /* The max() wrapper is not style, and the regex above is what requires it: a
     bare `min(<cap>, calc(100svh - N))` computes to a negative — so, clamped,
     zero — height wherever the viewport height is degenerate, collapsing the
     cover with no error to explain it. Same trap as `.cover-picker__grid`
     (`.claude/rules/anchored-popover-is-placed-once.md`).

     Asserting `coverAt(spec, 0) === spec.floor` here would be VACUOUS — it is
     true for a floor of 0, which is the collapse itself. The floor has to be
     positive, and how far positive is the glyph test's job. */
  assert.ok(spec.floor > 0,
    'the cover floor is 0, so a degenerate viewport still collapses it to nothing');
});

test('the aspect ratio is released, or the cap shrinks the cover WIDTH instead', () => {
  /* The trap that cost the first implementation: with `aspect-ratio: 4 / 3`
     still in force, a definite height is transferred BACK through the ratio and
     the box shrinks its WIDTH to match — measured 147px wide in a 320px slot,
     i.e. a thumbnail adrift in the card, with the height perfectly correct. */
  const body = phoneBody('.vote .vote__img');
  assert.ok(body, '.vote .vote__img has no rule in the phone block');
  assert.match(body, /aspect-ratio:\s*auto/,
    '.vote .vote__img keeps its 4/3 aspect-ratio while being height-capped, which shrinks its WIDTH (#666)');
});

test('the cover floor still holds the placeholder glyph', () => {
  /* A game with no cover renders a centred glyph, and `.vote__img` sizes it with
     its own `font-size`. Take the floor below that glyph's line box and the
     empty state clips — which is the state the floor exists for, so it must be
     derived from it rather than picked. */
  const spec = coverHeightSpec();
  assert.ok(spec, 'the cover height spec is unreadable');

  const imgFont = bodyOf('.vote__img').match(/font-size:\s*(\d+)px/);
  assert.ok(imgFont, '.vote__img no longer declares the placeholder glyph size');
  const lineHeight = bodyOf('body').match(/line-height:\s*([\d.]+)/);
  assert.ok(lineHeight, 'body no longer declares a unitless line-height');

  const glyphBox = Number(imgFont[1]) * Number(lineHeight[1]);
  assert.ok(spec.floor >= glyphBox,
    `the cover floor is ${spec.floor}px but the placeholder glyph needs ${glyphBox}px — it will clip (#666)`);
});

test('the cover actually TRACKS the viewport at the sizes it has to fit', () => {
  /* The anti-vacuous assertion. Every selector check above stays green with a
     budget of 1000px (cover pinned at its floor on every phone, so the card is
     as tall as it can be) or of 200px (pinned at its cap, so it never gives way
     at all and „Weiter" goes back below the fold). Neither is a layout error
     anything else here can see — the declarations are all present and correct.

     So: across the three viewports the issue names, the cover must come out
     STRICTLY between its floor and its cap, i.e. the mechanism is live. */
  const spec = coverHeightSpec();
  assert.ok(spec, 'the cover height spec is unreadable');

  for (const [w, h] of VIEWPORTS) {
    const cover = coverAt(spec, h);
    assert.ok(cover > spec.floor,
      `at ${w}x${h} the cover is pinned at its ${spec.floor}px floor — the budget (${spec.budget}px) leaves it no room (#666)`);
    assert.ok(cover < spec.cap,
      `at ${w}x${h} the cover is pinned at its ${spec.cap}px cap — it never gives way, so „Weiter" stays below the fold (#666)`);
  }

  /* And the cap must bind on a tall phone, or a 915px-tall device stretches the
     cover to 435px — well past the 4/3 it has everywhere else. */
  assert.equal(coverAt(spec, 915), spec.cap,
    `the cover is not capped on a tall phone: ${coverAt(spec, 915)}px at 915svh`);
});

test('every phone override OUTRANKS the base rule it has to beat', () => {
  /* The card's base rules are plain single classes, and several of the blocks
     involved are declared above what they override, so an equal-specificity
     override loses on source order — silently, which is how the `.mood` rule
     below spent its whole life doing nothing. Compounding is what makes these
     survive someone moving a block. */
  assert.ok(PHONE.length, 'the vote phone block is empty');

  for (const [sel] of PHONE) {
    const base = sel.trim().split(/\s+/).pop(); // `.vote .vote__img` -> `.vote__img`
    if (!RULES.some(([s]) => s === base)) continue; // nothing to compete with
    assert.ok(outranks(sel.trim(), base),
      `"${sel.trim()}" ties the base "${base}" rule and is decided by source order (#666)`);
  }
});

test('the rating faces get their phone size, which they never used to', () => {
  /* Pre-existing and invisible: `@media (max-width: 520px) { .mood { … } }` is
     declared ~770 lines ABOVE `.mood`'s own rule and ties it at (0,1,0), so the
     browser rendered every phone face at the desktop 64x68 while the stylesheet
     said 56x60. Measured before the fix; nothing anywhere was red. */
  const small = mediaBlocks()
    .filter(([query]) => /max-width:\s*520px/.test(query))
    .flatMap(([, css]) => rulesOf(css))
    .find(([sel]) => /\.mood(?![\w-])/.test(sel));

  assert.ok(small, 'the <=520px block no longer sizes the rating faces');
  assert.ok(outranks(small[0].trim(), '.mood'),
    `"${small[0].trim()}" ties the base ".mood" rule and loses on source order, so the phone size never applies (#666)`);

  /* A target-size floor, not a look: WCAG 2.2 SC 2.5.8 requires 24px and 2.5.5
     44px, and the cover is supposed to give way before the faces do. */
  const size = small[1].match(/width:\s*(\d+)px[^;]*;\s*height:\s*(\d+)px/);
  assert.ok(size, 'the phone .mood rule no longer declares a width and height');
  for (const n of [Number(size[1]), Number(size[2])]) {
    assert.ok(n >= 44, `a rating face is ${n}px on a phone, below the 44px target-size floor (#666)`);
  }
});
