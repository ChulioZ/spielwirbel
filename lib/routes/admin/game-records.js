'use strict';

/*
 * „Spielwirbel-Rekorde" (#1788): the operator's review of outlier scores and
 * the list of current records.
 *
 * One of the operator router's sub-routers, mounted behind the ADMIN_PASSWORD
 * gate by lib/routes/admin/index.js, on the module-level repo: both lists are
 * aggregates across tenants, and both tables are global.
 *
 * WHAT THE PAYLOAD MAY CARRY: a BGG id, a title, scores, counts, dates and the
 * opaque `ref` (a hash of the score key, lib/game-records.js `scoreRef`) —
 * never a round, tenant, member or account identifier.
 * test/game-records-admin.test.js sweeps every response for every id its
 * fixture minted.
 *
 * A decision writes ONLY the global review table and then recomputes at once,
 * so the record moves while the operator watches rather than up to one tick
 * later. Neither decision touches the round: its own records and points stand.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../../repo');
const gameRecords = require('../../game-records');
const { CSV_BOM, toCsv } = require('../../csv');
const { validateBody } = require('../../validate');
const { logger } = require('../../observability');

const router = express.Router();

// The licensed corpus name wins: it names the BGG entry itself and was written
// by nobody here. Without one the row shows its BGG id — never a title some
// round typed, which this screen has no reason to collect.
async function withTitles(list) {
  const ids = [...new Set(list.map((e) => e.bggId))];
  const names = new Map((await repo.getCorpusEntries(ids)).map((e) => [String(e.externalId), e.name]));
  return list.map((e) => ({ ...e, title: names.get(e.bggId) || null }));
}

const lists = async () => ({
  reviews: await withTitles(await gameRecords.reviewList()),
  records: await withTitles(await gameRecords.recordList()),
});

router.get('/game-records', async (req, res) => {
  res.json({ ...(await lists()), recomputedAt: gameRecords.lastRun() });
});

const REASON_LABELS = { session: 'Session', jump: 'Sprung', distribution: 'Verteilung' };
const fmtNum = (v) => (v == null ? '' : String(Math.round(v * 10) / 10));
const title = (e) => e.title || `BGG ${e.bggId}`;

const REVIEW_COLUMNS = [
  ['Spiel', title],
  ['BGG-ID', (e) => e.bggId],
  ['Punkte', (e) => e.points],
  ['Zurückgehalten', (e) => (e.heldBack ? 'ja' : 'nein')],
  ['Auffällig', (e) => e.reasons.map((r) => REASON_LABELS[r] || r).join(', ')],
  ['Rekord', (e) => (e.record == null ? '' : e.record)],
  ['Wertungen', (e) => e.count],
  ['Median', (e) => fmtNum(e.median)],
  ['90. Perzentil', (e) => fmtNum(e.p90)],
  ['Spieler', (e) => e.players || ''],
  ['Datum', (e) => e.at || ''],
  ['Andere Punkte der Session', (e) => e.peers.join(' ')],
];

const RECORD_COLUMNS = [
  ['Spiel', title],
  ['BGG-ID', (e) => e.bggId],
  ['Rekord', (e) => e.value],
  ['Richtung', (e) => (e.lowWins ? 'niedrigste' : 'höchste')],
  ['Wertungen', (e) => e.count],
  ['Median', (e) => fmtNum(e.median)],
  ['90. Perzentil', (e) => fmtNum(e.p90)],
  ['Runden', (e) => e.rounds],
  ['Aufgestellt am', (e) => e.recordAt || ''],
];

// Either list as CSV (through lib/csv.js: quoting and formula leads) — the
// download and the text „Kopieren" puts on the clipboard.
router.get('/game-records.csv', async (req, res) => {
  const which = req.query.list === 'records' ? 'records' : 'reviews';
  const all = await lists();
  const text = toCsv(which === 'records' ? RECORD_COLUMNS : REVIEW_COLUMNS, all[which]);
  if (req.query.copy === '1') return res.type('text/plain; charset=utf-8').send(text);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="spielwirbel-rekorde-${which}-${date}.csv"`);
  res.send(CSV_BOM + text);
});

const refSchema = z.string().regex(/^[0-9a-f]{20}$/, 'Not a score ref');
const actionSchema = z.object({ action: z.enum(['valid', 'exclude']) });

router.post('/game-records/:ref', async (req, res) => {
  const ref = refSchema.safeParse(req.params.ref);
  if (!ref.success) return res.status(400).json({ error: 'invalid_ref' });
  const valid = validateBody(actionSchema, req, res);
  if (!valid) return;
  const hit = await gameRecords.resolveRef(ref.data);
  if (!hit) return res.status(404).json({ error: 'not_found' });
  const now = new Date().toISOString();
  const base = hit.review || {
    // A record-holding score nobody flagged: its snapshot is what the record
    // row knows about it.
    bggId: String(hit.record.bggId),
    points: hit.record.value,
    ref: ref.data,
    reasons: [],
  };
  await repo.putScoreReview(hit.key, {
    ...base,
    state: valid.action === 'valid' ? 'valid' : 'excluded',
    heldBack: false,
    decidedAt: now,
  });
  // Recompute now (and refresh this process's overlay cache inside it), so the
  // record moves while the operator watches.
  await gameRecords.recompute(now);
  logger.info({ event: 'admin_game_record', action: valid.action });
  res.json({ ok: true, ...(await lists()) });
});

module.exports = router;
