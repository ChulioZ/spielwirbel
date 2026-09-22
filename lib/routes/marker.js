'use strict';

/* Routes for how a round is COLOURED, both halves of the transition (#1187).

   `PATCH /` sets the round's colour marker — a design-neutral index 0-7 that
   every design renders in its own eight colours (public/js/round-marker.js).
   This is the one a client speaks today; it is mounted at
   /api/rounds/:rid/marker.

   `POST /` is the RETIRED per-round design (page background + accent + texture),
   still mounted at /api/rounds/:rid/background so rounds that carry one keep it
   and an older client cannot 404. Nothing in the app writes it any more — the
   settings screen became a marker picker — and it goes at the flip (#1202) with
   the worlds themselves.

   One file, TWO routers — not one router mounted twice. That was the first cut,
   and lib/round-access.js's default-deny guard caught it: a router mounted under
   both paths registers BOTH verbs at BOTH paths, so the app grew a `PATCH
   /background` and a `POST /marker` that the capability table does not name and
   that nobody meant to ship. `test/round-roles.test.js` names them; the routers
   are separate so the route set is exactly the two routes above.

   mergeParams for :rid on both. */

const express = require('express');
const { z } = require('zod');
const storage = require('../storage');
const { validateBody } = require('../validate');
const { MARKER_COUNT, LEGACY_MARKER_INDEX } = require('../../public/js/round-marker');

const router = express.Router({ mergeParams: true });
const background = express.Router({ mergeParams: true });

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
  z.object({ type: z.literal('theme'), id: z.string().max(32).optional(), page: z.string().max(32), accent: z.string().max(32) }),
  z.object({ type: z.literal('color'), color: z.string().max(32) }),
]).catch({ type: 'none' });

// Remove an old collage image when the background changes (legacy data).
async function cleanupOldBackground(old, newBg) {
  if (old && old.type === 'collage' && old.image && (!newBg || newBg.image !== old.image)) {
    await storage.remove(old.image);
  }
}

/* The marker body. STRICT, unlike its background sibling below: a marker is a
   small integer with exactly eight legal values, so there is no "close enough"
   shape to fall back to and a wrong one is a client bug worth reporting. The
   bound is MARKER_COUNT rather than a literal 8, so a design set that ever grows
   cannot leave the validator behind (and a shorter one cannot let an index
   through that renders `undefined`).

   The union's second arm is the TRANSITIONAL shape: a client still sending the
   retired `{ type: 'theme', id }` design body gets its design mapped onto the
   marker it becomes, rather than a 400. It is the same table the client resolves
   legacy rounds with — one list, no copy — and it is removed at the flip
   (#1202) along with everything else that knows a world's name.

   BOTH ARMS TRANSFORM TO AN OBJECT, not to the bare index, and that is
   load-bearing: validateBody() signals a rejection by returning `null` and every
   caller tests it with `if (!body)`, so a schema resolving to the NUMBER 0 —
   Standard, Tannenfilz, a perfectly valid marker — would be read as a rejection
   after the 400 had already been skipped. An object is always truthy. */
const markerSchema = z.union([
  z.object({
    index: z.number().int().min(0).max(MARKER_COUNT - 1, { message: 'Invalid marker' }),
  }),
  z.object({ type: z.literal('theme'), id: z.string().max(32) })
    .transform(({ id }) => ({ index: LEGACY_MARKER_INDEX[id] }))
    .refine(({ index }) => Number.isInteger(index), { message: 'Unknown design' }),
], { message: 'Invalid marker' });

router.patch('/', async (req, res) => {
  const body = validateBody(markerSchema, req, res);
  if (!body) return;

  const result = await req.repo.setMarker(req.params.rid, body.index);
  if (!result) return res.status(404).json({ error: 'Round not found' });
  res.json(result);
});

// Set a design (background + accent), a legacy plain color, or "default".
background.post('/', async (req, res) => {
  const bg = backgroundSchema.parse(req.body || {});

  const result = await req.repo.setBackground(req.params.rid, bg);
  if (!result) return res.status(404).json({ error: 'Round not found' });
  await cleanupOldBackground(result.previous, bg);
  res.json({ background: bg });
});

/* Two named exports rather than this repo's usual bare router, because there are
   two of them. lib/app.js mounts each at its own path, and
   test/round-roles.test.js walks each separately. */
module.exports = { marker: router, background };
