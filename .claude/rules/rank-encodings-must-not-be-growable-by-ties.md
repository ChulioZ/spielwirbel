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
the *displayed* one-decimal number — `row.shown`, the Spielwirbel-Score as it is
printed since #893, not the raw average — so a four- or five-person round hits
them constantly, and Pokale ties on whole win counts, where they are
unavoidable. The score adds one new source of them: every game below the
displayed floor prints 0,0 and shares a place, by design.

**Four PRs each fixed a sub-case inside that encoding and none could reach it.**
#836 made a column a rank rather than an entry, #879 gave the degenerate stage a
shared top step, #888 and #889 painted the risers. Every one was a real
improvement and the inversion survived all four, because **the inversion was the
encoding**. That is the tell worth carrying: when a component needs a fourth
patch to the same area, ask what the patches have in common rather than writing a
fifth.

## Two answers, because the two screens have opposite problems (#897)

#891 answered it once, for both callers, by moving rank onto **vertical
position** — tiers descending, best on top — and letting a tie grow sideways.
That was right about the defect and wrong to apply one shape to two screens:

- **Session results** has a ranked list under the stage, so a stage there states
  the ranking **twice**. It now opens on a **winner spotlight** and nothing else;
  the rows below carry the order, medals included. Rank is encoded in *nothing*
  there, so the question this file asks does not arise — which is why several
  tied winners may simply wrap.
- **Pokale** has no list. The stage *is* the content, so it keeps the pedestals —
  and with them, height as the rank encoding.

**So the principle did not soften: it binds Pokale exactly as before.** What
changed is the direction a tie is allowed to grow.

## The Pokale answer: entries lie SIDEWAYS on the step

A tied member is a 28px **chip** — avatar, name, count, on one line — not an
upright card. Height stops being growable at the rate that inverted it, and the
chip's height is **independent of the column's width**, because the name
ellipsises rather than wrapping. That last property is what makes the phone and
the desktop behave identically, and it is the thing to preserve: **let a chip's
text wrap and the whole encoding is growable again.**

Two supporting decisions, both measured rather than chosen:

- **The win count is notation (`3×`), not prose (`3 Siege`).** On a 375px phone
  each of the three steps is 108px, and the full phrase took 48 of them — every
  name truncated to three characters. It is not a cosmetic call: the alternative
  to the compact form is a second line, and a second line is height.
- **The tie marker („geteilt") is on the pedestal, and it wraps.** So the step's
  height is a bet on the longest locale — see
  `.claude/rules/percent-sizes-under-a-shrink-to-fit-flex-item.md`, which owns
  that half.

## The crossover, measured (#897)

**Holds to a FIVE-way tie; a six-way tie for 3rd outgrows the winner.**
Identical at 375px and at 1440px, which is the point — the chip does not change
height with the width available to it:

```
n=3  hero 227   tie-for-3rd 159
n=5  hero 227   tie-for-3rd 225      ← the last one that holds
n=6  hero 227   tie-for-3rd 258      ← inverted
```

That is the number to re-measure and to re-record if anything in the chip, the
gaps or the pedestal heights is retuned. For scale: the pre-#891 column stage
inverted at **three**, and the intermediate stacked-chip form measured during
this change inverted at **four** — which is why the chip's name and count ended
up on one line rather than stacked.

Above six the inversion is real and unmitigated: a six-way tie for third place
on a three-person podium is a state the ranking can produce, and it will draw
a taller bronze column than the gold one. It is accepted only because it is
far outside what any round reaches (six members tied for **third** needs at
least eight winners), and because the alternative — a per-rank cap with a
„+N weitere" spill — buys the last case by explaining a real person away into
a count on every ordinary one.

## The trap the FIX can reintroduce: wrap

This is the part that is not obvious and cost a browser cycle on #891, then a
second on #897. Entries flowing sideways **wrap** on a narrow screen, and a
wrapped row grows in exactly the dimension the rewrite just stopped using.
#891's tier stage measured 163px for a three-way tie against the winner's 161px
at 375px — the inversion, back, by two pixels — while reading a comfortable 70px
against 161px at 1440px. **So the regression lives only at the narrow end, only
above some tie size, and it looks like a rounding artefact** rather than the
original bug returning.

**A pedestal makes this sharper, not milder**, which is why #897 measured before
committing to a layout: a step is a third of the stage wide where a tier was
full width, so the wrapped unit has far less room to grow into. The fix is the
same in both stages — make the wrapped unit **short** — and it is the whole
reason the chip exists.

## How to check it, in one probe

Do not eyeball it, and do not check only the width you are working at. Clone an
entry into the lowest column and read the two heights as the tie grows — the
crossover point is the number to know and to report:

```js
const [, hero, low] = document.querySelectorAll('.podium__col');   // [2 | 1 | 3]
const proto = low.querySelector('.podium__entry');
for (let n = 3; n <= 7; n++) {
  console.log(n, low.getBoundingClientRect().height, hero.getBoundingClientRect().height);
  low.querySelector('.podium__entries').appendChild(proto.cloneNode(true));
}
```

Two practical notes. **`resize_window` to a real viewport first**, or every rect
is 0 (`.claude/rules/preview-pane-paint-artifacts.md`), and **cache-bust the
stylesheet** or you are measuring the cached one
(`.claude/rules/pwa-service-worker.md`, "Verifying a shell-asset change"). And
build the stage synthetically rather than cloning a real one when you need
several tie sizes: real Pokale data can only produce the tie it happens to hold,
and the names in it are all short, which is the case the chip survives most
easily.

## What no test can hold

`test/podium-ranks.test.js` pins the *arrangement* (a column is a rank, the crown
stays central, an unheld rank is a painted riser, nothing is capped) and the *CSS
contract* (the stage never wraps, the pedestals descend, a shared step lies its
entries down). It cannot pin the heights: jsdom applies no external stylesheet,
so nothing in the suite can see a wrapped step at 375px at all. **The height
claim is a browser measurement or it is nothing** — which is why the numbers
above are written down rather than left as "verified".

**Related:** `.claude/rules/percent-sizes-under-a-shrink-to-fit-flex-item.md`
(the entry widths this arrangement depends on, and the locale-sized box that has
moved from width to height), `.claude/rules/tiles-vs-lists.md` (the same ordering
argument one component out — why the rows below are not tiled, and why the
spotlight is allowed to wrap where they are not),
`.claude/rules/testing-views-under-jsdom.md` (what the view layer can and cannot
assert).
