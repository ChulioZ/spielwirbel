---
paths:
  - "test/**"
  - "public/styles.css"
---

# A whole-sheet rule lookup answers with the `@media` RESET when the rule is deleted

`rulesOf()` in `test/support/css.js` sees **through** `@media` wrappers on
purpose — the query is brace-free, so it never matches as a selector — and its
comment says so. That is exactly right for *"where does this rule live"* and
exactly wrong for *"does this rule EXIST"*, because a sheet's media blocks are
full of **grouped resets naming the very selectors an existence test looks up**.

`public/styles.css` has one at the end of the worlds section:

```css
@media (prefers-contrast: more) {
  [data-world] body::before,
  [data-world] .empty::before,
  [data-world] .hero::before,
  [data-world] .podium::before,
  … { display: none; }
}
```

So `test/round-worlds.test.js`'s `slotBody('[data-world] .podium::before')` — a
lookup for *any* rule naming that selector in its group — finds the **reset**.
Measured on #1083: deleting the podium floor's whole 20-line block left

```
✔ the nine slots exist, and every ornament is a pseudo-element that takes no clicks
```

green, while the two tests that read the floor's *properties* went red. Four of
that file's nine slot selectors appear in the contrast block, so four of its nine
existence assertions could not see a deletion at all.

## Why it is worse than it looks

The reset **satisfies every generic assertion in the same test**: it is a
pseudo-element selector, it is grouped, and `pointer-events`/`content` checks are
skipped for it because its body has no `content:`. So the ornament loop simply
walks past. Nothing errors, nothing counts down, and the anti-vacuous floors
(`rules.length >= N`) still pass because the reset is itself a rule.

And the direction is the dangerous one: a test whose whole job is to notice a
deleted ornament, not noticing.

## The rule

**Look up a rule's EXISTENCE in `topLevel()`, not in `CSS`.** It returns the
sheet with every top-level `@media` block cut out (nested blocks go with their
parent), so only unconditional rules can answer:

```js
const slotBody = (sel) => (rulesOf(topLevel()).find(…) || [])[1] || null;
```

Use the whole sheet when you want to find a rule wherever it lives, and
`mediaBlocks()` when the enclosing block is the thing under test. The failure
above comes from using the first where you meant the third.

The generalisation: **a lookup that accepts any match cannot be an existence
check when the sheet legitimately names the same selector twice.** Same family
as `.claude/rules/source-scanning-guards-enumerate-shapes.md` — there the scan
matched too little, here it matches something *else* — and the only thing that
surfaces either is deleting the subject on purpose and reading the test NAMES
that go red (`.claude/rules/break-the-code-on-purpose.md`).

**Related:** `.claude/rules/css-text-assertions-strip-comments.md` (the other two
traps in reading this sheet as text, and where `topLevel()` lives),
`.claude/rules/assert-the-decision-not-its-ingredients.md` (`resolvedDeclaration`,
which faces the mirror-image problem — several rules matching, and needing the
one that WINS).
