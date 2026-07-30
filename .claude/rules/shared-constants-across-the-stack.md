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
and it is the copy nobody remembers that rots.

**The second instance is `public/js/locales.js`** (#504): the shipped UI locales,
offered by the language picker and validated by `routes/contact.js` for the
feedback-metadata `locale`. It replaced a hand-copied `['de', 'en']` in that
route — which had the palette bug's exact failure mode waiting, one locale
further on: feedback sent from any language nobody remembered to add there loses
the very field needed to route a "this wording is wrong" report. See
`.claude/rules/locale-set-is-data.md` for why a test over that list is *vacuous*
until you register a synthetic locale. Wire the new file into all four
places `.claude/rules/frontend-helper-modules-and-coverage.md` lists (script tag,
`SHELL`, `CACHE` bump, eslint globals — the last is a no-op if the name is
already listed).

**The third is `public/js/session-people.js`** (#458, #575): `MAX_SESSION_GUESTS`,
`GUEST_NAME_MAX` and `MIN_TEAM_SIZE`, offered by the guest and team pickers and
required by `routes/sessions.js`. It is the sharpest case of the three, because the server is
deliberately **lenient** — it truncates an over-long guest list and an over-long
name instead of 400ing — so a drifted client copy would silently drop guests and
clip names with **no error anywhere**, i.e. the palette bug's failure mode minus
even the eventual 400 that exposed it. See
`.claude/rules/session-guests-are-not-members.md`.

Each new instance must be named in this inventory — the three paragraphs above.
`test/rule-enumerations.test.js` asserts every `require('../public/js/…')` under
`routes/` and `lib/` appears in it, because the list had already gone stale by one
before anyone noticed. The check reads only the inventory section, so mentioning a
module further down this file does not satisfy it.

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

## The second one: when sharing the file is not available at all (#391)

`public/kontakt.html` declares its own `:root` copy of the app's design tokens
(`--brand`, `--page-bg`, `--ink`, the two font stacks …). This is **not** a
violation of the rule above, because the cheap fix does not exist here: the page
is a standalone document outside the SPA, and the only way to "import" the real
tokens is `<link href="/styles.css">`, which drags the entire 2400-line SPA
stylesheet — including its own `body`, `.card` and `.input` rules — onto a page
that has no round context and must render for a logged-out visitor. There is no
smaller unit to share; `:root` in `styles.css` is also where a **per-round theme**
gets written, which this page must never inherit.

So it takes the TAG_ICONS shape deliberately: a copy plus
`test/contact-page-brand.test.js`, which walks every custom property the page
declares and asserts `styles.css` still declares the same value. Retune `--brand`
in one file and it goes red naming both values. **The test is the licence for the
copy** — if you add another token to the page, it is covered automatically; if you
ever make the page stop declaring them, delete the test with it.

Use this as precedent only under the same condition: *sharing is structurally
impossible*, not merely inconvenient. A copy that could have been a `require()`
is still the palette bug.

**Related:** `.claude/rules/frontend-helper-modules-and-coverage.md` (why the
shared constant gets its own small file rather than an export from `core.js` —
that one is a hard `coverage:ci` constraint).
