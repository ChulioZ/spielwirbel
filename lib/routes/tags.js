'use strict';

/* Routes for a round's custom tags (issue #238): create (deduped by name),
   patch (icon #255, name #1004) and delete (unassigns the tag from every game).
   Games are (un)tagged via the existing games routes' `tagIds` field, not here.
   Mounted under /api/rounds/:rid/tags (mergeParams for rid). */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../validate');
const quota = require('../quota');
const { TAG_ICONS } = require('../tag-icons');
const { trackEvent } = require('../observability');

const router = express.Router({ mergeParams: true });

// Keep in sync with the `maxlength` on both tag inputs in
// public/js/views-round-detail.js — the client caps first so a rejected name
// never round-trips; this is the backstop.
const TAG_NAME_MAX = 30;

// A tag's icon is a key from the curated set (#255), never a free string — the
// client renders it as `ti-<key>`, so an arbitrary value would emit a class
// with no CSS rule behind it and silently render nothing.
const createTagSchema = z.object({
  name: z.preprocess(
    (v) => String(v || '').trim(),
    z.string().min(1, 'Tag name is missing').max(TAG_NAME_MAX, 'Tag name is too long'),
  ),
  // Optional on create — a tag without one renders the default `ti-tags` glyph.
  icon: z.enum(TAG_ICONS).nullish(),
});

// Both keys are optional since #1004, but AT LEAST ONE must be present: an empty
// body is a client error, not a silent no-op, which is what the required `icon`
// used to express on its own. `icon: null` stays a valid value — it clears the
// icon back to the default — so the guard tests `!== undefined` rather than
// truthiness.
//
// The name preprocessing mirrors `createTagSchema`'s, with one difference that
// matters: an ABSENT name must stay absent rather than becoming `''`, or a
// patch sending only an icon would fail `min(1)`.
const updateTagSchema = z.object({
  icon: z.enum(TAG_ICONS).nullable().optional(),
  name: z.preprocess(
    (v) => (v === undefined ? undefined : String(v || '').trim()),
    z.string().min(1, 'Tag name is missing').max(TAG_NAME_MAX, 'Tag name is too long').optional(),
  ),
}).refine((b) => b.icon !== undefined || b.name !== undefined, { message: 'Nothing to update' });

// Create a tag. A name matching an existing tag (trimmed, case-insensitive)
// returns that tag instead of creating a duplicate.
router.post('/', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const body = validateBody(createTagSchema, req, res);
  if (!body) return;

  // Per-tenant tags-per-round cap (#139/#238): only in the public multi-tenant
  // mode, and only for a genuinely NEW name — a duplicate reuses the existing
  // tag and must keep working at the cap.
  const exists = (round.tags || []).some((tg) => tg.name.toLowerCase() === body.name.toLowerCase());
  if (!exists && quota.enforced() && (round.tags || []).length >= quota.tagsPerRound()) {
    return res.status(403).json({ error: 'quota_tags', limit: quota.tagsPerRound() });
  }

  const tag = await req.repo.addTag(req.params.rid, body.name, body.icon);
  if (!tag) return res.status(404).json({ error: 'Round not found' });
  // Only a genuinely new name is a creation — a duplicate reuses the existing
  // tag above, which is not a new tag and must not inflate the count.
  if (!exists) trackEvent('tag_created', { tenantId: req.tenantId });
  res.status(201).json(tag);
});

// The body is the FULL list of tag ids in the wanted order — never a single
// move — so the server can verify it is an exact permutation of what the round
// holds and refuse a stale client outright. The cap is the tags-per-round quota
// so an oversized array is rejected before the repo walks it; it is a payload
// bound only, since the permutation check below is what actually decides.
const reorderTagsSchema = z.object({
  tagIds: z.array(z.string().min(1)).min(1).max(Math.max(quota.tagsPerRound(), 100)),
});

// Reorder a round's tags (#1159). REGISTERED BEFORE `/:tagId`, and it has to
// be: Express matches in registration order, so behind the parameterised route
// this would arrive at `updateTag` with tagId === 'order' and 404 — a dead
// feature that looks like a missing route rather than a routing mistake.
//
// No quota check (reordering creates nothing) and no activity-log entry —
// create, rename and delete don't write one either, and a reorder is the last
// thing a round's Chronik needs.
router.patch('/order', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const body = validateBody(reorderTagsSchema, req, res);
  if (!body) return;

  // The permutation check lives in the repo, beside the FOR UPDATE that holds
  // the tags array — checking it here would read the list on one side of that
  // lock and write it on the other, which is exactly the race it exists to
  // stop. Same reasoning as the rename dedupe above.
  const tags = await req.repo.reorderTags(req.params.rid, body.tagIds);
  if (tags === 'tags_changed') return res.status(409).json({ error: 'tags_changed' });
  if (!tags) return res.status(404).json({ error: 'Round not found' });
  res.json(tags);
});

// Patch a tag's icon (#255) and/or its name (#1004). No quota interaction in
// either direction: renaming consumes nothing, exactly like changing an icon, so
// a round AT the per-round cap must still be able to fix a typo.
//
// The name COLLISION check is not here — it is inside the repo mutator, where
// the Postgres backend already holds the tags array under FOR UPDATE. Doing it
// here would put the read and the write on either side of that lock and let two
// concurrent renames produce two tags with one name, which `POST` can never
// produce. The mutator answers `'name_taken'` for it.
//
// A collision REJECTS rather than merging the two tags. Merging is the other
// defensible answer and it was rejected deliberately: it silently moves every
// assignment of one tag onto another with no undo, where a refusal is
// predictable and the user can pick a different name — and a rename is reached
// from a typo, which is not a moment to guess at intent.
router.patch('/:tagId', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const body = validateBody(updateTagSchema, req, res);
  if (!body) return;

  const tag = await req.repo.updateTag(req.params.rid, req.params.tagId, body);
  if (tag === 'name_taken') return res.status(409).json({ error: 'tag_name_taken' });
  if (!tag) return res.status(404).json({ error: 'Tag not found' });
  res.json(tag);
});

// Delete a tag; the data layer also unassigns it from every game that had it.
router.delete('/:tagId', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const deleted = await req.repo.deleteTag(req.params.rid, req.params.tagId);
  if (!deleted) return res.status(404).json({ error: 'Tag not found' });
  res.json({ ok: true });
});

module.exports = router;
