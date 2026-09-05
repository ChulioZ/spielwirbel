# Never trust a test you have not seen fail — take the red first, or break the code for it

<!-- scope: global — a verification discipline that fires whenever a test is written, so no file set could trigger it -->

A green test proves only that it ran. It may assert nothing, assert it
vacuously, or not be wired to the thing its name claims to guard — and all three
look identical from a passing suite. **You need to have watched it red**, for the
reason you think.

There are two ways to get that red. They are not equally cheap, and they do not
prove the same thing.

## Route 1 — test-first, whenever the behaviour does not exist yet

Write the test before the code, watch it fail, then make it pass. The red is
**free**: no backup, no deliberate break, no restore. Prefer this always when it
is available:

- a new feature or endpoint;
- a **bug fix** — write the test that reproduces the bug, watch it fail, then
  fix. This is strictly better than fixing first and adding a test after, which
  is the shape that produces most vacuous assertions here.

If the test is **green before you have written anything**, stop: it is matching
something else. That is the loudest signal in this file and it costs nothing.

## Route 2 — break the working code on purpose

When the behaviour already works, back the files up to the scratchpad, break one
thing, watch one named test go red, restore. Needed when Route 1 is unavailable
(below) or when the red you need is not "the feature is absent".

## What the two reds actually prove — this decides which you need

**A test-first red distinguishes ABSENT from PRESENT. A break-on-purpose red
distinguishes CORRECT from SUBTLY WRONG.** Different discriminations, and every
escape this repo has actually shipped was the second kind:

- **A fixture too small to fail.** A one-person-team fixture goes red before the
  resolver exists and green after — Route 1 fully satisfied. The bug it missed
  was a *later* ordering break inside working code, which that fixture could not
  see (`.claude/rules/session-teams.md` §4).
- **The backend that was green either way.** Test-first on
  `if (!ipHash) return 0;` reddens and greens cleanly on the JSON backend. The
  finding was that **Postgres stays green with the line deleted** — 104/104 —
  because its own semantics make the guard redundant there. No red phase reaches
  that (`.claude/rules/per-ip-live-caps.md` §2).
- **The assertion that was merely weaker.** "Did the asset 200?" passes against a
  rate-limit skip that only made assets *cheaper*. Route 1's red — no skip at
  all — is satisfied by that weak form too; only substituting the naive extension
  regex discriminates (`.claude/rules/security-middleware.md`).

So: Route 1 for behaviour you are adding, Route 2 to prove an assertion is
*discriminating* rather than merely *present*.

## Where Route 1 is not available at all

- **Text-matching assertions** — CSS strings, regexes over files. The
  stylesheet already exists; you are adding a guard to it
  (`.claude/rules/css-text-assertions-strip-comments.md`,
  `.claude/rules/responsive-hub-tabs.md`). Note this shrank in #602: a view's
  **rendered HTML** is no longer in this bucket, because
  `.claude/rules/testing-views-under-jsdom.md` lets a spec run the view and
  assert the DOM. CSS stays here — jsdom applies no external stylesheet.
- **Tests over a corpus that already exists** — `test/rule-scope.test.js`,
  `test/token-budget.test.js`, `test/skills.test.js`.
- **Characterization tests** added to code that shipped long ago.
- **Security and isolation controls**, where an assertion that passes against a
  deliberately-broken control is worse than none: it converts "untested" into
  "tested and fine" (`.claude/rules/admin-cross-tenant-escape.md` §4).

## The habits

**1. Confirm the red is red for your reason** — on both routes. `grep -c` for the
thing you removed before reading a green suite as evidence: a `perl` pattern that
guessed the wrong indentation once reported success while changing nothing, and
the "verification" that followed was of untouched code
(`.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md` §3). The same trap
bites `node --test` pointed at a non-existent path
(`.claude/rules/session-guests-are-not-members.md`), and a Route-1 red caused by a
typo in the test file.

**2. Name the failing test — don't count failures.** Found doing exactly this in
#598: a probe that counted `✖` lines reported "3 failures" for every one of five
different breaks, so it could not distinguish the assertion under test from three
unrelated ones collapsing. Assert on the test *name*, and aim each break at
exactly one.

**3. Back the files up to the scratchpad first — never `git checkout`** (Route 2
only). It restores from the *index*, so with nothing staged it silently discards
the whole uncommitted change along with the break. That cost a full
re-implementation of #424's three source files
(`.claude/rules/css-text-assertions-strip-comments.md`).

## The worked example that argues for Route 1

`test/seo.test.js` matched two hero strings that **also** live in `<title>` and
`<meta description>`, so it stayed green with the static landing hero deleted
outright — against precisely the regression it existed to catch
(`.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md` §3).

The instructive part: the test and the hero shipped in the **same commit**
(#511), so Route 1 was available — and the head strings predated it (#430/#436),
so a test-first author would have seen that assertion **green before writing the
hero at all**. Route 2 eventually caught it. Route 1 would have caught it first,
for free.

## A test that SETS the state it asserts cannot see a wrong default

Module-level state (`let contactAvailable = false` in `public/js/report-link.js`)
has a default, and the default is usually the safe one — closed, off, empty. The
natural test opens by establishing the state it is about to check:

```js
setContactAvailable(false);                       // ← blinds the test
assert.equal(feedReportUrl({ username: 'ada' }), null);
```

That asserts the **setter**, never the default. Found on #559 by flipping the
default to `true` and watching the suite stay green: the feed's report button
would have rendered on an instance whose contact channel is unconfigured — the
one state the gate exists to prevent — with a named test claiming to guard it.

**So one test per defaulted flag must touch nothing**, and it has to run before
any sibling mutates the shared module state:

```js
// MUST be first in the file, and must NOT call the setter.
test('the gate is closed until /api/config opens it', () => { … });
```

Note Route 1 does not reach this either: test-first, the assertion goes red
because the *module* does not exist yet, which is satisfied just as well by the
blinded version. Only the deliberate break discriminates.

The server-side sibling is a default no fixture can even *express* — every
account is created carrying every key, so an absent-key default reads the same
whichever way it is written:
`.claude/rules/defaulted-account-fields-need-a-legacy-shape-spec.md`.

## History

This lived in `.claude/rules/admin-cross-tenant-escape.md` §4 by accident — it was
first written up for an RLS policy — until #599 gave it its own file. Twelve files
cite the discipline and **not one of the eight citing rules is about databases**,
which is why it could not stay filed under an RLS heading once `paths:` scoping
made that heading decide who gets to read it.

**Related:** `.claude/rules/assert-the-decision-not-its-ingredients.md` (a spec
that re-derives the decision from its ingredients instead of calling it — green
for months over a live bug),
`.claude/rules/source-scanning-guards-enumerate-shapes.md` (adding a
key to a source scan proves nothing about the new call site — #838's vacuous
green), `.claude/rules/bgg-corpus.md` (a real captured fixture can still be
green against the break), `.claude/rules/automated-tests.md` (the suite itself),
`.claude/rules/admin-cross-tenant-escape.md` §4 (the RLS instance this came from,
where breaking `redactText` onto `atx()` left all but one assertion green).
