'use strict';

/* Route for a round's activity feed: delete a single entry.
   Mounted under /api/rounds/:rid/activities (mergeParams for rid). */

const express = require('express');
const { saveData, findRound } = require('../lib/store');

const router = express.Router({ mergeParams: true });

router.delete('/:aid', (req, res) => {
  const round = findRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  if (!Array.isArray(round.activities)) round.activities = [];
  const idx = round.activities.findIndex((a) => a.id === req.params.aid);
  if (idx === -1) return res.status(404).json({ error: 'Activity not found' });
  round.activities.splice(idx, 1);
  saveData();
  res.json({ ok: true });
});

module.exports = router;
