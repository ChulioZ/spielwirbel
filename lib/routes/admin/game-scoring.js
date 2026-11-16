'use strict';

/*
 * „Spieleinstellungen" (#1786): the operator confirms, for every round at once,
 * whether a BoardGameGeek game is won by the highest or the lowest score.
 *
 * One of the operator router's sub-routers (#996), mounted behind the
 * ADMIN_PASSWORD gate by lib/routes/admin/index.js. It uses the module-level
 * `repo`: the queue is an aggregate across tenants, and the settings table is
 * global.
 *
 * WHAT THE PAYLOAD MAY CARRY: counts, a BGG id, a title, a state and dates —
 * never a round, tenant, member or account identifier. The aggregate only ever
 * learns "how many rounds", and test/game-scoring-admin.test.js sweeps the
 * response for every id its fixture minted.
 *
 * A confirmation writes ONLY the global table. Rounds see it through the read
 * overlay in lib/repo/index.js, so nothing here writes into a tenant — the
 * write half of .claude/rules/admin-cross-tenant-escape.md has nothing to get
 * wrong. After each write the overlay's cache is invalidated, so this process
 * serves the new value at once.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../../repo');
const { settingState, foldScoringRounds } = require('../../game-scoring');
const { CSV_BOM, toCsv } = require('../../csv');
const { validateBody } = require('../../validate');
const { logger } = require('../../observability');

const router = express.Router();

const STATES = ['open', 'confirmed', 'dismissed'];

// The whole list, every state. Sorted by contributing rounds (most first), then
// by title, so a tie does not reshuffle between loads.
async function scoringList() {
  const [folded, settings] = await Promise.all([
    repo.gameScoringRounds().then(foldScoringRounds),
    repo.listGameScoringSettings(),
  ]);
  const byId = new Map(folded.map((f) => [f.bggId, f]));
  const settingOf = new Map(settings.map((s) => [String(s.bggId), s]));
  // A confirmed game no round scores any more stays listed: the confirmation
  // still applies to it, and „Bestätigung aufheben" has to stay reachable.
  for (const s of settings) {
    if (!byId.has(String(s.bggId))) {
      byId.set(String(s.bggId), { bggId: String(s.bggId), rounds: 0, lowWins: 0, highWins: 0, title: null });
    }
  }
  // The licensed corpus name wins over a title some round typed: it names the
  // BGG entry itself and was written by nobody here.
  const corpus = new Map((await repo.getCorpusEntries([...byId.keys()])).map((e) => [String(e.externalId), e.name]));
  const list = [...byId.values()].map((f) => {
    const s = settingOf.get(f.bggId) || null;
    const state = settingState(s, f.rounds);
    return {
      bggId: f.bggId,
      title: corpus.get(f.bggId) || f.title || (s && s.title) || null,
      rounds: f.rounds,
      lowWins: f.lowWins,
      highWins: f.highWins,
      state,
      lowScoreWins: state === 'confirmed' ? !!s.lowScoreWins : null,
      confirmedAt: state === 'confirmed' ? s.confirmedAt || null : null,
    };
  });
  return list.sort((a, b) => b.rounds - a.rounds
    || String(a.title || '').localeCompare(String(b.title || ''), 'de')
    || (a.bggId < b.bggId ? -1 : 1));
}

const filtered = (list, state) => (STATES.includes(state) ? list.filter((g) => g.state === state) : list);

const STATE_LABELS = { open: 'offen', confirmed: 'bestätigt', dismissed: 'zurückgestellt' };

const CSV_COLUMNS = [
  ['BGG-ID', (g) => g.bggId],
  ['Titel', (g) => g.title],
  ['Runden mit Punkten', (g) => g.rounds],
  ['Niedrigste gewinnt', (g) => g.lowWins],
  ['Höchste gewinnt', (g) => g.highWins],
  ['Status', (g) => STATE_LABELS[g.state]],
  ['Festgelegt', (g) => (g.lowScoreWins == null ? '' : g.lowScoreWins ? 'niedrigste' : 'höchste')],
  ['Festgelegt am', (g) => g.confirmedAt || ''],
];

router.get('/game-scoring', async (req, res) => {
  res.json({ games: filtered(await scoringList(), req.query.state) });
});

// The same filtered list as CSV — the download, and the text „Kopieren" puts on
// the clipboard. Through lib/csv.js, because a title is user-typed when the
// corpus does not know the game, and this file is meant to be opened in Excel
// (formula injection, RFC 4180 quoting).
router.get('/game-scoring.csv', async (req, res) => {
  const list = filtered(await scoringList(), req.query.state);
  if (req.query.copy === '1') {
    return res.type('text/plain; charset=utf-8').send(toCsv(CSV_COLUMNS, list));
  }
  // Not lib/csv.js sendCsv: that one pages a count/list pair, and this list is
  // already whole and in memory.
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="spielwirbel-spieleinstellungen-${date}.csv"`);
  res.send(CSV_BOM + toCsv(CSV_COLUMNS, list));
});

const bggIdSchema = z.string().regex(/^[0-9]{1,12}$/, 'Not a BGG id');

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm'), lowScoreWins: z.boolean() }),
  z.object({ action: z.literal('dismiss') }),
  z.object({ action: z.literal('revoke') }),
]);

router.post('/game-scoring/:bggId', async (req, res) => {
  const id = bggIdSchema.safeParse(req.params.bggId);
  if (!id.success) return res.status(400).json({ error: 'invalid_bgg_id' });
  const valid = validateBody(actionSchema, req, res);
  if (!valid) return;
  const bggId = id.data;
  const entry = (await scoringList()).find((g) => g.bggId === bggId);

  if (valid.action === 'revoke') {
    const existing = await repo.getGameScoringSetting(bggId);
    if (!existing || existing.state !== 'confirmed') return res.status(409).json({ error: 'not_confirmed' });
    await repo.deleteGameScoringSetting(bggId);
  } else {
    // Only a game the queue actually lists can be confirmed or dismissed: an
    // id no round has scored is a typo, and a confirmation for it would lock
    // the switch in some round that links it later for a reason nobody saw.
    if (!entry) return res.status(404).json({ error: 'not_found' });
    const now = new Date().toISOString();
    await repo.putGameScoringSetting(bggId, valid.action === 'confirm'
      ? { state: 'confirmed', lowScoreWins: valid.lowScoreWins, confirmedAt: now, title: entry.title }
      : { state: 'dismissed', dismissedAt: now, dismissedAtRounds: entry.rounds, title: entry.title });
  }
  repo.confirmedScoring.invalidate();
  logger.info({ event: 'admin_game_scoring', action: valid.action, bggId });
  const updated = (await scoringList()).find((g) => g.bggId === bggId) || null;
  res.json({ ok: true, game: updated });
});

module.exports = router;
