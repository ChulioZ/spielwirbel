---
name: audit
description: >-
  Run the full audit sweep — accessibility, legal, security, UI, Claude-file,
  and code-maturity — in one pass and merge the results into a single ranked
  report with one approval step. Use when asked to audit the app/project/repo
  generally, for a health check or compliance sweep, before a release or before
  opening public registration, or when more than one of the six domains is
  wanted. For a single domain, invoke accessibility-audit, legal-audit,
  security-audit, ui-audit, claude-file-audit or code-maturity-audit directly.
---

# Full audit

A thin orchestrator over the six domain audits. It exists so the user reviews
**one** ranked list and approves **one** batch of issues, instead of six of each.

It adds no criteria of its own. Every judgement lives in the domain skills and
`audit-loop.md`; this file only decides what runs where, and how the results
merge.

## Run order — the two browser audits cannot run in parallel

The split is driven by one hard constraint: **there is one Browser pane per
session**, and two audits drive it.

- **`legal-audit`, `security-audit`, `claude-file-audit` and
  `code-maturity-audit` run as four parallel subagents.** They are independent,
  read-only sweeps over largely disjoint file sets — exactly the case parallel
  subagents are for. Launch all four in a single message. (`security-audit` may
  itself invoke the built-in `/security-review` and `npm audit`; that stays
  inside its own subagent.)
- **`accessibility-audit` and `ui-audit` run in the main agent, one after the
  other — never as subagents, and never at the same time as each other.** Both
  drive the Browser pane and both need the seeded `dev-temp-data` instance, so a
  subagent (or a concurrent sibling) would contend for the same tabs and preview
  server. Run them **sequentially**, sharing the one preview session: bring up
  `dev-temp-data` once, do the accessibility pass, then the UI pass (or vice
  versa), then tear the preview down once at the end.

Start the four subagents first. Then, while they work, do the two browser passes
yourself back-to-back on the shared preview. Collect the subagents' reports when
they land.

Four seams to attribute correctly:
- `security-audit` and `accessibility-audit` both touch tenant isolation from
  different angles (RLS/gate enforcement vs. the auth-screen UI); `security-audit`
  overlaps `claude-file-audit` on the CI-tooling and env-file rules.
- **`code-maturity-audit` and `security-audit` both read hand-rolled
  auth/limiter/token code** — attribution by remedy owner: an *exploitable
  weakness* is security's even when a library swap would also fix it; *fragile
  or unmaintainable but not exploitable* is maturity's. `code-maturity-audit`
  also borders `claude-file-audit`: a stale document about code is
  claude-file's, the code itself is maturity's.
- **`ui-audit` and `accessibility-audit` both look at the visual UI** — the
  cleanest split in the set: anything about contrast, focus, target size, ARIA,
  keyboard or reduced-motion *compliance* is accessibility's (A-001..A-016);
  everything else visual — colour harmony, spacing, depth, type, consistency,
  polish — is UI's. A change that would trade one for the other (a prettier but
  lower-contrast treatment) is a **rejected** UI idea, not a finding.
- **Copy currency is `claude-file-audit`'s (C-024), not `ui-audit`'s.** `ui-audit`
  files copy under UX and rejects such findings outright (U-R03), so without this
  attribution a landing/FAQ sentence that no longer describes the app is dropped
  on the floor by every domain — which is how #209's per-device voting shipped
  with the FAQ still answering "a round runs from one device".

Attribute every shared finding to the domain that owns the *remedy*.

## Briefing the subagents

Each subagent starts cold, so brief it completely the first time — a re-brief
costs another full context load. Each brief must carry:

- The skill to invoke (`legal-audit` / `security-audit` / `claude-file-audit` /
  `code-maturity-audit`) and that it must read
  `.claude/skills/audit/audit-loop.md` and its own `criteria.md` first.
- Whether research is in scope this run (pass `--research` through, or say
  "cadence decides").
- **Report only — file nothing, open no PR, change no file.** The merge, the
  approval and every write happen here. A subagent that files issues on its own
  defeats the single-approval design.
- The report shape from `audit-loop.md` §F: criterion id, evidence, severity,
  cheapest correct remedy.

## Merging

1. **Dedupe across domains.** The six overlap by design at a few seams — the
   EAA/BFSG applicability question is recorded in both `accessibility-audit`
   (A-R05, deferred) and `legal-audit`; a stale reference in a rule about
   accessibility belongs to `claude-file-audit`; a tenant-isolation gap is
   `security-audit`'s even if `accessibility-audit` walked past the auth screen;
   hand-rolled security-relevant code splits by remedy owner (exploitable →
   `security-audit`, fragile-but-not-exploitable → `code-maturity-audit`);
   and `ui-audit`/`accessibility-audit` both see the visual UI — the visual defect
   is UI's, the contrast/focus/target/ARIA defect is accessibility's (see the run
   order). One finding, one entry, attributed to the domain that owns the remedy.
2. **Rank across domains, not within them.** A confirmed exploitable security hole
   or a legal blocker outranks an accessibility or UI polish item. Severity is the
   sort key; domain is a column. A `security-audit` blocker is surfaced immediately,
   not held for the merge (its own skill says so). UI findings are almost always
   polish-tier — that is expected, not a reason to inflate them.
3. **Group by remedy**, because that is how the work actually gets done: the
   tidy-up PR, the new assertions, the issues. Several small `claude-file-audit`
   findings usually collapse into one PR.
4. **Keep the legal reading list separate.** It is for the user's judgement, never
   mixed into the findings and never turned into an issue on your initiative.

## Approval and follow-through

One pass, at the end:

- Present the merged report and recommend which findings should become issues.
  Dedupe against open **and** closed issues first (`audit-loop.md` §G) — the
  backlog is small and deliberately curated.
- File only what the user picks, through `create-issue`, labelled `audit`
  (security findings also get a `security` label, UI findings a `ui` label). A live
  dependency advisory from `security-audit` routes to the `dependabot` skill, not a
  fresh issue. A UI polish batch is usually best taken straight as one `implement`
  PR rather than filed.
- Criteria changes from any research pass ship as **separate** PRs, one per domain,
  through `implement` — never folded together and never mixed with a findings fix.
- Tidy-up fixes ship as their own PR, also through `implement`.

## Reporting back

One summary: which domains ran, which did a research pass and which skipped on
cadence, the finding count by severity and domain, any confirmed exploitable hole
called out first, what became issues (with numbers), what became PRs, what was
dropped and why, and — separately — the legal reading list and the UI
before/after evidence. Confirm the browser scaffolding is cleaned up (the shared
`dev-temp-data` preview stopped, audit dataset deleted; `.claude/launch.json`
should be **unmodified** — its `dev-temp-data` entry is permanent).
