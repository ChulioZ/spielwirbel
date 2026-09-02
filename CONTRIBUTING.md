# Contributing

Thanks for your interest in improving this project. Contributions are welcome —
please read this file first, especially the **[Contribution licensing](#contribution-licensing)**
section, because opening a pull request means agreeing to those terms.

Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Where to start

Issues labelled
**[`good first issue`](https://github.com/ChulioZ/spielwirbel/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)**
are the ones scoped small enough to land without a tour of the whole codebase.
If nothing there appeals, anything in the
[open backlog](https://github.com/ChulioZ/spielwirbel/issues) is fair game —
comment on the issue first so two people don't build the same thing.

## How to contribute

This repository is built and maintained with
[Claude Code](https://claude.com/claude-code), and it ships the workflow with it:
**skills** in `.claude/skills/` and **rules** in `.claude/rules/` that encode how
work gets done here. Whether you contribute by prompting Claude Code or by hand,
that is the intended path — start there rather than improvising.
`CLAUDE.md` states the constraints you must work within.

One of those constraints is enforced rather than written down: `.claude/settings.json`
registers a `PreToolUse` hook that **blocks** agent reads of the production data
(`data/data.json`, `data/uploads/`) and of local `.env` files, which hold private
user data and live secrets. If a command of yours is denied, that is the hook and it
is deliberate — the message names the rule and the supported alternative. It affects
agent tool calls only; nothing stops you opening those files yourself.

In short, before opening a PR:

- Branch off an up-to-date `main` (never commit on `main`); use a descriptive
  name like `feat/session-export` or `fix/vote-tie`.
- Read `CLAUDE.md` and skim the relevant `.claude/rules/` for the area you touch.
- Add or update tests for testable changes, and add any new user-facing string to
  **every** `public/js/lang/*.js` file (key parity is enforced by a test).
- Make `npm test`, `npm run lint`, `npm run check:syntax` and
  `npm run coverage:ci` all pass. The coverage one is easy to forget and it
  **gates the merge**: CI's required `ci-passed` check fails if line coverage
  drops below the floor, even with every test green.
- Update the docs in the same PR when the change adds or renames a user-facing
  feature ([`docs/features.md`](docs/features.md)), alters the file tree
  ([`docs/architecture.md`](docs/architecture.md) — a test enforces this one), or
  changes routes, scripts or env vars
  ([`docs/configuration.md`](docs/configuration.md)). See
  `.claude/rules/keep-readme-current.md`.

### Before you start

- Run `node scripts/seed-dev.js` once. A fresh clone starts empty, so without it
  you would verify UI changes against a blank app; it fills a throwaway
  `.devdata/` (never the real `data/`, which it refuses) with a demo round and a
  local login. Details in
  [`docs/configuration.md`](docs/configuration.md#a-filled-local-dev-instance).
- Read `CLAUDE.md` — it states the current stage, the architecture you must work
  within (no frontend build step, no framework, no ORM; German UI, English code),
  and the production-readiness mindset that applies to new work.
- Skim `.claude/rules/` — one short file per hard-won gotcha (frontend script load
  order, the shared-global-scope lint setup, theme-derived colours, why you must
  never read the production `data/` folder, …). When you touch an area a rule
  covers, follow it. Found a new gotcha? Add a rule file for it.

### The skill workflow

The skills chain into a backlog-to-merge pipeline. Invoke a skill in Claude Code
by name (e.g. `/implement`), or just describe the task and let the matching skill
trigger. Each is self-contained and enforces this repo's constraints.

| Skill | What it does |
| --- | --- |
| **`create-issue`** | Interviews you and files a GitHub issue specific enough to implement without follow-up questions, grounded in this repo's architecture. |
| **`pick-issue`** | Surveys open issues, Dependabot PRs and human PRs, and hands the best next one to the right builder skill. An open non-draft human PR is picked first — only a security exposure or broken core functionality outranks it — so contributors get feedback fast; everything else is ranked by value-for-effort. |
| **`implement`** | Takes a change end-to-end: branch from up-to-date `main`, write the code **plus tests**, review locally, open a PR, review it, and merge only if it's safe — then watch `main`'s CI and clean up. |
| **`review-pr`** | Reviews a pull request (human or bot) against this repo's constraints and returns a `SAFE TO MERGE` / `NOT SAFE` verdict with concrete blockers. |
| **`dependabot`** | Triages open Dependabot PRs, merging what passes review and commenting on what doesn't. |
| **`test-data`** | Creates isolated, throwaway data in a temp `DATA_DIR` for tests or manual runs — the safe alternative to ever touching the real `data/`. |
| **`audit`** | Runs the full audit sweep — accessibility, legal, security, UI, Claude-file, and code-maturity — in one pass, merges the results into one ranked report, and files issues only with your approval. |
| **`accessibility-audit`** | Audits the running UI against a maintained WCAG-based criteria list (drives the app in a browser over generated data), and periodically refreshes the criteria from current standards. |
| **`legal-audit`** | Checks the privacy policy, Impressum, Nutzungsbedingungen and `docs/legal/` records against what the code actually does, and surfaces recent legal developments as a sourced reading list (never adopting a legal duty on its own). |
| **`security-audit`** | Audits the security surface — auth, tenant isolation/RLS, transport/CSRF/cookies, injection/SSRF, uploads, secrets and CI tooling — against a maintained criteria list; composes with the built-in `/security-review` and CodeQL rather than duplicating them. |
| **`ui-audit`** | Judges the app's *visual* design — colour, layout, spacing, type, depth, iconography, motion polish — in a browser and drives it toward beautiful-and-characterful within the brand. Plain UI only (not UX, not accessibility). |
| **`claude-file-audit`** | Audits the repo's own documentation — `CLAUDE.md`, `README.md`, the root docs (`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE`), the `.github/` community files, everything under `.claude/` and the end-user product copy (the landing text, the in-app FAQ, the landing screenshots) — for staleness, dangling references and contradictions, and refreshes its criteria from current harness capabilities. |
| **`code-maturity-audit`** | Audits the codebase's production maturity — structure smells, hand-rolled code that should become a mature dependency, single-process in-memory-state assumptions, and test-suite maturity — continuing the build-vs-buy ledger that produced the Knex/pino/zod/JWT adoptions. |

A typical flow: **`create-issue`** to capture the work → **`pick-issue`** to
choose what's next → **`implement`** to ship it (it calls `review-pr` before
merging). If a pull request is open, though, `pick-issue` sends you to
**`review-pr`** instead — an unanswered PR outranks the backlog, because the wait
is the only cost that grows while you build something else. For dependency bumps,
**`dependabot`** handles the batch. The six **`*-audit`** skills (and the
**`audit`** umbrella) run a research → self-critique → audit loop over
accessibility, legal, security, UI, code maturity and the repo's own Claude
files; each keeps its criteria in a versioned `criteria.md` that changes only via
a reviewable PR.

## Translations

The UI ships German, English, Spanish, French and Italian. **Correcting a translation is a one-line
change**: find the key in `public/js/lang/<code>.js`, fix the wording, open a PR.
Nothing else needs touching — the key already exists in every other language, and
`npm test` checks that the files stay in key parity.

**Adding a language** is a little more — mostly data, plus one capture run:

1. Add a row to `public/js/locales.js` — the code (two letters, so the browser's
   system language matches it), the name in that language, and its BCP-47 tag.
2. Copy `public/js/lang/en.js` to `public/js/lang/<code>.js` and translate the
   values. Keep every key; the parity test will tell you if one is missing.
3. Register the file in `public/index.html` (next to the other `lang/` scripts),
   add it to `SHELL` in `public/sw.js`, and bump that file's `CACHE` version.
4. Shoot the three landing-page screenshots for the new language. Add a seed
   (round name, tag names, invented game titles) to `SEEDS` in
   `scripts/capture-landing-shots.js`, run it, and add the `LANDING_SHOTS` entry
   in `public/js/views-landing.js`. This step is **not** optional: the suite goes
   red until every shipped language has its own set, because otherwise the page
   explaining the app would show it in somebody else's language.
5. Optionally add the language to `DEMO_TEXT`/`DEMO_TAGS` in `lib/demo-seed.js`,
   so the guest demo's round is in it too. Without this it falls back to English.

Plural forms, date and month formatting and the language picker all follow from
step 1 — there is no code to change. Translate the product vocabulary
consistently rather than literally, keep the brand name **Spielwirbel**
untranslated, and note that the legal pages (Impressum, privacy policy, terms)
are deliberately German-authoritative with an English courtesy translation and
are **not** part of the UI language files.

Native speakers are very welcome to correct wording — machine-drafted phrasing
that is merely *correct* is exactly what we would like replaced with phrasing
that sounds natural.

## Contribution licensing

This is the important part. The project is **distributed** under the
[PolyForm Noncommercial License 1.0.0](LICENSE) (© 2026 Julian Zenker, the sole
rights holder and licensor). That outbound license is deliberately noncommercial.

To keep the project able to offer a commercial tier in the future without having
to track down past contributors, **inbound contributions are licensed under a
permissive license, not under PolyForm-NC**. Concretely:

> By submitting a contribution (a pull request, patch, or any change) to this
> repository, you license your contribution to the project maintainer under the
> **[Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0)**.

You keep the copyright to your contribution — this is a license grant, not an
assignment. The permissive Apache-2.0 grant lets the maintainer distribute your
contribution as part of the project under PolyForm-NC today and under commercial
terms later, which a plain "inbound = same as outbound" arrangement would block
(it would leave the maintainer with only a noncommercial license to your work).

If you cannot agree to this — for example because your employer owns your work
and has not authorized the grant — please do not open a pull request; reach out
to the maintainer first instead.

## Developer Certificate of Origin (sign-off)

Every commit must be **signed off** to certify you have the right to submit it
under the terms above. Add the sign-off automatically with:

```bash
git commit -s        # appends a "Signed-off-by: Your Name <email>" trailer
```

The `Signed-off-by` line certifies your agreement with the **Developer
Certificate of Origin 1.1** (below, also at <https://developercertificate.org/>):

```
Developer Certificate of Origin
Version 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

Sign off with a stable identity and a **reachable email** — your real name or a
consistent GitHub username is both fine; the email must be one that actually
reaches you and that matches the commit's author. Anonymous or throwaway-identity
contributions aren't accepted. (The DCO certifies your right to submit, not a
legal name, which is why a username is enough.) That's it — thanks for
contributing.
