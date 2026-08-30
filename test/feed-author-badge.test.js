'use strict';

/*
 * The friend feed's author badge (#841) — the profile picture overlapping the
 * bottom-left corner of the game's cover.
 *
 * A CSS-text assertion because the trap is purely a cascade/containment one and
 * no view spec can see it: jsdom applies no external stylesheet. The trap is
 * that `.feed-item__img` is `overflow: hidden`, so a badge positioned against it
 * is CLIPPED at its rounded corner — half a face, on every feed row, with every
 * test green. The wrapper exists solely to give the badge a containing block
 * that does not clip.
 *
 * Comments are stripped first: a selector regex is brace-free text and will
 * happily match inside a comment that merely mentions the class
 * (.claude/rules/css-text-assertions-strip-comments.md).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// One parse into [selector, body] pairs, looked up by exact selector — rather
// than a bespoke regex per assertion.
const RULES = new Map(
  [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]),
);
const decl = (selector, prop) => {
  const body = RULES.get(selector);
  assert.ok(body !== undefined, `no rule for ${selector}`);
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

test('the badge has a containing block that does NOT clip it', () => {
  // Both halves matter. Without `position: relative` the badge escapes to the
  // nearest positioned ancestor (the card, or the page) and lands nowhere near
  // the cover; with the wrapper missing entirely it would have to be positioned
  // against .feed-item__img, which clips.
  assert.equal(decl('.feed-item__media', 'position'), 'relative');
  assert.equal(RULES.get('.feed-item__media').includes('overflow'), false,
    '.feed-item__media must not clip — that is the whole reason it exists');

  // The thing it is protecting the badge from.
  assert.equal(decl('.feed-item__img', 'overflow'), 'hidden',
    'if the cover ever stops clipping, this guard is describing a problem that moved');
});

test('the badge overlaps the cover corner rather than sitting inside it', () => {
  assert.equal(decl('.feed-item__who', 'position'), 'absolute');
  // Negative offsets are what make it OVERLAP; zero would tuck it inside the
  // cover, where it reads as part of the artwork instead of as a person.
  for (const side of ['left', 'bottom']) {
    const v = decl('.feed-item__who', side);
    assert.match(v, /^-\d/, `${side} must be negative to overlap, got ${v}`);
  }
});

test('the badge is small enough not to compete with the cover it sits on', () => {
  // .avatar is 34px; a badge that size would cover most of a 46px thumb.
  const w = decl('.feed-item__who', 'width');
  assert.equal(w, decl('.feed-item__who', 'height'), 'square, or the circle is an ellipse');
  const px = Number(w.replace('px', ''));
  assert.ok(px >= 18 && px <= 28, `expected a small badge, got ${w}`);
  assert.ok(Number(decl('.feed-item__img', 'width').replace('px', '')) > px * 1.5,
    'the cover must stay clearly the larger of the two');
});
