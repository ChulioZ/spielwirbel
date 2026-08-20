'use strict';

/*
 * "Das könnte euch auch gefallen" (issue #682) — the one read behind the
 * recommendations screen.
 *
 *   GET /api/rounds/:rid/recommendations
 *     -> { recommendations: [{ externalId, title, year, rank, rating, weight,
 *                              minPlayers, maxPlayers, minPlaytime, maxPlaytime,
 *                              score, url, reasons: [{ term, … }] }],
 *          profileGames, linkedGames, minProfileGames, corpusRows, parties,
 *          dismissed: [{ externalId, title, at }] }
 *
 *   POST   /api/rounds/:rid/recommendations/dismissed        { externalId, title }
 *   DELETE /api/rounds/:rid/recommendations/dismissed/:externalId
 *
 * The two writes (#782) are how a round says "no thanks" to a title. They are
 * NOT #264's shape — nothing is scored, stored as a run, or billed; the list is
 * a set of ids the read filters against, so the sub-path is what keeps the #264
 * guard in test/rounds.test.js literally true (a bare POST …/recommendations and
 * a DELETE …/recommendations/:anything still 404). See
 * .claude/rules/recommendation-scoring.md §10.
 *
 * The scoring lives in lib/recommend.js (pure, unit-tested); this router only
 * joins the round to the cached corpus and shapes the answer. The GET is not in
 * lib/round-access.js's table — every role may read a round they have access to
 * (.claude/rules/round-roles-are-a-chokepoint.md); the two writes below ARE, as
 * 'round.write': dismissing is an ordinary round write, like adding a game.
 *
 * A round below the profile floor, an instance with no corpus, and an instance
 * with no BGG_API_TOKEN all answer 200 with an EMPTY list and the counts that
 * explain it. Nothing here can 502: no request leaves the process — the corpus
 * was fetched hours ago by the scheduler's enrichment job.
 */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../validate');
const quota = require('../quota');
const { corpusEntries } = require('../corpus-cache');
const { recommend } = require('../recommend');
const bgg = require('../providers/bgg');

const router = express.Router({ mergeParams: true });

// The corpus id is the whole key; the title is stored alongside so the
// „Ignorierte" list can render without a corpus lookup — a dismissed row may
// later fall out of the corpus entirely and the reader still has to find it.
// Both are coerced to strings: an externalId arrives as a string from the client
// and must be stored as one, or the filter's Set lookup misses on a number.
const DISMISS_TITLE_MAX = 200;
const dismissSchema = z.object({
  externalId: z.preprocess(
    (v) => String(v == null ? '' : v).trim(),
    z.string().min(1, 'externalId is missing').max(64, 'externalId is too long'),
  ),
  title: z.preprocess(
    (v) => String(v == null ? '' : v).trim().slice(0, DISMISS_TITLE_MAX),
    z.string(),
  ),
});

router.get('/', async (req, res) => {
  // The full round, not getRoundMeta: the profile needs the shelf AND the
  // sessions (the ratings and the real party sizes are the half BGG cannot know).
  const round = await req.repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const result = recommend(round, await corpusEntries());
  res.json({
    ...result,
    recommendations: result.recommendations.map((r) => ({ ...r, url: bgg.gameUrl(r.externalId) })),
  });
});

// Dismiss a recommendation. Idempotent by externalId — the card can be
// double-tapped, and an undo can race a re-dismiss — so a repeat answers 201
// with the ORIGINAL entry rather than 409ing at a user who tapped twice.
router.post('/dismissed', async (req, res) => {
  const body = validateBody(dismissSchema, req, res);
  if (!body) return;

  // getRoundMeta only to 404: the list itself is deliberately NOT on that light
  // read, and the cap is checked inside the repo's own critical section rather
  // than here, so a concurrent pair of dismisses cannot race past the ceiling.
  if (!(await req.repo.getRoundMeta(req.params.rid))) {
    return res.status(404).json({ error: 'Round not found' });
  }

  const limit = quota.enforced() ? quota.dismissedPerRound() : Infinity;
  const entry = await req.repo.dismissRecommendation(
    req.params.rid, { externalId: body.externalId, title: body.title }, limit,
  );
  if (entry === 'quota') return res.status(403).json({ error: 'quota_dismissed', limit });
  if (!entry) return res.status(404).json({ error: 'Round not found' });
  res.status(201).json(entry);
});

// Restore one. A 404 when it was never dismissed, rather than a silent ok — the
// client would otherwise report "restored" for a no-op.
router.delete('/dismissed/:externalId', async (req, res) => {
  if (!(await req.repo.getRoundMeta(req.params.rid))) {
    return res.status(404).json({ error: 'Round not found' });
  }
  const removed = await req.repo.undismissRecommendation(req.params.rid, req.params.externalId);
  if (!removed) return res.status(404).json({ error: 'Recommendation not dismissed' });
  res.json({ ok: true });
});

module.exports = router;
