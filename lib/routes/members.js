'use strict';

/* Routes for the members of a round: add a seat (#563), edit name and avatar
   color, and claim or release a seat as your own (#421).
   Mounted under /api/rounds/:rid/members (mergeParams for rid).
   REMOVING a member is still out of scope, and deliberately so: a member id is
   referenced by session votes, winnerIds and activity attribution, so a removed
   seat either orphans that history or silently rewrites it. That needs its own
   decision about archiving vs. deleting a seat (#563 scope note). */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../validate');
const quota = require('../quota');
// Who to attribute the new seat's activity to. Shared with lib/routes/games.js
// rather than copied — the copy that used to live in each of them is exactly how
// games.js came to credit its activities to the wrong member
// (.claude/rules/actor-seat-needs-a-uid-guard.md).
const { actorSeat } = require('../actor-seat');
// The curated avatar palette, shared verbatim with the frontend rather than
// copied — a hand-kept copy drifted from it once already and rejected six of the
// eight swatches the UI offers (#420). Color is stored only when the user picks
// one; otherwise it is derived from the member's position at read time.
const { MEMBER_COLORS } = require('../../public/js/member-colors');
// #137: the role ladder, shared with the frontend for the same reason. Used here
// rather than in lib/round-access.js's table because the cost of this route
// depends on which field the body carries — see the userId branch below.
const { can } = require('../../public/js/round-roles');

const router = express.Router({ mergeParams: true });

// Add-member body. `name` reuses the exact shape createRoundSchema normalizes
// each member entry with (stringify → trim → non-empty), so creating a round and
// adding a seat afterwards can never drift apart on what a valid name is.
const postMemberSchema = z.object({
  name: z.preprocess((v) => String(v || '').trim(), z.string().min(1, 'Name is missing')),
});

// Shape validation only (#213); the userId value's authorization matrix stays
// in the handler below — it depends on req.grant/req.userId, not on the body.
const patchMemberSchema = z.object({
  name: z.preprocess(
    (v) => (v === undefined ? undefined : String(v).trim()),
    z.string().min(1, 'Name is missing')
  ).optional(),
  color: z.unknown()
    .refine((v) => v === undefined || MEMBER_COLORS.includes(v), { message: 'Invalid color' })
    .optional(),
  userId: z.unknown().optional(),
});

// Add a name-only seat to an existing round (#563). Groups change, and until this
// existed the only ways to seat a new regular player were to rebuild the round
// (discarding every session, rating and trophy), invite them as an account (#207 —
// which grants round ACCESS and can only fill a seat that already exists), or add
// them as a session guest (#458 — deliberately per-session, which is exactly why
// promoting a guest was declined in #531).
//
// A GRANTEE may do this: it is acting *within* the round, the same class as
// editing a member's name, which grantees can already do. The owner-only line
// (.claude/rules/round-grant-resolver.md) is drawn at destroying the round or
// reparenting its shelf, and adding a seat is neither — so no req.grant guard.
router.post('/', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const b = validateBody(postMemberSchema, req, res);
  if (!b) return;

  // A state cap, so deleting a round frees it; inert unless accounts are on
  // (.claude/rules/per-tenant-quotas.md). Checked after validation so a blank
  // name is still reported as a blank name on a full round.
  if (quota.enforced() && round.members.length >= quota.membersPerRound()) {
    return res.status(403).json({ error: 'quota_members', limit: quota.membersPerRound() });
  }

  // `{ name }` only: the seat must carry NO userId key at all. It is a name-only
  // seat — the account link is self-claim (#421), made afterwards by its owner
  // through PATCH below. A `userId: null` here would also split the two backends'
  // absent-key parity (.claude/rules/postgres-backend.md).
  const member = await req.repo.createMember(req.params.rid, { name: b.name }, actorSeat(round, req.userId));
  if (!member) return res.status(404).json({ error: 'Round not found' });
  res.status(201).json(member);
});

// Edit a member's name and/or avatar color, or claim/release the seat as your
// own (#421). Accepts any subset of { name, color, userId } — userId may only
// ever be the CALLER's own id (claim) or null (release their own seat).
router.patch('/:mid', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const member = round.members.find((m) => m.id === req.params.mid);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const b = validateBody(patchMemberSchema, req, res);
  if (!b) return;
  const patch = {};

  if (b.name !== undefined) patch.name = b.name;
  if (b.color !== undefined) patch.color = b.color;
  // #421: the account link is SELF-CLAIM ONLY. Before this the route took any
  // existing user's id from anyone with round access, so a hand-crafted request
  // could seat a stranger — or, worse, null out a GRANTEE's seat, which leaves
  // them with full access (their grant matches on roundId+userId and never
  // consults grant.memberId) and no chair, invitable to someone else. Every
  // refusal below is therefore about *whose* seat this is, not about the value
  // being well-formed.
  if (b.userId !== undefined) {
    // A grantee's seat is linked at invitation-accept and released by
    // DELETE …/shares/:userId, which drops the grant and the link together.
    // Letting them patch it here would desync round_grants.memberId from the
    // seat. Name/colour edits stay open to grantees, which is why this is decided
    // here rather than in lib/round-access.js's table: the route's cost depends on
    // which FIELD the body carries. It reads the same capability table, so "who
    // may relink a seat" still has one definition — and 'member.link' is owner-only
    // for every grantee role, co-owners included, because the desync it prevents
    // is not about trust.
    if (!can(req.roundRole, 'member.link')) return res.status(403).json({ error: 'not_owner' });
    if (!req.userId) return res.status(403).json({ error: 'not_self' });

    if (b.userId === null) {
      // Release: only your own seat. Refusing on someone else's is what stops
      // an owner stranding a grantee.
      if (member.userId !== req.userId) return res.status(403).json({ error: 'not_self' });
      patch.userId = null;
    } else if (String(b.userId) === req.userId) {
      if (member.userId && member.userId !== req.userId)
        return res.status(409).json({ error: 'seat_taken' });
      // One seat per account per round: actorSeat (lib/routes/games.js) and seatOf
      // (lib/routes/invitations.js) both .find(), so two seats is undefined behaviour.
      if (round.members.some((m) => m.userId === req.userId && m.id !== req.params.mid))
        return res.status(400).json({ error: 'already_seated' });
      patch.userId = req.userId;
    } else {
      return res.status(403).json({ error: 'not_self' });
    }
  }

  // No activity entry: like the inline game edits, member tweaks are minor and
  // would just clutter the feed.
  const updated = await req.repo.updateMember(req.params.rid, req.params.mid, patch);
  if (!updated) return res.status(404).json({ error: 'Member not found' });
  res.json(updated);
});

module.exports = router;
