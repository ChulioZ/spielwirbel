'use strict';

/*
 * The same BGG game in the caller's OTHER rounds (#1843): what the game page
 * asks after an edit to a title, player range, playing time or pitch, so it can
 * offer to make the same change there too.
 *
 *   GET /api/game-twins?bggId=<digits>&excludeRoundId=<rid>
 *
 * Mounted at /api/game-twins, behind the /api gate and after withTenant, but
 * deliberately NOT under /api/rounds/:rid. That mount re-scopes req.repo to the
 * round OWNER's tenant when the caller reached the round through a grant
 * (.claude/rules/round-grant-resolver.md), which would hide the caller's own
 * rounds and widen the read to the owner's — the exact thing this endpoint must
 * not do. Here req.repo is always the caller's own tenant.
 *
 * READ ONLY. Applying the change goes through each round's own
 * PATCH …/games/:gid, so every write meets resolveRoundGrant and
 * requireRoundRole exactly as a hand edit would — no cross-tenant write path is
 * added here, and none may be.
 *
 * The candidate set is the home list's (#207 home-merge in lib/routes/rounds.js):
 *   - own rounds, from req.repo;
 *   - each granted round, read through repo.forTenant(grant.ownerTenantId) and
 *     narrowed to THAT grant's round id, so the owner's other rounds are never
 *     read. Without the narrowing, a grantee would learn the names of every
 *     round the owner has that holds the game.
 * A grant is listed only when its role clears 'round.write' — the floor the
 * follow-up PATCH needs — so the prompt never offers a round the write refuses.
 */

const express = require('express');
const repo = require('../repo');
const { normalizeRole, can } = require('../../public/js/round-roles');

const router = express.Router();

// A BGG id is digits (bggIdOf, lib/game-scoring.js); anything else has no
// cross-round identity, so it has no twins.
const BGG_ID_RE = /^[0-9]{1,10}$/;

router.get('/', async (req, res) => {
  const bggId = String(req.query.bggId || '');
  const exclude = String(req.query.excludeRoundId || '');
  if (!BGG_ID_RE.test(bggId)) return res.json({ twins: [] });

  const twins = (await req.repo.findGamesByBggId(bggId)).filter((t) => t.roundId !== exclude);
  if (req.userId) {
    for (const g of await repo.listGrantsForUser(req.userId)) {
      if (g.roundId === exclude) continue;
      if (!can(normalizeRole(g.role), 'round.write')) continue;
      const rows = await repo.forTenant(g.ownerTenantId).findGamesByBggId(bggId, g.roundId);
      rows.forEach((t) => twins.push({ ...t, shared: true }));
    }
  }
  res.json({ twins });
});

module.exports = router;
