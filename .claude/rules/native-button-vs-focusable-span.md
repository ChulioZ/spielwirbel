---
paths:
  - "public/js/views-round-detail.js"
  - "public/js/core.js"
  - "public/styles.css"
  - "test/editor-presentation.test.js"
---
# Make a click target a real `<button>` — except when it is inline text that wraps (#424)

Four controls on the game-detail screen were click-only `<span>`/`<div>`s until
#424: the cover, the title, the players chip and each tag chip. Tab skipped all
four, so a keyboard user could not change a game's cover, title, player range or
tags **at all** — and every automated check was green, because the DOM was built
correctly and only the *element type* was wrong.

The default fix is a real `<button type="button">`: focusability, Enter **and**
Space, and focus restoration all come from the platform, which is the direction
`.claude/rules/in-app-nav-links.md` already took for links (those became real
`<a href>` and dropped their hand-rolled `role="button"` + `tabindex` +
Enter/Space). Three of the four are buttons now.

## The exception: an atomic inline-block cannot wrap mid-line

The title stayed a `<span role="button" tabindex="0">` with an explicit
Enter/Space handler, and this is the part worth remembering. A `<button>` is an
**atomic inline-level box**: its own text wraps *inside* it, but the box itself
never breaks across lines, and its shrink-to-fit width becomes the whole line
once the text is longer than the space available. Anything inline that follows it
is pushed to the next line.

Measured at 375px on "Die Legenden von Andor: Die letzte Hoffnung", with the
players chip following the title inside the `<h1>`:

| Title element | Line boxes | Chip sits |
|---|---|---|
| `<span>` (shipped) | 2 (341.9px + 194.6px) | **beside the last line** (Δtop 12px) |
| `<button>` (rejected) | 1 atomic box of 279.3px | **on its own line** (Δtop 37px) |

`.gd-title` carries `box-decoration-break: clone` precisely because it wraps —
that declaration is the tell. So: **if the element is inline text that shares a
line with other inline content, it cannot become a button.** Don't try
`display: inline` on the button either; engines do not reliably let a button's
box break across lines.

When you do take the span route, both halves are needed and each is silently
useless alone: `tabindex="0"` (a control nobody can reach) and a keydown handler
for Enter **and** Space with `preventDefault()` on Space (or the page scrolls
under the editor). `role="button"` is what makes a screen reader announce that
Enter does something — a bare focusable span announces only its text.

## Un-button-ing an existing component: reset only what the component doesn't own

The chips and the cover kept their exact look (verified 0px delta, below). What
that needed, and the two traps:

- **Never the `font` shorthand.** `.tag` declares `font-size: var(--text-sm)`
  (14px — it was a literal 13px until the #470 type scale) and
  `font-weight: 700`; `.gd-img` declares `font-size: 64px` for the cover
  placeholder glyph — one of the literals #470 deliberately did **not** put on
  the scale, because it sizes a glyph inside a fixed box rather than naming a
  hierarchy level. A `font: inherit` in the editable variant's rule ties on
  specificity and, being later in the file, wins — so the chips render at the
  `<h1>`'s 26px and the cover's glyph shrinks. Use `font-family: inherit` alone
  (what `.link-btn` and `.tag-act` have always done here).
- **`line-height: inherit` is not cosmetic.** A button's UA `line-height: normal`
  is ~4px shorter than the inherited `1.5` a span gets inside the `<h1>`, so the
  pill silently loses height. With it, the box measures identically.
- **`text-align: inherit`** on any button holding non-centred content — the UA
  centres a button's text, which shifted the cover's bottom-left overlay label.
- **`color`/`background` were deliberately NOT reset**: `.tag--players`,
  `.tag--custom` and `.tag--empty` all declare their own, and a `color: inherit`
  in `.tag--edit` would beat them on source order.
- **The border reset is scoped `:not()`, on purpose.** `.tag--empty` declares
  `border: 1px dashed`; an unscoped `.tag--edit { border: 0 }` ties with it at
  (0,1,0) and the winner is decided by which block sits later in the file.
  `.tag--edit:not(.tag--empty) { border: 0 }` makes them stop competing —
  the same "win on specificity, never on source order" lesson as
  `.claude/rules/label-rows-lose-to-field-label.md`.

## Popover focus restoration had to be added (core.js)

A sheet restores focus to its opener via `trapFocus` (#145), but `openPopover`
had no equivalent — so on desktop, closing an editor dropped focus to `<body>`.
`closePopover` now restores it, with two details: `openPopover` captures
`document.activeElement` **before** its own replace-`closePopover()` (otherwise
it captures the *previous* popover's opener), and the restore is skipped unless
focus is still inside the popover (or nowhere), so a user who has already clicked
into another control doesn't get it yanked back. Both halves are pinned in
`test/editor-presentation.test.js`.

## Proving "visually unchanged": clone the old element type and diff the rects

The cheap, decisive check for this class of change — no screenshot comparison, no
stashing the branch. The old markup differed from the new *only* in the tag name
(`makeEditableTag` already added `tag--edit` to the span), so:

```js
const span = document.createElement('span');
span.className = btn.className; span.innerHTML = btn.innerHTML;
btn.after(span);
// diff getBoundingClientRect() + the computed font/color/background/padding/border/display
span.remove();
```

All four chip variants and the cover came out at **0px** width and height delta
with every computed property matching. Do this before believing a "looks the
same" screenshot.

## Two more ways the Browser pane lies

Same family as `.claude/rules/preview-pane-paint-artifacts.md`, both cost time here:

- **A CSS transition's computed value can stay pinned at its start value.** The
  cover's `.gd-img--edit:focus-visible .gd-img__edit { opacity: 1 }` reported
  `opacity: 0` for as long as you care to wait, with
  `document.getAnimations()` showing `CSSTransition:opacity:running` forever —
  the pane's animation timeline does not advance. That reads exactly like a
  non-matching selector. **Inject `transition: none !important` and re-read**; if
  the value jumps to its target, the rule is fine and the pane was the problem.
- **`el.focus()` matches `:focus-visible` only while keyboard modality is
  active.** `.claude/rules/accessibility-contrast-and-modals.md` says a
  programmatic focus doesn't set it — true, but the useful corollary is that
  **one real `Tab` keypress switches Chrome into keyboard modality and then every
  subsequent programmatic `.focus()` does match**. That turns an untestable
  property into a cheap loop over all four triggers. (The pane's key input is
  itself flaky and wedges after a few presses — a fresh `navigate` recovers it.)

For tab *order*, don't fight the pane at all: nothing in this app sets a positive
tabindex, so tab order is DOM order — query `focus-trap.js`'s own `FOCUSABLE`
list and assert the sequence.

**Related:** `.claude/rules/popover-vs-sheet-editors.md` (the editors these four
triggers open, and why they present as sheets on a phone),
`.claude/rules/in-app-nav-links.md` (the native-element direction this follows,
and why a URL-less control is a button and not a link),
`.claude/rules/accessibility-contrast-and-modals.md` §2 (the focus trap that had
nothing to restore to until these became focusable).
