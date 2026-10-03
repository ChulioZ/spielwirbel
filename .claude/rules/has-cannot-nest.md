---
paths:
  - "public/styles.css"
  - "public/css/designs/**"
---

# `:has()` cannot contain `:has()` — the whole rule is dropped, with no error

Forest's phone hub (#1466) sets the Pokale and Chronik previews side by side and
gives every other card in the column the full width. The previews carry no
class of their own (Klassisch's DOM must not change), so the obvious selector
finds each by the section its one link opens, and pairs them by adjacency:

```css
/* WRONG — :has() nested in :has() */
.forest-hub__aside > :has(.hub-card__go[href$="/pokale"]):has(+ :has(.hub-card__go[href$="/chronik"])) { grid-column: auto; }
```

Selectors Level 4 forbids `:has()` inside `:has()`. A selector list with one
invalid selector invalidates the **whole rule**, so its valid sibling selector
went with it: both cards kept spanning the full width, the screen still looked
finished, and nothing in the console said a word. Measured in headless
Chromium: neither selector matched.

## The rule

Never put `:has()` inside `:has()` (including inside a `+`/`~` relative
selector there). Restate the relation from the side that does not need the
nesting — here the Pokale preview implies a played session, so the Chronik
preview always follows it, and

```css
.forest-hub__aside > :has(.hub-card__go[href$="/pokale"]),
.forest-hub__aside > :has(.hub-card__go[href$="/pokale"]) + :has(.hub-card__go[href$="/chronik"]) { grid-column: auto; }
```

says the same with no nesting. `:has()` inside `:not()` and `:is()` is allowed.

**Grouping is the multiplier.** A bad selector alone fails alone; grouped with
good ones it takes them down too. When a grouped rule seems to do nothing at
all, split it and check each member with `document.querySelector(sel)`, which
throws a `SyntaxError` on the invalid one — the stylesheet never will.

## A neighbouring one from the same slice: a % HEIGHT on data needs a definite parent

The Pokale grove draws each trunk from `--share` (`hub-previews.js` writes
`42%`). `height: calc(8px + var(--share) * 0.8)` resolved to nothing, because a
percentage height needs a definite containing-block height and the column has
none. A **padding** percentage resolves against the containing block's WIDTH,
which is definite, so `height: 0; padding-top: calc(8px + var(--share) * 0.8)`
on a fixed-width bar grows the trunk with the data.

**Related:** `.claude/rules/percent-sizes-under-a-shrink-to-fit-flex-item.md`
(the other way a `%` resolves against something you did not mean),
`.claude/rules/is-list-takes-its-most-specific-member.md` (another grouped
selector with a non-obvious whole-rule effect).
