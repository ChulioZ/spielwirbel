---
paths:
  - "public/js/designs.js"
  - "public/js/design.js"
  - "public/index.html"
  - "public/manifest.webmanifest"
  - "public/icons/**"
  - "lib/web-manifest.js"
  - "scripts/render-design-marks.js"
  - "test/design-marks.test.js"
---
# A design's marks: three readers, one registry row — and the static head belongs to the FACE

Every design brings its own app icon, favicon, apple-touch icon and link-preview
image (#1199, operator decision after the Tisch review). They live in the
registry row's `marks` (`public/js/designs.js`) and three things read them:

| Reader | What it does with them |
|---|---|
| `lib/web-manifest.js` | `GET /manifest.webmanifest?design=<id>` answers with that design's icons, `theme_color` (its accent) and `background_color` (its page) |
| `public/js/design.js` `applyDesignMarks` | re-points `<link rel=manifest/icon/apple-touch-icon>` when a design is worn |
| `test/design-marks.test.js` | every file exists at the size it declares, and is served |

## 1. The static `<head>` of `index.html` is the FACE's, and a test pins it

A scraper (og:image) and an install that happens before any script runs only
ever see `index.html`'s static tags. So those tags must be **the face's marks**
(`FACE_DESIGN`), and `test/design-marks.test.js` asserts it tag by tag. The
consequence is deliberate: **the flip (#1202) cannot move `FACE_DESIGN` without
moving the head in the same change** — the one-line flip goes red until the icon,
apple-touch, manifest and both image tags follow. That is the whole point; don't
"fix" the test by reading the head from the registry at runtime (scrapers run no
script, `.claude/rules/link-preview-card.md` §1).

## 2. The account's design reaches the manifest through the URL, never a cookie

The issue left open whether the route should read "the account's design when the
manifest is fetched with credentials". It does not. The page already knows what
it wears, so `manifestHref()` puts the id in the query and the server answers
from the URL alone: no account read on an ungated route, the response identical
for everyone asking the same URL (no `Vary`, cacheable), and the `/uploads`
access cookie keeps its single job. The face gets the bare path, so the static
file — bytes, headers, ETag — is exactly what production served before.

An id that is not **selectable on this instance** falls back to the face. In
production that means an unreleased design (`enabled: false`) cannot leak its
icons through this route; the spec flips `NODE_ENV` to prove it.

## 3. What no test can see: an INSTALLED app keeps its icon

Browsers re-read the manifest on their own schedule, iOS reads the apple-touch
icon once at "Add to Home Screen", and Android does not swap a launcher icon it
already has. So switching design changes the icon **on the next install**, not
on the home screen someone already has. That is platform behaviour, stated here
and in the route's header so nobody files it as a bug — and so nobody tries to
"fix" it by adding an `id` to the manifest, which would change what production
serves for every existing install.

## 4. Rendering them

`node scripts/render-design-marks.js [id]` renders every PNG to the path its
registry row names — headless Chrome over CDP (never `chrome --screenshot`, which
floors the viewport at 500px and breaks every icon below it,
`.claude/rules/landing-product-screenshots.md` §1), colours read out of the
design's own token block, the whirl from `public/js/card-glyphs.js`. Klassisch
has no recipe: its white die on orange is the committed original and stays
Klassisch's for good. Look at every image; the test checks sizes, not pictures.

**Related:** `.claude/rules/link-preview-card.md` (the og tags, CORP — the
opt-out keys on the basename, so every design's `og-image.png` gets it),
`.claude/rules/pwa-service-worker.md` (which marks are precached and why),
`.claude/rules/theme-color-meta-tag.md` (why `theme_color` is the accent).
