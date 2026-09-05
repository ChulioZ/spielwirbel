---
paths:
  - "public/js/**"
  - "eslint.config.js"
---

# Two `public/js` scripts declaring the same top-level name: `const` CRASHES the app, `function` silently takes over

`public/js/*.js` are classic `<script>`s over **one** global scope
(`frontend-script-load-order.md`). A top-level `const`/`let` there lands in the
global **lexical** environment, which is shared across scripts — so a second
script declaring the same name is not a shadow, an override, or a lint warning.
It is a **`SyntaxError` at parse time**, and because that script never runs, the
app loses it and everything that depends on it.

Measured (`node:vm`, one context, two scripts — the shape `test/support/dom.js`
and the browser both use):

```js
vm.runInContext('const dup = 1;', ctx, { filename: 'a.js' });
vm.runInContext('const dup = 2;', ctx, { filename: 'b.js' });
// -> SyntaxError: Identifier 'dup' has already been declared

vm.runInContext('function fn(){ return 1 }', ctx2, { filename: 'a.js' });
vm.runInContext('function fn(){ return 2 }', ctx2, { filename: 'b.js' });
// -> no error at all; fn() now returns 2, load order deciding
```

**The asymmetry is the whole rule.** A duplicated `const` fails loudly and
early. A duplicated `function` fails **silently and late**: the later file wins,
every caller of the earlier one now calls something else, and nothing in lint,
in the tests, or on screen says so.

## Why nothing catches it before the browser does

- **`no-redeclare` is off** for `public/js/**` on purpose — every shared name is
  both declared in its home file and listed in `globals`, so the rule would fire
  on every one of them (`eslint-frontend-shared-scope.md`).
- ESLint lints each file **independently**, so even with the rule on it could not
  see the other file's declaration.
- `node --check` is per file. `npm run check:syntax` parses each script alone,
  where a duplicate is perfectly legal.

So the first thing that can possibly notice is something that loads **all** the
scripts into **one** scope: the jsdom harness (`test/support/dom.js`), or a real
browser. Any spec using `loadApp()` fails immediately and unmistakably — which
is a good reason for a new frontend file to arrive with one.

## The check, before naming anything

One grep, and run it for **every** top-level name a new file introduces — not
just the ones that feel generic:

```bash
grep -ln "^\(function\|const\|let\) NAME\b" public/js/*.js
```

More than one hit is the bug. Caught this way on #923: `hub-insights.js` had
`const playedSessions`, which `period-recap.js` has declared since #800 — two
files a topic apart, both about deriving things from a round's sessions, so the
same obvious name occurred to both. The fix is a prefix that names the owner
(`hubPlayedSessions`), not a cleverer synonym.

**A near-collision is also a smell worth acting on.** `draw-pool.js` names its
number guard `isFiniteNum` rather than `isNumber` for exactly this reason, and
`hub-insights.js` names its ordering helper `suggestScore` rather than `scoreOf`.
Neither collides today; both would be the file everyone else's `scoreOf`
silently resolved to tomorrow.

## Two things this does NOT apply to

- **`public/js/pages/*.js`** are separate IIFEs loaded by their own standalone
  HTML pages, not part of the shared scope (CLAUDE.md §Frontend). They may name
  whatever they like.
- **A `module.exports` name.** Two modules may export the same identifier
  happily; it is the top-level *declaration* in the shared scope that collides.
  `hub-insights.js` exports `careList` and `anniversary` under those names while
  declaring them once, which is fine.

**Related:** `.claude/rules/eslint-frontend-shared-scope.md` (why
`no-redeclare` is off, and the `globals` list a new name must join),
`.claude/rules/frontend-script-load-order.md` (the other way one shared scope
bites — a reference evaluated before its file has loaded),
`.claude/rules/frontend-helper-modules-and-coverage.md` (the four wiring points
a new `public/js` file needs),
`.claude/rules/testing-views-under-jsdom.md` (the harness that makes the `const`
half fail in CI rather than in production).
