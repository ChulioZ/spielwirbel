/* Spielwirbel – the four off-shelf destinations, defined ONCE (#1185).

   Aussortiert · Durchgespielt · Wunschliste · Könnte euch gefallen are offered
   from three places now: the Regal's sheet (below 1280px), the rail (from
   1280px up) and the hub's „Nicht im Regal" group (#1185, every width). Each
   one used to build its own array with its own `round.games.filter(...)`
   counts, which is the shape `.claude/rules/shared-constants-across-the-stack.md`
   is written about — three copies of a list whose counts are hand-derived, where
   the copy nobody remembers is the one that rots.

   `test/off-shelf-parity.test.js` pinned the Regal↔rail pair, and it did so by
   comparing rendered labels; a third surface would have needed a third
   comparison. One source needs none: the surfaces differ only in how a row is
   PRESENTED, never in which rows exist or what they count.

   `go` is an arrow, not a direct reference: the show* functions live in
   views-archive.js / views-recommend.js, which load AFTER this file, so naming
   one at load time would be the trap `.claude/rules/frontend-script-load-order.md`
   describes. Deferring to call time is what every caller here already did.

   Part of the frontend; all files share one global script scope. */

'use strict';

// Recommendations carry NO count deliberately: the other three number the
// round's OWN games, while this one would number a list the round has never
// seen — a promise rather than an inventory. Keep that asymmetry; it is the
// reason `count` is null here rather than 0.
function offShelfEntries(round) {
  const rid = round.id;
  const games = round.games || [];
  /* One row per state, and the COUNT IS DERIVED ONCE per row — `count` and the
     `{n}` in `label` must never be two filters over the same field, which is the
     bug this whole file exists to remove, one scope in. `name` is the same
     destination WITHOUT its count, for a presentation that shows the count as a
     separate figure (Der Tisch's count tiles, #1262) rather than in the label. */
  const counted = [
    { sub: 'retired', icon: 'ti-archive', key: 'retired.link', nameKey: 'retired.title', flag: (g) => g.retired, go: () => showRetired(rid) },
    { sub: 'completed', icon: 'ti-circle-check', key: 'completed.link', nameKey: 'completed.title', flag: (g) => g.completed, go: () => showCompleted(rid) },
    { sub: 'wishlist', icon: 'ti-heart', key: 'wish.link', nameKey: 'wish.title', flag: (g) => g.wish, go: () => showWishlist(rid) },
  ].map(({ sub, icon, key, nameKey, flag, go }) => {
    const count = games.filter(flag).length;
    return { sub, icon, count, label: t(key, { n: count }), name: t(nameKey), go };
  });
  return [
    ...counted,
    { sub: 'recommendations', icon: 'ti-sparkles', count: null, label: t('suggest.link'), name: t('suggest.link'), go: () => showRecommendations(rid) },
  ];
}

/* The same four destinations as SEGMENTS at the head of each of their own
   screens (#1196, Der Tisch T13.3) — the fourth presentation of the one list, so
   it cannot disagree with the other three about which rows exist or what they
   count.

   NAVIGATION, NOT A MERGED SCREEN. T13.3 draws the three lists side by side on
   one screen with the recommendations below; the app keeps one route per list
   (the rail, the Regal's sheet, the hub group and every deep link all name
   them), so each segment is a real link to its own route and `aria-current`
   marks the screen you are on — the rail's own semantics for the same rows.

   Rendered for every design and `display: none` in styles.css: a design opts in
   by showing it (tisch.css). Klassisch reaches the same four through the rail
   and the Regal, and a second navigation strip there is a decision for that
   design rather than a side effect of this one.

   Die Brücke (#1245, B6.7) titles the strip „Nicht im Regal" and gives each
   segment its name over its count, a tab readout rather than a sentence. The
   title is aria-hidden because the nav's own label already says it; there is
   no group count — the three lists are not one inventory, and a sum would be a
   number that counts nothing. The recommendations keep their null count, so
   that segment carries its name alone.

   Das Programmheft (#1379, P13.7) prints the same strip: „Nicht im Regal" as
   the page's display head, each tab its name beside its figure. */
function offShelfSegments(round, activeSub) {
  const nav = h(`<nav class="offshelf-seg" aria-label="${esc(t('rail.archive'))}"></nav>`);
  const bruecke = designIs('bruecke') || designIs('programmheft');
  if (bruecke) nav.appendChild(h(`<p class="offshelf-seg__title" aria-hidden="true">${esc(t('rail.archive'))}</p>`));
  offShelfEntries(round).forEach(({ icon, label, name, count, sub, go }) => {
    const on = sub === activeSub;
    // `data-sub` lets a design set the recommendations apart from the three
    // lists (Ocean, #1218: O13.3 gives „Könnte euch gefallen" its own column).
    // Brücke's segment still reads as one phrase to a screen reader: the name,
    // then the figure — the same two facts `label` states in one string.
    const inner = bruecke
      ? `<span class="offshelf-seg__name">${esc(name)}</span>${count === null ? '' : `<span class="offshelf-seg__n">${count}</span>`}`
      : iconText(icon, label);
    const seg = h(`<a class="offshelf-seg__item${on ? ' is-on' : ''}" data-sub="${sub}"${on ? ' aria-current="page"' : ''}>${inner}</a>`);
    navLink(seg, roundPath(round.id, sub), go);
    nav.appendChild(seg);
  });
  return nav;
}

// The four off-shelf destinations, as a plain list sheet (moved here from
// views-regal.js in #1239 — it is one more presentation of the same four).
//
// ONE presentation for everything below 1280px, deliberately: the trigger is
// `rail-owned`, so a popover/sheet split by the 860px editor breakpoint would
// invent a third presentation for the 860–1279px band alone. The
// popover-vs-sheet split exists because an anchored popover cannot hold a text
// input on a phone (.claude/rules/popover-vs-sheet-editors.md) — this holds only
// links, so it never needs it. Shape copied from pickExpansionBase (#664).
// Under Der Tisch the trigger is not `rail-owned` (#1262), so this same centred
// dialog serves the desktop too — still one presentation, just at every width.
function openOffShelfSheet(round) {
  const rid = round.id;
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog sheet--list" role="dialog" aria-modal="true" aria-label="${esc(t('rail.archive'))}">
        <div class="sheet__head">
          <h2>${esc(t('rail.archive'))}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="ds-list off-shelf"></div>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const dismiss = () => closeSheet();
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', onKey, true);
  // Must go through openSheet for the focus trap (#145) and Back-dismissal
  // (#333) — never assign activeSheet directly.
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) dismiss(); });
  backdrop.querySelector('.sheet__close').addEventListener('click', dismiss);

  // Icons, labels and counts come from off-shelf.js, so this sheet, the rail
  // and the hub's „Nicht im Regal" group cannot disagree about which rows exist
  // or what they count — what test/off-shelf-parity.test.js used to have to
  // compare between two hand-built arrays.
  const list = backdrop.querySelector('.off-shelf');
  offShelfEntries(round).forEach(({ icon, label, sub, go }) => {
    // Real <a href> (#330), so ⌘/middle-click still open them in a new tab.
    // `class` FIRST, like every other .ds-row site — test/ds-row-affordance.test.js
    // matches on `<a\s+class="ds-row…"`, so an attribute in front of it makes the
    // row invisible to that guard rather than failing it.
    const row = h(`<a class="ds-row off-shelf__row">
         <span class="ds-row__main"><i class="ti ${icon}" aria-hidden="true"></i><span>${esc(label)}</span></span>
         <span class="ds-row__meta"><i class="ti ti-chevron-right" aria-hidden="true"></i></span>
       </a>`);
    // Through closeSheet, never on the line after it, or the queued history pop
    // races the screen the choice renders
    // (.claude/rules/sheet-history-back-dismissal.md).
    navLink(row, roundPath(rid, sub), () => closeSheet(go));
    list.appendChild(row);
  });
}
