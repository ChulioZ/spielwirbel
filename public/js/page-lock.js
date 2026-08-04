/* Spielwirbel – freeze the page behind an open overlay (issue #622).

   Why it exists: nothing locked the page while a sheet was up. `.sheet-backdrop`
   is `position: fixed; inset: 0` but is not a scroll container, and `.sheet` is
   capped at `min(85vh, 660px)` — so there is always exposed backdrop, and a drag
   there went straight to the document. Dismissing the sheet then dropped the
   user at a different scroll position than they opened it from. (The other path,
   a scroll continued past a bounded box's own edge, is closed in CSS with
   `overscroll-behavior: contain` — see the scroll containers in styles.css.)

   Its own small, dependency-free file for the same reason focus-trap.js is one:
   it is a cross-cutting concern of the sheet layer rather than part of any
   screen, and views-round-detail.js is already over its line budget
   (.claude/rules/frontend-helper-modules-and-coverage.md,
   .claude/rules/token-friendly-source-files.md). openSheet/teardownSheet are its
   only callers.

   NOT used by openPopover, deliberately: a popover tears itself down on a window
   `scroll` and that teardown is what keeps it from drifting off its anchor. See
   .claude/rules/popover-vs-sheet-editors.md and
   .claude/rules/anchored-popover-is-placed-once.md. */

'use strict';

// `{ y }` while the page is frozen, null otherwise. Also the idempotence guard:
// openSheet REPLACES an already-open sheet, and an unlock/relock pair around
// that replace would restore the offset and re-freeze it — a visible jump every
// time one sheet opens over another.
let pageLock = null;

/* `body { overflow: hidden }` alone is not enough: iOS Safari keeps scrolling
   the document behind it. Taking the body out of flow is what actually freezes
   it, at the cost of having to carry the offset by hand — which is what `top`
   below and the scrollTo in unlockPage() are for. */
function lockPage() {
  if (pageLock || typeof document === 'undefined' || !document.body) return;
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  /* A fixed body leaves the document with no in-flow content, so its height
     collapses and a classic (non-overlay) scrollbar disappears — widening the
     viewport under the page. Reserve exactly the width that went, or every
     sheet open shifts the screen sideways. Zero on a phone, where scrollbars
     are overlays and sheets are used the most. */
  const gutter = window.innerWidth - document.documentElement.clientWidth;
  pageLock = { y };
  const s = document.body.style;
  s.position = 'fixed';
  s.top = `${-y}px`;
  s.left = '0';
  s.right = '0';
  if (gutter > 0) s.paddingRight = `${gutter}px`;
}

function unlockPage() {
  if (!pageLock) return;
  const { y } = pageLock;
  pageLock = null;
  const s = document.body.style;
  s.position = '';
  s.top = '';
  s.left = '';
  s.right = '';
  s.paddingRight = '';
  /* After the styles are gone, never before — the document is not scrollable
     until the body is back in flow. And it has to happen at all: the browser
     keeps no memory of an offset that was removed by taking the body out of it. */
  window.scrollTo(0, y);
}

/* Movement, in CSS px summed over both axes, past which a press-and-release
   counts as a drag rather than a tap. Chrome's own touch slop is ~8px. */
const DRAG_SLOP = 10;

/* Every sheet dismisses on a `mousedown` whose target is the backdrop itself.
   That is safe while the page scrolls under the backdrop, because a browser
   resolves the gesture as a scroll and synthesises no mouse events at all — but
   the lock above removes the scroll, so the same swipe can now come back as a
   tap and dismiss a sheet the user was only trying to move. This guard sits on
   the backdrop in the CAPTURE phase, where `stopPropagation()` keeps the
   element's own bubble-phase dismiss handlers from running.

   Pointer events rather than touch events because they cover both input kinds
   with one lifecycle: `pointerdown` precedes `mousedown` for a real mouse (so a
   mouse press is measured and passed through in the same order), while for
   touch the compatibility `mousedown` arrives only after `pointerup`. The flag
   is therefore set at most one mousedown ahead and cleared on both ends. */
function guardDragDismiss(el) {
  let from = null;
  let dragged = false;
  el.addEventListener('pointerdown', (e) => {
    from = { x: e.clientX, y: e.clientY };
    dragged = false;
  }, true);
  el.addEventListener('pointerup', (e) => {
    dragged = !!from && Math.abs(e.clientX - from.x) + Math.abs(e.clientY - from.y) > DRAG_SLOP;
  }, true);
  el.addEventListener('mousedown', (e) => {
    if (!dragged) return;
    dragged = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lockPage, unlockPage, guardDragDismiss, DRAG_SLOP };
}
