'use strict';

/* The bottom sheet — the app's modal overlay primitive — and `openEditor`, the
   one policy built directly on top of it.

   Split out of views-round-detail.js by #956, and this one is an OWNERSHIP fix
   rather than a size one: `openSheet` is called from ELEVEN other files,
   `closeSheet` from ten, `handleSheetPop` from router.js and `teardownSheet`
   from page-lock.js — so the app's whole overlay layer was living inside one
   screen's view file, which is the last place anyone would look for it. It
   belongs beside focus-trap.js and page-lock.js, the two primitives it composes,
   and loads with them.

   `openEditor` comes along rather than getting its own file because the SHEET is
   its reason for existing: an anchored popover cannot hold a text input on a
   phone (#422), so the whole function is "below 860px, be a sheet instead".
   Reading it away from openSheet would hide what it is choosing between. It is
   also shared — filter-panel.js and views-member.js call it, not just game
   detail (`.claude/rules/popover-vs-sheet-editors.md`).

   No `module.exports`: DOM throughout (see round-theme.js's header for the
   coverage constraint). */

// The active sheet (backdrop element), so navigation/reopen can close it.
let activeSheet = null;

// Sheet history integration (#333). A sheet is not a routable view, but Back
// should dismiss it — as it does on Android and increasingly on the web —
// instead of tearing down the whole screen behind it. So opening a sheet pushes
// ONE URL-less history marker; Back pops it and we close the sheet, swallowing
// the navigation. State-only, not `?sheet=…`: every sheet (add game, link
// provider, move games, feedback, support) holds transient, unsaved input a
// reload would lose anyway, so deep-linking one buys nothing.
//   `sheetHistory`      — a marker is currently on top of the stack.
//   `pendingAfterClose` — a success handler that navigates AFTER the sheet
//     closes ("add game" → Regal) passes its navigation to closeSheet(next); it
//     must run only once the marker has popped, because history.back() fires
//     popstate asynchronously and a synchronous push would interleave with it
//     and corrupt the stack. handleSheetPop() runs it after the pop.
let sheetHistory = false;
let pendingAfterClose = null;

// Register a just-appended sheet as the active one and contain the keyboard in
// it (#145). Every sheet is aria-modal, which only constrains a screen reader —
// without trapFocus, Tab walked out of the dialog into the page behind the
// backdrop. Call this instead of assigning `activeSheet` directly, so no sheet
// can be added later that silently misses the trap OR the Back-dismissal.
function openSheet(backdrop, onKey, onClose) {
  // Replacing an already-open sheet (a showX opened while one is up) reuses its
  // marker — tear the old one down here, synchronously, rather than via a
  // leading closeSheet() whose async history.back() would arrive AFTER the new
  // sheet is open and wrongly dismiss it. `keepLock` because the page is staying
  // covered throughout: unlocking would restore the scroll offset and the
  // re-lock below would freeze it again, a visible jump on every replace.
  if (activeSheet) teardownSheet({ keepLock: true });
  // Freeze the page behind the backdrop (#622), and stop a swipe across the
  // exposed backdrop area from arriving as a dismissing tap now that it no
  // longer scrolls anything.
  lockPage();
  guardDragDismiss(backdrop);
  const release = trapFocus(backdrop);
  activeSheet = { el: backdrop, onKey, release, onClose };
  if (!sheetHistory) {
    history.pushState(Object.assign({}, history.state, { sheet: true }), '');
    sheetHistory = true;
  }
}

// Remove the sheet DOM and release the focus trap. Ordering is load-bearing
// (#145): release AFTER removing the sheet, because the trap restores focus to
// the opener and focusing an element inside a still-attached, about-to-vanish
// dialog would be undone a moment later.
function teardownSheet(opts) {
  if (!activeSheet) return;
  document.removeEventListener('keydown', activeSheet.onKey, true);
  activeSheet.el.remove();
  if (activeSheet.release) activeSheet.release();
  const { onClose } = activeSheet;
  activeSheet = null;
  // Every path OUT of the sheet layer comes through here — the × button, Escape,
  // a backdrop tap, a successful submit, and Back via handleSheetPop — so this is
  // the one place the page lock has to be released. `keepLock` is passed by the
  // openSheet replace path above, and by nothing else.
  if (!(opts && opts.keepLock)) unlockPage();
  // AFTER `activeSheet = null`, so a hook that opens something of its own cannot
  // re-enter this teardown. Fired on the `keepLock` replace path too: that sheet
  // really is closing, and a caller tracking its own open state would otherwise
  // believe it is still up. Mirrors closePopover's hook, so `openEditor` can
  // offer ONE close notification across both presentations.
  if (typeof onClose === 'function') onClose();
}

// Programmatic close (Escape, backdrop, the × button, a successful submit).
// `next`, if given, is a navigation to run once the pushed marker has been
// consumed — pass it to closeSheet instead of navigating on the next line, so
// the pop and the navigation don't race (see pendingAfterClose above).
function closeSheet(next) {
  if (!activeSheet) { if (typeof next === 'function') next(); return; }
  teardownSheet();
  if (sheetHistory) {
    pendingAfterClose = (typeof next === 'function') ? next : null;
    history.back();            // → popstate → handleSheetPop() consumes the marker, then runs next
  } else if (typeof next === 'function') {
    next();
  }
}

// Called first by router.js's popstate handler (#333). Returns true when this
// pop belongs to the sheet layer, so the router swallows it instead of routing:
//   • a sheet is open  → Back is dismissing it: tear it down, stay on the screen.
//   • the marker is ours → it is being consumed after a programmatic close: run
//     any deferred navigation now that the stack is back on the underlying entry.
function handleSheetPop() {
  if (activeSheet) {
    teardownSheet();
    sheetHistory = false;
    return true;
  }
  if (sheetHistory) {
    sheetHistory = false;
    const next = pendingAfterClose;
    pendingAfterClose = null;
    if (next) next();
    return true;
  }
  return false;
}

// The three game-detail editors (tags, players, cover) have ONE builder each
// and two presentations (#422): an anchored popover from 860px up, a bottom
// sheet below it. The anchored form is unusable on a phone — focusing its input
// makes the browser scroll the page to reveal it, and `openPopover`'s own
// page-scroll teardown then closes the popover out from under the keyboard, so
// there was no way to tag a game from a phone at all.
//
// 860px is the existing dock/strip breakpoint (.claude/rules/responsive-hub-tabs.md),
// deliberately reused rather than a new number. `build(container, close)` is
// presentation-agnostic and may return a callback to run once the container is
// live — see openPopover in popover.js.
const EDITOR_SHEET_BELOW = 860;
function usesEditorSheet() {
  return !window.matchMedia(`(min-width: ${EDITOR_SHEET_BELOW}px)`).matches;
}
// `onClose` (optional) runs on EVERY exit from either presentation — the ×,
// Escape, a backdrop tap, Back, an outside click, and the page scroll that tears
// a popover down. A caller that only wraps the `close` it is handed sees none of
// those, which is how a trigger's `aria-expanded` goes stale (#844).
function openEditor(anchor, variant, title, build, onClose) {
  if (!usesEditorSheet()) {
    return openPopover(anchor, (el, close) => {
      el.classList.add('popover--' + variant);
      return build(el, close);
    }, onClose);
  }
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet__head">
          <h2>${esc(title)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="editor editor--${esc(variant)}"></div>
      </div>
    </div>`);
  const body = backdrop.querySelector('.editor');
  // None of the three navigates on success — they PATCH and re-render in place —
  // so a plain closeSheet() is right; no closeSheet(next) deferral is needed
  // (.claude/rules/sheet-history-back-dismissal.md).
  const attached = build(body, () => closeSheet());
  document.body.appendChild(backdrop);
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  // Must go through openSheet for the focus trap (#145) and Back-dismissal
  // (#333) — never assign activeSheet directly.
  openSheet(backdrop, onKey, onClose);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  backdrop.querySelector('.sheet__close').addEventListener('click', () => closeSheet());
  // After openSheet, not before: trapFocus captures document.activeElement as
  // the restore target, so focusing first would "restore" focus into the sheet
  // itself. iOS only raises the keyboard for a focus() inside the user gesture,
  // and this whole path is synchronous from the button's click handler.
  if (typeof attached === 'function') attached();
  return { el: body, close: () => closeSheet() };
}
