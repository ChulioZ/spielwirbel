'use strict';

/*
 * Daily watch for Node.js security releases on the line the Dockerfile pins
 * (.github/workflows/node-security-watch.yml).
 *
 * Dependabot's `docker` ecosystem bumps the base image weekly and cannot tell a
 * security release from an ordinary patch, and GitHub raises no alert for the
 * runtime inside a base image at all. nodejs.org/dist/index.json marks every
 * release with `security: true`, so this compares that against the pin.
 *
 * The finding is reported as a PRIVATE draft repository security advisory, not
 * an issue: an issue in this public repo would announce "production runs a
 * vulnerable runtime right now" to every watcher (SECURITY.md asks for private
 * reports). For the same reason the job's log — public, like every Actions log
 * here — never says what was found: no versions, no "created a draft".
 *
 * The draft alone notifies nobody: it is created with the operator's own token,
 * and GitHub does not notify you of your own actions (measured 2026-10-22). So
 * while a security release is pending the run FAILS, every day until the bump
 * lands, and GitHub's failed-workflow mail is the alert. A red run says only
 * "action required", a bit anyone can already derive from the public pin and
 * index.json; the details stay in the draft.
 *
 * Needs GH_ADVISORY_TOKEN, a fine-grained PAT with "Repository security
 * advisories: read and write" on this repo; GITHUB_TOKEN cannot create one.
 */

const fs = require('fs');
const path = require('path');

const INDEX_URL = 'https://nodejs.org/dist/index.json';
const TITLE_PREFIX = 'Node.js security release';

const parse = (v) => String(v).replace(/^v/, '').split('.').map(Number);
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// The exact patch every FROM line pins; throws unless they agree, which
// test/docker.test.js already requires.
function pinnedVersion(dockerfile) {
  const pins = [...dockerfile.matchAll(/^FROM\s+node:(\d+\.\d+\.\d+)-slim\b/gm)].map((m) => m[1]);
  if (pins.length === 0 || new Set(pins).size !== 1) {
    throw new Error('Dockerfile must pin one exact node:X.Y.Z-slim in every stage');
  }
  return pins[0];
}

// Security releases on the pinned major that are newer than the pin, newest first.
function pendingSecurityReleases(index, pinned) {
  const p = parse(pinned);
  return index
    .filter((r) => r.security === true)
    .map((r) => ({ version: r.version.replace(/^v/, ''), date: r.date }))
    .filter((r) => { const v = parse(r.version); return v[0] === p[0] && cmp(v, p) > 0; })
    .sort((a, b) => cmp(parse(b.version), parse(a.version)));
}

function advisoryBody(release, pinned) {
  return {
    summary: `${TITLE_PREFIX} ${release.version} — bump the Dockerfile base image`,
    description: [
      `Node.js ${release.version} (${release.date}) is marked as a security release, and the`,
      `Dockerfile still pins node:${pinned}-slim.`,
      '',
      'Advisories: https://nodejs.org/en/blog/vulnerability',
      '',
      'Bump both FROM lines and NODE_FLOOR in test/docker.test.js. Keep any analysis of',
      'where a CVE is reachable out of public PR text until the deploy is verified',
      '(.claude/rules/keep-exploit-paths-private-until-deployed.md). Close this draft once',
      'the bump is live.',
    ].join('\n'),
    vulnerabilities: [{
      package: { ecosystem: 'other', name: 'node (Docker base image)' },
      vulnerable_version_range: `< ${release.version}`,
      patched_versions: release.version,
    }],
  };
}

async function gh(method, url, token, body) {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body && JSON.stringify(body),
  });
  // Status only: an error body could echo the advisory text into the public log.
  if (!res.ok) throw new Error(`GitHub API ${method} answered ${res.status}`);
  return res.json();
}

async function main({ env = process.env, root = path.join(__dirname, '..') } = {}) {
  const token = env.GH_ADVISORY_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  if (!token) throw new Error('GH_ADVISORY_TOKEN is not set');
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');

  const pinned = pinnedVersion(fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8'));
  let release;
  if (env.WATCH_TEST === 'true') {
    // workflow_dispatch "test": proves the token and the notification end to end.
    release = { version: 'TEST', date: new Date().toISOString().slice(0, 10) };
  } else {
    const res = await fetch(INDEX_URL);
    if (!res.ok) throw new Error(`${INDEX_URL} answered ${res.status}`);
    [release] = pendingSecurityReleases(await res.json(), pinned);
  }

  if (release) {
    const body = advisoryBody(release, pinned);
    const drafts = await gh('GET', `/repos/${repo}/security-advisories?state=draft&per_page=100`, token);
    if (!drafts.some((a) => a.summary === body.summary)) {
      await gh('POST', `/repos/${repo}/security-advisories`, token, body);
    }
  }
  if (release) {
    console.log('Node security watch: action required — see Security → Advisories.');
    return true;
  }
  console.log('Node security watch: check complete.');
  return false;
}

module.exports = { pinnedVersion, pendingSecurityReleases, advisoryBody, main };

if (require.main === module) {
  main().then(
    (actionRequired) => { if (actionRequired) process.exitCode = 1; },
    (err) => { console.error(err.message); process.exitCode = 1; },
  );
}
