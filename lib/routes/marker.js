'use strict';

/* The round's colour MARKER (#1187): a design-neutral index 0-7 that every
   design renders in its own eight colours (public/js/round-marker.js). Mounted
   at /api/rounds/:rid/marker; mergeParams for :rid.

   It is the one thing about a round's look a client can still set. The per-round
   design it replaced (palettes and worlds, #903-#905) and its
   POST /api/rounds/:rid/background route were retired at the flip (#1202); the
   `background` a round stored back then stays on the round only so a round that
   never picked a marker still resolves to the colour its old design maps to. */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../validate');
const { MARKER_COUNT } = require('../../public/js/round-marker');

const router = express.Router({ mergeParams: true });

/* The marker body. STRICT: a marker is a small integer with exactly eight legal
   values, so there is no "close enough" shape to fall back to and a wrong one is
   a client bug worth reporting. The bound is MARKER_COUNT rather than a literal
   8, so a design set that ever grows cannot leave the validator behind (and a
   shorter one cannot let an index through that renders `undefined`).

   The schema resolves to an OBJECT, not to the bare index, and that is
   load-bearing: validateBody() signals a rejection by returning `null` and every
   caller tests it with `if (!body)`, so a schema resolving to the NUMBER 0 —
   Standard, Tannenfilz, a perfectly valid marker — would be read as a rejection
   after the 400 had already been skipped. An object is always truthy. */
const markerSchema = z.object({
  index: z.number().int().min(0).max(MARKER_COUNT - 1, { message: 'Invalid marker' }),
}, { message: 'Invalid marker' });

router.patch('/', async (req, res) => {
  const body = validateBody(markerSchema, req, res);
  if (!body) return;

  const result = await req.repo.setMarker(req.params.rid, body.index);
  if (!result) return res.status(404).json({ error: 'Round not found' });
  res.json(result);
});

module.exports = router;
