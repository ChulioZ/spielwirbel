'use strict';

/* Routes for a round's saved session filters (#1328): save one from the
   session setup screen, rename, reorder and delete it from Einstellungen. The
   hub renders them as its quick-start chips, in stored order.
   Mounted under /api/rounds/:rid/filters (mergeParams for rid).

   A saved filter is round data, shared by everyone who can reach the round —
   including an account the round was shared with (#207). Every mutation costs
   'round.write', the floor anyone who can DRAW in the round clears
   (lib/round-access.js). */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../validate');
const quota = require('../quota');
const { isActiveGame } = require('../draw');
// The filter half of a draw, resolved by the one function POST …/sessions
// uses — so a saved filter and a remembered draw can never be normalized two
// ways (.claude/rules/shared-constants-across-the-stack.md).
const { DRAW_FILTER_FIELDS, resolveDrawFilters, filterPreset } = require('../draw-filters');
// Which seats are still playing (#1006). The setup screen offers only these,
// so a saved filter may only name these — the same predicate, not a copy.
const { activeMembers } = require('../../public/js/member-active');

const router = express.Router({ mergeParams: true });

// Long enough for „Kinderabend mit Oma, max. 45 Min", short enough to stay a
// chip. The client does not restate it: GET /api/config reports this export,
// and the name input takes its `maxlength` from there
// (.claude/rules/shared-constants-across-the-stack.md).
const FILTER_NAME_MAX = 40;

const nameField = z.preprocess(
  (v) => String(v == null ? '' : v).trim(),
  z.string().min(1, 'Filter name is missing').max(FILTER_NAME_MAX, 'Filter name is too long'),
);

// Save: a name plus the setup screen's controls, lenient exactly like the draw
// — an unknown tag, a stale seat or a garbage metadata blob is DROPPED, never a
// 400. Only the name can reject the request.
const createSchema = z.object({
  name: nameField,
  ...DRAW_FILTER_FIELDS,
  memberIds: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
});

const renameSchema = z.object({ name: nameField });

// The FULL list of ids in the wanted order, never a single move — the repo
// checks it is an exact permutation of what the round holds. The array bound is
// a payload limit only.
const reorderSchema = z.object({
  filterIds: z.array(z.string().min(1)).min(1).max(Math.max(quota.savedFiltersPerRound(), 50)),
});

// Save the current setup as a named filter. Resolved against the round ON SAVE:
// unknown tag ids dropped, metadata normalized against the active shelf, seats
// narrowed to ACTIVE members. The client resolves again ON USE, because a tag
// or a seat can go away after the save.
//
// The cap and the name clash are checked INSIDE the repo mutator, beside the
// lock that holds the list (.claude/rules/data-access-layer.md). The cap is
// enforced in every mode — see lib/quota.js for why this one is the exception.
router.post('/', async (req, res) => {
  const round = await req.repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const body = validateBody(createSchema, req, res);
  if (!body) return;

  const resolved = resolveDrawFilters(body, round, round.games.filter(isActiveGame));
  const seats = new Set(activeMembers(round).map((m) => m.id));
  const memberIds = [...new Set(body.memberIds)].filter((mid) => seats.has(mid));

  const limit = quota.savedFiltersPerRound();
  const saved = await req.repo.createSavedFilter(req.params.rid,
    { name: body.name, ...filterPreset(resolved), memberIds }, limit);
  if (saved === 'name_taken') return res.status(409).json({ error: 'filter_name_taken' });
  if (saved === 'quota') return res.status(403).json({ error: 'quota_filters', limit });
  if (!saved) return res.status(404).json({ error: 'Round not found' });
  res.status(201).json(saved);
});

// REGISTERED BEFORE `/:fid`, as the tag router's reorder is: behind the
// parameterised route this would arrive as a rename of a filter called 'order'.
router.patch('/order', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const body = validateBody(reorderSchema, req, res);
  if (!body) return;
  const list = await req.repo.reorderSavedFilters(req.params.rid, body.filterIds);
  if (list === 'filters_changed') return res.status(409).json({ error: 'filters_changed' });
  if (!list) return res.status(404).json({ error: 'Round not found' });
  res.json(list);
});

// Rename. No quota interaction: renaming consumes nothing, so a round at the
// cap can still fix a typo.
router.patch('/:fid', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const body = validateBody(renameSchema, req, res);
  if (!body) return;
  const saved = await req.repo.updateSavedFilter(req.params.rid, req.params.fid, { name: body.name });
  if (saved === 'name_taken') return res.status(409).json({ error: 'filter_name_taken' });
  if (!saved) return res.status(404).json({ error: 'Filter not found' });
  res.json(saved);
});

router.delete('/:fid', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const deleted = await req.repo.deleteSavedFilter(req.params.rid, req.params.fid);
  if (!deleted) return res.status(404).json({ error: 'Filter not found' });
  res.json({ ok: true });
});

/* What GET /api/config reports as `savedFilters`, so the setup screen can
   disable „Filter speichern" at the ceiling with a visible reason, and cap the
   name input, without restating either number. ALWAYS numbers — unlike
   `expansionsPerGame`, which is null where quotas are inert — because this cap
   bounds the hub's chip row, not abuse, and applies in every mode
   (lib/quota.js). */
function savedFilterLimits() {
  return { perRound: quota.savedFiltersPerRound(), nameMax: FILTER_NAME_MAX };
}

module.exports = router;
module.exports.savedFilterLimits = savedFilterLimits;
module.exports.FILTER_NAME_MAX = FILTER_NAME_MAX;
