'use strict';

// Container + deploy guardrails (issue #131). These are static assertions over
// the Dockerfile / .dockerignore / railway.json text — no Docker daemon or
// network needed — so they run in the ordinary `npm test` suite and catch the
// ways a container/deploy change quietly goes wrong: baking secrets or user data
// into a shipped image, dropping the non-root user, moving data off the mountable
// volume, a silent base-image bump, or a Railway config that stops building the
// Dockerfile / health-checks the wrong path.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Semver compare over [major, minor, patch] triples.
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// The release that motivated the exact pin (#977): Node 22.23.2, 2026-07-28, 11
// CVEs — among them CVE-2026-58044 (HTTP header truncation, a request-smuggling
// primitive in front of the per-IP rate limiters) and CVE-2026-58045 in the zlib
// that `compression` uses. Pinning BELOW it would be a pin that ships the hole.
const NODE_FLOOR = [22, 23, 2];

test('Dockerfile pins an EXACT Node patch in every stage', () => {
  const bases = [...read('Dockerfile').matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
  assert.ok(bases.length >= 2, 'expected a build stage and a runtime stage');

  // A floating `node:22-slim` reaches production only if the builder happens to
  // re-pull it, so a Node security release may or may not arrive — silently, with
  // nothing reporting which runtime is live. An exact patch makes the bump a
  // reviewable Dependabot PR instead (`docker` ecosystem in dependabot.yml).
  for (const b of bases) {
    assert.match(b, /^node:\d+\.\d+\.\d+-slim$/,
      `base image must pin an exact major.minor.patch, got: ${b}`);
  }

  // Both stages must be the same image: the build stage produces the hashed
  // assets the runtime stage copies, so a drift between them would run the app
  // on a runtime that never built it — and it reads as an ordinary two-line diff.
  assert.equal(new Set(bases).size, 1,
    `every stage must pin the SAME base image, got: ${[...new Set(bases)].join(', ')}`);

  const v = bases[0].match(/^node:(\d+)\.(\d+)\.(\d+)-slim$/).slice(1).map(Number);
  assert.ok(cmp(v, NODE_FLOOR) >= 0,
    `base image ${bases[0]} is below the ${NODE_FLOOR.join('.')} security release;`
    + ' a pin that goes backwards is worse than the floating tag it replaced');
});

test('Dockerfile runs as the non-root node user', () => {
  assert.match(read('Dockerfile'), /^USER\s+node\s*$/m, 'image must drop to USER node');
});

test('Dockerfile keeps data on the mountable /data path, in production mode', () => {
  const df = read('Dockerfile');
  assert.match(df, /ENV\s+DATA_DIR=\/data/, 'DATA_DIR should point at /data');
  // Must NOT declare a Dockerfile `VOLUME`: Railway's Metal builder rejects the
  // instruction ("use Railway Volumes"). Persistence is a platform/compose volume
  // mounted at /data instead — see .claude/rules/railway-no-dockerfile-volume.md.
  assert.doesNotMatch(df, /^\s*VOLUME\b/m, 'no Dockerfile VOLUME (Railway rejects it)');
  assert.match(df, /ENV\s+NODE_ENV=production/, 'should run in production mode');
  assert.match(df, /CMD\s+\[\s*"node"\s*,\s*"server\.js"\s*\]/, 'should start the server');
});

test('.dockerignore keeps secrets and user data out of the build context', () => {
  const ignore = read('.dockerignore')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  // The critical guard: never bake the group's private data/ folder or a local
  // .env (which may hold SESSION_SECRET / SMTP_PASS) into a shipped image.
  for (const entry of ['data', '.env', 'node_modules', '.git']) {
    assert.ok(ignore.includes(entry), `.dockerignore must exclude ${entry}`);
  }
});

test('railway.json builds the Dockerfile and health-checks the real /healthz', () => {
  const cfg = JSON.parse(read('railway.json')); // also asserts it stays valid JSON
  assert.equal(cfg.build.builder, 'DOCKERFILE');
  assert.equal(cfg.build.dockerfilePath, 'Dockerfile');
  // Must match the unauthenticated probe the app actually serves (lib/app.js).
  assert.equal(cfg.deploy.healthcheckPath, '/healthz');
});

test('railway.json pins the single replica the in-memory limiter stores require', () => {
  const cfg = JSON.parse(read('railway.json'));
  // Config-as-code beats the dashboard, so this is what stops a second replica
  // being added with a slider. express-rate-limit's default store is per
  // process, so a second one silently doubles all four rate-limit ceilings and
  // the MAIL_DAILY_MAX budget — no error, no failing test, the controls just
  // stop binding. Raising this needs a shared counter store first (#215 closed unshipped).
  // See .claude/rules/deploy-invariants-are-pinned-in-code.md.
  assert.equal(cfg.deploy.numReplicas, 1);
  // App sleeping would stop the 15-minute demo-purge tick (lib/scheduler.js),
  // so expired guest demos would pile up against MAX_LIVE_DEMOS until a request
  // happened to wake the container.
  assert.equal(cfg.deploy.sleepApplication, false);
});
