'use strict';

/* A round's group challenge (#1779): one preset goal with a deadline. Only the
   goal is stored; progress, completion and expiry are derived on every read by
   public/js/challenges.js, which this route requires so it agrees with the
   screens about whether one is still RUNNING. Mounted at
   /api/rounds/:rid/challenge; mergeParams for :rid.

     POST   /   { kind, n?, deadline } — start one; 409 while one is running
     DELETE /                          — end it early, or archive a finished one */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../validate');
const {
  CHALLENGE_KINDS, CHALLENGE_COUNTED, CHALLENGE_HISTORY_MAX, challengeRunning, challengeStartError,
} = require('../../public/js/challenges');
const { isActiveGame } = require('../draw');

const router = express.Router({ mergeParams: true });
const opts = { isActive: isActiveGame };

// The SHAPE; challengeStartError (shared with the sheet) owns the bounds, so
// the client and the route refuse the same n and the same deadline. Unknown
// keys are stripped — a client-sent `shelfSnapshot` never reaches the store.
const startSchema = z.object({
  kind: z.enum(CHALLENGE_KINDS),
  n: z.number().optional(),
  deadline: z.string(),
}, { message: 'Invalid challenge' });

// The stored history, newest first, capped — the archived entry leads.
const archive = (round, ch) => [ch].concat(round.challengeHistory || []).slice(0, CHALLENGE_HISTORY_MAX);

router.post('/', async (req, res) => {
  const body = validateBody(startSchema, req, res);
  if (!body) return;
  const now = Date.now();
  const invalid = challengeStartError(body, now);
  if (invalid) return res.status(400).json({ error: invalid });
  const round = await req.repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  if (challengeRunning(round, now, opts)) return res.status(409).json({ error: 'A challenge is already running' });

  const challenge = { kind: body.kind, startedAt: new Date(now).toISOString(), deadline: new Date(Date.parse(body.deadline)).toISOString() };
  if (CHALLENGE_COUNTED.includes(body.kind)) challenge.n = body.n;
  if (body.kind === 'wholeShelf') {
    // The snapshot is the server's, so a client cannot shrink the shelf it is
    // challenged to play through.
    challenge.shelfSnapshot = (round.games || []).filter(isActiveGame).map((g) => g.id);
    if (!challenge.shelfSnapshot.length) return res.status(400).json({ error: 'The shelf is empty' });
  }
  // A finished (completed or expired) predecessor moves into the history.
  const history = round.challenge ? archive(round, round.challenge) : (round.challengeHistory || []);
  const result = await req.repo.setChallenge(req.params.rid, { challenge, history });
  if (!result) return res.status(404).json({ error: 'Round not found' });
  res.status(201).json(result);
});

router.delete('/', async (req, res) => {
  const round = await req.repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  if (!round.challenge) return res.status(404).json({ error: 'No challenge' });
  // Only a RUNNING one is stamped as ended early; a completed or expired one
  // keeps the outcome it already had.
  const ch = challengeRunning(round, Date.now(), opts)
    ? { ...round.challenge, endedAt: new Date().toISOString() }
    : round.challenge;
  const result = await req.repo.setChallenge(req.params.rid, { challenge: null, history: archive(round, ch) });
  if (!result) return res.status(404).json({ error: 'Round not found' });
  res.json(result);
});

module.exports = router;
