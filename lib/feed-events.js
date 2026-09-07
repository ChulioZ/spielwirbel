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
   phrased — is public/js/views-friends.js, which renders any non-`session_played`
   type as "added"; a new type here needs a phrase there. */

const FEED_EVENT_TYPES = new Set(['session_played', 'game_added']);

module.exports = { FEED_EVENT_TYPES };
