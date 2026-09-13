'use strict';

/*
 * DSA notices and the Art. 17 statement of reasons (#272).
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
const { z } = require('zod');
const { validateBody } = require('../../validate');
const repo = require('../../repo');
const mail = require('../../mail');
const { logger } = require('../../observability');
const { sendCsv } = require('../../csv');
const { REASON_MAX, pageParams , idSchema } = require('./shared');
const router = express.Router();

/* ------------------------------ notices (#272) ------------------------------ */

// The Meldungen inbox: every stored contact-form submission / DSA Art. 16
// notice (lib/routes/contact.js writes them), newest first. Global un-scoped data
// like feedback and the log — read from the module-level repo.
router.get('/notices', async (req, res) => {
  const { limit, offset } = pageParams(req);
  res.json({
    entries: await repo.listContactNotices(limit, offset),
    total: await repo.countContactNotices(),
  });
});

const NOTICE_COLUMNS = [
  ['Zeitpunkt', (n) => n.createdAt],
  ['Kategorie', (n) => n.category],
  ['URL', (n) => n.url],
  ['Gemeldeter Nutzername', (n) => n.reportedUsername],
  ['Betreff', (n) => n.subject],
  ['Nachricht', (n) => n.message],
  ['Name', (n) => n.name],
  ['E-Mail', (n) => n.email],
  ['Status', (n) => n.status],
  ['Entschieden', (n) => n.decidedAt],
  ['Entscheidung', (n) => n.decisionNote],
];

router.get('/notices.csv', async (req, res) => {
  await sendCsv(res, {
    name: 'meldungen',
    columns: NOTICE_COLUMNS,
    count: () => repo.countContactNotices(),
    list: (total) => repo.listContactNotices(total),
  });
});

// Backtracking-safe email shape (same as lib/routes/contact.js — length-guarded,
// dot-free domain labels, so the match is linear even on hostile input).
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const toSchema = z.preprocess(
  (v) => String(v || '').trim(),
  z.string().max(254).regex(EMAIL_RE, 'invalid_email'),
);

const dateDe = (iso) =>
  new Date(iso).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });

// Decide a notice: set its status and — on request — notify the notifier of the
// outcome with redress information (Art. 16(5) DSA). The mail goes out FIRST:
// a failed send refuses the whole decision (502, nothing stored), so the panel
// can never show "decided & notified" for a notification that never left.
// Bilingual like the acknowledgement — a notifier can be anyone.
router.post('/notices/:nid/decision', async (req, res) => {
  const body = validateBody(z.object({
    status: z.enum(['actioned', 'rejected']),
    // A short explanation quoted in the decision mail. Optional — "content
    // removed" often speaks for itself; a rejection should carry one.
    note: z.preprocess((v) => String(v || '').trim(), z.string().max(REASON_MAX, 'Note is too long')).optional(),
    sendEmail: z.boolean().optional(),
  }), req, res);
  if (!body) return;

  const notice = await repo.getContactNotice(req.params.nid);
  if (!notice) return res.status(404).json({ error: 'not_found' });

  const at = new Date().toISOString();
  let decisionSentAt = null;
  if (body.sendEmail) {
    // An anonymous (CSAM) notice has nobody to notify — Art. 16(5) only
    // applies where the notice contains contact details.
    if (!notice.email) return res.status(400).json({ error: 'no_notifier_email' });
    const about = `${dateDe(notice.createdAt)}${notice.url ? ` (${notice.url})` : ''}`;
    const acted = body.status === 'actioned';
    const noteDe = body.note ? ` Begründung: ${body.note}` : '';
    const noteEn = body.note ? ` Reason: ${body.note}` : '';
    try {
      await mail.send({
        to: notice.email,
        subject: 'Spielwirbel: Entscheidung zu deiner Meldung / Decision on your report',
        text: `Hallo!\n\nZu deiner Meldung vom ${about}: Wir haben ${acted
          ? 'den gemeldeten Inhalt entfernt bzw. Maßnahmen ergriffen'
          : 'die Meldung geprüft und keine Maßnahme ergriffen'}.${noteDe}\n\nWenn du mit dieser Entscheidung nicht einverstanden bist, kannst du uns formlos antworten (erneute menschliche Prüfung); unabhängig davon steht dir der Rechtsweg offen (Art. 16 Abs. 5 DSA).\n\n---\n\nHi!\n\nRegarding your report of ${about}: we have ${acted
          ? 'removed the reported content / taken action'
          : 'reviewed the report and not taken action'}.${noteEn}\n\nIf you disagree with this decision you can simply reply to this e-mail (a human will review again); your right to legal remedies remains unaffected (Art. 16(5) DSA).\n\nSpielwirbel`,
      });
      decisionSentAt = at;
    } catch (e) {
      logger.error({ event: 'admin_notice_mail_failed', message: e.message });
      return res.status(502).json({ error: 'mail_failed' });
    }
  }

  const updated = await repo.setContactNoticeStatus(notice.id, {
    status: body.status,
    decidedAt: at,
    decisionNote: body.note || null,
    decisionSentAt,
  });

  logger.info({ event: 'admin_notice_decided', status: body.status });
  res.json({ ok: true, notice: updated });
});

// Delete one notice (issue #389). A DECIDED notice (it carries a decidedAt) is
// the evidence behind an Art. 17 statement of reasons and is kept for 3 years
// (privacy policy §13, docs/legal/notice-and-action.md), so deleting it is
// blocked with 409 `notice_decided` unless the operator explicitly overrides
// with `?force=1` — deleting retention evidence must never happen by accident.
// An OPEN notice (all test data) is freely deletable.
router.delete('/notices/:nid', async (req, res) => {
  const parsed = idSchema.safeParse(req.params.nid);
  if (!parsed.success) return res.status(400).json({ error: 'Not a valid id' });
  const notice = await repo.getContactNotice(parsed.data);
  if (!notice) return res.status(404).json({ error: 'not_found' });

  const decided = Boolean(notice.decidedAt);
  const force = req.query.force === '1' || req.query.force === 'true';
  if (decided && !force) return res.status(409).json({ error: 'notice_decided' });

  const removed = await repo.deleteContactNotice(parsed.data);
  if (!removed) return res.status(404).json({ error: 'not_found' });
  logger.info({ event: 'admin_notice_deleted', decided });
  res.json({ ok: true });
});

/* ----------------------------- statement (#272) ----------------------------- */

// The Art. 17 DSA statement of reasons, generated from a moderation-log entry —
// the entry already records the measure, the date, the target and the reason
// (which by convention names the breached Nutzungsbedingungen clause), so it IS
// the statement's substance; this renders it in the fixed template from
// docs/legal/notice-and-action.md. German only, like the panel: the template's
// audience is the affected account of this German-operated service.
function statementMeasure(entry) {
  if (entry.action === 'takedown') {
    return `das Cover-Bild${entry.gameTitle ? ` des Spiels „${entry.gameTitle}“` : ''} entfernt`;
  }
  if (String(entry.action).startsWith('redact_')) {
    return `den Text „${entry.previous || ''}“ durch „[entfernt]“ ersetzt`;
  }
  if (entry.action === 'user_disabled') return 'dein Konto gesperrt';
  if (entry.action === 'user_restored') return 'die Sperrung deines Kontos aufgehoben';
  if (entry.action === 'user_renamed') {
    return `deinen Nutzernamen${entry.previous ? ` „${entry.previous}“` : ''} durch einen neutralen Namen ersetzt`;
  }
  return `die Maßnahme „${entry.action}“ durchgeführt`;
}

function statementText(entry) {
  return [
    `Am ${dateDe(entry.at)} haben wir ${statementMeasure(entry)}. Die Maßnahme gilt für den gesamten Dienst.`,
    'Anlass war eine eigene Feststellung oder eine Meldung nach Art. 16 der Verordnung (EU) 2022/2065 („DSA“); die Identität meldender Personen geben wir nicht weiter.',
    'Diese Entscheidung wurde ohne automatisierte Verfahren von einem Menschen getroffen und geprüft.',
    `Grund: ${entry.reason || '—'}`,
    'Du kannst dieser Entscheidung formlos widersprechen — per Antwort auf diese E-Mail oder über das Kontaktformular. Wir prüfen den Widerspruch durch einen Menschen. Unabhängig davon steht dir der ordentliche Rechtsweg offen (Art. 17 DSA).',
  ].join('\n\n');
}

// Preview/copy: the text block for the cases where mail is not the right
// channel (the panel renders it copyable).
router.get('/statement', async (req, res) => {
  const parsed = idSchema.safeParse(req.query.entry);
  if (!parsed.success) return res.status(400).json({ error: 'Not a valid id' });
  const entry = await repo.getModeration(parsed.data);
  if (!entry) return res.status(404).json({ error: 'not_found' });
  res.json({ text: statementText(entry), entry });
});

// Send the statement to the affected person and record on the entry that (and
// when) it went out. The recipient is operator-supplied: the affected account's
// address is known to the operator from the lookup card, and a moderation entry
// deliberately doesn't always carry one.
router.post('/statement', async (req, res) => {
  const body = validateBody(z.object({ entryId: idSchema, to: toSchema }), req, res);
  if (!body) return;

  const entry = await repo.getModeration(body.entryId);
  if (!entry) return res.status(404).json({ error: 'not_found' });

  try {
    await mail.send({
      to: body.to,
      subject: 'Spielwirbel: Entscheidung zu Inhalten in deinem Konto (Art. 17 DSA)',
      text: `Hallo!\n\n${statementText(entry)}`,
    });
  } catch (e) {
    logger.error({ event: 'admin_statement_mail_failed', message: e.message });
    return res.status(502).json({ error: 'mail_failed' });
  }

  const updated = await repo.markModerationStatement(entry.id, new Date().toISOString());
  logger.info({ event: 'admin_statement_sent', tenantId: entry.tenantId || null });
  res.json({ ok: true, entry: updated });
});

module.exports = router;

module.exports = router;
