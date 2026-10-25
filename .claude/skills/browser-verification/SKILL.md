---
name: browser-verification
description: >-
  Load BEFORE any check in a real browser — the Claude Code Browser pane,
  headless Chrome over CDP, headless Playwright, or the WebKit (WKWebView)
  probe. Lists the ways those instruments misreport (blank captures, swallowed
  Escape/Tab, no blur events, dead observers, throttled timers, no hyphenation,
  a Chromium-only engine, a CSSOM walk that finds nothing, mocks the service
  worker bypasses) with the probe or control that tells "the pane lied" from
  "the app is broken". Use when verifying a UI change, running an
  accessibility/UI audit or a screen deep-dive, or reviewing a PR in a browser.
---

# Verifying in a browser without believing its lies

Every instrument this repo verifies UI with has failure modes that look
**exactly** like an app bug — and each one has cost at least one session a cycle
of "fixing" working code. The full write-ups live beside this file; this page is
the index you read first, so you know which one to open when a reading looks
wrong.

**The general rule:** before believing a negative result (nothing happened,
nothing rendered, nothing matched), run a **control whose answer you already
know** in the same call — an untouched element, a bare probe with no app code, or
the bug put back on purpose. If the control misreports too, it is the instrument.

Before you start, always:

- Launch `preview_start {name: "dev-temp-data"}` — never the production data
  (`.claude/rules/no-reading-production-data.md`).
- After a shell-asset edit, defeat the service worker **and** the HTTP cache
  (`.claude/rules/pwa-service-worker.md`, "Verifying a shell-asset change").
- Prefer text probes (`read_page`, `javascript_tool`) to screenshots; take one
  screenshot at the end, right after a fresh `navigate`.

## Symptom → reference

| You see | It is probably | Read |
|---|---|---|
| A blank or half-blank screenshot; scroll/input actions time out; an animating card captures as a hole; `ResizeObserver`/`IntersectionObserver` never fire; a runtime `data-scheme` flip leaves the paint stale; `innerWidth` 0 | the pane's paint/compositor and observer gaps — `resize_window` fixes the 0×0 viewport, nothing revives the observers | [preview-pane-paint-artifacts.md](preview-pane-paint-artifacts.md) |
| Escape (or Tab) does nothing; a focus trap looks broken | the pane did not deliver the key — run the capture-phase `keydown` spy, then dispatch the event | [escape-keypresses-never-reach-the-preview-pane.md](escape-keypresses-never-reach-the-preview-pane.md) |
| A commit-on-blur editor looks completely dead | `document.hasFocus()` is false, so `blur()` fires no event — dispatch `FocusEvent('blur')` in ONE call | [blur-events-never-fire-in-the-preview-pane.md](blur-events-never-fire-in-the-preview-pane.md) |
| A probe that sleeps with `setTimeout` hangs, then later probes see impossible state | the hidden pane throttles timers — wait on the condition via `MessageChannel`, re-`navigate` after a timeout | [hidden-pane-throttles-timers.md](hidden-pane-throttles-timers.md) |
| At a phone width the viewport reads wider than you set; a menu overflows after a resize | the mobile emulation widened to fit an overflow; `resize_window` fires no `resize` | [emulated-viewport-widens-on-overflow.md](emulated-viewport-widens-on-overflow.md) |
| `hyphens: auto` splits a word with no hyphen | the pane (and Playwright's Chromium) has no hyphenation dictionaries — judge in real Chrome or WebKit | [browser-pane-has-no-hyphenation.md](browser-pane-has-no-hyphenation.md) |
| A `document.styleSheets` walk finds zero matching rules | CSS nesting made every style rule a truthy `cssRules` container — recurse on `length` | [cssrules-walk-is-blind-under-nesting.md](cssrules-walk-is-blind-under-nesting.md) |
| A layout/canvas claim verified in the pane — multicol, fragmentation, recent CSS, canvas export | the pane is Chromium; half the traffic is WebKit — run the WKWebView probe, with a control, in both engines | [browser-pane-is-chromium-only.md](browser-pane-is-chromium-only.md) |
| An exported canvas shows as a broken image; `fetch(blobUrl)` fails | the app's CSP refuses `blob:` images and fetches (and a data-URL `<img>` failed too) — draw `createImageBitmap(blob)` onto a visible canvas | [canvas-export-previews-and-the-csp.md](canvas-export-previews-and-the-csp.md) |
| Playwright `route()` mocks are ignored | the service worker issued the request and the SWR cache painted first — `serviceWorkers: 'block'`, clear `swr` keys | [playwright-mocks-and-the-service-worker.md](playwright-mocks-and-the-service-worker.md) |

## When the pane is unusable: headless Chrome over CDP

If the pane goes hidden mid-run (no screenshots: "not compositing frames") or
its input wedges, drive a headless Chrome yourself. `scripts/cdp.js` exports
`connectCdp`, a dependency-free DevTools Protocol client (Node's global
`WebSocket`); `scripts/capture-landing-shots.js` is the worked caller, with
`evaluate` and `navigate` helpers.

- Set the viewport with `Emulation.setDeviceMetricsOverride` — never
  `chrome --screenshot --window-size`, which floors the CSS viewport at 500px
  (`.claude/rules/landing-product-screenshots.md` §1).
- Capture with `Page.captureScreenshot`; off macOS set `CHROME_BIN`.
- Run it against a **scratch** server (`DATA_DIR=$(mktemp -d)`, never the
  production `data/`) with `RATE_LIMIT_MAX` and `AUTH_RATE_LIMIT_MAX` raised
  (`docs/configuration.md`): ~135 navigations trip the default limiter, and the
  429s then read as app failures.
- To wear another design as a signed-in account, `PATCH` the account's
  `design` field (`accountApi('PATCH', '/me', { design })`) and re-navigate;
  `?design=` does not stick for a logged-in account.

Real headless Chrome hyphenates, unlike the pane and Playwright's bundled
Chromium; it is still Chromium, so it does not replace the WebKit probe.

## Adding to this skill

A new learning about how a browser *instrument* misreports goes here as its own
file, plus a row in the table above — not into `.claude/rules/`, where it would
load into every session including the ones that never open a browser (#1551).
A learning about the **app's** CSS or JS that happened to be found in a browser
is still a rule, scoped to the files it lives in.
