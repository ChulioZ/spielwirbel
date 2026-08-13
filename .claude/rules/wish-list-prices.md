---
paths:
  - "lib/prices/**"
  - "lib/routes/games.js"
  - "lib/edition.js"
  - "public/js/bgg-covers.js"
  - "public/js/views-round-detail.js"
  - "test/prices*.test.js"
  - "test/game-price-section.test.js"
---

# Wish-list prices (#679): four properties of the aggregator that fail SILENTLY

`lib/prices/` answers "what does this wished-for game cost right now" from the
Brettspielpreise.de / BoardGamePrices API (board games, keyed on the BGG id).
There was a second source — Steam's `price_overview` — until #744 retired the
four digital storefronts; a Steam-linked game is now just a game whose provider
has no price source. Everything below was measured live on 2026-08-07
against Ark Nova (`eid=342942`) and Catan (`eid=13`); each item produces a
**plausible wrong price** rather than an error, which is why the fixture in
`test/prices-boardgameprices.test.js` is a real capture and not a hand-written
body.

## 1. One BGG id returns TEN items — one per language edition, English first

`items[0]` is the GB edition. A German round shown `items[0]` gets a different
box at a different price: measured, `items[0]`'s cheapest quotable offer was
**55.17 €** while the German edition's was **49.89 €**. Nothing distinguishes the
two on screen.

So the edition is chosen, in order, by **the game's own stored edition**, then the
reader's language, then the edition with the most offers. All three must
**disagree** in any fixture that tests one, or the assertion is satisfied by the
array order or by the fallback and proves nothing — the committed fixture inverts
the live offer counts (GB 6, DE 8) precisely for that.

**The first term is #742 and it replaced "the reader's language decides", which
was wrong in two directions at once.** A round that picked the **English** box's
cover was quoted the German one (the 55.17 / 49.89 spread above, backwards), and
**two members of one round saw different prices for the same wish** purely because
they read the app in different languages — with nothing on either screen to
indicate a substitution. The edition comes from `game.edition.languages`, BGG's
own `<link type="language">` values, kept by the cover picker instead of thrown
away with the rest of its answer.

**The MARKET and the EDITION must come from different places, and collapsing them
is the trap.** `cacheKey`/`price` derive `destination` + `currency` from the
reader's locale (shipping is about the person) and the edition language from the
game (which box it is). One value for both would quote a German reader asking for
the English box **GB shipping in GBP**. A test asserting only that the amount
changed cannot see that — assert the currency and destination separately.

`resolveEditionLang` is the single function both `cacheKey` and `price` go
through, so the key and the body it is keyed to cannot describe different
editions. `BGG_EDITION_LANGS` maps BGG's language **names** onto the aggregator's
**codes** as an allowlist, and the fallback chain is what keeps a **Polish or
Japanese** printing showing a price at all — BGG names ~80 languages, the
aggregator sells seven.

## 2. `shipping_known: false` arrives with `shipping: 0`, so `price` LOOKS like a total

It is the product price wearing a total's clothes, and in real data it is
routinely the **cheapest offer on the item**: the GB edition's 48.28 € beat every
known-shipping offer. So the natural "cheapest wins" ranking selects exactly the
offer we may not present as an inclusive price — a PAngV § 3/§ 6 problem, not a
rounding nicety.

`pickBest` therefore treats known-shipping offers as a **block that ranks first**,
never interleaved by amount, and only falls through to the unknown-shipping ones
when there is nothing else. When one does win, the payload carries
`shippingKnown: false` and the UI says „zzgl. Versand" instead of „inkl.
Versand". Both halves are needed: the ranking alone would hide a legitimate
offer, the label alone would quote an incomplete price as a total.

`stock` has **four** spellings — `'Y'`, `'N'`, `'?'` and `' '` — and only `'Y'`
is a promise. In the captured body all three non-`'Y'` offers are *cheaper* than
the winner, so a ranking that ignores stock sends the user to a shop that has not
got the game.

## 3. `destination` means "ships to here", not "the shop is here"

A `destination=DE` query legitimately returns AT, CH, LV and GR shops. The country
travels with the offer and the UI names it, so a Greek shop cannot read as a local
one. Do not "fix" this by filtering to the destination country — a cheaper
Austrian shop that ships to Germany is a real answer.

## 4. One item can be MULTILINGUAL — `langs[0]` is not "the" edition language

A single listing can carry several languages on **one** item, GB first: Karak
(`eid=241477`, measured 2026-08-08) is one item with `["GB","DE","NL","FR","IT"]`.
`pickEdition` correctly matched it for a German reader — right offers, right
price — but the label printed `langs[0]`, so the box said „Ausgabe: Karak (GB)"
over the German-market offers (#700). The label is the edition disclosure, so a
wrong one misleads in both directions. The rule: when the shown box includes the
reader's language, that **match** is the label; `langs[0]` labels only the
most-offers fallback, where no reader-language edition existed. Any fixture
testing this must put GB first in `versions.lang` (the live order) — DE-first
would satisfy the assertion by array order, the same anti-vacuous shape as §1's
inverted offer counts.

Since #742 the label follows the **wanted** language rather than the reader's,
which is the same rule with a wider first term: `parseInfo` takes an
already-resolved `want` code, so the box a round picked is also the box the
label names.

## Why this is NOT an entry in `lib/providers/`

Those answer *which game is this* and are wired into the add-game dropdown
(`.claude/rules/add-game-lookup-provider.md`). A price source answers a different
question, and putting one in that registry would offer it in the lookup menu.

Steam used to be the one module in **both** trees — the price *parsing* beside
`parsePlayers` in the provider (same response body), the price *source* in its
own module under `lib/prices/` — which is worth remembering as the shape a
future source might take: a `price()` there would be an optional capability like BGG's
`collection()`/`covers()`, never part of the lookup contract.

## The cache TTL is per hop, and the shared one must not move

Their terms require caching for **at least an hour**; `lib/provider-cache.js`'s
shared TTL is ten minutes. `cachedIf` takes an optional `ttlMs` for that reason.
Do not raise the shared constant instead — BGG's `202` "queued, come back"
collection answer must not gain an hour of life
(`.claude/rules/bgg-collection-import.md` §3), and the lookup hops were never
designed for one.

`fetchedAt` is stamped **inside** the cache entry, so a cached answer reports when
the price was really retrieved. That timestamp plus the „Preise können sich
geändert haben" note are the whole mitigation for a stale upstream — nothing in
CI can detect an aggregator that stopped updating.

The renderer has **one** disclosure since #744, not one per source
(`price.sourceSteam` went with the module). If a second source ever lands, the
branch comes back with it — a statement that derives from the aggregator must not
be printed under a price that came from somewhere else.

## An outage taught two things the first cut got wrong (2026-08-07)

The aggregator 504'd for hours the day this shipped. Both defects were ours, and
both are the kind that only a real outage surfaces.

**1. Our timeout must sit ABOVE their gateway's, not on it.** Theirs returns 504
at ~10.10 s and ours fired at 10.00 s, so a plain upstream outage was logged as
`This operation was aborted` — a message naming *our* timeout and hiding theirs.
The operator reasonably read it as a broken deploy and redeployed. It was also a
coin flip: 50 ms of jitter either way changed the diagnosis. `TIMEOUT_MS` is 12 s
for that reason, and an `AbortError` is rewritten to name the source and the
budget rather than passing its own contentless message up.

**2. A failure must pause the SOURCE, not be retried per page view.** A success
is cached for an hour; a failure deliberately is not (a five-second blip must not
be repeated back for an hour). With nothing in between, every wish-detail view
paid the full timeout and added load to a failing upstream.
`PRICES_FAILURE_COOLDOWN_SECONDS` (default 120) is that middle ground.

Two properties of the cooldown are load-bearing and each fails silently:

- **It is keyed by source, not by game.** An upstream that is down is down for
  every game, so a per-game key still issues one request per wished game — the
  cost this exists to remove. Per source is also what would keep a second source
  answering while the aggregator is out. **With one source registered those two
  implementations are behaviourally identical**, so `test/prices.test.js` pins
  only the half that is still observable (four games, one upstream call) and says
  in place of the deleted spec that the rest returns when a second source does.
  Don't add a test for it in the meantime: it would be green either way.
- **It is checked INSIDE the cache loader, never before the cache lookup.** A
  price we already hold is still a good price and must keep being served while
  its source is out; checking first would take prices away from exactly the games
  we could still answer. `test/prices.test.js`'s "a price we ALREADY HOLD" spec
  is the one that catches the wrong placement, and nothing else does.

**A stale price IS reused since #688** — this paragraph used to say the opposite,
and the half that still holds is why. An expired *cache* entry is still never a
fallback (`cachedIf` refetches, and a failed refetch is `{available: false}`), and
the cache is still per process. What changed is that the last price each lookup
answered is now also persisted — read when a live lookup is unavailable, and
since #707 also served instantly (`?stored=1`) as the first render while the
live lookup is still in flight — and always rendered age-first rather than with
a `fetchedAt` footnote. Their terms were read and permit it. See
`.claude/rules/last-known-price-fallback.md`.

## Two things that are legal posture, not configuration

- **No affiliate or commission links, ever** (operator decision 2026-08-07). It
  is what keeps the operator non-commercial here and removes the ad-labelling
  duty (§ 5a Abs. 4 UWG), the Gewerbe question and most of the comparison-portal
  exposure. An affiliate parameter is a different legal position, not a config
  switch — and it would turn the VVT's row 21 from a documented non-processing
  into a real one.
- **The source line is required, not decoration.** It names the source and says
  the list covers only the shops listed there — what keeps a best-price claim
  honest (BGH I ZR 55/16; affiliate-free, § 5a UWG likely doesn't bind us). The
  „Händler zahlen" clause — true per their about page — went by operator
  decision 2026-08-09. `test/game-price-section.test.js` pins the render.

**Related:** `.claude/rules/add-game-lookup-provider.md` (the registry this stays
out of, and the "never hit the network in a test" shape),
`.claude/rules/keep-legal-docs-current.md` (why §8 of the policy and `vvt.md`
row 21 shipped in the same PR),
`.claude/rules/allowlist-request-values-that-reach-a-url.md` (the allowlist shape
`resolveMarket` follows — destination and currency reach a fetched URL's query
string).
