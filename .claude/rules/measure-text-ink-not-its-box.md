---
paths:
  - "public/styles.css"
  - "public/js/**"
  - "test/**"
---

# A text-overflow probe that reads the element's BOX can never see the overflow

#1111's defect was a label overflowing its grid column. The obvious probe —
`getBoundingClientRect()` on the label, compared against its cell — reported
**zero overflow in every locale, before and after the fix**:

```js
const r = lbl.getBoundingClientRect(), s = cell.getBoundingClientRect();
r.right - s.right            // 0, always
```

`.score-label` is a **block**, so its border box is its cell by definition. The
number is not wrong; it is an answer to a different question, and it agrees with
every implementation — the signature from
`.claude/rules/mock-timers-jump-the-clock-before-firing.md`, one instrument over.

## Measure the ink

A `Range` over the text node returns the painted fragments, which is what
actually spills:

```js
const rg = document.createRange(); rg.selectNodeContents(lbl);
const rects = [...rg.getClientRects()].filter(r => r.width > 0);
Math.max(...rects.map(r => r.right)) - cell.right;   // +21px in de, −73px fixed
```

One rect per **line**, so `rects.length` is the line count for free — and a label
silently wrapping to two lines inside a too-narrow box is the other half of this
bug (it is why every row was 21px taller than it needed to be).

## Width still cannot tell you a word was SPLIT

The `ko` failure was „Spielwir / bel 점수" — the brand name broken mid-word by
the `:lang(ko)` `overflow-wrap: break-word` hatch. That case **does not spill**,
so every width probe calls it fine. Width and split are independent failures and
a fix has to be shown against both.

Read the per-line text by walking the characters and grouping them by rect top:

```js
const tn = lbl.firstChild, rg = document.createRange(), byTop = new Map();
for (let i = 0; i < tn.data.length; i++) {
  rg.setStart(tn, i); rg.setEnd(tn, i + 1);
  const k = Math.round(rg.getBoundingClientRect().top);
  byTop.set(k, (byTop.get(k) || '') + tn.data[i]);
}
[...byTop.values()]        // ["Spielwir", "bel 점수"]  → brand split
```

Then assert the invariant directly — `lines.some(l => l.includes('Spielwirbel'))`
— rather than inferring it from a width.

## An OVERLAP probe returns `[]` for two different reasons

The same `Range` technique answers "does this decoration cover any text?" — the
question `.claude/rules/accessibility-contrast-and-modals.md` and the Tischkarte
watermark's own CSS comment are measured with. Written the obvious way it is a
filter over intersections, and **an empty result means either "it clears" or "the
probe found no ink at all"**: a typo'd selector, a card that had not rendered, a
re-render that detached the element you were holding. Every one of those reads as
a clean pass.

So force an overlap in the same call and confirm the probe sees it:

```js
mark.style.fontSize = '400px';
const hits = rects.filter(overlaps).length;   // 15 — the probe is wired
mark.style.fontSize = '';                     // back to the shipped size
```

Measured on #1132, re-checking #1075's 190px/140px watermark against a card whose
content is laid out differently: 0 overlaps at every size from 90 to 190, and 15
at 400. Only the second number makes the first one evidence.

**Compare BOX extents at your peril here too.** The first cut of that probe
compared the mark's left edge against the rightmost ink in the card and reported
an overlap that does not exist — the ink further right was 130px *below* the
mark. An overlap is a rectangle intersection in both axes; one axis is not a
cheap approximation of it, it is a different question with a plausible answer.

## Run it against the UNFIXED stylesheet first

The control is what proves the probe discriminates, and here it was decisive: the
same script on shipped CSS named `ko` as split and eight other locales as
spilling by 15–21px. Without it, the box-rect version above looks like a clean
pass. See `.claude/rules/break-the-code-on-purpose.md`.

**A CI test cannot replace this** — jsdom applies no external stylesheet, so
there is no layout to measure. Split the guard: a CSS-text assertion for the rule
that gives the label its room, plus a data assertion over the strings
(`test/score-label-fits.test.js` caps the longest unbreakable run in any shipped
`score.name`). The pixels stay a hand measurement, so write the numbers into the
CSS comment beside the rule where the next reader will find them.

**Related:** `.claude/rules/browser-pane-is-chromium-only.md` (this was measured
in Chromium only — the wrap opportunities involved are not engine-divergent, but
say so), `.claude/rules/hangul-locale-typography.md` (the `break-word` hatch,
which is correct and was not the bug), `.claude/rules/css-text-assertions-strip-comments.md`.
