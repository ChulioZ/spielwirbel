# A constant the client offers and the server validates must be ONE file

The member avatar palette lived twice: `MEMBER_COLORS` in `public/js/core.js`
(what the swatches render) and a hand-copied array in `routes/members.js` (what
`PATCH …/members/:mid` validates), with a comment on the copy saying "keep in
sync". #145 darkened six of the eight hexes for WCAG AA and updated only the
frontend. Result (#420): **six of the eight colours the UI offered were rejected
with `400 Invalid color`** — for months, in production. The two lists intersected
in exactly the two colours #145 didn't need to touch.

## The rule

When the client **offers** a fixed set of values and the server **validates**
against it, they get one source of truth: a small, dependency-free file under
`public/js/` with the `module.exports` guard, loaded as a shared-scope script by
`index.html` **and** `require`d by the route.

```js
// routes/members.js
const { MEMBER_COLORS } = require('../public/js/member-colors');
```

A backend file requiring out of `public/js/` looks wrong at first glance — it is
the deliberate shape here, and the alternative ("duplicate + a parity test") was
rejected: a parity test still needs someone to remember the second copy exists,
and it is the copy nobody remembers that rots. Wire the new file into all four
places `.claude/rules/frontend-helper-modules-and-coverage.md` lists (script tag,
`SHELL`, `CACHE` bump, eslint globals — the last is a no-op if the name is
already listed).

## Why no test caught it, and what a real one looks like

Both of the obvious guards were present and both were blind:

- `test/members.test.js` pinned `const A_VALID_COLOR = '#7f77dd'` — an
  **old-palette literal**. The happy path exercised a colour the UI had stopped
  offering and passed forever. A test constant hand-copied from the thing under
  test proves nothing; **require the real source** (`MEMBER_COLORS[0]`).
- `test/a11y-contrast.test.js` parsed the array out of `core.js` only, so the
  server copy was never in its field of view at all.

So the regression test asserts **every** entry round-trips, not one:

```js
for (const color of MEMBER_COLORS) { /* PATCH, expect 200 + stored */ }
```

Verified by reinstating the pre-#145 array on purpose: with the palettes drifted
the loop fails loudly (3 red), and a single-colour test still passes green. Do
that check when you write one of these — a loop over a list you imported from the
implementation can be vacuously true if you import the wrong list.

## The symptom to recognise

Client-side validation passes (the UI only ever offers palette values), the
request goes out, the server 400s, and the app surfaces a generic failure. Nothing
throws server-side, no test is red, and the feature looks *implemented* — it just
silently doesn't work for most inputs. Any "keep in sync with X" comment across
the client/server boundary is this bug waiting to happen; grep for that phrasing
before trusting it.

## The one duplicate that is fine — and why

`TAG_ICONS` is still mirrored in `lib/tag-icons.js` and `public/js/tag-icons.js`.
That one is safe because `test/tag-icons.test.js` asserts the two lists are
**identical**, so a one-sided edit goes red immediately — which is exactly the
guard the colour palette never had. Don't read it as precedent for a fresh
duplicate: the require-the-shared-file shape is cheaper than a parity test and
cannot drift at all. (Its frontend comment says the scripts "can't `require()`
it" — true of the browser, but the *route* can require the frontend file, which
is the direction this rule uses.)

**Related:** `.claude/rules/frontend-helper-modules-and-coverage.md` (why the
shared constant gets its own small file rather than an export from `core.js` —
that one is a hard `coverage:ci` constraint).
