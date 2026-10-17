'use strict';

/*
 * Operator moderation endpoints (issue #268) — the tooling that makes the
 * reactive DSA duties scoped in #140 actually performable: once a valid abuse
 * notice arrives, locate the reported cover image, take it down, suspend the
 * responsible account, and leave a record of why.
 *
 * Mounted at /api/admin in lib/app.js AHEAD of the app's own auth gate (like
 * /api/auth and /api/account), because the operator must be able to reach it
 * whichever mode the instance runs in — and it carries its own, stronger gate:
 * lib/admin.js (ADMIN_PASSWORD, a separate secret from AUTH_PASSWORD; see that
 * file's header for why they must not be the same value).
 *
 * These handlers use the module-level `repo`, NOT req.repo: moderation is
 * deliberately cross-tenant (a notice names an image, not a tenant), which is
 * exactly why the moderation methods are absent from TENANT_METHODS. The tenant
 * middleware never runs for this router. See
 * .claude/rules/admin-moderation-surface.md.
 *
 * SPLIT INTO SUB-ROUTERS BY #996. The file self-labelled sixteen sections and
 * had grown to 1124 lines; four of them are separately-owned bodies of work with
 * disjoint rule and doc files (DSA notices, the Art. 15/17 flows, the BGG corpus
 * ingest, the cover backfill), and editing one had never touched another.
 *
 * WHY THE SUB-ROUTERS MOUNT HERE AND NOT IN lib/app.js, which is what #996
 * proposed by analogy with the five /api/account routers: those have distinct
 * PATH prefixes, and these do not — /status, /logs, /users and the rest all live
 * directly under /api/admin. Mounting seven routers on one prefix in the app
 * would run `authLimiter` seven times per request and silently divide
 * AUTH_RATE_LIMIT_MAX by seven, which is precisely the trap the passkeys router
 * carries a comment about. One mount stays in lib/app.js; the composition is
 * here, where the gate already is.
 */

const express = require('express');
const { z } = require('zod');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const admin = require('../../admin');
const adminPasskeys = require('../../admin-passkeys');
const webauthn = require('../../webauthn');
const repo = require('../../repo');
const { validateBody } = require('../../validate');
const storage = require('../../storage');
const { logger } = require('../../observability');

const router = express.Router();

/* ---------------------------------- login ---------------------------------- */
/*
 * TWO FACTORS (#1670). The handlers below are the only unauthenticated ones
 * here, and none of them sets the session except the passkey step:
 *
 *   POST /login            password  -> password-step token + WebAuthn options
 *   POST /login/passkey    token + assertion (UV required) -> the `aid` session
 *   POST /enroll/options   password + ADMIN_ENROLL_TOKEN -> registration options
 *   POST /enroll           ADMIN_ENROLL_TOKEN + attestation -> stores the key
 *
 * The password-step token is the signed authentication challenge itself
 * (lib/admin-passkeys.js), so the challenge cannot be obtained without the
 * password. The enrollment pair 404s while ADMIN_ENROLL_TOKEN is unset, for a
 * signed-in operator too: a stolen session must not add a persistent key.
 *
 * They live HERE rather than in a sub-router because every sub-router mounts
 * behind the gate (test/admin-router-composition.test.js), and these must not.
 * The gated half — listing and removing keys — is ./passkeys.js.
 */

// A WebAuthn response is verified by @simplewebauthn/server, which owns its
// shape; the schema only bounds what the route itself reads.
const credentialSchema = z.looseObject({ id: z.string().min(1).max(1024) });
const tokenSchema = z.string().min(1).max(2048);

router.post('/login', async (req, res) => {
  if (!admin.adminEnabled()) return res.status(404).json({ error: 'admin_disabled' });
  if (!admin.passwordMatches((req.body || {}).password)) {
    logger.warn({ event: 'admin_login_failed', ip: req.ip });
    return res.status(401).json({ error: 'invalid_password' });
  }
  const keys = await repo.listAdminPasskeys();
  if (!keys.length) {
    // Fail closed. With enrollment closed this answers exactly like a wrong
    // password, so a correct password reveals nothing to someone who has only
    // that; the log line is how the operator learns why they cannot get in.
    logger.warn({ event: 'admin_login_no_passkey', ip: req.ip });
    if (!admin.enrollTokenSet()) return res.status(401).json({ error: 'invalid_password' });
    return res.status(409).json({ error: 'no_admin_passkey' });
  }
  const options = await generateAuthenticationOptions({
    rpID: webauthn.rpId(),
    allowCredentials: keys.map((k) => ({ id: k.credentialId, transports: k.transports || [] })),
    // Required, not 'preferred' like account passkeys: this is the second
    // factor for the most powerful surface in the app, so the key must prove
    // its user (PIN or biometric), not merely its presence.
    userVerification: 'required',
    challenge: webauthn.newChallenge(),
  });
  res.json({ step: adminPasskeys.signLoginStep(options.challenge), options });
});

router.post('/login/passkey', async (req, res) => {
  if (!admin.adminEnabled()) return res.status(404).json({ error: 'admin_disabled' });
  // `step` is optional in the SCHEMA so a missing one gets the same 401 as a bad
  // one below, not a 400 that would set it apart.
  const body = validateBody(z.object({ step: tokenSchema.optional(), response: credentialSchema }), req, res);
  if (!body) return;
  const fail = (reason) => {
    logger.warn({ event: 'admin_login_passkey_failed', reason, ip: req.ip });
    return res.status(401).json({ error: 'invalid_passkey' });
  };
  // One answer for a missing, expired, tampered or wrong-scope token: it is the
  // proof the password step passed, and a distinct code would say which half of
  // a forgery was right.
  const expected = adminPasskeys.verifyLoginStep(body.step);
  if (!expected) return fail('step');
  const key = (await repo.listAdminPasskeys()).find((k) => k.credentialId === body.response.id);
  if (!key) return fail('unknown_credential');
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: expected,
      expectedOrigin: webauthn.expectedOrigins(),
      expectedRPID: webauthn.rpId(),
      credential: {
        id: key.credentialId,
        publicKey: Buffer.from(key.publicKey, 'base64url'),
        // The stored counter is what lets the library refuse a replayed or
        // cloned assertion (only when it is > 0 — see lib/routes/passkeys.js).
        counter: key.counter || 0,
        transports: key.transports || [],
      },
      requireUserVerification: true,
    });
  } catch {
    return fail('rejected');
  }
  if (!verification.verified) return fail('rejected');
  await repo.updateAdminPasskey(key.credentialId, {
    counter: verification.authenticationInfo.newCounter,
    lastUsedAt: new Date().toISOString(),
  });
  admin.setSession(req, res);
  logger.info({ event: 'admin_login' });
  res.json({ ok: true });
});

// Both enrollment handlers: 404 while the token is unset (don't advertise a
// closed window), one generic 401 for a wrong password OR a wrong token.
function enrollOpen(req, res) {
  if (!admin.adminEnabled() || !admin.enrollTokenSet()) {
    res.status(404).json({ error: 'admin_enroll_disabled' });
    return false;
  }
  return true;
}

router.post('/enroll/options', async (req, res) => {
  if (!enrollOpen(req, res)) return;
  const body = validateBody(z.object({
    password: z.string().max(1024).optional(),
    enrollToken: z.string().max(1024).optional(),
  }), req, res);
  if (!body) return;
  if (!admin.passwordMatches(body.password) || !admin.enrollTokenMatches(body.enrollToken)) {
    logger.warn({ event: 'admin_enroll_failed', ip: req.ip });
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const keys = await repo.listAdminPasskeys();
  const options = await generateRegistrationOptions({
    rpName: webauthn.rpName(),
    rpID: webauthn.rpId(),
    userName: 'operator',
    userDisplayName: 'Spielwirbel Operator',
    // A fixed handle: there is one operator, and the authenticator files every
    // admin key under it instead of offering it at the account login.
    userID: Buffer.from('spielwirbel-operator', 'utf8'),
    challenge: webauthn.newChallenge(),
    attestationType: 'none',
    excludeCredentials: keys.map((k) => ({ id: k.credentialId, transports: k.transports || [] })),
    authenticatorSelection: {
      // Not 'required' like account passkeys: login names the allowed
      // credentials, so a non-discoverable hardware-key credential works.
      residentKey: 'preferred',
      userVerification: 'required',
    },
  });
  res.json({ challenge: adminPasskeys.signEnrollChallenge(options.challenge), options });
});

router.post('/enroll', async (req, res) => {
  if (!enrollOpen(req, res)) return;
  const body = validateBody(z.object({
    enrollToken: z.string().max(1024).optional(),
    challenge: tokenSchema,
    response: credentialSchema,
    name: z.string().max(200).optional(),
  }), req, res);
  if (!body) return;
  // Re-checked here: the challenge proves the password step, the token is
  // checked again so a window closed in between stays closed.
  if (!admin.enrollTokenMatches(body.enrollToken)) {
    logger.warn({ event: 'admin_enroll_failed', ip: req.ip });
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const expected = adminPasskeys.verifyEnrollChallenge(body.challenge);
  if (!expected) return res.status(400).json({ error: 'invalid_challenge' });
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: expected,
      expectedOrigin: webauthn.expectedOrigins(),
      expectedRPID: webauthn.rpId(),
      requireUserVerification: true,
    });
  } catch {
    return res.status(400).json({ error: 'invalid_passkey' });
  }
  if (!verification.verified) return res.status(400).json({ error: 'invalid_passkey' });
  const stored = adminPasskeys.storedFromRegistration(verification.registrationInfo.credential, body.name);
  if (!(await repo.addAdminPasskey(stored))) return res.status(409).json({ error: 'passkey_exists' });
  logger.info({ event: 'admin_passkey_enrolled' });
  res.status(201).json({ passkey: adminPasskeys.publicAdminPasskey(stored) });
});

router.post('/logout', (req, res) => {
  admin.clearSession(req, res);
  res.json({ ok: true });
});

// Session probe for the UI: 200 when signed in, 401 when not, 404 when the
// surface is off — the same three-way shape the SPA already reads from
// /api/account/me (see .claude/rules/accounts-mode-gate.md).
router.get('/me', admin.requireAdmin, (req, res) => {
  res.json({ ok: true, storage: storage.backend });
});

/* --------------------------- everything below: gated ----------------------- */

router.use(admin.requireAdmin);

// Order is irrelevant — the sub-routers register disjoint paths — so they are
// listed in the order the panel's cards read, which is the order somebody
// looking for a handler will guess.
router.use(require('./status'));
router.use(require('./corpus'));
router.use(require('./storage'));
router.use(require('./moderation'));
router.use(require('./users'));
router.use(require('./log'));
router.use(require('./notices'));
router.use(require('./passkeys'));

module.exports = router;
