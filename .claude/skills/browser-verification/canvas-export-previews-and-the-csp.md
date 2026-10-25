# Previewing an exported canvas in the pane: `<img>` previews fail — draw a bitmap instead

The obvious way to look at a share card in the Browser pane — render the blob,
then `img.src = URL.createObjectURL(blob)` — shows a **broken-image icon**. So
does the next obvious fix, a `FileReader` data URL, and `fetch(blobUrl)` throws
`TypeError: Failed to fetch`. Met on #1726 checking six designs' cards.

None of that is the card. Two of the three are the app's Content-Security-
Policy (`lib/app.js`): `img-src` has no `blob:`, and `connect-src` is `'self'`
only, so `fetch(blobUrl)` is refused. The data-URL `<img>` failing is NOT
explained by it — `img-src` lists `data:` — and the cause was not established
(1–2 MB data URLs in the pane). Either way the pane refuses to paint a
perfectly good PNG, which reads exactly like an export that produced garbage.

**The working shape:** keep the `Blob`, decode it with
`createImageBitmap(blob)` (not gated by CSP), and draw the bitmap onto a visible
`<canvas>` in a fixed overlay. Scale it there to fit the viewport, or draw it at
1:1 with a negative offset and `zoom` the screenshot to inspect a detail such as
a strip under a title. Keep the bitmaps on `window` so one render feeds every
screenshot.

**Control:** the size the bitmap reports (`bmp.width × bmp.height`, e.g.
1080×1350) proves the export worked before you trust or distrust the picture.

This is Chromium only. Whether an export is clean in WebKit is the WKWebView
probe's job ([browser-pane-is-chromium-only.md](browser-pane-is-chromium-only.md));
run it with a known-tainting control (`createPattern` from an SVG image), or a
"clean" answer proves nothing.
