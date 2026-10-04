'use strict';

/* The focus trap behind the modal sheets (#145). Exercised against a tiny hand
   rolled DOM rather than a real one: the module only needs querySelectorAll,
   contains, focus and a keydown listener, so a stub keeps the test dependency
   free (supertest is the only test dep) and pins the exact behaviour — which
   element gets focus on each Tab, and that focus returns to the opener. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { trapFocus, FOCUSABLE } = require('../public/js/focus-trap');

// --- minimal DOM double -----------------------------------------------------
function makeEl(name, { focusable = true, hidden = false, tabindex = null } = {}) {
  return {
    name, focusable, hidden,
    offsetParent: hidden ? null : {},
    getBoundingClientRect: () => (hidden ? { width: 0, height: 0 } : { width: 10, height: 10 }),
    getAttribute: (attr) => (attr === 'tabindex' ? tabindex : null),
    closest: () => null,
    focus() { global.document.activeElement = this; },
  };
}

function install(inside, { opener = null } = {}) {
  const listeners = [];
  const container = {
    _items: inside,
    querySelectorAll(sel) {
      assert.equal(sel, FOCUSABLE, 'should query the shared focusable selector');
      return inside;
    },
    contains: (el) => inside.includes(el),
  };
  global.document = {
    activeElement: opener,
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    contains: (el) => el === opener || inside.includes(el),
  };
  const release = trapFocus(container);
  const press = (key, shiftKey = false) => {
    let prevented = false;
    const ev = { key, shiftKey, preventDefault: () => { prevented = true; } };
    listeners.filter((l) => l.type === 'keydown').forEach((l) => l.fn(ev));
    return prevented;
  };
  return { release, press, listeners, container };
}

test('Tab off the last element wraps to the first instead of leaving the sheet', () => {
  const [a, b, c] = [makeEl('a'), makeEl('b'), makeEl('c')];
  const { press } = install([a, b, c]);
  global.document.activeElement = c;
  assert.equal(press('Tab'), true, 'the default Tab must be prevented');
  assert.equal(global.document.activeElement, a);
});

test('Shift+Tab off the first element wraps to the last', () => {
  const [a, b, c] = [makeEl('a'), makeEl('b'), makeEl('c')];
  const { press } = install([a, b, c]);
  global.document.activeElement = a;
  assert.equal(press('Tab', true), true);
  assert.equal(global.document.activeElement, c);
});

test('Tab in the middle of the sheet is left to the browser', () => {
  const [a, b, c] = [makeEl('a'), makeEl('b'), makeEl('c')];
  const { press } = install([a, b, c]);
  global.document.activeElement = b;
  assert.equal(press('Tab'), false, 'no preventDefault — natural order still applies');
  assert.equal(global.document.activeElement, b, 'and focus is not moved');
});

test('focus that has escaped the sheet is pulled back to the first element', () => {
  const [a, b] = [makeEl('a'), makeEl('b')];
  const outside = makeEl('behind-the-backdrop');
  const { press } = install([a, b]);
  global.document.activeElement = outside;
  assert.equal(press('Tab'), true);
  assert.equal(global.document.activeElement, a);
});

test('keys other than Tab pass straight through (Escape still closes the sheet)', () => {
  const [a, b] = [makeEl('a'), makeEl('b')];
  const { press } = install([a, b]);
  global.document.activeElement = b;
  assert.equal(press('Escape'), false);
  assert.equal(press('Enter'), false);
  assert.equal(global.document.activeElement, b);
});

test('a sheet with nothing focusable still swallows Tab rather than leaking focus', () => {
  const { press } = install([]);
  assert.equal(press('Tab'), true);
});

test('hidden controls are skipped, so Tab wraps across the visible ones', () => {
  const a = makeEl('a');
  const gone = makeEl('display-none', { hidden: true });
  const c = makeEl('c');
  const { press } = install([a, gone, c]);
  global.document.activeElement = c;
  press('Tab');
  assert.equal(global.document.activeElement, a);
  // …and `gone` is never the wrap target going backwards either.
  global.document.activeElement = a;
  press('Tab', true);
  assert.equal(global.document.activeElement, c);
});

// The FOCUSABLE selector spells `:not([tabindex="-1"])` out only in its last
// entry, so a *native* control carrying it — `button:not([disabled])` — matched
// anyway. The lookup menu's options are exactly that shape (#542): buttons the
// browser never tabs to. Counting one as the container's last element would put
// the wrap target on an element Tab can never reach, letting a Tab escape the
// sheet before the next one pulls focus back.
test('a control with tabindex="-1" is not a wrap target', () => {
  const a = makeEl('a');
  const c = makeEl('c');
  const opt = makeEl('lookup-option', { tabindex: '-1' });
  const { press } = install([a, c, opt]);
  global.document.activeElement = c;
  assert.equal(press('Tab'), true, 'c is the real last element, so Tab must wrap');
  assert.equal(global.document.activeElement, a);
  // …and backwards from the first element, the wrap target skips it too.
  global.document.activeElement = a;
  press('Tab', true);
  assert.equal(global.document.activeElement, c);
});

test('release() restores focus to whatever opened the sheet', () => {
  const opener = makeEl('addGameButton');
  const [a] = [makeEl('a')];
  const { release, press } = install([a], { opener });
  global.document.activeElement = a;
  release();
  assert.equal(global.document.activeElement, opener, 'keyboard users return where they were');
  // The listener is gone, so Tab is no longer intercepted after release.
  global.document.activeElement = a;
  assert.equal(press('Tab'), false);
});

test('release() does not throw when the opener has left the document', () => {
  const opener = makeEl('opener');
  const [a] = [makeEl('a')];
  const { release } = install([a], { opener });
  // The view underneath was re-rendered while the sheet was open.
  global.document.contains = () => false;
  global.document.activeElement = a;
  release();
  assert.equal(global.document.activeElement, a, 'focus is left alone rather than thrown at a detached node');
});

/* ---------------------------------------------------------------- focusInto

   The INITIAL focus of an overlay (audit 2026-10-04 A1, WCAG 2.4.3) — the half
   trapFocus deliberately never did: it only acts on a Tab, so a popover or a
   sheet with no input of its own opened with focus still on the page behind it.
   openSheet and openPopover call this once their caller has had its turn. */

const { focusInto } = require('../public/js/focus-trap');

// An element whose focus() can be refused, the way a browser refuses one that
// is not rendered (display:none, visibility:hidden) — focusInto asks rather
// than predicting from layout, so the double must be able to say no.
function focusable(name, { takes = true, tabindex = null, hiddenFromAT = false } = {}) {
  const el = {
    name,
    calls: [],
    getAttribute: (attr) => (attr === 'tabindex' ? tabindex : null),
    closest: (sel) => (hiddenFromAT && sel === '[aria-hidden="true"]' ? {} : null),
    focus(opts) { el.calls.push(opts); if (takes) global.document.activeElement = el; },
  };
  return el;
}

function overlay(items, { active = { name: 'opener' } } = {}) {
  global.document = { activeElement: active };
  const attrs = {};
  const box = {
    name: 'dialog',
    hasAttribute: (a) => a in attrs,
    setAttribute: (a, v) => { attrs[a] = v; },
    attrs,
    focus() { global.document.activeElement = box; },
  };
  const container = {
    querySelectorAll(sel) {
      assert.equal(sel, FOCUSABLE, 'should query the shared focusable selector');
      return items;
    },
    contains: (el) => items.includes(el) || el === box,
  };
  return { container, box };
}

test('focusInto leaves focus alone when the caller already put it inside', () => {
  const [a, b] = [focusable('a'), focusable('b')];
  const { container } = overlay([a, b], { active: b });
  assert.equal(focusInto(container), b);
  assert.equal(global.document.activeElement, b, 'the caller\'s own focus (an input, a heading) must win');
  assert.equal(a.calls.length, 0, 'nothing else was even tried');
});

test('focusInto moves focus from outside to the first control that takes it', () => {
  const gone = focusable('display-none', { takes: false });
  const [a, b] = [focusable('a'), focusable('b')];
  const { container } = overlay([gone, a, b]);
  assert.equal(focusInto(container), a, 'a control the browser refuses is skipped, not stopped at');
  assert.equal(global.document.activeElement, a);
  // A popover tears itself down on a PAGE scroll, so the focus() that put the
  // user inside it must not scroll the page to reveal it.
  assert.deepEqual(a.calls, [{ preventScroll: true }]);
});

test('focusInto skips what Tab never reaches: tabindex="-1" and aria-hidden subtrees', () => {
  const opt = focusable('lookup-option', { tabindex: '-1' });
  const deco = focusable('decor', { hiddenFromAT: true });
  const real = focusable('real');
  const { container } = overlay([opt, deco, real]);
  assert.equal(focusInto(container), real);
  assert.equal(opt.calls.length + deco.calls.length, 0);
});

test('focusInto falls back to the dialog box itself when nothing inside can hold focus', () => {
  const { container, box } = overlay([focusable('gone', { takes: false })]);
  assert.equal(focusInto(container, box), box);
  assert.equal(global.document.activeElement, box);
  assert.equal(box.attrs.tabindex, '-1', 'programmatically focusable, but still not a Tab stop');
});
