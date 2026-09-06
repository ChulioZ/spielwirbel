---
paths:
  - "public/js/locales.js"
  - "lib/demo-seed.js"
  - "test/demo.test.js"
  - "test/i18n-locales.test.js"
  - "test/contact.test.js"
  - "lib/app.js"
---
# A test loop DERIVED from a growing list will outgrow the fixed ceilings around it

`.claude/rules/locale-set-is-data.md` §1 says to derive a test's loop from the
real list rather than restating it, and that is right. What it does not say is
that a derived loop **grows**, while the numbers the test sets around it do not
— so a spec that has passed for five locales can go red on the sixth for a
reason that has nothing to do with the sixth locale.

Measured on #537 (adding Dutch). `test/demo.test.js` loops
`seed.DEMO_LOCALES` and mints a guest demo per locale. Its header already
raises two ceilings on that endpoint, each with a comment explaining the
symptom:

```js
process.env.RATE_LIMIT_MAX = '1000000';
process.env.MAX_LIVE_DEMOS_PER_IP = '1000000';   // "the default per-IP live cap of 3"
```

There is a **third**, and nobody raised it: `DEMO_RATE_LIMIT_MAX`, defaulting to
5 mints per 15 minutes (`lib/app.js`). Five locales fit under it exactly. The
sixth got a `429`, and the failure surfaced four lines later as

```
TypeError: Cannot read properties of undefined (reading 'id')
```

— `list.body[0]` on an empty array, naming neither the limiter, nor the locale,
nor the ceiling. The spec that broke ("the seed is localized, and the visitor
holds the owner seat") is about neither rate limiting nor Dutch.

## The rule

**When you add an entry to a list some test derives a loop from, grep for the
ceilings that loop runs into** — rate limits, quotas, per-IP caps, retry counts,
timeouts, fixture sizes — and check the new length against each. The endpoints
worth checking are the ones with more than one cap, because a header that raises
*two* of three reads as exhaustive.

```bash
grep -rn "process.env.[A-Z_]*MAX\|process.env.[A-Z_]*LIMIT" test/<file>.test.js
grep -rn "RATE_LIMIT_MAX\|_MAX)" lib/app.js
```

The failure has three properties that together make it expensive:

- **It is off by one entry.** It cannot appear until the list reaches the
  ceiling, so it is invisible for every release up to that one.
- **The error names none of the three moving parts.** A polite `429` with a JSON
  body becomes `undefined` at the first property access, which reads as a
  missing fixture or a broken seed.
- **The obvious local fix is wrong.** Nothing about the sixth locale caused it,
  so "what is different about Dutch?" is a question with no answer, and the
  tempting repair — shortening the loop, or hardcoding the five that worked —
  destroys the derivation the loop existed for.

Raise the ceiling in the file's header, next to the ones already raised, and say
in the comment that the loop grows. A spec that deliberately exercises the limit
sets its own value and is unaffected, because `env()` overrides per test.

## The general shape

This is the mirror of the vacuity trap in
`.claude/rules/locale-set-is-data.md` §1. There, a derived loop is **too short
to prove anything**; here, it becomes **too long for its surroundings**. Both
are consequences of the same good decision — derive, don't restate — and both
are invisible at the moment the derivation is written. The check is the same
one in both directions: **ask what the loop's length is, and what breaks at the
next value.**

**Related:** `.claude/rules/locale-set-is-data.md` (the derivation this
qualifies, and the rest of the add-a-language checklist),
`.claude/rules/per-ip-live-caps.md` (`MAX_LIVE_DEMOS_PER_IP`, the second of the
three ceilings), `.claude/rules/security-middleware.md` (the limiters and their
defaults).
