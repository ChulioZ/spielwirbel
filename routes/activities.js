'use strict';

/* Route for a round's activity feed: delete a single entry.
   Mounted under /api/rounds/:rid/activities (mergeParams for rid). */

const express = require('express');
const repo = require('../lib/repo');

const router = express.Router({ mergeParams: true });

router.delete('/:aid', async (req, res) => {
  const round = await repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const deleted = await repo.deleteActivity(req.params.rid, req.params.aid);
  if (!deleted) return res.status(404).json({ error: 'Activity not found' });
  res.json({ ok: true });
});

module.exports = router;
