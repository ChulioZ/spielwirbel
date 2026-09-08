'use strict';

/* Which MEMBERS of a round own a game (#971) — the validation both write paths
 * share, and the per-seat memory of the last selection.
 *
 * It is one module rather than two copies because `POST …/games` and
 * `POST …/lookup/import` are the same decision twice: the add sheet and the BGG
 * import sheet offer the identical picker, and a drifted copy would let one of
 * them store an id the other rejects
 * (.claude/rules/shared-constants-across-the-stack.md, applied within the
 * server rather than across the client boundary — nothing here is offered to a
 * client, so it stays in lib/ and not in public/js/ beside `ownedByParty`).
 */

// Coerce and validate an incoming owner list against the round's own seats.
//
// Returns the deduped ids, or null when any id is not a member — which the
// caller turns into a 400, exactly like an unknown tag. Absent/empty yields [],
// and the repo then leaves the key OFF the row, so an unmarked game keeps the
// shape it always had.
//
// Guests are not members and cannot appear here by construction
// (.claude/rules/session-guests-are-not-members.md): they have no seat id to
// send.
function resolveOwnerIds(raw, round) {
  const list = Array.isArray(raw) ? raw.map(String) : raw == null ? [] : [String(raw)];
  const ownerIds = [...new Set(list)];
  const seats = new Set((round.members || []).map((m) => m.id));
  if (ownerIds.some((x) => !seats.has(x))) return null;
  return ownerIds;
}

// Remember what the ADDER just picked, on their own seat, so the next add starts
// there (#971).
//
// Written after a successful create with exactly what was sent — an empty
// selection included, because "I took myself off the list" is a choice the next
// add must honour rather than silently undo. It is per seat, i.e. per user per
// round: a caller with no seat (a grantee, or an instance without accounts) has
// nowhere to store it and simply gets no memory.
//
// Best-effort by design: the games already exist, so a failed preference write
// must not turn a successful add into an error.
async function rememberOwnerPreset(repo, round, rid, userId, ownerIds) {
  if (!userId || !Array.isArray(ownerIds)) return;
  const seat = (round.members || []).find((m) => m.userId === userId);
  if (!seat) return;
  try {
    await repo.updateMember(rid, seat.id, { ownerPreset: ownerIds });
  } catch {
    /* the add succeeded; the preference is not worth failing it for */
  }
}

module.exports = { resolveOwnerIds, rememberOwnerPreset };
