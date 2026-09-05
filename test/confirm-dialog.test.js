'use strict';

/* The themed confirmation dialog (issue #939) — the replacement for the
   browser's own confirm(). Driven under jsdom rather than matched as source
   text (.claude/rules/testing-views-under-jsdom.md): what can actually go wrong
   here is a listener on the wrong button, a promise that never settles, or
   focus landing on the destructive action — none of which a regex can see. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./support/dom');

const JS_DIR = path.join(__dirname, '..', 'public', 'js');

/* Every spec that awaits the dialog's promise carries a deadline. The
   regression these guard against — openSheet's onClose hook going missing, so
   a Back-dismissed dialog never settles — presents as a promise that never
   resolves, and node --test waits on that forever: measured, the suite hangs
   instead of going red, which is the one failure mode CI cannot report. */
const PROMISE_SETTLES = { timeout: 5000 };

// Open a dialog and hand back the promise plus the live sheet element. The
// promise is deliberately NOT awaited here: every spec below settles it through
// the DOM, which is the whole point.
function openDialog(app, opts) {
  const promise = app.call('confirmDialog', opts || { body: 'Wirklich?' });
  const sheet = app.document.querySelector('.sheet');
  assert.ok(sheet, 'the dialog rendered a sheet');
  return { promise, sheet };
}

const btn = (sheet, act) => sheet.querySelector(`[data-act="${act}"]`);

test('the confirm button resolves true', PROMISE_SETTLES, async () => {
  const app = loadApp();
  const { promise, sheet } = openDialog(app);
  btn(sheet, 'ok').click();
  assert.equal(await promise, true);
  assert.equal(app.document.querySelector('.sheet'), null, 'and the sheet is gone');
  app.close();
});

test('the cancel button resolves false', PROMISE_SETTLES, async () => {
  const app = loadApp();
  const { promise, sheet } = openDialog(app);
  btn(sheet, 'cancel').click();
  assert.equal(await promise, false);
  app.close();
});

test('Escape resolves false', PROMISE_SETTLES, async () => {
  const app = loadApp();
  const { promise } = openDialog(app);
  app.document.dispatchEvent(new app.window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  }));
  assert.equal(await promise, false);
  app.close();
});

test('a backdrop press resolves false', PROMISE_SETTLES, async () => {
  const app = loadApp();
  const { promise } = openDialog(app);
  const backdrop = app.document.querySelector('.sheet-backdrop');
  backdrop.dispatchEvent(new app.window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(await promise, false);
  app.close();
});

test('the × button resolves false', PROMISE_SETTLES, async () => {
  const app = loadApp();
  const { promise, sheet } = openDialog(app);
  sheet.querySelector('.sheet__close').click();
  assert.equal(await promise, false);
  app.close();
});

/* Browser Back. The dialog pushes a history marker through openSheet, so a pop
   lands in handleSheetPop — the ONE dismissal path that runs no closeSheet
   callback, which is why the promise is settled from openSheet's onClose hook
   rather than from the button handlers alone. */
test('browser Back resolves false', PROMISE_SETTLES, async () => {
  const app = loadApp();
  const { promise } = openDialog(app);
  app.window.history.back();
  assert.equal(await promise, false);
  assert.equal(app.document.querySelector('.sheet'), null);
  app.close();
});

test('a destructive dialog marks its confirm button, a plain one does not', () => {
  const app = loadApp();
  const danger = openDialog(app, { body: 'weg?' });
  assert.ok(btn(danger.sheet, 'ok').classList.contains('btn--danger'));
  assert.ok(!btn(danger.sheet, 'ok').classList.contains('btn--primary'));
  danger.promise.catch(() => {});
  btn(danger.sheet, 'cancel').click();

  const plain = openDialog(app, { body: 'ok?', danger: false });
  assert.ok(btn(plain.sheet, 'ok').classList.contains('btn--primary'));
  assert.ok(!btn(plain.sheet, 'ok').classList.contains('btn--danger'));
  plain.promise.catch(() => {});
  app.close();
});

test('focus opens on cancel, never on the destructive action', () => {
  const app = loadApp();
  const { sheet, promise } = openDialog(app);
  assert.equal(app.document.activeElement, btn(sheet, 'cancel'),
    'a stray Enter on a dialog that appeared under the user\'s hands must not delete anything');
  promise.catch(() => {});
  app.close();
});

test('the real verb reaches the button and the question reaches the body', () => {
  const app = loadApp();
  const { sheet, promise } = openDialog(app, {
    body: 'Runde löschen?', confirmLabel: 'Endgültig löschen', title: 'Sicher?',
  });
  assert.match(btn(sheet, 'ok').textContent, /Endgültig löschen/);
  assert.equal(sheet.querySelector('.confirm-dialog__body').textContent, 'Runde löschen?');
  assert.match(sheet.querySelector('.sheet__head h2').textContent, /Sicher\?/);
  assert.equal(sheet.getAttribute('role'), 'alertdialog');
  promise.catch(() => {});
  app.close();
});

/* The guard that the conversion stays converted.

   Scanned over source with comments STRIPPED, not over raw text: this module's
   own header quotes `confirm()` and spells out the `if (!confirm(msg)) return;`
   it replaces, and views-session.js's hold-out comment names it too — so a raw
   text scan flags the very places that document the rule and can only be made
   green by weakening it (.claude/rules/source-scanning-guards-enumerate-shapes.md).

   The pattern allows any call shape, since the sites vary — `!confirm(t(…))`,
   `&& !confirm(…)`, `n > 0 && !confirm(…)` — and the leading boundary is what
   keeps `confirmDialog(` and a property `.confirm(` out. */
function stripComments(src) {
  let out = '';
  let i = 0;
  let mode = 'code'; // code | line | block | quote
  let quote = '';
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && next === '*') { mode = 'block'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { mode = 'quote'; quote = c; }
      out += c; i += 1; continue;
    }
    if (mode === 'quote') {
      if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === quote) mode = 'code';
      out += c; i += 1; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; }
      i += 1; continue;
    }
    // block
    if (c === '*' && next === '/') { mode = 'code'; i += 2; continue; }
    if (c === '\n') out += c;
    i += 1;
  }
  return out;
}

test('stripComments keeps code and drops both comment forms', () => {
  assert.match(stripComments('a; // confirm(x)\nb;'), /^a; \nb;$/);
  assert.match(stripComments('/* confirm(x) */ a;'), /a;/);
  assert.equal(/confirm\(/.test(stripComments('/* if (!confirm(m)) return; */')), false);
  // A quoted "//" must not swallow the rest of the line.
  assert.ok(/confirm\(/.test(stripComments("u = 'https://x'; confirm(m);")));
});

test('no frontend file calls the native confirm(), bar the documented hold-out', () => {
  const files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 40, 'the file list resolved');
  const bad = new RegExp(String.raw`(^|[^A-Za-z0-9_$.])confirm\s*\(`, 'g');
  const hits = [];
  for (const f of files) {
    const code = stripComments(fs.readFileSync(path.join(JS_DIR, f), 'utf8'));
    const n = (code.match(bad) || []).length;
    if (n) hits.push(`${f}:${n}`);
  }
  // views-session.js keeps exactly ONE: vote.leaveConfirm, read by the
  // synchronous confirmLeave() router guard (#939 §4).
  assert.deepEqual(hits, ['views-session.js:1']);
});

test('no frontend file calls prompt() as a dialog', () => {
  const files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js'));
  const bad = new RegExp(String.raw`(^|[^A-Za-z0-9_$.])prompt\s*\(`, 'g');
  const hits = [];
  for (const f of files) {
    const code = stripComments(fs.readFileSync(path.join(JS_DIR, f), 'utf8'));
    if ((code.match(bad) || []).length) hits.push(f);
  }
  assert.deepEqual(hits, [], 'the lobby share fallback is a themed sheet now');
});
