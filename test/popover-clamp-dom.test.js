'use strict';

/* The DOM half of the popover clamp (#739) — what `place()` in core.js does with
 * `popoverFit`'s answer.
 *
 * `test/popover-fit.test.js` covers the arithmetic and `test/overlay-page-lock.test.js`
 * that the clamped card's CSS contains its scroll. Neither can see the wiring in
 * between: the class name `place()` adds must be the one the stylesheet declares,
 * the clamp must reach the element as a real `max-height`, the children must be
 * barred from collapsing, and the `top` must be derived from the CLAMPED height
 * rather than the natural one.
 *
 * jsdom has no layout, so the three inputs `place()` reads are stated here —
 * the card's height, the anchor's rect and the viewport. They are inputs, not
 * outcomes: everything asserted below is something the code computes from them.
 * The height stub honours an inline `max-height` exactly as a browser would, or
 * the re-read after clamping would report the unclamped height and the `top`
 * assertions would be measuring the stub instead of the code.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const VIEWPORT = 900;

/* Open a popover whose card wants to be `natural` tall, anchored at
   `anchorTop`..`anchorTop + anchorH`, and return it once `place()` has run. */
function openAt(dom, { natural, anchorTop, anchorH, children = 2 }) {
  const doc = dom.document;
  dom.window.innerHeight = VIEWPORT;

  const anchor = doc.createElement('button');
  doc.body.appendChild(anchor);
  anchor.getBoundingClientRect = () => ({
    top: anchorTop, bottom: anchorTop + anchorH, left: 100, right: 300,
    width: 200, height: anchorH,
  });

  dom.context.__build = (el) => {
    for (let i = 0; i < children; i++) {
      const kid = doc.createElement('div');
      kid.className = 'kid kid-' + i;
      el.appendChild(kid);
    }
    // A browser clamps the border box at `max-height`; jsdom reports neither, so
    // model exactly that and nothing else.
    Object.defineProperty(el, 'offsetHeight', {
      configurable: true,
      get() {
        const cap = parseFloat(this.style.maxHeight);
        return Number.isFinite(cap) ? Math.min(natural, cap) : natural;
      },
    });
  };
  dom.context.__anchor = anchor;
  dom.run('openPopover(__anchor, __build)');
  return doc.querySelector('.popover');
}

const styleOf = (card) => ({
  clamped: card.classList.contains('popover--clamped'),
  maxHeight: card.style.maxHeight,
  top: parseFloat(card.style.top),
  kidMins: [...card.children].map((k) => k.style.minHeight),
});

test('a card that fits below its anchor is left alone entirely', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // 200px card, 654px of room below it.
  const card = openAt(dom, { natural: 200, anchorTop: 200, anchorH: 40 });
  const s = styleOf(card);
  assert.equal(s.clamped, false);
  assert.equal(s.maxHeight, '', 'no inline cap on a card that fits');
  assert.deepEqual(s.kidMins, ['', ''], 'and no min-height pinned on its children');
  assert.equal(s.top, 246, 'placed 6px under the anchor, as it always was');
});

test('a card too tall for either side is clamped, scroll-boxed and pinned', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // The edition-cover editor's shape: a 534px card under a 180px anchor at
  // y=300, so 414px below and 294px above — neither fits.
  const card = openAt(dom, { natural: 534, anchorTop: 300, anchorH: 180 });
  const s = styleOf(card);
  assert.equal(s.clamped, true, 'the class the stylesheet gives its scroll box');
  assert.equal(s.maxHeight, '414px', 'clamped to the room below, the roomier side');
  assert.deepEqual(s.kidMins, ['auto', 'auto'],
    'every child barred from shrinking past its own content while clamped');
  assert.equal(s.top, 486, 'still 6px under the anchor');
  assert.equal(s.top + 414, VIEWPORT, 'and it ends exactly at the fold');
});

test('the top is derived from the CLAMPED height when the card flips above', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // Anchor low: 594px above, 114px below. A 700px card is clamped to 594 and
  // placed above — so `top` must be 6px above the anchor, i.e. 0, not the
  // negative number the natural height would give (600 - 700 - 6 = -106).
  const card = openAt(dom, { natural: 700, anchorTop: 600, anchorH: 180 });
  const s = styleOf(card);
  assert.equal(s.maxHeight, '594px');
  assert.equal(s.top, 0, 'the clamped card sits flush with the top of the viewport');
  assert.ok(s.top >= 0, 'never hung off the top, where its content is unreachable');
});

test('re-placing after the content shrinks releases the clamp completely', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const card = openAt(dom, { natural: 534, anchorTop: 300, anchorH: 180 });
  assert.equal(styleOf(card).clamped, true);

  // The cover picker collapses its grid and calls repositionPopover() (#519).
  // Every trace of the clamp must go, or the card stays capped at the height a
  // previous, taller state needed.
  Object.defineProperty(card, 'offsetHeight', { configurable: true, get: () => 200 });
  dom.run('repositionPopover()');
  const s = styleOf(card);
  assert.equal(s.clamped, false);
  assert.equal(s.maxHeight, '');
  assert.deepEqual(s.kidMins, ['', ''], 'the pinned min-heights are released too');
  assert.equal(s.top, 486);
});
