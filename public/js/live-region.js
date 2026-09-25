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
const toastStatusEl = document.getElementById('toastStatus');
const toastAlertEl = document.getElementById('toastAlert');
const srLiveEl = document.getElementById('srLive');

/* Toasts carry confirmations AND errors, so they must reach a screen reader
   (#145). The two live regions inside #toast are declared in index.html and
   stay in the accessibility tree permanently: a live region that is inserted
   (or un-`hidden`, or un-`display: none`d) with its text already in place is
   NOT announced. So the box is hidden by OPACITY (styles.css), the empty
   regions stay rendered, and only their text changes — exactly the mutation
   aria-live listens for.

   Tone (#1261), from T15b's anatomy: 'neutral' (the default — a bare
   `toast(msg)` is exactly what it always was), 'success' or 'error'. An error
   is spoken through the `role="alert"` region and STAYS until it is dismissed
   (a >= 24px ×), because a failure that vanishes after two seconds is one the
   user may never have read; everything else is `role="status"` and auto-
   dismisses. Two fixed regions rather than one whose role is swapped: a role
   changed at runtime is exactly the kind of live-region mutation screen
   readers are inconsistent about.

   `action: { label, run }` adds one text button (T15b's „Rückgängig") — purely
   additive: it never replaces a confirmation (operator decision, #1195). A
   toast with an action lingers longer (T15b: 8 s), since two seconds is not
   enough to reach a button. Still ONE toast at a time: a new one replaces the
   old one, its tone, its buttons and its timer. */
const TOAST_TONES = ['neutral', 'success', 'error'];
// A tone is never colour alone (WCAG 1.4.1): each non-neutral one has a glyph.
const TOAST_ICONS = { success: 'ti-check', error: 'ti-alert-triangle' };
const TOAST_MS = 2200;
const TOAST_ACTION_MS = 8000;
let toastTimer;
// Where focus was when the toast appeared, so dismissing it with the keyboard
// does not drop focus onto <body> when the focused button is removed.
let toastReturnFocus = null;

function toast(msg, opts = {}) {
  const tone = TOAST_TONES.includes(opts.tone) ? opts.tone : 'neutral';
  const action = opts.action && opts.action.label && typeof opts.action.run === 'function'
    ? opts.action : null;
  const sticky = opts.sticky === undefined ? tone === 'error' : Boolean(opts.sticky);
  clearToast();
  toastReturnFocus = document.activeElement;

  if (TOAST_ICONS[tone]) {
    const icon = document.createElement('i');
    icon.className = `ti ${TOAST_ICONS[tone]} toast__icon`;
    icon.setAttribute('aria-hidden', 'true');
    toastEl.prepend(icon);
  }
  (tone === 'error' ? toastAlertEl : toastStatusEl).textContent = msg;
  if (action) {
    const btn = toastButton('toast__action', action.label);
    btn.addEventListener('click', () => { hideToast(); action.run(); });
  }
  if (sticky) {
    const close = toastButton('toast__close', '');
    close.setAttribute('aria-label', t('toast.dismiss'));
    close.innerHTML = '<i class="ti ti-x" aria-hidden="true"></i>';
    close.addEventListener('click', hideToast);
  }
  if (tone !== 'neutral') toastEl.classList.add(`toast--${tone}`);
  toastEl.classList.add('is-on');
  if (!sticky) toastTimer = setTimeout(clearToast, action ? TOAST_ACTION_MS : TOAST_MS);
}

function toastButton(cls, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = cls;
  btn.textContent = label;
  toastEl.appendChild(btn);
  return btn;
}

/* Empty the toast back to its resting state: no tone, no glyph, no buttons.
   The text is cleared too, so the next identical message is still a change the
   live region reports rather than a no-op mutation. */
function clearToast() {
  clearTimeout(toastTimer);
  toastEl.classList.remove('is-on', 'toast--success', 'toast--error');
  toastStatusEl.textContent = '';
  toastAlertEl.textContent = '';
  for (const el of [...toastEl.children]) {
    if (el !== toastStatusEl && el !== toastAlertEl) el.remove();
  }
}

// A dismissal the user asked for (the × or the action), as opposed to the timer.
function hideToast() {
  const hadFocus = toastEl.contains(document.activeElement);
  clearToast();
  if (hadFocus && toastReturnFocus && toastReturnFocus.isConnected) toastReturnFocus.focus();
  toastReturnFocus = null;
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
