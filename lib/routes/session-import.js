'use strict';

/* Importing a play history as finished sessions (#1665).
   Mounted at /api/rounds/:rid/sessions/import (mergeParams for rid), ahead of
   the sessions router — a route of its own file rather than a branch of
   POST /sessions, because one request writes members, games and many sessions
   at once and shares nothing with the draw.

   The client parses the source (a BG Stats export, never uploaded as a file;
   or BGG plays fetched through …/lookup/plays), lets the user match people and
   games, and sends the result in batches. Every batch carries the full people
   and games mapping; the repo writes only the new seats and games that batch's
   surviving sessions name (a quota refusal writes nothing of that batch), and
   later batches name them by the ids an earlier one returned.
   The translation itself is lib/session-import.js. */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../validate');
const quota = require('../quota');
const { trackEvent } = require('../observability');
const { affectedAccounts, badgeSnapshot, announceBadgeCrossings } = require('../badge-feed');
const { actorSeat } = require('../actor-seat');
const { buildImport, backfillCandidates, ImportError } = require('../session-import');
const { backfillProviderInfo } = require('../provider-info');
const { GUEST_NAME_MAX } = require('../../public/js/session-people');
const { ENDINGS } = require('../../public/js/session-outcome');
const { IMPORT_SOURCES, IMPORT_BATCH_MAX, IMPORT_KEY_MAX } = require('../../public/js/play-import');

const router = express.Router({ mergeParams: true });

const key = z.string().min(1).max(IMPORT_KEY_MAX);
// Names and titles come from another app, so they are TRUNCATED to what a seat
// or a game may hold rather than refused — one long co-player name must not
// 400 a whole batch (the same leniency as resolveGuests in sessions.js).
const clip = (max) => z.string().trim().min(1).max(500).transform((s) => s.slice(0, max).trim());
const name = clip(GUEST_NAME_MAX);

// One person mapping: exactly one of an existing member, a new member, a guest.
// An ignored source player is simply not listed.
const personSchema = z.object({
  key,
  memberId: z.string().min(1).max(64).optional(),
  newMember: name.optional(),
  guest: name.optional(),
}).refine((p) => [p.memberId, p.newMember, p.guest].filter((v) => v !== undefined).length === 1,
  { message: 'Each person maps to exactly one of memberId, newMember, guest' });

const gameSchema = z.object({
  key,
  gameId: z.string().min(1).max(64).optional(),
  create: z.object({
    title: clip(200),
    bggId: z.number().int().positive().optional(),
    shelf: z.boolean().default(false),
  }).optional(),
}).refine((g) => !!g.gameId !== !!g.create, { message: 'Each game maps to gameId or create' });

const playSchema = z.object({
  id: z.string().min(1).max(IMPORT_KEY_MAX),
  playedOn: z.string().max(40),
  dateOnly: z.boolean().default(true),
  gameKey: key,
  ending: z.enum(ENDINGS).optional(),
  players: z.array(z.object({
    key,
    win: z.boolean().default(false),
    // Integers only — what PUT …/scores stores. The client drops the rest.
    score: z.number().int().optional(),
    team: z.string().max(60).optional(),
  })).max(30),
});

const importSchema = z.object({
  source: z.enum(IMPORT_SOURCES),
  people: z.array(personSchema).max(500).default([]),
  games: z.array(gameSchema).max(1000).default([]),
  plays: z.array(playSchema).min(1).max(IMPORT_BATCH_MAX),
});

router.post('/', async (req, res) => {
  const round = await req.repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const body = validateBody(importSchema, req, res);
  if (!body) return;

  const actor = actorSeat(round, req.userId);
  let built;
  try {
    built = buildImport(round, body, { actor });
  } catch (err) {
    if (err instanceof ImportError) return res.status(400).json({ error: err.message });
    throw err;
  }

  // The account-tier marks (#1389), measured ONCE around the whole batch — a
  // 300-play import must not announce 300 crossings. Only seats that already
  // exist can hold an account; a member this import creates has none yet.
  const touched = [...new Set(built.sessions.flatMap((s) => s.memberIds))];
  const badgesBefore = req.userId && built.sessions.length
    ? await badgeSnapshot(affectedAccounts(round.members, { finished: false, memberIds: touched }, []))
    : null;

  const limits = quota.enforced()
    ? { maxMembers: quota.membersPerRound(), maxGames: quota.gamesPerRound() }
    : null;
  const result = await req.repo.importSessions(req.params.rid, built, actor, limits);
  if (!result) return res.status(404).json({ error: 'Round not found' });
  if (result === 'quota_members') {
    return res.status(403).json({ error: 'quota_members', limit: quota.membersPerRound() });
  }
  if (result === 'quota_games') {
    return res.status(403).json({ error: 'quota_games', limit: quota.gamesPerRound() });
  }

  // No `session_played` feed event per session: an imported play happened on
  // another day, which is the back-catalogue problem #1616 refuses for a single
  // logged session — and an import is that problem a few hundred times over.
  if (result.sessions.length) {
    trackEvent('sessions_imported', { tenantId: req.tenantId });
    await announceBadgeCrossings(badgesBefore);
  }
  // Games put onto the shelf get their cover and player range from BGG the way
  // a collection import does — fire-and-forget, every failure swallowed.
  const shelved = backfillCandidates(result.games);
  if (shelved.length) backfillProviderInfo(req.repo, req.params.rid, shelved).catch(() => {});

  // A batch whose every play was already here writes nothing — no seats, no
  // games — so it reports no new ids either, and the client keeps asking for
  // them to be created in its next batch.
  // Only what this batch actually WROTE: the repo writes just the seats and
  // games its surviving sessions name, so a key whose entity waits for a later
  // batch reports nothing and the client keeps asking for it to be created.
  const writtenMembers = new Set(result.members.map((m) => m.id));
  const writtenGames = new Set(result.games.map((g) => g.id));
  const keep = (created, written) => Object.fromEntries(
    Object.entries(created).filter(([, id]) => written.has(id)));
  res.status(201).json({
    imported: result.sessions.length,
    skipped: result.skipped,
    empty: built.empty,
    people: keep(built.createdPeople, writtenMembers),
    games: keep(built.createdGames, writtenGames),
  });
});

module.exports = router;
