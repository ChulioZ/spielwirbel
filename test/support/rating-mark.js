'use strict';

/* The one assertion every #1537 surface shares: a person's rating is drawn as
   the rung's FACE plus its WORD, and no digit survives anywhere in the node —
   neither the old „Ø 3,5" mean nor a raw rung number.

   `face` is the Tabler class of the expected rung (MOODS[n - 1]) and `word` the
   scale word the view should have printed for it. The face must be aria-hidden,
   so what a screen reader hears is the word and nothing else (#1530 §5). */

const assert = require('node:assert/strict');

function assertRatingMark(el, face, word, what = 'rating') {
  assert.ok(el, `${what}: the node is missing`);
  const glyph = el.querySelector(`i.ti.${face}`);
  assert.ok(glyph, `${what}: no ${face} face in «${el.innerHTML}»`);
  assert.equal(glyph.getAttribute('aria-hidden'), 'true', `${what}: the face must be aria-hidden`);
  assert.ok(el.textContent.includes(word), `${what}: «${el.textContent.trim()}» does not say „${word}"`);
  assert.doesNotMatch(el.textContent, /\d/, `${what}: a digit survived in «${el.textContent.trim()}»`);
}

module.exports = { assertRatingMark };
