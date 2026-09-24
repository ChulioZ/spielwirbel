---
paths:
  - "public/css/designs/**"
  - "public/styles.css"
  - "test/game-detail-hero.test.js"
  - "test/a11y-contrast.test.js"
  - "test/support/theme.js"
---

# An overlay that changes MATERIAL strands every token it did not list

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

**#1195 re-pointed the trio**, the way this section prescribes: `--good` and
`--danger` at T1's deep partners (`--paper-good`, `--paper-danger`), and `--warn`
at `--paper-faint` rather than a twin, because T1 says warn is not text. It found
five more on the way — `--accent`, `--sunken(-soft)`, `--line`, the brand tints
and `--brand-edge` — every one of them a `:root` mix of `--page-bg` or `--surface`,
i.e. substituted against the walnut and inherited into the sheet as a finished
colour. So the guard is DERIVED now: `test/tisch-overlays.test.js` lists every
`:root` token whose value reads `var(--page-bg)` or `var(--surface)` and requires
the overlay to re-point each. A new token of that shape fails there by name; the
status trio, which is NOT derived from the page, keeps its own explicit test.

## The second one: what a STICKY descendant paints from (#1193)

The same block, the same shape, one axis further out. `.sheet__head` and
`.sheet__actions` are `position: sticky`, so each needs an **opaque** backdrop
for the sheet's content to scroll under — and both take it from `--page-bg`:

```css
.sheet__head, .sheet__actions { background: var(--page-bg); }   /* styles.css */
```

`--page-bg` is an inline custom property on `<html>` carrying the design's PAGE
colour, and the overlay block did not re-point it. So both bars painted
**walnut on top of the paper**, wearing the paper ink the block sets three lines
above: the design chooser's own „Wähl dir ein Design." measured **1.08:1**, in
every sheet in the app, from #1188 until #1193.

It is a harder miss than the status trio, because `--page-bg` is not a token of
the subtree at all — it is the *page's*, and re-pointing the page inside a sheet
reads like a category error until you notice who consumes it. The same six other
consumers (a timeline dot, the dial's hub, a marker's ring, two fade-to-page
bars) all want the overlay's ground for the same reason.

**So widen the question: not "which of MY tokens are now on the wrong ground",
but "which properties do my DESCENDANTS paint from".** An opaque backdrop on a
sticky bar is the common case, and it is invisible precisely because the bar is
correct — it is doing exactly what a sticky bar must.

`test/tisch-konto.test.js` derives this rather than pinning the property name: it
reads whatever `.sheet__head`/`.sheet__actions` paint from in `styles.css` and
requires the overlay to answer for each. Rename `--page-bg`, or give one bar a
different source, and the test follows.

## The third one: a token that is BOTH a fill and an ink (#1260)

`--brand` is the active chip's fill (stays brass) *and* ~70 rules' text colour
(brass on paper, ~2:1), so it cannot be re-pointed. Split the use: text sites read
`var(--brand-ink, var(--brand(-strong)))`, only the overlay declares `--brand-ink`,
never a `:root` alias (`.claude/rules/root-alias-custom-property-is-substituted-once.md`);
`test/tisch-brand-ink.test.js` sweeps every `color` and fails naming the rule.

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
