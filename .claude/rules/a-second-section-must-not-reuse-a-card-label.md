---
paths:
  - "public/js/views-pokale.js"
  - "public/js/views-round*.js"
  - "public/js/views-member.js"
---

# A new section that reuses an existing card's LABEL blinds the guard that selects by it

The Pokale tab's specs find a card by the text it renders:

```js
// test/pokale-retired.test.js
const cardByLabel = (root, label) =>
  [...root.querySelectorAll('.pokale-card')].find(
    (c) => (c.querySelector('.pokale-card__label') || {}).textContent === label
  );
```

`.find()` returns the **first** match, and the tab's central guard subtracted
exactly one card from the screen before asserting the rest:

```js
.filter((c) => c !== cardByLabel(dom.app, dom.run("t('pokale.mostPlayed')")))
```

#800 added a period recap below the Rückblick, reusing `pokale.mostPlayed` and
`pokale.bestRated` for its own two cards — the natural thing to do, since it
renders the same statistic over a narrower window. That put **two cards with one
label** on the screen, and the subtraction removed only the first. Here the test
went red, which was luck: the second card happened to name the retired game the
guard is about. The general form is the dangerous one — a second card under a
label the guard *excludes* is silently never checked, and `cardByLabel` in every
other spec quietly starts answering about whichever of the two is earlier in the
DOM.

## The rule

**Two cards on one screen may not carry the same label.** That is a UI
requirement before it is a testing one: a reader scrolling past „Bestbewertet ·
Codenames Ø 4,5" and then „Bestbewertet · Just One Ø 4,8" has no way to tell that
the first is July and the second is all time, and reads it as a bug.

So a second section gets **its own keys**, and they carry the scope that
distinguishes them:

```js
'periodRecap.mostPlayed': 'Meistgespielt · {period}',
'periodRecap.bestRated':  'Bestbewertet · {period}',
```

A middot rather than a preposition, deliberately: „im Juli 2026" and „in 2026"
need different German, so a single `{period}` template with a preposition is
ungrammatical for one of the two. The separator is grammar-free in all five
locales and is already the app's idiom (`recap.divisiveSub`, the Chronik meta
line).

Note the same model uses the **short** labels on the shared PNG (`recap-card.js`
reads `pokale.mostPlayed`): there the period is the headline, so repeating it in
every row label would be noise. One statistic, two labels, chosen by whether
anything else on the surface competes with it.

## Widening such a guard has to stay falsifiable

The fix to the guard is a *list* of the labels that may name a retired game, and
a list is a place a future card can be hidden by adding a line. Two properties
keep that honest, and both are cheap:

```js
assert.equal(labelled.length, 2, 'both record cards must be on screen, …');
```

- **Assert the count of subtracted cards**, so an entry that matches nothing (a
  typo, a renamed key) fails instead of quietly widening the exclusion to zero.
- **Assert the new section's own TASTE card by name**, in its own spec. Without
  that, adding a label to the record list would be a way to make the guard stop
  looking at the new section entirely.

**Related:** `.claude/rules/active-games-filter-sites.md` (what the guard is
guarding — the record-vs-taste split it enforces),
`.claude/rules/testing-views-under-jsdom.md` (the harness, and its own
"scope a selector to the screen" trap, which is this one seen from the other
side: there a selector reaches a *different* screen's element, here a
*sibling section's*),
`.claude/rules/source-scanning-guards-enumerate-shapes.md` (the same failure
one layer down — a guard whose reach is narrower than it reads).
