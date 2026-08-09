'use strict';

/* Public vote-by-link routes (issue #652), mounted at /api/vote OUTSIDE the auth
   gate — the whole point is that the caller has no account.

   The token is a capability for exactly two actions on exactly one session: read
   that session's ballot, and write one claimed participant's votes. It authorizes
   nothing else, and it is not an identity — see .claude/rules/vote-link-capability.md.

   THE ONE GATE. `openBallot()` below is the single place that decides whether a
   token still works: the row must resolve, the session must exist, and it must be
   a per-device session that is still collecting votes. Both handlers go through
   it, and every refusal — unknown token, deleted round, erased account, closed or
   cancelled session, a hot-seat session — answers the SAME 404 `invalid_link`.

   That uniformity is deliberate on both counts:

   - It is why deleting link rows elsewhere is hygiene rather than access control.
     A cascade with N call sites has N chances to be missed, and each miss would be
     a live ballot; this gate re-derives the answer from the session every time, so
     a stale row is inert by construction.
   - It leaves no oracle. A distinct "expired" or "closed" state would tell a
     stranger holding a guessed token that they had guessed a REAL one, which is
     the only feedback brute force needs. */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../validate');
const repo = require('../repo');
const { sessionEvent } = require('../session-events');
const { sanitizePersonVotes, sessionParticipantIds, votedPersonIds } = require('../session-votes');
// The avatar palette, shared with the client that renders it and the members route
// that validates it — one file, never a copy.
const { MEMBER_COLORS } = require('../../public/js/member-colors');
// The age half of the gate (#652) — an abandoned session reaches none of the five
// event-driven deletions, so without a TTL its link never stops working.
const { isVoteLinkExpired } = require('../vote-link');

const router = express.Router();

// Same lenient shape as the in-app per-person write: a map, anything else falls
// back to {}. The real filtering is sanitizePersonVotes, shared with that route.
const voteSchema = z.object({
  votes: z.record(z.string(), z.unknown()).catch({}),
});

// Resolve a token to { tenantId, round, session }, or null if the link is not
// usable for ANY reason. The single gate — see the header.
async function openBallot(token) {
  const link = await repo.findSessionVoteLink(token);
  if (!link) return null;
  // Age is checked HERE, not only by the sweep, for the same reason the session
  // state is: this is the authoritative gate, and the sweep is hygiene that runs
  // on a 15-minute tick. Without it an expired link would keep working until the
  // next tick happened to reach it — and on a session nobody ever closed, the
  // five event-driven deletions never fire at all (lib/vote-link.js).
  if (isVoteLinkExpired(link)) return null;
  // Scope every follow-up read to the tenant the token resolved to. This is the
  // only place a tenant enters an unauthenticated request, and it comes from our
  // own row — never from anything the caller sent.
  const scoped = repo.forTenant(link.tenantId);
  const round = await scoped.getRound(link.roundId);
  if (!round) return null;
  const session = (round.sessions || []).find((s) => s.id === link.sessionId);
  if (!session) return null;
  // The state gate, matching the in-app write's own refusals. Since #655 every
  // session collects votes this way, so there is no mode to check — only whether
  // this one is still collecting.
  if (session.done || session.cancelled) return null;
  return { tenantId: link.tenantId, round, session };
}

const invalid = (res) => res.status(404).json({ error: 'invalid_link' });

// The ballot: what a link holder needs to vote, and nothing else.
//
// Note what is NOT here. No vote values — `redactRoundVotes` already strips them
// from an open per-device session's round read, and this response is built field
// by field rather than by deleting keys off the session, so a future session field
// cannot leak by being forgotten. No members who did not join, no other sessions,
// no activities, no round settings, no account or tenant identifiers.
router.get('/:token', async (req, res) => {
  const open = await openBallot(req.params.token);
  if (!open) return invalid(res);
  const { round, session } = open;

  const voted = new Set(votedPersonIds(session));
  const games = (session.gameIds || [])
    .map((gid) => (round.games || []).find((g) => g.id === gid))
    .filter(Boolean)
    // weight/description (#717) join the projection so a link voter gets the
    // same "what is this game like?" facts as the hot-seat card. Still built
    // field by field — the whitelist stays the shape that stops a future
    // session field leaking by being forgotten.
    .map((g) => ({
      id: g.id,
      title: g.title,
      image: g.image || null,
      weight: g.weight == null ? null : g.weight,
      description: g.description == null ? null : g.description,
    }));

  // Members first, then guests — the same order sessionPeople() builds in the app,
  // so the claim list reads identically on both surfaces. A guest is marked so the
  // client can render the „(Gast)" suffix and omit the retire control, exactly as
  // the in-app card does (.claude/rules/session-guests-are-not-members.md §4).
  //
  // The avatar colour is resolved HERE rather than sent as raw member rows for the
  // client to index. `memberColor()` derives an unset colour from the member's
  // position in the round's FULL member list — which this response deliberately
  // does not carry (people who sat this session out are none of a link holder's
  // business) — so a client-side derivation would have to be fed a fake round and
  // would quietly hand everyone the wrong swatch. Same source of truth as the
  // members route, which requires the identical file
  // (.claude/rules/shared-constants-across-the-stack.md).
  const all = round.members || [];
  const colorOf = (m, idx) =>
    (MEMBER_COLORS.includes(m.color) ? m.color : MEMBER_COLORS[idx % MEMBER_COLORS.length]);
  const people = [
    ...all
      .map((m, idx) => ({ m, idx }))
      .filter(({ m }) => (session.memberIds || []).includes(m.id))
      .map(({ m, idx }) => ({ id: m.id, name: m.name, guest: false, color: colorOf(m, idx) })),
    // A guest gets no swatch: they are not a round member, so there is no position
    // to derive one from, and the client paints them the neutral guest tone that
    // personColor() already uses (#458).
    ...(session.guests || []).map((g) => ({ id: g.id, name: g.name, guest: true, color: null })),
  ].map((p) => ({ ...p, hasVoted: voted.has(p.id) }));

  // The round name is the one piece of context that makes the link recognisable
  // in a chat ("is this our Freitagsrunde or the other one?"). Nothing else about
  // the round travels.
  res.json({ roundName: round.name, games, people });
});

// Write one claimed participant's column.
//
// Authority is the token plus the claim, which is the same trusted-group model the
// in-app per-device write already has: anyone who can reach the round may write any
// joined person's column (.claude/rules/per-device-session-voting.md §3). So this
// route does not weaken anything — it extends the existing authority to whoever the
// group handed the link to, which is exactly what sharing it means.
//
// Overwriting an already-voted person is therefore allowed, and the CLIENT asks
// first. Refusing here would strand anyone who mis-tapped a name, with no way back.
router.post('/:token/votes/:pid', async (req, res) => {
  const open = await openBallot(req.params.token);
  if (!open) return invalid(res);
  const { tenantId, round, session } = open;

  if (!sessionParticipantIds(session).has(req.params.pid)) return invalid(res);

  const body = validateBody(voteSchema, req, res);
  if (!body) return;

  // The round and session ids come from the resolved LINK, never from the request:
  // the caller supplies only the token and the person they claim to be.
  const updated = await repo.forTenant(tenantId).saveSessionPersonVotes(
    round.id,
    session.id,
    req.params.pid,
    sanitizePersonVotes(body.votes, session, req.params.pid),
    // No actor. A link voter has no account, and `sessionLogLines` renders an
    // actor-less `voted` entry as „Anna hat abgestimmt" — which is the honest
    // reading here (the person rated, on their own device) and needs no new event
    // type. Writing a placeholder actor would be the device claim
    // .claude/rules/per-device-session-voting.md §5 forbids.
    sessionEvent('voted', null, { personId: req.params.pid })
  );
  if (!updated) return invalid(res);
  // Never echo the session back: it carries every other person's column, and this
  // is the one route an unauthenticated device calls.
  res.json({ ok: true });
});

module.exports = router;
