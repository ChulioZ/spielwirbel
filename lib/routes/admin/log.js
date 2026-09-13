'use strict';

/*
 * The moderation action log and the in-app feedback inbox (#260/#288), with their CSV exports.
 *
 * One of the operator router's sub-routers (#996). Mounted by
 * lib/routes/admin/index.js, which owns the /api/admin prefix, the
 * ADMIN_PASSWORD gate and the single mount in lib/app.js.
 *
 * Like every handler here it uses the module-level `repo`, NOT req.repo:
 * moderation is deliberately cross-tenant (a notice names an image, not a
 * tenant), which is exactly why the moderation methods are absent from
 * TENANT_METHODS. The tenant middleware never runs for this router. See
 * .claude/rules/admin-moderation-surface.md.
 */

const express = require('express');
const repo = require('../../repo');
const { logger } = require('../../observability');
const { sendCsv } = require('../../csv');
const { pageParams , idSchema } = require('./shared');
const router = express.Router();

/* ----------------------------------- log ----------------------------------- */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;

// A bare 'YYYY-MM-DD' (what a date input sends) is widened to cover the whole
// day, and the two ends are widened in OPPOSITE directions: 'to=2026-07-20'
// must include everything that happened ON the 20th, which a naive
// at <= '2026-07-20' would exclude entirely — silently hiding a day's actions
// from the record backing Art. 17. Both backends then compare exact instants,
// so neither can disagree about what the range means.
function bound(value, end) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (DATE_ONLY.test(v)) return `${v}T${end ? '23:59:59.999' : '00:00:00.000'}Z`;
  return ISO_INSTANT.test(v) ? v : undefined; // undefined = malformed
}

// null on every key when nothing was asked for, so the repos take their
// unfiltered path. Returns false for a malformed date so the caller can 400
// rather than quietly return the whole log.
function logFilters(req) {
  const from = bound(req.query.from, false);
  const to = bound(req.query.to, true);
  if (from === undefined || to === undefined) return false;
  return {
    tenantId: String(req.query.tenant || '').trim() || null,
    action: String(req.query.action || '').trim() || null,
    from,
    to,
  };
}

// The action record backing Art. 17 statements of reasons. Newest first, and
// since #275 narrowable to one tenant / action / date range — the log is also
// what gets handed over on a law-enforcement request, where "every action ever"
// is the wrong answer to a question about one account.
router.get('/log', async (req, res) => {
  const { limit, offset } = pageParams(req);
  const filters = logFilters(req);
  if (!filters) return res.status(400).json({ error: 'Not a valid date' });
  res.json({
    entries: await repo.listModeration(limit, offset, filters),
    // Filtered too — a total counting entries the filtered list can never reach
    // would make the card's "20 von 300" a lie about what is being shown.
    total: await repo.countModeration(filters),
  });
});

// The values the filter can actually match, so the panel offers no dead options.
router.get('/log/actions', async (req, res) => {
  res.json({ actions: await repo.moderationActions() });
});

const LOG_COLUMNS = [
  ['Zeitpunkt', (e) => e.at],
  ['Aktion', (e) => e.action],
  ['Ziel', (e) => e.target],
  ['Spiel', (e) => e.gameTitle],
  ['E-Mail', (e) => e.email],
  ['Tenant', (e) => e.tenantId],
  // The redacted original (#275). It exists nowhere else once the field is
  // blanked, so an export that omitted it would not be a complete record.
  ['Vorher', (e) => e.previous],
  ['Begründung', (e) => e.reason],
];

// Honours the same filters as the card, so "export what I'm looking at" does
// exactly that — an export that silently widened back to everything would leak
// unrelated tenants into a hand-over prepared for one.
router.get('/log.csv', async (req, res) => {
  const filters = logFilters(req);
  if (!filters) return res.status(400).json({ error: 'Not a valid date' });
  await sendCsv(res, {
    name: 'protokoll',
    columns: LOG_COLUMNS,
    count: () => repo.countModeration(filters),
    list: (total) => repo.listModeration(total, 0, filters),
  });
});

/* -------------------------------- feedback --------------------------------- */

// In-app user feedback (issue #260), newest first. It lives on THIS router, and
// therefore behind ADMIN_PASSWORD, rather than getting a credential of its own:
// a second admin secret alongside the panel's would be a strictly worse surface
// to secure for no gain. Same limit clamp as /log.
//
// Feedback is global, un-scoped data (like the moderation log), so this reads it
// from the module-level `repo` — req.repo does not exist on this router and
// listFeedback is deliberately absent from TENANT_METHODS.
router.get('/feedback', async (req, res) => {
  const { limit, offset } = pageParams(req);
  res.json({
    entries: await repo.listFeedback(limit, offset),
    total: await repo.countFeedback(),
  });
});

// `context` is flattened into columns rather than dumped as JSON into one cell —
// the whole point of a CSV is that the operator can sort and filter on these.
const FEEDBACK_COLUMNS = [
  ['Zeitpunkt', (f) => f.createdAt],
  ['Nachricht', (f) => f.message],
  ['Pfad', (f) => (f.context || {}).path],
  ['Sprache', (f) => (f.context || {}).locale],
  ['Tenant', (f) => (f.context || {}).tenantId],
  ['E-Mail', (f) => (f.context || {}).email],
];

router.get('/feedback.csv', async (req, res) => {
  await sendCsv(res, {
    name: 'feedback',
    columns: FEEDBACK_COLUMNS,
    count: () => repo.countFeedback(),
    list: (total) => repo.listFeedback(total),
  });
});

// Delete one feedback entry (issue #389). Feedback carries no retention duty —
// the privacy policy (§11) even promises it is deleted once no longer needed —
// so it is freely deletable, unlike a decided Meldung below.
router.delete('/feedback/:id', async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ error: 'Not a valid id' });
  const removed = await repo.deleteFeedback(parsed.data);
  if (!removed) return res.status(404).json({ error: 'not_found' });
  logger.info({ event: 'admin_feedback_deleted' });
  res.json({ ok: true });
});

module.exports = router;
