/* Spielwirbel – the top bar's „…" overflow menu (#1460).

   On a phone the bar cannot always hold all six buttons beside the home link:
   Das Programmheft keeps its wordmark there (P2.5) and ran off the right edge at
   every phone width, and every design did at 320px. So the buttons that do not
   fit fold into a „…" button, LOWEST priority first, and its menu lists them.

   Whether a button fits is MEASURED, never set per design: each design paints
   the bar differently (button size, gap, padding, Der Tisch's face account
   button, the Programmheft wordmark), and a threshold right for one is wrong for
   the next. The arithmetic is topbar-fit.js; this file measures and folds.

   A folded button carries `data-folded`, never `hidden`. `hidden` belongs to the
   app's own gating (support without a donate URL, the inbox when logged out …),
   and a fold that wrote it could not tell, on the next pass, which buttons it
   may bring back. A gated button is neither in the bar nor in the menu.

   No module.exports: everything here touches `document`
   (.claude/rules/frontend-helper-modules-and-coverage.md). The specs reach it
   through the jsdom harness. */

'use strict';

// Highest priority first, so the LAST folds first (operator decision, #1460).
// „Anmelden" takes the account's slot when logged out; the two are never
// visible together. `dot` is the unread mark a folded button hands to „…".
const TOPBAR_SLOTS = [
  { id: 'accountBtn', icon: 'ti-user', dot: 'newsDot' },
  { id: 'loginBtn', icon: 'ti-user' },
  { id: 'inboxBtn', icon: 'ti-mail', dot: 'inboxDot' },
  { id: 'supportBtn', icon: 'ti-heart' },
  { id: 'designBtn', icon: 'ti-palette' },
  { id: 'feedbackBtn', icon: 'ti-message' },
  // The globe and the invisible <select> over it are ONE control: the select is
  // pulled over the globe by a negative margin (styles.css, `.lang-picker`), so
  // folding only the globe would leave an invisible select over its neighbour.
  { id: 'langPicker', face: '.lang-picker__globe', icon: 'ti-world', language: true },
];

// The round name gives way before any button folds, but not to nothing: #1429
// already fought a name squeezed to 0–6px. Its natural width, up to this much,
// counts as fixed. 64 rather than more because at 430px — the largest phones —
// it is what lets Klassisch keep all six buttons beside a lobby label; at 72 two
// folded there by 2px.
const TOPBAR_CONTEXT_MIN = 64;

// The rendered width of an element, or null when it is not rendered at all
// (`display: none` — the auth screens hide the home link, the Programmheft
// phone bar hides the round name). A seam: jsdom has no layout, so the specs
// replace it with known widths.
function topbarWidth(el) {
  return el && el.getClientRects().length ? el.getBoundingClientRect().width : null;
}

// The room the bar's content box offers, and its gap. A seam like the above.
function topbarRoom(bar) {
  const cs = getComputedStyle(bar);
  return {
    available: bar.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0),
    gap: parseFloat(cs.columnGap) || 0,
  };
}

// Each slot that takes part right now: not gated off by the app. `els` is what
// folds together, `face` what is measured and what a menu row stands in for.
function topbarSlots() {
  const slots = [];
  for (const slot of TOPBAR_SLOTS) {
    const el = document.getElementById(slot.id);
    if (!el || el.hidden) continue;
    const face = slot.face ? document.querySelector(slot.face) : el;
    if (!face) continue;
    slots.push({ ...slot, el, face, els: face === el ? [el] : [face, el] });
  }
  return slots;
}

let topbarObserver = null;

// One pass: unfold everything, measure, fold what does not fit. Runs in one
// task, so the unfolded state is never painted.
function fitTopbar() {
  const bar = document.querySelector('.topbar');
  const more = document.getElementById('moreBtn');
  if (!bar || !more) return;
  for (const el of bar.querySelectorAll('[data-folded]')) el.removeAttribute('data-folded');
  more.hidden = true;
  const slots = topbarSlots();
  // The vote screen hides the whole bar; there is nothing to fit.
  if (topbarWidth(bar) !== null && slots.length) {
    const { available, gap } = topbarRoom(bar);
    const fixed = [];
    const home = topbarWidth(document.getElementById('homeBtn'));
    if (home !== null) fixed.push(home);
    const context = document.getElementById('context');
    const ctxWidth = topbarWidth(context);
    if (ctxWidth !== null) fixed.push(Math.min(context.scrollWidth || ctxWidth, TOPBAR_CONTEXT_MIN));
    // A slot the stylesheet hides (not the app's `hidden`) takes no room.
    const shown = slots.filter((s) => topbarWidth(s.face) !== null);
    more.hidden = false;
    const moreWidth = topbarWidth(more) || 0;
    more.hidden = true;
    const keep = topbarKeep({ available, gap, fixed, widths: shown.map((s) => topbarWidth(s.face)), more: moreWidth });
    for (const slot of shown.slice(keep)) slot.els.forEach((el) => { el.dataset.folded = 'moreBtn'; });
    more.hidden = keep === shown.length;
  }
  syncMoreDot();
  // The pass's own writes are not a reason for another pass.
  if (topbarObserver) topbarObserver.takeRecords();
}

// A folded inbox or account hands its unread mark to „…", and so does the
// button's name: the dot is never the only signal.
function syncMoreDot() {
  const more = document.getElementById('moreBtn');
  const dot = document.getElementById('moreDot');
  if (!more || !dot) return;
  const lit = topbarSlots().some((s) => s.dot && s.el.dataset.folded && !document.getElementById(s.dot).hidden);
  dot.hidden = !lit;
  more.setAttribute('aria-label', t(lit ? 'topbar.moreUnread' : 'topbar.more'));
}

// A row's words: the button's own accessible name, which applyStaticTexts and
// renderAccountFace already keep localized — a second string could only drift.
function topbarSlotLabel(slot) {
  if (slot.language) return t('a11y.language');
  return slot.el.getAttribute('aria-label') || slot.el.textContent.trim();
}

/* The menu. Each row does exactly what its bar button does, by clicking it: a
   second copy of each handler could only drift. A folded button that opens its
   own popover (account, design) is anchored on „…" instead — popover.js reads
   `data-folded` for that. Language is the one exception: in the bar it is a
   native <select>, which no click opens, so its row opens a list of its own. */
function openMoreMenu(more) {
  openPopover(more, (el, close) => {
    const folded = topbarSlots().filter((s) => s.el.dataset.folded);
    const items = folded.map((slot) => ({
      icon: slot.icon,
      label: topbarSlotLabel(slot),
      run: slot.language ? () => openLangMenu(more) : () => slot.el.click(),
    }));
    fillMenu(el, items, close);
    // The unread mark follows its button into the menu, as it does in the
    // account menu's „Was ist neu" row.
    el.querySelectorAll('.popover__opt').forEach((row, i) => {
      const dot = folded[i].dot && document.getElementById(folded[i].dot);
      if (dot && !dot.hidden) row.appendChild(h('<span class="popover__dot" aria-hidden="true"></span>'));
    });
    return () => { const first = el.querySelector('button'); if (first) first.focus(); };
  }, () => more.setAttribute('aria-expanded', 'false'));
  more.setAttribute('aria-expanded', 'true');
}

// The language list, for a folded picker. The pick goes through the <select>'s
// own `change`, so it switches and re-renders exactly as the picker does.
// Buttons rather than radios: the design menu's arrow-key preview exists because
// a committed change re-renders the screen and closes the popover, and a
// language has no preview to offer — so moving through the list must not pick.
function openLangMenu(anchor) {
  const sel = document.getElementById('langPicker');
  openPopover(anchor, (el, close) => {
    el.classList.add('popover--menu');
    const group = h(`<div class="lang-menu" role="group" aria-label="${esc(t('a11y.language'))}"></div>`);
    for (const loc of SUPPORTED_LOCALES) {
      const on = loc === getLocale();
      const row = h(`<button class="popover__opt" type="button" lang="${esc(loc)}" aria-pressed="${on}">${
        on ? '<i class="ti ti-check" aria-hidden="true"></i> ' : ''}${esc(LOCALE_LABELS[loc])}</button>`);
      row.addEventListener('click', () => {
        close();
        if (on) return;
        sel.value = loc;
        sel.dispatchEvent(new Event('change'));
      });
      group.appendChild(row);
    }
    el.appendChild(group);
    return () => { const target = group.querySelector('[aria-pressed="true"]'); if (target) target.focus(); };
  }, () => anchor.setAttribute('aria-expanded', 'false'));
  anchor.setAttribute('aria-expanded', 'true');
}

/* Wiring. The fit has to be redone whenever anything that takes room changes,
   and most of those changes happen in code that knows nothing about the bar —
   the account face, a reveal after GET /api/config, a login, the „Anmelden"
   label after a language switch. So one MutationObserver on the bar catches
   them all, rather than a call in each of those places. ResizeObserver is
   deliberately not used: the Browser pane fires none
   (.claude/rules/preview-pane-paint-artifacts.md), and a window `resize`
   covers every real case. Three more triggers change widths without touching
   the bar's DOM: a design (the attribute, then its stylesheet arriving), a
   screen's body class (the auth screens hide the home link), and fonts loading
   late (the first measurement would be of a fallback face). */
function setupTopbarOverflow() {
  const more = document.getElementById('moreBtn');
  const bar = document.querySelector('.topbar');
  if (!more || !bar) return;
  more.onclick = () => {
    // A toggle: the popover ignores clicks on its own anchor.
    if (more.getAttribute('aria-expanded') === 'true') { closePopover(); return; }
    openMoreMenu(more);
  };
  topbarObserver = new MutationObserver(() => fitTopbar());
  topbarObserver.observe(bar, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['hidden', 'class', 'aria-label'],
  });
  topbarObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-design', 'data-scheme'] });
  topbarObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', fitTopbar);
  // `load` does not bubble, so capture: a design's stylesheet <link> arriving.
  document.addEventListener('load', (e) => { if (e.target && e.target.tagName === 'LINK') fitTopbar(); }, true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTopbar, () => {});
  fitTopbar();
}
