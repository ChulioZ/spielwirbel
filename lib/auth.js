'use strict';

/*
 * Authentication gate (issue #129) — the "single-instance milestone" from the
 * production-readiness roadmap (§5). The smallest real auth: one shared login
 * gating the whole app.
 *
 * Env-gated on purpose: it is active ONLY when AUTH_PASSWORD is configured.
 * With no password set the app stays fully open, exactly as the local-only MVP
 * runs today (and the test suite drives it) — so this adds a lock without
 * changing current behaviour until a deployment opts in.
 *
 * Token-first (roadmap §5, so web + the later native apps can share it): the
 * session is a stateless HMAC-signed token in an httpOnly cookie — no server-
 * side session store, so the app tier stays stateless for the coming Postgres
 * migration (#127). Only Node's built-in `crypto` is used (HMAC-SHA256 +
 * constant-time compare); no new dependency, and no hand-rolled password stack
 * (a single shared secret, not per-user hashing — that lands with #135).
 *
 * All config is read per-call (not at module load) so each createApp() / request
 * sees the current env — the same reason the rate-limit ceilings are read per
 * call (see lib/app.js and .claude/rules/security-middleware.md).
 */

const crypto = require('crypto');

const COOKIE_NAME = 'sid';
const TOKEN_VERSION = 'v1';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Auth is on only when a shared password is configured.
function authEnabled() {
  return !!(process.env.AUTH_PASSWORD && process.env.AUTH_PASSWORD.length);
}

// Secret that signs the session token. Prefer an explicit SESSION_SECRET; fall
// back to the password so a minimal deployment can set just AUTH_PASSWORD.
function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.AUTH_PASSWORD || '';
}

// Constant-time string compare (equal length required by timingSafeEqual).
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

// token = "v1.<expiryMs>.<hmac(v1.<expiryMs>)>" — self-contained, no storage.
function mintToken(secret, ttlMs = TOKEN_TTL_MS) {
  const payload = `${TOKEN_VERSION}.${Date.now() + ttlMs}`;
  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [ver, expStr, sig] = parts;
  if (ver !== TOKEN_VERSION) return false;
  if (!safeEqual(sig, sign(`${ver}.${expStr}`, secret))) return false;
  const exp = Number(expStr);
  return Number.isFinite(exp) && exp > Date.now();
}

// Read one cookie from the raw header (Express 5 doesn't parse cookies, and we
// avoid adding cookie-parser just to read one name).
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

function isAuthenticated(req) {
  return verifyToken(readCookie(req, COOKIE_NAME), sessionSecret());
}

function passwordMatches(candidate) {
  const expected = process.env.AUTH_PASSWORD || '';
  return !!expected && typeof candidate === 'string' && safeEqual(candidate, expected);
}

// `secure: req.secure` marks the cookie Secure only once TLS terminates in front
// (req.secure is true behind a trusted proxy sending X-Forwarded-Proto=https —
// see TRUST_PROXY in lib/app.js). Over plain-HTTP local dev it stays unset, so
// the browser (and supertest) keep the cookie.
function cookieOptions(req) {
  return { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' };
}

function setSession(req, res) {
  res.cookie(COOKIE_NAME, mintToken(sessionSecret()), {
    ...cookieOptions(req),
    maxAge: TOKEN_TTL_MS,
  });
}

function clearSession(req, res) {
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
}

// Middleware: 401 on a protected route when auth is on and the request isn't
// authenticated. A no-op when auth is disabled, so the open MVP is untouched.
function requireAuth(req, res, next) {
  if (!authEnabled() || isAuthenticated(req)) return next();
  res.status(401).json({ error: 'auth_required' });
}

module.exports = {
  COOKIE_NAME,
  TOKEN_TTL_MS,
  authEnabled,
  sessionSecret,
  mintToken,
  verifyToken,
  isAuthenticated,
  passwordMatches,
  setSession,
  clearSession,
  requireAuth,
};
