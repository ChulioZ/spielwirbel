'use strict';

// CI aggregate-gate guardrails (issue #364). Static assertions over the CI
// workflow YAML text — no runner, no network — so they run in the ordinary
// `npm test` suite. They pin the invariant that makes branch protection safe:
// every CI job is funnelled through the single `ci-passed` context, so a job
// that runs on PRs can never again silently fail to gate a merge to `main`.
// See .claude/rules/ci-aggregate-gate.md.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// The `jobs:` section only — sliced off so the 2-space-indented `push:` /
// `pull_request:` keys under `on:` aren't mistaken for job names. Every key
// inside a job is 4-space indented, so a 2-space `name:` here is a job header.
const jobsSection = read('.github/workflows/ci.yml').slice(
  read('.github/workflows/ci.yml').indexOf('\njobs:'),
);
const headers = [...jobsSection.matchAll(/^ {2}([a-z][\w-]*):[ \t]*$/gm)];
const jobNames = headers.map((h) => h[1]);

// Strip YAML comments before matching — a `#` comment is brace/quote-free text a
// selector-ish regex will otherwise match inside (same trap as the CSS-text
// tests, .claude/rules/css-text-assertions-strip-comments.md).
const stripComments = (s) => s.replace(/[ \t]*#[^\n]*/g, '');

// The `ci-passed` job block: from its header to the next job header (or EOF).
function ciPassedBlock() {
  const i = jobNames.indexOf('ci-passed');
  assert.notEqual(i, -1, 'ci.yml must define a `ci-passed` job');
  const start = headers[i].index;
  const end = i + 1 < headers.length ? headers[i + 1].index : jobsSection.length;
  return stripComments(jobsSection.slice(start, end));
}

test('ci-passed depends on EVERY other CI job (a new job cannot dodge the gate)', () => {
  const block = ciPassedBlock();
  const m = block.match(/needs:[ \t]*\[([^\]]+)\]/);
  assert.ok(m, 'ci-passed must declare a `needs: [...]` list');
  const needs = m[1].split(',').map((s) => s.trim()).filter(Boolean);

  const others = jobNames.filter((n) => n !== 'ci-passed');
  // Sanity: the real work jobs the issue names are still present.
  for (const job of ['test', 'coverage', 'postgres']) {
    assert.ok(others.includes(job), `expected a \`${job}\` job in ci.yml`);
  }
  // The invariant: every job the CI workflow runs is a dependency of the gate,
  // so adding a job (or a Node matrix version, which stays under `test`) can
  // never leave it ungated once branch protection requires only `ci-passed`.
  for (const job of others) {
    assert.ok(needs.includes(job), `ci-passed must \`needs\` the \`${job}\` job`);
  }
});

test('ci-passed runs on failure and treats any non-success as a gate failure', () => {
  const block = ciPassedBlock();
  // Without `if: always()` the job is skipped when a dependency fails, so it
  // never reports the failure and the gate passes vacuously.
  assert.match(block, /if:[ \t]*always\(\)/, 'ci-passed needs `if: always()`');

  // The condition must be an ALLOWLIST — every dependency explicitly compared
  // against 'success' — never a denylist of known-bad results.
  //
  // This is not a style preference. The denylist form
  // `contains(needs.*.result, 'failure')` shipped from #364 until 2026-08-06 and
  // was observed reporting SUCCESS while the `postgres` job had FAILED (main,
  // run 31114551171 attempt 1): a job that dies during "Set up job" contributes
  // no 'failure' entry to the `needs.*.result` object filter, and it is not
  // 'cancelled' or 'skipped' either, so all three arms missed it. Branch
  // protection requires only `ci-passed`, so that is a mergeable red build.
  //
  // `!= 'success'` catches an absent or empty result, and every value nobody
  // has thought of yet — the allowlist-not-denylist shape this repo already
  // applies to `resolveLocale` and `isAllowedImageUrl`.
  const m = block.match(/needs:[ \t]*\[([^\]]+)\]/);
  assert.ok(m, 'ci-passed must declare a `needs: [...]` list');
  const needs = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  for (const job of needs) {
    assert.ok(
      block.includes(`needs.${job}.result != 'success'`),
      `ci-passed's condition must check \`needs.${job}.result != 'success'\` — a job in `
      + '`needs` but absent from the condition is a dependency that cannot fail the gate',
    );
  }
  // The object filter must be GONE, not merely supplemented: leaving it beside
  // the explicit checks invites a future edit to "simplify" back to it.
  assert.ok(
    !block.includes('needs.*.result'),
    'ci-passed must not use the `needs.*.result` object filter — an infra-failed job is absent from it',
  );
  assert.match(block, /run:[ \t]*exit 1/, 'the guard step must `exit 1` on a bad result');
});
