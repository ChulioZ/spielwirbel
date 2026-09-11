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

// The floor RISES WITH THE PINNED MAJOR, by design. #994 decided this repo accepts
// major base-image bumps as they come, so this records the minimum release on the
// line we currently ride rather than a version fixed forever. On v26 that is 26.5.1
// (2026-07-28) — the release carrying the same security content that made 22.23.2
// the floor on v22 (#977): 11 CVEs, among them CVE-2026-58044 (HTTP header
// truncation, a request-smuggling primitive in front of the per-IP rate limiters)
// and CVE-2026-58045 in the zlib that `compression` uses. Pinning BELOW it would be
// a pin that ships the hole, and dropping back to an older major is a downgrade
// that has to edit this line rather than slip through as a two-word diff.
const NODE_FLOOR = [26, 5, 1];

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

test('CI exercises the Node major production is pinned to (#994)', () => {
  const major = Number(read('Dockerfile').match(/^FROM\s+node:(\d+)\./m)[1]);
  const ci = read('.github/workflows/ci.yml');

  // The matrix spans the supported range and must INCLUDE production's runtime,
  // or `npm test` never runs on what actually ships.
  const matrix = ci.match(/node-version:\s*\[([^\]]+)\]/);
  assert.ok(matrix, 'ci.yml must declare a test matrix');
  const versions = matrix[1].split(',').map((v) => v.trim());
  assert.ok(versions.includes(`${major}.x`),
    `the test matrix ${JSON.stringify(versions)} must include the pinned ${major}.x`);

  // Every SINGLE-version job in ci.yml (coverage, postgres) must run on that major.
  // `postgres` is the sharp one: it is the only thing exercising the data-access
  // contract against a real database, so on a different runtime the pg/Knex stack is
  // unproven where it actually runs — it sat on 24.x while production moved to 26.
  // The bracketed matrix line and the templated `${{ matrix.node-version }}` line do
  // not match this pattern, so only real pins are collected. lint.yml is deliberately
  // NOT scanned: it runs on the `engines` floor (22.x) so `node --check` proves the
  // source still parses on the OLDEST supported Node, which is a different question.
  const pinned = [...ci.matchAll(/^\s*node-version:\s*(\d+)\.x\s*$/gm)].map((m) => Number(m[1]));
  assert.ok(pinned.length >= 2,
    `expected ci.yml's single-version jobs, found ${pinned.length} — pattern drifted?`);
  for (const v of pinned) {
    assert.equal(v, major,
      `a ci.yml job pins Node ${v}.x while the Dockerfile pins ${major}.x —`
      + ' the suite must run on the runtime production ships');
  }
});

// Split .github/dependabot.yml into its `- package-ecosystem:` blocks. No YAML
// parser is a dependency here and test/ci-workflow.test.js scans its workflows as
// text too, so this follows that shape. A block runs from its own
// `- package-ecosystem:` line to the next one, which puts a block's LEADING comment
// in the previous block — harmless, and the comment strip below covers it either way.
const dependabotBlocks = () => {
  const parts = read('.github/dependabot.yml').split(/^\s*-\s+package-ecosystem:/m).slice(1);
  return parts.map((body) => ({ name: (body.match(/^\s*"?([\w-]+)"?/) || [])[1], body }));
};

test('dependabot.yml keeps the docker ecosystem, with MAJORS flowing (#994)', () => {
  const docker = dependabotBlocks().find((b) => b.name === 'docker');
  // Removing the ecosystem is the freeze mode the pinning rule already names: with
  // no docker block the exact pin silently becomes the WORSE of the two policies —
  // frozen instead of floating, and nothing in the repo can observe it.
  assert.ok(docker, '.github/dependabot.yml must keep the `docker` ecosystem');

  // Strip comments before the ban scan: the place a rule is written down is exactly
  // where its banned phrase legitimately appears
  // (.claude/rules/source-scanning-guards-enumerate-shapes.md).
  const code = docker.body.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');

  // #994 decided majors arrive as ordinary PRs rather than being ignored, so the
  // patch channel is never silenced by a held major sitting in front of it (one PR
  // per dependency means a held major leaves no patch PR behind it). The scan is
  // deliberately blunt — banning the phrase anywhere in the block, rather than
  // matching an `ignore:` shape — because the same rule can be written as an inline
  // array or as a nested list, and a shape this guard does not enumerate is a shape
  // it cannot see. Reversing the decision must move the rule file too, not arrive as
  // a quiet two-line config edit.
  assert.doesNotMatch(code, /semver-major/,
    'the docker ecosystem must not ignore major bumps — that silences the patch'
    + ' channel behind the held major. See'
    + ' .claude/rules/pin-images-and-actions-by-digest.md (#994)');
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
