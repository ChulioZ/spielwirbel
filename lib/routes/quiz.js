'use strict';

/*
 * The weekly quiz (#743) — the account's side: this week's round, one answer at
 * a time, and the friends leaderboard. The unscored landing-page sample is NOT
 * here; it is a public route in lib/app.js, ahead of the auth gates.
 *
 * Mounted at /api/quiz BEHIND the /api gate and withTenant, like
 * /api/price-watches and for its reason: withTenant is what refuses a suspended
 * or erased account, and the /api/account mounts ride the login limiter, which
 * five answers a week have no business spending. Every repo call is scoped to
 * `req.userId`; nothing here touches tenant data.
 *
 * ANSWERS ARRIVE ONE AT A TIME and are final when recorded: the reply reveals
 * right/wrong and the correct choice, so a changeable answer would be a free
 * look at the key. The repo refuses a second answer to one question inside the
 * write that records the first. That keeps the key out of the browser before
 * an answer — it does NOT make the leaderboard cheat-proof: the round is the
 * same for everyone, so a second registered account can still learn it.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../repo');
const quiz = require('../quiz');
const { weekKey } = require('../calendar-periods');
const { isDemoTenant } = require('../demo-tenant');
const { validateBody } = require('../validate');

const router = express.Router();

router.use((req, res, next) => {
  if (!quiz.available()) return res.status(404).json({ error: 'not_found' });
  if (!req.userId) return res.status(401).json({ error: 'auth_required' });
  // A guest demo may not play (operator decision on #743): every account gets
  // the same round and every answer reveals its key, so a one-click throwaway
  // demo would be a free look at the answers before playing for real. The demo
  // sees the quiz as a teaser instead, built from the public sample.
  if (isDemoTenant(req.tenantId)) return res.status(403).json({ error: 'demo_forbidden' });
  next();
});

router.get('/current', async (req, res) => {
  const round = await quiz.ensureRound();
  if (!round) return res.status(404).json({ error: 'no_round' });
  res.json(quiz.presentRound(round, await repo.getQuizSubmission(req.userId, round.week)));
});

const answerSchema = z.object({
  // The week the client is answering — a round that closed while the page was
  // open must not take an answer meant for last week's question.
  week: z.string().min(1).max(10),
  index: z.number().int().min(0).max(7),
  choice: z.number().int().min(0).max(3),
});

router.post('/current/answers', async (req, res) => {
  const body = validateBody(answerSchema, req, res);
  if (!body) return;
  const round = await quiz.ensureRound();
  if (!round) return res.status(404).json({ error: 'no_round' });
  if (body.week !== round.week) return res.status(409).json({ error: 'round_closed' });
  const q = round.questions[body.index];
  if (!q || body.choice >= q.choices.length) return res.status(400).json({ error: 'invalid_answer' });
  const correct = body.choice === q.answer;
  const saved = await repo.recordQuizAnswer(req.userId, round.week, body.index, round.questions.length, { choice: body.choice, correct });
  if (saved === 'answered') return res.status(409).json({ error: 'already_answered' });
  res.json({
    correct, answer: q.answer, score: saved.score, answered: saved.answers.filter(Boolean).length, total: round.questions.length,
  });
});

/*
 * This week's standings among the caller and their CONFIRMED friends — never
 * anyone else, never a demo account, and never a friend who switched their
 * numbers off for friends (`statsVisible: false`, the opt-out the profile stats
 * and the badge feed honour too). The caller always sees their own row. Its own
 * read, not the friends feed: a feed row is a { type, title, coverUrl }
 * allowlist by construction, and a score does not belong in it.
 */
router.get('/leaderboard', async (req, res) => {
  const week = weekKey();
  const friends = (await repo.listFriendships(req.userId))
    .filter((f) => f.status === 'accepted')
    .map((f) => (f.requesterUserId === req.userId ? f.addresseeUserId : f.requesterUserId));
  const people = new Map();
  await Promise.all([req.userId, ...new Set(friends)].map(async (uid) => {
    const u = await repo.getUserById(uid);
    if (!u || !u.username) return;
    if (uid !== req.userId && (isDemoTenant(u.tenantId) || u.disabled || u.statsVisible === false)) return;
    people.set(uid, { username: u.username, avatar: u.avatar || null });
  }));
  const subs = await repo.listQuizSubmissions(week, [...people.keys()]);
  const entries = subs.map((s) => ({
    ...people.get(s.userId),
    score: s.score || 0,
    answered: (s.answers || []).filter(Boolean).length,
    me: s.userId === req.userId,
  })).sort((a, b) => b.score - a.score || b.answered - a.answered || a.username.localeCompare(b.username));
  res.json({ week, entries });
});

module.exports = router;
