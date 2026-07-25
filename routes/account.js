'use strict';

/*
 * User-account endpoints (issue #135): register, e-mail verification, login,
 * token refresh/logout, password reset, and /me. Token/crypto primitives live
 * in lib/accounts.js; outbound mail in lib/mail.js. Mounted under /api/account
 * in createApp() *before* the shared-password gate (like /api/auth) and behind
 * the same strict auth rate limiter — but every handler here is a 404 no-op
 * unless ACCOUNTS_ENABLED=true and SESSION_SECRET are configured, so the
 * current gated single-instance deployment is untouched until tenancy (#136)
 * and onboarding (#138) switch the app over to accounts.
 *
 * Anti-enumeration: register and forgot-password answer identically whether or
 * not the e-mail has an account; login burns the same Argon2 work for unknown
 * e-mails and answers a generic 401. The username (#320) is the deliberate
 * exception — a public handle, so `username_taken` is answered openly; the repo
 * checks it ahead of the e-mail so that openness can't leak the hidden one.
 * E-mails are bilingual (DE first — the UI language — then EN) since the server
 * has no locale context; the in-app pages that consume these links arrive
 * with #138.
 */

const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const repo = require('../lib/repo');
const accounts = require('../lib/accounts');
const mail = require('../lib/mail');
const { logger } = require('../lib/observability');

const router = express.Router();

// Deliberately backtracking-safe (CodeQL js/polynomial-redos): the domain
// labels exclude '.', so no alternative can overlap the literal dots — the
// match is linear even on hostile input (and the schema length-guards first).
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

// Field validators expressed as zod schemas (issue #213). Reused by the
// register/login/reset/forgot handlers, whose anti-enumeration behavior differs
// per route (register/reset 400 on a bad field; login/forgot deliberately do
// NOT — they answer the same for known/unknown accounts), so these stay
// field-level validators rather than one whole-body middleware. The email regex
// is unchanged, so its linear-time (ReDoS-safe) property is preserved; the
// `.max(254)` keeps the length guard.
const emailSchema = z.string().max(254).regex(EMAIL_RE);
const passwordSchema = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);
// The app-wide public handle (#320). Deliberately narrow — ASCII letters,
// digits, '_' and '-' only, no dots, spaces or unicode — because this is the
// string a stranger types into an abuse report and that invitations (#207)
// resolve: it has to be unambiguous to transcribe and not homoglyph-spoofable.
const usernameSchema = z.string().regex(/^[a-zA-Z0-9_-]{3,30}$/);

const iso = (ms) => new Date(ms).toISOString();
const baseUrl = () =>
  (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

const normalizeEmail = (raw) => String(raw || '').trim().toLowerCase();
const validEmail = (email) => emailSchema.safeParse(email).success;
const validPassword = (pw) => passwordSchema.safeParse(pw).success;
const validUsername = (name) => usernameSchema.safeParse(name).success;

// Mail failures must never fail the account flow (registration/reset still
// succeed); they are logged for the operator instead.
function sendSafe(msg) {
  return mail.send(msg).catch((e) =>
    logger.warn({ event: 'account_mail_failed', to: msg.to, message: e.message }));
}

// How long a freshly mailed link suppresses another send to the same account —
// resend-verification (#435) and forgot-password (#447) share the one number.
// This is a per-ACCOUNT cooldown and it is the real defence: the authLimiter in
// lib/app.js counts requests per IP, so rotating addresses would otherwise let
// anyone flood a known victim's inbox — and burn the operator mailbox's own
// sending quota with it, which would break registration for everyone (see
// .claude/rules/transactional-mail-provider.md).
const MAIL_COOLDOWN_MS = 60 * 1000;

// The stored verification challenge for a freshly minted raw token. `sentAt` is
// what MAIL_COOLDOWN_MS measures from; records written before #435 lack it,
// which reads as "long ago" and allows an immediate resend.
const verificationRecord = (raw) => ({
  tokenHash: accounts.hashToken(raw),
  expiresAt: iso(Date.now() + accounts.VERIFY_TTL_MS),
  sentAt: iso(Date.now()),
});

// The stored reset challenge, same shape and same `sentAt` semantics (#447):
// a record written before that change carries none, which must read as "long
// ago" so an existing account is never locked out of its own password reset.
const resetRecord = (raw) => ({
  tokenHash: accounts.hashToken(raw),
  expiresAt: iso(Date.now() + accounts.RESET_TTL_MS),
  sentAt: iso(Date.now()),
});

// Shared by both mailing endpoints. `|| ''` is load-bearing: Date.parse('') is
// NaN, so an absent sentAt falls through to "send". Never `|| 0` — Date.parse(0)
// coerces to the string '0' and resolves to the year 2000, a real timestamp.
const mailThrottled = (record) => {
  const sentAt = Date.parse((record || {}).sentAt || '');
  return Number.isFinite(sentAt) && Date.now() - sentAt < MAIL_COOLDOWN_MS;
};

// Register and resend-verification both mail this, so the body and the link
// shape can't drift apart. Lands on the in-app onboarding page (#138), which
// POSTs the token and then routes to login — not the bare JSON GET endpoint
// (still served for clients).
function mailVerification(to, uid, raw) {
  const link = `${baseUrl()}/verify-email?uid=${uid}&token=${raw}`;
  return sendSafe({
    to,
    subject: 'Spielwirbel: E-Mail-Adresse bestätigen / Confirm your e-mail',
    text: `Hallo!\n\nBitte bestätige deine E-Mail-Adresse für Spielwirbel, indem du diesen Link öffnest (gültig 24 Stunden):\n${link}\n\nFalls du dich nicht registriert hast, ignoriere diese E-Mail einfach.\n\n---\n\nHi!\n\nPlease confirm your e-mail address for Spielwirbel by opening this link (valid for 24 hours):\n${link}\n\nIf you didn't sign up, simply ignore this e-mail.`,
  });
}

// The whole feature is env-gated (see header) — a 404 keeps the surface
// invisible on deployments that haven't opted in.
router.use((req, res, next) => {
  if (!accounts.accountsEnabled()) return res.status(404).json({ error: 'accounts_disabled' });
  next();
});

/* -------------------------------- register --------------------------------- */

router.post('/register', async (req, res) => {
  const { email: rawEmail, password, username: rawUsername } = req.body || {};
  const email = normalizeEmail(rawEmail);
  const username = String(rawUsername || '').trim();
  if (!validEmail(email)) return res.status(400).json({ error: 'invalid_email' });
  if (!validUsername(username)) return res.status(400).json({ error: 'invalid_username' });
  if (!validPassword(password)) return res.status(400).json({ error: 'invalid_password' });

  const verifyRaw = accounts.newRawToken();
  const user = await repo.createUser({
    email,
    // The public handle (#320), stored as typed and matched case-insensitively.
    // Required from here on, so no account can exist without one — which is why
    // this ships BEFORE registration opens (#219): there is nothing to backfill.
    username,
    createdAt: iso(Date.now()),
    // Each new account starts as its own tenant (#136) — the id every round it
    // creates is scoped to. Sharing a tenant (invites) is #138's onboarding.
    tenantId: crypto.randomBytes(8).toString('hex'),
    emailVerified: false,
    identities: [{ type: 'password', hash: await accounts.hashPassword(password) }],
    verification: verificationRecord(verifyRaw),
    reset: null,
    refreshTokens: [],
    // Operator suspension (#268). Always present (null when unset) so both
    // backends round-trip identically — see .claude/rules/postgres-backend.md
    // on absent-key parity. Users predating #268 have no key, which reads as
    // falsy = not suspended, so nothing needs migrating.
    disabled: false,
    disabledAt: null,
    disabledReason: null,
  });

  // Answered OPENLY, unlike email_taken: a username is a public identifier by
  // design, so "that one is taken" reveals nothing a lookup wouldn't — and the
  // form is unusable if it can't say so. The repo checks the username BEFORE the
  // e-mail precisely so this error can't double as an e-mail probe: a signup
  // colliding on both answers username_taken either way.
  if (user === 'username_taken') return res.status(409).json({ error: 'username_taken' });

  if (user === 'email_taken') {
    // Same response as success so the endpoint can't be used to probe for
    // existing accounts; the owner of the address learns nothing changed.
    logger.info({ event: 'account_register_existing_email' });
    return res.json({ ok: true });
  }

  await mailVerification(email, user.id, verifyRaw);
  res.json({ ok: true });
});

/* --------------------------- resend verification ---------------------------- */

// A verification mail that never arrives (spam folder, deleted, 24 h expiry) used
// to be a permanently stuck signup (#435): re-registering answers `{ ok: true }`
// without sending anything (the email_taken branch above), and the address stays
// occupied until the token expires. This is the only recovery path that does not
// need the operator.
router.post('/resend-verification', async (req, res) => {
  const email = normalizeEmail((req.body || {}).email);
  const user = validEmail(email) ? await repo.getUserByEmail(email) : null;

  // Every skip below is SILENT — an unknown address, an already-verified account
  // and a throttled resend all answer exactly like a real send. Without that this
  // endpoint is a perfect account-existence probe, which the anti-enumeration
  // invariants in .claude/rules/user-accounts.md do not allow.
  if (user && !user.emailVerified) {
    if (!mailThrottled(user.verification)) {
      const raw = accounts.newRawToken();
      // Replaces the previous challenge, so an older link stops working — a
      // resend must not leave two valid tokens outstanding.
      await repo.updateUser(user.id, { verification: verificationRecord(raw) });
      await mailVerification(user.email, user.id, raw);
    }
  }
  res.json({ ok: true });
});

/* ----------------------------- e-mail verification -------------------------- */

async function verifyEmail(uid, token) {
  const user = await repo.getUserById(String(uid || ''));
  const v = user && user.verification;
  if (!v || Date.parse(v.expiresAt) <= Date.now()) return false;
  if (!accounts.safeEqual(v.tokenHash, accounts.hashToken(token))) return false;
  await repo.updateUser(user.id, { emailVerified: true, verification: null });
  return true;
}

// GET serves the link clicked in the mail (JSON for now; the in-app landing
// page is #138's onboarding work). POST is the API form for clients.
router.get('/verify-email', async (req, res) => {
  const ok = await verifyEmail(req.query.uid, req.query.token);
  if (!ok) return res.status(400).json({ error: 'invalid_token' });
  res.json({ ok: true });
});

router.post('/verify-email', async (req, res) => {
  const { uid, token } = req.body || {};
  const ok = await verifyEmail(uid, token);
  if (!ok) return res.status(400).json({ error: 'invalid_token' });
  res.json({ ok: true });
});

/* ---------------------------------- login ---------------------------------- */

// Issue a fresh token pair and persist the refresh token's hash on the user.
async function issueTokens(user) {
  const refreshToken = accounts.mintRefreshToken(user.id);
  const { hash } = accounts.parseRefreshToken(refreshToken);
  const next = accounts.pushRefreshToken(user.refreshTokens, {
    tokenHash: hash,
    createdAt: iso(Date.now()),
    expiresAt: iso(Date.now() + accounts.REFRESH_TTL_MS),
  });
  await repo.updateUser(user.id, { refreshTokens: next });
  return {
    accessToken: accounts.mintAccessToken(user.id),
    expiresIn: Math.floor(accounts.ACCESS_TTL_MS / 1000),
    refreshToken,
  };
}

router.post('/login', async (req, res) => {
  const { email: rawEmail, password } = req.body || {};
  const user = await repo.getUserByEmail(normalizeEmail(rawEmail));
  const identity = user && (user.identities || []).find((i) => i.type === 'password');

  if (!identity) {
    // Burn the same Argon2 work as a real check so response timing doesn't
    // reveal whether the account exists.
    await accounts.verifyPassword(await accounts.DUMMY_HASH_PROMISE, String(password || ''));
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (!(await accounts.verifyPassword(identity.hash, String(password || '')))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  // Only revealed after the correct password, so it leaks nothing to outsiders.
  if (!user.emailVerified) return res.status(403).json({ error: 'email_not_verified' });
  // Same placement, same reason: an operator-suspended account (#268) is only
  // told so once it has proven it owns the address.
  if (user.disabled) return res.status(403).json({ error: 'account_disabled' });

  const tokens = await issueTokens(user);
  // Mirror the access token into a cookie so browser-native /uploads GETs (cover
  // images) authenticate; fetch/XHR still use the Bearer token (see lib/app.js).
  accounts.setAccessCookie(res, req, tokens.accessToken);
  res.json({ ok: true, ...tokens, user: { id: user.id, email: user.email, username: user.username || null } });
});

/* ------------------------------ refresh / logout ---------------------------- */

router.post('/refresh', async (req, res) => {
  const parsed = accounts.parseRefreshToken((req.body || {}).refreshToken);
  const user = parsed && (await repo.getUserById(parsed.userId));
  const entry = user && (user.refreshTokens || []).find((t) => accounts.safeEqual(t.tokenHash, parsed.hash));
  if (!entry || Date.parse(entry.expiresAt) <= Date.now()) {
    return res.status(401).json({ error: 'invalid_refresh_token' });
  }
  // A suspended account (#268) must not be able to mint a fresh access token —
  // otherwise its 30-day refresh token would outlive the suspension entirely.
  if (user.disabled) return res.status(403).json({ error: 'account_disabled' });
  // Rotate: the presented token is spent; issueTokens persists the replacement.
  user.refreshTokens = user.refreshTokens.filter((t) => t !== entry);
  const tokens = await issueTokens(user);
  accounts.setAccessCookie(res, req, tokens.accessToken); // keep the cover-image cookie fresh
  res.json({ ok: true, ...tokens });
});

router.post('/logout', async (req, res) => {
  const parsed = accounts.parseRefreshToken((req.body || {}).refreshToken);
  if (parsed) {
    const user = await repo.getUserById(parsed.userId);
    if (user) {
      const next = (user.refreshTokens || []).filter((t) => !accounts.safeEqual(t.tokenHash, parsed.hash));
      if (next.length !== (user.refreshTokens || []).length) {
        await repo.updateUser(user.id, { refreshTokens: next });
      }
    }
  }
  accounts.clearAccessCookie(res, req); // drop the cover-image cookie too
  res.json({ ok: true }); // best-effort: logout never errors
});

/* ------------------------------- password reset ----------------------------- */

router.post('/forgot-password', async (req, res) => {
  const email = normalizeEmail((req.body || {}).email);
  const user = validEmail(email) ? await repo.getUserByEmail(email) : null;
  // The cooldown (#447) skips the MINT as well as the send, deliberately: a user
  // who double-submits the form keeps the link they were already mailed instead
  // of one their own second click silently invalidated. Being throttled is also
  // silent — a 429 here would be a perfect account-existence probe, since only
  // an address that HAS a password account can ever reach this branch.
  if (user && (user.identities || []).some((i) => i.type === 'password')
      && !mailThrottled(user.reset)) {
    const raw = accounts.newRawToken();
    await repo.updateUser(user.id, { reset: resetRecord(raw) });
    const link = `${baseUrl()}/reset-password?uid=${user.id}&token=${raw}`;
    await sendSafe({
      to: user.email,
      subject: 'Spielwirbel: Passwort zurücksetzen / Reset your password',
      text: `Hallo!\n\nDu (oder jemand anderes) hast das Zurücksetzen deines Spielwirbel-Passworts angefordert. Öffne diesen Link (gültig 1 Stunde):\n${link}\n\nFalls du das nicht warst, ignoriere diese E-Mail — dein Passwort bleibt unverändert.\n\n---\n\nHi!\n\nYou (or someone else) requested a password reset for Spielwirbel. Open this link (valid for 1 hour):\n${link}\n\nIf this wasn't you, ignore this e-mail — your password stays unchanged.`,
    });
  }
  // Identical response either way — no probing for accounts here either.
  res.json({ ok: true });
});

router.post('/reset-password', async (req, res) => {
  const { uid, token, password } = req.body || {};
  if (!validPassword(password)) return res.status(400).json({ error: 'invalid_password' });
  const user = await repo.getUserById(String(uid || ''));
  const r = user && user.reset;
  if (!r || Date.parse(r.expiresAt) <= Date.now()
      || !accounts.safeEqual(r.tokenHash, accounts.hashToken(token))) {
    return res.status(400).json({ error: 'invalid_token' });
  }
  const identities = (user.identities || []).filter((i) => i.type !== 'password');
  identities.push({ type: 'password', hash: await accounts.hashPassword(password) });
  // Single-use token, and every existing session is revoked with the password.
  await repo.updateUser(user.id, { identities, reset: null, refreshTokens: [] });
  res.json({ ok: true });
});

/* ----------------------------------- me ------------------------------------ */

router.get('/me', accounts.requireUser, async (req, res) => {
  const user = await repo.getUserById(req.userId);
  if (!user) return res.status(401).json({ error: 'invalid_token' }); // account deleted
  res.json({
    id: user.id,
    email: user.email,
    username: user.username || null,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  });
});

/* --------------------------------- inbox ----------------------------------- */
// The generic per-user notification inbox (issue #207). Actionable items are
// written by later features (round invitations #207, friend requests #325); this
// slice ships the read/mark/dismiss surface the account UI drives. requireUser
// sets req.userId and every repo call scopes to it, so a caller only ever sees or
// mutates their OWN items — another user's item id is indistinguishable from a
// missing one (404). Reached on the module-level repo: the inbox is a global,
// un-scoped store (keyed by account id), so it is not on req.repo.

router.get('/inbox', accounts.requireUser, async (req, res) => {
  res.json({ items: await repo.listInbox(req.userId) });
});

router.post('/inbox/:id/read', accounts.requireUser, async (req, res) => {
  const item = await repo.markInboxRead(req.userId, req.params.id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  res.json({ item });
});

router.delete('/inbox/:id', accounts.requireUser, async (req, res) => {
  const item = await repo.dismissInboxItem(req.userId, req.params.id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
