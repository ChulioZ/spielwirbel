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

// Global daily send budget (#448). `POST /api/account/register` mails a
// verification link to any address a caller names, and a second attempt with
// the same address answers `email_taken` without sending — so a per-ACCOUNT
// cooldown (the #435/#447 defence) has nothing to throttle against on the one
// request that does send. What is actually at risk is the operator mailbox's
// own sending quota: production submits through a mailbox.org account, not an
// ESP, so there is no headroom beyond a mailbox's limits, and the mail that
// stops going out is verification mail — i.e. signup breaks for EVERYONE.
//
// So the budget is deliberately global rather than per-recipient or per-route:
// it bounds the thing being protected (the quota) instead of the mechanism
// being abused, which means it covers every present and future mail path for
// free. A tripped breaker also stops legitimate mail, which is the accepted
// trade — it trips at OUR threshold, below the provider's, so the mailbox stays
// healthy and the operator gets a log line rather than a flagged account.
const DEFAULT_DAILY_MAX = 200;

// Counted for BOTH delivery paths, on purpose: the unconfigured outbox path
// costs no real quota, but keeping one rule means the breaker behaves
// identically in dev, test and production, and can be driven from a test with
// no SMTP config at all. test/helpers.js raises the ceiling out of reach for
// the ordinary suite, the same way it does for the rate limiters.
const budget = { day: null, sent: 0 };

// UTC, not local: a process that outlives a DST shift or moves regions must not
// get a short or double-length "day" — and the operator reads this off log
// lines whose `ts` is UTC anyway.
const utcDay = () => new Date().toISOString().slice(0, 10);

// Read per call, never bound at module load, so a deployment can re-tune the
// ceiling and a test can drive a tiny one — see .claude/rules/security-middleware.md.
function dailyMax() {
  return Number(process.env.MAIL_DAILY_MAX) || DEFAULT_DAILY_MAX;
}

// Exposed for tests (and for an operator read-out, should one ever be wanted).
// Carries no secret — a count, a limit and a date.
function budgetState() {
  const today = utcDay();
  // Always reports TODAY, so a process whose last send was yesterday reads as
  // 0 spent rather than as yesterday's exhausted total.
  return { day: today, sent: budget.day === today ? budget.sent : 0, limit: dailyMax() };
}

// Returns false once the day's budget is spent; otherwise books one send and
// returns true. The reset is lazy (on first send of a new day) rather than on a
// timer, so an idle process holds no interval and a clock jump can't strand it.
//
// Books BEFORE the submission, so a send that then fails at the transport still
// counts. That is deliberate for a protective breaker: a failing host may well
// have consumed quota anyway, and not counting failures would let a retry storm
// walk straight through the budget.
function bookSend() {
  const today = utcDay();
  if (budget.day !== today) { budget.day = today; budget.sent = 0; }
  if (budget.sent >= dailyMax()) return false;
  budget.sent += 1;
  return true;
}

// The send is awaited before the HTTP response (lib/routes/account.js), so a
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
  // Checked before anything else, so a caller can never spend quota it was
  // refused. Throwing (rather than returning a flag) is what keeps the refusal
  // invisible at the account routes: sendSafe() already log-and-continues, so
  // register still answers `{ ok: true }` and the endpoint reveals nothing about
  // whether the named address has an account. The log line carries a count and a
  // limit and NO address or subject — see .claude/rules/product-event-logging.md.
  if (!bookSend()) {
    const { sent, limit } = budgetState();
    logger.warn({ event: 'mail_daily_budget_exhausted', sent, limit });
    throw new Error('mail_daily_budget_exhausted');
  }
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

module.exports = { send, isConfigured, outbox, budgetState };
