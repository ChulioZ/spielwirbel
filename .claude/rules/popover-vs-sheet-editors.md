---
paths:
  - "public/js/views-round-detail.js"
  - "public/js/core.js"
  - "public/styles.css"
---
# An anchored popover cannot hold a text input on a phone (#422)

The three game-detail editors (tags, players, cover) are one builder each with
**two presentations**: an anchored `.popover` from 860px up, a bottom sheet below
it. `openEditor(anchor, variant, title, build)` in `views-round-detail.js` picks
between them. This is not a taste call — the anchored form is *structurally*
unusable on a phone, and the way it fails is invisible from every check we have.

## 1. Why an anchored popover dies on a phone

`openPopover` (`core.js`) tears itself down on `window` **`scroll`** and
**`resize`**. Both fire as a direct consequence of focusing an input:

- **iOS**: focusing an input near the bottom of the viewport makes the browser
  scroll the page to reveal it. That scroll targets `document`, so it is *not*
  covered by the `#247` inside-the-popover exemption, and the popover closes —
  which removes the just-focused input from the DOM, so the keyboard never
  finishes opening. Net effect: tap the field, the page jumps, the popover is
  gone, no keyboard, ever.
- **Android**: the soft keyboard fires a `resize` instead, hitting `onGone`
  directly.

So there was **no way to tag a game from a phone at all** — on a mobile-first
app, from #238 until #422. Nothing threw, no test failed, and the DOM was built
correctly the whole time.

**Rule:** any popover that contains a focusable text input must present as a
sheet below 860px. If you add a fourth editor, route it through `openEditor`
rather than `openPopover`. A popover holding only buttons (the top-bar account
menu, `account.js`) is fine at every width — it raises no keyboard.

That same self-teardown is why a popover is **exempt from the page lock** every
sheet gets (#622): freezing the document would defeat the scroll listener that
keeps it on its anchor. It gets `overscroll-behavior` on its inner scroll box
instead — see `.claude/rules/overlay-page-lock.md` §3.

## 2. `build()` runs on a DETACHED node — `focus()` in it is a silent no-op

`openPopover` called `build(el, close)` *before* `document.body.appendChild(el)`.
So `input.focus()` at the end of a builder ran on an element that was not in the
document yet and did nothing — the tags and players editors' autofocus had
**never worked, on any platform**, since they were written. Nobody noticed
because the manual tap that replaced it "worked" on desktop, and on mobile that
same tap tripped (1).

The fix is a convention, not a moved line: **`build` may return a callback, and
both presentations invoke it once the container is live** (for the popover, after
append *and* positioning; for the sheet, after `openSheet`). Anything needing a
live element goes there:

```js
return () => { min.focus(); min.select(); };
```

This also matters for the sheet path specifically: **iOS only raises the keyboard
for a `focus()` inside a user gesture**, so the whole open path stays synchronous
from the button's click handler. Defer it into a `setTimeout`/`await` and the
keyboard stops appearing again, on a code path that looks fine everywhere else.

## 3. Ordering constraints in the sheet path

Two, both silent when violated:

- **Focus AFTER `openSheet`, never before.** `trapFocus` captures
  `document.activeElement` as its restore target, so focusing the input first
  makes the sheet "restore" focus into itself on close
  (`.claude/rules/accessibility-contrast-and-modals.md` §2).
- **No leading `closeSheet()`.** `openSheet` replaces an already-open sheet
  synchronously; a leading `closeSheet()` queues an async `history.back()` that
  lands *after* the new sheet is up and dismisses it
  (`.claude/rules/sheet-history-back-dismissal.md` §2). None of these three
  editors navigates on success, so a plain `closeSheet()` (no `next` deferral) is
  correct for all of them.

## 4. Share the inner layout with `:is()`, not by duplicating rules

One builder filling two containers means every inner rule has to match both.
`:is(.popover--tags, .editor--tags) .pp-row` keeps the original **(0,2,0)**
specificity — `:is()` takes the specificity of its most specific argument — so
nothing else in the cascade shifts. Only the rules that size the *floating card*
(`.popover--tags { max-width: 340px }`, `.popover--image { min-width: 220px }`)
stay popover-only; they are meaningless for a sheet. Scoping a layout rule to one
presentation leaves the other unstyled, which reads as a broken layout rather
than a missing selector.

**The card's cap and whatever gives way under it are ONE unit, and the whole unit
is popover-only** (#722 — `.popover--tags`' `max-height` plus the scroll boxes on
its chip row and icon grid). That is not an exception to the paragraph above: the
sheet is already its own scroll container, so a nested scroll box there would
take the gesture away from `.sheet` and bound a height nothing was constraining.
Verified — in the sheet those two boxes compute `overflow-y: visible` and the
sheet still scrolls itself. Read `:is()` as covering rules the two presentations
genuinely share, not as a quota to hit.

## Verifying this in the Browser pane

The pane **cannot reproduce the bug** — it has no soft keyboard, and a freshly
opened tab reports `innerWidth === 0`. That 0 has a useful consequence and one
trap (**but resize first**: an explicit `resize_window` *does* clear it, measured
on #722 — see `.claude/rules/preview-pane-paint-artifacts.md`, which supersedes
the "does not clear it" claim this paragraph used to make):

- `matchMedia('(min-width: 860px)').matches` is **false**, so the pane always
  takes the **sheet** branch. Convenient — that is the new code.
- To exercise the **popover** branch, stub `window.matchMedia` before clicking.
  `usesEditorSheet` reads it off `window`, so this works, whereas the view
  functions themselves are lexically scoped and *cannot* be wrapped via `window.*`
  (`.claude/rules/in-app-nav-links.md`).
- **The pane is split-brain about width:** CSS media queries evaluate against the
  real rendered width (the screenshot is 1600px wide and shows the desktop rail)
  while JS reports 0. So a screenshot of the sheet shows it inside a desktop
  layout. That is the pane, not the app — don't "fix" it.

Everything else is probe-testable and worth probing: `document.activeElement`
after open (the autofocus), `history.state.sheet` (the Back marker),
`history.back()` then asserting `location.pathname` is unchanged and the screen
survived, Escape/backdrop/× closing, and focus restoration to the opener.

One caveat on that last one: the tag/player **chips** are `<span>`s with a click
handler (`makeEditableTag`), so they are not focusable and focus restores to
`<body>` when a sheet is opened from one. That is a pre-existing keyboard-access
gap in `makeEditableTag`, not a sheet bug — restoration works correctly from the
onboarding `<button>`s. Fixing the chips is its own issue.

**Related:** `.claude/rules/responsive-hub-tabs.md` (where 860px comes from — it
is the dock/strip breakpoint, reused deliberately),
`.claude/rules/sheet-history-back-dismissal.md`,
`.claude/rules/accessibility-contrast-and-modals.md` §2,
`.claude/rules/preview-pane-paint-artifacts.md`.
