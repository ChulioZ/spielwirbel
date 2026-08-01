'use strict';

/*
 * User-account endpoints (issue #135): register, e-mail verification, login,
 * token refresh/logout, password reset, change-password (#482), and /me.
 * Token/crypto primitives live in lib/accounts.js; outbound mail in
 * lib/mail.js. Mounted under /api/account in createApp() *before* the
 * shared-password gate (like /api/auth) and behind
 * the same strict auth rate limiter — but every handler here is a 404 no-op
 * unless ACCOUNTS_ENABLED=true and SESSION_SECRET are configured, so the
 * current gated single-instance deployment is untouched until tenancy (#136)
 * and onboarding (#138) switch the app over to accounts.
 *
 * Anti-enumeration: register and forgot-password answer identically whether or
 * not the e-mail has an account; login burns the same Argon2 work for an
 * unknown identifier — e-mail or username (#431) — and answers a generic 401.
 * The username (#320) is the deliberate exception — a public handle, so
 * `username_taken` is answered openly; the repo checks it ahead of the e-mail
 * so that openness can't leak the hidden one.
 * E-mails are bilingual (DE first — the UI language — then EN) since the server
 * has no locale context; the in-app pages that consume these links arrive
 * with #138.
 */

const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const repo = require('../lib/repo');
const accounts = require('../lib/accounts');
const demo = require('../lib/demo');
const storage = require('../lib/storage'); // ending a demo frees its cover objects (#502)
const mail = require('../lib/mail');
// The terms-change notice (#521). No rendering happens here — this is the
// current revision plus the resolver that applies the legacy fallback.
const { TERMS_REVISION, termsAcceptanceOf } = require('../lib/legal');
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
// The BoardGameGeek handle whose owned collection the Regal import reads (#481).
// Deliberately NOT usernameSchema: this one names an account on somebody else's
// service, so its character set is theirs to define and narrowing it to ours
// would reject perfectly valid BGG users. Length-capped, and free of whitespace
// and of every Unicode "other" category (control, format, surrogate, unassigned)
// so it stays a single storable, loggable token. It needs no injection guard
// beyond that: URLSearchParams encodes it into the provider query.
const bggUsernameSchema = z
  .string()
  .min(1)
  .max(60)
  .refine((s) => !/[\s\p{C}]/u.test(s));

const iso = (ms) => new Date(ms).toISOString();
const baseUrl = () =>
  (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

const normalizeEmail = (raw) => String(raw || '').trim().toLowerCase();
const validEmail = (email) => emailSchema.safeParse(email).success;
const validPassword = (pw) => passwordSchema.safeParse(pw).success;
const validUsername = (name) => usernameSchema.safeParse(name).success;
const validBggUsername = (name) => bggUsernameSchema.safeParse(name).success;

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

// The stored verification challenge for a freshly minted link secret. `sentAt`
// is what MAIL_COOLDOWN_MS measures from; records written before #435 lack it,
// which reads as "long ago" and allows an immediate resend. Only the secret is
// hashed — never the assembled link token — so this shape survived #434
// unchanged and a legacy link still matches.
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
//
// The path is a terse `/v` and the uid rides inside the token, because the whole
// URL must fit on one quoted-printable line — see lib/accounts.js. Measure the
// result, don't eyeball it: test/account.test.js pins the length.
function mailVerification(to, uid, secret) {
  const link = `${baseUrl()}/v?t=${accounts.mintLinkToken(accounts.VERIFY_TOKEN_VERSION, uid, secret)}`;
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

  const verifyRaw = accounts.newLinkSecret();
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
    // The optional BoardGameGeek handle the Regal import reads (#481) — present
    // from the start for the same absent-key parity reason as the three above.
    bggUsername: null,
    // Which revision of the Nutzungsbedingungen this account has seen (#521).
    // Written at creation so the change notice has something to compare against;
    // accounts predating this fall back to LEGACY_TERMS_REVISION in the
    // projection below rather than being migrated (CLAUDE.md: no migration code).
    acceptedTermsRevision: TERMS_REVISION,
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
      const raw = accounts.newLinkSecret();
      // Replaces the previous challenge, so an older link stops working — a
      // resend must not leave two valid tokens outstanding.
      await repo.updateUser(user.id, { verification: verificationRecord(raw) });
      await mailVerification(user.email, user.id, raw);
    }
  }
  res.json({ ok: true });
});

/* ----------------------------- e-mail verification -------------------------- */

async function verifyEmail(token) {
  const cred = accounts.parseLinkToken(accounts.VERIFY_TOKEN_VERSION, token);
  if (!cred) return false;
  const user = await repo.getUserById(cred.userId);
  const v = user && user.verification;
  if (!v || Date.parse(v.expiresAt) <= Date.now()) return false;
  if (!accounts.safeEqual(v.tokenHash, cred.hash)) return false;
  await repo.updateUser(user.id, { emailVerified: true, verification: null });
  return true;
}

// GET serves the link clicked in the mail (JSON for now; the in-app landing
// page is #138's onboarding work). POST is the API form for clients.
router.get('/verify-email', async (req, res) => {
  const ok = await verifyEmail(req.query.token);
  if (!ok) return res.status(400).json({ error: 'invalid_token' });
  res.json({ ok: true });
});

// A stray `uid` in the body is accepted and ignored — it was part of the
// documented request shape before #434 and costs nothing to keep tolerating.
router.post('/verify-email', async (req, res) => {
  const { token } = req.body || {};
  const ok = await verifyEmail(token);
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
  const { login, email, password } = req.body || {};
  // The identifier is an e-mail address OR the public handle (#431). The two
  // namespaces are disjoint by construction — usernameSchema forbids '@' and
  // EMAIL_RE requires one — so this classifies rather than guessing, and no
  // username can shadow somebody's address. `email` stays accepted as an alias
  // because the SPA shell is served cache-first: a browser on a stale
  // account.js keeps POSTing it until its cache turns over.
  const raw = String(login ?? email ?? '').trim();
  // Exactly ONE repo lookup on either branch, so the two paths stay
  // timing-comparable (.claude/rules/user-accounts.md). getUserByUsername trims
  // and matches case-insensitively, so don't mangle the raw value first.
  const user = raw.includes('@')
    ? await repo.getUserByEmail(normalizeEmail(raw))
    : await repo.getUserByUsername(raw);
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
  // The terms fields ride along (#521) because the client seats `accountUser`
  // straight from this response: without them the change notice would stay
  // hidden until the next cold load — i.e. exactly when someone logs in after a
  // terms change, which is the case the notice exists for.
  res.json({
    ok: true,
    ...tokens,
    user: {
      id: user.id,
      email: user.email,
      username: user.username || null,
      ...termsAcceptanceOf(user),
    },
  });
});

/* ----------------------------------- demo ----------------------------------- */

// Mint a throwaway, pre-seeded account so a visitor can try the app without
// registering (#427). Answers the same token pair as /login, so the client's
// existing "I am now logged in" path needs no special case.
//
// Gated on DEMO_ENABLED *and* accountsEnabled() — a 404 keeps the surface
// invisible on an instance that hasn't opted in, matching how the whole router
// answers when accounts are off. It sits AFTER the router-level accounts gate
// above, so that check is already done; the demo gate re-reads both because it
// is the env var, not the mode, that this endpoint hangs off.
//
// Note this is the one endpoint here that CREATES an account for an entirely
// unauthenticated caller, which is why it is bounded twice: a dedicated per-IP
// limiter in lib/app.js, and the live-demo ceiling inside createDemoAccount.
router.post('/demo', async (req, res) => {
  if (!demo.demoEnabled()) return res.status(404).json({ error: 'demo_disabled' });

  // The locale decides the seeded round/member/tag wording. Taken from the body
  // (the client knows its active locale) and falling back to German inside
  // demo-seed.js, so an absent or unknown value is never an error.
  //
  // The hashed address bounds how many live demos one source may hold (#502) —
  // it is a BOUND, never an identity: resuming a demo by IP would drop two
  // strangers behind the same NAT into one account.
  const user = await demo.createDemoAccount(
    String((req.body || {}).locale || ''),
    demo.hashIp(req.ip),
  );

  // A capacity answer, not a fault: 503 with a distinct code the client turns
  // into "very busy right now, try again shortly" while leaving the register CTA
  // in place. Deliberately NOT 429 — that is the rate limiter's code and the two
  // mean different things to the visitor.
  if (user === 'unavailable') return res.status(503).json({ error: 'demo_unavailable' });

  const tokens = await issueTokens(user);
  accounts.setAccessCookie(res, req, tokens.accessToken);
  logger.info({ event: 'demo_started' });
  res.json({
    ok: true,
    ...tokens,
    // Same fields as the login response (#521), so `accountUser` has a uniform
    // shape whichever way the session started. A demo is minted at the current
    // revision, so these can only ever be equal — it is never "behind".
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      demo: true,
      ...termsAcceptanceOf(user),
    },
  });
});

// End a demo the visitor is done with (#502), freeing its slot immediately
// instead of holding it for the rest of the TTL.
//
// This is the ONE exit we can actually recognise. Every other way of leaving —
// the banner's register CTA, a closed tab, navigating away — is either
// indistinguishable from a reload or never reaches the server at all, so those
// keep the demo alive and the client re-enters it from its own resume marker;
// the TTL purge remains the backstop for both.
//
// requireUser, then an explicit demo check: this erases an account outright, so
// it must be impossible to reach for a real one even with a valid token.
router.delete('/demo', accounts.requireUser, async (req, res) => {
  const user = await repo.getUserById(req.userId);
  if (!user || user.demo !== true) return res.status(403).json({ error: 'not_demo' });

  const result = await demo.endDemo(user.id, storage);
  // Unreachable for a demo (its tenant is 1:1 by construction) but answered
  // honestly rather than reported as a success that did not happen.
  if (result === 'tenant_shared') return res.status(409).json({ error: 'tenant_shared' });
  if (!result) return res.status(404).json({ error: 'not_found' });

  // Best-effort like /logout: the client is leaving either way, and the erased
  // account's still-valid access token resolves to ERASED -> 401 -> the SPA
  // bounces to login (.claude/rules/erased-account-token-fallback.md), so this
  // never has to race the client.
  accounts.clearAccessCookie(res, req);
  logger.info({ event: 'demo_ended', rounds: result.rounds });
  res.json({ ok: true, rounds: result.rounds });
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
    const raw = accounts.newLinkSecret();
    await repo.updateUser(user.id, { reset: resetRecord(raw) });
    // Same one-QP-line constraint as the verification link (#434).
    const link = `${baseUrl()}/r?t=${accounts.mintLinkToken(accounts.RESET_TOKEN_VERSION, user.id, raw)}`;
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
  const { token, password } = req.body || {};
  if (!validPassword(password)) return res.status(400).json({ error: 'invalid_password' });
  const cred = accounts.parseLinkToken(accounts.RESET_TOKEN_VERSION, token);
  if (!cred) return res.status(400).json({ error: 'invalid_token' });
  const user = await repo.getUserById(cred.userId);
  const r = user && user.reset;
  if (!r || Date.parse(r.expiresAt) <= Date.now()
      || !accounts.safeEqual(r.tokenHash, cred.hash)) {
    return res.status(400).json({ error: 'invalid_token' });
  }
  const identities = (user.identities || []).filter((i) => i.type !== 'password');
  identities.push({ type: 'password', hash: await accounts.hashPassword(password) });
  // Single-use token, and every existing session is revoked with the password.
  await repo.updateUser(user.id, { identities, reset: null, refreshTokens: [] });
  res.json({ ok: true });
});

/* ------------------------------ change password ----------------------------- */

// The logged-IN counterpart to forgot/reset (#482). Until this existed, a user
// who simply wanted a new password had to log out, claim they had forgotten it
// and wait for mail — a round-trip for something that needs none.
router.post('/change-password', accounts.requireUser, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  // Same strength rule as register and reset, reached through the same schema so
  // the three paths cannot drift apart.
  if (!validPassword(newPassword)) return res.status(400).json({ error: 'invalid_password' });

  const user = await repo.getUserById(req.userId);
  const identity = user && (user.identities || []).find((i) => i.type === 'password');
  // A valid access token is NOT enough to replace the credential — it may be
  // sitting on an unattended device. Re-authenticating is the whole point of the
  // endpoint over a bare "set password" one.
  if (!identity || !(await accounts.verifyPassword(identity.hash, String(currentPassword || '')))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const identities = (user.identities || []).filter((i) => i.type !== 'password');
  identities.push({ type: 'password', hash: await accounts.hashPassword(newPassword) });
  // Any outstanding reset link dies here: whoever requested it, the owner has
  // just chosen a password deliberately. `refreshTokens: []` is belt-and-braces
  // — the eviction below is what actually decides the stored list — so that a
  // throw between these two writes leaves ZERO sessions rather than the old
  // ones, which is the safe direction to fail in.
  await repo.updateUser(user.id, { identities, reset: null, refreshTokens: [] });

  // Every other session dies with the old password (a stolen one must not
  // outlive the change meant to evict it), but not the caller's own: emptying
  // the local snapshot before issueTokens — which pushes onto it and persists
  // the result — leaves the freshly minted pair as the only survivor. So the
  // person who just changed their password is not bounced to the login screen.
  user.refreshTokens = [];
  const tokens = await issueTokens(user);
  accounts.setAccessCookie(res, req, tokens.accessToken);

  // The standard defence against a silent takeover: the owner of the address
  // hears about it even if they weren't the one at the keyboard. sendSafe, so a
  // mail failure never 500s a change that has already been persisted.
  await sendSafe({
    to: user.email,
    subject: 'Spielwirbel: Passwort geändert / Password changed',
    text: `Hallo!\n\nDas Passwort deines Spielwirbel-Kontos wurde soeben geändert. Alle anderen angemeldeten Geräte wurden abgemeldet.\n\nFalls du das nicht warst, setze dein Passwort über „Passwort vergessen?“ sofort zurück.\n\n---\n\nHi!\n\nThe password for your Spielwirbel account was just changed. All other signed-in devices have been logged out.\n\nIf this wasn't you, reset your password immediately via "Forgot password?".`,
  });

  res.json({ ok: true, ...tokens });
});

/* ---------------------------- account deletion ------------------------------ */

// Self-service Art. 17 (#419). The operator-side erasure (#273,
// POST /api/admin/users/:uid/erase) stays for assisted and DSA-driven cases;
// this is the same erasure reached by its own owner, so it reuses
// repo.eraseAccount rather than implementing a second cascade.

// What the confirmation promises, in real numbers rather than "all your data".
// Read fresh when the sheet opens, so the figures are the ones true at the
// moment of confirmation and not at page load.
//
// tenantSummary and exportAccountData are GLOBAL methods (not in
// TENANT_METHODS), so they come off the module-level repo, never req.repo —
// and this router is mounted ahead of the tenant middleware anyway.
router.get('/deletion-preview', accounts.requireUser, async (req, res) => {
  const user = await repo.getUserById(req.userId);
  if (!user) return res.status(401).json({ error: 'invalid_token' });
  const tenantId = user.tenantId || null;

  const summary = await repo.tenantSummary(tenantId);
  const totals = (summary && summary.totals) || { rounds: 0, games: 0, sessions: 0 };
  // Only covers WE host are ours to delete and ours to promise. A hotlinked
  // provider URL (#172) has no bytes of ours behind it, so counting it would
  // promise a deletion that never happens — storage.remove() ignores it by
  // design (.claude/rules/provider-cover-hotlinking.md).
  const images = ((summary && summary.images) || []).filter(storage.isHostedImage);

  // Deleting your account revokes every grant sitting on your rounds — a
  // consequence to a THIRD party, so it must not be a surprise. Counted as
  // distinct accounts: one person invited to two of your rounds loses access
  // once, not twice. exportAccountData is the same enumeration the erasure
  // deletes, so the preview and the deletion cannot disagree about what goes.
  const shares = await repo.exportAccountData(user.id, tenantId);
  const sharedWith = new Set(
    (shares.grants || [])
      .filter((g) => tenantId && g.ownerTenantId === tenantId && g.userId !== user.id)
      .map((g) => g.userId),
  );

  res.json({
    rounds: totals.rounds,
    games: totals.games,
    sessions: totals.sessions,
    images: images.length,
    sharedWith: sharedWith.size,
  });
});

// Erase the caller's own account, its tenant's round data and its stored cover
// objects. Irreversible, so it is deliberately awkward in the same way the
// operator route is: the current password (a valid access token may be sitting
// on an unattended device) PLUS the account's own username typed out, which is
// what separates "I meant this" from a mis-click on a destructive control.
router.delete('/', accounts.requireUser, async (req, res) => {
  const body = req.body || {};
  const user = await repo.getUserById(req.userId);
  if (!user) return res.status(401).json({ error: 'invalid_token' });

  // A demo (#427) holds no password identity, so the re-authentication below
  // could only ever answer "your current password is wrong" about a password
  // that never existed — the trap .claude/rules/guest-demo-accounts.md names for
  // the change-password form. DELETE /api/account/demo is its erasure path.
  if (user.demo === true) return res.status(403).json({ error: 'demo_account' });

  // The cheap deterministic check first, so an obvious typo costs no Argon2
  // verify. It leaks nothing: the caller is already authenticated as this
  // account and the screen shows them the username they must type.
  const confirm = String(body.confirmUsername || '').trim();
  // min-length matters for the same reason confirmEmail's does on the admin
  // route: without it an empty confirmation would "match" an account that
  // somehow carries no username, turning the guard off exactly when the data is
  // already odd.
  if (!confirm || confirm.toLowerCase() !== String(user.username || '').toLowerCase()) {
    return res.status(400).json({ error: 'confirm_mismatch' });
  }

  const identity = (user.identities || []).find((i) => i.type === 'password');
  if (!identity) {
    // Burn the same Argon2 work as a real check, as login does.
    await accounts.verifyPassword(await accounts.DUMMY_HASH_PROMISE, String(body.password || ''));
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (!(await accounts.verifyPassword(identity.hash, String(body.password || '')))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  // Captured BEFORE the erasure — the row it lives on is about to be gone, and
  // the farewell mail still has to reach it. The tenant comes back off the
  // erasure result instead, which is the authoritative answer for what was
  // actually cascaded.
  const email = user.email;

  const result = await repo.eraseAccount(user.id);
  // Unreachable today (registration mints a personal tenant, and #207 grants
  // keep tenants 1:1) but this is the one mistake that cannot be walked back, so
  // it is answered as a real refusal the UI renders rather than a generic error.
  if (result === 'tenant_shared') return res.status(409).json({ error: 'tenant_shared' });
  if (!result) return res.status(404).json({ error: 'not_found' });

  // Rows first, bytes second, exactly as the admin erase and /takedown do: the
  // references are already gone, so a failed object delete leaves an orphaned
  // file, never a broken cover. One failure must not abort an erasure that has
  // already happened in the database — count and report honestly instead
  // (.claude/rules/deletion-paths-must-free-cover-objects.md).
  //
  // Filtered to hosted paths so the counts mean what the confirmation promised;
  // storage.remove() would silently ignore a hotlink and inflate `removed`.
  let removed = 0;
  let failed = 0;
  for (const image of result.images.filter(storage.isHostedImage)) {
    try {
      await storage.remove(image);
      removed += 1;
    } catch (err) {
      failed += 1;
      logger.error({ event: 'account_delete_object_failed', err: err.message });
    }
  }

  // Deliberately NO e-mail address and no round or game names: this record
  // outlives the erasure, so copying the erased person's data into it would
  // defeat the erasure it evidences (.claude/rules/admin-moderation-surface.md
  // §5). The account id, tenant, date and counts are what prove the request was
  // honoured, which is the record's only job.
  //
  // A distinct action from the operator route's `user_erased`, so the panel's
  // derived action filter separates self-service from assisted erasures. Both
  // are Art. 17(3)(b)/(e) Löschnachweise and BOTH are exempt from the 3-year
  // moderation-log purge — see docs/legal/retention.md, which #311 implements.
  await repo.logModeration({
    action: 'account_deleted',
    target: user.id,
    reason: 'self-service',
    at: new Date().toISOString(),
    tenantId: result.tenantId,
    rounds: result.rounds,
    imagesRemoved: removed,
    imagesFailed: failed,
  });

  // The address is in memory from before the erasure and is not retained.
  // sendSafe, so a mail failure never 500s a deletion that has already happened.
  await sendSafe({
    to: email,
    subject: 'Spielwirbel: Konto gelöscht / Account deleted',
    text: `Hallo!\n\nDein Spielwirbel-Konto wurde soeben auf deinen Wunsch hin gelöscht — mit allen Runden, Spielen, Sessions und hochgeladenen Bildern. Diese E-Mail-Adresse ist damit wieder frei; du kannst dich jederzeit neu registrieren.\n\nWir haben deine Adresse nicht gespeichert.\n\n---\n\nHi!\n\nYour Spielwirbel account was just deleted at your request — along with every round, game, session and uploaded image. This e-mail address is free again; you can sign up any time.\n\nWe have not kept your address on file.`,
  });

  // Best-effort like /logout: the erased account's still-valid access token
  // resolves to ERASED -> 401 -> the SPA bounces to login anyway
  // (.claude/rules/erased-account-token-fallback.md), so this never has to race
  // the client.
  accounts.clearAccessCookie(res, req);
  logger.info({ event: 'account_self_deleted', tenantId: result.tenantId, rounds: result.rounds });
  res.json({ ok: true, rounds: result.rounds, imagesRemoved: removed, imagesFailed: failed });
});

/* ----------------------------------- me ------------------------------------ */

// The account fields a client may see. Both /me handlers answer through this one
// projection so they cannot drift — and, more importantly, so a field added to
// the stored user shape is never exposed by accident: the stored record also
// holds password hashes, refresh tokens and the verification/reset challenges.
const meProjection = (user) => ({
  id: user.id,
  email: user.email,
  username: user.username || null,
  emailVerified: user.emailVerified,
  createdAt: user.createdAt,
  // Accounts predating #481 carry no key at all, so the projection — not the
  // stored shape — is what guarantees the client always sees the field.
  bggUsername: user.bggUsername || null,
  // #427. The client renders the persistent "this is a demo" banner off this,
  // so it has to survive a reload — which is exactly why it belongs on /me and
  // not only on the POST /demo response. Coerced to a real boolean: every other
  // account answers `false` here rather than `undefined`.
  demo: user.demo === true,
  demoExpiresAt: user.demo === true ? user.demoExpiresAt || null : null,
  // The terms-change notice (#521), delivering what Nutzungsbedingungen §11
  // promises. BOTH values ride here, and the client shows the banner when they
  // differ:
  //
  //  - the RESOLVED accepted revision, so the client never re-implements the
  //    LEGACY_TERMS_REVISION fallback (an absent key means "registered under the
  //    text live at rollout", i.e. up to date today and correctly behind after
  //    the next bump);
  //  - the CURRENT revision, deliberately on this per-user projection rather
  //    than on the public GET /api/config. Both arrive in one response, so the
  //    comparison cannot straddle two requests and read a stale pair — and the
  //    ungated config response keeps the exact shape test/config.test.js pins.
  ...termsAcceptanceOf(user),
});

router.get('/me', accounts.requireUser, async (req, res) => {
  const user = await repo.getUserById(req.userId);
  if (!user) return res.status(401).json({ error: 'invalid_token' }); // account deleted
  res.json(meProjection(user));
});

// Edit the settable parts of the account. Only the BGG handle so far (#481):
// e-mail and username are deliberately immutable here (the first needs a
// re-verification flow, the second is a public handle other accounts address),
// and the password has its own re-authenticating endpoint above.
//
// An ABSENT key means "leave it alone" while an explicit `null` clears the link,
// so a client that only knows about future fields can't blank this one by
// omission.
router.patch('/me', accounts.requireUser, async (req, res) => {
  const body = req.body || {};
  const patch = {};

  if (body.bggUsername !== undefined) {
    if (body.bggUsername === null) {
      patch.bggUsername = null;
    } else {
      const name = String(body.bggUsername).trim();
      // A blank string is the form's own "clear it" — treating it as invalid
      // would leave emptying the field impossible from the UI that sets it.
      if (!name) patch.bggUsername = null;
      else if (!validBggUsername(name)) return res.status(400).json({ error: 'invalid_bgg_username' });
      else patch.bggUsername = name;
    }
  }

  // Nothing recognised: answer the current record rather than writing an empty
  // patch, so an unknown field is a no-op instead of a 400 the UI can't explain.
  const user = Object.keys(patch).length
    ? await repo.updateUser(req.userId, patch)
    : await repo.getUserById(req.userId);
  if (!user) return res.status(401).json({ error: 'invalid_token' });
  res.json(meProjection(user));
});

// Acknowledge the current Nutzungsbedingungen revision (#521) — what dismissing
// the change banner calls.
//
// It takes NO body: the server decides the value, so a client cannot claim to
// have accepted a revision that does not exist (nor pin itself to an old one to
// keep the banner up). This only records that the notice was seen — §11 informs,
// it does not gate the app, so nothing anywhere refuses a caller who is behind.
//
// A demo account is not special-cased: it is created with the current revision,
// so it can never be behind, and writing the field again is a harmless no-op.
router.post('/accept-terms', accounts.requireUser, async (req, res) => {
  const user = await repo.updateUser(req.userId, { acceptedTermsRevision: TERMS_REVISION });
  if (!user) return res.status(401).json({ error: 'invalid_token' });
  res.json(meProjection(user));
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
