/* Spielwirbel – focus containment for modal sheets (issue #145).

   Its own small, dependency-free file so the test suite can require it — see
   .claude/rules/frontend-helper-modules-and-coverage.md (exporting it from a
   view file would drag that file's unreachable DOM code into the coverage
   report and sink the 90% gate).

   Why it exists: every sheet is `role="dialog" aria-modal="true"`, which
   constrains a *screen reader* — but nothing constrained the *keyboard*. With a
   sheet open, Tab walked straight out of it into the page behind the backdrop,
   focusing controls the user cannot see. And closing a sheet dropped focus to
   <body>, so a keyboard user restarted from the top of the document every time. */

'use strict';

// Elements that can hold focus. `:not([tabindex="-1"])` keeps out the honeypot
// input and anything deliberately taken out of the tab order.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Visible, focusable descendants of `root`, in DOM order — which is tab order
// here, since nothing in the app sets a positive tabindex.
function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => {
    // `tabindex="-1"` is only spelled out in the LAST selector above, so a
    // native control carrying it (a button, an input) still matches one of the
    // element selectors and would be counted. It must not be: the trap's first/
    // last elements decide where Tab wraps, and the browser never stops on a
    // -1 element — so an out-of-order edge lets one Tab escape the sheet. The
    // lookup menu's options are exactly this shape (#542).
    if (el.getAttribute && el.getAttribute('tabindex') === '-1') return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    // offsetParent is null for display:none subtrees; position:fixed elements
    // report null too, hence the rect fallback (the lookup menu is fixed).
    if (el.offsetParent !== null) return true;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  });
}

/* Contain Tab within `container` until the returned release() is called.
   Restores focus to whatever was focused at trap time — normally the control
   that opened the sheet — so closing returns the user where they were.

   The handler runs on the CAPTURE phase so it wins over anything inside the
   sheet, and it only ever acts on Tab: every other key, including the Escape
   the sheets already handle, passes through untouched. */
function trapFocus(container) {
  const restoreTo = document.activeElement;
  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const items = focusables(container);
    if (!items.length) {
      // Nothing to focus inside: keep focus on the dialog rather than letting
      // Tab escape to the page behind the backdrop.
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    // Focus outside the container (or on the container itself) means the
    // browser is about to leave it — pull it back to the correct edge.
    const active = document.activeElement;
    if (!container.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKey, true);

  return function release() {
    document.removeEventListener('keydown', onKey, true);
    // Only restore if the element is still in the document and still focusable;
    // a sheet that replaced the view underneath it has no opener to go back to.
    if (restoreTo && document.contains(restoreTo) && typeof restoreTo.focus === 'function') {
      restoreTo.focus();
    }
  };
}

/* Move focus INTO an overlay that has just opened, unless its caller already
   did (audit 2026-10-04 A1, WCAG 2.4.3). trapFocus above only acts on a Tab, so
   a popover — appended to the END of <body> — or a sheet with no input of its
   own opened with focus still on the page behind it: the next Tab walked the
   page, and an aria-modal sheet left focus on a control it says is not there.

   Called by openPopover (after the caller's `attached()`) and openSheet (one
   microtask later, after the caller's synchronous code) — never before
   trapFocus, which captures `document.activeElement` as the restore target.

   It ASKS each candidate rather than predicting from layout the way
   focusables() does: a browser refuses focus() on a control that is not
   rendered, so trying in DOM order is right for display:none and
   visibility:hidden alike, and runs the same path in jsdom (no layout).
   `preventScroll`, because a popover tears itself down on a page scroll.
   With nothing inside able to hold focus, the dialog `box` itself takes it. */
function focusInto(container, box) {
  const active = document.activeElement;
  if (active && container.contains(active)) return active;
  for (const el of container.querySelectorAll(FOCUSABLE)) {
    if (el.getAttribute('tabindex') === '-1' || el.closest('[aria-hidden="true"]')) continue;
    el.focus({ preventScroll: true });
    if (document.activeElement === el) return el;
  }
  const target = box || container;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  return document.activeElement === target ? target : null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { trapFocus, focusables, focusInto, FOCUSABLE };
}
