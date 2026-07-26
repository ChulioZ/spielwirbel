/* Spielwirbel – session participants: the round members who joined ONE session
   plus that session's guests (#458). Pure and dependency-free apart from t(),
   which is only read at call time, so it works both as a shared-scope frontend
   script (browser global) and as a CommonJS module the test suite can require.
   Load order: see index.html. */

'use strict';

// How many guests one session may take. The server caps the list at this number
// and the setup screen refuses to add past it, so this file is required by
// routes/sessions.js as the single source of truth — a hand-copied second number
// would drift and the excess guests would be dropped silently
// (.claude/rules/shared-constants-across-the-stack.md).
const MAX_SESSION_GUESTS = 10;

// Longest a guest name may be. The setup screen sets it as the input's
// `maxlength` and the server truncates at it — same one-source-of-truth reason as
// above, and the failure mode is nastier: a drifted pair silently stores a
// shorter name than the user typed.
const GUEST_NAME_MAX = 30;

// Everyone taking part in one session, members first, in a stable order.
// Two absent-key conventions meet here and they are NOT the same:
//  - `memberIds` absent means "everyone in the round" (back-compat: sessions
//    predating the seat picker never stored one);
//  - `guests` absent means "none", exactly like `[]` — unlike round.providers
//    there is no meaningful third state (.claude/rules/round-provider-config.md).
// Every screen that used to resolve an id against `round.members` has to go
// through this instead: a guest id is a vote-map and winnerIds key too, but has
// no member row behind it.
function sessionPeople(round, session) {
  const joined = Array.isArray(session.memberIds)
    ? round.members.filter((m) => session.memberIds.includes(m.id))
    : round.members;
  const people = joined.map((m) => ({ id: m.id, name: m.name, guest: false }));
  const guests = Array.isArray(session.guests) ? session.guests : [];
  guests.forEach((g) => people.push({ id: g.id, name: g.name, guest: true }));
  return people;
}

// Display name for one participant: "Anna (Gast)" for a guest, "Anna" for a
// member. Routing every name through one helper is what keeps a bare guest name
// from slipping onto a screen — the marker is the only thing distinguishing a
// one-evening visitor from a member of the group.
function personLabel(person) {
  if (!person) return '';
  return person.guest ? t('people.guest', { name: person.name }) : person.name;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MAX_SESSION_GUESTS, GUEST_NAME_MAX, sessionPeople, personLabel };
}
