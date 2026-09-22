---
paths:
  - "public/css/designs/**"
  - "public/js/design.js"
  - "public/js/round-theme.js"
  - "test/support/theme.js"
---

# A design's COLOUR block must be gated on its scheme — a round still owns the page

Der Tisch (#1188) is the first design to override derived tokens in its own
stylesheet: walnut `--surface`, paper `--ink`, its own gold family. Written the
obvious way — one `:root[data-design="tisch"]` block holding everything — it
puts **light ink on a light page** the moment you open a round.

## Why, and it is not the design's fault

Until the flip (#1202) a round keeps its own palette, and `applyBackground()`
writes that palette's two colours **inline on `<html>`**, where they outrank
every stylesheet. It also calls `setScheme()` with the **round's** scheme, not
the user's. So inside a round on a light palette:

| | value | from |
|---|---|---|
| `--page-bg` | `#eaf1ea` | the round, inline |
| `--brand` | `#397a4b` | the round, inline |
| `data-scheme` | *absent* (light) | the round |
| `data-design` | `tisch` | **still the user's** |

`:root[data-design="tisch"]` matches regardless, so `--ink` stayed the paper
`#f6ecd8` over that near-white page, and `--on-accent` stayed near-black over
the round's dark green accent. Measured in a browser on a seeded demo round.

## Nothing could have caught it

`test/a11y-contrast.test.js` resolves a design's tokens **against that design's
own page**, by construction — that is what makes it able to answer "what colour
is this, on this design" at all. The combination that fails is one design's
tokens over *another's* page, which is not a design in the registry and so is
not a row in any sweep. Every check was green.

## The rule

Split the stylesheet in two:

```css
/* VOICE — unconditional. Fonts and radii are what make a screen read as this
   design even where its colours do not apply. */
:root[data-design="tisch"] { --font: …; --radius-md: 4px; }

/* COLOURS — gated on the scheme they were designed for. */
:root[data-design="tisch"][data-scheme="dark"] { --surface: #4a3423; … }
```

In a light round the colour block simply does not match, and the round's palette
resolves exactly as it does under Klassisch — the documented transition
behaviour, *a round's design wins while it is applied*. Outside a round
`setScheme(null)` falls back to the user design, so the block applies.

## It binds a COMPONENT RULE just as hard, and #1188 shipped five ungated

The split above is about the token *block*, and reading it as being only about
tokens is the natural mistake: #1188 gated its colours correctly and left its
own component rules on the bare hook — `.cover-ph`, `.tafel`, the active chip on
felt and the four-selector overlay rule. Corrected in #1189.

A rule that READS a gated token is in exactly the same position as the token,
because in a light round the block does not match and the token does not exist:

```css
:root[data-design="tisch"] .tafel { background: …var(--felt)…; }   /* WRONG */
```

`background` is then invalid and falls back. The sharp case is the overlay,
where the value being invalid propagates: `--surface: var(--paper)` makes
`--surface` invalid **at computed-value time**, so every descendant reading it
falls back to `unset` — a sheet with transparent fills, on a light round, under
a dark design. Nothing errors and the markup is correct.

**So gate the rule, not just the token** — and note what stays ungated for a
reason: a rule that names no token at all. Der Tisch's 24px-target fix (review
finding A7) is pure geometry and belongs to the voice, like the fonts and radii.

`test/tisch-hub-lobby.test.js` derives this rather than listing it — every token
the design declares only inside its gated block, against every rule that reads
one — so a design added tomorrow is covered without anyone editing a list.

## A design's decoration must not take a pseudo-element the app already owns

Found the same day, and it is the neighbouring trap rather than this one.
`:is(.theme-card, .round-card)[data-world]::before` is the **world motif's**
slot on a lobby tile, at `opacity: .14; z-index: -1`. A felt table drawn on
`.round-card::before` therefore came out 14% transparent and behind the card —
on world rounds only, i.e. two of four tiles, which reads as a data problem.

Both `::before` and `::after` on the app's cards are spoken for (`::after` is
the world's corner glyph). Draw on a **real element** instead: the lobby table
is `.round-card__emblem`, which already *is* the round's colour mark. And when
you do, remember that a positioned box paints after in-flow content — the
emblem covered the round's name until it took `z-index: -1` under an
`isolation: isolate` on the card.

**The voice/colour split is the useful half**, and it is worth keeping after
#1202 retires round designs: it is the thing that answers "what still belongs to
this design when someone else owns the page".

**What the gate does NOT cover** is a *dark* round design under a dark user
design — there the block matches and its tokens meet that world's page. That one
is legible by construction rather than by luck (every world page is darker than
Nussbaum and every Tisch ink is light, so each pair can only measure higher),
which is the argument to re-make rather than to assume for the next design.

## The resolver has to read both blocks

`test/support/theme.js` reads the design sheet in the browser's own order:
the scheme-qualified block, then the unconditional one, then `styles.css`'s dark
block, then `:root`. A resolver that looked up only the bare selector would find
the fonts and **silently fall through to Klassisch for every colour** — the
plausible-empty-answer shape in
`.claude/rules/cssrules-walk-is-blind-under-nesting.md`. It asserts that at
least one of the two blocks exists, so a moved hook fails loudly.

**Related:** `.claude/rules/design-stylesheets-are-shell-assets.md` (the file's
two cache traps, and the "no colours here" rule this supersedes),
`.claude/rules/dark-designs-and-the-on-accent-flip.md` (why `--on-accent` is a
property of the FILL, not of the ground — an overlay that flips the scheme on a
subtree must not re-point it),
`.claude/rules/routed-screens-apply-the-round-design.md` (the call that puts the
round's palette on `<html>` in the first place).
