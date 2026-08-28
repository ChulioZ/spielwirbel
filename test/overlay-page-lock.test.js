'use strict';

/* The page must not move behind an open overlay (#622).
 *
 * Two independent paths let it, so there are two halves here:
 *   • CSS — a bounded scroll box inside an overlay chains into the document once
 *     it hits its own top/bottom edge (`overscroll-behavior`);
 *   • JS  — the exposed backdrop area is not a scroll container at all, so a
 *     drag there goes straight to the document (the page lock in openSheet).
 *
 * The CSS half is a text assertion (jsdom applies no external stylesheet — see
 * `.claude/rules/testing-views-under-jsdom.md`), the JS half runs the real
 * openSheet/closeSheet in the jsdom harness.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { RULES, bodyOf } = require('./support/css');

/* ------------------------------------------------------------------ CSS half */

/* Every scroll container in the stylesheet, classified by whether it sits in an
   overlay. Enumerated rather than pattern-matched on purpose: a NEW scroll box
   fails the first test until someone puts it in one list or the other, and
   "does this chain into the page?" is precisely the question nobody asked for
   the three overlay boxes below. */
const CONTAINED = [
  '.sheet',              // every one of the app's ten bottom sheets
  '.lookup__menu',       // the add-game suggestion dropdown
  '.cover-picker__grid', // the edition-cover picker
  // The expansion tick-list (#653) — a game can have 100+ expansions, so the
  // list is bounded, and it sits in the popover/sheet editor.
  ':is(.popover--expansions, .editor--expansions) .exp-pick__body',
  // The tags editor's chip row and icon grid (#722) — a round's tag list grows
  // without bound, so both give way under the anchored card's cap. Popover-only:
  // the sheet presentation scrolls itself.
  '.popover--tags .filter-chips',
  '.popover--tags .icon-picker',
  // The filter panel's body (#844) — the round's tags plus BGG's categories and
  // mechanics as they appear on the shelf, so it grows without bound too, and it
  // is the flex item that gives way under the anchored card's cap. Popover-only,
  // for the same reason as the two above: the sheet presentation scrolls itself.
  '.popover--filter .fpanel__body',
  // A card `place()` had to clamp to the room its anchor leaves (#739). It is
  // the only one here applied from JS rather than declared on a component, and
  // the only one that is the overlay itself rather than a box inside it — but
  // the question is the same one, and the answer matters more: reaching its end
  // would scroll the page, and a page scroll CLOSES a popover outright.
  '.popover--clamped',
];
const CHAINS = [
  // The session-setup game list sits INLINE on the page, not in an overlay.
  // Containing it would trap the user in a 420px box on a normal screen.
  '.setup-panel__body',
];

const scrollBoxes = () => RULES
  .filter(([, body]) => /overflow-y:\s*auto/.test(body))
  .map(([sel]) => sel);

test('every scroll container in styles.css is classified as overlay or inline', () => {
  assert.deepEqual(scrollBoxes().sort(), [...CONTAINED, ...CHAINS].sort());
});

test('a scroll container inside an overlay does not chain into the page', () => {
  for (const sel of CONTAINED) {
    assert.match(
      bodyOf(sel) || '',
      /overscroll-behavior:\s*contain/,
      `${sel} scrolls inside an overlay, so reaching its edge must not scroll the page behind it`,
    );
  }
});

test('the inline session-setup list still chains into the page', () => {
  for (const sel of CHAINS) {
    assert.doesNotMatch(
      bodyOf(sel) || '',
      /overscroll-behavior/,
      `${sel} is inline on the page — containing it traps the user inside the box`,
    );
  }
});

/* ------------------------------------------------------------------- JS half */

/* jsdom has no layout, so the two viewport numbers the lock reads have to be
   stated by the spec: `scrollY` (the offset to freeze at) and the scrollbar
   gutter, which is `innerWidth - documentElement.clientWidth` and comes out as
   the full 1024 in jsdom because clientWidth is 0 there. */
function boot(t, { scrollY = 0, gutter = 0 } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  Object.defineProperty(dom.window, 'scrollY', { value: scrollY, configurable: true });
  Object.defineProperty(dom.document.documentElement, 'clientWidth', {
    value: dom.window.innerWidth - gutter,
    configurable: true,
  });
  return dom;
}

function openTestSheet(dom) {
  const backdrop = dom.document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = '<div class="sheet" role="dialog"><button class="sheet__close">x</button></div>';
  dom.document.body.appendChild(backdrop);
  dom.call('openSheet', backdrop, () => {});
  return backdrop;
}

test('opening a sheet freezes the document at the current offset', (t) => {
  const dom = boot(t, { scrollY: 2600 });
  openTestSheet(dom);

  const s = dom.document.body.style;
  assert.equal(s.position, 'fixed');
  assert.equal(s.top, '-2600px', 'the frozen page must stay at the offset it was opened from');
});

test('closing a sheet restores the exact offset it was opened from', (t) => {
  const dom = boot(t, { scrollY: 2600 });
  const before = dom.scrolls.length;
  openTestSheet(dom);
  dom.call('closeSheet');

  const s = dom.document.body.style;
  assert.equal(s.position, '', 'the lock must be removed, not left on the body');
  assert.equal(s.top, '');
  assert.deepEqual(
    dom.scrolls.slice(before),
    [[0, 2600]],
    'taking the body out of flow loses the offset — unlocking has to put it back',
  );
});

test('Back-dismissing a sheet unlocks the page too', (t) => {
  const dom = boot(t, { scrollY: 800 });
  openTestSheet(dom);
  const before = dom.scrolls.length;

  assert.equal(dom.call('handleSheetPop'), true, 'the pop belongs to the sheet layer');
  assert.equal(dom.document.body.style.position, '');
  assert.deepEqual(dom.scrolls.slice(before), [[0, 800]]);
});

test('opening a second sheet over an open one does not unlock in between', (t) => {
  const dom = boot(t, { scrollY: 1200 });
  openTestSheet(dom);
  const before = dom.scrolls.length;
  openTestSheet(dom); // the openSheet replace path — teardown, then re-open

  assert.equal(dom.document.body.style.position, 'fixed');
  assert.equal(dom.document.body.style.top, '-1200px');
  assert.deepEqual(
    dom.scrolls.slice(before),
    [],
    'an unlock/relock pair across a replace restores and re-freezes the page — a visible jump',
  );
});

test('the lock reserves the scrollbar gutter it removes, and nothing when there is none', (t) => {
  const wide = boot(t, { gutter: 15 });
  openTestSheet(wide);
  assert.equal(
    wide.document.body.style.paddingRight, '15px',
    'a fixed body collapses the document height, so the scrollbar goes and the page shifts sideways',
  );

  const phone = boot(t, { gutter: 0 });
  openTestSheet(phone);
  assert.equal(phone.document.body.style.paddingRight, '', 'no scrollbar, nothing to compensate');
});

/* The dismiss handlers every sheet installs fire on `mousedown` with
   `e.target === backdrop`. With the page locked, a drag on the backdrop no
   longer scrolls anything — so the browser can resolve the gesture as a tap and
   synthesise that very mousedown, dismissing a sheet the user was only trying
   to scroll. openSheet guards the backdrop against it. */
function dismissSpy(dom, backdrop) {
  const seen = { count: 0 };
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) seen.count++; });
  return seen;
}

function gesture(dom, backdrop, from, to) {
  const ev = (type, [clientX, clientY]) =>
    backdrop.dispatchEvent(new dom.window.PointerEvent(type, { clientX, clientY, bubbles: true }));
  ev('pointerdown', from);
  ev('pointerup', to);
  backdrop.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
}

test('a drag on the backdrop does not dismiss the sheet', (t) => {
  const dom = boot(t);
  const backdrop = openTestSheet(dom);
  const spy = dismissSpy(dom, backdrop);

  gesture(dom, backdrop, [180, 320], [180, 120]);
  assert.equal(spy.count, 0, 'a swipe is a scroll attempt, not a dismissal');
});

test('a tap on the backdrop still dismisses the sheet', (t) => {
  const dom = boot(t);
  const backdrop = openTestSheet(dom);
  const spy = dismissSpy(dom, backdrop);

  gesture(dom, backdrop, [180, 320], [181, 322]);
  assert.equal(spy.count, 1, 'the backdrop tap-to-dismiss must survive the guard');
});
