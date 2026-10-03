# Headless Playwright: block the service worker, or `route()` mocks never fire
<!-- scope: global — the trap surfaces through a verification tool (a scratch Playwright script), not through any repo file -->

When verifying a screen with headless Playwright against a local server (the
batch builders' substitute for the Browser pane), the natural way to show an
empty or young state is to mock the API: `context.route(/\/api\/rounds/, …)`.
On #1471 the mocks for `/api/rounds` and `/api/account/me` were **silently
ignored** — the lobby kept rendering the demo's three rounds, which reads
exactly like the empty-lobby branch not existing.

Two causes, both needed:

- **The app's service worker** (`public/sw.js`) registers on the first page
  load, and from then on requests go through it — Playwright's `route()` does
  not see requests a service worker issues. Create the context with
  `browser.newContext({ serviceWorkers: 'block' })`.
- **The SWR cache is persisted in `localStorage`** (`swrStore`, `core.js`), so
  the next navigation paints the cached round list before any request at all.
  Clear the `swr` keys in an `addInitScript` before each navigation.

A script that opens `/demo` per run also meets the register limiter: the second
batch of runs got `429` from `POST /api/account/demo` and timed out waiting for
the lobby. Start the scratch server with `REGISTER_RATE_LIMIT_MAX` and
`AUTH_RATE_LIMIT_MAX` raised (`docs/configuration.md`).

Control first: assert one mocked value is on screen before trusting any
screenshot of a mocked state.

**Related:** `.claude/rules/pwa-service-worker.md` (the same worker serving
stale shell assets in the Browser pane), `.claude/rules/browser-pane-is-chromium-only.md`.
