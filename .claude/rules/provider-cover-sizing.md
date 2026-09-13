---
paths:
  - "public/js/cover-size.js"
  - "lib/providers/**"
  - "test/cover-size.test.js"
---
# Provider covers are print-resolution masters — size them at RENDER time (#298)

Since #172 a provider cover is hotlinked, so `game.image` holds whatever URL the
provider handed us. For Sony and Microsoft that is the **full master**, and the
numbers are not marginal — measured live on 2026-07-20:

| Provider | Stored URL | Bytes | Decoded |
|---|---|---|---|
| BGG | `…/fit-in/200x150/…` (was `246x300` before #117) | 4–13 KB | small |
| Steam | `…/capsule_231x87.jpg` | ~50 KB | small |
| Nintendo | `nintendo.com/…` | ~100 KB | medium |
| **Xbox** (retired #744, data cleared #981) | `store-images.s-microsoft.com/…` | **207–837 KB** | large |
| **PS Store** (retired #744, data cleared #981) | `image.api.playstation.com/…` | **1.0–1.7 MB** | **3840×2160** |

`public/js/cover-size.js` → `coverUrl(image, width)` rewrites those two hosts to
a sized variant at every render site. A 14-game PS shelf went **13,196 KB → 239
KB (55×)**, i.e. ~17 KB/cover — the same order as a BGG shelf.

## The table is CLOSED since #981 — and `COVER_RESIZERS` is empty

#744 retired PS Store and Xbox as lookup providers, and from then until #981 this
file was about legacy DATA: the ~66 covers already stored on those hosts still
rendered through the resizers, so deleting the rules as "dead code" would have
sent every one of them back to a 1–2 MB master. That asymmetry — refused by the
*write* gate (`isAllowedImageUrl`), kept on the *render* one
(`imageCspSources`) — was the whole point.

#981's operator action cleared those rows, so both halves collapsed together: the
resizers went, the hosts left the CSP, and the four storefronts left the privacy
policy. **`COVER_RESIZERS` is empty today, and that is a fact about the DATA, not
about the machinery.** BGG serves one modest size, so nothing needs rewriting —
the next provider that hands over a master adds a row here and inherits the whole
mechanism.

**Two things that means for a test in this area.** Every `coverUrl` case is now a
pass-through, so an assertion that the URL comes back unchanged is satisfied by a
function that returns its argument unconditionally: `test/cover-size.test.js`
pushes a **synthetic** rule onto `COVER_RESIZERS` to prove the rewrite still
happens at all, and three view specs do the same rather than keeping a dead
storefront host as a fixture. And the empty table is itself asserted — a rule
with no provider behind it rewrites a URL nothing can produce.

## The finding that explains the symptom: decode memory, not download

The reported bug was *scroll jank*, and the tempting culprit was the blurred
`::before` backdrop (`styles.css`, #181). It was a symptom. A PS master is
**3840×2160 = 8.3 MP = 31.6 MB of decoded RGBA per cover**; the sized variant is
504×284 = **0.29 MB**. A 14-card shelf therefore held ~442 MB of decoded bitmap
before this change and ~4 MB after — **108× fewer pixels**.

So don't "fix" the blur layer. The blur was expensive only because it operated
on an 8.3 MP source; at 0.08 MP it is free, and the `::before`/`::after`
`background-image: inherit` structure (which
`.claude/rules/deterministic-cover-placeholders.md` explains) stays untouched.
If cover jank is ever reported again, **measure `naturalWidth × naturalHeight`
first** — that number, not transferSize, is what predicts it.

## Three things that are load-bearing

- **The "already has a query string" guard is not hypothetical.** The Xbox
  *search* hit's thumbnail already arrives as `?w=150&h=150` (the *detail*
  `imageUrl` is the bare master). Appending a second `w=` would produce a
  malformed query. It is also what lets a future capture-time change coexist.
- **Only add a host after checking its CDN honours the parameter.** Nintendo's
  ignores `?w=` — the response is byte-identical — so listing it would add noise
  and no benefit. BGG and Steam are already right-sized. An unrecognised host
  passing through untouched is the safe default, and own uploads
  (`/uploads/<key>`) must pass through byte-identically since we serve those
  ourselves and have no resizer.
- **geekdo (BGG) can NEVER join `COVER_RESIZERS` — its transform paths are
  signed.** Verified 2026-07-22: hand-editing the size segment of a
  `cf.geekdo-images.com` URL (`fit-in/900x600` → `300x200`, or `__imagepage` →
  `__original`) returns **400**, and appending `?w=`/`?imwidth=` is ignored
  byte-for-byte. So the variant BGG hands us is the only one we get, and
  **which one it hands us is the whole decision**: the XML API's `<image>` is
  the untouched master (measured across eight popular games: 68 KB – 2.0 MB,
  Ark Nova at 1.96 MB / 1 MP+), while `<thumbnail>` is a pre-sized
  `fit-in/200x150` at 4–13 KB. `pickImage()` in `lib/providers/bgg.js` takes
  the thumbnail and does **not** fall back to `<image>` — a fallback would
  quietly reintroduce megabyte covers on exactly the items with unusual data.
  The trade is accepted knowingly: it is roughly half the linear resolution the
  pre-#117 private endpoint served, so a new BGG game's cover is softer on the
  game-detail hero. **#868 widened that hero from 240 px to 300 px**, so a
  `fit-in/200x150` thumbnail now upscales 1.5× there rather than 1.2× — the
  softness argument below got *stronger*, not weaker, and the hero is the one
  frame in the app where it is visible. Re-hosting a resized copy is now
  *licensed* (the BGG token grants reproduction rights) but needs an image
  pipeline this repo does not have — that is the follow-up, not a reason to store
  the master.
- **It must be render-time, not capture-time.** This repo keeps no permanent
  migration code (CLAUDE.md), so rewriting what `pickImage()` stores would fix
  only games added afterwards and leave the whole existing corpus slow. On
  render, every already-linked game is fixed on its next load and the stored
  value stays the provider's canonical URL.

## The server guard needs no change — but verify it

`providerCoverUrl()` (`lib/providers/index.js`) rejects `'`, `"`, `(`, `)`,
backslash and whitespace, because `game.image` is interpolated into
`background-image:url('…')`. `?w=330&h=330&q=90` contains none of them.
`test/cover-size.test.js` asserts this rather than assuming it, so a future
resizer whose query needs an unsafe character fails loudly instead of opening a
CSS-injection hole.

## Verifying it in the preview pane

The Regal grid's covers are lazy (`createCoverLoader`, #198), and the Claude
Code Browser pane reports **`window.innerHeight === 0`**, so its
IntersectionObserver **can never fire** and every grid cover stays blank no
matter how you scroll. That looks exactly like a broken lazy loader. It isn't —
it is the pane artifact family documented in
`.claude/rules/preview-pane-paint-artifacts.md`, and `resize_window` does not
fix it.

Verify instead via a path that doesn't depend on the observer:
- the **game-detail hero** and the **voting screen** set `background-image`
  inline, so they exercise the real render path immediately; or
- apply what `loadCover` would apply yourself, then read
  `performance.getEntriesByType('resource')` and assert every provider request
  carries the expected `?w=`.

Also unregister the service worker and clear its caches first — the shell is
served cache-first, so a stale `cover-size.js` will silently hide your change.
