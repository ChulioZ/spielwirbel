'use strict';

/*
 * "Das könnte euch auch gefallen" (issue #682) — the one read behind the
 * recommendations screen.
 *
 *   GET /api/rounds/:rid/recommendations
 *     -> { recommendations: [{ externalId, title, year, rank, rating, weight,
 *                              minPlayers, maxPlayers, minPlaytime, maxPlaytime,
 *                              score, url, reasons: [{ term, … }] }],
 *          profileGames, linkedGames, minProfileGames, corpusRows, parties }
 *
 * The scoring lives in lib/recommend.js (pure, unit-tested); this router only
 * joins the round to the cached corpus and shapes the answer. It is a GET, so it
 * is not in lib/round-access.js's table — every role may read a round they have
 * access to (.claude/rules/round-roles-are-a-chokepoint.md).
 *
 * A round below the profile floor, an instance with no corpus, and an instance
 * with no BGG_API_TOKEN all answer 200 with an EMPTY list and the counts that
 * explain it. Nothing here can 502: no request leaves the process — the corpus
 * was fetched hours ago by the scheduler's enrichment job.
 */

const express = require('express');
const { corpusEntries } = require('../corpus-cache');
const { recommend } = require('../recommend');
const bgg = require('../providers/bgg');

const router = express.Router({ mergeParams: true });

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

module.exports = router;
