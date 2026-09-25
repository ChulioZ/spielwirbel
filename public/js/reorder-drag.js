/* Spielwirbel – drag a tile into place (#1180).

   The app's first drag gesture, and deliberately its only one: a round's tags
   are the one list with a stored order (#1159). The arrows #1159 shipped stay —
   they are the WCAG 2.2 SC 2.5.7 single-pointer alternative and the keyboard
   path — so dragging is a pure enhancement on top of machinery that exists.

   The mechanics are SortableJS, vendored as `vendor/sortable.min.js` (a
   byte-identical copy of `node_modules/sortablejs/Sortable.min.js`, which
   `test/reorder-drag.test.js` asserts). This file owns the ONE place that
   names it, so the options below are chosen once rather than per caller.

   Load order: after vendor/sortable.min.js, before any view that reorders.
   Nothing here touches `Sortable` at load time, so the order only matters at
   call time — but keep it anyway (.claude/rules/frontend-script-load-order.md). */

/* global Sortable */

'use strict';

/* Sortable's options, built apart from the create() call so a spec can assert
   the choices without a layout engine. Each one is load-bearing:

   - `draggable` — only the item class drags. An open inline editor (the tag
     pencil's `.tag-edit`) is inserted INTO the same list after its row, and
     would otherwise count as a sortable item and shift every index.
   - `filter` + `preventOnFilter: false` — a press on a control inside the tile
     must stay that control's click. `false` is what leaves the click intact;
     the default cancels it.
   - `delay` on touch only — the whole tile is the grab target, so on a phone a
     bare drag would eat page scrolling. A short hold separates the two, and a
     scroll during the hold cancels the drag. A mouse drags at once.
   - `forceFallback` — Sortable's own pointer-driven clone instead of the HTML5
     drag-and-drop API, whose ghost is an unstyleable OS image that differs per
     engine. This way Chromium and WebKit run the SAME code path
     (.claude/rules/browser-pane-is-chromium-only.md).
   - `animation` — the neighbours sliding aside is watched motion, so it stays,
     except under `prefers-reduced-motion: reduce`, where it is 0. */
function reorderOptions({ itemSelector, filterSelector, reducedMotion }) {
  return {
    draggable: itemSelector,
    filter: filterSelector,
    preventOnFilter: false,
    delay: 200,
    delayOnTouchOnly: true,
    forceFallback: true,
    animation: reducedMotion ? 0 : 150,
    ghostClass: 'is-drag-ghost',
    chosenClass: 'is-drag-chosen',
    dragClass: 'is-drag-lift',
  };
}

/* Translate Sortable's `onEnd` event into one `onMove(from, to)` call, or none.

   The DRAGGABLE indices, not `oldIndex`/`newIndex`: those count every child of
   the list, so a stray non-item child would offset them. A drop back where it
   started, or one Sortable could not place (an index missing), is no move at
   all — and must not cost a PATCH. */
function reorderDrop(evt, onMove) {
  const from = evt && evt.oldDraggableIndex;
  const to = evt && evt.newDraggableIndex;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return false;
  onMove(from, to);
  return true;
}

/* Make `listEl`'s items draggable. `onMove(from, to)` fires once per real
   drop, AFTER Sortable has already moved the DOM node — so a caller updates its
   model and saves, but must not move the node itself. `onStart` runs when a
   drag begins (the tag screen closes an open editor there).

   Returns the Sortable instance, or null when the library is missing: dragging
   is an enhancement, and a failed vendor load must leave the arrows working
   rather than throw out of the view that called this. */
function makeReorderable(listEl, { onMove, onStart, itemSelector, filterSelector }) {
  if (typeof Sortable === 'undefined' || !listEl) return null;
  let reducedMotion = false;
  try { reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
  return Sortable.create(listEl, {
    ...reorderOptions({ itemSelector, filterSelector, reducedMotion }),
    onStart: () => { if (onStart) onStart(); },
    onEnd: (evt) => { reorderDrop(evt, onMove); },
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { reorderOptions, reorderDrop, makeReorderable };
}
