# Add tests with new features; keep the suite green

<!-- scope: global — a discipline that applies to every change, not a file set -->

<!-- scope: global — a discipline that applies to every change, not a file set -->

There is an automated test suite: `npm test` (runs `node --test`, Node's built-in
runner — no framework, no build). Tests live in `test/*.test.js`; `supertest` is
the only test dependency and drives the Express app in-process (no port opened).

**Rule:** when you add or change a feature and a test is applicable, add or update
tests for it, and make sure `npm test` still passes before considering the work
done. The non-obvious parts below are why this is easy to get wrong:

- **Never call `app.listen()` in `lib/app.js`.** `lib/app.js` only *builds* the
  app (`createApp()`); `server.js` is the only place that listens. Tests require
  `lib/app.js` so they must not open a port. If you add middleware/routes, wire
  them in `createApp()`, not in `server.js`.

- **`DATA_DIR` must be set before the store is required.** `lib/store.js` reads
  `data.json` into memory *once at require-time*. A test that wants an isolated,
  empty dataset has to set `process.env.DATA_DIR` to a temp folder **before** the
  first `require('../lib/store')` (transitively via `lib/app.js`). Don't require
  the store/app at the top of a test and set `DATA_DIR` after — you'll get the
  real `data/` or an already-cached instance. Use `test/helpers.js`, which does
  this in the right order and exports a ready `app`. `node --test` runs each file
  in its own process, so each test file gets its own fresh temp dataset.

- **i18n parity is tested.** `test/i18n-parity.test.js` fails if `en.js` and
  `de.js` drift out of key parity or have an empty value — so adding a key to only
  one file will (correctly) break the suite. Add it to both.

- **A green new test is not yet evidence it works.** You have to have seen it
  red. Prefer writing it **first** — for a new feature, and especially for a bug
  fix, where the test should reproduce the bug before you fix it; that red is
  free. When the behaviour already works (a guard over existing code, a CSS/HTML
  text assertion), break the code on purpose instead and watch one *named* test
  go red. `.claude/rules/break-the-code-on-purpose.md` has both routes, what each
  one's red actually proves, and the vacuous greens this repo has shipped.
