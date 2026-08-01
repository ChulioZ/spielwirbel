'use strict';

/* Agents pay tokens every time they read or edit a file, and
   `.claude/rules/token-friendly-source-files.md` is the contract that keeps that
   cost down. Nothing enforced it: `M-001` (code-maturity) and `C-004`
   (claude-file) both read "Enforced by: — (manual)", so a file could double in
   size between audits with no signal at all.

   What this file checks is deliberately narrow, because the real test is a
   judgement call the rule spells out: **the seam test — several independently
   editable concerns — not raw line count.** A cohesive flow
   (`public/js/views-session.js`) or a flat data table (`public/js/lang/*.js`) is
   fine at any length. So a line count cannot decide whether a file is *wrong*.

   What it can decide is whether a file crossed the threshold **without anyone
   noticing**, which is the failure that actually happens. Hence the shape:
   a budget per file class plus an allowlist, where every entry carries a written
   reason. Crossing the budget is not a failure — crossing it *silently* is. The
   allowlist is the same "the test is the licence" idiom as
   `test/tag-icons.test.js` and `test/standalone-page-brand.test.js`.

   The entries are also asserted to be **still over budget**, so the list cannot
   rot into a set of names nobody has looked at: a file that shrinks back under
   its budget must drop its entry, and a stale entry fails loudly instead of
   quietly exempting a file that no longer needs it.

   Budgets come from the documented numbers, not from taste:
   - 700 lines for source — the "rough smell" in `token-friendly-source-files.md`,
     which `M-001` repeats as the point where the seam test gets applied.
   - 150 lines for a rule — half of `C-015`'s ~200-line CLAUDE.md budget, on the
     grounds that a rule holding one learning should never be the larger document.
   - 250 lines for a `SKILL.md` — a skill is loaded whole on invocation.
     `criteria.md` files are deliberately exempt: they are catalogues of
     independent entries, i.e. the rule's own flat-data-table carve-out.
   - 200 lines for `CLAUDE.md` — `C-015`, straight from the harness guidance.
     It is 203 today, so it starts out allowlisted: recording the overshoot is
     the point, and the entry has to be removed when the trim happens. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* `wc -l` semantics, deliberately — that is the command every criterion tells the
   auditor to run, and a count that disagrees with it by one would fail a file
   sitting exactly on its budget while the documented check said it was fine.
   A naive `split('\n').length` is that off-by-one: it counts the empty string
   after the trailing newline every file here ends with. */
const lineCount = (rel) => {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
};

// Every file under `dir` matching `keep`, repo-relative, recursing into subdirectories.
const walk = (dir, keep, acc = []) => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, keep, acc);
    else if (keep(rel)) acc.push(rel);
  }
  return acc;
};

// --- The three budgets, and what each one covers.

const SOURCE_BUDGET = 700;
const RULE_BUDGET = 150;
const SKILL_BUDGET = 250;
const CLAUDE_MD_BUDGET = 200;

// `public/js/lang/**` is excluded outright rather than allowlisted: the rule names
// the lang tables as the flat-data-table case, so they are not outliers to record.
const sourceFiles = () => [
  'server.js',
  ...walk('lib', (f) => f.endsWith('.js')),   // recursive, so it covers lib/routes
  ...walk('scripts', (f) => f.endsWith('.js')),
  ...walk('public/js', (f) => f.endsWith('.js') && !f.startsWith('public/js/lang/')),
  ...walk('test', (f) => f.endsWith('.js')),
];

const ruleFiles = () => walk('.claude/rules', (f) => f.endsWith('.md'));
const skillFiles = () => walk('.claude/skills', (f) => f.endsWith('/SKILL.md'));
const claudeMd = () => ['CLAUDE.md'];

/* --- The allowlists.

   Two kinds of entry, and the distinction is the useful output:

   - **judged** — measured against the seam test and kept, with the reason.
   - **recorded** — over budget, never actually judged. These are `M-001`'s
     worklist: the point of writing them down is that "nobody has looked at this
     one" stops being indistinguishable from "this one is fine".

   Adding an entry is a deliberate act. Removing one when a file is split is the
   other half, and the still-over-budget assertion below is what forces it. */

const SOURCE_ALLOW = {
  // judged
  'lib/repo/postgres.js': 'judged — one file per repo backend, paired with json.js against the shared contract; splitting one without the other is what drifts them (data-access-layer.md)',
  'lib/repo/json.js': 'judged — the other half of the same pair',
  'lib/legal.js': 'judged — flat data: the rendered legal texts, DE + EN, kept in one file so a revision bump touches one place (keep-legal-docs-current.md)',
  'public/js/views-session.js': 'judged — a single cohesive flow (start -> vote -> finale -> results), named as the non-finding in token-friendly-source-files.md',
  'test/support/repo-contract.js': 'judged — one shared contract both backends run; splitting it lets a case exist for one backend only',
  'test/admin.test.js': 'judged — one suite per subject, and the admin surface is the largest',
  'test/account.test.js': 'judged — one suite per subject',

  // recorded — not yet judged against the seam test
  'public/js/views-round-tabs.js': 'recorded 2026-07-30 — holds Regal, Chronik, Pokale and the two archive screens; the most likely real seam in the tree',
  'public/js/views-round-lookup.js': 'recorded 2026-07-30 — the add-game/link-provider sheets plus the shared lookup menu',
  'public/js/pages/admin.js': 'recorded 2026-07-30 — the whole operator panel as one IIFE on its own standalone page',
  'public/js/account.js': 'recorded 2026-07-30 — auth screens, token handling and the account screen',
  'public/js/core.js': 'recorded 2026-07-30 — the shared helper surface every view loads',
  'public/js/views-round-detail.js': 'recorded 2026-07-30 — game detail plus the sheet/editor machinery',
  'lib/routes/admin.js': 'recorded 2026-07-30 — one router, but the widest surface of any',
  'lib/routes/account.js': 'recorded 2026-07-30 — register/verify/login/refresh/reset plus self-service export and deletion',
};

const RULE_ALLOW = {
  // recorded — each is one learning by C-004, but each has grown a long
  // narrative; C-021 re-examines them at audit cadence.
  '.claude/rules/admin-moderation-surface.md': 'recorded 2026-07-30 — 11 numbered sections over one surface; the clearest split candidate',
  '.claude/rules/add-game-lookup-provider.md': 'recorded 2026-07-30 — the provider contract plus five providers\' quirks',
  '.claude/rules/landing-product-screenshots.md': 'recorded 2026-07-30 — a regeneration procedure, which is long by nature',
  '.claude/rules/responsive-content-width.md': 'recorded 2026-07-30 — carries the #332 revert reasoning, which is the rule',
  '.claude/rules/guest-demo-accounts.md': 'recorded 2026-07-30 — five numbered traps plus the smaller ones',
  '.claude/rules/session-guests-are-not-members.md': 'recorded 2026-07-30 — the ~10 sites that assumed member == person',
  '.claude/rules/session-teams.md': 'recorded 2026-07-30 — four traps over one feature',
  '.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md': 'recorded 2026-07-30 — three mechanisms that only make sense together',
};

const SKILL_ALLOW = {
  '.claude/skills/pick-issue/SKILL.md': 'recorded 2026-07-30 — the ranking loop and its criteria in one file; the audit skills\' SKILL.md + criteria.md split is the obvious shape to follow',
  '.claude/skills/implement/SKILL.md': 'recorded 2026-07-30 — eight sequential phases, read in order',
  '.claude/skills/security-audit/SKILL.md': 'recorded 2026-07-30 — the loop plus the composition rules against /security-review and CodeQL',
};

const CLAUDE_MD_ALLOW = {
  'CLAUDE.md': 'recorded 2026-07-30 — 203 lines against C-015\'s ~200 target; the overshoot is small and real, so it is recorded rather than trimmed in an unrelated PR',
};

// --- The assertions, applied identically to all four classes.

const cases = [
  ['source files', sourceFiles, SOURCE_BUDGET, SOURCE_ALLOW],
  ['rule files', ruleFiles, RULE_BUDGET, RULE_ALLOW],
  ['SKILL.md files', skillFiles, SKILL_BUDGET, SKILL_ALLOW],
  ['CLAUDE.md', claudeMd, CLAUDE_MD_BUDGET, CLAUDE_MD_ALLOW],
];

for (const [label, list, budget, allow] of cases) {
  test(`${label} over the ${budget}-line budget are allowlisted with a reason`, () => {
    const files = list();
    assert.ok(files.length > 0, `${label}: found none — the walk is looking in the wrong place`);

    const unlisted = files.filter((f) => lineCount(f) > budget && !(f in allow));
    assert.deepEqual(unlisted, [], `${label} over ${budget} lines with no allowlist entry: ${unlisted.join(', ')}\n`
      + 'Apply the seam test (.claude/rules/token-friendly-source-files.md): split it along a real concern boundary, '
      + 'or add it to this file with a written reason.');
  });

  test(`${label}: every allowlist entry still exists and is still over budget`, () => {
    for (const [rel, reason] of Object.entries(allow)) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} is allowlisted but does not exist — drop the entry`);
      assert.ok(reason.trim().length > 20, `${rel}: the allowlist entry needs a real reason, not "${reason}"`);
      assert.ok(lineCount(rel) > budget,
        `${rel} is back under ${budget} lines — remove its allowlist entry so the budget applies again`);
    }
  });
}
