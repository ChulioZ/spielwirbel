'use strict';

/*
 * Auth endpoints (issue #129): the shared-login gate. Active only when
 * AUTH_PASSWORD is configured; otherwise login is a no-op and the app stays
 * open. The token/cookie/gate mechanics live in lib/auth.js. Mounted under
 * /api/auth in createApp() *before* the requireAuth gate, so these routes stay
 * reachable without a session.
 */

const express = require('express');
const auth = require('../lib/auth');

const router = express.Router();

// Lets the frontend (or a probe) learn whether a login is needed and whether the
// current cookie is valid, without leaking anything else.
router.get('/status', (req, res) => {
  res.json({ authRequired: auth.authEnabled(), authenticated: auth.isAuthenticated(req) });
});

router.post('/login', (req, res) => {
  if (!auth.authEnabled()) return res.json({ ok: true }); // nothing to log into
  const { password } = req.body || {};
  if (!auth.passwordMatches(password)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  auth.setSession(req, res);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  auth.clearSession(req, res);
  res.json({ ok: true });
});

module.exports = router;
