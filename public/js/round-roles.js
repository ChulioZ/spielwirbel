/* Spielwirbel – who may do what inside a shared round (#137). The role ladder,
   the capability each guarded action needs, and the predicate that answers
   "may this role do that". Pure and dependency-free, so it works both as a
   shared-scope frontend script (browser global) and as a CommonJS module the
   server and the test suite can require. Load order: see index.html.

   It is ONE file because both sides answer the same question: the views hide an
   action a role may not perform and lib/round-access.js refuses it, so a drifted
   copy either offers a button that 403s or hides one the caller is entitled to —
   silently, with no error anywhere
   (.claude/rules/shared-constants-across-the-stack.md). The route TABLE that maps
   each URL to a capability stays server-side in lib/round-access.js: the client
   never speaks in paths, only in capabilities. */

'use strict';

// The ladder, most powerful first. `owner` is IMPLICIT — the round's owner holds
// no grant at all, so this value never appears in round_grants.role; it is what
// lib/round-access.js assigns when no grant is in play (which also covers legacy
// accounts-off mode, where nobody holds a grant and every caller owns the round).
const ROUND_ROLES = ['owner', 'coowner', 'editor'];

// Higher wins. Kept as an explicit map rather than an indexOf over the array so
// an unknown value can be told apart from a valid one (indexOf's -1 would sort
// below `editor` and quietly deny everything, which reads as a permissions bug
// rather than as bad data).
const ROLE_RANK = { owner: 3, coowner: 2, editor: 1 };

// Grants written before #137 carry the string 'member' — a placeholder that
// predates any role meaning (createGrant's old default; invitations.js wrote it
// explicitly). It is NOT a fourth level and is never displayed: it reads as
// `editor`, which is exactly what such a grantee could already do, so every live
// share keeps behaving as it did. New grants are written as a real role, so this
// only ever covers rows already in the database — no migration code (CLAUDE.md).
//
// It is DELIBERATELY REDUNDANT with the unknown-value fallback below, which would
// resolve 'member' to `editor` anyway: removing either one alone changes nothing,
// and only removing both moves the behaviour (verified by breaking exactly that —
// .claude/rules/break-the-code-on-purpose.md). It is kept because the fallback's
// job is to be safe about values nobody anticipated, while this states an intent
// about one value we know is out there — so if the fallback is ever retuned, the
// live rows it covers do not quietly move with it.
const LEGACY_GRANT_ROLE = 'member';

// An unknown or absent value resolves to the LOWEST role, never to owner: this
// runs on data from the database, and a typo or a future role this build has not
// heard of must lose power rather than gain it (the allowlist-not-denylist shape
// .claude/rules/ci-aggregate-gate.md argues for).
function normalizeRole(role) {
  if (role === LEGACY_GRANT_ROLE) return 'editor';
  return ROLE_RANK[role] ? role : 'editor';
}

// What each guarded action costs. Anything NOT listed here is an ordinary
// round write — adding a game, running a session, editing a member — and needs
// `editor`, i.e. any grantee may do it.
//
// The owner-only four are the pre-#137 hand-placed guards, unchanged in effect;
// the co-owner four are the destructive actions an owner may now delegate
// (operator decision, 2026-08-13). The split is "destroys shared history or the
// round's shape" (coowner) versus "changes who may reach the round at all, or
// where its data lives" (owner) — a co-owner is trusted with the group's
// content, never with its access control, so they cannot promote themselves.
//
// The editor-level entry below resolves to DEFAULT_CAPABILITY_ROLE anyway and is
// stated for the reason 'round.write' is stated in lib/round-access.js's table:
// a requirement written down beats one implied by omission, and this one exists
// precisely to be told apart from the co-owner capability it was split out of.
const CAPABILITY_ROLE = {
  // Owner only.
  'round.delete': 'owner',          // DELETE the round + every session, rating, cover
  'round.shares.manage': 'owner',   // revoke someone ELSE's access, or change their role
  'member.link': 'owner',           // relink a seat to an account (keeps grant.memberId in sync)
  'games.moveOut': 'owner',         // reparent the shelf into another round (#411)
  // Co-owner and up.
  'round.edit': 'coowner',          // rename the round / change its design
  'game.delete': 'coowner',         // delete an archived game, and its whole rating history
  'session.delete': 'coowner',      // delete a played evening's votes, result and winners
  'activity.delete': 'coowner',     // delete an entry from the shared Chronik
  // Any grantee.
  // Throwing away a session whose voting is STILL OPEN (#857). It shares a route
  // and a method with 'session.delete' and differs only in the session's state,
  // so lib/round-access.js's table names this one as the floor and the handler
  // narrows to 'session.delete' for anything that is no longer a running vote —
  // `done` OR `cancelled`, since cancelling never sets `done`. The two are a
  // different kind of act, not a different amount of one: a running vote has no
  // result, no winners and no Chronik entry, so discarding it is part of running
  // the evening — which is what a shared round's co-players are there for —
  // while deleting a played or cancelled one destroys history the group can see.
  'session.discard': 'editor',
};

// The floor for anything not named above.
const DEFAULT_CAPABILITY_ROLE = 'editor';

function capabilityRole(capability) {
  return CAPABILITY_ROLE[capability] || DEFAULT_CAPABILITY_ROLE;
}

// May `role` perform `capability`? The one predicate both sides call.
function can(role, capability) {
  return ROLE_RANK[normalizeRole(role)] >= ROLE_RANK[capabilityRole(capability)];
}

// The frontend's entry point: may the caller do this in THIS round? A round
// payload carries `shared`/`role` only for a grantee (lib/routes/rounds.js), so
// their absence is what means "you own it" — which is also why this must not be
// written as `can(round.role, …)`: an owner's round has no `role` key, and
// normalizeRole would read that undefined as the LOWEST role and hide every
// guarded action from the person who owns the round.
function roundCan(round, capability) {
  return can(round && round.shared ? round.role : 'owner', capability);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ROUND_ROLES,
    ROLE_RANK,
    LEGACY_GRANT_ROLE,
    CAPABILITY_ROLE,
    DEFAULT_CAPABILITY_ROLE,
    normalizeRole,
    capabilityRole,
    can,
    roundCan,
  };
}
