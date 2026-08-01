# Check whether a change warrants a user-docs update — and WHICH file

<!-- scope: global — a review-phase discipline for every change -->

<!-- scope: global — a review-phase discipline for every change -->

The user-facing description of the app is spread over four documents since
2026-07-30, when `README.md` became a ~130-line landing page and its reference
material moved into `docs/`. **Most of what used to be a "README update" is now a
`docs/` update**, and the file to touch depends on the change:

| The change | Update |
|---|---|
| adds, removes or renames a user-facing feature or view | `docs/features.md` (+ the one-liner list in `README.md` if it is a headline feature) |
| changes the file/folder structure | `docs/architecture.md`'s tree — **enforced by `test/readme-tree.test.js`** |
| changes a backend/frontend design decision, a seam, a dependency | `docs/architecture.md` prose |
| adds/changes an env var, npm script, route, Docker or deploy detail | `docs/configuration.md` (and `.env.example`) |
| changes the Node floor, the quick start, or what the app *is* | `README.md` |

**Rule:** whenever you implement a change (in particular in the `implement`
skill's review phase, before committing), explicitly ask: *does this change make
any of those four stale?* Update it in the same branch/PR.

Pure refactors, styling tweaks, and test-only changes usually don't need it —
but make the check consciously rather than skipping it.

**Why:** by July 2026 the README still described the pre-redesign app (no hub
tabs, no durations, no player ranges, no Pokale/Chronik/archive, an outdated
file tree) and had to be rewritten wholesale. A one-line check per PR prevents
that wholesale drift.

**Why the split happened, so it isn't undone:** the README had grown to **985
lines** — a self-hosting manual and an architecture tour fused onto a project
README, against a convention of roughly 100–300. It was audience drift, not
sloppiness: every section was accurate (several tests pin it), and the audit
criteria only ever asked whether it was *correct*, never whether a first-time
visitor could read it. Don't move reference material back up into the README to
make it "complete"; the landing page's job is to get someone to the right
document, and criterion C-020 now guards its size.
