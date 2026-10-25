---
paths:
  - "public/index.html"
  - "public/icons/**"
  - "lib/app.js"
  - "test/link-preview.test.js"
  - "test/footer-trust.test.js"
  - "test/link-preview-locales.test.js"
  - "lib/link-preview.js"
  - "scripts/render-design-marks.js"
---
# The link-preview card (#430): static tags, absolute URLs, and how to redraw it

Sharing `https://spielwirbel.app/` in a messenger renders a card built from the
`og:*` / `twitter:*` meta tags in **`public/index.html`** — or, for a
`?lang=<code>` link, from that head rewritten per language. Four things about it
are non-obvious and each fails silently.

## 1. A scraper never runs the app — so the language rides in the URL (#1727)

WhatsApp, Signal, Telegram, Slack, Discord, Discourse's onebox, Facebook and
Twitter/X fetch the document **once** and parse `<meta>`. They execute no
JavaScript and send no reader's Accept-Language, so nothing the landing page
(#322) renders through `views-landing.js` is visible to them, and the only way to
choose a language is the shared URL: `https://spielwirbel.app/?lang=fr`.

`public/index.html` carries the **German** card as static tags, and that file is
what `/`, `?lang=de` and every unknown `lang` get, byte for byte. For any other
shipped locale the SPA fallback serves the same document with the preview tags
rewritten by `lib/link-preview.js` — title and description from
`landing.hero.*`, the image `og-image-<code>.png` beside the face's card, the alt
text from `auth.promise.claim` + `linkPreview.imageAlt`. The strings are read out
of the `lang/*.js` tables through a `vm` sandbox, never copied, and the shells
are rendered once at startup from whichever directory is served (`dist/` keeps
its hashed asset refs). `<title>` and the canonical stay German/`/`: the SEO
surface is a separate decision. The same move, server-side and per language,
is what `lib/guide.js` `openGraph()` does for the guide pages.

The German static strings are copies of `de.js`, and `test/link-preview.test.js`
("the static card copy still matches…") plus `test/link-preview-locales.test.js`
(the alt text) are their licence; the per-locale head and images are pinned by
the latter, looped over `SUPPORTED_LOCALES`.

The SPA honours the same `?lang=` as its initial locale (`detectLocale()` in
`i18n.js`: saved choice → allowlisted `?lang=` → system → English) and **never
saves it** — only the picker writes `locale`, so following one French link does
not make a visitor French for good.

## 2. The URLs must be absolute, and the origin is therefore hardcoded

Several scrapers (WhatsApp among them) do **not** resolve a root-relative
`og:image`, and an `http://` URL is blocked as mixed content off the live HTTPS
origin. So `https://spielwirbel.app` is written into `index.html` and is the
`ORIGIN` constant in `lib/link-preview.js` — the same default `lib/canonical.js`
(#230) redirects every branded host to, so it is a fixed fact of this
deployment, not a guess. A fork edits those lines; the per-locale rewrite does
not template the origin and should not grow into a layer that does.

## 3. One document serves every route — so the card must stay generic

The SPA fallback returns this same `index.html` for `/round/:rid/regal` and every
other deep link. A shared round URL therefore previews as the generic app card,
which is the **required** behaviour: round, member and game names are private
tenant data and must never reach a third-party scraper's cache.
`test/link-preview.test.js` pins that a deep link's `og:title` equals the home
one and that the path's own id does not appear in the response.

Consequently a per-round preview is not a "nice extension" of this — it would be
a data-disclosure change, needing its own decision.

## 4. `<link rel="canonical">` trips the third-party-asset guard

`test/footer-trust.test.js` asserts every `<script src>` / `<link href>` in
`index.html` is root-absolute, which is how "no third-party scripts, styles or
fonts" (a published trust claim) is enforced. A canonical link is **absolute by
specification** and fetches nothing, so it is skipped explicitly there. If you
add another declarative `<link>` (`alternate`, `manifest` variants…), decide
consciously whether it loads anything before widening that exemption.

## 5. helmet's CORP breaks the image on every client-side preview renderer

The card shipped with helmet's default `Cross-Origin-Resource-Policy:
same-origin` on the PNG, and the image came back **broken** on opengraph.xyz —
while `curl -I` returned a perfectly healthy `200 image/png`. That combination is
the signature: CORP is enforced by the **browser**, not the server, so it is
invisible to any command-line check.

It splits preview consumers in two:

- **Server-side scrapers** (Facebook/WhatsApp, Telegram, Slack, Discord, Twitter)
  fetch the image from their own backends and re-host a thumbnail. They never
  evaluate CORP, so the card looked fine there.
- **Anything that renders the preview in a page** (opengraph.xyz and other
  validators, embedded preview widgets) loads our URL as a cross-origin
  subresource — and a `same-origin` CORP makes the browser drop it.

`assetCacheHeaders` in `lib/app.js` therefore sets
`Cross-Origin-Resource-Policy: cross-origin` for **the cards only** —
`og-image.png` and, since #1727, `og-image-<code>.png`. Keep
that scope: `/uploads/` is auth-gated user data and the PWA icons are only ever
loaded by our own origin, so both keep the restrictive default. The paired test
asserts the opt-out on the card *and* that `icon-512.png` still answers
`same-origin` — the second assertion is what keeps the first from being
vacuously true.

## One card per design since #1199 — `index.html` carries the FACE's

Each design's registry row names its own `og-image.png` (Der Tisch's lives in
`public/icons/tisch/` and is rendered by `scripts/render-design-marks.js`). A
scraper runs no script, so the head can only ever carry one: the **face's**, and
`test/design-marks.test.js` pins `og:image`/`twitter:image` to it — which is why
the flip (#1202) moved them to Der Tisch's card in the same change. The redraw
recipe below is Klassisch's original card; Der Tisch's is
`scripts/render-design-marks.js`, which since #1727 renders the face's card once
per shipped locale (Korean in the system CJK face — the bundled fonts have no
Hangul — so look at it). Only the FACE's card is localized: a non-face design's
card is in no head. The CORP opt-out in `assetCacheHeaders` keys on the basename,
so every design's card gets it. See
`.claude/rules/design-marks-follow-the-face.md`.

## Redrawing `public/icons/og-image.png` (Klassisch's original)

No image tooling in the repo: headless Chrome is the only rasterizer here that can
use the app's own fonts. A 1200×630 HTML page `@font-face`s the repo's woff2 by
`file://` path (Baloo 2 700 wordmark, Nunito 600/700 copy, the `ti-tornado`
swirl — `\ece2` **in this bundle**, `.claude/rules/tabler-icon-codepoints.md`),
rendered with `--headless=new --allow-file-access-from-files
--force-device-scale-factor=1 --window-size=1200,630 --screenshot`. Without the
file-access flag it renders in a fallback face (subtly wrong, not broken); without
the scale factor a Retina Mac writes 2400×1260 and the declared size lies (the
test catches that). Brand `#c2410c`, white radial top-left, white swirl,
`spielwirbel.app` beneath. **Every card stays under ~300 KB**: WhatsApp silently
drops a heavier image.

No card is in `sw.js`'s `SHELL` — only scrapers fetch them. Editing `index.html`
**does** need the `CACHE` bump, because `/index.html` is in `SHELL`
(`.claude/rules/pwa-service-worker.md`).

## Verifying for real

Nothing local proves a card renders: the tests prove the tags exist, are
absolute, that the image path is servable (a 404 there yields a card with a blank
image and no error anywhere) and that it carries the CORP opt-out. Note §5 —
`curl` cannot see the header that broke this once, because CORP is enforced in
the browser. The actual check is after deploy — paste the
link into a chat with yourself, plus one validator (opengraph.xyz, the Facebook
Sharing Debugger, Telegram's @WebpageBot). **WhatsApp and Facebook cache scrapes
aggressively**, so a second attempt after a fix needs a cache-busting query
string or an explicit re-scrape in the debugger; a stale card is not evidence the
change failed.
