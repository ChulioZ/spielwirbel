'use strict';

/* Writing the session activity log (#209). The reading half — the type list and
   the phrasing — lives in `public/js/session-log.js`, which this requires so the
   two ends cannot drift: an event type the client has no phrase for would render
   as nothing at all, silently
   (.claude/rules/shared-constants-across-the-stack.md).

   Events are appended INSIDE the repo mutator's own `withSession` closure rather
   than by a second call afterwards. That is what makes the log atomic with the
   thing it records: a separate append could fail on its own, leaving a session
   whose votes changed with no entry saying so — a log that is quietly incomplete
   is worse than none, because it is read as authoritative. */

const { SESSION_EVENTS, SESSION_LOG_MAX } = require('../public/js/session-log');

// Build one entry. `actor` is the acting account's own seat in this round
// (lib/actor-seat.js) — a member id, or undefined on a password-only instance
// and for any request that carries no account. Undefined is left OUT rather than
// stored as null: the log is read as "we know who", and a null would render as
// an unknown actor that is indistinguishable from a real one we failed to
// resolve.
function sessionEvent(type, actor, payload) {
  return {
    at: new Date().toISOString(),
    type,
    ...(actor ? { actor } : {}),
    ...(payload || {}),
  };
}

// Append to a session blob, dropping anything not on the allowlist and bounding
// the list. Mutates, because it runs inside the mutator's closure on the object
// that closure is about to persist.
//
// The cap drops the OLDEST entries: a session's recent history is what someone
// looking at the screen is trying to reconstruct, and the opening "started" line
// is the one thing they can already infer from the session existing at all.
function pushSessionEvents(session, events) {
  const wanted = (Array.isArray(events) ? events : [events]).filter(
    (e) => e && SESSION_EVENTS[e.type]
  );
  if (!wanted.length) return;
  const log = Array.isArray(session.events) ? session.events : [];
  session.events = log.concat(wanted).slice(-SESSION_LOG_MAX);
}

module.exports = { sessionEvent, pushSessionEvents };
