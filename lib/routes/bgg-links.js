'use strict';

/*
 * POST /api/bgg-links (#1638) — resolve category, mechanic and designer NAMES
 * to their BoardGameGeek ids, so the game detail screen and the Regal-Steckbrief
 * can link each name to its BGG page.
 *
 *   { category: [names], mechanic: [names], designer: [names] }
 *     -> { category: { <name>: <id> }, mechanic: {…}, designer: {…} }
 *
 * Instance-wide data, so no `:rid` and no req.repo: the table is global and
 * holds public BGG metadata (lib/repo/index.js). Mounted BEHIND the /api gate
 * and withTenant like /api/price-watches, so only a signed-in caller can ask,
 * and under the global /api rate limiter. A POST rather than a GET because a
 * heavy game's names do not fit a sensible query string.
 *
 * Names the table does not hold are simply absent from the answer, which the
 * client renders as plain text — exactly what it showed before this feature.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../repo');
const { validateBody } = require('../validate');
const { BGG_LINK_NAMES_MAX, BGG_LINK_NAME_MAX } = require('../../public/js/bgg-links');

const router = express.Router();

const names = z.array(z.string().min(1).max(BGG_LINK_NAME_MAX)).max(BGG_LINK_NAMES_MAX).optional();

// Strict, so a typo'd or unknown type is a 400 rather than silently answered
// with nothing — the client builds the body from the same BGG_LINK_TYPES.
const lookupSchema = z.object({ category: names, mechanic: names, designer: names })
  .strict()
  .refine(
    (b) => (b.category || []).length + (b.mechanic || []).length + (b.designer || []).length <= BGG_LINK_NAMES_MAX,
    { message: 'Too many names' },
  );

router.post('/', async (req, res) => {
  const body = validateBody(lookupSchema, req, res);
  if (!body) return;
  res.json(await repo.getBggLinks(body));
});

module.exports = router;
