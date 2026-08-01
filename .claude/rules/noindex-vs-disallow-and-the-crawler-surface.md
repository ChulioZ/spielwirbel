---
paths:
  - "public/robots.txt"
  - "public/sitemap.xml"
  - "public/*.html"
  - "test/seo.test.js"
  - "test/landing-copy.test.js"
---
# `noindex` and `Disallow` do OPPOSITE things — and "no robots.txt" looks like a working one (#510)

For four days after the go-live, the Google result for the public app was the
**retired shared-password login screen** — headline „Anmelden · Spielwirbel",
snippet „… Passwort … Falsches Passwort." Every string in that SERP entry came
from `public/login.html`, a page that only a self-hosted instance with
`AUTH_PASSWORD` set ever renders. Three separate mechanisms had to be understood
to fix it, and two of them fail in ways that look like success.

## 1. Disallowing a page FREEZES its index entry — it does not remove it

This is the one that matters and it reads backwards. The instinct for "get this
page out of Google" is `Disallow: /login.html`. That is the one action that makes
removal **impossible**:

| | What it does |
|---|---|
| `Disallow` in robots.txt | "do not **fetch** this" |
| `<meta name="robots" content="noindex">` | "do not **index** this" |

A crawler can only obey a `noindex` it is **allowed to fetch**. Disallow the URL
and the crawler never re-reads the page, never sees the directive, and the
existing entry survives indefinitely — a disallowed-but-already-indexed URL can
even stay listed as a bare link with no snippet. **Crawl-allowed + noindex is the
only combination that removes an already-indexed page.**

So the policy split is: **`Disallow` only for what has no head of its own to
carry a directive** (`/api/`, `/uploads/`, and the unbounded `/round/` id space,
which is served the same shell and already points its canonical at the front
door). Every HTML page we ship uses `noindex` instead and stays crawl-allowed.

**This is easy to get wrong even while writing the rule.** #510's own first draft
listed `Disallow: /admin.html` — a page that has carried a `noindex` since #268.
That entry did nothing for indexing, would have frozen the entry had the page
ever been indexed, and advertised the admin path in the one file every crawler
and vulnerability scanner reads. Caught in review, not by the tests as first
written.

Hence `test/seo.test.js` **derives** the protected list by scanning
`public/*.html` for the meta tag, rather than naming pages — a page that gains a
`noindex` later is covered with nobody remembering this test exists. It then
scans **every** `Disallow` rule, evaluated as the prefix-plus-`*` match
robots.txt actually uses, so a future `Disallow: /*.html` is caught as well as a
literal path (verified: both forms redden it).

## 2. The SPA fallback answers `/robots.txt` with `200 text/html`

There was no `robots.txt` and no `sitemap.xml` at all, and **nothing said so**:
every unmatched GET on this origin falls through to the SPA fallback and is
answered with the full `index.html`. So `GET /robots.txt` returned `200` — a
crawler asking for the crawl policy got ~11 KB of HTML, and a human spot-checking
with a browser saw a page load rather than a 404.

Same host-wide fact already documented from two other angles —
`.claude/rules/liveness-vs-readiness-probes.md` (an uptime monitor pointed at a
made-up path sits green forever) and `.claude/rules/security-middleware.md`
(`GET /made-up.js` → 200, the whole shell). **The tell is always the content
type, never the status code**, which is why the tests assert
`text/plain` / `xml` as hard as they assert the body.

Both files are plain statics under `public/`, so `express.static` serves them
ahead of the fallback, they join `assetPathSet` (crawler traffic is exempt from
the global per-IP limiter rather than spending the API budget), and
`scripts/build.js`'s `cpSync` mirrors them into `dist/` unchanged. Neither
belongs in `sw.js`'s `SHELL` — only crawlers fetch them, the same reasoning that
keeps `og-image.png` out.

## 3. Asserting "the page has crawlable text" is vacuous by default

The landing page is rendered entirely by `views-landing.js`, so the served
`<body>` held **no prose at all** and a non-rendering crawler saw an empty
document. The fix is a static hero inside `<main id="app">`, which
`showLanding()` overwrites on boot.

The obvious test for it is wrong:

```js
assert.ok(res.text.includes(de['landing.hero.title']));   // VACUOUS
```

Both hero strings already live in the **head** — `landing.hero.title` inside
`<title>` (#436), and `landing.hero.sub` verbatim as `<meta name="description">`
*and* `og:description` (#430). So that assertion passes against a document with
no body content whatsoever. Measured: it stayed green with the static hero
deleted outright, i.e. against exactly the regression it exists to catch. Scope
the match to the `<main id="app">` block, strip comments and tags, then compare.

**This was found by the break-on-purpose loop, not by review** (the discipline in
`.claude/rules/break-the-code-on-purpose.md`) — and one of the breaks in that
loop silently did not apply, because a `perl` pattern guessed the wrong
indentation and reported success. Confirm the break actually landed (`grep -c`
for the thing you removed) before reading a green suite as evidence, the same
trap `.claude/rules/session-guests-are-not-members.md` records for `node --test`
pointed at a non-existent path.

## 3b. Whether the static hero is ever PAINTED flips with the connection

The obvious worry is a flash: the static hero paints, then `showLanding()`
replaces it. Measured over CDP against real headless Chrome (the Browser pane
cannot answer this — it reports `innerWidth === 0` and produces **no paint
entries at all**), and the two answers are opposite:

| Load | first-contentful-paint | DOMContentLoaded | Hero painted? |
|---|---|---|---|
| warm, local | 128 ms | 119 ms | **no** — every sync script ran first |
| cold, slow 3G + 4× CPU | 3504 ms | 9189 ms | **yes**, for ~5.7 s |

So a warm measurement says "never painted" and would be recorded as *"there is no
flash"* — which is false for precisely the audience this change exists for: the
cold, mobile first visit arriving from a search result. **Measure this throttled
or not at all** (`Network.emulateNetworkConditions` + `Emulation.setCPUThrottlingRate`).

It is accepted rather than fixed, because the comparison is not
hero-vs-app, it is hero-vs-**blank**: before #510 that same 5.7 s window was an
empty white page. A logged-out visitor now gets exactly the right content
earlier; a logged-in one cold-loading a deep link gets on-brand copy instead of
nothing, then their app. Neither is a regression on the old behaviour.

Don't "fix" it with an inline script — `script-src` forbids it — and don't add an
early external one in `<head>` to gate the hero on a stored session: a
render-blocking request there **delays FCP for everyone**, trading the win this
change just bought for the rarest case (a logged-in user on a cold cache, i.e. a
new device; installed/returning users hit the cache-first shell and take the warm
row above).

## 4. The static hero may carry no config-gated claim

It cannot be gated on `GET /api/config`, so the operator-only EU-hosting chip and
the `data-demo-only` CTA are both excluded — publishing „EU-Hosting" on a
self-hoster's non-EU box is precisely
`.claude/rules/hidden-attribute-vs-display-rule.md`'s failure. Invisible in
practice, too: the real, correctly gated hero replaces it milliseconds later, so
only a crawler (or a first-paint screenshot) would ever show the false claim.

The three duplicated German strings have no shareable source — `index.html` is
static with no templating — so `test/landing-copy.test.js` pins them against
`lang/de.js`, and **that parity test is the licence for the copy**, the shape
`.claude/rules/shared-constants-across-the-stack.md` allows. Drift there is
silent in the worst way: every human visitor still sees correct copy, because the
JS overwrites it; only the crawler keeps reading the stale wording.

## Verifying for real

Nothing local proves a search result. The tests prove the **served bytes**; the
actual check is the live origin after deploy, plus Search Console. A recrawl is
not instant — the SERP snippet can lag by days or weeks even with an explicit
reindex request, so **a stale snippet after the deploy is not evidence the change
failed**. Same blind spot as `.claude/rules/link-preview-card.md` §"Verifying for
real", where WhatsApp and Facebook cache scrapes aggressively.

**Related:** `.claude/rules/link-preview-card.md` (the other static-head crawler
surface, and why one generic document serves every route),
`.claude/rules/liveness-vs-readiness-probes.md` +
`.claude/rules/security-middleware.md` (the same "nothing 404s on this host"
fallback), `.claude/rules/hidden-attribute-vs-display-rule.md` (the gated-claim
trap), `.claude/rules/pwa-service-worker.md` (the `CACHE` bump `index.html`
needs).
