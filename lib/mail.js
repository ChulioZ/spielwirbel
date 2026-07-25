'use strict';

/*
 * Outbound transactional email (issue #135: verification, password reset;
 * later invitations, #138; contact form, #224). Transport: plain SMTP
 * submission via nodemailer — configured with SMTP_HOST + SMTP_USER +
 * SMTP_PASS + MAIL_FROM. In production that is the operator's own mailbox
 * provider (mailbox.org), but nothing here is provider-specific: the variables
 * are deliberately generic so a future move needs no rename, which the three
 * provider changes on 2026-07-25 (#440) earned the hard way.
 *
 * Why SMTP at the operator's own mailbox host rather than a transactional ESP,
 * having tried two:
 *
 *   Brevo rewrote every message on the way out — an open-tracking pixel, our
 *   text/plain converted to HTML, bulk-marketing headers on account-
 *   confirmation mail — none of it disableable below its Enterprise tier. That
 *   tracking was a processing we neither wanted nor disclosed (#439).
 *
 *   Scaleway tracked nothing, but is not a member of the Certified Senders
 *   Alliance, and its mail landed in the GMX spam folder while scoring 10/10 on
 *   mail-tester with clean SPF/DKIM/DMARC — nothing wrong with the message, the
 *   sender simply had no standing.
 *
 *   mailbox.org delivers to the GMX inbox, signs as our own domain
 *   (d=spielwirbel.app via the MBO0001 selector) and keeps the envelope sender
 *   on our domain too, so SPF *and* DKIM align — better authentication than
 *   either ESP achieved. Decisively it adds NO new processor: the AVV with
 *   Heinlein already exists for the operator mailbox, so vvt.md row 5 collapses
 *   into it. And a mailbox host cannot inject tracking; there is no product
 *   feature to switch off.
 *
 * Trade-offs accepted, so nobody rediscovers them: no delivery webhooks (a hard
 * bounce arrives as an ordinary DSN e-mail in the operator's mailbox instead —
 * see #442, closed for this reason), a few hundred ms more latency than one
 * HTTPS call because the send is awaited in the request path, and no headroom
 * beyond a mailbox account's sending limits.
 *
 * Degrades gracefully when unconfigured (dev, tests, self-hosters without
 * email): send() logs the message and records it in an in-memory `outbox`
 * instead of delivering. Tests read the outbox to drive the verify/reset flows
 * — no network, no real mail, ever (the suite never sets SMTP_HOST).
 *
 * Errors reject; callers decide whether delivery failure is fatal for their
 * flow (account routes log-and-continue so e.g. registration never 500s on a
 * mail hiccup).
 */

const nodemailer = require('nodemailer');
const { logger } = require('./observability');

const DEFAULT_PORT = 465;
const OUTBOX_MAX = 50;

// The send is awaited before the HTTP response (routes/account.js), so a
// wedged connection would hold a registration open. Cap every phase.
const TIMEOUT_MS = 10000;

// Dev/test capture of not-actually-sent mail (newest last, capped).
const outbox = [];

// Whether real delivery is possible. Callers that must not silently black-hole
// a message into the in-memory outbox — the contact form (#224) fails loud in
// production when this is false — check it before sending.
function isConfigured() {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM,
  );
}

// Built per send rather than memoized: the volume is a handful of messages a
// day, so a pooled connection would be cold anyway, and a cached transport
// would silently keep stale credentials after an env change (the trap the
// rate-limit ceilings in lib/app.js avoid the same way). `secure` follows the
// port — 465 is implicit TLS, 587 upgrades via STARTTLS.
function transport() {
  const port = Number(process.env.SMTP_PORT) || DEFAULT_PORT;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
}

// `replyTo` (optional) sets the Reply-To header so the operator can answer the
// original sender directly — used by the contact form (#224) to route replies
// to the visitor. Ignored by the account flows, which don't pass it.
async function send({ to, subject, text, replyTo }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    // Only record replyTo when set, so an entry without it still deep-equals
    // { to, subject, text } (test/mail.test.js relies on the exact shape).
    outbox.push({ to, subject, text, ...(replyTo ? { replyTo } : {}) });
    if (outbox.length > OUTBOX_MAX) outbox.shift();
    // Subject/recipient only — never the body, which carries tokens.
    logger.info({ event: 'mail_not_configured', to, subject });
    return { delivered: false };
  }
  // The From address must exist on the sending account: mailbox.org refuses a
  // sender that is not one of the account's addresses or aliases (their
  // anti-forgery rule since 2020-09-29), which is also what lets it DKIM-sign
  // as our domain rather than rewriting the header.
  await transport().sendMail({
    from: { address: process.env.MAIL_FROM || 'no-reply@localhost', name: process.env.MAIL_FROM_NAME || 'Spielwirbel' },
    to,
    subject,
    // text only, never html: a text/plain body cannot carry a tracking pixel,
    // and there is nothing here that needs markup.
    text,
    ...(replyTo ? { replyTo } : {}),
  });
  return { delivered: true };
}

module.exports = { send, isConfigured, outbox };
