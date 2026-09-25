'use strict';

/* toast()'s tone, sticky errors and action slot (#1261).

   T15b draws three tones, errors that stay until dismissed and an optional
   action; until #1261 toast() took a bare string and painted every one of them
   neutral. These specs run the REAL live-region.js in jsdom (test/support/dom.js)
   and assert the DOM it leaves behind: which of the two permanent live regions
   speaks, what the box carries, and whether a timer was armed.

   jsdom's timers are the window's own, which node:test's mock.timers does not
   reach, so `setTimeout` is replaced on the window with a recorder — the script
   resolves the global at call time, so the recorder is what toast() arms. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./support/dom');
const { bodyOf } = require('./support/css');

function boot(t) {
  const dom = loadApp({ locale: 'en' });
  t.after(() => dom.close());
  const timers = [];
  dom.window.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  dom.window.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; };
  const $ = (sel) => dom.document.querySelector(sel);
  const box = $('#toast');
  const state = () => ({
    on: box.classList.contains('is-on'),
    tone: [...box.classList].filter((c) => c.startsWith('toast--')),
    status: $('#toastStatus').textContent,
    alert: $('#toastAlert').textContent,
    icon: box.querySelector('.toast__icon') && box.querySelector('.toast__icon').className,
    buttons: [...box.querySelectorAll('button')].map((b) => b.className),
  });
  const live = () => timers.filter((x) => !x.cleared);
  return { dom, box, $, state, timers, live };
}

test('the markup holds two permanent live regions: a status and an alert, and no third around them', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const box = /<div id="toast" class="toast">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(box, '#toast is missing, or it carries attributes again (a live region AROUND the two would nest them)');
  assert.match(box[1], /id="toastStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(box[1], /id="toastAlert"[^>]*role="alert"[^>]*aria-live="assertive"/);
});

test('a bare string is exactly what it always was: neutral, a status, no controls, gone after 2.2 s', (t) => {
  const { dom, state, live } = boot(t);
  dom.call('toast', 'Saved');
  assert.deepEqual(state(), { on: true, tone: [], status: 'Saved', alert: '', icon: null, buttons: [] });
  assert.deepEqual(live().map((x) => x.ms), [2200]);
  live()[0].fn();
  assert.deepEqual(state(), { on: false, tone: [], status: '', alert: '', icon: null, buttons: [] });
});

test('an error speaks as an alert, carries a glyph and a dismiss button, and arms NO timer', (t) => {
  const { dom, box, state, live } = boot(t);
  dom.call('toast', 'Network down', { tone: 'error' });
  assert.deepEqual(state(), {
    on: true, tone: ['toast--error'], status: '', alert: 'Network down',
    icon: 'ti ti-alert-triangle toast__icon', buttons: ['toast__close'],
  });
  assert.equal(box.querySelector('.toast__icon').getAttribute('aria-hidden'), 'true');
  const close = box.querySelector('.toast__close');
  assert.equal(close.getAttribute('aria-label'), dom.run("t('toast.dismiss')"));
  assert.equal(close.type, 'button');
  assert.deepEqual(live(), [], 'an error must stay until it is dismissed');
  close.click();
  assert.deepEqual(state(), { on: false, tone: [], status: '', alert: '', icon: null, buttons: [] });
});

test('success is a status with its own glyph and tone, and still auto-dismisses', (t) => {
  const { dom, state, live } = boot(t);
  dom.call('toast', 'In the shelf', { tone: 'success' });
  assert.deepEqual(state(), {
    on: true, tone: ['toast--success'], status: 'In the shelf', alert: '',
    icon: 'ti ti-check toast__icon', buttons: [],
  });
  assert.deepEqual(live().map((x) => x.ms), [2200]);
});

test('an unknown tone falls back to neutral rather than painting a class nothing styles', (t) => {
  const { dom, state } = boot(t);
  dom.call('toast', 'Hm', { tone: 'warning' });
  assert.deepEqual(state().tone, []);
  assert.equal(state().status, 'Hm');
});

test('sticky can be set either way, independently of the tone', (t) => {
  const { dom, state, live } = boot(t);
  dom.call('toast', 'Stays', { sticky: true });
  assert.deepEqual(state().buttons, ['toast__close']);
  assert.deepEqual(live(), []);
  dom.call('toast', 'Goes', { tone: 'error', sticky: false });
  assert.deepEqual(state().buttons, []);
  assert.equal(state().alert, 'Goes', 'a non-sticky error is still an alert');
  assert.deepEqual(live().map((x) => x.ms), [2200]);
});

test('an action is one labelled button that runs once, closes the toast and lingers 8 s', (t) => {
  const { dom, box, state, live } = boot(t);
  let runs = 0;
  dom.call('toast', 'Retired', { tone: 'success', action: { label: 'Undo', run: () => { runs += 1; } } });
  const btn = box.querySelector('.toast__action');
  assert.equal(btn.textContent, 'Undo');
  assert.equal(btn.type, 'button');
  assert.deepEqual(live().map((x) => x.ms), [8000]);
  btn.click();
  assert.equal(runs, 1);
  assert.equal(state().on, false);
});

test('an action without a label or a function is ignored, not rendered as a dead button', (t) => {
  const { dom, state } = boot(t);
  dom.call('toast', 'x', { action: { label: 'Undo' } });
  assert.deepEqual(state().buttons, []);
  dom.call('toast', 'y', { action: { run: () => {} } });
  assert.deepEqual(state().buttons, []);
});

test('still one toast at a time: a new one replaces the old tone, text, controls and timer', (t) => {
  const { dom, state, live } = boot(t);
  dom.call('toast', 'Failed', { tone: 'error', action: { label: 'Retry', run: () => {} } });
  dom.call('toast', 'First', { tone: 'success' });
  dom.call('toast', 'Second');
  assert.deepEqual(state(), { on: true, tone: [], status: 'Second', alert: '', icon: null, buttons: [] });
  assert.equal(live().length, 1, 'the replaced toast\'s timer must be cleared, or it hides the new one early');
});

test('dismissing with the keyboard hands focus back to where it was', (t) => {
  const { dom, box, $ } = boot(t);
  const origin = dom.document.createElement('button');
  $('#app').appendChild(origin);
  origin.focus();
  dom.call('toast', 'Nope', { tone: 'error' });
  const close = box.querySelector('.toast__close');
  close.focus();
  close.click();
  assert.equal(dom.document.activeElement, origin);
});

test('the box hides by opacity, so its live regions never leave the accessibility tree', () => {
  const rest = bodyOf('.toast');
  assert.doesNotMatch(rest, /display:\s*none/, 'display: none takes the live regions out of the tree (#145)');
  assert.match(rest, /opacity:\s*0/);
  assert.match(rest, /pointer-events:\s*none/, 'an invisible toast must not swallow clicks on what is under it');
  assert.match(bodyOf('.toast.is-on'), /opacity:\s*1/);
});

test('the dismiss and action controls are 24 px targets (WCAG 2.2 SC 2.5.8)', () => {
  const both = bodyOf('.toast__action,\n.toast__close');
  assert.ok(both, 'the shared rule for the two toast buttons is gone');
  assert.match(both, /min-height:\s*24px/);
  assert.match(both, /min-width:\s*24px/);
});
