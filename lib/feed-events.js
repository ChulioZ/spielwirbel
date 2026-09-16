'use strict';

/* The Freundeskreis feed's event types (#325): what `addFeedEvent` will store.
   Both repo backends require this — it used to be a `new Set([...])` literal in
   each, with no parity test and nothing asserting the accepted set on either
   side (2026-09-06 code-maturity audit, M-002). A backend-pair copy is not the
   client/server palette bug, but it is the same drift one entity over from
   lib/repo/import-copy.js's field lists: a type accepted by one backend and
   dropped by the other fails as a feed that is quietly emptier on Postgres.

   Dependency-free on purpose, like lib/demo-tenant.js: both backends and the
   emitter can require it without a cycle. The client half — how each type is
   phrased — is public/js/feed-view.js, which since #1132 holds TWO renderers:
   `feedText` for the row and `feedTileVerb` for the tile. It used to render any
   non-`session_played` type as "added", which #1079 is exactly the case that
   comment warned about: `games_imported` needs its own phrase and its own
   plural, so both now branch per type. A fourth type needs a branch in each.

   `games_imported` is also the one type carrying a COUNT, which is the only
   field ever added to the stored row's allowlist — see both backends'
   addFeedEvent for why it is typed there rather than trusted from the caller. */

const FEED_EVENT_TYPES = new Set(['session_played', 'game_added', 'games_imported']);

module.exports = { FEED_EVENT_TYPES };
