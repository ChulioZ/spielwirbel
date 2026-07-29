# Regenerating the landing-page product screenshots (#438, #457)

The logged-out landing hero shows real screenshots of the app
(`public/img/landing-<shot>.<locale>.webp`, referenced from `LANDING_SHOTS` in
`public/js/views-landing.js` — **one set per shipped locale** since #457). They
are **generated once and committed**, the same stance as
`public/icons/og-image.png` and the PWA icons — there is no image tooling in this
repo and no build step here. The full capture script lives in git history
alongside this rule's PRs; the parts worth not rediscovering are below.

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

## 3b. Per locale: set it BEFORE boot, and seed the CONTENT too (#457)

Two things, and the first one has no visible failure mode other than a German
screenshot on an English page:

- **`localStorage.setItem('locale', …)` must land before the app boots.**
  `initLocale()` reads the key once at load, so setting it on a rendered page and
  screenshotting gives the *previous* locale. localStorage needs an origin, so
  the sequence is: navigate to `/` once (throwaway), set the key, then navigate to
  the screen being captured. Assert `document.documentElement.lang` in the same
  `Runtime.evaluate` that reads the geometry — it is the one cheap proof the
  capture is in the language you think.
- **Translating the chrome is not translating the screenshot.** Each locale gets
  its **own seed pass** — localized round name, member names and invented game
  titles — because an English page showing a round called „Donnerstagsrunde"
  holding „Die Krähenbrücke" is exactly the half-translated impression #457
  removed. Keep every seed the same *shape* (12 games, 4 members, 2 finished
  sessions, 4 tags) so all sets show the same badges and counts.

**Reshoot every locale in one run.** #457 re-captured the German set alongside the
new English one even though #438's assets were correct, so both come from the same
build — otherwise the sets drift apart one PR at a time, and the next person
cannot tell whether a difference between two locales is the app or the seed (§4).
The seeds therefore live in the script for *all* locales, not just the one being
added.

The two finished sessions are **direct picks** (`POST …/sessions` with a
`gameId`), not draws: a draw is random, so the set of rated games — and therefore
which cards show a `Ø` badge rather than "new" — would change every run. One
direct-pick session per rated game makes the shelf reproducible. Four ratings of
`4,5,4,5` and `4,4,5,4` give the committed **Ø 4.5** and **Ø 4.3** (4.25 rounds
up in `toFixed(1)`).

Note that only the *round* content is seeded per locale — the app's own chrome
follows the locale key, so nothing else needs duplicating.

## 4. Measure the crop height; don't guess it

A crop that slices through a **label** looks broken; one that slices through
**cover art** reads as "the page continues". Those are only a few pixels apart,
so read the geometry out of the page rather than eyeballing screenshots:

```js
[...document.querySelectorAll('.game-card')].map((c) => c.getBoundingClientRect())
[...document.querySelectorAll('.rail a, .rail button')].map((e) => e.getBoundingClientRect().bottom)
```

At 1280 CSS wide that gave (2026-07-26): rail ends **781**, card row 2 ends
**707**, row 3's cover art spans **723–891**. Hence the committed height of
**790** — the only band where the whole rail fits *and* the cut lands inside
artwork. Re-measure after any rail or card change; the number is not portable.

Re-measured for #457 (2026-07-30) the English set reads: rail **781**, card row 2
ends **682**, row 3 ends **916** — 25px above the numbers above. 790 still works
(it clears the rail and lands ~90px into row 3's artwork), and the shift is
**seed content, not app drift**: reshooting the German set in the same run
reproduced row 2 at exactly **707** again, because two German titles wrap to a
second line where the English ones fit on one.

That is the lesson — **the band moves with the content, not just with the code**,
so re-run the probe for every set you shoot rather than reusing the other
locale's number. It also makes the reshoot cheap insurance: capturing both
locales in one run is the only way to know whether a difference between them is
the app changing or the words changing.

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

The committed sizes come out of exactly two `Emulation.setDeviceMetricsOverride`
calls, and they are worth writing down because the ratios are not round numbers:

| Asset | CSS viewport | `deviceScaleFactor` | File |
|---|---|---|---|
| `landing-shelf-wide` | 1280 × 790 | 1.25 | 1600 × 988 |
| `landing-shelf-phone`, `landing-vote` | 390 × 780 | 1.6 | 624 × 1248 |

(988 rather than 987.5: Chrome rounds the raster up. Declare what the file says,
which is what `test/landing-shots.test.js` reads back out of the WebP header.)

## 6. What the test can and cannot see

`test/landing-shots.test.js` parses `LANDING_SHOTS` out of the view (never a
hand-copied duplicate — `.claude/rules/shared-constants-across-the-stack.md`) and
asserts each path is served, that the declared `width`/`height` equal the file's
**real** pixels, that **every** `SUPPORTED_LOCALES` entry has a complete set of
three (and that no set exists for a locale the app doesn't offer), that the
render sites go through `landingShots()` rather than a hardcoded locale, and that
each locale's weight stays under budget. All were verified by breaking the code
on purpose.

Three details in there are load-bearing:

- **Chrome does not always write the same WebP chunk.** The phone captures come
  out `VP8X` (extended: canvas size as two 24-bit LE values at offsets 24 and 27)
  and the wide one `VP8 ` (lossy simple: 14-bit width/height after the start
  code). The reader handles `VP8X`/`VP8 `/`VP8L` and **throws** on anything else
  rather than guessing — a silently mis-read header would fail the dimension
  assertion for a reason that has nothing to do with the image.
- **The weight budget is per locale, not a committed total.** A flat total gets
  laxer per visitor with each language added, which is backwards for the one
  number guarding the page's first paint. Today: ~118 KB (en), ~120 KB (de)
  against a 200 KB cap; a `<picture>` fetches only one of the two shelf widths,
  so the real download is smaller again.
- **The parity test is what a third language trips.** Adding a `lang/fr.js` and a
  `LOCALES` row without shooting the screenshots would otherwise ship French copy
  around German images — `landingShots()` falls back rather than breaking, so
  nothing renders wrong enough to notice.

It cannot see whether the screenshot depicts anything sensible — a capture of an
error page, or of the *wrong locale*, passes every assertion. **Look at every
image** before committing.

## 7. These images are deliberately NOT in the service worker's `SHELL`

Only a logged-**out** visitor ever sees the landing page, so precaching them
would cost every installed user ~120 KB for images their app never renders — the
same reasoning that keeps `og-image.png` out. Since #457 that is ~120 KB **per
locale**, of which any one visitor renders at most one set, so the argument only
got stronger. But editing `styles.css` or `views-landing.js` **does** require the
`CACHE` bump (`.claude/rules/pwa-service-worker.md`), since both *are* in `SHELL`.

**Related:** `.claude/rules/provider-cover-hotlinking.md` (why no real cover art),
`.claude/rules/preview-pane-paint-artifacts.md` (why the Browser pane cannot
verify this — it reports `innerWidth === 0`, so every media query takes the phone
branch and every rect measures ~0; CDP is the trustworthy path),
`.claude/rules/link-preview-card.md` (the sibling committed-image asset, and the
headless-Chrome recipe this extends).
