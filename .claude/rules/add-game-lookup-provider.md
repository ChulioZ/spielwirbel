---
paths:
  - "lib/providers/**"
  - "lib/routes/lookup.js"
  - "lib/routes/games.js"
  - "public/js/views-round-lookup.js"
  - "public/js/lookup-score.js"
  - "public/js/lookup-cover.js"
  - "public/js/lookup-group.js"
  - "public/js/lookup-title.js"
  - "test/providers.test.js"
  - "test/lookup*.test.js"
  - "test/provider-*.test.js"
---

# Add-game lookup providers — how they work, and what to check before adding one

The add-game title field is a search-as-you-type lookup (`lib/providers/`,
`lib/routes/lookup.js`, `showAddGame`/`attachLookup` in
`public/js/views-round-lookup.js`). Provider endpoints have no CORS headers, so
**all provider calls run server-side** through `/api/rounds/:rid/lookup/*`; the
browser never calls a provider. The frontend queries every provider in
`LOOKUP_PROVIDERS` in parallel and merges the hits (round-robin interleave) into
one dropdown; one provider failing (502) must not blank the others' results
(`Promise.allSettled`).

## Since #744 there is exactly ONE provider, and that was a deliberate retirement

**BoardGameGeek is the registry.** PS Store, Steam, Nintendo eShop and Xbox were
unregistered and their modules deleted; the per-round `providers` setting that
existed to switch them off went with them, so the lookup is unconditional. Four
facts decided it, and they are the checklist a fifth provider has to answer:

1. **Is it allowed?** Two of the four were being queried against explicit written
   prohibitions — Microsoft's Terms of Use ("You may not obtain … any materials
   or information through any means not intentionally made available through the
   Services", plus personal-non-commercial-use), and playstation.com's §10 ban on
   "any text or data mining or web scraping", framed as an Art. 4(3) DSM /
   § 44b Abs. 3 UrhG reservation. `robots.txt` said nothing about either. **Read
   the terms, not the robots file** — and note the answer differed per store:
   Steam's SSA "Automation" clause sits in a gameplay-integrity section and binds
   *subscribers*, and Nintendo of Europe's search host publishes no terms at all,
   so those two were defensible and were retired on maintenance grounds instead.
2. **Will anyone use it?** Measured on production 2026-08-11, demo tenants
   excluded: BGG carried **97.9%** of linked games, the four storefronts 0.45%
   between them once the operator's own shelf was excluded, and Nintendo had
   never once been used successfully.
3. **Does it break silently?** PS Store search had been **returning nothing at
   all** for an unknown length of time: Sony stopped server-rendering results, so
   the `__NEXT_DATA__` blob shrank from ~377 KB to ~4.6 KB with `page: null` and
   zero product links. Status 200, valid JSON, parser working correctly, unit
   tests green throughout — because they run against captured fixtures. See the
   fixture trap in `.claude/rules/bgg-collection-import.md`.
4. **Is there a replacement?** Evaluated and rejected in #744: IGDB (Twitch's
   terms cap caching at 24 h and forbid re-syndication — we store permanently),
   MobyGames (clean fit, $99.99/mo), Wikidata (0.6% of video games carry an
   image), TheGamesDB (no published licence), GiantBomb (non-commercial only),
   SteamGridDB (fan art, DMCA history). MobyGames Bronze is the documented
   starting point if digital games ever become a real segment.

**What did NOT go:** every stored `game.source` link, every stored cover, the
`COVER_RESIZERS` rules for the PS/Xbox hosts, and those hosts' place on the CSP
`img-src` allowlist. See `LEGACY_COVER_HOSTS` in `lib/providers/index.js` — the
render permission is deliberately no longer derived from the registry, because
retiring a provider must not blank covers already on people's shelves.

## The cross-provider merge ranking must FOLD before it tokenizes (#317)

`scoreHit` (`public/js/lookup-score.js`) tiers each hit by how well its title
answers the query; `groupLookupHits` then breaks **ties** by `LOOKUP_PROVIDERS`
position, and any tie *within* one provider by the shorter title (#527). So
provider priority is only ever meant to order *equally relevant* hits — which
makes any bug that collapses distinct relevance to a shared `0` present itself as
**"the wrong provider wins"**, and hides the real cause.

That is exactly what happened: the word-boundary and loose tiers split on
whitespace, so a query carrying punctuation the title spells differently
("… Quedlinburg **-** Megabox" vs "… Quedlinburg**:** Die Megabox") produced a
dead `"-"` token that can prefix no real word. The loose tier's `every()` then
failed and the correct game scored `0` — identical to an unrelated title — so
six PS Store results outranked the one BGG hit the user was searching for.

**Rule:** normalize both strings *once*, before any tier check, and never
tokenize raw input. `foldTitle()` does it (ß→ss, diacritics stripped,
non-alphanumeric runs collapsed to a space), mirroring `norm()` in
`lib/providers/bgg.js` — BGG had folded punctuation for its **in-provider**
ranking since #117, and the cross-provider merge ranking simply never got the
same treatment. Two things worth keeping:

- **A query that folds to `''` must score 0.** The loose tier is an `every()`
  over the query's tokens, and `[].every(...)` is `true` — so an all-punctuation
  query would otherwise match *everything* at tier 1. The `!query` guard is what
  prevents that; `test/lookup-score.test.js` pins it.
- **`groupLookupHits`' key is deliberately NOT folded.** It uses plain
  trim+lowercase, because it answers a different question ("are these two
  providers offering the same game?") — folding punctuation there would merge
  rows that differ only by it. Don't "unify" the two normalizations.
- The helper lives in its own file for the coverage reason in
  `.claude/rules/frontend-helper-modules-and-coverage.md` — exporting it from
  the ~730-line view file would drag that file into the coverage report and red
  the gate with every test still passing.

Both mechanisms are dormant with one provider registered and are kept whole
rather than simplified away: the merge is what a second provider would arrive
into, and a "tidy-up" that collapses it is the change that has to be undone
first. Note the length tiebreak sits **after** `prio` deliberately — `prio` is
the provider's index, so two groups from different providers never reach the
length term, and moving it earlier would let title shape override provider
priority.


## BGG (`lib/providers/bgg.js`) — the XML API2, under a token (#117)

Both hops run on BGG's official **XML API2** with a registered application
token (`BGG_API_TOKEN`, approved as a **commercial** licence — donations count
as commercial, see #173):

- **search:** `boardgamegeek.com/xmlapi2/search?query=<q>&type=boardgame,boardgameexpansion`
- **detail:** `boardgamegeek.com/xmlapi2/thing?id=<id>` — `<name type="primary">`,
  `<minplayers>`/`<maxplayers>` (attribute strings, "0" = unknown → null),
  `<thumbnail>`, and the item `type` the canonical link is built from.

**Since #481 there is a THIRD hop, `collection(username)`** — the one-shot Regal
import — and it is *not* a third copy of these two: its items shape the name and
the player counts differently, an unknown username arrives as an HTTP 200 error
document, and its `202` "queued" answer must never be cached. All of that lives
in `.claude/rules/bgg-collection-import.md`; read it before touching that path.

**And since #519 a FOURTH, `covers(externalId)`** — the game's per-edition box
arts, from `/thing?…&versions=1`. Its body is **nested**, which `parseItems`
cannot handle: run over the whole document it returns the versions and silently
**loses the game item**, so `parseThing` on such a body reports a version's title
as the game's. See `.claude/rules/bgg-edition-covers.md` before touching it.

Four things about it bite:

- **No `www.`, ever.** BGG's docs are explicit that `www.boardgamegeek.com`
  interferes with request authorization — a perfectly valid token then `401`s.
- **`Authorization: Bearer <token>`**, and the token is read **per call** from
  env (like the rate-limit ceilings in `lib/app.js`), so a test can drive it.
- **No token ⇒ `search()` returns `[]` and `detail()` returns the null-shaped
  product** — never a throw. The frontend merges providers with
  `Promise.allSettled`, so a 502 here would render as "couldn't reach provider"
  across the whole dropdown; an empty list leaves the other four clean. Note the
  cost of that silence: a missing token is invisible to the operator — nothing
  logs, nothing 500s, the board-game search simply never finds anything. The
  admin panel used to surface it (`lookup.bggTokenSet`) until #404 dropped every
  configuration row from that card, so the only check now is the Railway env
  var. `docs/deploy-railway.md`'s go-live list says so.
- **Throttling is a status code, not a queue.** BGG answers `500`/`503` when
  too busy (`202` on some endpoints, `429` generically). `fetchXml` retries
  exactly those, twice, inside one 8 s budget; every other status (notably
  `401`) is final. Don't turn this into an unbounded retry — the route's
  `cached()` (10 min) plus the UI debounce are what actually keep the request
  count down, which is what BGG's terms ask for.

**Search results must be RANKED before truncating.** BGG's search is a plain
name match with **no relevance order of its own** — "catan" matches well over a
hundred items — so slicing the first 8 as they arrive routinely drops the game
the user meant. `parseSearch` scores each name (exact > prefix > substring,
diacritics/ß/punctuation folded) and prefers the shorter title on a tie, which
is what keeps a base game ahead of its editions and expansions.

**Localized titles come from the MATCHED name (#117 replaced #114's mechanism).**
BGG answers a search with the name that matched, so a German query yields the
German alternate name — while `/thing` always reports the primary (usually
original-language) name. `pickedTitle()` (`public/js/lookup-title.js`)
therefore keeps the search hit's title for `bgg` and lets detail win for every
other provider. **BGG itself still takes no locale** — it accepts the argument
every provider now receives and ignores it, and its `resolveLocale()` returns a
constant so its cache stays at one entry. Adding a real one would at best do
nothing and at worst re-break this.

**`lang` is still threaded through, and BGG still ignores it.** #117 removed the
parameter because BGG had stopped needing it; #505 reinstated it for the four
storefronts, which answered in the caller's UI language. Those are gone (#744)
and the parameter stayed — it is contract rather than effect today, and the cache
key uses the *effective* provider locale, so BGG's constant keeps it at one entry
instead of seven. Keep sending it: it costs nothing, and a provider that does
localize would otherwise serve one reader's hits to another for the whole TTL.
The allowlist discipline any such mapping must follow is
`.claude/rules/allowlist-request-values-that-reach-a-url.md`.

**XML is parsed by a small scanner, not a dependency.** Two details are
load-bearing: an attribute value may legally contain a raw `>` (game titles do,
and a naive `/<[^>]*>/` cuts the tag in half), and titles arrive
entity-encoded, so every attribute and text node is decoded.

**Known limits, not bugs:** ~~no play-time bucketing~~ — **superseded by #724**:
BGG's `<minplaytime>`/`<maxplaytime>` *are* stored now, as a provider-sourced
range on the game record, alongside minimum age, categories, mechanics and the
community rating. That is not a return of #242's hand-set `duration` enum; see
`.claude/rules/provider-info-is-a-field-set.md`, which also records why
`<playingtime>` is skipped and why the pair must not be collapsed to one number.
Search hits carry `thumbnail: null` — the
search endpoint returns no images at all, so BGG rows show the placeholder
thumb in the dropdown and the cover arrives with the detail on pick.

**Attribution is a licence condition, not decoration.** A public-facing app
must display the "Powered by BGG" logo linked back to BoardGameGeek, at a size
where its text stays legible — it lives in the always-visible half of the site
footer (`public/index.html`, `.site-footer__bgg`) and is **self-hosted**, so
rendering it contacts nobody. Don't gate it behind the legal-links config flag
and don't shrink or fade it. BGG also forbids modifying the retrieved data:
choosing which of BGG's own names to show is fine, rewriting one is not.

## Testing — never hit the network

Unit-test the pure parsers (`parseSearch`/`parseThing`/`pickImage`/
`imageHostAllowed`, exported per provider) against sample XML/JSON. For route
tests, override global `fetch` (`global.fetch = async () => ({ ok:true, text:
async () => XML })`) and restore in `afterEach`. See `test/lookup.test.js`,
`test/providers.test.js`, `test/games.test.js`.

**A fixture cannot tell you the provider still works** — that is #744's finding
3 above, and it cost an unknown number of months of a dead PS Store search under
a fully green suite. When you touch a parser, probe the live endpoint once and
print what the filter *throws away*, not only what it keeps.

**Two route branches now have no registered provider that can reach them** —
`covers_unsupported` and `expansions_unsupported`, because BGG has every optional
capability. `test/lookup.test.js` registers a synthetic provider into the
exported `providers` object for the duration of those two specs (the "invent the
missing member" move in `.claude/rules/locale-set-is-data.md`). Without it those
branches would quietly stop being tested while still looking covered.

## The cover-host allowlist is the trust boundary

`POST …/games` only accepts an `imageUrl` whose host a provider vouches for
(`isAllowedImageUrl`, aggregated in `lib/providers/index.js` from each
provider's `IMAGE_HOSTS`). **Since #172 the server never downloads cover bytes**
— a provider cover is **hotlinked** (the URL is stored in `game.image`), so a
wrong `IMAGE_HOSTS` means that provider's covers are CSP-blocked with no error
beyond a console violation. See `.claude/rules/provider-cover-hotlinking.md`.

**The CSP list is NOT the same list any more (#744).** `imageCspSources()` is the
registry's hosts **plus** a frozen `LEGACY_COVER_HOSTS`, because the two answer
different questions: what may be *queried and stored* follows the registry, what
may be *rendered* also has to include everything already sitting in someone's
shelf. Deriving both from the registry was correct while providers were only ever
added — the day one is retired it silently blanks that provider's saved covers.
`test/provider-covers.test.js` asserts both directions for the same URLs; see
`.claude/rules/security-middleware.md`.
