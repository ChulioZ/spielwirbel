---
paths:
  - "public/index.html"
  - "public/icons/**"
  - "lib/app.js"
  - "test/link-preview.test.js"
  - "test/footer-trust.test.js"
---
# The link-preview card (#430): static tags, absolute URLs, and how to redraw it

Sharing `https://spielwirbel.app/` in a messenger renders a card built from the
`og:*` / `twitter:*` meta tags in **`public/index.html`**. Four things about it
are non-obvious and each fails silently.

## 1. It must be static HTML — a scraper never runs the app

WhatsApp, Signal, Telegram, Slack, Discord, Facebook and Twitter/X fetch the
document **once** and parse `<meta>`. They execute no JavaScript, so nothing the
landing page (#322) renders through `views-landing.js` — hero title, tagline,
trust chips — is visible to them. That is why the copy is written literally into
the head and is **not** in `lang/*.js`: there is no locale to react to, and the
i18n-parity test is deliberately not involved. German, one version, for everyone.

## 2. The URLs must be absolute, and the origin is therefore hardcoded

Several scrapers (WhatsApp among them) do **not** resolve a root-relative
`og:image`, and an `http://` URL is blocked as mixed content off the live HTTPS
origin. `index.html` is served as a static file — there is no place to
interpolate `CANONICAL_HOST` without giving up static serving and the
`assetCacheHeaders` hashing rules — so `https://spielwirbel.app` is written into
the file. That is the same default `lib/canonical.js` (#230) redirects every
branded host to, so it is a fixed fact of this deployment, not a guess. A fork
edits those lines; don't build a templating layer for it.

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
`Cross-Origin-Resource-Policy: cross-origin` for **`og-image.png` only**. Keep
that scope: `/uploads/` is auth-gated user data and the PWA icons are only ever
loaded by our own origin, so both keep the restrictive default. The paired test
asserts the opt-out on the card *and* that `icon-512.png` still answers
`same-origin` — the second assertion is what keeps the first from being
vacuously true.

## Redrawing `public/icons/og-image.png`

There is no image tooling in the repo (same stance as the PWA icons — generated
once, committed as static files). The card was produced with **headless Chrome**,
which is the only rasterizer on this machine that can use the app's own fonts:
no Pillow, no rsvg-convert, no ImageMagick.

Write an HTML file at exactly 1200×630 that `@font-face`s the repo's own woff2
files by `file://` path — `baloo-2-latin-700-normal.woff2` for the wordmark
(`--font-display`), `nunito-latin-600/700` for the copy, and
`tabler-icons.woff2` for the swirl mark (`ti-tornado` is `\ece2` **in this
bundle** — verify against the bundled cmap, never tabler.io, see
`.claude/rules/tabler-icon-codepoints.md`). Then:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --allow-file-access-from-files --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1200,630 \
  --screenshot=og-image.png "file:///abs/path/og-card.html"
```

`--allow-file-access-from-files` is what lets the page load those woff2 files;
without it the card renders in a fallback face and looks subtly wrong rather than
broken. `--force-device-scale-factor=1` keeps the output exactly 1200×630 on a
Retina Mac — otherwise you get 2400×1260 and the declared
`og:image:width`/`height` no longer match the file (which the test catches).

Design: brand `#c2410c` with a soft white radial at the top-left, white swirl
mark, "Spielwirbel" in Baloo 2 700, the tagline in Nunito 600, and
`spielwirbel.app` beneath — the same visual family as `icons/icon-512.png`.
**Keep the file under ~300 KB** (currently ~84 KB): WhatsApp is the pickiest
consumer and silently drops an image that is too heavy.

The PNG is deliberately **not** in `sw.js`'s `SHELL` — only scrapers ever fetch
it, so precaching it would cost every installed user a download for nothing. But
editing `index.html` **does** require the `CACHE` bump (`spielwirbel-shell-vN`),
because `/index.html` *is* in `SHELL` — see
`.claude/rules/pwa-service-worker.md`.

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
