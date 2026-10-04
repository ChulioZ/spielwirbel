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
consequence is deliberate: **`FACE_DESIGN` cannot move without moving the head in
the same change** — which is exactly what the flip (#1202) did, moving favicon,
apple-touch, both image tags and `theme-color` to Der Tisch's marks along with
the standalone pages' icons. The bare manifest URL answers with the face's
derived manifest; Klassisch's static file answers `?design=klassisch`. That is the whole point; don't
"fix" the test by reading the head from the registry at runtime (scrapers run no
script, `.claude/rules/link-preview-card.md` §1).

## 2. The account's design reaches the manifest through the URL, never a cookie

The issue left open whether the route should read "the account's design when the
manifest is fetched with credentials". It does not. The page already knows what
it wears, so `manifestHref()` puts the id in the query and the server answers
from the URL alone: no account read on an ungated route, the response identical
for everyone asking the same URL (no `Vary`, cacheable), and the `/uploads`
access cookie keeps its single job. The face gets the bare path. A colourless
design (Klassisch) is answered with the static file itself — bytes, headers, ETag;
a design with its own colours (Der Tisch, the face since #1202) with the static
file re-dressed in its icons and colours.

An id that is not **selectable on this instance** falls back to the face. In
production that means an unreleased design (`enabled: false`) cannot leak its
icons through this route; the spec flips `NODE_ENV` to prove it — and, with
every design live since Ocean (#1222), gates one for the length of the test,
because a skip would leave the guard unproven until the next design arrives.

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

**Every coloured design (one with a `page`) wears its OWN marks** under
`/icons/<id>/`, and its favicon + 192 — never more — are in `SHELL`;
`test/design-marks.test.js` asserts both. Die Brücke and Das Programmheft sat on
Klassisch's orange die until #1419 because their recap-card slices scoped the
marks out, and nothing went red. A new design needs a recipe here, and **the
whirl is in every design's icon** (operator decision on #1436, which first
shipped a lamp for Die Brücke and a bare masthead for Das Programmheft): the
design dresses it — lit cyan in brackets, ink on the vermilion masthead — but
never replaces it.

**Off macOS, point `CHROME_BIN` at the binary** (`scripts/cdp.js`); as root,
Chromium also needs `--no-sandbox`, so aim `CHROME_BIN` at a two-line wrapper
script that adds it rather than committing the flag. On Linux Chromium a capture
right after a viewport CHANGE painted the previous size's layout (#1475: the
first 512px icon after the 192 showed the ground restarting 438px down), so
`render()` waits two frames after the fonts — look at the 512s first.

**Forest's marks are its wordmark badge** (#1475) — the flat Laubgrün disc with
the whirl on the clearing's light ground, the favicon the bare disc — and
`test/forest-marks.test.js` reads their PIXELS at points only that composition
satisfies (light corners, disc inside the maskable safe circle), since the
generic spec checks sizes only.

**Related:** `.claude/rules/link-preview-card.md` (the og tags, CORP — the
opt-out keys on the basename, so every design's `og-image.png` gets it),
`.claude/rules/pwa-service-worker.md` (which marks are precached and why),
`.claude/rules/theme-color-meta-tag.md` (why `theme_color` is the accent).
