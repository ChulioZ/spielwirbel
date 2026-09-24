'use strict';

/*
 * Drag-to-reorder (#1180): the wrapper around the vendored SortableJS, and the
 * vendoring itself.
 *
 * Two halves, and the second one is the reason this file exists at all.
 *
 * 1. The wrapper's decisions — which options Sortable gets and how a drop is
 *    turned into one `onMove(from, to)`. SortableJS needs real layout, so no
 *    spec here simulates a drag; the gesture is verified in a browser. What CAN
 *    be pinned is everything the wrapper decides, which is also everything a
 *    later edit is likely to break (a dropped `filter` makes every arrow press
 *    start a drag; a dropped `delayOnTouchOnly` makes the whole tile eat page
 *    scrolling on a phone).
 *
 * 2. The vendored copy. `public/js/vendor/sortable.min.js` is committed because
 *    there is no build step in development and `public/` is served statically.
 *    `sortablejs` is ALSO a devDependency, so Dependabot opens a PR on a
 *    release — and that PR would bump node_modules while the file the browser
 *    actually runs stayed frozen, silently. The byte-identity assertion below
 *    is what turns that bump red until someone re-copies the file. It is the
 *    licence for the duplicate (.claude/rules/shared-constants-across-the-stack.md,
 *    "the one duplicate that is fine").
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { reorderOptions, reorderDrop, makeReorderable } = require('../public/js/reorder-drag');

const ROOT = path.join(__dirname, '..');
const VENDORED = path.join(ROOT, 'public', 'js', 'vendor', 'sortable.min.js');
const UPSTREAM = require.resolve('sortablejs/Sortable.min.js');

test('the vendored SortableJS is byte-identical to the devDependency (#1180)', () => {
  const ours = fs.readFileSync(VENDORED);
  const theirs = fs.readFileSync(UPSTREAM);
  assert.ok(theirs.length > 10000, 'node_modules/sortablejs looks empty — is it installed?');
  assert.ok(ours.equals(theirs),
    'public/js/vendor/sortable.min.js differs from node_modules/sortablejs/Sortable.min.js — '
    + 'after a sortablejs bump, re-copy the file (and its LICENSE) and bump CACHE in public/sw.js');
});

test('the vendored licence travels with the file (#1180)', () => {
  const src = fs.readFileSync(VENDORED, 'utf8');
  const { version } = require('sortablejs/package.json');
  assert.match(src.slice(0, 200), new RegExp(`^/\\*! Sortable ${version.replace(/\./g, '\\.')} - MIT`),
    'the /*! … MIT */ banner is what esbuild keeps through the production build');
  const lic = fs.readFileSync(path.join(ROOT, 'public', 'js', 'vendor', 'sortable.LICENSE.txt'));
  assert.ok(lic.equals(fs.readFileSync(path.join(path.dirname(UPSTREAM), 'LICENSE'))),
    'sortable.LICENSE.txt must be the package\'s own LICENSE — MIT requires the notice with every copy');
});

test('the production build keeps the licence banner on the hashed copy (#1180)', () => {
  const { build } = require('../scripts/build');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-build-sortable-'));
  try {
    const { manifest } = build({ outDir: out });
    const hashed = manifest['/js/vendor/sortable.min.js'];
    assert.ok(hashed, 'build.js did not pick up js/vendor/** — the file would ship un-hashed');
    assert.match(hashed, /^\/js\/vendor\/sortable\.min\.[0-9a-f]{8}\.js$/);
    const built = fs.readFileSync(path.join(out, hashed.slice(1)), 'utf8');
    assert.match(built, /\/\*! Sortable [\d.]+ - MIT/, 'esbuild dropped the licence banner');
    assert.ok(fs.existsSync(path.join(out, 'js', 'vendor', 'sortable.LICENSE.txt')),
      'the LICENSE file is copied through beside it');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('the options keep controls clickable and phone scrolling alive (#1180)', () => {
  const o = reorderOptions({ itemSelector: '.tag-row', filterSelector: '.tag-act', reducedMotion: false });
  assert.equal(o.draggable, '.tag-row', 'only tiles drag — an open .tag-edit editor is in the same list');
  assert.equal(o.filter, '.tag-act', 'a press on an arrow/pencil/trash must not start a drag');
  assert.equal(o.preventOnFilter, false, 'and must keep its own click — the default cancels it');
  assert.equal(o.delay, 200, 'a short hold separates a drag from a scroll on touch');
  assert.equal(o.delayOnTouchOnly, true, 'but a mouse drags at once');
  assert.equal(o.forceFallback, true, 'one code path in every engine — no HTML5 DnD ghost');
  assert.equal(o.animation, 150);
  assert.deepEqual([o.ghostClass, o.chosenClass, o.dragClass], ['is-drag-ghost', 'is-drag-chosen', 'is-drag-lift'],
    'the class names styles.css styles');
});

test('reduced motion drops the neighbours\' slide, nothing else (#1180)', () => {
  const calm = reorderOptions({ itemSelector: '.x', filterSelector: '.y', reducedMotion: true });
  const busy = reorderOptions({ itemSelector: '.x', filterSelector: '.y', reducedMotion: false });
  assert.equal(calm.animation, 0);
  assert.deepEqual({ ...calm, animation: 150 }, busy);
});

test('a drop becomes ONE onMove(from, to), in draggable indices (#1180)', () => {
  const calls = [];
  const onMove = (from, to) => calls.push([from, to]);
  assert.equal(reorderDrop({ oldIndex: 5, newIndex: 1, oldDraggableIndex: 4, newDraggableIndex: 0 }, onMove), true);
  assert.deepEqual(calls, [[4, 0]], 'the draggable indices, not the raw child indices');
});

test('a drop that goes nowhere costs no PATCH (#1180)', () => {
  const calls = [];
  const onMove = (from, to) => calls.push([from, to]);
  assert.equal(reorderDrop({ oldDraggableIndex: 2, newDraggableIndex: 2 }, onMove), false, 'dropped where it started');
  assert.equal(reorderDrop({ oldDraggableIndex: 2 }, onMove), false, 'no target index');
  assert.equal(reorderDrop({ oldDraggableIndex: undefined, newDraggableIndex: 1 }, onMove), false, 'no source index');
  assert.equal(reorderDrop(null, onMove), false);
  assert.deepEqual(calls, []);
});

test('makeReorderable is a no-op without the library, so the arrows survive a failed load (#1180)', () => {
  assert.equal(typeof globalThis.Sortable, 'undefined');
  assert.equal(makeReorderable({}, { onMove() {} }), null);
});

test('makeReorderable hands Sortable the options and routes its events (#1180)', (t) => {
  const seen = {};
  globalThis.Sortable = { create: (el, opts) => { seen.el = el; seen.opts = opts; return 'instance'; } };
  t.after(() => { delete globalThis.Sortable; });
  const list = { id: 'list' };
  const moves = [];
  let started = 0;
  const inst = makeReorderable(list, {
    itemSelector: '.tag-row', filterSelector: '.tag-act',
    onStart: () => { started += 1; }, onMove: (a, b) => moves.push([a, b]),
  });
  assert.equal(inst, 'instance');
  assert.equal(seen.el, list);
  assert.equal(seen.opts.draggable, '.tag-row');
  assert.equal(seen.opts.forceFallback, true);
  seen.opts.onStart();
  seen.opts.onEnd({ oldDraggableIndex: 0, newDraggableIndex: 2 });
  seen.opts.onEnd({ oldDraggableIndex: 1, newDraggableIndex: 1 });
  assert.equal(started, 1);
  assert.deepEqual(moves, [[0, 2]]);
  assert.equal(makeReorderable(null, { onMove() {} }), null, 'no list, no instance');
});
