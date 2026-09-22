---
paths:
  - "public/css/designs/**"
  - "public/styles.css"
  - "test/game-detail-hero.test.js"
  - "test/a11y-contrast.test.js"
  - "test/support/theme.js"
---

# An overlay that changes MATERIAL must re-point `--good`/`--warn`/`--danger` too

Der Tisch's sheets, dialogs, popovers and menus are **paper**, where its page is
walnut. #1188 wrote that as one block, and the block reads complete:

```css
:root[data-design="tisch"][data-scheme="dark"] .sheet, … {
  --surface: var(--paper);
  --control-fill: var(--paper-raised);
  --ink: var(--paper-ink);
  --ink-soft: var(--paper-ink-soft);
  --control-edge: var(--paper-edge);
  --placeholder: var(--paper-faint);
}
```

Six tokens, every one of them a ground or an ink, nothing obviously missing. But
`--good`, `--warn` and `--danger` are **inks too**, and they are not in the list —
so they keep the values tuned against the dark page and land on cream:

| token | on walnut (tuned) | on the sheet's paper |
|---|---|---|
| `--warn` `#e8c168` | 6.79:1 | **1.55:1** |
| `--danger` `#f59c86` | — | **1.90:1** |

Found on #1190 through the one line the issue happened to name — „steht schon im
Regal", the duplicate hint in the add-game sheet, which is the warning that
exists to be read *before* you add a game twice, and which was invisible.

## Why it is the natural mistake, and stays invisible

- **The list looks exhaustive because it is organised by MATERIAL, not by role.**
  Surface, control fill, ink, soft ink, edge, placeholder — that is the whole
  vocabulary of a *ground*. Status colours are a different axis, so nothing in
  the block's shape suggests they belong to it.
- **A design's own contrast sweep cannot see it.** `test/a11y-contrast.test.js`
  resolves a token against **that design's page**, which is what makes it able to
  answer "what colour is this, here" at all. `--warn` on walnut is 6.79:1 and
  correct. The failing combination is one of the design's tokens over *another of
  its own surfaces*, which is not a row in any sweep — the same blind spot
  `.claude/rules/design-colour-blocks-are-scheme-gated.md` records one layer up.
- **Nothing renders wrong.** The text is there, the layout is right, the element
  has a colour. It is simply the wrong one, and only a measurement says so.

## The rule

**When a rule re-declares `--surface` for a subtree, ask which INKS are now
standing on a ground they were not tuned for** — not just the ones already in the
block. `--good`, `--warn` and `--danger` are the three that get forgotten,
because they are named for a meaning rather than for a material.

Give each a value from the design's own package rather than inventing one; the
stylesheet's header rule applies here as anywhere ("a value that is not in T1
does not belong in this file"). And check what the package says the token IS:
Der Tisch's warn `#e8c168` is listed as a **fill carrying dark ink**, never as a
text colour — the same rule review finding A1 states for gold — so a design may
legitimately answer "this token is not text here" instead of supplying a paper
twin.

Until the trio is re-pointed, a rule painting one of them on the overlay's ground
must name a token that was measured *there*: `--paper-faint` for Der Tisch, which
is review finding A4's own corrected value.

## The guard hole beside it: TWO registries, one sweep

`test/game-detail-hero.test.js` derives the game-detail cover wash's safe opacity
across every design — and it looped `DESIGNS` (`round-designs.js`, what a ROUND
wears) only. Since #1184 an **account** wears a design out of a *second*
registry, and Der Tisch is the first of those to declare its own `--surface`
(#1188). So the sweep reported four designs while the page could render a fifth.

Measured on #1190 the way `.claude/rules/break-the-code-on-purpose.md` prescribes:
with Tisch's `--ink-soft` darkened on purpose, the **pre-#1190 loop stayed fully
green (11/11)** and the widened one went red naming `tisch`. The hole was real,
and a green run could never have shown it.

Nothing was actually wrong on Der Tisch — walnut takes the binding *white* cover
at 4.78:1, better than any light design — but the shipped 0.16 was derived when
`--surface` was white and a cover could only **darken** it. On a dark design it
can only lighten, so the argument had inverted while the number happened to hold.

**So: a sweep over "every design" has to say which registry it means.** The two
coexist deliberately until the flip (#1202) and will until every round loses its
world, so this is not a transient. When you touch one of these loops, spread both
lists into it and assert the second is non-empty — an empty filter is the failure
this section is about, wearing a green tick.

**Related:** `.claude/rules/design-colour-blocks-are-scheme-gated.md` (the
voice/colour split, and why a rule reading a gated token is gated as hard as the
token), `.claude/rules/design-stylesheets-are-shell-assets.md` (why every colour
must live in the resolved root block at all),
`.claude/rules/theme-derived-colors.md` (`--gold-ink`'s version of the same
question: an ink for a fill that does not flip),
`.claude/rules/break-the-code-on-purpose.md` (the measurement above).
