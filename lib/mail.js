'use strict';

/*
 * Outbound transactional email (issue #135: verification, password reset;
 * later invitations, #138; contact form, #224). Provider: Scaleway
 * Transactional Email (fr-par) via its REST API — configured with
 * SCW_SECRET_KEY + SCW_PROJECT_ID + MAIL_FROM.
 *
 * Moved off Brevo in #440. Brevo rewrote every message on the way out: it
 * injected an open-tracking pixel, converted our text/plain body to HTML, and
 * attached bulk-marketing headers (List-Unsubscribe + One-Click, Feedback-ID,
 * X-CSA-Complaints) to account-confirmation mail — none of it disableable
 * below its Enterprise tier. The tracking was a processing we neither wanted
 * nor disclosed (#439). Scaleway's API exposes no tracking of any kind:
 * verified on a live send, the message arrives exactly as composed, still
 * text/plain, with the Return-Path on our own domain so DMARC passes on SPF
 * *and* DKIM rather than DKIM alone.
 *
 * Degrades gracefully when unconfigured (dev, tests, self-hosters without
 * email): send() logs the message and records it in an in-memory `outbox`
 * instead of delivering. Tests read the outbox to drive the verify/reset flows
 * — no network, no real mail, ever (the suite never sets SCW_SECRET_KEY).
 *
 * Uses the global fetch (like the lookup providers), so tests could also stub
 * it. Errors reject; callers decide whether delivery failure is fatal for
 * their flow (account routes log-and-continue so e.g. registration never 500s
 * on a mail hiccup).
 */

const { logger } = require('./observability');

const DEFAULT_REGION = 'fr-par';
const OUTBOX_MAX = 50;

// Dev/test capture of not-actually-sent mail (newest last, capped).
const outbox = [];

// Read per call, not at module load, so a test (or a live re-tune) picks up the
// current env — same reasoning as the rate-limit ceilings in lib/app.js.
const apiUrl = () =>
  `https://api.scaleway.com/transactional-email/v1alpha1/regions/${process.env.SCW_REGION || DEFAULT_REGION}/emails`;

// Whether real delivery is possible (Scaleway configured). Callers that must
// not silently black-hole a message into the in-memory outbox — the contact
// form (#224) fails loud in production when this is false — check it before
// sending. SCW_PROJECT_ID is part of the check because Scaleway rejects a send
// without it, so a key on its own is not a working configuration.
function isConfigured() {
  return Boolean(process.env.SCW_SECRET_KEY && process.env.SCW_PROJECT_ID && process.env.MAIL_FROM);
}

// `replyTo` (optional) sets the Reply-To header so the operator can answer the
// original sender directly — used by the contact form (#224) to route replies
// to the visitor. Ignored by the account flows, which don't pass it. Scaleway
// has no dedicated reply-to field; a custom header is the documented way, and
// Reply-To is their own worked example for `additional_headers`.
async function send({ to, subject, text, replyTo }) {
  const key = process.env.SCW_SECRET_KEY;
  if (!key) {
    // Only record replyTo when set, so an entry without it still deep-equals
    // { to, subject, text } (test/mail.test.js relies on the exact shape).
    outbox.push({ to, subject, text, ...(replyTo ? { replyTo } : {}) });
    if (outbox.length > OUTBOX_MAX) outbox.shift();
    // Subject/recipient only — never the body, which carries tokens.
    logger.info({ event: 'mail_not_configured', to, subject });
    return { delivered: false };
  }
  const res = await fetch(apiUrl(), {
    method: 'POST',
    headers: { 'X-Auth-Token': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: {
        email: process.env.MAIL_FROM || 'no-reply@localhost',
        name: process.env.MAIL_FROM_NAME || 'Spielwirbel',
      },
      to: [{ email: to }],
      project_id: process.env.SCW_PROJECT_ID,
      subject,
      text,
      ...(replyTo ? { additional_headers: [{ key: 'Reply-To', value: replyTo }] } : {}),
    }),
  });
  if (!res.ok) throw new Error(`mail_send_failed: HTTP ${res.status}`);
  return { delivered: true };
}

module.exports = { send, isConfigured, outbox };
