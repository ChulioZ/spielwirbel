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
   plural, so both now branch per type. `badge_earned` (#1389) is the fourth, and
   it has its branch in each.

   `games_imported` carries a COUNT and `badge_earned` a TIER — the only two
   fields ever added to the stored row's allowlist. See both backends'
   addFeedEvent for why each is typed there rather than trusted from the caller. */

const FEED_EVENT_TYPES = new Set(['session_played', 'game_added', 'games_imported', 'badge_earned']);

/* `badge_earned` (#1389): an account-tier Abzeichen crossed a tier. Its payload
   is the catalogue KEY (stored in `title`, so the read-side collapse and both
   read routes need no new field to tell two badges apart) and the TIER, and
   nothing else: no round, no session, no other person, and no cover.

   Validated here, once, for both backends: the key must be one of the four
   account entries and the tier one of that entry's own tiers — so a call site
   cannot smuggle free text into a friend's feed through `title`, which for the
   other types is a game title. Returns the two stored fields, or null (the
   backends then drop the event, as they do an unknown type). */
const { BADGE_CATALOGUE } = require('../public/js/achievements');

function badgeFeedFields(event) {
  const def = BADGE_CATALOGUE.find((d) => d.holder === 'account' && d.key === (event && event.title));
  if (!def || !def.tiers || !def.tiers.includes(event.tier)) return null;
  return { title: def.key, tier: event.tier };
}

/* Retention (#1357): an AGE limit, not a count. Until #1357 each account kept
   its newest MAX_FEED_EVENTS rows (default 50), which made a profile's feed look
   like the account's history while holding only its last 50 actions. The age
   limit is what docs/legal/retention.md and vvt.md row 14 state, so it binds in
   two places — on every write (per account) and in the scheduler's
   purgeExpiredFeedEvents sweep, without which an account that stops writing would
   keep its events forever and that statement would be false.

   Both read per call, never cached, so a test (or an env change without restart)
   takes effect at once — the pattern the quota env vars follow. */
const DAY_MS = 24 * 60 * 60 * 1000;
const feedMaxAgeDays = () => {
  const n = Number(process.env.MAX_FEED_EVENT_AGE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 365;
};

// Rows whose `at` sorts before this ISO string are expired. `at` is always
// written by addFeedEvent as a UTC ISO-8601 string, which sorts lexicographically
// — the same text comparison the moderation-log purge relies on.
function feedEventCutoff(now = Date.now()) {
  return new Date(now - feedMaxAgeDays() * DAY_MS).toISOString();
}

/* MAX_FEED_EVENTS is KEPT, as a safety ceiling rather than the retention rule.
   Twelve months with no count bound would let one account (a script adding and
   removing a game in a loop) grow the table without limit; the ceiling bounds
   that, and its default is far above anything the age limit leaves in practice
   (5000 is ~14 events a day for a year), so the age limit is what binds. An
   instance that still sets the old value (50) keeps the old behaviour — see
   docs/configuration.md. */
const feedEventCeiling = () => {
  const n = Number(process.env.MAX_FEED_EVENTS);
  return Number.isInteger(n) && n > 0 ? n : 5000;
};

module.exports = { FEED_EVENT_TYPES, badgeFeedFields, feedEventCutoff, feedEventCeiling, feedMaxAgeDays };
