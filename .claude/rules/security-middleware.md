# helmet CSP + rate limiting gotchas (lib/app.js)

Security headers (`helmet`) and rate limiting (`express-rate-limit`) are wired in
`createApp()` (issue #130). Five things are non-obvious and cost effort:

- **Don't let helmet's default CSP emit `upgrade-insecure-requests`.** helmet's
  default CSP includes it, which tells the browser to upgrade every request to
  HTTPS. The app currently runs plain **HTTP** locally, so that directive breaks
  same-origin asset loading. We drop it (`'upgrade-insecure-requests': null`).
  Also keep **`style-src 'unsafe-inline'`** and **`img-src … data:`**: the views
  build inline `style="…"` attributes (avatar colours, cover `background-image`,
  score pills) and the background grain is a `data:` SVG — a stricter CSP blanks
  those with no JS error, only a silent CSP violation in the console.

- **`img-src` also lists the provider cover hosts, derived from the providers'
  `IMAGE_HOSTS` (issue #179).** `lib/app.js` spreads
  `require('./providers').imageCspSources()` into `img-src` so the browser may
  **render** the same hosts the server is allowed to **download** from
  (`isAllowedImageUrl`) — one source of truth for "hosts we trust for covers".
  Without it, every provider cover is cross-origin and CSP-blocked, so the
  add-game preview, the link-provider cover preview, and the lookup dropdown
  thumbnails silently show nothing (only a CSP violation in the console). Each
  provider's download guard accepts a host `h` **and any subdomain**
  (`host === h || host.endsWith('.' + h)`), so `imageCspSources()` emits both the
  bare `h` and a `*.h` wildcard (a lone `*.h` doesn't match the apex). Keep it
  derived — add a provider's hosts to its `IMAGE_HOSTS` and both the download
  allowlist and the CSP stay in sync; don't re-hardcode hosts in `lib/app.js`.
  `test/security.test.js` asserts every `imageCspSources()` entry is on `img-src`.
  Note this is *not* a widening to arbitrary hosts — it's exactly the download
  allowlist (no wildcards to third parties). A same-origin image proxy is the
  tighter alternative for a hardened hosted deploy; deferred to the hosting work.

- **The ceilings are meaningless if `req.ip` isn't the caller — see
  `.claude/rules/trust-proxy-is-a-hop-count.md`.** Every limiter here keys on
  `req.ip`, which is decided by `TRUST_PROXY` (a hop *count*). Production ran one
  too low, so `req.ip` was Railway's edge proxy and all four ceilings were buckets
  shared by every visitor behind it. Check `req.ip` against a real client address
  before trusting any per-IP reasoning about these limits.

- **Read the rate-limit ceilings *inside* `createApp()`, not at module load.**
  `const LIMIT = Number(process.env.RATE_LIMIT_MAX)` at the top of `lib/app.js`
  binds once at require-time, so a test that sets the env var later (or
  `test/helpers.js` raising it) has no effect and the limiter can't be driven
  deterministically. Read `process.env.RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX`
  per call so each `createApp()` picks up the current env and gets its own
  in-memory limiter store. `test/helpers.js` raises the ceilings to ~1e6 so the
  ordinary suite never trips them; `test/security.test.js` builds fresh apps with
  tiny limits to assert the 429s.

- **A per-IP cap counts PAGE LOADS, not just calls — so the shell is exempt
  (#464).** The global limiter is mounted ~115 lines ahead of `express.static`,
  so before #464 every script, font and stylesheet spent one request from the
  same 1000-per-15-min budget as an API write. `index.html` pulls **35
  `<script src>` + 6 `<link>`**, plus 8 woff2 faces and the icons, so a load
  missing both the HTTP cache and the service worker costs **~50 requests** — and
  a hard reload (`Cmd+Shift+R`) bypasses both. That put the lockout at **~20 hard
  reloads**, i.e. squarely inside what an operator does while diagnosing an
  incident: the app degrades, they reload, they trip their own DoS defence, and
  everything 429s for the rest of the window. Self-amplifying, and unclearable —
  the store is in memory and per process (#215), so the only exits are waiting or
  a restart. A request spike during the 2026-07-26 degradation matched it.

  **The skip is an EXACT path set, not an extension test — and that distinction
  is the whole lesson.** `assetPathSet(ASSET_DIR)` walks the asset tree once per
  `createApp()`; the skip is `assetPaths.has(req.path)`. The obvious
  implementation — "does the path end in `.js`/`.css`/`.woff2`" — is wrong in a
  way that is *worse than the bug it fixes*, and nothing about it looks wrong:

  **A path that merely looks like an asset matches no file, falls through
  `express.static`, and is answered by the SPA fallback with the whole
  `index.html`.** Measured: `GET /made-up.js` → **200, `text/html`, ~10.8 KB**.
  So an extension-based skip makes an *unlimited* number of invented asset names
  free, each returning the full shell — trading a self-inflicted lockout for an
  amplification vector. This was caught by probing the fallback before believing
  the design, not by review; the naive version passed every test written for it
  until the made-up-name case was added.

  **The same fallback bites outside the limiter**, so it is worth knowing as a
  fact about the host rather than a fact about this skip: *no* invented path on
  this origin 404s on a GET. That is why an uptime monitor cannot be tested by
  pointing it at a made-up URL — it sits green and proves nothing. See
  `.claude/rules/liveness-vs-readiness-probes.md`.

  An exact set also dissolves three carve-outs the extension version needed, all
  of which fail silently: **`/uploads`** (cover keys are `<id><ext>`, so they are
  indistinguishable from assets by extension, and they are auth-gated user bytes
  streamed from object storage), **`/api`**, and **extensionless SPA deep links**.
  None of them are files we ship, so membership answers all three at once. Match
  on `req.path`, never `req.url`, so a `?v=` cache-buster can't defeat it.

  Staleness is harmless by construction: a file added after boot is merely
  *counted*, never mis-served — the set decides counting only, and an unreadable
  asset dir yields an empty set (exempt nothing), so it fails closed.

  `test/security.test.js` asserts an asset storm well past the ceiling leaves the
  API budget **completely untouched** — the weaker "did the asset 200" form would
  pass against a skip that merely made assets cheaper. Both tests were verified
  by breaking the production code on purpose: removing the `skip` reddens the
  exemption test, and substituting the naive extension regex reddens the
  made-up-name test. Back the files up to the scratchpad first — `git checkout`
  restores from the index and discards the whole uncommitted change
  (`.claude/rules/css-text-assertions-strip-comments.md`).

**Why the suite is structured this way:** the limiter store is per-app-instance
and per-process. `node --test` isolates files, but *within* a file the shared
`app` from helpers is reused across every request — a low ceiling there would
make unrelated tests flake once they exceed it (a single spec can issue dozens
of requests). Hence: raise limits on the shared app, test the limiter on
throwaway apps.
