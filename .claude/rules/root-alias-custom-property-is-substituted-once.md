---
paths:
  - "public/styles.css"
  - "public/css/designs/**"
  - "public/js/views-home.js"
  - "test/tisch-brand-ink.test.js"
---

# A `:root { --alias: var(--x) }` is substituted ONCE — it does not follow a local `--x`

The obvious way to give a token a second name that a subtree can re-point is an
alias at the root:

```css
:root { --brand-ink: var(--brand); }        /* WRONG for --brand */
.label { color: var(--brand-ink); }
```

It reads as "`--brand-ink` means `--brand` unless overridden". It does not. A
custom property's `var()` is resolved **on the element that declares it**, and
descendants inherit the *finished colour*. So any element that re-declares
`--brand` locally still gets the page's brand through the alias.

That element exists: `views-home.js` writes `style="--brand:…"` on a world
design's round card, so the card's „geteilt" label (`.round-card__shared`) would
have switched from the card's own accent to the page's — a Klassisch change, in
a PR whose one promise was "Klassisch renders identically". Found on #1260 by
grepping for every place `--brand` is *set*, before writing the alias; measured
in the pane on Klassisch, a card carrying `--brand:#1f6f8b` painted its label
`#1f6f8b` with the fallback form and `#c2410c` (the page's brand) with the alias.

## The rule

**When you introduce a re-pointable second name for a token, write it as a
FALLBACK at the use site, not as an alias at the root:**

```css
.label { color: var(--brand-ink, var(--brand)); }   /* declared only where it differs */
```

Undeclared, the fallback resolves on the element itself, exactly like the old
`var(--brand)` — so the change is inert everywhere the new name is not set, by
construction rather than by an audit of every local override.

Before choosing the alias form anyway, grep for where the aliased token is
**written** (`--brand:` in CSS, `setProperty('--brand'` and `--brand:${` in JS).
A token only ever set on `<html>` is safe to alias; one set on any other element
is not.

`test/tisch-brand-ink.test.js` pins it: nothing outside the Tisch overlay rule
may declare `--brand-ink` (measured — adding the `:root` alias turns that test
red by name).

The same substitution is why Der Tisch's overlay has to re-point `--line`,
`--sunken` and the brand tints at all: they are `:root` mixes of the page, and
inherit into the sheet as walnut
(`.claude/rules/overlay-surface-flip-strands-the-status-tokens.md`).
