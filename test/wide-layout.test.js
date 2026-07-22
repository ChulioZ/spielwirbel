'use strict';

/* Issue #332. The stylesheet had no "grow" direction at all: `.app` was a flat
   1000px at every viewport, so a 1920 screen spent 48% of itself on empty
   gutter and the Regal stayed at four columns — while the same 220px grid floor
   gave every PHONE a single column (a 22-game shelf measured 6332px of scroll).

   Both halves are invisible from Node and from every other test: the markup is
   identical, nothing throws, and a screenshot of one viewport looks fine. So
   the acceptance criteria are pinned here as ARITHMETIC over the declared
   numbers — how many columns the grid actually gets at 390 and at 1920 — rather
   than as "a rule containing the word grid exists". A floor nudged from 150px
   to 180px keeps every naive assertion green and silently returns the phone to
   one column; the column count is what notices. (Verified by making each of
   those edits and watching the matching assertion go red.)

   Parsing traps (stripped comments, whole-class matching) live in
   test/support/css.js — see `.claude/rules/css-text-assertions-strip-comments.md`. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RULES, rulesOf, bodyOf, mediaBlocks, whole, rootPx, gridSpec, columnsIn } =
  require('./support/css');

// The horizontal padding of a `padding: <v> <h> <v>` shorthand.
const sidePadding = (body) => {
  const m = body && body.match(/padding:\s*\d+px\s+(\d+)px/);
  return m ? Number(m[1]) : null;
};

/* Every rule under a query matching `re`, newest first. The stylesheet scopes
   each narrow-screen override next to the component it belongs to, so there are
   several `max-width: 520px` blocks and the two numbers this file needs (`.app`
   padding, the `.cards` floor) live in different ones. Reversed so a lookup
   returns the last-declared rule, i.e. the one the cascade actually applies. */
const rulesUnder = (re) => mediaBlocks()
  .filter(([query]) => re.test(query))
  .flatMap(([, css]) => rulesOf(css))
  .reverse();

const targetsFooter = (sel) => whole('.site-footer').test(sel);

test(':root declares both content widths, and the wide one is wider', () => {
  const content = rootPx('--w-content');
  const wide = rootPx('--w-wide');
  assert.ok(content, ':root does not declare --w-content');
  assert.ok(wide, ':root does not declare --w-wide');
  assert.ok(wide > content, `--w-wide (${wide}) must exceed --w-content (${content})`);
});

test('the page and its footer take the default width from the same variable', () => {
  // A hardcoded px in either drifts from the other the moment a width is
  // re-tuned, and the footer silently stops lining up with the column above it
  // — the same reasoning as the shared --dock-clearance (#324).
  for (const sel of ['.app', '.site-footer']) {
    const body = bodyOf(sel);
    assert.ok(body, `${sel} rule not found`);
    assert.match(body, /max-width:\s*var\(--w-content\)/,
      `${sel} does not take its default max-width from --w-content`);
  }
});

test('nothing widens the page unconditionally — text screens keep the measure', () => {
  /* The tempting "simplification" is to bump `.app` to the wide value outright
     and be done. That is the one outcome the issue explicitly rules out: a
     Chronik row already carries ~350px of content in a 1060px row, and prose
     stretched to 1440px is worse than the gutter it replaced. So every rule
     that hands out --w-wide must be conditioned on what the screen renders. */
  const unconditional = RULES.filter(([sel, body]) =>
    /max-width:\s*var\(--w-wide\)/.test(body)
    && !sel.includes(':has(')
    && (/(^|,)\s*\.app\s*$/.test(sel) || targetsFooter(sel)));
  assert.deepEqual(unconditional.map(([sel]) => sel), [],
    'these rules widen the page for every screen, including the text-only ones');
});

test('the footer widens with the page, from the identical condition', () => {
  /* Two rules, one trigger. If the footer's `:has()` list drifts from the
     page's — a grid class added to one and not the other — the footer keeps the
     narrow measure under a wide column and visibly stops lining up, on exactly
     the screens someone just extended. */
  const widened = RULES.filter(([sel, body]) =>
    /max-width:\s*var\(--w-wide\)/.test(body) && sel.includes(':has('));
  const forApp = widened.filter(([sel]) => !targetsFooter(sel));
  const forFooter = widened.filter(([sel]) => targetsFooter(sel));

  assert.equal(forApp.length, 1, 'expected exactly one rule widening .app');
  assert.equal(forFooter.length, 1, 'expected exactly one rule widening the site footer');

  const condition = (sel) => sel.slice(sel.indexOf(':has('), sel.lastIndexOf(')') + 1);
  assert.equal(condition(forFooter[0][0]), condition(forApp[0][0]),
    'the footer and the page widen on different conditions, so they can drift apart');
  assert.match(forFooter[0][0], /\+\s*\.site-footer/,
    'the footer rule must key off the page it follows, not stand alone');
});

test('a 1920 viewport gets meaningfully more than four Regal columns', () => {
  const wide = rootPx('--w-wide');
  const content = wide - 2 * sidePadding(bodyOf('.app'));
  const spec = gridSpec(bodyOf('.cards'));
  assert.ok(spec.floor && spec.gap, '.cards declares no minmax floor / gap');

  const columns = columnsIn(content, spec);
  assert.ok(columns > 4,
    `the Regal still gets ${columns} columns in a ${content}px column — the pre-#332 count was 4`);
  // And the gutter is no longer roughly half the screen.
  assert.ok((1920 - wide) / 1920 < 0.3,
    `${Math.round(((1920 - wide) / 1920) * 100)}% of a 1920 screen is still unused gutter`);
});

test('a 390 viewport gets two Regal columns, not one', () => {
  const narrow = rulesUnder(/max-width:\s*520px/);
  assert.ok(narrow.length, 'no max-width: 520px block found');

  // Both numbers come from the narrow blocks: they re-pad `.app` as well.
  const pad = sidePadding(bodyOf('.app', narrow));
  assert.ok(pad, '.app is not re-padded for narrow screens');
  const spec = gridSpec(bodyOf('.cards', narrow));
  assert.ok(spec && spec.floor && spec.gap,
    '.cards has no narrow-screen override, so the 220px floor still forces one column');

  const columns = columnsIn(390 - 2 * pad, spec);
  assert.equal(columns, 2,
    `a 390px phone gets ${columns} Regal column(s); the 22-game shelf needs two to halve its scroll`);
});

test('the home lobby tiles once there is room for a second round card', () => {
  /* The lobby is a stack of full-width rows on a phone and a grid above the
     strip breakpoint. A floor set too high leaves it a one-column grid — which
     looks like the change landed while changing nothing at all. */
  const hit = mediaBlocks()
    .map(([query, css]) => ({ query, body: bodyOf('.lobby-list', rulesOf(css)) }))
    .find((b) => b.body && /grid-template-columns/.test(b.body));
  assert.ok(hit, '.lobby-list never becomes a multi-column grid');

  const from = Number(hit.query.match(/min-width:\s*(\d+)px/)[1]);
  const spec = gridSpec(hit.body);
  const base = gridSpec(bodyOf('.lobby-list'));
  const columns = columnsIn(from - 2 * sidePadding(bodyOf('.app')), {
    floor: spec.floor,
    gap: spec.gap || base.gap,
  });
  assert.ok(columns >= 2,
    `at its own ${from}px breakpoint the lobby still shows ${columns} column(s)`);
});
