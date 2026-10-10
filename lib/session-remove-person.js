'use strict';

/* Taking one person out of a stored session (#1538) — the mutation both repo
   backends apply inside their own `withSession` read-modify-write, so the two
   cannot drift on what a removal does (the same closure-sharing the other
   session mutators already rely on, written once here because this one has
   enough rules to be worth a spec of its own).

   A removed person did NOT take part. They leave `memberIds`/`guests`, which is
   what `sessionPeople()` reads, so every session-scoped reader — the tally,
   teams, winners, the Chronik, member and user stats, badges, the vote routes'
   participant check — drops them with no per-site edit. Their `votes` column is
   deliberately KEPT: the shelf-wide readers go through `sessionRaters()`, which
   adds `removedPeople` back, so what they had rated still counts for each game.
   Deleting the column instead would silently pull those ratings out of every
   game's score. */

const { MIN_TEAM_SIZE } = require('../public/js/session-people');

// `roundMemberIds` is only read for a LEGACY session with no `memberIds`, which
// means "everyone in the round": that has to be materialised first, or taking
// one member out would have nothing to take them out of.
function removePersonFromSession(session, personId, roundMemberIds) {
  const s = session;
  const guest = (Array.isArray(s.guests) ? s.guests : []).find((g) => g.id === personId);
  if (!Array.isArray(s.memberIds)) s.memberIds = (roundMemberIds || []).slice();
  if (guest) s.guests = s.guests.filter((g) => g.id !== personId);
  else if (s.memberIds.includes(personId)) s.memberIds = s.memberIds.filter((id) => id !== personId);
  else return; // not a participant (any more) — a concurrent removal got here first

  if (Array.isArray(s.winnerIds)) s.winnerIds = s.winnerIds.filter((id) => id !== personId);

  // A team that falls below MIN_TEAM_SIZE dissolves and its rest play alone.
  // The resolver would hide it anyway (session-people.js), but a stored one-person
  // team would come back as a team the moment anyone re-joined it.
  if (Array.isArray(s.teams)) {
    s.teams = s.teams
      .map((tm) => ({ ...tm, personIds: (tm.personIds || []).filter((id) => id !== personId) }))
      .filter((tm) => tm.personIds.length >= MIN_TEAM_SIZE);
    if (!s.teams.length) delete s.teams;
  }

  // Back to unset, so the table builder recomputes from the people left (#796);
  // setSessionTableProposals only ever writes into an unset slot.
  delete s.tableProposals;

  // Points (#1630) are keyed by the seat that scored them — the person, or the
  // team they played in. Both stop existing as seats here, so their entries go
  // too rather than lingering as keys no party can name any more.
  if (s.scores && typeof s.scores === 'object') {
    const seats = new Set([...(s.memberIds || []), ...(s.guests || []).map((g) => g.id), ...(s.teams || []).map((tm) => tm.id)]);
    Object.keys(s.scores).forEach((k) => { if (!seats.has(k)) delete s.scores[k]; });
    if (!Object.keys(s.scores).length) delete s.scores;
  }

  const removed = Array.isArray(s.removedPeople) ? s.removedPeople : [];
  s.removedPeople = removed
    .filter((r) => r.id !== personId)
    .concat(guest ? [{ id: personId, guest: true, name: guest.name }] : [{ id: personId }]);
}

module.exports = { removePersonFromSession };
