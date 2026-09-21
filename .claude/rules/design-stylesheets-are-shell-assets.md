---
paths:
  - "public/js/designs.js"
  - "public/js/design.js"
  - "public/css/**"
  - "public/sw.js"
  - "scripts/build.js"
---

# A per-design stylesheet is a SHELL asset injected by JS — two invalidation traps, both silent

`public/css/designs/<id>.css` (#1184) is the first asset in this repo that is a
**shell asset** (precached, cache-first, must work offline) *and* whose `<link>`
is created at runtime by `design.js` rather than shipped in `index.html`. That
combination breaks both halves of the app's cache-busting in ways nothing goes
red over.

## Trap 1 — a runtime-BUILT href survives the build unrewritten, then 404s

The natural loader is `'/css/designs/' + id + '.css'`. `scripts/build.js`
rewrites only **properly-quoted whole paths** (`rewriteRefs`), so an assembled
one is invisible to it — and the build *deletes* the un-hashed copy. So the
stylesheet 404s on every built deploy, i.e. in production only, while working
perfectly on `npm start` and in every test.

**The path is therefore a literal, quoted string in the registry:**

```js
{ id: 'tisch', stylesheet: '/css/designs/tisch.css', … }   // public/js/designs.js
```

**Which forces the build's two phases, and the order is the rule.** `css/**` is
hashed *first* and the new names rewritten into the js **sources** before those
are minified and hashed:

```js
hashInto(cssAssetsToHash(outDir), null);      // css first
hashInto(assetsToHash(outDir), { ...manifest });  // then js, rewritten
```

Do not "simplify" that to one pass, and do not rewrite the js *after* hashing it
— the second is the subtler mistake. A file's hash is derived from its content,
so rewriting content under an already-derived name means a stylesheet change
would **not move `designs.js`'s own hash**: the SW would re-precache a
`/js/designs.<oldhash>.js` whose bytes had silently changed, which is the exact
class of stale-asset bug the hashing exists to prevent.

## Trap 2 — an unlisted design stylesheet installs FINE and then serves stale forever

`sw.js`'s `SHELL` must list it. The failure is asymmetric and that is what makes
it expensive:

- **Omit it and nothing breaks loudly.** `cache.addAll` rejects on a 404, so a
  *wrong* path fails install noisily — but an *absent* entry is not a 404. The
  design simply is not precached: it is fetched from the network the first time
  anyone wears it, and then cached by the generic cache-first handler under
  whatever it happened to get. It never updates again, and it is missing offline.
- So bump `CACHE` (`spielwirbel-shell-vN`) for **every** change to one of these
  files, exactly as for any other shell asset. `deriveCache` mixes the source
  literal in (#617), so the bump is the working invalidation on the built path
  too.

`test/pwa.test.js` asserts every `SHELL` entry is served, which catches a typo'd
path. Nothing can catch the *omission* — that is what this file is for, and it
is measured rather than assumed: deleting the `'/css/designs/tisch.css'` line on
purpose leaves `test/pwa.test.js` and `test/build.test.js` **fully green**.

(That test's sibling — "every script index.html loads is precached" — derives
its list from the markup, which is why a missing *script* IS caught. A design
stylesheet has no markup to derive from: the whole point is that design.js
injects it. So there is nothing to generalise the derivation from, and the
omission stays a discipline.)

## The colours do NOT go in these files

Stated here because it is the first thing a design author reaches for.
`test/a11y-contrast.test.js` resolves each design's tokens out of `styles.css`
from the registry's `page`/`accent`/`scheme` (`test/support/theme.js`), so a
colour declared in a design's own stylesheet is **invisible to the contrast
suite** and ships unmeasured — the #145 class of regression, on a surface nobody
has looked at yet. Colours in `designs.js`, layout in the stylesheet. A design
that genuinely needs to override a derived token (`--surface`, `--ink`, …) has to
teach the harness to read design stylesheets first.

**Related:** `.claude/rules/pwa-service-worker.md` (the `SHELL`/`CACHE` contract
this is an instance of, and the snippet for verifying a shell-asset change in a
browser), `.claude/rules/frontend-build-cache-busting.md` (what the build hashes
and why the `CACHE` literal is in the digest),
`.claude/rules/frontend-helper-modules-and-coverage.md` (the four wiring points
any new `public/js` file needs — `design.js` deliberately has no
`module.exports`), `.claude/rules/accessibility-contrast-and-modals.md` (the
suite the last section protects).
