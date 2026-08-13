# Claude-file criteria

- **last-researched:** 2026-07-24
- **cadence:** 30 days
- **last-scoped-pass:** 2026-07-30 — one operator-supplied source (Anthropic's
  "new rules of context engineering for Claude 5-generation models"), which
  yielded C-019 and C-R04. **This deliberately does not advance
  `last-researched`:** a single-source pass is not the broad sweep the cadence
  exists to schedule, and letting it reset the clock would suppress the next full
  pass (due ~2026-08-23) on the strength of one blog post.

Seeded 2026-07-23 from `CLAUDE.md` (the "Capturing learnings" contract),
`.claude/rules/keep-readme-current.md` and
`.claude/rules/token-friendly-source-files.md` — **not** from research.

Scope: `CLAUDE.md`, everything committed under `.claude/` (the rule files, the
skills, `launch.json`), the five root documents — `README.md`, `CONTRIBUTING.md`,
`SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE` — and the community-health files
under `.github/` (`ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md`, `FUNDING.yml`) —
plus, since 2026-08-13, the **end-user product copy**: the `landing.*` keys in
every `public/js/lang/*.js`, the answers in `lib/faq.js`, and the landing
screenshots (C-024). The root docs joined on 2026-07-26 because no other skill
owns them, and the `.github/` files on the same day, when they were created (see
`SKILL.md` → Scope). The product copy is the first **end-user** surface here and
joined for the same reason as the rest: nothing else owns it — `ui-audit` rejects
copy findings by rule, and C-006 covers only the developer-facing documents.

**The premise:** these files are *instructions to future sessions*. A stale one is
worse than a missing one — it actively misdirects, and nothing in CI checks any of
it. So the highest-value criteria here are staleness checks, and they need no
research at all.

---

### C-001 — Every concrete reference resolves
- **Status:** adopted · 2026-07-23
- **Source:** the premise above
- **Check:** Every file path, function name, `const`, env var, route, npm script, table,
  column, migration and test name quoted in `CLAUDE.md`, `README.md` or a `.claude/**`
  file still exists in the code. Mechanically extractable: paths look like
  `lib/…`, `public/js/…`, `test/….js`, `.claude/rules/….md`; identifiers appear in
  backticks. A reference that has been renamed is the common case, not a deleted one.
- **Enforced by:** `test/skills.test.js` (rule/test/doc paths cited by skill files)

### C-002 — Each rule's load-bearing claim is still true
- **Status:** adopted · 2026-07-23
- **Source:** the premise above
- **Check:** Every rule exists to prevent a specific symptom. Spot-check that claim
  against the code, not just that the file it names exists — e.g. does `trackEvent` still
  drop unknown fields, does `storage.remove()` still ignore non-`/uploads/` paths, is the
  860/859 media-query adjacency still there, does `TENANT_METHODS` still exclude the
  moderation methods. A rule whose mechanism was refactored away is the worst case: it
  reads authoritative and describes nothing.
- **Enforced by:** — (manual; many are pinned by their own tests — note which)

### C-003 — Cross-links resolve
- **Status:** adopted · 2026-07-23
- **Source:** `token-friendly-source-files.md`
- **Check:** Every `Related:` pointer and every inline `.claude/rules/<name>.md` mention
  names a file that exists. Rules reference each other heavily; a dangling pointer costs a
  future session a search that returns nothing.
- **Enforced by:** `test/skills.test.js` (skill files) — rule-to-rule links are manual

### C-004 — One learning per rule file, short, and it says *why*
- **Status:** adopted · 2026-07-23
- **Source:** `CLAUDE.md` → "Capturing learnings → `.claude/rules/`"
- **Check:** A rule states what the rule is *and* the symptom or trap it prevents. Flag
  files that have grown into several unrelated learnings (split them), that describe
  *what* the code does without saying why it matters, or that document something already
  obvious from the code.
- **Enforced by:** — (manual)

### C-005 — Nothing contradicts anything
- **Status:** adopted · 2026-07-23
- **Source:** the premise above
- **Check:** Rule against rule, rule against `CLAUDE.md`, skill against rule, and
  `README.md` against all of them. Contradictions arrive by accretion: a decision gets
  reversed in one file and the other keeps the old position (the #332 width revert and the
  #207 co-tenancy reversal are both live examples of the shape).
- **Enforced by:** — (manual)

### C-006 — The user docs reflect the shipped app
- **Status:** adopted · 2026-07-23 (rescoped 2026-07-30)
- **Source:** `keep-readme-current.md`
- **Check:** Features and views, the architecture tree, API routes, npm scripts, env vars,
  Node/runtime requirements, and the skills table. The README drifted wholesale once
  before (it described the pre-redesign app months after the redesign shipped), which is
  why that rule exists. **Since 2026-07-30 this spans four documents, not one** —
  `README.md` (landing page), `docs/features.md`, `docs/architecture.md`,
  `docs/configuration.md` — plus the skills table, which moved into
  `CONTRIBUTING.md`. Check the file the change belongs to, per the routing table in
  `keep-readme-current.md`; a feature documented only in the README's one-liner list
  is as stale as one documented nowhere.
- **Enforced by:** `test/readme-tree.test.js` (the architecture tree, both directions),
  `test/skills.test.js` (cited paths) — prose is manual

### C-020 — The README stays a landing page, not a manual
- **Status:** adopted · 2026-07-30
- **Source:** operator observation, 2026-07-30 ("it currently feels huge to me") ·
  `keep-readme-current.md`
- **Check:** `wc -l README.md` stays at roughly 100–150 (133 after the 2026-07-30
  restructure, down from **985**). Reference material belongs in `docs/`; the README's
  job is to tell a first-time visitor what the app is, show it, get it running, and
  point at the right document. Watch for the specific regression this criterion
  exists for: a section that starts as a summary and accretes back into a full
  reference — the env-var list and the file tree are the two that did it before.
  **Why it needed its own criterion:** C-006 only ever asked whether the README was
  *accurate*, and it always was — every section was correct and several were
  test-pinned — so 985 lines of correct-but-misaimed prose passed audit after audit
  unexamined. Size and audience fit are a separate question from correctness, and
  nothing was asking it. The sibling budgets for the agent-facing files are C-015
  (`CLAUDE.md`), C-021 (rules) and C-023 (skills).
- **Enforced by:** — (manual; the line count is one command)

### C-024 — The product copy reflects the shipped app
- **Status:** adopted · 2026-08-13
- **Source:** the #209 drift that proved the gap ·
  `keep-readme-current.md` → "The PRODUCT copy is a fifth and sixth surface"
- **Check:** The **end-user** copy — the `landing.*` keys in **every**
  `public/js/lang/*.js`, the answers in `lib/faq.js`, and the landing screenshots
  under `public/img/` — still describes the app that `docs/features.md` describes.
  - **The baseline is `docs/features.md`, not a sweep of merged PRs.** C-006
    already keeps that document current against the shipped app, so this check
    reduces to a cheap two-document diff. **It therefore depends on C-006's
    result being trustworthy: run C-006 first**, and if C-006 finds `features.md`
    itself stale, fix that before reading anything into a copy mismatch — the
    baseline, not the copy, is what moved.
  - **Both directions.** Copy describing behaviour the app no longer has (the
    #209 shape), *and* a headline feature `features.md` lists that no copy
    mentions at all.
  - **Every locale, not just German.** Derive the set from
    `public/js/locales.js` — never a hardcoded `['de', 'en']`
    (`.claude/rules/locale-set-is-data.md`). A correction landed in one language
    only is still drift, and `test/i18n-parity.test.js` cannot see it: parity is
    over *keys*, and a stale sentence is a perfectly present key.
  - **Screenshots:** judge whether each still depicts the current UI of the screen
    it claims to show. Cheap proxy before opening a browser — compare each file's
    last-commit date against the last commit touching the view it depicts
    (`public/js/views-regal.js` for the `landing-shelf-*` shots,
    `public/js/views-session.js` for `landing-vote`). **Name
    `.claude/rules/landing-product-screenshots.md` in any such finding** — it
    holds the regeneration procedure, and it is `paths:`-scoped to
    `public/img/**` and friends, so it does **not** load for a session reading
    this file. An unnamed scoped rule is one a session never learns exists
    (C-014), which here means regenerating a shot without the procedure.
  - **Two constraints govern the correction, not just the finding** — both from
    `keep-readme-current.md`, and both easy to get backwards. Copy is **additive,
    not replacing**: a new optional mode goes *beside* the existing story, because
    rewriting the pitch around an opt-in feature quietly restates what the product
    is. And **the hero is usually the wrong place** for a nuance — it is the
    one-sentence pitch; a feature card or an FAQ answer is where the nuance
    belongs. A `lib/faq.js` correction also has to respect that file's own content
    rules (`test/faq.test.js`: never name a device kind).

  **Why it needed its own criterion:** no audit domain checked end-user copy at
  all. C-006 is scoped to the developer/self-hoster documents, `ui-audit` files
  copy under UX and **rejects** such findings by rule (U-R03), and `legal-audit`
  reads the landing page only for legal truthfulness. So the one description a
  *user* actually reads was the single unaudited surface — and it has already
  failed exactly this way: #209 shipped per-device voting, all four C-006
  documents were updated, and the FAQ still answered "a round runs from one
  device" while the landing hero, the voting feature card and step 3 still said
  "one device goes around the table". Nothing went red; the operator caught it by
  asking. `keep-readme-current.md` names both surfaces but is **diff-triggered**,
  so it cannot see drift that has already accumulated — this criterion is the
  recurring sweep behind that per-change discipline.
- **Enforced by:** `test/landing-copy.test.js` (falsifiable claims only — the
  "open source" term, the unlinked source chip, placement),
  `test/landing-shots.test.js` (set parity, dimensions, weight — never content),
  `test/faq.test.js` (content rules, not currency). **Currency itself is manual**,
  the way C-006's prose is — and those three green tests are precisely why this
  drift reads as covered.

### C-007 — Every skill has frontmatter that will actually trigger it
- **Status:** adopted · 2026-07-23
- **Source:** skill-authoring conventions
- **Check:** `name` matches the directory; `description` says both **what it does** and
  **when to use it**, in the words a user would actually type, and names what it is *not*
  for when a sibling skill is the better match. A description that only describes the
  skill's mechanics never fires. Observable (documented 2026-07-24): the combined
  description must stay well under the 1,536-character listing cap, or it is truncated
  in the skill listing and stops triggering.
- **Enforced by:** `test/skills.test.js` (presence, `name`↔directory, non-empty description)

### C-008 — Skills compose rather than overlap
- **Status:** adopted · 2026-07-23
- **Source:** the existing pipeline (`create-issue` → `pick-issue` → `implement` →
  `review-pr`)
- **Check:** Each skill names its handoffs, and no two claim the same trigger space. Two
  skills that both plausibly answer "review this" is a routing failure, not redundancy.
- **Enforced by:** — (manual)

### C-009 — `CLAUDE.md` states the current stage accurately
- **Status:** adopted · 2026-07-23
- **Source:** `CLAUDE.md` header
- **Check:** It asserts time-sensitive facts — production status, which issues shipped,
  which architecture calls were re-examined and when, what is staged behind
  `ACCOUNTS_ENABLED`. Verify each against GitHub and the code. These are the first claims
  a new session reads and the ones most likely to have quietly expired.
- **Enforced by:** — (manual)

### C-010 — `.env.example` matches the env vars the code reads
- **Status:** adopted · 2026-07-23
- **Source:** `no-reading-env-files.md`
- **Check:** Extract `process.env.X` across `lib/`, `lib/routes/`, `scripts/`, `server.js` and
  diff against the (commented-out) entries in `.env.example`. It is the only sanctioned
  description of the app's configuration surface, since the real `.env` is unreadable.
- **Enforced by:** — (manual)

### C-011 — No secret, credential or production data in any committed Claude file
- **Status:** adopted · 2026-07-23
- **Source:** `no-reading-env-files.md`, `no-reading-production-data.md`
- **Check:** No real tokens, connection strings, addresses, e-mails or excerpts of real
  round/member data in `CLAUDE.md`, `README.md` or `.claude/**`. Rules quote code and
  measured numbers — that is fine; they must never quote data.
- **Enforced by:** gitleaks in CI (credentials) — data excerpts are manual

### C-012 — A rule that became wrong is removed, not left standing
- **Status:** adopted · 2026-07-23
- **Source:** `CLAUDE.md` ("update or remove a rule if it becomes wrong")
- **Check:** When C-002 finds a rule whose mechanism is gone, the remedy is deletion or a
  rewrite — never a "note: possibly outdated" line. A hedged rule is unusable: the next
  session cannot tell which half to trust. Historical notes are fine when explicitly
  framed as history (the monthly-window note in `per-tenant-quotas.md` is the model).
- **Enforced by:** — (manual)

### C-013 — Anything that launches the app overrides `DATA_DIR`
- **Status:** adopted · 2026-07-23
- **Source:** `no-reading-production-data.md`
- **Check:** a bare `npm start` (and `launch.json`'s `production-data` config) uses the
  production `data/` folder. So every skill, rule or doc that tells a session to start the
  app for verification must point at the committed `dev-temp-data` config, or otherwise
  override `DATA_DIR` to a temp folder first. A skill that says "run `npm start` and
  screenshot it" is a data-leak instruction. Also check `.claude/launch.json` still holds
  **at least two** configurations: with exactly one, a `preview_start` naming a
  non-existent config silently starts that lone entry instead of failing
  (`no-reading-production-data.md`), so a file reduced to `production-data` alone is a
  live foot-gun.
- **Enforced by:** — (manual)

### C-016 — The root documents state the live instance's actual state
- **Status:** adopted · 2026-07-26
- **Source:** the 2026-07-26 audit · `.claude/rules/ops-only-changes-still-stale-the-docs.md`
- **Check:** Walk the **canonical** instance-state table in
  `.claude/rules/ops-only-changes-still-stale-the-docs.md`, deliberately not
  restated here — it existed in three overlapping copies until 2026-07-30 and one
  of them had drifted. Every row asserts what the
  production deployment *is* — auth mode, whether registration is open, what a change
  reaches. Verify against reality, not against the code (the code supports all four
  auth modes; only the env says which one runs). `SECURITY.md` is the sharpest: it
  calibrates how an external reporter rates a vulnerability, and it claimed
  registration was closed and the data non-public for two days after the go-live.
  Then the three **process** documents that table excludes (they assert process, not
  instance state): check `CONTRIBUTING.md`'s pre-PR checklist names every check that gates a
  merge, that its licensing terms match `LICENSE` + `package.json`, and that
  `CODE_OF_CONDUCT.md`'s enforcement contact is still reachable and still points
  elsewhere for the two things it does not handle (security → the advisory form;
  content inside the hosted app → `docs/legal/notice-and-action.md`).
- **Enforced by:** — (manual, and unmechanizable: the facts are about a remote
  instance no test can observe)

### C-017 — Every finding gets a root cause, and the cause gets fixed
- **Status:** adopted · 2026-07-26
- **Source:** operator instruction, 2026-07-26
- **Check:** For each finding, decide which applies — (a) a rule already covered it
  and was skipped → mechanize it with a test rather than rewording it; (b) no rule
  covered it → write one in the same PR; (c) a rule covered it but its pointer moved
  → fix the pointer and consider whether the class needs writing down. The audit's
  durable output is the cause, not the corrected line: five stale lines fixed without
  causes yields five more next run. Record the cause per finding in the report.
- **Enforced by:** — (manual; `SKILL.md` § "Then ask why each finding was possible")

### C-018 — The `.github/` community-health files match the process they describe
- **Status:** adopted · 2026-07-26
- **Source:** operator instruction, 2026-07-26 (filed with the files themselves)
- **Check:** Four drifts, none of which renders an error:
  (a) `PULL_REQUEST_TEMPLATE.md`'s checklist vs. `CONTRIBUTING.md`'s pre-PR list
  **and** vs. what branch protection actually requires — a template that names a
  retired check, or omits a live one, teaches contributors the wrong gate;
  (b) `ISSUE_TEMPLATE/bug_report.yml`'s storage-backend and auth-mode dropdowns
  vs. the modes the app still has (`.claude/rules/accounts-mode-gate.md`);
  (c) `FUNDING.yml`'s handle vs. the live `donateUrl` from `GET /api/config`;
  (d) `ISSUE_TEMPLATE/config.yml`'s two contact links, which depend on *repo
  settings* rather than on files — private vulnerability reporting still enabled,
  and the Discussions Q&A category still existing at that slug. Check (c) and (d)
  by request, not by reading the file.
- **Enforced by:** `test/skills.test.js` (path existence for cited `.github/`
  paths only — every check above is manual, because each compares a file against
  something outside the repo)

### C-014 — Rule files are scoped deliberately: `paths:` when file-scoped, global when tool-triggered
- **Status:** adopted · 2026-07-24 (operator decision: trial)
- **Source:** official Claude Code memory docs (`paths:` frontmatter, retrieved 2026-07-24)
- **Check:** A rule whose every trap requires reading or editing a specific file set
  carries `paths:` frontmatter scoping it to those files; a rule whose trap surfaces
  through tools or situations (browser pane artifacts, service-worker caching, git/CI,
  deploys, data-directory handling) stays unconditional — a scoped rule that fails to
  load when needed silently loses its protection, so when in doubt, stay global. When
  adding a rule, decide the scope explicitly; when auditing, check that scoped rules'
  globs still match the files their traps live in. **The trial was C-022, concluded
  2026-08-01**: every rule now declares one or the other, and a new rule declaring
  neither fails the suite.
- **Enforced by:** `test/rule-scope.test.js` — that a declaration *exists* (either
  form), that no rule declares both, that a global marker states a reason, and that
  every `paths:` glob still matches a tracked file. **Which** files a rule should name
  is a judgement and stays manual; that the files it names exist is not, and a glob
  gone stale after a rename is the silent failure worth catching (the rule simply
  never loads).

### C-015 — `CLAUDE.md` stays within the documented adherence budget
- **Status:** adopted · 2026-07-24
- **Source:** official Claude Code guidance (target under ~200 lines per CLAUDE.md)
- **Check:** `wc -l CLAUDE.md` stays around or under 200 (171 at adoption, 203 on
  2026-07-30). Growth beyond that is a signal to move content into a scoped rule or a
  skill, not to restructure (C-R03 still holds).
- **Enforced by:** `test/token-budget.test.js` (allowlisted at 203 — the entry has to
  be dropped when the trim happens, so the overshoot cannot be forgotten)

### C-021 — Rule files stay within a size budget, and the corpus is measured
- **Status:** adopted · 2026-07-30
- **Source:** the 2026-07-30 review of what governs token cost · `C-020`'s reasoning,
  applied one directory over · `token-friendly-source-files.md`
- **Check:** Each rule stays around or under **150 lines**; the whole corpus gets a
  measurement each run, so growth is visible rather than cumulative:
  ```bash
  wc -l .claude/rules/*.md | sort -rn | head        # per file
  cat .claude/rules/*.md | wc -c                    # corpus (427 KB / 82 files on 2026-07-30)
  ```
  The remedy for an over-budget rule is the one `C-004` already prescribes — it holds
  several learnings, so split it — or the narrative has outgrown the trap it exists to
  prevent, in which case cut the narrative, never the trap or the *why*.
  **Why it needed its own criterion, and why C-004 was not enough:** C-004 asks whether
  a rule is *correct and single-concern*, never whether it is *affordable*. That is
  exactly the blind spot C-020 was written for after 985 lines of accurate README
  survived audit after audit — the same failure mode, in the files that load far more
  often. Five rules were longer than the entire `CLAUDE.md` budget when this was
  adopted. Note the budget is a **signal, not a ceiling**: a genuinely irreducible
  learning may exceed it, and the allowlist entry is where that gets said out loud.
- **Enforced by:** `test/token-budget.test.js` (the per-file budget + the allowlist;
  the corpus figure is manual)

### C-022 — The `paths:` scoping trial is concluded, not left running
- **Status:** concluded · 2026-08-01 (adopted 2026-07-30)
- **Source:** `C-014`, adopted 2026-07-24 as an explicit **trial** and never closed
- **Outcome:** every rule now declares its scope — **70 scoped, 18 global** — and the
  decision is no longer skippable: a rule with neither declaration fails
  `test/rule-scope.test.js`. The trial had stalled at 9 of 88 for over a month, and
  the reason is worth keeping: a rule with no frontmatter is indistinguishable from a
  rule nobody decided about, so the corpus could not report its own progress. That is
  the defect the marker fixes, not the ratio.
- **Check:** Nothing to re-derive routinely — the test holds the invariant. When
  auditing, spot-check that scoped rules' globs still name the files their traps
  actually live in (the test proves the files *exist*, never that they are the right
  ones), and that nothing has drifted global-by-default under a thin reason.
  C-014's "when in doubt, stay global" is the safety valve and was **not** narrowed:
  the 18 global rules are tool artifacts (the Browser pane), ops facts
  (`TRUST_PROXY`, the DB region), data-handling policy, and disciplines that fire on
  every change (`keep-readme-current`, `token-friendly-source-files`).
  `pwa-service-worker` is the instructive one — it looks file-scoped to `public/sw.js`
  and is deliberately global, because a dozen rules cite it as a *verification*
  situation ("clear the SW first"), so scoping it would drop it exactly when someone
  is checking a `styles.css` change.
- **Enforced by:** `test/rule-scope.test.js` (see C-014)

### C-023 — A `SKILL.md` stays within a size budget; `criteria.md` is exempt
- **Status:** adopted · 2026-07-30
- **Source:** the 2026-07-30 review · `C-015`'s reasoning applied to skills
- **Check:** A `SKILL.md` stays around or under **250 lines** — it is loaded whole on
  invocation, so its length is a per-use cost. The split the audit skills already
  demonstrate (`SKILL.md` = the loop, `criteria.md` = the catalogue) is the remedy;
  `pick-issue/SKILL.md` at 525 lines is the standing candidate. **`criteria.md` files
  are deliberately exempt**: a catalogue of independent entries is the flat-data-table
  case `token-friendly-source-files.md` carves out, and splitting one would only add
  indirection. Lower severity than C-021 — a skill loads on invocation, a rule can load
  on every session — so do not trade a skill's trigger surface or its handoffs (C-007,
  C-R04) for lines.
- **Enforced by:** `test/token-budget.test.js`

### C-019 — An absolute prohibition names the failure mode it prevents
- **Status:** adopted · 2026-07-30
- **Source:** ["The new rules of context engineering for Claude 5-generation models"](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models)
  (Anthropic, retrieved 2026-07-30)
- **Check:** The post's central shift is from rigid constraint to contextual judgment —
  it replaced "default to writing no comments. Never write multi-paragraph docstrings"
  with "match its comment density, naming, and idiom". So: a **never/always** in an
  agent-facing file must be backed by a named symptom, measurement or incident (the
  overwhelming majority here are — a leaked secret, a silent 400, a broken deploy,
  a measured 442 MB of decoded bitmap). A prohibition that only encodes taste gets
  reframed as judgment instead. This is a **regression guard, not a rewrite backlog**:
  `CLAUDE.md`'s Conventions section already opens with "Match the surrounding style",
  and the audit found no taste-only absolutes to convert.
- **Enforced by:** — (manual)

---

## Rejected — settled, do not re-litigate

### C-R01 — "Consolidate the rule files into one document"
- **Status:** rejected · 2026-07-23
- **Why:** Directly contradicts `CLAUDE.md`'s one-learning-per-file contract and
  `token-friendly-source-files.md`. The point of many small files is that a session loads
  only the two it needs; one large file is loaded whole for every change. The count (49)
  is not itself a problem — an unfindable or stale rule is, and C-001/C-002 target that.

### C-R02 — "Adopt harness feature X because it exists"
- **Status:** rejected · 2026-07-23 — **meta-criterion**
- **Why:** A new hook type, agent kind, settings key or output style is a *capability*,
  not a requirement. It becomes a criterion only when it solves a problem this repo
  actually has, and the research phase must name that problem. Otherwise the criteria list
  grows into a feature checklist and every audit reports "not using X" as a violation.

### C-R03 — "Restructure `CLAUDE.md` to a standard template"
- **Status:** rejected · 2026-07-23
- **Why:** Its current shape (stage → architecture calls with their reasoning → i18n →
  conventions → running/verifying → the learnings contract) is load-bearing: the
  architecture section records *why* each call was made and when it was last re-examined,
  which a generic template drops. Reorganise only for a defect that costs a session real
  effort, and say what that defect was.

### C-R04 — "Strip the trigger phrasing / examples from skill descriptions"
- **Status:** rejected · 2026-07-30
- **Why:** The same post removes example-based instruction from tool definitions,
  because examples "constrain them to a certain exploration space". That targets
  **worked examples inside instructions**, not trigger surface: a skill's
  "Use when asked to review a PR…" clause is what makes the skill *fire at all*,
  and C-007 requires it in the words a user would actually type. Deleting those
  clauses would silently stop skills triggering — a routing failure with no error.
  Recorded so a future run reading that post doesn't strip them.
