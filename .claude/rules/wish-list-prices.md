---
paths:
  - "lib/prices/**"
  - "lib/providers/steam.js"
  - "lib/routes/games.js"
  - "public/js/views-round-detail.js"
  - "test/prices*.test.js"
  - "test/game-price-section.test.js"
---

# Wish-list prices (#679): three properties of the aggregator that fail SILENTLY

`lib/prices/` answers "what does this wished-for game cost right now" from the
Brettspielpreise.de / BoardGamePrices API (board games, keyed on the BGG id) and
from Steam's `price_overview`. Everything below was measured live on 2026-08-07
against Ark Nova (`eid=342942`) and Catan (`eid=13`); each item produces a
**plausible wrong price** rather than an error, which is why the fixture in
`test/prices-boardgameprices.test.js` is a real capture and not a hand-written
body.

## 1. One BGG id returns TEN items — one per language edition, English first

`items[0]` is the GB edition. A German round shown `items[0]` gets a different
box at a different price: measured, `items[0]`'s cheapest quotable offer was
**55.17 €** while the German edition's was **49.89 €**. Nothing distinguishes the
two on screen.

So the edition is chosen by the reader's language, falling back to the edition
with the most offers. The two rules must **disagree** in any fixture that tests
either, or both are satisfied by the array order and neither is proven — the
committed fixture inverts the live offer counts (GB 6, DE 8) precisely for that.

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

## Why this is NOT a sixth entry in `lib/providers/`

Those five answer *which game is this* and are wired into the add-game dropdown
and `round.providers` (`.claude/rules/add-game-lookup-provider.md`). A price
source answers a different question, and putting one in that registry would offer
it in the lookup menu and let a round's provider setting silently switch pricing
off. Steam is the one module in both trees: the price *parsing* lives in
`lib/providers/steam.js` next to `parsePlayers` (same response body), the price
*source* in `lib/prices/steam.js`. Its `price()` is an optional capability like
BGG's `collection()`/`covers()`, not part of the lookup contract.

## The cache TTL is per hop, and the shared one must not move

Their terms require caching for **at least an hour**; `lib/provider-cache.js`'s
shared TTL is ten minutes. `cachedIf` takes an optional `ttlMs` for that reason.
Do not raise the shared constant instead — BGG's `202` "queued, come back"
collection answer must not gain an hour of life
(`.claude/rules/bgg-collection-import.md` §3), and the storefront hops were never
designed for one.

`fetchedAt` is stamped **inside** the cache entry, so a cached answer reports when
the price was really retrieved. That timestamp plus the „Preise können sich
geändert haben" note are the whole mitigation for a stale upstream — nothing in
CI can detect an aggregator that stopped updating.

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
  cost this exists to remove. Per source is also what keeps Steam answering while
  the aggregator is out.
- **It is checked INSIDE the cache loader, never before the cache lookup.** A
  price we already hold is still a good price and must keep being served while
  its source is out; checking first would take prices away from exactly the games
  we could still answer. `test/prices.test.js`'s "a price we ALREADY HOLD" spec
  is the one that catches the wrong placement, and nothing else does.

**A stale price is NOT reused today.** An expired cache entry is never a
fallback — `cachedIf` refetches, the fetch throws, and the answer is
`{available: false}`. The cache is also per process, so a deploy wipes it. Making
last-known prices survive an outage would need persistent storage, which #679
scoped out and which needs their terms read first (a minimum cache duration is
documented; a maximum retention is not, and § 87b UrhG is the neighbouring
question). If it is ever built, the `fetchedAt` line stops being a footnote and
becomes the headline — a days-old price presented as current is a § 5a UWG
misleading omission.

## Two things that are legal posture, not configuration

- **No affiliate or commission links, ever** (operator decision 2026-08-07). It
  is what keeps the operator non-commercial here and removes the ad-labelling
  duty (§ 5a Abs. 4 UWG), the Gewerbe question and most of the comparison-portal
  exposure. An affiliate parameter is a different legal position, not a config
  switch — and it would turn the VVT's row 21 from a documented non-processing
  into a real one.
- **The source line is required, not decoration.** Brettspielpreise's own about
  page says shops pay to be listed, so the comparison is not the whole market;
  withholding that is a § 5a UWG omission (BGH I ZR 55/16). `test/legal.test.js`
  pins the disclosure and `test/game-price-section.test.js` pins that it renders.

**Related:** `.claude/rules/add-game-lookup-provider.md` (the registry this stays
out of, and the "never hit the network in a test" shape),
`.claude/rules/keep-legal-docs-current.md` (why §8 of the policy and `vvt.md`
row 21 shipped in the same PR), `.claude/rules/storefront-lookup-locale.md` §1
(the allowlist shape `resolveMarket` follows — destination and currency reach a
fetched URL's query string).
