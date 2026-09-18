/* Spielwirbel – the app's two aria-live regions (#1168).

   Both say something to a screen reader; they differ in whether anyone else is
   told. `toast()` is the visible one — confirmations and errors. `announce()`
   is silent, for a change a sighted user simply watches happen (the vote card
   advancing, #1168) and a reader would otherwise get no word of.

   Its own file because BOTH regions obey the same non-obvious rule and it is
   the rule that gets broken: the element must sit in the accessibility tree
   PERMANENTLY. A live region that is inserted — or un-`hidden` — with its text
   already in place is not announced at all, so visibility is a class and the
   markup lives in index.html rather than being built on demand. Keeping the two
   apart would mean learning that twice.

   Split out of core.js by #1168, which pushed it over its 700-line budget —
   #956 had brought it back under and this is a real seam rather than a
   re-recording (.claude/rules/token-friendly-source-files.md).
   Load order: see index.html — before core.js and everything that reports. */

'use strict';

const toastEl = document.getElementById('toast');
const srLiveEl = document.getElementById('srLive');

// Toasts carry confirmations AND errors, so they must reach a screen reader
// (#145). The element is an aria-live region declared in index.html, and it must
// stay in the accessibility tree permanently for that to work: a live region
// that is inserted (or un-`hidden`) with its text already in place is NOT
// announced. So visibility is a class, never the `hidden` attribute — the empty
// region sits in the tree and only its text content changes, which is exactly
// the mutation aria-live listens for.
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('is-on');
    // Clear the text too, so the next identical message is still a change the
    // live region reports rather than a no-op mutation.
    toastEl.textContent = '';
  }, 2200);
}

/* The silent sibling (#1168): say something to a screen reader that nobody else
   needs to be told. The vote card's advance is the first caller — a sighted
   voter watches the card change, and a reader otherwise gets only a focus move,
   with no "which game is this, and how many are left".

   Same two rules as the toast, for the same reason: the region is permanent,
   and the text is cleared afterwards so repeating the same sentence is still a
   mutation rather than a no-op. */
let announceTimer;
function announce(msg) {
  srLiveEl.textContent = msg;
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { srLiveEl.textContent = ''; }, 2200);
}
