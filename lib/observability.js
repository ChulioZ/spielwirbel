'use strict';

/*
 * Observability baseline (issue #132): structured logging, a request logger, a
 * /healthz handler, and a central error handler with an optional error-tracking
 * hook. Kept dependency-free on purpose — the app avoids heavy SDKs (no Sentry
 * bundle), so "error tracking" is an env-gated webhook forward that a real
 * tracker can later replace at the same seam (captureError).
 *
 * Everything reads its env per call (not at module load) so a deployment — or a
 * test — can change LOG_LEVEL / ERROR_WEBHOOK_URL and have it take effect, the
 * same reason the rate-limit ceilings are read inside createApp() (see
 * .claude/rules/security-middleware.md).
 */

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3 };

// Current threshold from LOG_LEVEL (default 'info'; unknown values fall back to
// 'info' rather than silencing everything by a typo). Tests set 'silent'.
function currentLevel() {
  const v = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  return v in LEVELS ? v : 'info';
}

function enabled(level) {
  return LEVELS[level] <= LEVELS[currentLevel()];
}

// One structured JSON line per event to stdout. Callers pass only safe fields —
// never request bodies, member names, or secrets (see the request logger, which
// deliberately logs method/path/status/timing/ip only, no body or query string).
function write(level, fields) {
  if (!enabled(level)) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...fields });
  process.stdout.write(line + '\n');
}

const logger = {
  info: (fields) => write('info', fields),
  warn: (fields) => write('warn', fields),
  error: (fields) => write('error', fields),
};

// Structured request logging: emits one line when the response finishes, with
// no personal data — method, route path (no query string, which could carry
// data), status, duration and client IP only. /healthz is skipped so health
// probes don't flood the logs.
function requestLogger(req, res, next) {
  if (req.path === '/healthz') return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info({
      event: 'request',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      ip: req.ip,
    });
  });
  next();
}

// Liveness/readiness probe. Cheap and side-effect-free so a load balancer or
// uptime monitor can poll it often; mounted before the rate limiter so probes
// are never throttled.
function healthz(req, res) {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}

// The single seam where unexpected errors are recorded. Always logs the error
// structurally (so log aggregation can alert on level=error), and, if
// ERROR_WEBHOOK_URL is configured, forwards a compact, personal-data-free
// notification (method, path, message — no bodies). Never throws: an error on
// the error path must not crash the response.
async function captureError(err, context = {}) {
  logger.error({
    event: 'unhandled_error',
    message: err && err.message,
    stack: err && err.stack,
    ...context,
  });

  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `[Spieleabend] ${context.method || ''} ${context.path || ''} → ${
          (err && err.message) || 'unknown error'
        }`.trim(),
      }),
    });
  } catch {
    // Swallow: alerting is best-effort and must never mask the original error.
  }
}

// Central Express error handler (must be mounted last, after all routes). Turns
// any unexpected throw / next(err) into a generic 500 with no stack trace leaked
// to the client, after logging + optional alerting. Honours an explicit
// err.status (e.g. a 400 forwarded by upstream middleware) but never exposes
// internals in the body.
function errorHandler(err, req, res, next) {
  // captureError is async but fire-and-forget: the response must not wait on the
  // webhook, and captureError never rejects.
  captureError(err, { method: req.method, path: req.path });
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err && err.status) ? err.status : 500;
  res.status(status).json({ error: status === 500 ? 'internal_error' : (err.code || 'error') });
}

module.exports = { logger, requestLogger, healthz, captureError, errorHandler };
