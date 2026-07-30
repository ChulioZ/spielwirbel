'use strict';

/*
 * Who to attribute a round activity to (#207 attribution, fixed in #563).
 *
 * Activity entries carry an optional `actorMemberId`, which the Chronik renders
 * as "· von Anna". Resolving it is one line, and the obvious version is wrong in
 * a way that produces a plausible name instead of no name — so it lives here
 * once rather than being copied into each route that logs an activity.
 *
 * See .claude/rules/actor-seat-needs-a-uid-guard.md for the measurement.
 */

// The acting account's own seat in this round, or undefined when there isn't one
// (addActivity omits the key entirely for a falsy value).
//
// The `uid ?` guard is the whole point. An unclaimed seat carries NO `userId`
// key, so `m.userId` is `undefined`; without the guard a call with no uid —
// every request in accounts-off mode, where `req.userId` is never set — matches
// the FIRST unlinked seat and credits the action to whoever sits there.
function actorSeat(round, uid) {
  if (!uid) return undefined;
  const seat = (round.members || []).find((m) => m.userId === uid);
  return seat ? seat.id : undefined;
}

module.exports = { actorSeat };
