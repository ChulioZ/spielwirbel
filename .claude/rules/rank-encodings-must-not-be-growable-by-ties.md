---
paths:
  - "public/styles.css"
  - "public/js/podium.js"
  - "public/js/views-pokale.js"
  - "public/js/views-session.js"
---
# A visual that encodes RANK must not encode it in a dimension a TIE can grow

The podium encoded rank as pedestal **height**. A tie adds **entries**, entries
stack **upward** from the pedestal, so the more games shared a low place the
taller that column got: one winner plus a three-way tie for 3rd made the bronze
column overtop the crowned winner. The one claim the component exists to make,
contradicted by its own geometry — and worse the further down the tie sat.

Ties are the norm here, not an edge case: `computePlaces` (`ranking.js`) ties on
the *displayed* one-decimal average, so a four- or five-person round hits them
constantly.

**Four PRs each fixed a sub-case inside that encoding and none could reach it.**
#836 made a column a rank rather than an entry, #879 gave the degenerate stage a
shared top step, #888 and #889 painted the risers. Every one was a real
improvement and the inversion survived all four, because **the inversion was the
encoding**. That is the tell worth carrying: when a component needs a fourth
patch to the same area, ask what the patches have in common rather than writing a
fifth.

#891 moved rank onto **vertical position** (tiers descending, best on top) plus
hero treatment, and let a tie grow **sideways** — the one direction that says
nothing about rank.

## The trap: the FIX can reintroduce it through wrap

This is the part that is not obvious and cost the browser pass a cycle. Entries
flowing sideways **wrap** on a narrow screen, and a wrapped tier grows in exactly
the dimension the rewrite just stopped using. Measured at 375px, three tied
entries at a 42px cover and a 10px row gap:

```
tier 3 (three-way tie)  163px
tier 1 (the winner)     161px      ← the inversion, back, by two pixels
```

At 1440px the same stage read 70px against 161px, i.e. **completely fine at the
width you check first**. So the regression lives only at the narrow end, only
above some tie size, and it looks like a rounding artefact rather than the
original bug returning.

The fix is to make the wrapped unit **short**: below the hero an entry lies down
into a chip (34px cover, 6px row gap), so a tied line is ~40px rather than ~48px.
Re-measured: 129px against 165px, and it holds to a four-way tie (164 vs 165).
**A five-way tie for 3rd on a 375px phone still exceeds the winner's tier** —
accepted, because rank no longer *depends* on height there: the winner is the top
row, crowned, gold-edged and carrying the largest cover, so a tall tier below it
reads as "several games tied", not as "these outrank the winner".

## How to check it, in one probe

Do not eyeball it, and do not check only the width you are working at. Clone an
entry into the lowest tier and read the two heights as the tie grows — the
crossover point is the number to know and to report:

```js
const [hero, , low] = document.querySelectorAll('.podium__tier');
const proto = low.querySelector('.podium__entry');
for (let n = 3; n <= 6; n++) {
  console.log(n, low.getBoundingClientRect().height, hero.getBoundingClientRect().height);
  low.querySelector('.podium__entries').appendChild(proto.cloneNode(true));
}
```

`resize_window` to a real viewport first, or every rect is 0
(`.claude/rules/preview-pane-paint-artifacts.md`), and cache-bust the stylesheet
or you are measuring the cached one
(`.claude/rules/pwa-service-worker.md`, "Verifying a shell-asset change").

## What no test can hold

`test/podium-ranks.test.js` pins the *arrangement* (tiers descend, a tie shares
one, an unheld rank is absent) and the *CSS contract* (the stage stacks in a
column, the indent scales with rank, the hero carries the largest cover). It
cannot pin the heights: jsdom applies no external stylesheet, so nothing in the
suite can see a wrapped tier at 375px at all. **The height claim is a browser
measurement or it is nothing** — which is why the numbers are written down above
rather than left as "verified".

**Related:** `.claude/rules/percent-sizes-under-a-shrink-to-fit-flex-item.md`
(the entry widths this arrangement depends on, and the marker that sizes to a
translated label), `.claude/rules/tiles-vs-lists.md` (the same ordering argument
one component out — why the rows below the podium are not tiled),
`.claude/rules/testing-views-under-jsdom.md` (what the view layer can and cannot
assert).
