'use strict';

/* An open sheet keeps its focused field above the iOS keyboard (#1752).
 *
 * WebKit does not shrink the layout viewport for the keyboard, so a bottom-docked
 * `position: fixed` backdrop stays full height and WebKit pans the visual
 * viewport instead — moving the sheet's head (and the autofocused field in it)
 * off the top edge, with the page locked so nothing can scroll it back. The fix
 * pins the backdrop to the visual viewport while a sheet is open.
 *
 * Two halves: the pure band arithmetic, required into Node, and the lifecycle in
 * openSheet/teardownSheet, run in the jsdom harness with a stubbed
 * `visualViewport` (jsdom has none). The real keyboard is WebKit-only and was
 * checked on a device, not here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { visibleBand, followVisualViewport } = require('../public/js/keyboard-viewport');
const { loadApp } = require('./support/dom');

/* A minimal VisualViewport: the three geometry fields plus an EventTarget, so
   the spec can fire `resize`/`scroll` exactly as WebKit does when the keyboard
   moves, and count the listeners left behind. */
function fakeViewport(EventTargetCtor, geom) {
  const vv = new EventTargetCtor();
  Object.assign(vv, { offsetTop: 0, height: 800, scale: 1 }, geom);
  let live = 0;
  const add = vv.addEventListener.bind(vv);
  const remove = vv.removeEventListener.bind(vv);
  vv.addEventListener = (...a) => { live += 1; add(...a); };
  vv.removeEventListener = (...a) => { live -= 1; remove(...a); };
  vv.listeners = () => live;
  vv.move = (g) => { Object.assign(vv, g); vv.dispatchEvent(new EventTargetCtor.Event('resize')); };
  return vv;
}

/* ---------------------------------------------------------- the arithmetic */

test('visibleBand: no keyboard, no pan → null, so the CSS geometry stands', () => {
  assert.equal(visibleBand({ offsetTop: 0, height: 800, scale: 1 }, 800), null);
});

test('visibleBand: keyboard up and the viewport panned → the visible band', () => {
  assert.deepEqual(visibleBand({ offsetTop: 210, height: 430, scale: 1 }, 800), { top: 210, height: 430 });
});

test('visibleBand: keyboard up without a pan still shrinks the band', () => {
  assert.deepEqual(visibleBand({ offsetTop: 0, height: 430, scale: 1 }, 800), { top: 0, height: 430 });
});

test('visibleBand: a pinch zoom is left alone — the sheet must not chase the zoom', () => {
  assert.equal(visibleBand({ offsetTop: 120, height: 400, scale: 2 }, 800), null);
});

test('visibleBand: a missing or degenerate viewport is a no-op', () => {
  assert.equal(visibleBand(null, 800), null);
  assert.equal(visibleBand({ offsetTop: 0, height: 0, scale: 1 }, 800), null);
});

/* ------------------------------------------------- following, without a DOM */

function fakeEl() { return { style: { top: '', bottom: '', height: '' } }; }

test('followVisualViewport: pins the element to the band, and lets go when it closes', () => {
  const vv = fakeViewport(EventTarget, {});
  vv.constructor.Event = Event;
  const win = { visualViewport: vv, document: { documentElement: { clientHeight: 800 } } };
  const el = fakeEl();
  const release = followVisualViewport(el, win);
  assert.equal(el.style.top, '', 'a no-op while the keyboard is down');

  Object.assign(vv, { offsetTop: 210, height: 430 });
  vv.dispatchEvent(new Event('scroll'));
  assert.deepEqual(el.style, { top: '210px', bottom: 'auto', height: '430px' });

  Object.assign(vv, { offsetTop: 0, height: 800 });
  vv.dispatchEvent(new Event('resize'));
  assert.deepEqual(el.style, { top: '', bottom: '', height: '' }, 'keyboard closed → back to the CSS');

  release();
  assert.equal(vv.listeners(), 0);
});

test('followVisualViewport: applies at once — the keyboard may already be up', () => {
  const vv = fakeViewport(EventTarget, { offsetTop: 100, height: 400 });
  const el = fakeEl();
  followVisualViewport(el, { visualViewport: vv, document: { documentElement: { clientHeight: 800 } } });
  assert.equal(el.style.height, '400px');
});

test('followVisualViewport: without visualViewport it is a harmless no-op', () => {
  const release = followVisualViewport(fakeEl(), { document: { documentElement: { clientHeight: 800 } } });
  assert.equal(typeof release, 'function');
  release();
});

/* ------------------------------------------------ the sheet layer lifecycle */

function boot(t, geom) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const Ctor = dom.window.EventTarget;
  Ctor.Event = dom.window.Event;
  const vv = fakeViewport(Ctor, geom);
  Object.defineProperty(dom.window, 'visualViewport', { value: vv, configurable: true });
  Object.defineProperty(dom.document.documentElement, 'clientHeight', { value: 800, configurable: true });
  return { dom, vv };
}

function openTestSheet(dom) {
  const backdrop = dom.document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = '<div class="sheet" role="dialog"><input id="q"><button class="sheet__close">x</button></div>';
  dom.document.body.appendChild(backdrop);
  dom.call('openSheet', backdrop, () => {});
  return backdrop;
}

test('an open sheet follows the keyboard: its backdrop is the visible band', (t) => {
  const { dom, vv } = boot(t, {});
  const backdrop = openTestSheet(dom);
  vv.move({ offsetTop: 210, height: 430 });
  assert.equal(backdrop.style.top, '210px');
  assert.equal(backdrop.style.height, '430px');
  assert.equal(backdrop.style.bottom, 'auto');
});

test('closing the sheet stops listening', (t) => {
  const { dom, vv } = boot(t, {});
  openTestSheet(dom);
  assert.equal(vv.listeners(), 2, 'resize + scroll while the sheet is up');
  dom.call('closeSheet');
  assert.equal(vv.listeners(), 0);
});

test('the sheet-over-sheet replace hands the keyboard to the new sheet, leaking nothing', (t) => {
  const { dom, vv } = boot(t, { offsetTop: 180, height: 420 });
  openTestSheet(dom);
  const second = openTestSheet(dom); // the picker → add-game form chain
  assert.equal(vv.listeners(), 2, 'the replaced sheet must not keep its listeners');
  assert.equal(second.style.height, '420px', 'the new sheet starts in the band, keyboard already up');
});
