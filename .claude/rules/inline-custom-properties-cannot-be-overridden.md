---
paths:
  - "public/css/designs/**"
  - "public/styles.css"
  - "public/js/views-*.js"
  - "public/js/round-theme.js"
  - "public/js/game-stats.js"
---

# An inline CUSTOM PROPERTY is exactly as unoverridable as an inline `background`

The app's established fix for "a design must be able to repaint this" is the
`--sc`/`--pct` mechanism from #1040: move the colour off the element and into a
custom property, and let CSS do the paint.

```js
// before — a design can never repaint this
b.style.background = avgColor(n);
// after — CSS decides, the value is just data
b.style.setProperty('--sc', avgColor(n));
```

That is correct, and it is only *half* the mechanism. The half nobody states is
that **the design still cannot override `--sc` itself**: an inline declaration
wins over any stylesheet rule for the **same property**, and a custom property
is a property. So this is a no-op:

```css
/* tisch.css — reads as the obvious spelling, does nothing at all */
.bar-col[data-stop="3"] { --sc: var(--bar-3); }
```

The design's rule loses to the element's own `style="--sc:…"`, every time.

## Why it is expensive

It fails in the direction that looks like success. The element still gets a
colour — the app's own — so the screen renders correctly *by the old design's
standards*, with no error, no warning, and every test green. The design's
tokens sit declared, contrast-measured and never painted. Measured on #1191:
five bar rungs and six score-pill rungs, all wired, all inert, found only by
reading `getComputedStyle` in a browser.

And the CSSOM confirms the rule is *matching*, which makes it worse: the
selector is right, the cascade is right, the rule simply loses on the one axis
nobody thinks to check.

## The shape that works: a SECOND name, read in front of the first

```css
/* styles.css — the default is still the continuous ramp */
.trow__bars .bar { background: var(--sc-fill, var(--sc)); }
```
```css
/* tisch.css — the design sets a property nothing writes inline */
.bar-col[data-stop="3"] { --sc-fill: var(--bar-3); }
```

The inline `--sc` stays the fallback, so a design that says nothing renders
byte-for-byte as before; a design that speaks sets `--sc-fill` and wins because
no element carries that name inline.

**The rule of thumb:** a property written inline is *data*. A property a
stylesheet may override must be one **no JS ever writes**. Keep the two names
apart, and say in a comment which is which — the pair reads like a typo
otherwise, and the next reader "simplifies" it back.

`test/tisch-session.test.js` guards the design half: no `[data-stop]` rule may
set `--sc`. Nothing can guard the styles.css half, because a missing
`var(--x-fill, …)` fallback simply restores today's behaviour.

## The same trap one layer along: which ELEMENT carries the property

`--sc-fill` is set on the bar's **column** and read on the bar and its axis
glyph, which works because custom properties inherit. That is the thing to
check when a value resolves correctly on an ancestor and still paints wrong:
read the property on the element that *uses* it, not on the one that sets it.

**Related:** `.claude/rules/design-stylesheets-are-shell-assets.md` (why a
design's colours must be tokens at all),
`.claude/rules/design-colour-blocks-are-scheme-gated.md`,
`.claude/rules/z-index-negative-pseudo-paints-over-its-own-background.md` (the
other way a correct-looking design override was covered up in the same slice).
