'use strict';

/*
 * Outbound transactional email (issue #135: verification, password reset;
 * later invitations, #138; contact form, #224). Provider: Mailjet Send API
 * v3.1 — configured with MJ_APIKEY_PUBLIC + MJ_APIKEY_PRIVATE + MAIL_FROM.
 *
 * Provider history, both moves under #440 and both for measured reasons:
 *
 *   Brevo → Scaleway. Brevo rewrote every message on the way out — an
 *   open-tracking pixel, our text/plain converted to HTML, bulk-marketing
 *   headers on account-confirmation mail — none of it disableable below its
 *   Enterprise tier. That tracking was a processing we neither wanted nor
 *   disclosed (#439).
 *
 *   Scaleway → Mailjet. Scaleway tracks nothing at all, which was ideal, but
 *   it is not a member of the Certified Senders Alliance. CSA is the German
 *   whitelist (eco/DDV) that GMX, Web.de, 1&1, Freenet and Yahoo honour by
 *   letting certified senders bypass their spam filter outright. A
 *   Scaleway-sent verification mail landed in the GMX **spam** folder while
 *   scoring 10/10 on mail-tester with clean SPF/DKIM/DMARC and no blocklist
 *   entry — i.e. nothing was wrong with the message; the sender simply had no
 *   standing. For a German-language app that is most of the consumer mail
 *   market. Mailjet is CSA-certified *and* exposes per-message tracking
 *   switches, so it is the only option that satisfies deliverability and
 *   privacy at once rather than trading one for the other.
 *
 * TRACKING IS EXPLICITLY DISABLED PER MESSAGE (below) and should also be off
 * at account level — belt and braces, because the account setting is the one
 * that survives a mistake here. Verify on a real send by reading the raw
 * source: no pixel `<img>`, and links that are still ours.
 *
 * Degrades gracefully when unconfigured (dev, tests, self-hosters without
 * email): send() logs the message and records it in an in-memory `outbox`
 * instead of delivering. Tests read the outbox to drive the verify/reset flows
 * — no network, no real mail, ever (the suite never sets MJ_APIKEY_PRIVATE).
 *
 * Uses the global fetch (like the lookup providers), so tests could also stub
 * it. Errors reject; callers decide whether delivery failure is fatal for
 * their flow (account routes log-and-continue so e.g. registration never 500s
 * on a mail hiccup).
 */

const { logger } = require('./observability');

const MAILJET_URL = 'https://api.mailjet.com/v3.1/send';
const OUTBOX_MAX = 50;

// Dev/test capture of not-actually-sent mail (newest last, capped).
const outbox = [];

// Whether real delivery is possible (Mailjet configured). Callers that must
// not silently black-hole a message into the in-memory outbox — the contact
// form (#224) fails loud in production when this is false — check it before
// sending. Mailjet authenticates with a key PAIR, so both halves are required:
// a public key alone is not a working configuration.
function isConfigured() {
  return Boolean(
    process.env.MJ_APIKEY_PUBLIC && process.env.MJ_APIKEY_PRIVATE && process.env.MAIL_FROM,
  );
}

// `replyTo` (optional) sets the Reply-To header so the operator can answer the
// original sender directly — used by the contact form (#224) to route replies
// to the visitor. Ignored by the account flows, which don't pass it. Unlike
// Scaleway, Mailjet has a first-class ReplyTo property.
async function send({ to, subject, text, replyTo }) {
  const pub = process.env.MJ_APIKEY_PUBLIC;
  const priv = process.env.MJ_APIKEY_PRIVATE;
  if (!pub || !priv) {
    // Only record replyTo when set, so an entry without it still deep-equals
    // { to, subject, text } (test/mail.test.js relies on the exact shape).
    outbox.push({ to, subject, text, ...(replyTo ? { replyTo } : {}) });
    if (outbox.length > OUTBOX_MAX) outbox.shift();
    // Subject/recipient only — never the body, which carries tokens.
    logger.info({ event: 'mail_not_configured', to, subject });
    return { delivered: false };
  }
  const res = await fetch(MAILJET_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${pub}:${priv}`).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      Messages: [{
        From: {
          Email: process.env.MAIL_FROM || 'no-reply@localhost',
          Name: process.env.MAIL_FROM_NAME || 'Spielwirbel',
        },
        To: [{ Email: to }],
        Subject: subject,
        TextPart: text,
        ...(replyTo ? { ReplyTo: { Email: replyTo } } : {}),
        // The whole point of #439/#440: no open pixel, no link rewriting, on
        // mail that carries one-time credentials. Sent on EVERY message rather
        // than relying on the account default, so a dashboard change can never
        // silently reintroduce tracking. test/mail.test.js pins both.
        TrackOpens: 'disabled',
        TrackClicks: 'disabled',
      }],
    }),
  });
  if (!res.ok) throw new Error(`mail_send_failed: HTTP ${res.status}`);
  return { delivered: true };
}

module.exports = { send, isConfigured, outbox };
