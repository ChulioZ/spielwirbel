---
paths:
  - "public/css/designs/**"
---

# An `:is()` list weighs as its MOST specific member — one long selector raises every entry

Ocean's component layer (`public/css/designs/ocean.css`, #1210) moves every
small display-face user back to Figtree with one grouped rule:

```css
:root[data-design="ocean"] :is(
  .avatar, .chip, .btn, …,
  .podium--single .podium__col--multi .podium__name,   /* (0,3,0) */
  .section :is(h1, h2, h3)
) { font-family: var(--font); }
```

It reads as a list of cheap class selectors. It is not: `:is()` takes the
specificity of its **most specific argument**, whichever element actually
matched, so every entry — `.avatar` included — is weighed as (0,3,0), and the
rule as a whole is **(0,5,0)**.

Found on #1218. The Chronik and Pokale titles are `.section > .section-head >
h1`, and the obvious override for O13's „Die Chronik" in Comfortaa —

```css
:root[data-design="ocean"] .section-head h1 { font-family: var(--font-display); }   /* (0,3,1) */
```

— loses, with no error: the heading stays in Figtree at the small uppercase
label size, which looks like a heading nobody styled rather than like a rule
that lost.

## The rule

**Before overriding anything a design's grouped `:is()` rule names, work out
that rule's specificity from its LONGEST member**, not from the one you are
fighting. Then beat it outright — scope the override by what the section
contains (`.section:has(> .timeline) > .section-head h1` under the gated hook is
(0,6,1)) rather than by source order, which a later slice appending to the same
file can silently reverse.

The inverse holds when you ADD to such a list: appending one long selector
raises the weight of every short one already in it, so a component rule that
used to beat the list by one class can start losing. Keep long compound
selectors out of a grouped `:is()`; give them their own rule.

**Related:** `.claude/rules/state-rules-clobber-component-values.md` and
`.claude/rules/ds-row-is-a-click-target.md` (the same "win on specificity, never
on source order" lesson), `.claude/rules/light-design-gate-and-shared-design-ids.md`
§3 (why that list exists at all).
