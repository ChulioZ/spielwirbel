---
paths:
  - "public/js/filter-panel.js"
  - "public/js/views-session.js"
  - "public/js/views-regal.js"
  - "public/styles.css"
---
# A disclosure that unfolds inside a `flex-wrap` row moves its own TRIGGER (#844)

#827 put the one „Filter" control on the session setup screen as a `<details>`,
beside the count stepper in `.setup-filterbar` — a `flex-wrap: wrap` row. Opening
it moved the „Filter" button itself onto the next line, and pushed the pool
preview down with it. **One click moved two things the user had not touched.**

The cause is a rule that reads like the fix for a different problem:

```css
.setup-filterbar > :has(> .fpanel[open]) { flex: 1 1 100%; }
```

Its intent was right — without it the body unfolds inside its own narrow flex
column and ~84 category chips wrap into a tower. But a 100% flex-basis makes the
mount claim the whole line, so the flex algorithm puts it on a **new** line, and
the trigger goes with it because the trigger is *inside* the mount.

## The general shape

**A disclosure whose body is a sibling of other content in a wrapping row cannot
grow without moving its own trigger.** The two requirements are in direct
conflict: the body needs the full row, the trigger needs to stay in its column,
and they are one element. Any CSS answer trades one for the other —
`position: absolute` on the body is just an overlay with none of the machinery.

So on the setup screen there was no styling fix. Pinning the summary with a grid
would have stopped the jump and left the second half untouched: the body still
pushes the **pool preview** — the thing the filters shape — down and out of view
exactly while the user is adjusting them, which is the feedback loop the screen
exists for.

## The fix is structural: take the body out of the flow

Route it through `openEditor` (`.claude/rules/popover-vs-sheet-editors.md`) — an
anchored popover from 860px, a sheet below. Then the trigger cannot move **by
construction**, because there is nothing in the row for any rule to widen, and
the preview stays put. Measured at 1440x900 on the demo shelf: trigger 0px, pool
panel 0px, on open and on close.

That structural property is also what makes it testable. A CSS assertion can only
say that *today's* stylesheet grants no full-row basis — someone can always write
a new rule. The DOM assertion is stronger and is the one to prefer:

```js
assert.equal(bar.contains(body), false);   // the body is not in the trigger's row
assert.equal(dom.app.contains(body), false); // nor anywhere page layout can reach
```

Keep the CSS assertion as well, aimed at the *selector that carried the bug*
(`test/regal-filter.test.js`) — it names the regression, and it is what a future
session sees when it reaches for the same rule again.

## Two things the move costs, and both are easy to miss

- **The platform state goes with the element.** `<details>`/`<summary>` gave the
  expanded state, the keyboard behaviour and the accessible name for free. An
  overlay has to earn each back: `aria-expanded` on a real `<button>`, focus moved
  in on open and restored on close, Esc, and — the one that catches people — a
  close notification for the exits the builder never sees
  (`.claude/rules/popover-vs-sheet-editors.md` §2b).
- **A rebuild must not run under an open overlay.** The trigger is the popover's
  **anchor**: `place()` and the outside-click guard both hold that reference, so
  swapping it out strands the card. The #736 backfill can rebuild at any moment,
  so `mountFilterPanel` returns early while `isOpen()`. Nothing is lost by
  waiting, because the body is built fresh on every open from the live `games`
  array, which `foldGameInfoList` fills **in place**.

  The failure if you skip the guard is quieter than a stranded popover, and it is
  what the spec actually asserts: the overlay stays up and keeps filtering while
  its controls call the **old** panel's `sync()`, writing to a chip row no longer
  in the document — so the applied filters silently stop following the panel.
  Verified by deleting the guard (`.claude/rules/break-the-code-on-purpose.md`);
  the obvious assertion, that an open panel gained no new control, stays green.

## The badge did not survive the move, on purpose

The closed control used to carry a count badge, because a collapsed disclosure
says nothing about what is on. Outside the overlay there is room for the applied
filters themselves, as removable chips — which answer *which*, where a number can
only answer *how many*. Keeping both would state the same thing twice at **two
granularities**: the chips are per value (each category its own, so its × can
mean something), while `countMetadataFilters` counts controls. They disagree the
moment anyone picks two categories.

The count survives only where it cannot contradict what is on screen — the
trigger's `aria-label`, computed from `chips.length`. **`countMetadataFilters`
itself is untouched**: `lib/routes/sessions.js` uses it to decide whether a draw
carried filters at all, which is a different question.

**Related:** `.claude/rules/popover-vs-sheet-editors.md` (the presentation, and
the `onClose` hook), `.claude/rules/anchored-popover-is-placed-once.md` (the
height cap this card needed), `.claude/rules/popover-width-is-shrink-to-fit.md`
(why it needed no width floor — measured, not assumed),
`.claude/rules/provider-metadata-is-a-filter-not-a-tag.md` (what the panel holds,
and why the two halves stay separate inside it).
