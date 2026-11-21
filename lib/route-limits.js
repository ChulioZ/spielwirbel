'use strict';

/*
 * Which requests the rate limiters count, and under which key (#1836).
 *
 * TWO DECISIONS LIVE HERE.
 *
 * 1. The strict AUTH_RATE_LIMIT_MAX budget is spent by a request that TRIES a
 *    credential or a guessable secret — a password, a refresh/verify/reset/
 *    invite token, a passkey assertion — and by nothing else. It used to be
 *    mounted on whole routers (/api/admin, /api/account and its sub-routers), so
 *    signed-in work spent it too: an operator confirming ~100 games' scoring in
 *    the panel (#1786, #1787) locked themselves out for the rest of the window.
 *
 *    So the limiter is attached to the individual route handlers instead
 *    (`router.post('/login', credentialLimit, …)`). Two properties follow from
 *    that shape and are why it was chosen over a path allowlist at the mount:
 *    - Express itself decides which handler a request reaches, so a spelling
 *      the router accepts (`/API/Account/Login/` — routing is case-insensitive
 *      and ignores a trailing slash) can never miss the limiter, which an
 *      allowlist matching on `req.path` would have had to re-derive.
 *    - It runs once per request whatever the mount layout, so the old "mount
 *      it on two routers and silently halve the budget" trap is gone.
 *
 *    The limiter instances are per app (each createApp() builds its own store,
 *    which is what lets a test drive a tiny ceiling), while the routers are
 *    module singletons — so a route reaches its app's limiter through
 *    `req.app.locals.routeLimiters`. A missing one is a wiring bug and fails the
 *    request rather than waving it through: an unlimited credential endpoint is
 *    the silent direction.
 *
 * 2. The general RATE_LIMIT_MAX backstop keys a signed-in request by its
 *    VERIFIED account id. Per IP it was a per-household ceiling (the #399
 *    lesson): a table of players behind one NAT address shared it. Only a token
 *    `verifyAccessToken` accepts may choose the key — never a decoded-but-
 *    unchecked JWT or a raw cookie, or a caller could mint a fresh key per
 *    request and get an unlimited budget. Anything else falls back to the IP.
 *    The operator's `aid` session needs a database lookup to verify, so admin
 *    requests stay IP-keyed here; the general ceiling is far above what the
 *    panel spends once the strict limiter is off it.
 */

const { ipKeyGenerator } = require('express-rate-limit');
const accounts = require('./accounts');

// A route-level middleware that runs the named per-app limiter.
function routeLimit(name) {
  return function limitRoute(req, res, next) {
    const limiters = req.app && req.app.locals && req.app.locals.routeLimiters;
    const limiter = limiters && limiters[name];
    if (!limiter) return next(new Error(`route limiter "${name}" is not configured`));
    return limiter(req, res, next);
  };
}

// AUTH_RATE_LIMIT_MAX, per IP — on every endpoint that tries a credential or a
// secret token. The endpoint list is in .claude/rules/security-middleware.md.
const credentialLimit = routeLimit('credential');
// IMAGE_UPLOAD_RATE_LIMIT_MAX, per account — on the routes that decode
// caller-supplied image bytes (covers, session photos).
const imageUploadLimit = routeLimit('imageUpload');

// The verified account behind a request, from the Bearer header or the access
// cookie (cover images cannot send a header). Null when neither verifies.
function verifiedAccountId(req) {
  return accounts.verifyAccessToken(
    accounts.bearerToken(req) || accounts.readCookie(req, accounts.ACCESS_COOKIE),
  );
}

// The general limiter's key: the account when one is proven, else the IP
// (through ipKeyGenerator, so an IPv6 caller cannot rotate within its /56).
function accountOrIpKey(req) {
  const uid = verifiedAccountId(req);
  return uid ? `acct:${uid}` : ipKeyGenerator(req.ip);
}

// For limiters mounted inside the /api gate, where withTenant has already set
// req.userId from a verified token (legacy mode has none: by IP).
function userOrIpKey(req) {
  return req.userId ? `acct:${req.userId}` : ipKeyGenerator(req.ip);
}

module.exports = { credentialLimit, imageUploadLimit, accountOrIpKey, userOrIpKey, routeLimit };
