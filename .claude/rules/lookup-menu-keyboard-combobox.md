---
paths:
  - "public/js/views-round-lookup.js"
  - "public/js/lookup-nav.js"
  - "public/js/focus-trap.js"
  - "test/lookup-nav.test.js"
---
# The lookup dropdown is an editable combobox (#542) — the sheet has to ASK about Escape

The add-game / link-provider suggestion menu (`attachLookup`,
`public/js/views-round-lookup.js`) was **completely inoperable by keyboard** from
its introduction until #542 — provider matching, covers, player counts and store
links were mouse-only, while the DOM was built correctly the whole time and every
automated check stayed green. Three independent defects, and the fix for each has
a trap.

## 1. The sheet's Escape handler runs FIRST, so the menu cannot win by stopping the event

The obvious fix for "Escape kills the whole sheet instead of the dropdown" is to
handle Escape on the input and `stopPropagation()`. **That cannot work here**, and
the reason is pure event order:

```js
document.addEventListener('keydown', onKey, true);   // the sheet — CAPTURE, on document
input.addEventListener('keydown', …);                // the lookup — target phase
```

Capture runs window → document → … → target, so the sheet's handler has already
torn the sheet down before the input's listener is ever reached. Registering the
lookup's handler on `document` capture too does not help either: capture listeners
on the *same* node fire in registration order, and the sheet is always opened
(`openSheet`) before `attachLookup` is called.

So the decision has to be made **in the sheet**, which asks the lookup:

```js
if (lookup && lookup.isOpen()) { e.preventDefault(); e.stopPropagation(); lookup.closeMenu(); return; }
dismiss();
```

Hence `attachLookup` returns `isOpen` at all — and hence the inert zero-provider
stub (#294) must return `isOpen: () => false`, or a round that deliberately
queries no providers throws on every Escape. Both sheets declare `let lookup =
null` **above** `onKey` and assign it later; the handler only ever fires long
after that assignment.

`stopPropagation()` there is safe: the only other document-capture listener is
`trapFocus`, which acts on Tab alone.

## 2. Tab must NOT reach the menu — the blur race is load-bearing for the mouse

A pick fires on **`mousedown`**, deliberately, so it beats the input's
`blur` → `setTimeout(closeMenu, 150)`. That same teardown is what made the menu
unreachable: tabbing toward a suggestion blurs the input and 150 ms later deletes
the row being reached.

**Do not "fix" the blur race** (e.g. by checking `relatedTarget`) to let Tab walk
into the menu. The APG *editable combobox with listbox popup* keeps DOM focus in
the input permanently and moves an `aria-activedescendant` highlight instead,
which sidesteps the race entirely rather than negotiating with it. Every menu
element is therefore `tabindex="-1"`.

**That exposed a real bug in `focus-trap.js`.** `FOCUSABLE` spells
`:not([tabindex="-1"])` out only in its **last** entry, so a *native* control
carrying it still matched `button:not([disabled])` and was counted. The trap's
first/last items decide where Tab wraps, and the browser never stops on a `-1`
element — so with menu options in the list, the wrap target was unreachable and
one Tab escaped the sheet before the next pulled focus back. `focusables()` now
filters `getAttribute('tabindex') === '-1'` generically; `test/focus-trap.test.js`
pins it (its DOM double needed a `getAttribute` to do so).

Both events are bound on every pick target: `mousedown` (the mouse path — a
`click` listener alone never runs, because the menu is gone by then) **and**
`click` (keyboard/AT activation dispatches nothing else). A real pointer click
fires both, so each element carries a one-shot `done` flag.

## 3. Only Down/Up may be hijacked — the input is still a text field

`nextLookupIndex` (`public/js/lookup-nav.js`) returns **`null`** for every key it
does not own, and the caller uses that to decide whether to `preventDefault`.
This is not defensive coding: the combobox is *editable*, so ArrowLeft/
ArrowRight and Home/End must keep moving the caret in a field the user is still
typing in. Claiming them for navigation would be a regression traded for a
feature.

**That constraint is what shapes the option list.** A merged row offers several
providers (one badge each), and with no horizontal axis available they have to
join the same vertical list — so a row contributes its title button plus one
entry per *further* provider. **Badge 0 is skipped**: it is the primary, the same
choice the title button above it already offers, so including it would stop Down
twice on one choice. Without this, picking a specific provider — the whole point
of the badges — would have stayed mouse-only, i.e. a half-fixed issue.

## 4. The highlight is tracked by IDENTITY, because the menu re-renders under it

`render()` runs again on **every** provider arrival, re-sorting rows as a better
match lands. An index alone therefore slides the highlight onto a different game
mid-keystroke. `lookupOptionIndex(options, { key, provider })` re-locates it, and
an option that is gone clears to "nothing active" rather than snapping to a
neighbour. Measured live: with a slow provider inserting a row above it, the
active option moved from index 2 to 4 and DOM id `lk3-0-2` to `lk3-1-2` while
staying on the same game+provider.

Typing clears the reference outright — the next render answers a different query.

## 5. Smaller things

- **`role="presentation"` on the rows and on the status lines.** A listbox's
  children must be its options; the `.lookup__opt` wrapper, the `.lookup__badges`
  span and the „Suche läuft …" / „Keine Treffer" messages are not pickable and
  must not be announced as if they were.
- **`scrollIntoView()` is wrong for this menu.** It is `position: fixed`
  (`.claude/rules/lookup-menu-fixed-position.md`), so it is its own rows'
  offsetParent, and the browser may satisfy the request by scrolling the *sheet*
  or the page behind it — which then fires the reposition listeners. Adjust
  `menu.scrollTop` from `offsetTop`/`offsetHeight` instead.
- **`aria-activedescendant` must be removed, not just repointed**, whenever the
  options go away — a stale id names a detached element that some screen readers
  keep reporting as current.
- Option ids carry a per-attach counter (`lk<uid>-<row>-<col>`): both sheets
  hard-code the same `#lookupMenu` id, so only the option ids can guarantee
  uniqueness across sheet opens.

## Verifying it

`test/lookup-nav.test.js` covers the arithmetic; everything else needs a browser
(`dev-temp-data`, service worker cleared — `.claude/rules/pwa-service-worker.md`).

- **Stub `window.api`, don't rely on the live provider.** `api` is a top-level
  `function` declaration, so it *is* a `window` property and can be wrapped
  (`.claude/rules/in-app-nav-links.md` §1 on which globals are reachable). That is
  also the only practical way to construct a **merged** row on demand — return the
  same title from two providers — and to stagger one provider's response to
  exercise §4. **Since #744 registered BGG alone it is the only way at all**: the
  merge and the badge navigation are dormant until a second provider lands, so a
  stub is what keeps them from silently rotting in the meantime.
- **Synthetic `keydown` is a valid probe here**, unlike the synthetic *click* trap
  in `.claude/rules/in-app-nav-links.md`: the whole behaviour lives in listeners
  and `defaultPrevented`, not in a default action the browser has to perform.
- **Read `getComputedStyle` while the class is still on.** A probe that captured
  the active element, pressed Down again and *then* measured reported the row
  highlight as transparent — the class had simply moved on. That reads exactly
  like a CSS rule that does not match, which is the
  `.claude/rules/hidden-attribute-vs-display-rule.md` family of false alarm.

**Related:** `.claude/rules/lookup-menu-fixed-position.md` (why the menu is fixed,
and the reposition listeners), `.claude/rules/add-game-lookup-provider.md` (the
providers being merged), `.claude/rules/sheet-history-back-dismissal.md` (the
sheet layer whose Escape this defers to),
`.claude/rules/accessibility-contrast-and-modals.md` §2 (the focus trap §2 fixes),
`.claude/rules/frontend-helper-modules-and-coverage.md` (why `lookup-nav.js` is
its own file).
