'use strict';

/* The hub tabs float over the page bottom on a phone (`position: fixed`), and
   the site footer is a SIBLING of `.app` rather than a child — so `.app`'s
   bottom padding never cleared it and the dock covered the legal links + the
   "Powered by BGG" attribution on every hub tab (#324). That regression is
   invisible from Node: no test fails, nothing throws, the markup is present and
   the links are even clickable in the DOM — they are just painted under an
   opaque fixed element. Since the Impressum must be "ständig verfügbar"
   (§ 5 DDG) and the BGG logo is a licence condition, pin the clearance here so
   removing it fails loudly.

   #331 made the reserve CONDITIONAL — it is owed only where a dock actually
   floats — which is a second thing that fails silently in both directions: too
   little and the footer is covered again, too much and every dockless screen
   grows dead space. Both are pinned below. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

/* The parser (comment stripping, [selector, body] tokenizing, brace-matched
   @media blocks) is shared with the other CSS-text tests — one copy, because
   its traps are what `.claude/rules/css-text-assertions-strip-comments.md`
   exists to warn about and a second copy is a second chance to get them
   wrong. */
const { RULES, rulesOf, bodyOf, mediaBlocks, whole } = require('./support/css');

// `.site-footer` as a whole class — never `.site-footer__links`/`__bgg`.
const targetsFooter = (sel) => whole('.site-footer').test(sel);
// A rule that hands out the clearance, i.e. one of the two reserves.
const reserves = (body) => /padding-bottom:\s*var\(--dock-clearance\)/.test(body);

test(':root defines the shared dock clearance', () => {
  const root = bodyOf(':root');
  assert.ok(root, ':root rule not found in styles.css');
  assert.match(root, /--dock-clearance:\s*\d+px/);
});

test('both things that end up under the dock reserve room, from the same variable', () => {
  // `.app` (the page) and `.site-footer` (its sibling, #324). A hardcoded px in
  // either drifts from the other's copy the moment the dock is resized, which
  // is the exact bug the shared variable exists to prevent — the narrow-screen
  // one shipped that way once and was only caught by reading the built CSS.
  const forApp = RULES.find(([sel, body]) =>
    /^\.app:has\(/.test(sel) && !targetsFooter(sel) && reserves(body));
  assert.ok(forApp, 'no rule reserves the dock clearance on .app when a dock is rendered');

  const forFooter = RULES.find(([sel, body]) =>
    targetsFooter(sel) && sel.includes('.dock') && reserves(body));
  assert.ok(forFooter, 'no rule gives .site-footer clearance when a dock is rendered (#324)');
});

test('neither reserve is unconditional — dockless screens keep their spacing', () => {
  // #331: `.app` used to carry `padding: … var(--dock-clearance)` outright, so
  // the eight round sub-screens that render no dock each paid 120px for one.
  // The footer half of this has been conditional since #324.
  const unconditional = RULES.filter(([sel, body]) =>
    !sel.includes('.dock')
    && (/(^|,)\s*\.app\s*$/.test(sel) || targetsFooter(sel))
    && /var\(--dock-clearance\)/.test(body));
  assert.deepEqual(unconditional.map(([sel]) => sel), [],
    'these rules apply the dock clearance unconditionally');
});

test('the desktop-only sub-screen strip is excluded from both reserves', () => {
  // `.dock--sub` renders on round sub-screens and is hidden below the strip
  // breakpoint, so it never floats and owes nothing. A plain `:has(.dock)`
  // would still match it (display:none elements match :has), quietly putting
  // the 120px back onto exactly the screens #331 freed.
  const dockConditioned = RULES.filter(([sel, body]) => sel.includes('.dock') && reserves(body));
  assert.ok(dockConditioned.length >= 2, 'expected a reserve for .app and one for .site-footer');
  dockConditioned.forEach(([sel]) => {
    assert.match(sel, /:not\(\.dock--sub\)/,
      `"${sel}" reserves clearance for the sub-screen strip, which never floats`);
  });
});

test('the reserves and the desktop strip tile the width axis exactly', () => {
  // The reserve lives below the breakpoint; the strip presentation above it. A
  // gap between the two numbers is the #324 regression again: in that band the
  // dock is still `position: fixed` (the default) while nothing reserves room
  // for it, so it paints over the Impressum links. An overlap wastes 120px.
  const blocks = mediaBlocks();

  const reserveBlock = blocks.find(([, css]) =>
    rulesOf(css).some(([sel, body]) => sel.includes('.dock') && reserves(body)));
  assert.ok(reserveBlock, 'the dock clearance is not scoped to a width range');

  const stripBlock = blocks.find(([, css]) =>
    rulesOf(css).some(([sel, body]) =>
      /(^|,)\s*\.dock\s*$/.test(sel) && /position:\s*static/.test(body)));
  assert.ok(stripBlock, 'no min-width block turns the dock into an in-flow strip (#331)');

  const below = reserveBlock[0].match(/max-width:\s*(\d+)px/);
  const above = stripBlock[0].match(/min-width:\s*(\d+)px/);
  assert.ok(below, `expected the reserve block to be a max-width query, got "${reserveBlock[0]}"`);
  assert.ok(above, `expected the strip block to be a min-width query, got "${stripBlock[0]}"`);
  assert.equal(Number(above[1]), Number(below[1]) + 1,
    `the floating dock applies up to ${below[1]}px but the strip only from ${above[1]}px`);
});
