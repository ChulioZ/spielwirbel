# Check whether a change warrants a user-docs update — and WHICH file

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

## The PRODUCT copy is a fifth and sixth surface — and it was missing here

Every row above points at a document for a **developer or self-hoster**. The same
features are also described to **end users**, in two places that no row named and
that no test can check:

| The change | Also update |
|---|---|
| changes how a user-facing feature *works*, in a way an existing answer describes | `lib/faq.js` — **both languages**, and mind its content rules (`test/faq.test.js` bans naming a device kind: say "Gerät"/"device", never "Handy"/"phone") |
| adds or changes a feature the pitch describes | the `landing.*` keys in **every** `public/js/lang/*.js` (hero, feature cards, the three steps) |

**Why this row exists.** #209 added per-device voting and the four documents above
were all updated — while `lib/faq.js` still answered "a round runs from one
device", and the landing page still said "one device goes around the table" in
the hero, the voting feature card and step 3. Nothing prompted it: the rule
enumerated four files, `test/readme-tree.test.js` mechanically covers only the
architecture tree, and the product copy is the one description a *user* actually
reads. It was caught by the operator asking, which is exactly the failure mode
`.claude/rules/keep-legal-docs-current.md` was written up for.

**Two constraints when you do update them**, both of which are easy to get
backwards:

- **Additive, not replacing.** The copy describes the model the app is *for*. A
  new optional mode belongs beside the existing story, not on top of it —
  rewriting the hero around an opt-in feature quietly restates what the product
  is. #209's own scope constraint said so; the same reasoning applies to any
  feature that only some rounds will use.
- **The hero is usually the wrong place.** It is the one-sentence pitch; a
  feature card or an FAQ answer is where a nuance belongs.

**Rule:** whenever you implement a change (in particular in the `implement`
skill's review phase, before committing), explicitly ask: *does this change make
any of those six stale?* Update it in the same branch/PR.

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
