'use strict';

/*
 * Operator (admin) gate for the moderation surface — issue #268.
 *
 * Guards /api/admin and the standalone /admin.html page: the tooling an operator
 * needs to act on an abuse notice (locate a cover image, take it down, suspend an
 * account, read the action log). See lib/routes/admin/, split by concern since
 * #996 (moderation, covers, users, notices, log, corpus, status).
 *
 * It started as a MIRROR of lib/auth.js's mechanism (one shared password ->
 * stateless HMAC-signed httpOnly cookie) and still keeps a separate password and
 * signing secret from it. Two reasons, both real:
 *
 *  1. AUTH_PASSWORD is shared with the whole group that uses the instance. These
 *     powers cross tenant boundaries (read any tenant's rows, delete any image,
 *     disable any account), so granting them to everyone holding the app password
 *     would be a privilege escalation. This is the same call
 *     .claude/rules/user-accounts.md already made for SESSION_SECRET, which must
 *     not fall back to AUTH_PASSWORD "because the shared password is known to the
 *     whole group".
 *  2. Sharing the secret would make an ordinary app session token verify as an
 *     admin token, so in legacy (shared-password) mode the panel would have no
 *     separate gate at all.
 *
 * Hence a separate ADMIN_PASSWORD and a separate cookie name.
 *
 * TWO FACTORS since #1670: the password alone no longer mints the session. It
 * buys a short-lived password-step token, and only a passkey assertion against
 * an enrolled admin credential turns that into the `aid` cookie
 * (lib/admin-passkeys.js, the login pair in lib/routes/admin/index.js).
 *
 * THE SESSION IS SERVER-SIDE since the 2026-10-22 Railway env-var leak. `aid`
 * used to be a stateless HMAC over its own expiry, so anyone holding the
 * signing secret (ADMIN_SESSION_SECRET, or SESSION_SECRET as its fallback —
 * both live in the deploy environment) could mint one and skip the password
 * AND the passkey. Now `aid` is a random id, and a request is the operator's
 * only while a row for its SHA-256 exists (repo.createAdminSession & co.) — a
 * row that only the passkey step writes. No secret can produce one, logout and
 * removing a passkey end sessions for real, and the hash means a read of the
 * table does not hand out live cookies. The signing secret still signs the
 * password-step token and the enrollment challenge; forging those skips the
 * password, never the passkey.
 *
 * Fail-closed: with no ADMIN_PASSWORD configured the whole surface 404s
 * (requireAdmin below), exactly like accounts.accountsEnabled() gates the account
 * routes. An instance that never sets it is byte-for-byte unchanged.
 *
 * All config is read per call (not at module load) so each createApp()/request
 * sees the current env — same reason as lib/auth.js and the rate-limit ceilings
 * (.claude/rules/security-middleware.md).
 */

const crypto = require('crypto');
const repo = require('./repo');

const COOKIE_NAME = 'aid';
// Deliberately much shorter than the app session's 30 days: a privileged surface
// used rarely, so a stolen/forgotten cookie has a small window.
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// The admin surface exists only when an operator password is configured.
function adminEnabled() {
  return !!(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length);
}

// Secret signing the admin login's password-step token and enrollment challenge
// (lib/admin-passkeys.js) — NOT the session, which no secret can mint. Prefer an
// explicit ADMIN_SESSION_SECRET, then the app's SESSION_SECRET, else the admin
// password itself (so a minimal deployment can set just ADMIN_PASSWORD). Sharing
// SESSION_SECRET is safe because those tokens carry their own `wa.admin.*`
// scopes.
function signingSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
}

// Constant-time compare (timingSafeEqual requires equal length).
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// 256 random bits: the cookie value. Only its hash is ever stored.
function newSessionId() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionId(id) {
  return crypto.createHash('sha256').update(String(id)).digest('hex');
}

// Read one cookie from the raw header (Express 5 doesn't parse cookies and we
// don't add cookie-parser just to read one name — same as lib/auth.js).
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

// The expiry is checked here rather than trusted to the purge, which runs only
// when the next session is created.
async function isAdmin(req) {
  if (!adminEnabled()) return false;
  const id = readCookie(req, COOKIE_NAME);
  if (!id) return false;
  const row = await repo.getAdminSession(hashSessionId(id));
  return !!row && Date.parse(row.expiresAt) > Date.now();
}

// The one-time enrollment token for admin passkeys (#1670). Unset = enrollment
// is closed, for everyone, including a signed-in operator: a stolen session must
// not be able to add a persistent key.
function enrollTokenSet() {
  return !!(process.env.ADMIN_ENROLL_TOKEN && process.env.ADMIN_ENROLL_TOKEN.length);
}

function enrollTokenMatches(candidate) {
  const expected = process.env.ADMIN_ENROLL_TOKEN || '';
  return !!expected && typeof candidate === 'string' && safeEqual(candidate, expected);
}

function passwordMatches(candidate) {
  const expected = process.env.ADMIN_PASSWORD || '';
  return !!expected && typeof candidate === 'string' && safeEqual(candidate, expected);
}

// `secure: req.secure` marks the cookie Secure once TLS terminates in front (true
// behind a trusted proxy sending X-Forwarded-Proto=https — see TRUST_PROXY in
// lib/app.js); over plain-HTTP local dev it stays unset so the browser and
// supertest keep the cookie. sameSite 'strict' (not 'lax' like the app session):
// nothing should ever navigate into the admin surface from another origin.
function cookieOptions(req) {
  return { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' };
}

// Called ONLY by the passkey step. `credentialId` ties the session to the key
// that opened it, so removing that key ends it (lib/routes/admin/passkeys.js).
async function setSession(req, res, credentialId) {
  const id = newSessionId();
  const now = Date.now();
  await repo.createAdminSession({
    idHash: hashSessionId(id),
    credentialId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TOKEN_TTL_MS).toISOString(),
  });
  res.cookie(COOKIE_NAME, id, { ...cookieOptions(req), maxAge: TOKEN_TTL_MS });
}

async function clearSession(req, res) {
  const id = readCookie(req, COOKIE_NAME);
  if (id) await repo.deleteAdminSession(hashSessionId(id));
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
}

// Middleware for every admin route except login: 404 when the surface is
// disabled (don't advertise its existence), 401 when it's on but unauthenticated.
async function requireAdmin(req, res, next) {
  if (!adminEnabled()) return res.status(404).json({ error: 'admin_disabled' });
  if (await isAdmin(req)) return next();
  res.status(401).json({ error: 'admin_auth_required' });
}

module.exports = {
  COOKIE_NAME,
  TOKEN_TTL_MS,
  adminEnabled,
  signingSecret,
  newSessionId,
  hashSessionId,
  isAdmin,
  passwordMatches,
  enrollTokenSet,
  enrollTokenMatches,
  setSession,
  clearSession,
  requireAdmin,
};
