---
paths:
  - "lib/providers/**"
  - "lib/prices/**"
  - "lib/routes/lookup.js"
---
# A request value that lands in a fetched URL must be an ALLOWLIST lookup, never interpolated

Several outbound hops build the URL they fetch out of something the caller sent.
`resolveMarket` in `lib/prices/boardgameprices.js` puts a destination and a
currency in a query string; `COLLECTION_STATUS` in `lib/providers/bgg.js` puts a
shelf name in one; the `SOURCES` map in `lib/prices/index.js` picks a module by a
stored provider name.

**The rule:** such a value may only ever be *looked up* in a closed table, and the
function must be able to return **only** a table entry or the caller's own
fallback. Never `` `${BASE}/${locale}/search/${q}` `` with an unvalidated value —
that is a server-side request-forgery primitive, and it looked entirely ordinary
in the code that had it.

Two details are load-bearing:

- **The table is a `Map`, or a plain object read through `hasOwnProperty`.** A
  request-supplied `?x=__proto__` / `constructor` / `toString` reaches nothing
  through a `Map`, and reaches `Object.prototype` through an object literal.
- **The fallback is the caller's, not the value's.** An unrecognised value falls
  back to something the deployment chose; it never gets normalised into a "close
  enough" one. Same allowlist-not-sanitize shape as `isAllowedImageUrl` and as
  `ci-passed`'s `!= 'success'` (`.claude/rules/ci-aggregate-gate.md`).

## The corollary: a store's IDENTIFIERS are stable, its DISPLAY STRINGS are not

The other half of the same lesson, and it fails silently in a way the first does
not — no error, a clean `200`, and simply no results.

**Key every parser on ids and enums, never on a word the provider renders.** It
was measured on the Xbox storefront (retired in #744, so this is the surviving
statement rather than the incident): filtering suggestions on `Source === 'Game'`
returned **zero results in French, Spanish, Italian and Portuguese**, because
that field is localized (`Jeu`, `Juego`) while the neighbouring
`Metas.ProductType === 'Games'` is not.

BGG is the live instance today: `parseLinkValues` keeps BGG's own English
category and mechanic strings **unmodified** — both because the licence forbids
rewriting retrieved data and because they are the stable key, even in the German
UI.

## History

This was `storefront-lookup-locale.md`, written up for the four digital
storefronts' per-user locale (#505). #744 retired those providers, and
with them every measurement in that file — the PS Store player-count separators,
Nintendo's Portuguese, the region-scoped `UP…`/`EP…` product ids. What survived
is the shape above, which four source files and two rules cite as the canonical
statement of it, so it gets a file rather than dying with its examples.

**Related:** `.claude/rules/bgg-collection-import.md` (`COLLECTION_STATUS`, the
sharpest instance — the wrong shelf answers with a full, plausible, completely
wrong list), `.claude/rules/wish-list-prices.md` (`resolveMarket`),
`.claude/rules/add-game-lookup-provider.md` (the provider contract),
`.claude/rules/security-middleware.md` (the CSP allowlist, the same shape one
layer out).
