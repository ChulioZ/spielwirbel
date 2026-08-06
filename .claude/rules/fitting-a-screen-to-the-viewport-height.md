---
paths:
  - "public/styles.css"
  - "test/vote-card-viewport-fit.test.js"
---

# "Fits the viewport" costs ~230px of chrome — and ~112px of it is the FOOTER

Measured on a phone (390×640, `dev-temp-data`, service worker cleared), for a
screen rendering a single card:

| Above/below the content | px |
|---|---|
| `.topbar` | 66 |
| `.app` padding-top (≤520px) | 16 |
| **`.site-footer`** | **111.7** |
| `.app` padding-bottom | 40 |

So a card starts at **y=82** and the page has only **~406px** left if the footer
must also be on screen. That is less than half the viewport, and it is the number
every "make it fit" estimate gets wrong, because the footer is not part of the
screen anyone is looking at while they design one.

## The two goals are different, and only one of them is usually reachable

They get conflated because the obvious metric measures the stricter one:

```js
document.documentElement.scrollHeight - document.documentElement.clientHeight === 0
```

- **"The card fits above the fold"** — `card.getBoundingClientRect().bottom <=
  clientHeight`. Budget ≈ `100svh - 82`. This is what a user means by "I
  shouldn't have to scroll to press the button".
- **"The page does not scroll at all"** — the expression above. Budget ≈
  `100svh - 234`, i.e. **152px less**, all of it below the thing being looked at.

#666 was written with the first goal and the second metric. The gap was decided
by measurement, not argument: at the issue's own stated floors the vote card is
**470px**, so the first goal had ~90px of slack and the second was short by 64px
— unreachable without hiding the footer or breaking the floors. Operator chose to
keep the footer (2026-08-06), so the vote screen still scrolls ~113px, and every
pixel of it is footer.

**State which goal you are hitting, in the PR and on the issue.** A card that
fits above the fold against a page that still scrolls looks like a half-done job
to anyone holding the strict metric.

## Measuring it

`scrollNeeded` is the number worth reporting — it is 0 or it is the user's
complaint, and it stays honest across both goals:

```js
const de = document.documentElement, card = document.querySelector('.vote');
Math.max(0, card.getBoundingClientRect().bottom - de.clientHeight);
```

Use `clientHeight`/`clientWidth`, never `innerHeight`/`innerWidth` — the Browser
pane reports 0 for those, and on an overflowing page `innerWidth` reports the
*overflowed* width (`.claude/rules/flex-none-cancels-flex-wrap.md`).

## Budget for the second line of a title before you spend the slack

A phone card's height is not one number: a game title wrapping to two lines cost
**33px** here, which is most of a comfortable margin. Vary the content, not just
the viewport — long title, and the variant that renders fewer rows (a guest sees
no „Aussortieren" row, `.claude/rules/session-guests-are-not-members.md` §4).
Sizing to the happy path puts the button back under the fold for exactly the
games with the longest names.

**Related:** `.claude/rules/aspect-ratio-transfers-back-to-width.md` (how the
elastic element in the vote card is sized, and the trap in doing it),
`.claude/rules/responsive-hub-tabs.md` (where 520/860 come from),
`.claude/rules/preview-pane-paint-artifacts.md` (why the pane's own viewport
numbers cannot be trusted).
