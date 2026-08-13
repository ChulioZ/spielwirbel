---
paths:
  - "public/img/**"
  - "public/js/views-landing.js"
  - "test/landing-shots.test.js"
  - "scripts/capture-landing-shots.js"
---
# Regenerating the landing-page product screenshots (#438, #457, #669)

The logged-out landing hero shows real screenshots of the app
(`public/img/landing-<shot>.<locale>.webp`, referenced from `LANDING_SHOTS` in
`public/js/views-landing.js` — **one set per shipped locale** since #457). They
are **generated once and committed**, the same stance as
`public/icons/og-image.png` and the PWA icons — there is no image tooling in this
repo and no build step here.

**The capture script is `scripts/capture-landing-shots.js`** — run it, then look
at every image:

```bash
node scripts/capture-landing-shots.js          # all three shots, every locale
node scripts/capture-landing-shots.js --probe  # measure geometry, write nothing
```

It was **not** committed for the first two regenerations, and this file used to
say it "lives in git history alongside this rule's PRs" — which was untrue:
neither #438's nor #457's commit contains one. #669's reshoot therefore began by
rewriting from the recipe below what two earlier sessions had already written.
The recipe is still here, because it is the *reasoning* the script encodes and
what you need in order to change it.

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
`Runtime.evaluate` clicks. The path as of #669:

`.hub-cta` (or `.rail__cta`) → **reset the Start screen** → `#go` →
`.live-vote__hotseat-btn` → `#goBtn` → `.rating .mood`

Two of those steps did not exist when this rule was written, and each fails in a
way that reads as something else:

- **The lobby step.** Per-device voting (#209/#612) means the draw lands on the
  live-vote *lobby*, where someone must claim a seat, not on the vote card. The
  old recipe's `#go` → `#goBtn` therefore finds no `#goBtn` at all, which looks
  like a broken selector rather than an extra screen. Claim a **fixed** seat, so
  both locales show the same person.
- **The Start screen restores the last draw's filters (#252).** The seed's two
  rated sessions each run with `count: 1` and a two-tag include filter (§3), so
  a draw started without resetting them re-draws that one already-rated game —
  and the card's primary action then reads „Fertig"/"Done" instead of
  „Weiter"/"Next". Nothing is broken; the hero just illustrates the *end* of a
  wizard rather than the middle of one. Reset the chips (click each round its
  cycle until neither `is-on` nor `is-excluded`) and set `#count` before `#go`.

Pre-selecting a rating is worth it — a blank scale looks unfinished.

Note the drawn game is **random each run**, so the title in the committed image
changes when you regenerate, and the two locales generally show different games.
That is cosmetic; nothing asserts it.

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

## 3a. An affordance gated on DATA cannot be reshot into existence (#752)

The seed decides which features the picture can show, and two of them are gated
on a game carrying **provider metadata** rather than on the code being current:

| Affordance | Gate | Renders nothing when |
|---|---|---|
| the vote card's ⓘ (#724/#730) | `hasGameInfo` (`public/js/game-info.js`) | the game has no weight/playtime/age/categories/mechanics |
| the Regal's „Weitere Filter" (#725) | `metadataFilterOptions` (`public/js/draw-pool.js`) | no game on the shelf carries any of them |

Both gates are deliberate — a hand-typed game must look exactly as it always did
— and the seed only ever set player counts. So #752's reshoot came out
**identical to the stale assets in the two respects it was filed about**: current
code, current app, and no ⓘ and no disclosure anywhere in frame. The issue asked
for a recapture; the recapture could not have worked.

The generalisable form: **before reshooting for a feature, check whether the seed
can make that feature appear at all.** A feature gated on data is invisible to a
"is the code current?" reading, and the failure looks exactly like the code not
having shipped.

The script therefore writes `METADATA` onto every seeded game — with the server
**stopped**, because the store rewrites the whole file on its next save
(`.claude/rules/data-json-external-edits.md`). It is the one thing the API cannot
seed: `POST …/games` takes title, player counts, tags and a cover, and the six
provider fields arrive only from a real BGG lookup or the lazy backfill, neither
of which a capture run may depend on. Numbers only and no `source`, so the run
cannot trigger an upstream request — the reasoning is in the script, next to the
table.

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

The two finished sessions must each rate **exactly one, known** game: a plain
draw is random, so the set of rated games — and therefore which cards show a `Ø`
badge rather than "new" — would change every run. Four ratings of `4,5,4,5` and
`4,4,5,4` give the committed **Ø 4.5** and **Ø 4.3** (4.25 rounds up in
`toFixed(1)`).

**They used to be direct picks (`POST …/sessions` with a `gameId`); as of #669
they cannot be.** A direct-pick session is created `done: true` — it has no
voting phase at all — so `POST …/sessions/:sid/votes/:pid` answers **400
`voting_closed`**. The only route that still writes votes onto one is
`POST …/sessions/:sid/results`, which survives *solely* so a browser running a
pre-#209 bundle out of the service-worker cache can save an evening it has
already collected, and whose comment marks it for deletion. A seed built on it
would break silently the day it goes.

So the script constrains a **draw** to a one-game pool instead, which buys the
same reproducibility through the live route: include-tag filters are **AND**, so
giving the two rated games a unique tag *pair* each (and every other game a
single tag) makes `tagIds: [t0, t1]` match exactly one game. The draw then
asserts it drew what it meant to, rather than trusting the arithmetic. Full
sequence per rated game: `POST …/sessions` (filtered) → `…/votes/:pid` per
member → `…/close` → `…/choice` → `…/finish`.

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
**707**, row 3's cover art spans **723–891**. Hence the then-committed height of
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

Re-measured for #669 (2026-08-07), same probe, both locales identical: rail ends
**689**, card row 1 ends **475**, row 2 ends **712**, row 3 runs from ~730. So
790 still held at that point — it cleared the rail by 100px and cut inside row 3's
artwork — and the wide asset's declared height was unchanged. (The rail got
*shorter*, not the cards taller: the settings group collapsed to one
„Einstellungen" entry and the archive section became „Nicht im Regal" with a
Wunschliste row.)

**Re-measured for #752 (2026-08-13) — this is the current derivation, and 790 is
now wrong.** Rail **689**, row 1 ends **557**, row 2 ends **794**, row 3 runs
811→1048. Both shelf crops moved, by a delta each layout derives for itself
rather than by a fresh "pick a band" pass: the Regal gained the bulk select/clear
toggle (#723) and the „Weitere Filter" disclosure (#725) **above** its grid, at
41px each, so the wide layout shifted +82 (790 → **872**) and the phone +41
(780 → **821**) — the phone collapses the tag half into its „Filter" chip and so
takes only the disclosure.

That is the cheapest way to re-derive this number when the change is a pure
vertical shift: **move the crop by what moved above the grid**, and the
composition measured above is preserved by construction. Re-derive from scratch
only when the cards or the rail themselves change size. The old 790 was not
merely suboptimal by then — it landed 4px *above* row 2's bottom edge, slicing
its titles, and at 390px it cut through row 3's badges.

### The vote crop is a FIXED POINT now, not a free choice (#669)

Since #666 the vote card sizes itself to the viewport, so the crop height and the
card height are mutually dependent — shrinking the crop shrinks the card, and the
usual "pick a band that doesn't slice anything" reasoning does not converge on
its own. The cover is `max(110px, min(240px, calc(100svh - 480px)))`, which
reaches its **240px cap at exactly 100svh = 720**. Measured card bottoms:

| crop height | card bottom | slack |
|---|---|---|
| 660 | 621 | 39 |
| 690 | 651 | 39 |
| 710 | 671 | 39 |
| **720** | **681** | **39** |
| 780 | 681 | 99 |

Below 720 the card just shrinks with the crop (a smaller cover buys nothing);
above it the card stops growing and the crop only adds dead space. **720 is
therefore the unique best height**, and the pre-#666 value of 780 now leaves
~100px of empty page with the „powered by BGG" footer sliding into frame — which
is what #669 actually fixed, over and above the card's own restyling. Re-derive
this table (not just re-run the probe) if the cover formula changes.

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
| `landing-shelf-wide` | 1280 × 872 | 1.25 | 1600 × 1090 |
| `landing-shelf-phone` | 390 × 821 | 1.6 | 624 × 1314 |
| `landing-vote` | 390 × **720** | 1.6 | 624 × **1152** |

(1090 rather than 1089.9, and 1314 rather than 1313.6: Chrome rounds the raster
up. Declare what the file says,
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
  number guarding the page's first paint. Today: ~118 KB (en), ~125 KB (de)
  against a 200 KB cap; a `<picture>` fetches only one of the two shelf widths,
  so the real download is smaller again.
- **The parity test is what a third language trips.** Adding a `lang/fr.js` and a
  `LOCALES` row without shooting the screenshots would otherwise ship French copy
  around German images — `landingShots()` falls back rather than breaking, so
  nothing renders wrong enough to notice.

It cannot see whether the screenshot depicts anything sensible — a capture of an
error page, or of the *wrong locale*, passes every assertion. **Look at every
image** before committing.

**What that blindness has already cost (#669).** The issue was filed about the
*vote* shot, because #666 had visibly reshaped that card. Reshooting all six
showed the two `landing-shelf-*` sets had drifted **further**, and nobody had
noticed: the rail's „Archiv" section had become „Nicht im Regal" and gained a
Wunschliste row (#560/#671), the four-item settings group had collapsed to one
entry, and the seats row had gained its `+` button. So the landing page had been
advertising a navigation the app no longer has — for weeks, with the whole suite
green. **Reshoot the whole set, not the one asset you came for**: the assets that
are stale are precisely the ones no issue was filed about, since an issue only
gets filed when someone happens to look.

**One sliver of that blindness is now covered (#752).** The suite still cannot
see a picture, but it *can* see whether the seed is able to produce a
data-gated affordance at all — so it runs `METADATA` through the two real
predicates (`hasMetadataFilterOptions`, and `hasGameInfo` via the jsdom harness,
since `game-info.js` has no exports guard). That is the whole of §3a expressed as
an assertion: a future edit dropping the metadata cannot silently reshoot the ⓘ
and the disclosure back out of the images. It says nothing about whether either
was in frame — the crop can still exclude them, and only your eyes catch that.

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
