---
paths:
  - "public/js/recap-card.js"
  - "public/js/views-chronik.js"
  - "public/js/recap-card-tisch.js"
  - "public/js/card-glyphs.js"
  - "public/js/shelf-profile-card.js"
  - "test/recap-card-tisch.test.js"
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
or stamp it with `drawImage`. The fix that shipped (`recapTint`, #1149) stamped,
and guarded the tile's intrinsic size on the way: a stamping loop steps by the
tile size, so a mask reporting `0` spins forever where the pattern it replaced
merely painted nothing.

**Since the flip (#1202) no card draws SVG at all.** The worlds were the only
thing that put a mask on the card, and they went with `recapTint` and its spec.
The rule stands for the next design that wants artwork on a share card.

## Why nothing caught it, in any direction

- **The whole app has exactly one canvas export**, and the Browser pane is
  Chromium, where all sixteen designs export fine. The pane cannot fail this
  check — it renders correctly and reports success.
- **It is data-conditional.** Eight palettes draw no ornaments at all and
  exported fine on every engine; only the seven worlds reached the pattern. A
  spot check on a default round is green on both engines.
- **The failure is caught and toasted**, by design (`shareRecapCard` refuses to
  scold a user who dismissed the share sheet), so no console error reached
  anybody and the only trace was a single localized string on the user's own
  screen. **#1149 changed that half and only that half**: the catch is unchanged
  and still toasts, but it now also calls `reportClientError('recap_export', err)`,
  so a recurrence of *this* fault shows up in the operator panel's
  „Browser-Fehler" card with the browser engine beside it — which is the one
  field that would have made this bug obvious at a glance. The general discipline
  is `.claude/rules/caught-client-faults-are-invisible.md`; the toast is still
  what the user sees, so don't read the report as a reason to surface more.
- **It shipped believing the opposite.** The header comment reasoned about
  tainting explicitly and correctly, and concluded the code was safe — the gap
  was between "same-origin" and "what WebKit taints on", not an oversight about
  origins. A correct-looking rationale in a comment is not a check.

## Der Tisch's card (#1199) sidesteps the whole class

`public/js/recap-card-tisch.js` draws no SVG and no pattern at all: surfaces are
gradients and flat fills, the wood grain is stamped stripes, and every icon —
faces, crown, check, whirl — is a `Path2D` fill of the bundled Tabler outline
(`public/js/card-glyphs.js`), which needs no image decode and no font load. The
one image is the same-origin BGG badge PNG via `drawImage`. Exported in headless
Chromium **and** a headless WKWebView (non-persistent store) for a session, a
split session and a period recap: all clean. `test/recap-card-tisch.test.js`
pins the mechanism, the same way the spec below does.

It paints from a **copy** of Der Tisch's tokens, not the live cascade — the
names (`--page-bg`, `--gold`, `--ink`) are shared by every design, so under a
round still on its own light palette (possible until the flip) the dark block
was off and a live read returned Klassisch's cream and orange (measured). The
copy is licensed by a parity test against `test/support/theme.js`.

A spec can only stand in for the engine by asserting the **mechanism** against a
recording context — jsdom has no 2d context and Node has no WebKit — so it
cannot see the taint itself; say so rather than reading it as engine coverage.

**Related:** `.claude/rules/browser-pane-is-chromium-only.md` (the probe, and the
general form of this trap — a claim proved on the engine that was never in
doubt), `.claude/rules/caught-client-faults-are-invisible.md` (the reporting this
bug is the worked example for), `.claude/rules/provider-cover-hotlinking.md` (the *other* reason this
canvas must stay untainted, and constraint 1's first half).
