# The Browser pane is Chromium — a layout claim verified there is a Chromium claim

<!-- scope: global — the trap is a property of the verification tool, not of any file it is pointed at -->

Every in-browser check in this repo runs in the Claude Code Browser pane, which
is Chromium (148 at the time of writing). Roughly half the app's traffic is
WebKit — Safari on macOS, and **every** browser on iOS, where the PWA is
installed. So a rendering claim proved in the pane is proved on the engine that
was never in doubt.

That is not a hypothetical. #944 shipped three multi-column card flows with a
`getBoundingClientRect()` sweep in the pane confirming every column flush, and
the CSS comment plus `.claude/rules/css-multicolumn-card-flows.md` point 5 both
recorded the mechanism as measured. It was measured, and it was Chromium's:
WebKit does not truncate a margin adjoining a column break, so the public home
screen sat visibly wrong for every Safari and iOS visitor until #946 — reported
by the operator, from a screenshot, because nothing else could have found it.

**The pane cannot fail this check loudly.** It renders the page perfectly, the
sweep returns clean numbers, and the numbers are true. There is no error, no
warning and no way to tell from inside the pane that the engine is the variable.

## When to reach for the probe

Not for every UI change. The engines agree on the overwhelming majority of
layout; reaching for a second engine on ordinary work is waste. Reach for it
when the change lands on something the engines are **known or likely to differ
on**:

- **CSS Fragmentation** — multicol, `break-inside`/`break-before`, what happens
  to a margin at a column or page break. This is where #946 lived.
- Anything the spec leaves to the UA, or that MDN/caniuse flags as partial.
- `:has()`, container queries, subgrid, `text-wrap`, scroll-driven animation —
  recent features WebKit shipped on its own timeline.
- Anything where the natural implementation reads "the browser trims/collapses
  this for us".

## The probe: a headless WKWebView, no Safari automation, no download

The system WebKit is on every Mac and is scriptable in ~25 lines. Build once
(`swiftc -O wk.swift -o wk`), then `./wk <page.html> <measure.js> [width]`
prints whatever the script returns.

```swift
// wk.swift
import AppKit
import WebKit
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let args = CommandLine.arguments
let page = URL(fileURLWithPath: args[1])
let js = try! String(contentsOfFile: args[2], encoding: .utf8)
let width = Double(args.count > 3 ? args[3] : "1100")!
let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: width, height: 900))
final class D: NSObject, WKNavigationDelegate {
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      webView.evaluateJavaScript(js) { res, err in
        if let err = err { print("ERR \(err)") } else { print(res ?? "nil") }
        exit(0)
      }
    }
  }
}
let d = D()
wv.navigationDelegate = d
wv.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
DispatchQueue.main.asyncAfter(deadline: .now() + 25) { print("TIMEOUT"); exit(2) }
RunLoop.main.run()
```

`measure.js` is one expression returning a JSON **string** — the bridge will not
hand back a plain object. The page is a minimal document that `<link>`s the real
`public/styles.css` and builds synthetic content, so you are measuring the
shipped stylesheet rather than a paraphrase of it.

Swapping `evaluateJavaScript` for `takeSnapshot(with:)` writing a PNG gives a
**picture** from WebKit, which is what closes the loop on a bug the operator
reported from a screenshot.

## Four things that will cost you an hour each

- **Run the same script in BOTH engines, and run the CONTROL.** "WebKit says 0"
  is not a fix; "WebKit said 18 before and 0 after, Chromium said 0 both times"
  is. The pre-fix control is what proves the probe can see the bug at all —
  otherwise a probe that measures the wrong box reports success.
- **`getClientRects()` returns one rect per fragment in Chromium and a single
  rect in WebKit.** Judge fragmentation by width, never by rect count.
- **Measure synchronously.** No `requestAnimationFrame` — it does not fire in a
  hidden pane, and in the WKWebView it costs a callback you then have to await.
- **The pane blocks `eval`** (CSP `script-src 'self'`), so a measurement fetched
  as text cannot be run there. Load it as a `<script src>` that assigns its
  result to a global, and read the global.

## A `display: none` element reports NO transform — which reads as an engine bug

The probe above compares one script's output between the engines, so anything
that differs is, by construction, a candidate finding. On #1017 the synthetic page
rendered both pool presentations at once (the app picks one by width), and WebKit
at 1280px reported the shelf covers at **0°** where the panel tiles read −6°
(that branch tilted every cover from an inline custom property; the tilt did not
ship) — i.e. "WebKit ignores the custom property in `transform`", on exactly the
feature being checked.

It does not. `getComputedStyle(el).transform` on an element inside a
`display: none` subtree resolves to `none`, and `new DOMMatrix('none')` is the
identity, whose `atan2(b, a)` is **0**. A missing rotation and a hidden element
produce the same number, and the number is a plausible answer to the question
asked.

The tell is symmetry, and it is one extra run: at 390px the same script reported
the **shelf** at −6° and the **panel tiles** at 0°, with `panelHidden: "none"`.
Each presentation reads 0 exactly where it is hidden, which is the correct
behaviour rather than an engine difference — and it was Chromium reporting the
identical pair on the identical page that settled it.

So when a cross-engine reading looks like a finding, **check whether the element
was rendered at all** before believing it. Report `getComputedStyle(el).display`
beside every geometric reading in the measurement script — it costs one field and
it is the difference between a finding and an hour.

**Related:** `.claude/rules/css-multicolumn-card-flows.md` (point 5, the claim
this file exists because of), `.claude/rules/preview-pane-paint-artifacts.md`
and `.claude/rules/blur-events-never-fire-in-the-preview-pane.md` (the other
half of "the pane is lying to you" — those are about the pane not being a real
browsing context; this one is about it not being the only engine).
