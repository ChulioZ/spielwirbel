'use strict';

/*
 * Per-tenant quotas & abuse controls (issue #139).
 *
 * Bounds abuse once public multi-tenant sign-up opens (#219). Four state caps:
 *   - rounds per tenant          (checked in routes/rounds.js)
 *   - games per round            (checked in routes/games.js)
 *   - tags per round             (checked in routes/tags.js, #238)
 *   - members per round          (checked in routes/members.js, #563)
 *
 * Plus two per-ACCOUNT caps for the friendship layer (#325), which is a
 * cross-account social surface rather than tenant data — but the same shape
 * (env-tunable, read per call, distinct 403 code → localized toast):
 *   - accepted friends per user           (checked in routes/friends.js)
 *   - open outgoing friend requests per user (checked in routes/friends.js)
 * They are only ever reachable in accounts mode (the friend routes 404 when
 * accounts are off), so they need no separate enforced() gate.
 *
 * (A fourth per-tenant cap once bounded the billed buy-next recommendation spend
 * per tenant/month; it went away with the feature itself in #264.)
 *
 * Enforced ONLY in the public multi-tenant mode (accounts.accountsEnabled()).
 * With accounts off — today's single-tenant production behind the shared-password
 * gate, where every caller is the one 'default' tenant — the caps are inert, so
 * that instance is byte-for-byte unchanged and an existing group already past a
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
const DEFAULT_MEMBERS_PER_ROUND = 50;
const DEFAULT_FRIENDS_PER_USER = 500;
const DEFAULT_FRIEND_REQUESTS_PER_USER = 50;

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

// Max accepted friends one account may hold (MAX_FRIENDS_PER_USER, default 500).
function friendsPerUser() {
  return Number(process.env.MAX_FRIENDS_PER_USER) || DEFAULT_FRIENDS_PER_USER;
}

// Max open (pending) OUTGOING friend requests one account may have at once
// (MAX_FRIEND_REQUESTS_PER_USER, default 50) — the real anti-spam control.
function friendRequestsPerUser() {
  return Number(process.env.MAX_FRIEND_REQUESTS_PER_USER) || DEFAULT_FRIEND_REQUESTS_PER_USER;
}

module.exports = {
  enforced,
  roundsPerTenant,
  gamesPerRound,
  tagsPerRound,
  membersPerRound,
  friendsPerUser,
  friendRequestsPerUser,
  DEFAULT_ROUNDS_PER_TENANT,
  DEFAULT_GAMES_PER_ROUND,
  DEFAULT_TAGS_PER_ROUND,
  DEFAULT_MEMBERS_PER_ROUND,
  DEFAULT_FRIENDS_PER_USER,
  DEFAULT_FRIEND_REQUESTS_PER_USER,
};
