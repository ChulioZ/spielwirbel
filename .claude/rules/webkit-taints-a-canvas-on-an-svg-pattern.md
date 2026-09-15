---
paths:
  - "public/js/recap-card.js"
  - "public/js/views-chronik.js"
  - "test/recap-card-tint.test.js"
---
# WebKit taints a canvas on `createPattern(svgImage)` — `drawImage` of the same SVG is clean

The Chronik „Teilen" button toasted „Das Bild konnte nicht erstellt werden." for
every round on a **world** design, on Safari and on every iOS browser — and only
there. `recapCardBlob` (`public/js/recap-card.js`) ended in a `SecurityError`
from `canvas.toBlob()`, i.e. the export said the canvas was **tainted**.

Nothing cross-origin was ever drawn. The world ornaments are `data:` SVG URIs
read off the round's own custom properties, and the file's constraint 1 said so
in as many words: "A data: URI is same-origin, so drawing it taints nothing."
That sentence is true, and it is not what the code did:

```js
g.fillStyle = g.createPattern(mask, 'repeat');   // ← taints in WebKit
g.fillRect(0, 0, w, h);
```

Measured in a headless `WKWebView` (the probe in
`.claude/rules/browser-pane-is-chromium-only.md`), one minimal canvas per row:

| What touched the canvas | WebKit | Chromium |
|---|---|---|
| `drawImage(pngImage)` | clean | clean |
| `drawImage(svgImage)` — the same `data:` URI | **clean** | clean |
| `createPattern(svgImage, 'repeat')` | **TAINTED** | clean |
| `createPattern(canvasTheSvgWasDrawnInto, 'repeat')` | clean | clean |
| manual tiling with `drawImage(tileCanvas, x, y, …)` | clean | clean |

So it is the **pattern**, not the image and not the origin. `crossOrigin =
'anonymous'` does not help, because there is no CORS problem to solve.

## The rule

**Never build a canvas pattern from an SVG image on a canvas you intend to
export.** Rasterize the SVG into a scratch canvas first — at the backing-store
scale, or the tile ships at half resolution — and either pattern *that* canvas
or stamp it with `drawImage`. `recapTint` stamps, and guards the tile's
intrinsic size on the way: a stamping loop steps by the tile size, so a mask
reporting `0` spins forever where the pattern it replaced merely painted
nothing.

## Why nothing caught it, in any direction

- **The whole app has exactly one canvas export**, and the Browser pane is
  Chromium, where all sixteen designs export fine. The pane cannot fail this
  check — it renders correctly and reports success.
- **It is data-conditional.** Eight palettes draw no ornaments at all and
  exported fine on every engine; only the seven worlds reached the pattern. A
  spot check on a default round is green on both engines.
- **The failure is caught and toasted**, by design (`shareRecapCard` refuses to
  scold a user who dismissed the share sheet), so no console error reaches
  anybody and the browser-side telemetry is a single localized string.
- **It shipped believing the opposite.** The header comment reasoned about
  tainting explicitly and correctly, and concluded the code was safe — the gap
  was between "same-origin" and "what WebKit taints on", not an oversight about
  origins. A correct-looking rationale in a comment is not a check.

`test/recap-card-tint.test.js` is what stands in for the engine: jsdom has no 2d
context and Node has no WebKit, so it asserts the **mechanism** — that the
backdrop is stamped, that the tile is rasterized at `scale`, and that
`createPattern` is not reached — against a recording context. It cannot see the
taint itself; say so rather than reading it as engine coverage.

**Related:** `.claude/rules/browser-pane-is-chromium-only.md` (the probe, and the
general form of this trap — a claim proved on the engine that was never in
doubt), `.claude/rules/provider-cover-hotlinking.md` (the *other* reason this
canvas must stay untainted, and constraint 1's first half).
