'use strict';

/* Route for a round's design (page background + accent color + texture).
   Mounted under /api/rounds/:rid/background (mergeParams for rid). */

const express = require('express');
const { z } = require('zod');
const storage = require('../storage');

const router = express.Router({ mergeParams: true });

// Deliberately lenient (#213-style shape, but never a 400): anything that
// isn't a well-formed theme/color body falls back to { type: 'none' }, which
// is the pre-zod behaviour ("default" design). z.object strips unknown keys,
// so a legacy "pattern" field never reaches the store — which is also why
// `id` (#903, the design's stable identity) has to be NAMED here: unlisted, it
// would vanish on save with no error anywhere and the world would revert to a
// palette on the next load. It is stored, not validated against the shipped
// set: an unknown id resolves to the plain palette on the client
// (public/js/round-designs.js), and a server-side list would make that file a
// cross-boundary contract (.claude/rules/shared-constants-across-the-stack.md).
const backgroundSchema = z.union([
  z.object({ type: z.literal('theme'), id: z.string().max(32).optional(), page: z.string(), accent: z.string() }),
  z.object({ type: z.literal('color'), color: z.string() }),
]).catch({ type: 'none' });

// Remove an old collage image when the background changes (legacy data).
async function cleanupOldBackground(old, newBg) {
  if (old && old.type === 'collage' && old.image && (!newBg || newBg.image !== old.image)) {
    await storage.remove(old.image);
  }
}

// Set a design (background + accent), a legacy plain color, or "default".
router.post('/', async (req, res) => {
  const bg = backgroundSchema.parse(req.body || {});

  const result = await req.repo.setBackground(req.params.rid, bg);
  if (!result) return res.status(404).json({ error: 'Round not found' });
  await cleanupOldBackground(result.previous, bg);
  res.json({ background: bg });
});

module.exports = router;
