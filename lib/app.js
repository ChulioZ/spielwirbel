'use strict';

/*
 * Builds the Express app: middleware + route mounting only. No listening here,
 * so tests can require the app and drive it (e.g. via supertest) without opening
 * a port. server.js requires this and calls listen().
 */

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { ROOT, UPLOAD_DIR } = require('./store');
const { requestLogger, healthz, errorHandler } = require('./observability');

const GLOBAL_WINDOW_MS = 15 * 60 * 1000; // 15 min
const RECS_WINDOW_MS = 60 * 60 * 1000; // 1 h

function createApp() {
  const app = express();

  // Rate-limit ceilings, overridable via env so a deployment can tune them and a
  // test can drive tiny limits deterministically. Read per call (not at module
  // load) so each createApp() picks up the current env. `limit` is per IP/window.
  const globalLimit = Number(process.env.RATE_LIMIT_MAX) || 1000;
  const recsLimit = Number(process.env.RECS_RATE_LIMIT_MAX) || 15;

  // When behind a TLS-terminating reverse proxy (§4 of the roadmap: TLS lives at
  // the proxy), TRUST_PROXY tells Express to read the client IP from
  // X-Forwarded-For so rate limiting keys on the real caller. Left off by default
  // so a direct deployment can't be fooled by a spoofed header.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy)
      : trustProxy === 'true' ? true : trustProxy);
  }

  // Security headers. HSTS is set here (harmless over plain HTTP — browsers only
  // honour it over HTTPS, i.e. once TLS terminates at the proxy). The CSP keeps
  // helmet's safe defaults but: allows inline `style="…"` attributes (the views
  // build them for avatar colours, cover backgrounds, score pills) and `data:`
  // images (the background-grain SVG), and drops `upgrade-insecure-requests` so
  // the current plain-HTTP local deployment isn't forced onto HTTPS.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'upgrade-insecure-requests': null,
      },
    },
  }));

  // Structured request logging (issue #132): one JSON line per request when it
  // finishes — method/path/status/timing/ip only, no bodies or query strings, so
  // no personal data is logged. Placed early so it also times rate-limited and
  // errored responses. Silence it with LOG_LEVEL=silent (the test suite does).
  app.use(requestLogger);

  // Health/readiness probe, before the rate limiter so uptime monitors polling
  // it frequently are never throttled.
  app.get('/healthz', healthz);

  // Global rate limit: a blunt DoS/abuse cap across the whole app. The ceiling is
  // generous so normal browsing (assets are browser-cached after first load)
  // never trips it.
  app.use(rateLimit({
    windowMs: GLOBAL_WINDOW_MS,
    limit: globalLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  }));

  app.use(express.json());
  app.use(express.static(path.join(ROOT, 'public')));
  app.use('/uploads', express.static(UPLOAD_DIR));

  // Stricter limit on the one endpoint that spends real money (each POST calls
  // the Claude API — routes/recommendations.js). Future auth endpoints (#129)
  // should get their own strict limiter here too, against brute-forcing.
  const recommendationsLimiter = rateLimit({
    windowMs: RECS_WINDOW_MS,
    limit: recsLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  });

  // API routes (split by resource).
  app.use('/api/lookup', require('../routes/lookup'));
  app.use('/api/rounds', require('../routes/rounds'));
  app.use('/api/rounds/:rid/games', require('../routes/games'));
  app.use('/api/rounds/:rid/members', require('../routes/members'));
  app.use('/api/rounds/:rid/sessions', require('../routes/sessions'));
  app.use('/api/rounds/:rid/activities', require('../routes/activities'));
  app.use('/api/rounds/:rid/background', require('../routes/background'));
  app.use('/api/rounds/:rid/recommendations', recommendationsLimiter, require('../routes/recommendations'));

  // SPA fallback: serve the app shell for frontend GET navigations (deep links,
  // reloads) that aren't an API call, an upload, or a real static file — the
  // client-side router (public/js/router.js) then renders the matching view.
  // Placed last so express.static and the /api routers take precedence; unknown
  // /api/* paths fall through to Express's default 404 rather than the shell.
  app.get(/(.*)/, (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    if (!req.accepts('html')) return next();
    // Pass the file relative to a `root`, not as an absolute path: res.sendFile
    // rejects (404s) any path segment starting with a dot, and an absolute path
    // includes the whole prefix — so running from a directory like a
    // `.claude/worktrees/…` checkout would otherwise fail. With `root`, only the
    // relative part ('index.html') is checked for dotfiles.
    res.sendFile('index.html', { root: path.join(ROOT, 'public') });
  });

  // Central error handler (issue #132): must be last. Any unexpected throw or
  // next(err) — including async rejections, which Express 5 forwards here — is
  // logged + optionally alerted and answered with a generic 500, so stack traces
  // never leak to the client. See lib/observability.js.
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
