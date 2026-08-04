---
paths:
  - "public/styles.css"
  - "public/js/**"
  - "test/ds-row-affordance.test.js"
---
# `.ds-row` is a CLICK TARGET — reusing it for layout alone lies to the user (#557)

`.ds-row` is the app's row component, and it does not merely lay a row out: it
declares `cursor: pointer` and a `:hover` lift. So an element gets the *promise*
of an interaction from the class name alone, whether or not anyone bound a
handler to it.

Six rows took the layout and inherited the promise — the three Freundeskreis
rows, the two inbox items and the Tags screen's tag row. Only the buttons at
their right edge ever responded, so the whole row showed a hand cursor and lifted
under the pointer while doing nothing. On the Freundeskreis that was **every row
on the screen**, from #325 until #557.

**Nothing detects this.** No error, no failing test, no visual breakage, and the
controls that do work are all present and correct. It is purely a promise the UI
does not keep, which is why it survived months of ordinary review.

## The opt-out, and why it is compounded

```css
.ds-row.ds-row--static { cursor: default; }
.ds-row.ds-row--static:hover { box-shadow: none; }
```

**Both selectors repeat `.ds-row` deliberately.** A bare `.ds-row--static` is
(0,1,0) — a tie with `.ds-row` — and `.ds-row--static:hover` is (0,1,1), a tie
with `.ds-row:hover`. A tie is decided by **source order**, so both would keep
working only for as long as nobody moved either block, and would then fail
silently in the one direction nobody checks. Compounded they are (0,2,0) and
(0,2,1) and outrank the base outright. Same lesson as
`.claude/rules/label-rows-lose-to-field-label.md`, which is the other way this
component loses a cascade fight.

`.konto-fact` (`views-account.js`) solves the same problem by **not being a
`.ds-row` at all** — it is a differently-shaped baseline-aligned label/value pair,
so it was never a candidate for the modifier. Both answers are fine; what is not
fine is taking `.ds-row` and leaving the affordance on.

## The invariant, and what enforces it

Every genuinely clickable `.ds-row` in the app is a **native interactive
element** — `<a>` (Chronik rows, the round-settings links), `<button>` (the
round-settings actions) or `<label>` (provider, move-games and BGG-import rows,
where the click toggles a checkbox). Every `<div class="ds-row">` is inert.

`test/ds-row-affordance.test.js` pins exactly that: a `<div>` row must carry
`ds-row--static`, and an `<a>`/`<button>`/`<label>` row must **not**. The second
half is what stops the first from being satisfied by spraying the modifier over
every row, and it is not hypothetical — sprinkling it onto the move-games
`<label>` reddens the suite.

So **a row that should become clickable should become an `<a>` or a `<button>`**,
not a div that quietly re-earns the affordance — which is the direction
`.claude/rules/native-button-vs-focusable-span.md` and
`.claude/rules/in-app-nav-links.md` already set.

**This file used to predict that #558 would turn the three Freundeskreis rows
into anchors and drop the modifier. It did not, and the prediction was wrong for
a structural reason worth keeping:** those rows hold action buttons, and a
`<button>` inside an `<a>` is invalid HTML, so the row can never *become* the
link. Only its `.ds-row__main` half did (`friendRowMain`, `views-friends.js`),
and the row therefore **keeps `ds-row--static`** — it is genuinely not a click
target, and the anchor inside it carries the whole affordance. The test above
needed no edit either way, because it scans `ds-row` as a whole class and
`ds-row__main` never matched it.

The general form: **a row with its own actions splits into a linked half and an
inert remainder, not into a clickable row.** Only a row with nothing else in it
can take the native element wholesale. See
`.claude/rules/account-profiles.md`.

The one **conditional** case is the generic inbox item: its handler is bound only
while unread (clicking marks it read). It interpolates the modifier for the read
state *and* adds it inside that handler, because a row read while the user is
looking at it crosses from one state to the other on screen.

## Verifying a change here

Computed style, not pixels — a cursor does not appear in a screenshot and the
hover state cannot be forced from `javascript_tool`:

- `getComputedStyle(row).cursor` on real rows (`default` for the static ones,
  still `pointer` for the `<label>`/`<a>`/`<button>` ones — check both, or you
  have only proved you can turn the affordance off everywhere).
- For the hover half, walk `document.styleSheets` for rules that set
  `box-shadow` and whose selector minus `:hover` the row `matches()`. Measured:
  exactly two match a tag row — `.ds-row:hover` and `.ds-row.ds-row--static:hover`
  — with the opt-out later *and* more specific.
- `renderGenericItem` is a top-level **function declaration**, so it is reachable
  as a `window` global and can be called directly with a fake `{ id, read,
  createdAt }` to exercise all three states of the conditional row without
  seeding a real inbox (`.claude/rules/in-app-nav-links.md` §1 on which globals
  are reachable). Append the row to the document before reading computed style.

Clear the service worker first (`.claude/rules/pwa-service-worker.md`); the shell
is cache-first, so a stale `styles.css` makes the fix look inert.

**Related:** `.claude/rules/label-rows-lose-to-field-label.md` (the other
`.ds-row` cascade trap),
`.claude/rules/state-rules-clobber-component-values.md` (which borrows the
compounded-selector remedy above, and records the second tie it has to avoid to
do so), `.claude/rules/tiles-vs-lists.md` (when a `.ds-row` list
becomes a tile grid, and the wrap it needs there),
`.claude/rules/native-button-vs-focusable-span.md` (why a click target is a real
element), `.claude/rules/hidden-attribute-vs-display-rule.md` (the sibling "probe
the computed style, not the DOM answer" lesson).
