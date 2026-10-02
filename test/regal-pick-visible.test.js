'use strict';

/*
 * The Regal's selection tick and picked frame (#1358) — CSS text, because jsdom
 * applies no external stylesheet (.claude/rules/break-the-code-on-purpose.md,
 * the bucket Route 1 cannot reach for a paint question).
 *
 * The bug: `.game-card__pick` had no z-index, so the cover's ::after layer (#181)
 * painted over it on every game with a cover. And the only other cue, the card's
 * brand border, was outranked on Ocean light and absent on Der Tisch (border: 0).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RULES, declaredValue } = require('./support/css');

const members = (sel) => sel.split(',').map((s) => s.trim());
const rulesNaming = (selector, rules = RULES) =>
  rules.filter(([sel]) => members(sel).includes(selector));

test('the tick sits above the cover layers', () => {
  const raised = rulesNaming('.game-card__pick')
    .filter(([, body]) => declaredValue(body, 'z-index') === '2');
  assert.equal(raised.length, 1,
    '.game-card__pick must join the z-index: 2 group beside .game-card__badges');
});

test('the empty tick carries a halo so it reads over any cover', () => {
  const [[, body]] = rulesNaming('.game-card__pick')
    .filter(([, b]) => /display:\s*none/.test(b));
  assert.match(declaredValue(body, 'box-shadow') || '', /var\(--/,
    'the unpicked circle needs a token-derived shadow');
});

test('a picked game rings its cover, in every design', () => {
  const [hit] = rulesNaming('.is-selecting .game-card.is-picked .game-card__img::after');
  assert.ok(hit, 'the picked cover ring rule is missing');
  assert.match(declaredValue(hit[1], 'box-shadow') || '', /^inset\b.*var\(--brand\)/,
    'an INSET shadow on the cover layer — anything on .game-card__img itself paints under ::after');
});

// A design removing or re-shadowing .game-card__img::after would drop the ring.
// That is now covered by the stronger guard in test/cover-fill-shared.test.js
// (#1504): no design may style the frame's ::before/::after at all.
