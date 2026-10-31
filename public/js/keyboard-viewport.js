/* Spielwirbel – keep an open sheet inside the part of the screen the keyboard
   leaves visible (issue #1752).

   Why it exists: WebKit (iOS Safari and the installed PWA) does not shrink the
   layout viewport when the on-screen keyboard opens, and `dvh` does not track
   it either. So `.sheet-backdrop` — `position: fixed; inset: 0`, docking the
   sheet to its bottom edge — stays full height behind the keyboard, and WebKit
   pans the VISUAL viewport up to reveal the focused input. That pan moves the
   sheet's head, with the autofocused field in it, off the top of the screen;
   with the page locked behind the sheet (page-lock.js) and `.sheet` already at
   scrollTop 0, no drag can bring it back.

   The fix: while a sheet is open, pin the backdrop to `window.visualViewport` —
   its top at the pan offset, its height the visible height. The sheet then
   docks just above the keyboard, and `.sheet`'s `max-height: …100%` (of the
   backdrop) makes it give way in the space that is left, staying the scroll
   container (.claude/rules/lookup-menu-fixed-position.md).

   Where the keyboard resizes the layout viewport, or there is none (desktop),
   the visual viewport equals the layout viewport and this is a no-op: the
   inline styles stay empty and the CSS geometry stands. A pinch zoom is ignored
   on purpose — chasing it would drag the sheet around under the user's fingers.

   Its own small file so the arithmetic is unit-testable and counts for coverage
   (.claude/rules/frontend-helper-modules-and-coverage.md). openSheet/teardownSheet
   in sheet.js are its only callers. */

'use strict';

/* The visible band to pin the backdrop to, in layout-viewport px — or null when
   it would change nothing (no keyboard, no pan) or must not apply (pinch zoom, a
   degenerate or missing viewport). `layoutHeight` is the layout viewport's
   height (`documentElement.clientHeight`), which the iOS keyboard leaves alone. */
function visibleBand(vv, layoutHeight) {
  if (!vv || !(vv.height > 0)) return null;
  if (Math.abs((vv.scale || 1) - 1) > 0.01) return null;
  const top = Math.max(0, vv.offsetTop || 0);
  if (top < 1 && Math.abs(layoutHeight - vv.height) < 1) return null;
  return { top, height: vv.height };
}

/* Keep `el` (a sheet backdrop) on the visible band until the returned release
   is called. Applies once immediately: a sheet replacing another one opens with
   the keyboard already up. `win` is injectable for the spec. */
function followVisualViewport(el, win) {
  const w = win || window;
  const vv = w.visualViewport;
  if (!vv || !el) return () => {};
  const apply = () => {
    const band = visibleBand(vv, w.document.documentElement.clientHeight);
    const s = el.style;
    if (!band) {
      s.top = '';
      s.bottom = '';
      s.height = '';
      return;
    }
    s.top = `${band.top}px`;
    s.bottom = 'auto';
    s.height = `${band.height}px`;
  };
  apply();
  // WebKit fires `resize` as the keyboard opens/closes and `scroll` as it pans.
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  return () => {
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { visibleBand, followVisualViewport };
}
