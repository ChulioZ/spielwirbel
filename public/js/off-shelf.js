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
     bug this whole file exists to remove, one scope in. */
  const counted = [
    { sub: 'retired', icon: 'ti-trash', key: 'retired.link', flag: (g) => g.retired, go: () => showRetired(rid) },
    { sub: 'completed', icon: 'ti-circle-check', key: 'completed.link', flag: (g) => g.completed, go: () => showCompleted(rid) },
    { sub: 'wishlist', icon: 'ti-heart', key: 'wish.link', flag: (g) => g.wish, go: () => showWishlist(rid) },
  ].map(({ sub, icon, key, flag, go }) => {
    const count = games.filter(flag).length;
    return { sub, icon, count, label: t(key, { n: count }), go };
  });
  return [
    ...counted,
    { sub: 'recommendations', icon: 'ti-sparkles', count: null, label: t('suggest.link'), go: () => showRecommendations(rid) },
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
   design rather than a side effect of this one. */
function offShelfSegments(round, activeSub) {
  const nav = h(`<nav class="offshelf-seg" aria-label="${esc(t('rail.archive'))}"></nav>`);
  offShelfEntries(round).forEach(({ icon, label, sub, go }) => {
    const on = sub === activeSub;
    const seg = h(`<a class="offshelf-seg__item${on ? ' is-on' : ''}"${on ? ' aria-current="page"' : ''}>${iconText(icon, label)}</a>`);
    navLink(seg, roundPath(round.id, sub), go);
    nav.appendChild(seg);
  });
  return nav;
}
