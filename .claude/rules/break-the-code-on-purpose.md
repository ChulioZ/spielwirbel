# A test you have never seen red is not evidence — break the code on purpose

<!-- scope: global — a verification discipline that fires whenever a test is written, so no file set could trigger it -->

**Break the production code on purpose once and watch the probe fail.** Until you
have, a green test proves only that it ran. It may assert nothing, assert it
vacuously, or not be wired to the thing its name claims to guard — and all three
look identical from a passing suite.

This lived in `.claude/rules/admin-cross-tenant-escape.md` §4 by accident of
history (it was first written up for an RLS policy) until #599 gave it its own
file. Twelve files cite the discipline, and **not one of the eight citing rules
is about databases** — which is why it could not stay filed under an RLS heading
once `paths:` scoping made that heading decide who gets to read it.

## The four habits, each learned the hard way

**1. Confirm the break actually landed.** `grep -c` for the thing you removed
before reading a green suite as evidence. A `perl` pattern that guessed the wrong
indentation once reported success while changing nothing, and the "verification"
that followed was of untouched code
(`.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md` §3). The same trap
bites `node --test` pointed at a non-existent path
(`.claude/rules/session-guests-are-not-members.md`).

**2. Back the files up to the scratchpad first — never `git checkout`.** It
restores from the *index*, so with nothing staged it silently discards the whole
uncommitted change along with the break. That cost a full re-implementation of
#424's three source files
(`.claude/rules/css-text-assertions-strip-comments.md`).

**3. Name the failing test — don't count failures.** Found doing exactly this in
#598: a probe that counted `✖` lines reported "3 failures" for every one of five
different breaks, so it could not distinguish the assertion under test from three
unrelated ones collapsing. Assert on the test *name*.

**4. Judge each break against exactly one assertion.** A break that reddens the
whole file tells you the suite noticed *something*; a break that reddens exactly
one named test tells you which assertion is wired to which line.

## Worked examples — what a vacuous green actually looks like

- **The assertion that passed against the deleted feature.** `test/seo.test.js`
  matched two hero strings that also live in `<title>` and `<meta description>`,
  so it stayed green with the static landing hero deleted outright — against
  precisely the regression it existed to catch
  (`.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md` §3).
- **The fixture too small to fail.** A one-person team passed against a broken
  team resolver; only a two-team fixture exposed it, and the break-on-purpose loop
  found that, not review (`.claude/rules/session-teams.md` §4).
- **The backend that was green either way.** Deleting a load-bearing
  `if (!ipHash) return 0;` guard reddens the contract suite on JSON and leaves
  Postgres **104/104 passing**. A green Postgres run is therefore not evidence
  that line does anything (`.claude/rules/per-ip-live-caps.md` §2).
- **The text match that bound to the wrong rule.** A CSS regex spanning a comment
  latched onto a neighbouring selector, so the test passed against a stylesheet
  where the guarded rule had been removed
  (`.claude/rules/css-text-assertions-strip-comments.md`).

## Where it matters most

Any test that matches source **text** — CSS strings, HTML, regexes over files —
has no other signal that it is wired to anything real, so this is not optional
there (`.claude/rules/css-text-assertions-strip-comments.md`,
`.claude/rules/responsive-hub-tabs.md`). The same holds for a **security or
isolation** control: an assertion that passes against a deliberately-broken
control is worse than none, because it converts "untested" into "tested and
fine". And for a test whose two outcomes answer with the **same status code** —
two rate limiters both returning `429 { error: 'rate_limited' }` — where the
green is indistinguishable from the limiter never having been mounted
(`.claude/rules/bounding-bulk-registration-mail.md`).

**Related:** `.claude/rules/admin-cross-tenant-escape.md` §4 (the RLS instance
this was extracted from, and the plain-role probes it is about),
`.claude/rules/automated-tests.md` (the suite itself).
