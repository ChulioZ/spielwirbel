'use strict';

/* An overlay takes focus when it opens (WCAG 2.4.3, audit 2026-10-04 A1).

   `openPopover` appended its card to the END of <body> and left focus on the
   anchor, so a keyboard user's next Tab went to the next control on the PAGE —
   measured from the game-detail owners chip, the open popover was reached only
   after 13 Tabs. A sheet with no input of its own (score info, QR, remove
   person, the confirm dialog …) left focus on the opener BEHIND its
   `aria-modal` backdrop, i.e. on a control the dialog says is not there.

   The fix is ONE fallback in each primitive, after the caller's own focus:
   synchronous after `attached()` for a popover, one microtask after `openSheet`
   for a sheet, so a caller that focuses its input on the line after openSheet —
   inside the opening gesture, where iOS still raises the keyboard — runs first
   and keeps it. These specs pin all three halves: the fallback acts, it yields
   to the caller, and the restore target trapFocus captured is still the opener. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush, waitFor } = require('./support/dom');

const boot = (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  return dom;
};

// A real, focused opener on the page — what the user clicked.
const opener = (dom) => dom.run(`(() => {
  const b = document.createElement('button');
  b.className = 'probe-opener';
  b.textContent = 'open';
  document.body.appendChild(b);
  b.focus();
  return b;
})()`);

// The sheet layer closes through history; let its pop land HERE rather than in
// the next spec (.claude/rules/jsdom-popstate-needs-a-real-timer.md).
const settle = (dom) => waitFor(() => dom.get('sheetHistory') === false, { label: 'the sheet marker to pop' });

const escape = (dom) => dom.document.activeElement.dispatchEvent(
  new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

/* ------------------------------------------------------------------ popovers */

test('a menu popover moves focus to its first item when its caller moves none', (t) => {
  const dom = boot(t);
  const btn = opener(dom);
  assert.equal(dom.document.activeElement, btn, 'precondition: the opener holds focus');

  dom.run(`openPopover(document.querySelector('.probe-opener'), (el, close) => fillMenu(el, [
    { icon: 'ti-external-link', label: 'Zum Spiel', kind: 'edit', run() {} },
    { icon: 'ti-trash', label: 'Entfernen', kind: 'destructive', run() {} },
  ], close))`);

  const pop = dom.document.querySelector('.popover');
  assert.ok(pop, 'no popover opened');
  assert.ok(pop.contains(dom.document.activeElement),
    'focus stayed on the anchor — the next Tab walks the page instead of the menu (A1)');
  assert.equal(dom.document.activeElement, pop.querySelector('.popover__opt'),
    'a menu takes focus on its FIRST item');
});

test('a popover whose own attached() focused something keeps that focus', (t) => {
  const dom = boot(t);
  opener(dom);
  dom.run(`openPopover(document.querySelector('.probe-opener'), (el) => {
    el.innerHTML = '<button class="a">a</button><button class="b">b</button>';
    return () => el.querySelector('.b').focus();
  })`);
  assert.equal(dom.document.activeElement.className, 'b',
    'the fallback overrode the caller\'s own focus — it must only act when focus is still outside');
});

test('closing a popover the fallback focused hands focus back to the anchor', (t) => {
  const dom = boot(t);
  const btn = opener(dom);
  dom.run(`openPopover(document.querySelector('.probe-opener'), (el, close) => fillMenu(el, [
    { icon: 'ti-x', label: 'Eins', kind: 'edit', run() {} },
  ], close))`);
  assert.notEqual(dom.document.activeElement, btn, 'anti-vacuous: focus must have left the anchor first');
  // Record how the anchor is focused: since focus is now INSIDE the card, a
  // close caused by a page scroll restores too, and a plain focus() would
  // scroll the page back to the anchor against the user's own scroll.
  const calls = [];
  const real = btn.focus.bind(btn);
  btn.focus = (opts) => { calls.push(opts); real(opts); };
  escape(dom);
  assert.equal(dom.document.querySelector('.popover'), null, 'Escape did not close the popover');
  assert.equal(dom.document.activeElement, btn, 'focus did not return to the anchor');
  assert.deepEqual(calls.map((o) => ({ ...o })), [{ preventScroll: true }], 'the restore may scroll the page');
});

/* -------------------------------------------------------------------- sheets */

test('a sheet with no input of its own takes focus once its caller is done', async (t) => {
  const dom = boot(t);
  const btn = opener(dom);
  dom.call('openInfoSheet', 'score');

  const sheet = dom.document.querySelector('.sheet');
  assert.ok(sheet, 'the score-info sheet did not open');
  await flush();
  assert.ok(sheet.contains(dom.document.activeElement),
    'focus stayed on the opener behind the aria-modal backdrop (A1)');
  assert.equal(dom.document.activeElement, sheet.querySelector('.sheet__close'),
    'a sheet takes focus on its first focusable control');

  // The restore target is still the opener — the fallback runs AFTER trapFocus
  // captured it, or closing would "restore" focus into the sheet being removed.
  escape(dom);
  assert.equal(dom.document.querySelector('.sheet'), null, 'Escape did not close the sheet');
  assert.equal(dom.document.activeElement, btn, 'closing did not return focus to the opener');
  await settle(dom);
});

test('a sheet that focuses its own input keeps it — synchronously, inside the gesture', async (t) => {
  const dom = boot(t);
  opener(dom);
  // Below 860px: the editor is a sheet (jsdom has no layout, so stub the query).
  dom.run('window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });');
  const visited = [];
  dom.document.addEventListener('focusin', (e) => { if (e.target.closest('.sheet')) visited.push(e.target.className); });
  dom.run(`openEditor(document.querySelector('.probe-opener'), 'tags', 'Tags', (el) => {
    el.innerHTML = '<button class="first">x</button><input class="field">';
    return () => el.querySelector('.field').focus();
  })`);
  // Before ANY turn has passed: the caller's focus is synchronous, which is what
  // iOS needs to raise the keyboard. A fallback that ran first, or a fix that
  // deferred the caller, would both fail here.
  assert.equal(dom.document.activeElement.className, 'field', 'the input was not focused synchronously');
  await flush();
  assert.equal(dom.document.activeElement.className, 'field',
    'the deferred fallback overrode the caller\'s input focus');
  // ONE focus move, the caller's: a fallback run synchronously inside openSheet
  // would land on the × first and be overwritten — the same end state, but a
  // screen reader announces the × on its way past, and the deferral is why not.
  assert.deepEqual(visited, ['field'], 'focus visited another control inside the sheet before the input');
  escape(dom);
  await settle(dom);
});

test('a sheet replaced before the fallback runs leaves focus to its replacement', async (t) => {
  const dom = boot(t);
  opener(dom);
  dom.call('openInfoSheet', 'score');
  // Same task: openSheet tears the first sheet down and opens the second.
  dom.call('openInfoSheet', 'score');
  const sheets = dom.document.querySelectorAll('.sheet');
  assert.equal(sheets.length, 1, 'the replace path left two sheets up');
  await flush();
  assert.ok(sheets[0].contains(dom.document.activeElement), 'focus did not land in the sheet that is actually open');
  escape(dom);
  await settle(dom);
});
