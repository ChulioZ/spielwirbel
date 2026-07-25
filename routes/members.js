'use strict';

/* Routes for the members of a round: edit name and avatar color.
   Mounted under /api/rounds/:rid/members (mergeParams for rid).
   Adding/removing members after round creation is intentionally out of scope. */

const express = require('express');
const repo = require('../lib/repo');
// The curated avatar palette, shared verbatim with the frontend rather than
// copied — a hand-kept copy drifted from it once already and rejected six of the
// eight swatches the UI offers (#420). Color is stored only when the user picks
// one; otherwise it is derived from the member's position at read time.
const { MEMBER_COLORS } = require('../public/js/member-colors');

const router = express.Router({ mergeParams: true });

// Edit a member's name and/or avatar color, or link/unlink an account (#135).
// Accepts any subset of { name, color, userId } — userId must be an existing
// user's id, or null to unlink (members stay name-only seats by default).
router.patch('/:mid', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  if (!round.members.some((m) => m.id === req.params.mid))
    return res.status(404).json({ error: 'Member not found' });

  const b = req.body;
  const patch = {};

  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name) return res.status(400).json({ error: 'Name is missing' });
    patch.name = name;
  }
  if (b.color !== undefined) {
    if (!MEMBER_COLORS.includes(b.color))
      return res.status(400).json({ error: 'Invalid color' });
    patch.color = b.color;
  }
  if (b.userId !== undefined) {
    if (b.userId === null) {
      patch.userId = null;
    } else {
      const user = await repo.getUserById(String(b.userId));
      if (!user) return res.status(400).json({ error: 'Unknown user' });
      patch.userId = user.id;
    }
  }

  // No activity entry: like the inline game edits, member tweaks are minor and
  // would just clutter the feed.
  const member = await req.repo.updateMember(req.params.rid, req.params.mid, patch);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  res.json(member);
});

module.exports = router;
