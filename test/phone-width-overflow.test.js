'use strict';

/* Horizontal overflow at phone widths (#621).

   The Regal's header tools ran ~540px of controls through a 280px content
   column at 320px, so the whole page gained a horizontal scrollbar and the sort
   dropdown sat entirely off-screen (measured at 390px: 231px of page overflow,
   `.sort-select` starting at x=504 in a 390px viewport). The cause was one
   self-cancelling pair of declarations — `flex: none` (i.e. `0 0 auto`, sized at
   max-content and unable to shrink) next to `flex-wrap: wrap`, which therefore
   could never engage.

   There is no headless layout here: jsdom applies no external stylesheet and has
   no layout engine (`.claude/rules/testing-views-under-jsdom.md`), so a genuine
   `scrollWidth` assertion would need a browser dependency and a CI job. These are
   CSS-TEXT assertions over the declarations that make the rows fit, plus real
   arithmetic where numbers are available; the browser pass is the proof, and it
   is recorded in the PR.

   Two of the four checks below are SPECIFICITY comparisons rather than "the rule
   exists", because both overrides live in a `max-width: 520px` block declared
   EARLIER in the stylesheet than the base rule they have to beat. At equal
   specificity source order decides and the base wins — silently. That is not
   hypothetical: it happened twice while building #621, once leaving the BGG
   import control as a bare icon with no accessible name at all.

   Parsing traps (stripped comments, whole-class matching) live in
   test/support/css.js — see `.claude/rules/css-text-assertions-strip-comments.md`. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, RULES, rulesOf, bodyOf, mediaBlocks } = require('./support/css');

// The phone block this issue's overrides live in. Reversed so a lookup returns
// the LAST declaration, i.e. the one the cascade actually applies.
const PHONE = mediaBlocks()
  .filter(([query]) => /max-width:\s*520px/.test(query))
  .flatMap(([, css]) => rulesOf(css))
  .reverse();

/* Specificity of the simple selectors involved here, as [ids, classes,
   elements]. Enough for `.a`, `.a .b` and `.a.b`; it does not model :is()/:has()
   and does not need to — every selector this file compares is a plain class
   sequence, and a future one that isn't should be compared deliberately rather
   than by a silently-wrong number. */
function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classes = (sel.match(/[.:[][\w-]+/g) || []).length;
  const els = (sel.replace(/[.#:[][\w-]+/g, '').match(/[a-z]+/g) || []).length;
  return [ids, classes, els];
}
const outranks = (a, b) => {
  const [x, y] = [specificity(a), specificity(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false; // a tie loses to source order, which is the bug being guarded
};

// `flex: <grow> <shrink> <basis>` (or the `none` keyword) out of a rule body.
function flexOf(body) {
  const m = body && body.match(/flex:\s*([^;]+);/);
  if (!m) return null;
  const v = m[1].trim();
  if (v === 'none') return { grow: 0, shrink: 0, basis: 'auto' };
  const parts = v.split(/\s+/);
  return { grow: Number(parts[0]), shrink: Number(parts[1]), basis: parts[2] };
}

test('.section-tools can shrink, so its own flex-wrap engages', () => {
  const flex = flexOf(bodyOf('.section-tools'));
  assert.ok(flex, '.section-tools declares no flex');
  // The whole bug: shrink 0 pins the row at max-content and the wrap is dead.
  assert.notEqual(flex.shrink, 0,
    '.section-tools cannot shrink, so its flex-wrap can never engage (#621)');
  // ...and it must NOT grow, or on desktop it fills the space `.section-head`'s
  // `space-between` uses to push it to the right edge.
  assert.equal(flex.grow, 0, '.section-tools grows, which moves the desktop toolbar');
  assert.match(bodyOf('.section-tools'), /flex-wrap:\s*wrap/,
    '.section-tools no longer wraps, so shrinking alone cannot make it fit');
  assert.match(bodyOf('.section-tools'), /min-width:\s*0/,
    ".section-tools keeps min-width:auto, so it cannot shrink past its content");
});

test('the search pill and its input can both shrink below their content', () => {
  // A flex item's automatic minimum size is its min-content width, so BOTH the
  // pill and the input need min-width:0 — with either missing the 150px input
  // pins the pill at ~205px and it overflows a narrow column instead of
  // shrinking. The input's size must be a flex BASIS, not a `width`, and must
  // carry no grow factor (a grow factor makes it take its ~178px max-content
  // wherever the pill has slack, widening the whole desktop row).
  for (const sel of ['.search-pill', '.search-pill input']) {
    assert.match(bodyOf(sel), /min-width:\s*0/, `${sel} cannot shrink (#621)`);
  }
  const input = bodyOf('.search-pill input');
  assert.doesNotMatch(input, /(^|;)\s*width:\s*\d/,
    '.search-pill input is back on a fixed width, which is a shrink floor (#621)');
  const flex = flexOf(input);
  assert.ok(flex && /^\d+px$/.test(flex.basis), '.search-pill input declares no px flex-basis');
  assert.equal(flex.grow, 0, '.search-pill input grows, which widens the desktop toolbar');
  assert.notEqual(flex.shrink, 0, '.search-pill input cannot shrink');
});

test('the short tools label OUTRANKS the base hide, so one spelling is always shown', () => {
  // Both spellings are rendered and CSS picks. The base hides the short one; the
  // phone block reveals it. The base rule is declared ~40 lines BELOW the phone
  // block, so at equal specificity it wins on source order and BOTH stay hidden
  // — which renders the BGG import control as a bare icon with no accessible
  // name. Measured, and nothing reports it: no error, no failing view test.
  const hide = RULES.find(([sel]) => sel === '.tools-label--short');
  assert.ok(hide, 'no base rule hides .tools-label--short');
  assert.match(hide[1], /display:\s*none/);

  const reveal = PHONE.find(([sel]) => /\.tools-label--short(?![\w-])/.test(sel));
  assert.ok(reveal, 'the <=520px block no longer reveals .tools-label--short');
  assert.match(reveal[1], /display:\s*inline/);
  assert.ok(outranks(reveal[0], '.tools-label--short'),
    `"${reveal[0]}" does not outrank the base ".tools-label--short" hide, so both spellings hide (#621)`);

  // The long spelling has no competing base rule, so a bare class is fine there.
  assert.ok(PHONE.some(([sel, body]) =>
    /\.tools-label--long(?![\w-])/.test(sel) && /display:\s*none/.test(body)),
  'the <=520px block no longer hides .tools-label--long, so both spellings show');
});

test('the results row drops to two columns on a phone, and its score follows', () => {
  const row = PHONE.find(([sel]) => sel === '.result-row');
  assert.ok(row, 'the <=520px block no longer re-tracks .result-row');
  const tracks = row[1].match(/grid-template-columns:\s*([^;]+);/);
  assert.ok(tracks, '.result-row declares no grid-template-columns in the phone block');
  assert.equal(tracks[1].trim().split(/\s+(?![^(]*\))/).length, 2,
    '.result-row is back to three tracks at phone widths, which cannot fit (#621)');

  // Same source-order trap as the label: `.result-row__score { text-align: right }`
  // is declared ~1600 lines below the phone block.
  const score = PHONE.find(([sel]) => /\.result-row__score(?![\w-])/.test(sel));
  assert.ok(score, 'the <=520px block no longer re-places .result-row__score');
  assert.ok(outranks(score[0], '.result-row__score'),
    `"${score[0]}" ties the base ".result-row__score" rule and loses on source order (#621)`);
});

test('two tracks are ARITHMETICALLY enough for the results row at 320px', () => {
  /* The selector assertions above all stay green if someone widens the cover or
     the rating bars, which is what actually consumes the row. So do the sum, out
     of the declared numbers: at 320px the row's content box must hold the fixed
     cover plus the bar strip, which is the widest thing in the flexible track and
     cannot shrink at all (fixed-width bars in a nowrap flex line).

     One bar per rating value, so the count comes from MOODS in the view rather
     than from a literal here — a six-point scale would silently blow the budget
     that this test claims to guard. */
  const VIEWPORT = 320;
  const px = (body, prop) => {
    const m = body && body.match(new RegExp(`${prop}:\\s*(\\d+)px`));
    return m ? Number(m[1]) : null;
  };
  /* The FIRST rule with this selector that actually declares `prop`. bodyOf()
     alone is wrong here: `.result-row` is declared twice — the phone block's
     re-tracking comes first in the file, and it carries no padding or gap, so a
     plain lookup silently reads the override instead of the geometry. */
  const declaring = (sel, prop) => {
    const hit = RULES.find(([s, body]) => s === sel && new RegExp(`${prop}:`).test(body));
    return hit ? hit[1] : null;
  };
  // `.app`'s side padding at <=520px, from the last block that re-declares it.
  const appPad = PHONE.filter(([sel]) => sel === '.app')
    .map(([, body]) => body.match(/padding:\s*\d+px\s+(\d+)px/))
    .find(Boolean);
  const appSide = appPad ? Number(appPad[1])
    : Number(declaring('.app', 'padding').match(/padding:\s*\d+px\s+(\d+)px/)[1]);

  const rowBody = declaring('.result-row', 'padding');
  assert.ok(rowBody, '.result-row declares no padding');
  const rowSide = Number(rowBody.match(/padding:\s*\d+px\s+(\d+)px/)[1]);
  const rowGap = px(declaring('.result-row', 'gap'), 'gap');
  const cover = px(bodyOf('.result-row__img'), 'width');

  const barsBody = bodyOf('.result-row__bars');
  const barGap = px(barsBody, 'gap');
  const barW = px(bodyOf('.result-row__bars .bar'), 'width');
  const view = fs.readFileSync(path.join(ROOT, 'public/js/views-session.js'), 'utf8');
  // The UNIQUE declaration, not the first one — a commented-out copy above the
  // live line would otherwise decide the bar count
  // (`.claude/rules/css-text-assertions-strip-comments.md`, in JS).
  const moods = [...view.matchAll(/const MOODS = \[([^\]]+)\]/g)];
  assert.equal(moods.length, 1,
    `views-session.js declares MOODS ${moods.length} times, expected exactly 1 — the rating scale drives the bar count`);
  const bars = moods[0][1].split(',').length;

  for (const [name, v] of Object.entries({ appSide, rowSide, rowGap, cover, barGap, barW })) {
    assert.ok(Number.isFinite(v) && v > 0, `could not read ${name} out of styles.css`);
  }

  const content = VIEWPORT - 2 * appSide - 2 * rowSide;
  const needed = cover + rowGap + (bars * barW + (bars - 1) * barGap);
  assert.ok(needed <= content,
    `the results row needs ${needed}px of a ${content}px content box at ${VIEWPORT}px ` +
    `(cover ${cover} + gap ${rowGap} + ${bars} bars) — it will overflow (#621)`);
});
