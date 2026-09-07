'use strict';

/* The anchored popover: one small floating menu at a time, placed next to the
   element that opened it, closing on Escape, an outside click, a scroll or a
   resize.

   Split out of core.js by #956, and the seam is the one its own rule already
   draws — `.claude/rules/anchored-popover-is-placed-once.md`, which seven other
   rules cite. Nothing here knows about rounds, games, tags or scores: it takes
   an anchor and a build callback. The height/placement arithmetic it defers to
   lives in popover-fit.js, which is why that file loads first.

   `repositionPopover()` is the export the rest of the app actually reaches for
   most: placement is ONE-SHOT, so anything that changes an open popover's own
   height has to ask for a re-place. No `module.exports` — every function here
   touches `document` (see round-theme.js's header for the coverage constraint). */

// --- Anchored popover (small floating menu next to a clicked element) ---
// Used for the inline edit menus on the game detail page. Only one is open at a
// time; it closes on Escape, an outside click, or a page scroll/resize.
let activePopover = null;
function closePopover() {
  if (!activePopover) return;
  const { el, restoreTo, onClose } = activePopover;
  // Hand focus back to the control that opened it, the way trapFocus does for a
  // sheet (#145) — without it a keyboard user who closes a popover is dropped to
  // <body> and restarts from the top of the document (#424). Only when focus is
  // still *inside* the popover (or nowhere): once the user has clicked into some
  // other control, yanking it back would fight them for it. Read before the
  // remove() below, which moves focus to <body> on its own.
  const held = el.contains(document.activeElement) || !document.activeElement || document.activeElement === document.body;
  el.remove();
  document.removeEventListener('mousedown', activePopover.onDoc, true);
  document.removeEventListener('keydown', activePopover.onKey, true);
  window.removeEventListener('resize', activePopover.onGone, true);
  window.removeEventListener('scroll', activePopover.onScroll, true);
  activePopover = null;
  if (held && restoreTo && document.contains(restoreTo) && typeof restoreTo.focus === 'function') restoreTo.focus();
  // AFTER the teardown and the focus restore, so a hook that reads the world
  // back — `aria-expanded` on the trigger, a deferred rebuild — sees the closed
  // state rather than the one it is being told about. Fired for EVERY exit
  // (Escape, outside click, page scroll, resize), which is the whole reason it
  // exists: a caller that only wraps the `close` it was handed misses all four.
  if (typeof onClose === 'function') onClose();
}
// Re-place the open popover after its content changed height. A no-op when no
// popover is open, which is what lets a component that may live in EITHER
// presentation — the edition-cover picker sits in a popover on desktop, a sheet
// on a phone and inline in the add-game form — call it unconditionally.
function repositionPopover() {
  if (activePopover && activePopover.place) activePopover.place();
}

// `build(el, close)` may return a callback, which runs once the popover is in
// the document AND positioned. Anything that needs a live element — above all
// `input.focus()` — belongs there: build() itself runs on a detached node, so a
// focus() call in it is a silent no-op, which is why the tags/players editors'
// autofocus never worked on any platform (#422).
function openPopover(anchor, build, onClose) {
  // Captured before the replace-close below, so THIS popover's opener is the
  // restore target even when it replaces one that was already open.
  const restoreTo = document.activeElement;
  closePopover();
  const el = h('<div class="popover"></div>');
  const close = () => closePopover();
  const attached = build(el, close);
  document.body.appendChild(el);
  place();

  // Prefer below the anchor; flip above if it wouldn't fit. Clamp horizontally,
  // and — since #739 — vertically too, to the room the chosen side actually has:
  // the card is placed wholly on one side, so a card taller than the larger side
  // has no legal placement and used to be put past the fold regardless. The
  // arithmetic (which side, how much room, how far it may be squeezed) is in
  // `popover-fit.js`; everything DOM-shaped about it stays here.
  //
  // Re-runnable, and re-run through repositionPopover() whenever the content
  // changes size (#519): the placement is decided from `el.offsetHeight`, so a
  // popover that GROWS after it was placed — the edition-cover grid expanding —
  // keeps a `top` chosen for its old height and can run off the bottom of the
  // viewport. There is no recovering from that by scrolling either: a page
  // scroll closes the popover (onScroll below), so the overflow is simply
  // unreachable. Placement is idempotent, so re-running it is safe.
  //
  // A ResizeObserver would do this with no caller involvement and was tried
  // first. It is not used because it cannot be VERIFIED here: the Claude Code
  // Browser pane never fires one at all — measured on a plain div whose height
  // was changed 50px -> 200px, zero callbacks — the same dead-observer artifact
  // that stops IntersectionObserver working there
  // (.claude/rules/preview-pane-paint-artifacts.md). An explicit call is
  // deterministic and testable; an untestable mechanism is not worth its silence.
  function place() {
    const r = anchor.getBoundingClientRect();
    const margin = 8;
    const kids = [...el.children];
    // From a clean slate every time: a previous run may have clamped the card,
    // and both the anchor and the viewport can have moved since.
    el.style.maxHeight = '';
    el.classList.remove('popover--clamped');
    kids.forEach((k) => { k.style.minHeight = ''; });
    const natural = el.offsetHeight;
    const fit = popoverFit(natural, r.top, r.bottom, window.innerHeight);
    if (fit.clamped) {
      // No child may be squeezed past its own content while the card is clamped.
      // A give-way child carries `min-height: 0` precisely so its card's CSS cap
      // can bite (`.exp-pick`), and under a tighter clamp that lets it collapse
      // to nothing while its own content keeps its floor — which then paints ON
      // TOP of the next child (#728; measured here at 107px). Barred, the child
      // stops at its content and the card scrolls the rest, which is the whole
      // reason the clamp needs no floor of its own.
      //
      // Inline rather than a rule, because the declarations that set that 0 are
      // more specific than any class this could add — a stylesheet fight decided
      // by source order is exactly what .claude/rules/ warns off.
      kids.forEach((k) => { k.style.minHeight = 'auto'; });
      el.style.maxHeight = fit.height + 'px';
      // A clamped card has to scroll itself, or the clamp merely trades "past
      // the fold" for "clipped" — which is worse, because nothing indicates
      // there is more. The class carries that (plus the `overscroll-behavior`
      // that keeps reaching its end from scrolling the page and closing it).
      el.classList.add('popover--clamped');
    }
    const h = el.offsetHeight;
    el.style.top = (fit.above ? window.scrollY + r.top - h - fit.gap : window.scrollY + r.bottom + fit.gap) + 'px';
    let left = window.scrollX + r.left;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - el.offsetWidth - margin;
    left = Math.max(window.scrollX + margin, Math.min(left, maxLeft));
    el.style.left = left + 'px';
  }

  const onDoc = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const onGone = () => close();
  // Capture-phase scroll on window also fires for scrolls *inside* the popover —
  // a single-line <input> scrolls as soon as its text overflows, which silently
  // closed the popover mid-typing (#247). Ignore those; a page scroll targets
  // `document` (not contained by `el`), so it still closes as before.
  const onScroll = (e) => { if (!el.contains(e.target)) close(); };
  document.addEventListener('mousedown', onDoc, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onGone, true);
  window.addEventListener('scroll', onScroll, true);
  activePopover = { el, restoreTo, onDoc, onKey, onGone, onScroll, place, onClose };
  if (typeof attached === 'function') attached();
  return { el, close };
}
