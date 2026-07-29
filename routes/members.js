'use strict';

/* Routes for the members of a round: edit name and avatar color, and claim or
   release a seat as your own (#421).
   Mounted under /api/rounds/:rid/members (mergeParams for rid).
   Adding/removing members after round creation is intentionally out of scope. */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../lib/validate');
// The curated avatar palette, shared verbatim with the frontend rather than
// copied — a hand-kept copy drifted from it once already and rejected six of the
// eight swatches the UI offers (#420). Color is stored only when the user picks
// one; otherwise it is derived from the member's position at read time.
const { MEMBER_COLORS } = require('../public/js/member-colors');

const router = express.Router({ mergeParams: true });

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
    // seat. Name/colour edits stay open to grantees.
    if (req.grant) return res.status(403).json({ error: 'not_owner' });
    if (!req.userId) return res.status(403).json({ error: 'not_self' });

    if (b.userId === null) {
      // Release: only your own seat. Refusing on someone else's is what stops
      // an owner stranding a grantee.
      if (member.userId !== req.userId) return res.status(403).json({ error: 'not_self' });
      patch.userId = null;
    } else if (String(b.userId) === req.userId) {
      if (member.userId && member.userId !== req.userId)
        return res.status(409).json({ error: 'seat_taken' });
      // One seat per account per round: actorSeat (routes/games.js) and seatOf
      // (routes/invitations.js) both .find(), so two seats is undefined behaviour.
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
