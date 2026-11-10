'use strict';

/* The round's opt-in draw boost (#1777, „Wer zu kurz kommt, ist dran"): when on,
   the session draw favours the favourites of the seated member whose favourites
   have reached the table least (lib/draw-boost.js). Off by default. Mounted at
   /api/rounds/:rid/draw-boost; mergeParams for :rid. */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../validate');

const router = express.Router({ mergeParams: true });

// STRICT, like the marker: a boolean toggle has no shape to fall back to. An
// object schema, so validateBody's falsy-means-rejected signal cannot read
// `false` as a rejection.
const drawBoostSchema = z.object({ on: z.boolean() }, { message: 'Invalid setting' });

router.patch('/', async (req, res) => {
  const body = validateBody(drawBoostSchema, req, res);
  if (!body) return;
  const result = await req.repo.setDrawBoost(req.params.rid, body.on);
  if (!result) return res.status(404).json({ error: 'Round not found' });
  res.json(result);
});

module.exports = router;
