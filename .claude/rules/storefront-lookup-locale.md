---
paths:
  - "lib/providers/**"
  - "lib/routes/lookup.js"
  - "test/providers-*.test.js"
  - "test/provider-locales.test.js"
---
# The storefronts answer in the USER's language (#505) — three premises that were wrong

The four digital storefronts (Steam, Xbox, Nintendo eShop, PS Store) used to be
pinned to one locale per deployment (`STEAM_CC`, `XBOX_LOCALE`, …), so every user
got German titles and German store links whatever language the app was in. Since
#505 the client sends its active UI locale as `?lang=` and each provider maps it
onto that store's own spelling.

The threading is the easy half. Everything below was **measured live against the
real storefronts on 2026-07-28**, and each item contradicts what the code (or
#505's own issue text) assumed. All three fail *silently*.

## 1. The requested locale must be MAPPED, never interpolated

`psstore.js` and `xbox.js` build a fetched URL **path** from the locale:

```js
`${BASE}/${locale}/search/${encodeURIComponent(query)}`
```

A request value reaching that unvalidated is a server-side request-forgery
primitive. So `lib/providers/locales.js` `resolveLocale(table, requested,
fallback)` can only ever return a value **already in the table** or the caller's
own fallback — the allowlist-not-sanitize shape `isAllowedImageUrl` uses.

Two details that are load-bearing:

- **The tables are `Map`s, not plain objects.** A request-supplied
  `?lang=__proto__` / `constructor` / `toString` reaches nothing through a Map.
- **The raw value still goes to `provider.search()`/`detail()`, which map it
  themselves.** The route only calls `resolveLocale` for the *cache key*. So
  mapping lives in exactly one place per provider and no caller can build a URL
  out of an unmapped value.

The fallback is two-tier, and the tiers differ on purpose: a locale the **UI**
knows but this store cannot serve falls back to **English** (a French user is
better served by English than by the deployment's German), while an
**unrecognised** value falls back to the provider's env var.

## 2. Xbox's `Source` field is LOCALIZED — filtering on `'Game'` empties four languages

`parseSearch` kept `s.Source === 'Game'`. Measured on one query across markets:

| market | `Source` | `Metas.ProductType` |
|---|---|---|
| de-de, en-us, nl-nl | `Game` | `Games` |
| fr-fr | **`Jeu`** | `Games` |
| es-es | **`Juego`** | `Games` |

So the moment the locale became per-request, Xbox returned **zero results** for
French, Spanish, Italian and Portuguese — with a clean `200`, no error and no
log. It reads as "Xbox just isn't finding much", which is why it would have
survived review.

**Filter on `Metas.ProductType === 'Games'`**, which is stable across every
market checked (`Devices` for the accessory suggests, likewise unlocalized).
`Source` is kept only as a fallback for an entry carrying no `ProductType`.

**The general lesson for these providers:** a storefront's *display* strings are
localized, its *identifiers* are not. Steam already got this right (it maps
category **ids**, with a comment saying the descriptions are localized and the
ids are not) and Nintendo too (`players_from`/`players_to`). Any new parser must
key on ids/enums, never on a word the store renders.

## 3. The PS Store player count varies in the SEPARATOR, not just the noun

`parsePlayers` scrapes localized prose, and #505 predicted only the noun would
change (`joueurs`, `jugadores`, …). It is worse than that:

| locale | rendered | separator |
|---|---|---|
| de-de | `1 – 2 Spieler` | en-dash |
| en-us | `1 - 2 players` | hyphen |
| fr-fr | `De 1 à 2 joueurs` | the word `à`, **plus a leading `De`** |
| es-es | `1/2 jugadores` | **a slash, no spaces** |
| it-it | `1 - 2 giocatori` | hyphen |
| nl-nl | `1 - 2 spelers` | hyphen |
| pt-br | `1 a 2 jogadores` | the word `a` |

Adding only the nouns yields **nothing at all** for French (blocked by `De`) and
Spanish (blocked by `/`). The failure is silent: the game arrives with no player
range, so it never enters a draw pool that filters on player count.

**What excludes the neighbouring online-play notice is the LEADING anchor**, not
anything at the end: the count must follow `compatText">` immediately, and every
localization of that notice opens with a word ("Admite hasta 2 jugadores
online…", "Unterstützt bis zu 2 Online-Spieler…"). A trailing `\s*<` anchor was
tried, credited in a comment, and **removed after the break-on-purpose loop
showed removing it changed nothing** — it was untested belt-and-braces that would
have silently dropped a count had Sony ever added trailing markup.

## 4. Nintendo DOES serve Portuguese — the issue said it did not

#505 stated that `searching.nintendo-europe.com` has no Brazilian locale and that
`pt` must fall back to English. Measured: `/pt/` answers `200` with fully
localized **European** Portuguese and `/pt-pt/` store paths. So `pt` maps to `pt`
there, while the other three storefronts map `pt` to Brazilian — each store's
best available Portuguese, which is not the same variety across stores.

Also measured: an **unknown** Nintendo locale (`xx`, `../../etc`) answers `200`
with an **empty doc set**, not an error. That is the quiet-failure mode the
mapping exists to prevent.

## Testing it

- **Fixtures cannot answer the questions above.** Every bug here lived under a
  green suite whose fixtures were written from the same assumption as the code —
  the same trap `.claude/rules/psstore-full-game-is-not-every-game.md` records.
  The PS Store strings in `test/providers-psstore.test.js` are therefore
  **captured live** (It Takes Two, `EP0006-…` for the European locales,
  `UP0006-…` for en-us/pt-br) and labelled with the date.
- **A PS Store product id is region-scoped**, which will waste an afternoon if
  you don't know it: `UP…` is Americas, `EP…` Europe. Fetching a `UP` id from
  `/de-de/` returns a perfectly healthy `200` with **no product on the page**, so
  a capture script reports "this locale has no player count" when it really has
  the wrong SKU.
- **`test/lookup.test.js` shares one 10-minute cache across the whole file**, so
  every locale spec needs its own search term / product id or it is answered from
  an earlier test's entry and silently proves nothing. One of these specs failed
  exactly that way first.

**Related:** `.claude/rules/add-game-lookup-provider.md` (the provider contract,
and why `lang` returning is not a revert of #117),
`.claude/rules/psstore-full-game-is-not-every-game.md` (the sibling
"the fixtures agreed with the bug" finding),
`.claude/rules/security-middleware.md` (why the four env vars are read per call).
