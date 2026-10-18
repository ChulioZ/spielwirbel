# A new spec can OVERWRITE an existing one, and the suite stays green

<!-- scope: global — fires whenever a new test/*.test.js file is created, whatever it covers -->

`lib/` and `public/js/` hold several modules with the **same basename** and
nothing to do with each other:

| basename | `lib/` | `public/js/` |
|---|---|---|
| `cover.js` | the uploaded-cover re-encoder (#867) | the no-cover placeholder renderer |
| `avatar.js` / `avatar-policy.js` | the profile-picture re-encoder (#841) | the policy constants + `member-avatar.js` |
| `tag-icons.js` | the server copy | the frontend copy |

`lib/` and `lib/routes/` collide too: `session-import.js` is the pure translator
in one and the router in the other (#1665).

So "name the spec after the module" produces a **collision**, and the collision
is silent in both directions:

- Writing `test/cover.test.js` for `lib/cover.js` **overwrites** the existing
  `test/cover.test.js` for `public/js/cover.js`.
- `node --test` discovers files by glob, so the eight tests that vanished are
  not reported as skipped, removed, or missing. `npm test` goes green, the total
  moves by a number nobody tracks, and `coverage:ci` stays over the floor
  because the replacement file covers something.

Caught during #867 only because `git status` listed `test/cover.test.js` as
**modified** where a new file should have read `??`. Nothing else would have.

## The rule

**Name a spec after what it covers, not after the module's basename**, whenever
that basename is not unique across `lib/` and `public/js/` — `cover-encode`,
not `cover`. Check before writing:

```bash
ls test/<name>.test.js 2>/dev/null && echo "TAKEN — pick another name"
```

And **read `git status` after creating any test file.** A new spec must appear
as `??`. An `M` on a path you believe you just created means you replaced
someone else's file, and it is the only signal you will get.

## The same collision eats a BREAK SWEEP'S BACKUP

`cp lib/session-import.js lib/routes/session-import.js $BAK/` keeps ONE file —
the second copy overwrites the first — and the restore after the next break
then writes the router over the translator. Measured on #1665: the suite went
red with `Cannot find module '../validate'`, i.e. the router's own relative
require, resolved from the wrong directory. Back up into a mirrored tree
(`mkdir -p "$BAK/lib/routes"` and copy each file to its own path under it), never flat.

## Why the usual guards do not catch it

Every check in this repo answers "does the code work?", and after an overwrite
the code still works — what is gone is the *questioning* of it. This is the
`.claude/rules/break-the-code-on-purpose.md` family seen from the other side:
there, a test that cannot fail; here, a test that no longer runs. Both present
as a green suite, and neither is visible in one.

`test/token-budget.test.js` and `test/rule-scope.test.js` do not help either —
they check files that exist, never files that stopped existing.

**Related:** `.claude/rules/break-the-code-on-purpose.md`,
`.claude/rules/automated-tests.md` (the suite and its per-file process model),
`.claude/rules/token-friendly-source-files.md` (the sibling trap for *source*
moves — a rename that leaves a rule pointing at the wrong file).
