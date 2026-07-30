/* Spielwirbel – session participants: the round members who joined ONE session
   plus that session's guests (#458), and how those people group into playing
   parties when some of them form a team (#575). Every screen resolves a session
   id through here rather than against round.members.
   Pure and dependency-free apart from t(),
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

// Smallest team that is a team (#575). A group of one is a solo player, so the
// server drops such a team on the way in and the resolver below drops one that
// has shrunk to it since — otherwise the same person would appear both as a
// "team" and, everywhere teams are excluded, as themselves.
const MIN_TEAM_SIZE = 2;

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

// Name of a playing party: one person's label, or the members of a team joined
// into "Anna, Ben und Dana (Gast)" (#575). Teams are deliberately never named by
// hand — the names are already there, and a typed name would be a new free-text
// field per session to cap, moderate and disclose.
//
// core.js has the same two-line join as `joinNames`, and this file cannot call
// it: session-people.js loads BEFORE core.js (see index.html) and must stay
// requirable from Node, where core.js is not loadable at all. `t()` is the one
// dependency, read at call time.
function partyName(people) {
  const names = (people || []).map(personLabel);
  if (names.length <= 1) return names[0] || '';
  return names.slice(0, -1).join(', ') + ' ' + t('list.and') + ' ' + names[names.length - 1];
}

// The teams of ONE session (#575), resolved against its participants. Same
// absent-key convention as `guests`: no `teams` key means none.
//
// A team shrinks when one of its people is no longer resolvable (a member
// removed from the round after the fact), and is dropped entirely once fewer
// than MIN_TEAM_SIZE remain — a one-person team must not render as a team, or
// that person shows up twice on the winner picker. A person already claimed by
// an earlier team is skipped rather than shared, so the parties below stay a
// partition of the participants however the stored blob looks.
function teamsForPeople(people, session) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const claimed = new Set();
  const teams = [];
  (Array.isArray(session.teams) ? session.teams : []).forEach((tm) => {
    const members = [];
    (Array.isArray(tm.personIds) ? tm.personIds : []).forEach((pid) => {
      const person = byId.get(pid);
      if (person && !claimed.has(pid) && !members.includes(person)) members.push(person);
    });
    // Claim only once the team survives, or a dropped team would take its people
    // out of a later valid one.
    if (members.length < MIN_TEAM_SIZE) return;
    members.forEach((p) => claimed.add(p.id));
    teams.push({
      id: tm.id,
      people: members,
      personIds: members.map((p) => p.id),
      name: partyName(members),
    });
  });
  return teams;
}

function sessionTeams(round, session) {
  return teamsForPeople(sessionPeople(round, session), session);
}

// Everyone at the table as PLAYING PARTIES (#575): one entry per team plus one
// per un-teamed person, in sessionPeople order. This is the unit the draw's
// player range is matched against and the unit the winner picker offers, so a
// person who is in a team never appears on their own as well.
function sessionParties(round, session) {
  const people = sessionPeople(round, session);
  const teams = teamsForPeople(people, session);
  const teamOf = new Map();
  teams.forEach((tm) => tm.personIds.forEach((pid) => teamOf.set(pid, tm)));
  const seen = new Set();
  const parties = [];
  people.forEach((p) => {
    const tm = teamOf.get(p.id);
    if (!tm) {
      parties.push({ id: p.id, name: personLabel(p), people: [p], team: false });
      return;
    }
    if (seen.has(tm.id)) return;
    seen.add(tm.id);
    parties.push({ id: tm.id, name: tm.name, people: tm.people, team: true });
  });
  return parties;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAX_SESSION_GUESTS,
    GUEST_NAME_MAX,
    MIN_TEAM_SIZE,
    sessionPeople,
    personLabel,
    partyName,
    sessionTeams,
    sessionParties,
  };
}
