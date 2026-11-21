'use strict';

/*
 * „Wertungskategorien" (#1787): the operator confirms, for every round at once,
 * the base scoring categories of a BoardGameGeek game — chosen from the sets the
 * rounds themselves have typed (#1780).
 *
 * The sibling of lib/routes/admin/game-scoring.js (#1786), mounted the same way
 * behind the ADMIN_PASSWORD gate, and bound by the same payload rule: category
 * NAMES, counts, a BGG id, a title, a state and dates — never a round, tenant,
 * member or account identifier. A set shows from the first round that defines
 * it (operator decision 2026-11-08), which is safe only because it carries no
 * attribution; test/game-categories-admin.test.js sweeps every response for the
 * ids its fixture minted.
 *
 * A confirmation writes ONLY the global table. Rounds see it through the read
 * overlay in lib/repo/index.js, and after each write the overlay's cache is
 * invalidated, so this process serves the new sheet at once.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../../repo');
const { categoryState, foldCategoryRounds, buildCategoryBase, categorySetKey } = require('../../game-categories');
const { CSV_BOM, toCsv } = require('../../csv');
const { validateBody } = require('../../validate');
const { logger } = require('../../observability');

const router = express.Router();

const STATES = ['open', 'confirmed', 'dismissed'];

// Sorted like the direction list: most rounds first, then title, then id.
async function categoryList() {
  const [folded, settings] = await Promise.all([
    repo.gameCategoryRounds().then(foldCategoryRounds),
    repo.listGameCategorySettings(),
  ]);
  const byId = new Map(folded.map((f) => [f.bggId, f]));
  const settingOf = new Map(settings.map((s) => [String(s.bggId), s]));
  // A confirmed game no round defines categories for any more stays listed:
  // the base still applies, and „Bestätigung aufheben" must stay reachable.
  for (const s of settings) {
    if (!byId.has(String(s.bggId))) byId.set(String(s.bggId), { bggId: String(s.bggId), rounds: 0, title: null, sets: [] });
  }
  const corpus = new Map((await repo.getCorpusEntries([...byId.keys()])).map((e) => [String(e.externalId), e.name]));
  const list = [...byId.values()].map((f) => {
    const s = settingOf.get(f.bggId) || null;
    const state = categoryState(s, f.rounds, f.sets.length);
    const confirmed = state === 'confirmed' && Array.isArray(s.categories) ? s.categories.map((c) => c.name) : null;
    return {
      bggId: f.bggId,
      title: corpus.get(f.bggId) || f.title || (s && s.title) || null,
      rounds: f.rounds,
      sets: f.sets.map((x) => ({ names: x.names, rounds: x.rounds })),
      state,
      categories: confirmed,
      confirmedAt: state === 'confirmed' ? s.confirmedAt || null : null,
    };
  });
  return list.sort((a, b) => b.rounds - a.rounds
    || String(a.title || '').localeCompare(String(b.title || ''), 'de')
    || (a.bggId < b.bggId ? -1 : 1));
}

const filtered = (list, state) => (STATES.includes(state) ? list.filter((g) => g.state === state) : list);

const STATE_LABELS = { open: 'offen', confirmed: 'bestätigt', dismissed: 'zurückgestellt' };

// One row per game × set (the issue's shape). A confirmed game whose base no
// round's set equals still gets a row for the base itself, with 0 rounds, so the
// file says what applies.
function csvRows(list) {
  const rows = [];
  for (const g of list) {
    const base = g.categories ? categorySetKey(g.categories) : null;
    for (const set of g.sets) {
      const isBase = base !== null && categorySetKey(set.names) === base;
      rows.push({ g, names: set.names, rounds: set.rounds, isBase });
    }
    if (base !== null && !rows.some((r) => r.g === g && r.isBase)) rows.push({ g, names: g.categories, rounds: 0, isBase: true });
    if (!g.sets.length && base === null) rows.push({ g, names: [], rounds: 0, isBase: false });
  }
  return rows;
}

const CSV_COLUMNS = [
  ['BGG-ID', (r) => r.g.bggId],
  ['Titel', (r) => r.g.title],
  ['Runden', (r) => r.rounds],
  ['Kategorien', (r) => r.names.join(' · ')],
  ['Status', (r) => STATE_LABELS[r.g.state]],
  ['Bestätigter Satz', (r) => (r.isBase ? 'ja' : '')],
  ['Bestätigt am', (r) => (r.isBase ? r.g.confirmedAt || '' : '')],
];

router.get('/game-categories', async (req, res) => {
  res.json({ games: filtered(await categoryList(), req.query.state) });
});

// Through lib/csv.js: category names are user-typed, and this file is meant to
// be opened in a spreadsheet (formula leads, RFC 4180 quoting).
router.get('/game-categories.csv', async (req, res) => {
  const rows = csvRows(filtered(await categoryList(), req.query.state));
  if (req.query.copy === '1') return res.type('text/plain; charset=utf-8').send(toCsv(CSV_COLUMNS, rows));
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="spielwirbel-wertungskategorien-${date}.csv"`);
  res.send(CSV_BOM + toCsv(CSV_COLUMNS, rows));
});

const bggIdSchema = z.string().regex(/^[0-9]{1,12}$/, 'Not a BGG id');
const names = z.array(z.string().max(200)).min(1).max(50);

const actionSchema = z.discriminatedUnion('action', [
  // `set` names the round-defined set being confirmed (as listed); `names` is
  // the operator's spelling of it, same length.
  z.object({ action: z.literal('confirm'), set: names, names }),
  z.object({ action: z.literal('dismiss') }),
  z.object({ action: z.literal('revoke') }),
]);

const CONFIRM_ERRORS = { names_mismatch: 400, invalid_names: 400, duplicate_names: 400 };

router.post('/game-categories/:bggId', async (req, res) => {
  const id = bggIdSchema.safeParse(req.params.bggId);
  if (!id.success) return res.status(400).json({ error: 'invalid_bgg_id' });
  const valid = validateBody(actionSchema, req, res);
  if (!valid) return;
  const bggId = id.data;
  const entry = (await categoryList()).find((g) => g.bggId === bggId);

  if (valid.action === 'revoke') {
    const existing = await repo.getGameCategorySetting(bggId);
    if (!existing || existing.state !== 'confirmed') return res.status(409).json({ error: 'not_confirmed' });
    await repo.deleteGameCategorySetting(bggId);
  } else {
    if (!entry) return res.status(404).json({ error: 'not_found' });
    const now = new Date().toISOString();
    if (valid.action === 'confirm') {
      // Only a set some round actually defines: the operator corrects SPELLING,
      // never invents a sheet no round uses.
      const key = categorySetKey(valid.set);
      if (!entry.sets.some((s) => categorySetKey(s.names) === key)) return res.status(404).json({ error: 'set_not_found' });
      const built = buildCategoryBase(bggId, valid.set, valid.names);
      if (built.error) return res.status(CONFIRM_ERRORS[built.error] || 400).json({ error: built.error });
      await repo.putGameCategorySetting(bggId, { state: 'confirmed', categories: built.base, confirmedAt: now, title: entry.title });
    } else {
      await repo.putGameCategorySetting(bggId, {
        state: 'dismissed', dismissedAt: now, dismissedAtRounds: entry.rounds, dismissedAtSets: entry.sets.length, title: entry.title,
      });
    }
  }
  repo.confirmedCategories.invalidate();
  logger.info({ event: 'admin_game_categories', action: valid.action, bggId });
  const updated = (await categoryList()).find((g) => g.bggId === bggId) || null;
  res.json({ ok: true, game: updated });
});

module.exports = router;
