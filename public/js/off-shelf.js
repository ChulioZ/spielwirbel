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
  return [
    {
      sub: 'retired', icon: 'ti-trash', count: games.filter((g) => g.retired).length,
      label: t('retired.link', { n: games.filter((g) => g.retired).length }),
      go: () => showRetired(rid),
    },
    {
      sub: 'completed', icon: 'ti-circle-check', count: games.filter((g) => g.completed).length,
      label: t('completed.link', { n: games.filter((g) => g.completed).length }),
      go: () => showCompleted(rid),
    },
    {
      sub: 'wishlist', icon: 'ti-heart', count: games.filter((g) => g.wish).length,
      label: t('wish.link', { n: games.filter((g) => g.wish).length }),
      go: () => showWishlist(rid),
    },
    {
      sub: 'recommendations', icon: 'ti-sparkles', count: null,
      label: t('suggest.link'),
      go: () => showRecommendations(rid),
    },
  ];
}
