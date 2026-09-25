---
paths:
  - "public/js/vendor/**"
  - "public/js/reorder-drag.js"
  - "package.json"
  - "eslint.config.js"
---
# A vendored frontend library is a COPY — it needs a parity test, its licence, and one wrapper

There is no build step in development and `public/` is served statically, so a
browser library cannot come from `node_modules` at runtime: the file has to be
committed. SortableJS (#1180) is the first, at
`public/js/vendor/sortable.min.js`, and its shape is the template for the next.

## The five pieces, and what each one prevents

1. **Under `public/js/vendor/`, not a sibling `public/vendor/`.** `scripts/build.js`
   hashes every `*.js` under `js/` recursively, so the file is content-hashed and
   cache-busted like our own scripts. Outside `js/` it would ship un-hashed and
   served stale after an upgrade. `js/vendor/**` is the one subtree the build
   hashes but does **not** minify or rewrite (`isVendored`, #1180 review):
   re-minifying the release grew SortableJS 45.5 → 48.5 KB and made the served
   bytes differ from the one the parity test pins. `test/build.test.js` asserts
   the built copy is byte-identical.
2. **Also a `devDependency`, pinned exact.** Not `dependencies` — the server
   never requires it and the prod image runs `npm ci --omit=dev`. The point is
   that Dependabot then opens a PR on a release.
3. **A byte-identity test against `node_modules`** (`test/reorder-drag.test.js`).
   Without it, that Dependabot PR bumps the lockfile, goes green, merges — and
   the file the browser runs stays on the old version forever. It is the
   sanctioned-duplicate shape from
   `.claude/rules/shared-constants-across-the-stack.md`: the test is the licence
   for the copy. After a bump: re-copy the `.min.js` **and** the LICENSE, and
   bump `CACHE` in `public/sw.js`.
4. **The package's own LICENSE beside it** (`sortable.LICENSE.txt`), also
   parity-tested. MIT requires the notice with every copy, and the one-line
   `/*! … - MIT */` banner is a pointer, not the notice. The hashed production
   copy carries the banner because the build ships the file verbatim (point 1).
5. **Ignored by ESLint, and never edited to satisfy anything.** It sits in the
   global `ignores`. A lint fix to a vendored file would break the parity test,
   which is correct: the answer is always "re-copy", never "patch".

## Its global is NOT in `frontendGlobals` — on purpose

`test/eslint-globals-declared.test.js` requires every `frontendGlobals` name to
be declared at column 0 of some `public/js` file. A UMD bundle declares nothing
there (`(t=t||self).Sortable=e()`), so listing `Sortable` would fail that test
or need a `NOT_OURS` exemption. Instead the ONE wrapper that names it
(`public/js/reorder-drag.js`) carries `/* global Sortable */`, which also means
no other script can reach for the library without going through the wrapper —
so the options (and their reasons) are chosen once.

The wrapper returns `null` when the library is absent: a vendor script that
fails to load must leave the rest of the screen (the Tags arrows) working.

## Testing the library's consumer

jsdom loads the real vendored file (the harness parses `index.html`), so
`Sortable.get(listEl)` returns the real instance and its `options.onEnd` /
`onStart` are the view's own handlers. A spec plays the gesture's part — move
the DOM node, then call `onEnd({ oldDraggableIndex, newDraggableIndex })` —
and asserts everything after that. It must not pretend to perform a drag:
Sortable needs layout, and jsdom has none. The gesture is a browser check.

**Related:** `.claude/rules/frontend-build-cache-busting.md` (what the build
hashes), `.claude/rules/pwa-service-worker.md` (`SHELL` + `CACHE`),
`.claude/rules/eslint-frontend-shared-scope.md`,
`.claude/rules/testing-views-under-jsdom.md`.
