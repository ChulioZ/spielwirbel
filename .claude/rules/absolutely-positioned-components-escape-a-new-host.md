---
paths:
  - "public/styles.css"
  - "public/js/views-session-tables.js"
  - "public/js/views-chronik.js"
  - "public/js/views-round.js"
  - "public/js/views-regal.js"
  - "public/js/views-pokale.js"
  - "public/js/views-round-detail.js"
---

# A component that positions itself ABSOLUTELY brings that with it into your new screen

Two of this stylesheet's most-reused pieces are absolutely positioned, because
they were designed as **overlays on a game tile**:

| Component | Declares | Designed for |
|---|---|---|
| `.cover-ph` (the deterministic cover placeholder, #256) | `position: absolute; inset: 0` | filling a cover box |
| `.score-pill` (the Ø badge) | `position: absolute; top: 8px; right: 8px` | the corner of a cover box |

Drop either into a new screen without repeating what its original host provided
and it does not break — it **relocates**, silently:

- a `.cover-ph` with no positioned ancestor lands on the initial containing block
  and covers the **entire viewport**;
- a `.score-pill` used inline flies to the page's top-right corner and hides
  behind the top bar.

Both happened in one PR (#796's table builder). The remedies are already the
established pattern and are one line each — `position: relative` on the host (the
comment "anchors + clips the .cover-ph gradient layer (#256)" marks the seven
existing ones), and `position: static` on the pill inside its row (four existing
inline contexts spell it out).

## Why nothing catches it

Every instrument agrees the screen is fine:

- **The DOM is correct.** The element is there, `textContent` reads "Ø 4.0", the
  class list is right.
- **The rects of the HOST are correct.** The 44×44 tile really is 44×44 — it is
  the *child* that got away. `getBoundingClientRect()` on the thing you built
  reports exactly what you intended.
- **jsdom has no layout at all**, so the whole view harness
  (`.claude/rules/testing-views-under-jsdom.md`) is blind to it by construction.
  A rendered-DOM spec asserting the pill's text passes against a pill nobody can
  see.
- **`lint`, `coverage:ci` and the CSS-text tests** have no opinion either.

Only the screenshot shows it. So: **screenshot a new screen once, at a real
viewport, before believing the probes** — and read `getBoundingClientRect()` on
the *positioned descendant*, not on its host, when something looks off.

## Guarding it in a spec

jsdom cannot compute the layout, but it can be asked which rule *would* apply: the
render is real, so walk the rendered tree and look each host's class up in
`styles.css` through `test/support/css.js`.

```js
// test/table-builder-view.test.js
for (const ph of dom.app.querySelectorAll('.cover-ph')) {
  assert.ok([...ph.parentElement.classList].some(positions), …);
}
```

Two properties make that worth writing rather than pinning a hand-kept list of
host classes: it is derived from what the view **actually rendered**, so a card
that grows a second cover is covered without editing the spec; and it names the
offending class in its failure. Verified by removing the `position: relative` and
watching exactly that test go red.

## The neighbouring family

This is the third way a component silently loses a fight it looks like it is
winning:

- `.claude/rules/label-rows-lose-to-field-label.md` — a more specific base rule
  replaces the component's `display`, and every child probe still reports `flex`.
- `.claude/rules/state-rules-clobber-component-values.md` — a `:active` rule's
  absolute value replaces the margin the component declared.
- **this one** — the component's own positioning is correct and its *host* is
  what is missing.

All three read as "the new screen is broken" while the component is behaving
exactly as written, and all three are invisible to the DOM.

**Related:** `.claude/rules/multi-table-sessions.md` (the screen these were found
on), `.claude/rules/tabler-icon-codepoints.md` (the third defect of that same
browser pass — an undeclared glyph renders nothing at all),
`.claude/rules/preview-pane-paint-artifacts.md` (when a blank capture is the pane
rather than the app — run its controls before trusting a screenshot either way).
