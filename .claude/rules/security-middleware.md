# helmet CSP + rate limiting gotchas (lib/app.js)

Security headers (`helmet`) and rate limiting (`express-rate-limit`) are wired in
`createApp()` (issue #130). Two things are non-obvious and cost effort:

- **Don't let helmet's default CSP emit `upgrade-insecure-requests`.** helmet's
  default CSP includes it, which tells the browser to upgrade every request to
  HTTPS. The app currently runs plain **HTTP** locally, so that directive breaks
  same-origin asset loading. We drop it (`'upgrade-insecure-requests': null`).
  Also keep **`style-src 'unsafe-inline'`** and **`img-src … data:`**: the views
  build inline `style="…"` attributes (avatar colours, cover `background-image`,
  score pills) and the background grain is a `data:` SVG — a stricter CSP blanks
  those with no JS error, only a silent CSP violation in the console.

- **Read the rate-limit ceilings *inside* `createApp()`, not at module load.**
  `const LIMIT = Number(process.env.RATE_LIMIT_MAX)` at the top of `lib/app.js`
  binds once at require-time, so a test that sets the env var later (or
  `test/helpers.js` raising it) has no effect and the limiter can't be driven
  deterministically. Read `process.env.RATE_LIMIT_MAX` / `RECS_RATE_LIMIT_MAX`
  per call so each `createApp()` picks up the current env and gets its own
  in-memory limiter store. `test/helpers.js` raises both ceilings to ~1e6 so the
  ordinary suite never trips them; `test/security.test.js` builds fresh apps with
  tiny limits to assert the 429s.

**Why the suite is structured this way:** the limiter store is per-app-instance
and per-process. `node --test` isolates files, but *within* a file the shared
`app` from helpers is reused across every request — a low ceiling there would
make unrelated tests flake once they exceed it (the recommendations spec alone
POSTs ~12 times). Hence: raise limits on the shared app, test the limiter on
throwaway apps.
