'use strict';

/*
 * Per-tenant quotas & abuse controls (issue #139).
 *
 * Bounds abuse once public multi-tenant sign-up opens (#219). Six state caps:
 *   - rounds per tenant          (checked in lib/routes/rounds.js)
 *   - games per round            (checked in lib/routes/games.js)
 *   - tags per round             (checked in lib/routes/tags.js, #238)
 *   - members per round          (checked in lib/routes/members.js, #563)
 *   - expansions per game        (checked in lib/routes/games.js, #653)
 *   - dismissed recommendations per round (checked in lib/routes/recommendations.js, #782)
 *
 * Plus three per-ACCOUNT caps, which bound an account rather than tenant data —
 * but take the same shape (env-tunable, read per call, distinct 403 code →
 * localized toast):
 *   - accepted friends per user           (checked in lib/routes/friends.js, #325)
 *   - open outgoing friend requests per user (checked in lib/routes/friends.js, #325)
 *   - passkeys per user                   (checked in lib/routes/passkeys.js, #418)
 * They are only ever reachable in accounts mode (the friend and passkey routes
 * 404 when accounts are off), so they need no separate enforced() gate.
 *
 * (One more per-tenant cap once bounded the billed buy-next recommendation spend
 * per tenant/month; it went away with the feature itself in #264.)
 *
 * Enforced ONLY in the public multi-tenant mode (accounts.accountsEnabled()) —
 * which is what production has run since the go-live (#219), so these caps are
 * live. With accounts off — a self-hosted or local instance, where every caller is
 * the one 'default' tenant — the caps are inert, so that instance is
 * byte-for-byte unchanged and an existing group already past a
 * cap is never suddenly blocked. This mirrors how tenancy (#136) and onboarding
 * (#138) gate their behaviour, and it turns quotas on exactly when public sign-up
 * does.
 *
 * The caps are checked against current data — count the tenant's rounds / a
 * round's games / a round's tags and refuse the create at the ceiling. Deleting
 * frees the quota, which is correct for a state cap.
 *
 * All ceilings are env-overridable so a deploy can tune them without a code
 * change, and are read per call so a test — or a live re-tune — picks up the
 * current env (matches the rate-limit ceilings in lib/app.js; see
 * .claude/rules/security-middleware.md).
 */

const accounts = require('./accounts');

const DEFAULT_ROUNDS_PER_TENANT = 10;
const DEFAULT_GAMES_PER_ROUND = 1000;
const DEFAULT_TAGS_PER_ROUND = 30;
const DEFAULT_EXPANSIONS_PER_GAME = 40;
const DEFAULT_MEMBERS_PER_ROUND = 50;
const DEFAULT_DISMISSED_PER_ROUND = 500;
const DEFAULT_FRIENDS_PER_USER = 500;
const DEFAULT_FRIEND_REQUESTS_PER_USER = 50;
const DEFAULT_PASSKEYS_PER_USER = 20;

// Quotas apply only in the public multi-tenant mode; inert otherwise.
function enforced() {
  return accounts.accountsEnabled();
}

// Max rounds one tenant may own (MAX_ROUNDS_PER_TENANT, default 10).
function roundsPerTenant() {
  return Number(process.env.MAX_ROUNDS_PER_TENANT) || DEFAULT_ROUNDS_PER_TENANT;
}

// Max games (active + archived — both hold a row and a possible cover) one round
// may hold (MAX_GAMES_PER_ROUND, default 1000).
function gamesPerRound() {
  return Number(process.env.MAX_GAMES_PER_ROUND) || DEFAULT_GAMES_PER_ROUND;
}

// Max expansions one game may hold (MAX_EXPANSIONS_PER_GAME, default 40).
// Unlike the caps above this bounds an ARRAY INSIDE the round document rather
// than a row count, so it is the one thing standing between a shelf and an
// unbounded blob — every read of the round carries it. 40 clears the largest
// real cupboard (BGG lists ~30 expansions for the biggest published lines)
// while keeping the worst case bounded at games × 40 short records.
function expansionsPerGame() {
  return Number(process.env.MAX_EXPANSIONS_PER_GAME) || DEFAULT_EXPANSIONS_PER_GAME;
}

// Max tags one round may define (MAX_TAGS_PER_ROUND, default 30).
function tagsPerRound() {
  return Number(process.env.MAX_TAGS_PER_ROUND) || DEFAULT_TAGS_PER_ROUND;
}

// Max member seats one round may hold (MAX_MEMBERS_PER_ROUND, default 50).
// Counts every seat, including the creator's own (#421) and any seat linked to an
// invited account (#207) — each is a row, an avatar in two strips and a column in
// every session's vote map. 50 is well clear of a real group while bounding what
// one round can grow to; the ceiling was added with the add-member route (#563),
// before which the member list was frozen at creation and needed no cap.
function membersPerRound() {
  return Number(process.env.MAX_MEMBERS_PER_ROUND) || DEFAULT_MEMBERS_PER_ROUND;
}

// Max recommendations one round may have dismissed at once
// (MAX_DISMISSED_RECOMMENDATIONS_PER_ROUND, default 500). Like the expansion cap
// this bounds an ARRAY INSIDE the round document rather than a row count, so it
// is what stands between one tap-happy round and an unbounded blob every read of
// that round carries. 500 is far past use — the screen offers 24 candidates at a
// time — so it only ever binds on abuse, and undismissing frees it again.
function dismissedPerRound() {
  return Number(process.env.MAX_DISMISSED_RECOMMENDATIONS_PER_ROUND) || DEFAULT_DISMISSED_PER_ROUND;
}

// Max accepted friends one account may hold (MAX_FRIENDS_PER_USER, default 500).
function friendsPerUser() {
  return Number(process.env.MAX_FRIENDS_PER_USER) || DEFAULT_FRIENDS_PER_USER;
}

// Max open (pending) OUTGOING friend requests one account may have at once
// (MAX_FRIEND_REQUESTS_PER_USER, default 50) — the real anti-spam control.
function friendRequestsPerUser() {
  return Number(process.env.MAX_FRIEND_REQUESTS_PER_USER) || DEFAULT_FRIEND_REQUESTS_PER_USER;
}

// Max passkeys one account may register (MAX_PASSKEYS_PER_USER, default 20).
// Like the two friend caps this is per ACCOUNT, and it bounds an array INSIDE
// the user document — every passkey rides in `identities`, which is read on
// every request that resolves a tenant, so an unbounded list would grow the hot
// path rather than just the table. 20 is far past a real person's device count
// (phone, laptop, tablet, a hardware key or two) and well short of a problem.
function passkeysPerUser() {
  return Number(process.env.MAX_PASSKEYS_PER_USER) || DEFAULT_PASSKEYS_PER_USER;
}

module.exports = {
  enforced,
  roundsPerTenant,
  gamesPerRound,
  tagsPerRound,
  expansionsPerGame,
  membersPerRound,
  dismissedPerRound,
  friendsPerUser,
  friendRequestsPerUser,
  passkeysPerUser,
  DEFAULT_ROUNDS_PER_TENANT,
  DEFAULT_GAMES_PER_ROUND,
  DEFAULT_TAGS_PER_ROUND,
  DEFAULT_EXPANSIONS_PER_GAME,
  DEFAULT_MEMBERS_PER_ROUND,
  DEFAULT_DISMISSED_PER_ROUND,
  DEFAULT_FRIENDS_PER_USER,
  DEFAULT_FRIEND_REQUESTS_PER_USER,
  DEFAULT_PASSKEYS_PER_USER,
};
