---
paths:
  - "public/css/designs/**"
  - "public/styles.css"
---

# A `grid-area: <name>` on a REUSED class invents tracks in any grid that lacks the name

#1213 placed Ocean's vote-card columns with named areas:

```css
@media (min-width: 1100px) {
  :root[data-design="ocean"]… .ocean-deep { grid-area: deep; }
}
```

#1214 reused `.ocean-deep` — same markup, same look — inside the live vote's
roster, a one-track grid that defines no area called `deep`. The browser does not
ignore the unknown name: it **creates implicit lines** for it, so the roster went
from one column to `0px 161px 307px`, the block landed in the third, and every
row's name column collapsed to 0px (rows 96–187px tall instead of 74).

## Why nothing caught it

- **It only fires at the width where the other screen's media query applies.**
  The phone lobby was fine; only ≥1100px broke.
- **No test can see it.** jsdom applies no stylesheet, and the CSS-text specs
  assert the rules each slice *wrote* — neither slice's rules are wrong alone.
- **The DOM is healthy.** Every element is present and correctly nested; only
  `getComputedStyle(grid).gridTemplateColumns` shows the extra tracks.

## The rule

When you reuse a class that some other rule places with a **named** `grid-area`
(or `grid-row`/`grid-column` by name), reset it in the new host:

```css
… .live-vote--ocean .ocean-deep { grid-area: auto; }
```

And when a new layout's track count looks wrong, read
`gridTemplateColumns` on the **container** before debugging the children — an
unexpected track count is the tell, and it points straight at a named area.

`test/ocean-shared-vote.test.js` pins the reset for this instance. The general
case stays a discipline, because the leak comes from a rule in a *different*
section of the sheet than the one you are editing.

**Related:** `.claude/rules/absolutely-positioned-components-escape-a-new-host.md`
(the same family — a component's placement rule following it into a host it was
never written for), `.claude/rules/cssrules-walk-is-blind-under-nesting.md` (the
CSSOM walk that found which rule matched).
