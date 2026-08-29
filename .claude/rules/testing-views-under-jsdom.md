---
paths:
  - "test/support/dom.js"
  - "test/feed-report.test.js"
  - "test/editor-presentation.test.js"
  - "test/home-empty-cta.test.js"
  - "test/home-dashboard.test.js"
  - "test/round-settings.test.js"
  - "test/dup-hint-live-region.test.js"
  - "test/i18n-locales.test.js"
  - "test/session-share.test.js"
  - "test/players-plural.test.js"
  - "public/js/views-friends.js"
  - "public/js/views-home.js"
  - "public/js/views-round-detail.js"
  - "public/js/views-round-settings.js"
  - "public/js/views-round-actions.js"
  - "public/js/views-round-lookup.js"
  - "public/js/views-regal.js"
  - "public/js/views-chronik.js"
  - "public/js/views-pokale.js"
  - "public/js/views-archive.js"
  - "public/js/core.js"
---

# Test a view by RUNNING it — `vm` + jsdom, and never `require()`

`test/support/dom.js` (#602) boots the real frontend in a jsdom window so a spec
can render a view and assert on the nodes it builds. Before it, anything that
only exists once a view had run was asserted with a regex over the view's own
source — a statement about the text, not the behaviour.

```js
const { loadApp } = require('./support/dom');
const dom = loadApp({ locale: 'de' });       // t.after(() => dom.close())
dom.set('api', async () => round);           // stub the network, not the helpers
await dom.call('showGameDetail', 1, 7);
dom.document.querySelector('.tag--players').click();
```

## `require()`-ing a view is the trap the whole design exists to avoid

`vm.runInContext` executes a frontend file **without entering the coverage
report**; `require` pulls its whole body in, and a DOM view file is largely
unreachable line-by-line, so it lands near 10% and drags `coverage:ci` under its
90% floor. That is a red `coverage` check with **every test green** and nothing
in the output naming the cause
(`.claude/rules/frontend-helper-modules-and-coverage.md`; −11 points from a
single export on #281). Verified on #602: with five specs converted, no
`views-*.js` or `core.js` appears in the coverage table and the figure sits at
~99%.

## What the harness can and cannot reach

- **The script list is parsed from `index.html`**, minus `main.js`/`pwa.js`
  (bootstrap + SW registration) — so a new frontend file is picked up with no
  edit here, and the load order is the real one.
- **`set()` only replaces `function`-declared globals**, because those are the
  ones that are properties of the global object. A top-level `const`/`let` lives
  in the global *lexical* scope, where an outside assignment is invisible — the
  same fact `.claude/rules/in-app-nav-links.md` §1 states about `window.*`.
  Convenient rather than limiting: every global worth stubbing (`api`,
  `accountApi`, `toast`, `accountsActive`, `isLoggedIn`) is a function, and the
  lexical ones (`h`, `esc`, `profilePath`) are pure helpers a spec wants real.
  `set` **asserts** on a name it cannot replace rather than silently no-opping.
- **A `const` is readable but not callable by property**: use `dom.get('h')` /
  `dom.run('…')`, not `dom.context.h` (which is `undefined`).
- **A view nested inside another view is not callable** — the three game-detail
  editors live inside `showGameDetail`. Render the screen and click the trigger;
  that is a better test anyway.
- **Some renderers append to the global `app` and return nothing**
  (`renderRegalTab`, `renderChronikTab`) while others return a node
  (`renderFeedEvent`). Read `dom.app` after calling, or you get
  `undefined.querySelectorAll`.
- **`matchMedia` never matches** — jsdom has no layout. Stub it to stand in for
  the viewport width; that is how the editors' 860px sheet/popover routing is
  tested.
- **jsdom applies no external stylesheet**, so `getComputedStyle` answers about
  inline styles only. Everything CSS stays parsed out of `styles.css` via
  `test/support/css.js`. Converting a CSS assertion would replace a working
  check with a vacuous one.

## Fixtures: use the shape the repo actually returns

Two wrong-field mistakes cost time on #602 and both render a *plausible* screen
rather than throwing:

- a game's title field is **`title`**, not `name` (the heading rendered
  "undefined" and every other assertion still passed);
- the home grid takes a **`listRoundSummaries`** row (`memberCount`,
  `gameCount`, `background`, `lastPlayed`), not an invented object.

Also note `showGameDetail` suppresses the dashed chips on a **sparse** game and
renders the onboarding panel instead — a bare fixture has no chips at all, and
every selector misses for a reason unrelated to the test.

## Scope a selector to the screen — the RAIL is in `dom.app` too

`renderSubScreenTabs` prepends the desktop rail into `#app`, and the rail carries
its own `<h1>` **and its own `.gd-title`** (the round-name editor,
`views-round.js`). So `dom.app.querySelector('.gd-title')` on a game-detail spec
returns the *round* name — and clicking it opens the round editor, which builds a
`.rn-title-input`. The assertion that follows finds no `.gd-title-input` and
reports "clicking the title opened no editor", i.e. it names the feature under
test as broken while the real one was never touched. Met on #663.

Scope to the screen's own container (`.gd-head .gd-title`, `.gd-head h1 .tag--…`).
`test/back-control.test.js` filters `.rail`/`.dock` out of `#app` for the same
reason — treat that as the norm, not as one spec's quirk.

## `deepStrictEqual` fails on anything the VIEW constructed

An object a view built — a request body handed to a stubbed `api` — is created
inside the vm context, so it carries **that** realm's `Object.prototype`.
`assert/strict`'s deep equality compares prototypes, so it reports "Values have
same structure but are not reference-equal" on two objects that print
identically. Spread it into this realm first (`{ ...calls[0].body }`), or assert
field by field.

## The pane's falsehoods do NOT apply here

jsdom is not the Claude Code Browser pane. `blur`/`focusout` **do** fire
(`.claude/rules/blur-events-never-fire-in-the-preview-pane.md` is about the
pane), `document.activeElement` tracks properly, and focus restoration is
directly assertable. What jsdom still cannot answer is paint, layout, and
whether a glyph looks like a flag (`.claude/rules/tabler-icon-codepoints.md`),
so a real browser pass stays part of the workflow for visual work.

## Converting an assertion is not free — take the red

A converted test replaces a *passing* regex, so Route 1 is unavailable and
break-on-purpose is mandatory
(`.claude/rules/break-the-code-on-purpose.md`). It found a real gap on #602:
a DOM check for the `hidden` attribute made **at render time** stayed green
against `dupHint.hidden = !state` reintroduced inside `refreshDupHint`, which
only fires on input — i.e. the region left the accessibility tree exactly when
it mattered, and the new test could not see it. Re-check state-dependent
attributes **after each transition**, not only on first render.

Two traps met while breaking the code, both from `break-the-code-on-purpose.md`
and both worth restating because they produced confident, wrong reds:

- a `perl` substitution aimed at `btn.addEventListener('click'` hit an **earlier
  match** — `async () => {` — deleting the opener and leaving a syntax error, so
  *every* test in the file reddened and the real assertion proved nothing. Run
  `node --check` on the broken file and confirm the red names your test.
- a break whose injected label used a **non-existent i18n key** rendered the key
  itself, so a test looking for „Einladen" stayed green against a genuinely
  reintroduced control.

**Related:** `.claude/rules/frontend-helper-modules-and-coverage.md` (the
coverage gate this is shaped around), `.claude/rules/break-the-code-on-purpose.md`
(why a converted test must still be seen red),
`.claude/rules/frontend-script-load-order.md` (the load order the harness
reproduces).
