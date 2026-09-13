'use strict';

/* Korean wraps per SYLLABLE unless told otherwise (#1047).
 *
 * Hangul has no inter-word break opportunities of its own, so a browser is free
 * to end a line in the middle of a word — which in the app's chips, pills, tabs
 * and buttons reads as a typo rather than as a line break. One `:lang(ko)` rule
 * on the root fixes it for every surface at once, because both properties
 * inherit.
 *
 * It is a stylesheet rule, so jsdom cannot see it (no external stylesheet) and
 * no view spec can guard it — this is the text-assertion family of
 * `.claude/rules/css-text-assertions-strip-comments.md`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { CSS, RULES, bodyOf, mediaBlocks, rulesOf, declaredValue } = require('./support/css');
const { SUPPORTED_LOCALES } = require('../public/js/locales');

test('the Hangul wrapping rule exists and names a locale the app ships', () => {
  const langRules = RULES.filter(([sel]) => sel.includes(':lang('));
  assert.deepEqual(langRules.map(([sel]) => sel), [':lang(ko)'],
    'the only language-scoped rule in the sheet should be the Hangul one — '
    + 'a second means this test needs widening');

  // i18n.js writes the bare two-letter code onto <html>, so the selector must
  // be the bare code too — `:lang(ko-KR)` would never match.
  assert.ok(SUPPORTED_LOCALES.includes('ko'),
    ':lang(ko) is styling a locale public/js/locales.js does not ship');
});

test('it sets BOTH halves — keep-all alone makes a long word overhang', () => {
  const body = bodyOf(':lang(ko)');
  assert.ok(body, ':lang(ko) rule is gone');
  assert.equal(declaredValue(body, 'word-break'), 'keep-all');
  /* Without this, a word wider than its box does not break at all: `keep-all`
     removes the syllable break opportunities and leaves nothing in their place
     (measured: 109px of word in a 60px box).

     It must be `break-word` and not `anywhere`, which is the value the rest of
     this sheet uses for user-authored titles. `anywhere` is the one of the two
     that counts toward MIN-CONTENT, so it drops the `min-width: auto` floor of
     every flex item to a single syllable — measured at 390px, that wrapped the
     dock's „트로피" onto two lines inside a dock with 127px to spare. */
  assert.equal(declaredValue(body, 'overflow-wrap'), 'break-word');
});

test('it is unconditional — not parked inside a width range', () => {
  const scoped = mediaBlocks(CSS)
    .filter(([, css]) => rulesOf(css).some(([sel]) => sel.includes(':lang(')));
  assert.deepEqual(scoped.map(([q]) => q.trim()), [],
    'the narrow surfaces that need this are narrowest on a phone, so a rule '
    + 'behind a min-width query is exactly backwards');
});

test('nothing else in the sheet re-declares word-break, except the one that means to', () => {
  /* `word-break` is inherited, so the `:lang(ko)` rule reaches everything —
     until a component declares its own, which silently reverts Korean to
     syllable breaking on that component alone. Enumerating the overrides here
     means a new one arrives as a red test rather than as a ragged chip nobody
     screenshots. `.popover__head` is deliberate: it holds the account's e-mail
     address, a single unbreakable Latin token that must wrap somewhere. */
  const setters = RULES
    .filter(([, body]) => declaredValue(body, 'word-break'))
    .map(([sel]) => sel);
  assert.deepEqual(setters, [':lang(ko)', '.popover__head']);
});
