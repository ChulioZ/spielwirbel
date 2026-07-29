'use strict';

/* Routes for game sessions: start (random pick), save results, choose game,
   finish/winners, cancel, delete.
   Mounted under /api/rounds/:rid/sessions (mergeParams for rid). */

const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../lib/validate');
const { trackEvent } = require('../lib/observability');
const { emitFeedEvent } = require('../lib/feed');
// The cap lives with the frontend helper that also enforces it on the setup
// screen — one source of truth across the boundary (#458, see
// .claude/rules/shared-constants-across-the-stack.md).
const { MAX_SESSION_GUESTS, GUEST_NAME_MAX } = require('../public/js/session-people');

const router = express.Router({ mergeParams: true });

// Resolve the client's guest NAMES into stored `{ id, name }` records (#458).
// A too-long name is truncated rather than rejected, matching the lenient style
// of the start-session schema (and the setup screen's own input maxlength, which
// reads the same constant).
// The ids are minted here on purpose: a guest id becomes a key in the vote map
// and in `winnerIds`, so letting a client dictate one would let it collide with
// a member id or with another session's guest. Names are trimmed, blanks
// dropped, and the list capped — lenient throughout, like its schema siblings.
function resolveGuests(names) {
  return names
    .map((n) => n.trim().slice(0, GUEST_NAME_MAX))
    .filter(Boolean)
    .slice(0, MAX_SESSION_GUESTS)
    .map((name) => ({ id: crypto.randomBytes(8).toString('hex'), name }));
}

// Start-session body. Every field is lenient (unknown -> default), exactly like
// the old hand-rolled normalization: memberIds are coerced to a string array
// (round-membership filtering still happens in the handler, which needs the
// round), count to NaN (the handler floors it to 1). `gameId` (direct-pick) is
// passed through untouched. So this schema never 400s — the real 400s (no
// members, no matching games) are round-dependent and stay in the handler.
const startSessionSchema = z.object({
  memberIds: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
  count: z.preprocess((v) => parseInt(v, 10), z.number().catch(NaN)),
  tagIds: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
  excludeTagIds: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
  // Guests (#458) arrive as NAMES; resolveGuests() mints their ids below.
  guests: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
  gameId: z.unknown().optional(),
});

// Save-results body: votes must be a map object (votes[memberId][gameId] = …);
// anything else (missing, array, primitive) falls back to {} like the old
// `typeof === 'object'` guard. The nested shape isn't validated here — the data
// layer is lenient about it.
const saveResultsSchema = z.object({
  votes: z.record(z.string(), z.unknown()).catch({}),
});

// Finish body: winnerIds coerced to a string array (filtered in the handler
// against the round's members plus this session's guests). `finished` is a
// tri-state default (true unless explicitly false), read from req.body where
// that reads clearest.
const finishSchema = z.object({
  winnerIds: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
});

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Start a new session. Two modes:
//  - random draw (default): pick games by tag/player-count filters;
//  - direct pick (`gameId` given): play one chosen game, skipping the vote.
router.post('/', async (req, res) => {
  const round = await req.repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const body = validateBody(startSessionSchema, req, res);
  if (!body) return;

  // Members joining this session. Missing/empty means everyone (back-compat).
  // The joining count filters games by their player range below.
  const memberById = new Set(round.members.map((m) => m.id));
  let memberIds = body.memberIds.filter((mid) => memberById.has(mid));
  if (memberIds.length === 0) memberIds = round.members.map((m) => m.id);
  if (memberIds.length === 0)
    return res.status(400).json({ error: 'At least one member must join' });
  const members = round.members.filter((m) => memberIds.includes(m.id));

  // Guests (#458) arrive as names and are minted here for BOTH modes (#532).
  const guests = resolveGuests(body.guests);

  // Direct-pick mode: the user explicitly chose one game, so there is no draw
  // and no voting. Ignore count and the player-range pool — but not guests: they
  // sat at the table and the results screen's winner picker draws its chips from
  // members ∪ guests, so without them a guest who won cannot be recorded (#532).
  if (body.gameId != null) {
    const game = round.games.find((g) => g.id === String(body.gameId));
    if (!game) return res.status(400).json({ error: 'Game does not belong to this round' });
    if (game.retired) return res.status(400).json({ error: 'Game is retired' });
    if (game.completed) return res.status(400).json({ error: 'Game is completed' });
    const now = new Date().toISOString();
    const session = await req.repo.createSession(req.params.rid, {
      createdAt: now,
      tagIds: null, // no tag filter in direct-pick mode (#238)
      excludeTagIds: null, // nor an exclude filter (#241)
      requestedCount: 1,
      memberIds,
      // Same absent-key discipline as the draw path below: a guestless session
      // grows no `guests` key (.claude/rules/postgres-backend.md).
      ...(guests.length ? { guests } : {}),
      gameIds: [game.id],
      votes: {}, // no voting phase in direct-pick mode
      chosenGameId: game.id, // the game is chosen up front
      chosenAt: now,
      finished: false,
      finishedAt: null,
      winnerIds: [],
      cancelled: false,
      cancelledAt: null,
      done: true,
    });
    trackEvent('session_created', { tenantId: req.tenantId });
    return res.status(201).json({ session, games: [game], members });
  }

  let count = body.count;
  if (!Number.isFinite(count) || count < 1) count = 1;

  // Tag filter (#238, tri-state #241): included tags use AND semantics (a game
  // must carry every one); excluded tags reject a game carrying any of them.
  // Unknown ids are dropped (lenient, like memberIds); empty means no filter.
  const roundTagIds = new Set((round.tags || []).map((tg) => tg.id));
  let tagIds = [...new Set(body.tagIds)].filter((x) => roundTagIds.has(x));
  if (tagIds.length === 0) tagIds = null;
  // A tag can't be both included and excluded — include wins (drop it from
  // exclude), mirroring the single-state-per-tag guarantee of the client cycle.
  let excludeTagIds = [...new Set(body.excludeTagIds)]
    .filter((x) => roundTagIds.has(x) && !(tagIds && tagIds.includes(x)));
  if (excludeTagIds.length === 0) excludeTagIds = null;

  // Guests sit at the table too, so they count toward the player range the pool
  // is filtered by — the client-side preview in showStartSession() applies the
  // identical arithmetic and the two must agree
  // (.claude/rules/active-games-filter-sites.md). Direct-pick consults no player
  // range, which is why only this mode uses the count.
  const playerCount = memberIds.length + guests.length;

  const pool = round.games.filter(
    (g) =>
      !g.retired &&
      !g.completed && // both archives are out of the draw pool (#250)
      (!tagIds || tagIds.every((x) => (g.tagIds || []).includes(x))) &&
      (!excludeTagIds || !excludeTagIds.some((x) => (g.tagIds || []).includes(x))) &&
      (typeof g.minPlayers !== 'number' || playerCount >= g.minPlayers) &&
      (typeof g.maxPlayers !== 'number' || playerCount <= g.maxPlayers)
  );
  if (pool.length === 0)
    return res.status(400).json({ error: 'No matching games in this round' });

  const picked = shuffle(pool.slice()).slice(0, Math.min(count, pool.length));

  // Remember what this draw was started with (#252), so the next "New session"
  // sheet for this round opens preset with it. Stored resolved (unknown tag ids
  // are already dropped above) and normalized to arrays, so the client presets
  // without having to re-derive null-vs-empty.
  const filters = { tagIds: tagIds || [], excludeTagIds: excludeTagIds || [], count };

  const session = await req.repo.createSession(req.params.rid, {
    createdAt: new Date().toISOString(),
    tagIds, // null = no tag filter (#238)
    excludeTagIds, // null = no exclude filter (#241)
    requestedCount: count,
    memberIds, // members who joined this session
    // Guests (#458) only when there are some: a guestless session must grow no
    // `guests` key, so the JSON and Postgres blobs stay byte-identical
    // (.claude/rules/postgres-backend.md). Absent and [] mean the same on read.
    ...(guests.length ? { guests } : {}),
    gameIds: picked.map((g) => g.id),
    votes: {}, // votes[personId][gameId] = { rating: 1..5|null, retire: bool }
    chosenGameId: null, // which game ends up being played
    chosenAt: null, // when a game was chosen
    finished: false, // whether the game was played/finished
    finishedAt: null, // when it was finished
    winnerIds: [], // winners (member or guest ids, multiple allowed)
    cancelled: false, // final state: no game appealed, nothing was played
    cancelledAt: null, // when it was cancelled
    done: false,
  }, filters);

  // Both start modes (direct-pick above, draw here) are one created session.
  trackEvent('session_created', { tenantId: req.tenantId });

  // Convenience for the frontend: send the picked games right away, plus the
  // resolved guests (whose ids only exist server-side until now).
  res.status(201).json({ session, games: picked, members, guests });
});

// Strip `retire` from every guest's vote entries (#458). A guest's rating is an
// opinion about the game and counts, but deciding a game should leave the shelf
// is the permanent group governing its own collection — so the vote card renders
// no retire control for a guest at all. This drops what a hand-crafted request
// could otherwise inject, which is why gameStats() needs no guest exclusion:
// there is simply never a guest `retire` flag to exclude.
function dropGuestRetireFlags(votes, session) {
  const guestIds = new Set((session.guests || []).map((g) => g.id));
  if (!guestIds.size) return votes;
  Object.keys(votes).forEach((pid) => {
    if (!guestIds.has(pid)) return;
    const byGame = votes[pid];
    if (!byGame || typeof byGame !== 'object') return;
    Object.keys(byGame).forEach((gid) => {
      const v = byGame[gid];
      if (v && typeof v === 'object') delete v.retire;
    });
  });
  return votes;
}

// Save a session's complete result (hot-seat: all at once at the end).
router.post('/:sid/results', async (req, res) => {
  // Light probe: this route only needs "does the round exist" — not every game
  // and vote map of the round.
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  // The session itself is read for its guest ids (#458), which decide whose
  // retire flags get dropped below.
  const stored = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!stored) return res.status(404).json({ error: 'Session not found' });

  const body = validateBody(saveResultsSchema, req, res);
  if (!body) return;
  const votes = dropGuestRetireFlags(body.votes, stored);
  const session = await req.repo.saveSessionResults(req.params.rid, req.params.sid, votes);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// Remember the session's chosen game (or clear it with null).
router.post('/:sid/choice', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const session = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.cancelled)
    return res.status(400).json({ error: 'Session is cancelled' });
  const gameId = req.body.gameId === null ? null : String(req.body.gameId || '');
  if (gameId !== null && !session.gameIds.includes(gameId))
    return res.status(400).json({ error: 'Game does not belong to this session' });

  const updated = await req.repo.setSessionChoice(req.params.rid, req.params.sid, gameId);
  if (!updated) return res.status(404).json({ error: 'Session not found' });
  res.json(updated);
});

// Mark the game as played/finished and record winners (finished:false resets it).
router.post('/:sid/finish', async (req, res) => {
  // Meta carries the members; the session read below supplies its guests, and
  // together they are the whole winner allowlist.
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const session = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const body = validateBody(finishSchema, req, res);
  if (!body) return;
  const finished = req.body.finished !== false; // default: true
  let winnerIds = [];
  if (finished) {
    if (session.cancelled)
      return res.status(400).json({ error: 'Session is cancelled' });
    // A guest can genuinely win the game, so the allowlist is the round's
    // members ∪ THIS session's guests (#458) — never another session's, which is
    // why it is rebuilt per request from the stored blob rather than cached.
    const allowed = new Set(round.members.map((m) => m.id));
    (session.guests || []).forEach((g) => allowed.add(g.id));
    winnerIds = body.winnerIds.filter((wid) => allowed.has(wid));
  }
  const updated = await req.repo.finishSession(req.params.rid, req.params.sid, { finished, winnerIds });
  if (!updated) return res.status(404).json({ error: 'Session not found' });
  // This route also UN-finishes (finished:false) — only the real finish counts.
  if (finished) {
    trackEvent('session_finished', { tenantId: req.tenantId });
    // Freundeskreis feed (#325): "‹user› hat ‹Spiel› gespielt". The played game is
    // the session's chosen one; carry its title + cover snapshot only (never
    // members, winners or scores — those are the round's own data). Best-effort.
    if (session.chosenGameId) {
      const game = await req.repo.getGame(req.params.rid, session.chosenGameId);
      if (game) await emitFeedEvent(req.userId, { type: 'session_played', title: game.title, coverUrl: game.image });
    }
  }
  res.json(updated);
});

// Cancel the session: no game appealed, nothing gets played (cancelled:false
// undoes it). A final state, mutually exclusive with choosing/finishing a game.
router.post('/:sid/cancel', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const session = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const cancelled = req.body.cancelled !== false; // default: true
  if (cancelled && (session.chosenGameId || session.finished))
    return res.status(400).json({ error: 'A game is already chosen for this session' });

  const updated = await req.repo.cancelSession(req.params.rid, req.params.sid, cancelled);
  if (!updated) return res.status(404).json({ error: 'Session not found' });
  res.json(updated);
});

// Remove a single game from a session: drop it from the game list and delete
// every member's vote for it. If it was the chosen/played game, that choice
// (and any recorded result) is reset too.
router.delete('/:sid/games/:gid', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const session = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.gameIds.includes(req.params.gid))
    return res.status(404).json({ error: 'Game does not belong to this session' });

  const updated = await req.repo.removeSessionGame(req.params.rid, req.params.sid, req.params.gid);
  if (!updated) return res.status(404).json({ error: 'Session not found' });
  res.json(updated);
});

router.delete('/:sid', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const deleted = await req.repo.deleteSession(req.params.rid, req.params.sid);
  if (!deleted) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});

module.exports = router;
