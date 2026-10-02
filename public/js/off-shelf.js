/* Spielwirbel – the four off-shelf destinations, defined ONCE (#1185).

   Wunschliste · Aussortiert · Durchgespielt · Könnte euch gefallen are offered
   from two places since #1500: the scope strip heading the Regal and each of
   the four lists (`offShelfSegments`, below), and the hub's „Weitere Listen"
   group (hub-previews.js). They used to be offered from up to four more — a
   toolbar sheet, a band or line under the grid, the Klassisch rail's group —
   each building its own array with its own `round.games.filter(...)` counts
   until #1185, which is the shape
   `.claude/rules/shared-constants-across-the-stack.md` is written about.

   One source means the surfaces differ only in how a row is PRESENTED, never in
   which rows exist or what they count (`test/off-shelf-parity.test.js`).

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
  // The wish list leads (#1500): it is the list people actively use.
  const counted = [
    { sub: 'wishlist', icon: 'ti-heart', key: 'wish.link', nameKey: 'wish.title', flag: (g) => g.wish, go: () => showWishlist(rid) },
    { sub: 'retired', icon: 'ti-archive', key: 'retired.link', nameKey: 'retired.title', flag: (g) => g.retired, go: () => showRetired(rid) },
    { sub: 'completed', icon: 'ti-circle-check', key: 'completed.link', nameKey: 'completed.title', flag: (g) => g.completed, go: () => showCompleted(rid) },
  ].map(({ sub, icon, key, nameKey, flag, go }) => {
    const count = games.filter(flag).length;
    return { sub, icon, count, label: t(key, { n: count }), name: t(nameKey), go };
  });
  return [
    ...counted,
    { sub: 'recommendations', icon: 'ti-sparkles', count: null, label: t('suggest.link'), name: t('suggest.link'), go: () => showRecommendations(rid) },
  ];
}

/* The scope strip (#1196, #1500): the Regal and its four lists as ONE
   collection with views — `Regal (15) · Wunschliste (3) · Aussortiert (4) ·
   Durchgespielt (1) · Könnte euch gefallen` — at the head of the Regal and of
   each list, in every design and at every width. It replaced every other way
   onto the four lists from the Regal side (a toolbar sheet, footer bands and
   lines, the Klassisch rail's group), which had come to nine presentations of
   one navigation, several of them under the grid where nobody found them.

   NAVIGATION, NOT A MERGED SCREEN. Each segment is a real link to its own route
   (⌘/middle-click, #330) and `aria-current="page"` marks the screen you are on.

   The „Regal" segment is added HERE, not in offShelfEntries(): the hub's
   „Weitere Listen" group reads that function too, and must not offer the Regal
   as one of its „further lists". Its count is the shelf's own (`isActiveGame`,
   draw-pool.js — the same predicate the server's draw uses), never a new filter
   (.claude/rules/active-games-filter-sites.md).

   No title over the strip any more: with the Regal as a segment there is no
   umbrella left to name, and the nav's label („Regal und Listen") says what it
   is. Die Brücke (B6.7) and Das Programmheft (P13.7) set each segment as its
   name beside its figure — a tab readout rather than a sentence; the others use
   the counted label. Every design styles the strip in its own sheet, and
   Klassisch in styles.css. */
function offShelfSegments(round, activeSub) {
  const nav = h(`<nav class="offshelf-seg" aria-label="${esc(t('offShelf.scope'))}"></nav>`);
  const figures = designIs('bruecke') || designIs('programmheft');
  const shelf = (round.games || []).filter(isActiveGame).length;
  const regal = {
    sub: 'regal', icon: 'ti-cards', count: shelf,
    label: t('offShelf.regal', { n: shelf }), name: t('hub.tab.regal'),
    go: () => showRound(round.id, 'regal'),
  };
  [regal, ...offShelfEntries(round)].forEach(({ icon, label, name, count, sub, go }) => {
    const on = sub === activeSub;
    // `data-sub` lets a design set the recommendations apart from the lists
    // (Ocean, #1218: O13.3 gives „Könnte euch gefallen" its own column).
    // A figures segment still reads as one phrase to a screen reader: the name,
    // then the figure — the same two facts `label` states in one string.
    const inner = figures
      ? `<span class="offshelf-seg__name">${esc(name)}</span>${count === null ? '' : `<span class="offshelf-seg__n">${count}</span>`}`
      : iconText(icon, label);
    const seg = h(`<a class="offshelf-seg__item${on ? ' is-on' : ''}" data-sub="${sub}"${on ? ' aria-current="page"' : ''}>${inner}</a>`);
    navLink(seg, roundPath(round.id, sub), on ? null : go);
    nav.appendChild(seg);
  });
  return nav;
}
