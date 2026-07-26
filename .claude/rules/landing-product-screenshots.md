# Regenerating the landing-page product screenshots (#438)

The logged-out landing hero shows real screenshots of the app
(`public/img/landing-*.webp`, referenced from `LANDING_SHOTS` in
`public/js/views-landing.js`). They are **generated once and committed**, the same
stance as `public/icons/og-image.png` and the PWA icons — there is no image
tooling in this repo and no build step here. The full capture script lives in git
history alongside this rule's PR; the parts worth not rediscovering are below.

## 1. `chrome --screenshot` CANNOT take a phone-width screenshot

This is the one that wastes an afternoon, because the output *looks* right.
Headless Chrome floors the CSS viewport at **500px** regardless of
`--window-size`, and `--force-device-scale-factor` only scales the raster:

```
--window-size=390,844 --force-device-scale-factor=2
  -> a 780x1688 image  (looks like 390 CSS @2x)
  -> but innerWidth is 500, innerHeight 757
```

So you get a **390-CSS-wide crop of a 500-CSS-wide layout**: every `max-width`
breakpoint below 500 never fires, and the right-hand column is sliced off
mid-card. The Regal captured this way showed 2 columns of 225px bleeding off the
edge — which reads as "the app is broken on a phone", not as "the tool lied".

Diagnose it in one step: screenshot a page whose body is
`innerWidth+"x"+innerHeight`. Fix it by driving Chrome over **CDP** and calling
`Emulation.setDeviceMetricsOverride({ width, height, deviceScaleFactor, mobile })`,
which sets the viewport exactly. Node has a global `WebSocket`, so a CDP client
is ~30 lines and needs no dependency:

```js
execFile(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=9333', '--user-data-dir=' + mkdtempSync('/tmp/cdp-'), 'about:blank']);
const target = (await (await fetch('http://localhost:9333/json/list')).json())
  .find((t) => t.type === 'page');            // then connect to target.webSocketDebuggerUrl
```

CDP also encodes WebP directly — `Page.captureScreenshot({ format: 'webp',
quality: 84 })` — which matters because **`sips` can read WebP but not write it**
(`sips --formats`), and it is the only image tool on this machine.

## 2. The vote screen has no URL — you must click through the wizard

`resolveRoute` deliberately maps every transient session path back to the round
hub on a cold load (`.claude/rules/session-flow-history.md`), so
`/round/:rid/session/:sid/vote/3` cannot be navigated to. Reach it with
`Runtime.evaluate` clicks: `.hub-cta` (or `.rail__cta`) → `#go` → `#goBtn` →
`.rating .mood`. Pre-selecting a rating is worth it — a blank scale looks
unfinished.

Note the drawn game is **random each run**, so the title in the committed image
changes when you regenerate. That is cosmetic; nothing asserts it.

## 3. Never let real cover art into these images

The games in the screenshots have **invented titles and no covers**, so every
cover is the app's own `coverPlaceholder()` gradient. This is not an aesthetic
choice: a committed marketing image containing a provider's cover art would be
**re-hosting someone else's copyrighted artwork** on the most public page we
have — the precise act `.claude/rules/provider-cover-hotlinking.md` exists to
avoid, and the reason covers are hotlinked rather than downloaded.

Seed the data through the real API against a throwaway `DATA_DIR`
(`.claude/rules/no-reading-production-data.md`); leaving `background` null gives
the round the **standard theme**, which is the palette the landing page itself
renders on, so the screenshot sits in the hero instead of clashing with it.

## 4. Measure the crop height; don't guess it

A crop that slices through a **label** looks broken; one that slices through
**cover art** reads as "the page continues". Those are only a few pixels apart,
so read the geometry out of the page rather than eyeballing screenshots:

```js
[...document.querySelectorAll('.game-card')].map((c) => c.getBoundingClientRect())
[...document.querySelectorAll('.rail a, .rail button')].map((e) => e.getBoundingClientRect().bottom)
```

At 1280 CSS wide that gave: rail ends **781**, card row 2 ends **707**, row 3's
cover art spans **723–891**. Hence the committed height of **790** — the only
band where the whole rail fits *and* the cut lands inside artwork. Re-measure
after any rail or card change; the number is not portable.

## 5. Two widths, because one cannot work

A 1280px-wide desktop screenshot scaled into a 375px phone column is illegible,
and a phone screenshot stretched across a 900px hero is absurd. So the shelf
ships as a `<picture>` with a `media` switch at **720px**, and that number is
duplicated in `views-landing.js` (`LANDING_SHOT_BP`) and `styles.css`. They must
agree — if they drift, the wide shot renders inside the 300px phone cap.
`test/landing-shots.test.js` pins the agreement by parsing both.

Size each asset at **~1.8–2.2×** its widest rendered box (measured: 2.08× on a
phone, 1.79× at ≥1280px, where `--w-read` caps the column at 900px). That is the
decode-memory budget from `.claude/rules/provider-cover-sizing.md` applied to one
big image instead of many small ones.

## 6. What the test can and cannot see

`test/landing-shots.test.js` parses `LANDING_SHOTS` out of the view (never a
hand-copied duplicate — `.claude/rules/shared-constants-across-the-stack.md`) and
asserts each path is served, that the declared `width`/`height` equal the file's
**real** pixels (it parses the WebP header; Chrome writes the **VP8X** extended
chunk, whose canvas size is two 24-bit LE values at offsets 24 and 27), and that
the total weight stays under budget. All four assertions were verified by
breaking the code on purpose.

It cannot see whether the screenshot depicts anything sensible — a capture of an
error page passes every assertion. **Look at the image** before committing.

## 7. These images are deliberately NOT in the service worker's `SHELL`

Only a logged-**out** visitor ever sees the landing page, so precaching them
would cost every installed user ~120 KB for images their app never renders — the
same reasoning that keeps `og-image.png` out. But editing `styles.css` or
`views-landing.js` **does** require the `CACHE` bump
(`.claude/rules/pwa-service-worker.md`), since both *are* in `SHELL`.

**Related:** `.claude/rules/provider-cover-hotlinking.md` (why no real cover art),
`.claude/rules/preview-pane-paint-artifacts.md` (why the Browser pane cannot
verify this — it reports `innerWidth === 0`, so every media query takes the phone
branch and every rect measures ~0; CDP is the trustworthy path),
`.claude/rules/link-preview-card.md` (the sibling committed-image asset, and the
headless-Chrome recipe this extends).
