---
paths:
  - "public/styles.css"
  - "public/js/cover.js"
  - "test/a11y-contrast.test.js"
---

# `--placeholder` does NOT paint a coverless game's glyph — `.cover-ph` does

Nine rules in `styles.css` set `color: var(--placeholder)` on an image box, and
five of them read exactly like "the icon shown when a game has no cover". For two
of those five that has been false since #256, and the CSS gives no hint of it.

`coverPlaceholder()` (`public/js/cover.js`) returns a **child layer** carrying its
own colour:

```js
`<span class="cover-ph" style="--cover-h:${hue}" aria-hidden="true"><i class="ti ${GAME_ICON}"></i></span>`
```

```css
.cover-ph { color: oklch(from var(--brand) 0.99 calc(c * 0.18) …); }  /* wins */
.game-card__img { color: var(--placeholder); }                        /* inherited, overridden */
```

So wherever a coverless **game** renders, the box's `--placeholder` is inherited
and then immediately overridden. Measured in a browser on #938 — the `.cover-ph`
glyph's computed colour is byte-identical with `--placeholder` at 18.5% and at
45%.

## What the token actually paints

Only the boxes that render a **bare `<i>`**, which are never a game cover:

| Site | What it is |
|---|---|
| `.session-card__img` | a session's **state** icon (`ti-x` / `ti-layout-grid` / `ti-cards`) — the `chosen ? coverPlaceholder(…) : <i>` ternary in `views-chronik.js` |
| `.feed-item__img` | a feed row with no `ev.coverUrl` (`views-friends.js`) |
| `.lookup__thumb--none .ti` | a search hit with no thumbnail (`views-round-lookup.js`) |
| `.avatar--guest`, the guest add button, `.guest-chip` | a **dashed border**, not a glyph at all |
| `.theme-card__line` | a **background** — the stand-in text lines on a design card |

`.game-card__img` and `.pool-tile__img` declare the colour and never show it;
their only child is `coverPlaceholder()`'s output. The declarations are kept as
the correct tone should a bare glyph ever land there — but do not read them as
evidence that one does.

## Why this misleads specifically

The token's own name and its old comment ("fallback icons on image areas") both
describe the #256 behaviour it lost, and the exemption list in
`test/a11y-contrast.test.js` enumerates all five boxes as though they were one
thing. Issue #938 was written from that reading and led with the two boxes the
token does not paint.

**It cost a wrong number, not just a wrong sentence.** #938 reported the glyph at
**1.05:1 on light and 1.48:1 on dark**, concluding that the dark scheme "happens
to make it better". Resolved with the repo's own harness (`test/support/theme.js`,
which evaluates the real declarations), the pair is **1.58:1 light / 1.44–1.47:1
dark** — the light case is the *better* one, and the light figure in the issue
does not correspond to any token pair on Standard at all. The dark figure matches;
the light one appears to have been carried over from #904's
`.result-people__label` measurement (1.07:1), which is a different element on a
different background. Both directions were bad, so the fix stood — but the framing
did not.

## The rule

Before reasoning about, retuning, or measuring `--placeholder`, **check whether
the box in question renders a bare `<i>` or a `.cover-ph`.** A `color:` on the
frame is not evidence; the child decides. `grep -rn 'coverPlaceholder' public/js/`
answers it in one call.

And measure with `test/support/theme.js` rather than by sampling rendered pixels:
a page sweep reads whatever is painted at that point, which for these boxes is the
gradient — so it can hand back a confident ratio for a colour pair that never
appears together on screen.

**Related:** `.claude/rules/theme-derived-colors.md` (why `.cover-ph` derives from
`--brand` in the first place), `.claude/rules/dark-designs-and-the-on-accent-flip.md`
§4 (the rendered-page sweep, and the `.result-people__label` finding the stray
number came from), `.claude/rules/preview-pane-paint-artifacts.md` (the general
case: the pane answering a question you did not ask).
