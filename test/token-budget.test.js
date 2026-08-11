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
     It is over that today, so it is allowlisted: recording the overshoot is
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
  const lines = body(fs.readFileSync(path.join(ROOT, rel), 'utf8')).split('\n');
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
};

/* Scope frontmatter is NOT content, so it does not spend the budget.

   The budget asks "how much does a reader — or an agent — have to take in".
   A `paths:` block is the opposite of that: it exists so the file is *not*
   loaded when it is irrelevant (`test/rule-scope.test.js`, criteria C-014/C-022).
   Counting it against the content budget penalises the one edit that reduces
   context cost, which is backwards.

   Not hypothetical: concluding the scoping trial pushed `bgg-collection-import.md`
   to 151 and `psstore-full-game-is-not-every-game.md` to 152 — both over budget
   on metadata alone, having gained no content. The honest fix is to measure the
   right thing rather than to allowlist two files for a rounding artefact.

   `wc -l` semantics below are deliberate — that is the command every criterion
   tells the auditor to run, and a count that disagrees with it by one would fail
   a file sitting exactly on its budget while the documented check said it was
   fine. (An auditor running bare `wc -l` on a scoped rule now reads a few lines
   high; that is the trade, and it errs toward looking *at* a file rather than
   away from one.) */
const body = (text) => {
  let t = text;
  if (t.startsWith('---\n')) {
    const end = t.indexOf('\n---', 3);
    if (end >= 0) t = t.slice(end + 4).replace(/^\n/, '');
  }
  return t.replace(/^\s*<!--\s*scope: global[\s\S]*?-->\n?/m, '');
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
  'test/providers-bgg.test.js': 'judged — one suite per provider, the shape all five providers-*.test.js files follow. A per-hop split (search / thing / collection / versions) is the visible seam, but it would break that convention for the one provider with four hops and split the shared COLLECTION_XML/THING_XML fixtures across files',
  'lib/providers/bgg.js': 'judged 2026-08-09 — one file per provider, the shape all five providers follow (search/detail + pure parse* exports); crossed by #702 adding the wishlist expansion probe. The visible seam (parsers vs transport vs capabilities) is a false one: each capability is pairwise-coupled to its parser (parseCollection <-> collection, parseVersions <-> covers), and splitting BGG alone would make the one provider with six hops the one with a different layout — the re-learn cost token-friendly-source-files.md names',
  'test/bgg-import.test.js': 'judged 2026-08-09 — one suite per subject (the two collection-import routes), the admin/account shape; crossed by #702\'s probe-failure specs. The visible seam (owned vs wishlist shelf) is a false one: the specs share one fixture/stub kit, and the cache-key-trap spec NEEDS both shelves in one file — it asserts they do not answer each other',

  // recorded — not yet judged against the seam test
  // (views-round-tabs.js was the ninth, and #528 SPLIT it: views-regal.js,
  // views-chronik.js, views-pokale.js, views-archive.js and
  // views-round-actions.js — the last holding the two sheets whose entry points
  // #561 had already moved to the Einstellungen screen. All five land well under
  // the budget, so the entry is gone rather than re-judged.)
  'public/js/views-round-lookup.js': 'recorded 2026-07-30 — the add-game/link-provider sheets plus the shared lookup menu',
  'public/js/pages/admin.js': 'recorded 2026-07-30 — the whole operator panel as one IIFE on its own standalone page',
  'public/js/account.js': 'recorded 2026-07-30 — auth screens, token handling and the account screen',
  'public/js/core.js': 'recorded 2026-07-30 — the shared helper surface every view loads',
  'public/js/views-round-detail.js': 'recorded 2026-07-30 — game detail plus the sheet/editor machinery',
  'lib/routes/admin.js': 'recorded 2026-07-30 — one router, but the widest surface of any',
  'lib/routes/account.js': 'recorded 2026-07-30 — register/verify/login/refresh/reset plus self-service export and deletion',
  'lib/routes/games.js': 'recorded 2026-08-09 — one router per resource (the repo convention), sitting at 699 since #653 and pushed over by #703\'s wish-add expansion resolution. A seam is visible — the expansion endpoints (PUT /expansions, acquire-expansion, the #703 resolver) against the CRUD/state-flip rest — but splitting one resource\'s router would be a new pattern for lib/routes/; M-001\'s worklist item',
  'lib/routes/sessions.js': 'recorded 2026-08-11 — one router per resource, the same class as games.js above; pushed over by #736\'s blocking pre-draw backfill. The visible seam is start-a-session (draw, direct-pick, and the guest/team resolvers only they use) against the running session\'s writes (votes, close, results, choice, finish, cancel) — but it is a session LIFECYCLE, the shape token-friendly-source-files.md names as the non-finding for views-session.js, and splitting one resource\'s router remains a new pattern for lib/routes/. M-001\'s worklist item, alongside games.js',
};

/* All eight were `recorded` — "over budget, nobody has looked" — from 2026-07-30
   until 2026-08-01, when each was put through the seam test (C-004: several
   *unrelated* learnings, not raw length). One had a real seam and was split; the
   other seven are one learning whose length is its evidence, and splitting them
   would scatter something a single reader needs at once. A `recorded` rule entry
   means a file grew past 150 and nobody has judged it yet. */
const RULE_ALLOW = {
  // judged 2026-08-01
  '.claude/rules/admin-moderation-surface.md': 'judged — SPLIT: 277 -> 161. The two seams with their own file sets left as admin-cross-tenant-escape.md (RLS: reads widen, writes never) and admin-kennzahlen-card.md (lib/status.js + its two generic sweeps). What remains is one surface\'s operator checklist, read together',
  '.claude/rules/add-game-lookup-provider.md': 'judged — the provider CONTRACT plus a per-provider reference table; adding or debugging a provider needs both at once, and per-provider discoveries already split off on their own (psstore-full-game-is-not-every-game, storefront-lookup-locale, provider-cover-*). Five thin files would scatter one lookup',
  '.claude/rules/landing-product-screenshots.md': 'judged — a sequential regeneration procedure, read start to finish when run; whoever runs it opens every piece anyway, so a split adds indirection and no saving',
  '.claude/rules/responsive-content-width.md': 'judged — one learning (width keys off the viewport, never content) whose evidence IS the #332 revert. Drop the evidence and it becomes an assertion nobody can re-derive, which is how #332 shipped the first time',
  '.claude/rules/guest-demo-accounts.md': 'judged — five failure modes of ONE feature, every one reachable from a single edit to lib/demo.js; whoever touches the demo needs all five',
  '.claude/rules/session-guests-are-not-members.md': 'judged — one learning ("a guest is a person without a member row") plus the ~10 sites that assumed otherwise. The enumeration is the rule, not padding around it',
  '.claude/rules/session-teams.md': 'judged — four traps over one feature, 18 lines over; no seam, and each trap is meaningless without the positional wire format in §1',
  '.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md': 'judged — three mechanisms that are only correct TOGETHER (noindex vs Disallow, the SPA fallback, the vacuous assertion); separating them re-creates the trap the file exists to prevent',
  '.claude/rules/bgg-collection-import.md': 'judged — four silent traps plus the placement decisions of ONE import path, from the provider parse through the bulk write to the picker\'s two lists. It sat exactly at 150, #625 pushed it 12 over and #560 took it to ~200 by adding the second shelf (the status in the cache key). The visible seam (provider hops vs. the UI "Smaller things") is a false one: the picker\'s constraints are consequences of the route shape above them (a single list carrying a `present` flag), so a session touching either half needs both open',
  '.claude/rules/active-games-filter-sites.md': 'judged 2026-08-05 — 183 lines, crossed by #560 adding the third game state (wish) and the event asymmetry that comes with it. The file IS an enumeration: its whole value is that every site answering "is this game in the active collection" is in one list, so splitting it by file set is what lets a site be missed. The one visible seam — the #643 taste-stats section, which drops retired games ONLY — is a false one: it is defined BY CONTRAST with the main shape ("reading it as the !retired && !completed shape above is wrong"), so moving it away re-creates the exact confusion it exists to prevent',
  '.claude/rules/expansions-widen-by-union.md': 'recorded 2026-08-06 — 173 lines, crossed by #664 adding the SECOND way an expansion reaches a game (acquiring a wish). A seam is visible: §1–3 are the draw predicate and its two silent traps, scoped to public/js/draw-pool.js, while the rest is the expansion LIFECYCLE (which imports carry them, the two write paths, immutability, redaction) over lib/routes/games.js + the repo pair. Not split here because the halves cite each other in the direction that matters — the acquire carries min/max precisely BECAUSE §2 makes an absent range mean "widens nothing" — so a session that got the acquire wrong would have needed the predicate half open anyway. M-001\'s worklist item',
  '.claude/rules/anchored-popover-is-placed-once.md': 'recorded 2026-08-11 — 198 lines, crossed by #728 measuring the expansion editor and finding this file\'s own claim about it wrong (its 78vh was called safe-by-anchor-luck; it was 96px past the fold, on 51 of one game page\'s 119 scroll positions). A seam IS visible and it is a clean one: §1–2 are "placement is one-shot, re-run it" over public/js/core.js + cover-picker.js, while the cap sections are height arithmetic over public/styles.css — #519/#653 touched only the first, #722/#728 only the second. Not split here because the file is cited by seven other rules that would each need retargeting by hand, and a mid-feature PR is the wrong place to guess which half each citation meant. The added length is the measurement itself, which is what stops the next session re-deriving a wrong number from the old prose. M-001\'s worklist item',
  '.claude/rules/shared-constants-across-the-stack.md': 'recorded 2026-08-03 — 171 lines, crossed by #209 adding the fourth inventory entry and grown again by the fifth (username-policy). A seam IS visible: the last two sections (the licensed TAG_ICONS copy, and the standalone-page design tokens with their PAGES parity test) are about when a COPY is acceptable, over a different file set (kontakt.html, login.html, lib/faq.js, test/standalone-page-brand.test.js) than the require-the-shared-file rule above them. Not split here because the file is cited by a dozen rules and a mid-feature split is the wrong PR for it — this entry is M-001\'s worklist item, not a shrug',
};

const SKILL_ALLOW = {
  '.claude/skills/pick-issue/SKILL.md': 'recorded 2026-07-30 — the ranking loop and its criteria in one file; the audit skills\' SKILL.md + criteria.md split is the obvious shape to follow',
  '.claude/skills/implement/SKILL.md': 'recorded 2026-07-30 — eight sequential phases, read in order',
  '.claude/skills/security-audit/SKILL.md': 'recorded 2026-07-30 — the loop plus the composition rules against /security-review and CodeQL',
};

const CLAUDE_MD_ALLOW = {
  'CLAUDE.md': 'recorded 2026-08-05 — 212 lines against C-015\'s ~200 target. It was recorded at 203 on 2026-07-30 and drifted +9 through #594/#598 without anyone noticing, which the 2026-08-04 claude-file audit found and #635 refreshed. The overshoot is still small and real: every candidate line is a live constraint, so trimming to the number would cost a `why` this file exists to carry — the outcome this budget explicitly does not want. Left as M-001 worklist',
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
