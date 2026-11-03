'use strict';

/* Importing a shelf from another app's file (#1758, Myludo).
   Mounted at /api/rounds/:rid/games/import (mergeParams for rid), ahead of the
   games router so `import` is not read as a game id.

     POST /api/rounds/:rid/games/import
       { games: [{ title, bggId?, minPlayers?, maxPlayers?, playtime?, expansions? }],
         attach: [{ gameId, expansions }] }
       -> { imported, skipped, attached }

   The client parses the file (public/js/myludo-import.js) and sends only the
   rows the user picked — the file itself never reaches the server. A linked
   row names a BGG id, the cover the preview showed and BGG's player range; the
   lazy backfill adds BGG's metadata afterwards, as for any linked game. An
   unlinked row carries the file's title, players and playing time.

   Why the title is TRUSTED here while the BGG collection import re-resolves
   it: that route knows the true title (it fetched the collection), this one
   does not — the title IS the user's data, the same thing POST …/games
   accepts typed. What stays gated is everything that reaches another context:
   a linked row's cover (from GET …/lookup/cards) is kept only through
   providerCoverUrl — the host allowlist the single add and the BGG import
   apply — and a BGG id is only ever turned into the canonical link. The play import (lib/routes/session-import.js)
   takes the same shape for the same reason.

   ONE write for the games (repo.createGames: one Chronik row, the dedupe inside
   the transaction), then one setGameExpansions per shelf game an expansion
   joins — few, and each an honest "expansion added" row in the Chronik. */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../validate');
const quota = require('../quota');
const { trackEvent } = require('../observability');
const { emitFeedEvent } = require('../feed');
const { actorSeat } = require('../actor-seat');
const { startShelfFill } = require('../provider-info');
const { providerCoverUrl } = require('../providers');
const { PLAYTIME_OVERRIDE_MAX, EXPANSION_TITLE_MAX } = require('../../public/js/draw-pool');
const { foldTitle } = require('../../public/js/lookup-score');
const {
  MYLUDO_IMPORT_MAX, MYLUDO_TITLE_MAX, MYLUDO_EXPANSIONS_MAX,
} = require('../../public/js/myludo-import');

const router = express.Router({ mergeParams: true });

// Another app's numbers are DROPPED when out of range rather than refused: one
// odd row („Joueur(s): 0") must not 400 a two-hundred-game import, and a game
// without a range is still a perfectly good game. Same leniency as the play
// import's clipped names.
const count = (max) => z.preprocess(
  (v) => (Number.isInteger(v) && v >= 1 && v <= max ? v : undefined),
  z.number().int().optional());
const clip = (max) => z.string().trim().min(1).max(500).transform((s) => s.slice(0, max).trim());
const bggId = z.number().int().positive().max(1e9).optional();

const expansionSchema = z.object({
  title: clip(EXPANSION_TITLE_MAX),
  bggId,
  minPlayers: count(999),
  maxPlayers: count(999),
});

const gameSchema = z.object({
  title: clip(MYLUDO_TITLE_MAX),
  bggId,
  image: z.string().max(2048).optional(),
  minPlayers: count(999),
  maxPlayers: count(999),
  playtime: z.object({ min: count(PLAYTIME_OVERRIDE_MAX), max: count(PLAYTIME_OVERRIDE_MAX) })
    .optional().catch(undefined),
  expansions: z.array(expansionSchema).max(MYLUDO_EXPANSIONS_MAX).optional(),
});

const importSchema = z.object({
  games: z.array(gameSchema).max(MYLUDO_IMPORT_MAX).default([]),
  attach: z.array(z.object({
    gameId: z.string().min(1).max(64),
    expansions: z.array(expansionSchema).min(1).max(MYLUDO_EXPANSIONS_MAX),
  })).max(MYLUDO_IMPORT_MAX).default([]),
}).refine((b) => b.games.length + b.attach.length > 0, { message: 'Nothing to import' });

const bggSource = (id) => ({ provider: 'bgg', externalId: String(id), url: `https://boardgamegeek.com/boardgame/${id}` });

// A player range only when both ends are known and in order — a HALF-declared
// range widens nothing (public/js/draw-pool.js), and a reversed one is noise.
function range(e) {
  const { minPlayers: a, maxPlayers: b } = e;
  if (a === undefined && b === undefined) return { minPlayers: null, maxPlayers: null };
  const lo = a === undefined ? b : a;
  const hi = b === undefined ? a : b;
  return { minPlayers: Math.min(lo, hi), maxPlayers: Math.max(lo, hi) };
}

const expansionEntry = (e) => ({
  title: e.title,
  source: e.bggId ? bggSource(e.bggId) : null,
  ...range(e),
});

// Whether a shelf game already owns this expansion — by link where both have
// one, else by folded title. Re-running the same file must add nothing.
const ownsExpansion = (game, e) => (game.expansions || []).some((x) => (e.source && x.source
  ? x.source.provider === e.source.provider && x.source.externalId === e.source.externalId
  : foldTitle(x.title) === foldTitle(e.title)));

router.post('/', async (req, res) => {
  const body = validateBody(importSchema, req, res);
  if (!body) return;
  const round = await req.repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  // Every expansion attaching to an existing game must name a real, ordinary
  // game of THIS round — never a wish, a guest game or a wished expansion, the
  // same set the expansions editor may write to.
  const shelfById = new Map(round.games.map((g) => [g.id, g]));
  for (const a of body.attach) {
    const g = shelfById.get(a.gameId);
    if (!g || g.wish || g.guestGame || Array.isArray(g.expansionOf)) {
      return res.status(400).json({ error: 'Unknown game' });
    }
  }

  const perGame = quota.enforced() ? quota.expansionsPerGame() : Infinity;
  const games = body.games.map((g) => {
    const p = range(g);
    const playtime = g.playtime && g.playtime.min !== undefined
      ? { min: g.playtime.min, max: Math.max(g.playtime.min, g.playtime.max || g.playtime.min) }
      : null;
    // Deduplicated by title inside a row too: Myludo lists a box once, but a
    // file edited by hand may not.
    const expansions = [];
    for (const e of g.expansions || []) {
      const x = expansionEntry(e);
      if (!expansions.some((y) => foldTitle(y.title) === foldTitle(x.title))) expansions.push(x);
    }
    return {
      title: g.title,
      ...p,
      // Only on a linked row, and only from a host the provider vouches for —
      // a refused URL costs the cover, never the row.
      image: g.bggId ? providerCoverUrl(g.image) : null,
      ...(g.bggId ? { source: bggSource(g.bggId) } : { titleKey: foldTitle(g.title) }),
      // The file's playing time is the round's own value for the game (#1627's
      // override), and only for an UNLINKED row: on a linked one it would shadow
      // what BGG says forever, with nothing on screen to tell it came from a file.
      ...(playtime && !g.bggId ? { playtimeOverride: playtime } : {}),
      ...(expansions.length ? { expansions: expansions.slice(0, perGame) } : {}),
    };
  });

  const limits = quota.enforced() ? { maxGames: quota.gamesPerRound() } : null;
  const actor = actorSeat(round, req.userId);
  let created = { created: [], skipped: 0 };
  if (games.length) {
    created = await req.repo.createGames(req.params.rid, games, actor, limits);
    if (created === null) return res.status(404).json({ error: 'Round not found' });
    if (created === 'quota_games') {
      return res.status(403).json({ error: 'quota_games', limit: limits.maxGames });
    }
  }

  // Expansions for games already on the shelf, one write per game. Union with
  // what it owns (kept by id), so nothing the group recorded by hand is lost,
  // and capped at the per-game quota rather than refused: the games are
  // already written, so a refusal here would only lose the rest.
  let attached = 0;
  for (const a of body.attach) {
    const game = shelfById.get(a.gameId);
    const fresh = [];
    for (const e of a.expansions.map(expansionEntry)) {
      if (!ownsExpansion(game, e) && !fresh.some((y) => foldTitle(y.title) === foldTitle(e.title))) fresh.push(e);
    }
    const kept = (game.expansions || []).map((x) => ({ ...x }));
    const room = Math.max(0, perGame - kept.length);
    const add = fresh.slice(0, room);
    if (!add.length) continue;
    const saved = await req.repo.setGameExpansions(req.params.rid, game.id, [...kept, ...add], actor);
    if (saved) attached += add.length;
  }

  const n = created.created.length;
  if (n) {
    startShelfFill(req.repo, req.params.rid).catch(() => {});
    trackEvent('games_imported', { tenantId: req.tenantId });
    // One feed event for the batch, carrying the count — the BGG collection
    // import's shape (#1079), for its reason: per-game events would flood every
    // friend's feed.
    const first = created.created[0];
    await emitFeedEvent(req.userId, n > 1
      ? { type: 'games_imported', title: first.title, coverUrl: first.image, count: n }
      : { type: 'game_added', title: first.title, coverUrl: first.image });
  }
  res.json({ imported: n, skipped: created.skipped, attached });
});

module.exports = router;
