---
paths:
  - "lib/prices/**"
  - "lib/repo/json.js"
  - "lib/repo/postgres.js"
  - "lib/scheduler.js"
  - "public/js/views-round-detail.js"
  - "test/prices*.test.js"
---

# The stored last-known price (#688): key it with the SOURCE'S cache key, not a tuple

`last_prices` holds the last price each lookup answered, served — labelled with
its age — only while the source is unreachable. It exists because #679's cache
made the feature exactly as available as its upstream: an expired entry is never
a fallback, and the Map dies with the process, so the 2026-08-07 outage plus one
redeploy showed **no price on any board-game wish for hours**.

## 1. The key must carry the EDITION, which a natural key does not

#688 specified a row per `(source, externalId, destination, currency)`. That is
wrong, and wrong in a way nothing surfaces: **one BGG id is ten editions**, and
which one a reader sees is decided by their language
(`.claude/rules/wish-list-prices.md` §1). `MARKETS` maps only `de` and `en`, so
every other eurozone locale falls back to the deployment market — a **French**
reader and a **German** one therefore share `destination` *and* `currency` while
being shown different boxes at different prices. Under the tuple key they share a
row, so the French reader is served the German edition's price with nothing on
screen to indicate the substitution.

So the stored key is `source.cacheKey(externalId, lang, editionLangs)`
**verbatim** — the same string the in-memory cache uses, which already encodes
market and edition. Reusing it makes the class of bug unrepresentable rather than
merely absent: the fallback cannot answer a question the live lookup would have
answered differently, because there is only one notion of "which lookup is this".

**#742 added the third argument and the property is what made it cheap.** The
edition is no longer derived from the reader's locale but from the game's own
stored `edition.languages`, so the key gained a term whose *source* changed —
and because `priceFor`, `storedPriceFor` and the loader all read one
`sourceFor()` answer (`{ source, externalId, editionLangs }`), there is one place
to thread it rather than three that can disagree. Miss one and the fallback
serves the English box's price under the German box's question, silently.

`test/prices.test.js`'s *"keyed per EDITION too, not just per market"* is the spec
that sees this, and it is the **only** one that does — the market spec beside it
(`de` vs `en`) stays green against the tuple key, because those two differ in
destination and currency anyway. Verified by weakening `cacheKey` to the tuple
form and watching exactly that one name go red.

## 2. It never SUBSTITUTES for a live answer — the fallback reads, plus one fast path

The **fallback** branches read it only when a live lookup is unavailable:

| Outcome | Fallback? |
|---|---|
| fetch threw, or the source is cooling | **yes** |
| fetch succeeded, no offers (`items: []` → the frozen `NO_OFFERS`) | **no** — a settled answer, and since #707 it *says* so (`reason: 'no_offers'`) |
| feature disabled | **no** |

The middle row is the one worth stating: "nobody stocks this" is fresh data, and
answering it with last week's price would **contradict** the upstream rather than
survive its absence. The `no_offers` marker exists because the client may state
"no price available" only for that settled answer, never for an upstream that
was merely unreachable — failure paths keep the markerless `UNAVAILABLE`. The
cooling branch is also reached only on a cache *miss*, so a live cache entry
still outranks the stored row.

**Since #707 there is a second, deliberate reader:** `storedPriceFor`, the
route's `?stored=1` fast path. The wish page requests it in parallel with the
full lookup and renders its answer only until the live one lands. That is honest
under the same rule, because the stored render is never presented as current —
§3's age-first labelling is kept, `staleWhy` is swapped for a „wird gerade
geprüft"-note — and the live answer always replaces it within the same view.
What `storedPriceFor` must never do is fetch upstream, touch the cooldown or the
in-memory cache, or write anything: a fast path with side effects would race the
very lookup it fronts.

## 3. The age becomes the headline — that is the legal half

A stale answer carries `stale: true` and the **original** `fetchedAt`. The flag
exists rather than a client-side age threshold because a *fresh* answer may
legitimately be an hour old from cache, and only the server knows which it is.

`renderPriceSection` then puts the age directly under the amount rather than in
the quiet retrieval footnote: right for an hour-old price, wrong for a three-day
one, and a stale price presented as current is a § 5a UWG misleading omission.
`priceAge` rounds **up** to at least an hour and **down** across the day boundary
— always overstating, never understating, because the clock doing the arithmetic
is the reader's own.

Past `PRICES_FALLBACK_MAX_AGE_DAYS` (7, operator decision 2026-08-07) nothing is
shown at all. That ceiling is **correctness, not cache sizing**: it is also what
`docs/legal/retention.md` promises, and the sweep in `lib/scheduler.js` is what
makes the promise true. The sweep is `enabled: () => true` on purpose — rows
written while `PRICES_ENABLED` was on must still be cleaned up after it is
switched off, and gating it on the flag strands them with the document still
claiming they go.

## 4. Their terms permit storage — read, not assumed (2026-08-07)

> "Feel free use the API for your own project, as long as you link back to this
> site when the information is presented, and be sure to cache obtained
> information for at least one hour."

That is a **minimum** with no stated maximum and no prohibition on persistence;
the page carries no retention clause anywhere. Attribution is the other condition
and was already satisfied. `boardgameprices.co.uk` was 504ing while this was
checked — the sibling domains (`brettspielpreise.de`, `ludiprix.fr`, …) serve the
identical page, so an outage at one host is not a reason to defer the check.

Re-read it before storing anything **more** (a history, a per-user row): the
permission above is for one current value per lookup, and § 87b UrhG (database
right) is the neighbouring question #679's notes already used to reject scraping.

## 5. Global and un-scoped, and the VVT reasoning turns on the row's CONTENT

The table has no `tenant_id` and no RLS, like `moderation_log` — a price is a
public fact about a game, so scoping it would store one row per tenant and ask
the upstream once per tenant.

`docs/legal/vvt.md` row 21 stays a documented **non-processing**, and the reason
is not "we store nothing" any more (we do) but that the row holds a public game
id and a price and **no** user, account, round or tenant id — so it cannot say
who looked, or whose wish list the game is on. Put any of those in the key and
that classification has to be made again.

#742's third key term is safe on exactly that test and it is worth stating why,
because the obvious implementation is not: the key carries the edition
**language** (`DE`), never the game row's id. Keying by the row would have been
the convenient way to reach the same edition — and it would have made every
stored price attributable to one round's wish list, i.e. a different legal
classification for a caching change. Two published statements said "prices
are not stored" and changed with this feature; `PRIVACY_REVISION` already named
2026-08-07 from an earlier same-day change, so it did not move again.

**Related:** `.claude/rules/wish-list-prices.md` (the feature this sits under, and
the three aggregator properties that fail silently),
`.claude/rules/keep-legal-docs-current.md` (why the policy, the VVT and the
retention record ship in the same PR),
`.claude/rules/capability-links-gate-on-the-target.md` (the other "the gate
decides, the sweep is only hygiene" split).
