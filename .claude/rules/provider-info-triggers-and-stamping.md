---
paths:
  - "lib/provider-info.js"
  - "lib/providers/bgg.js"
  - "lib/routes/games.js"
  - "lib/routes/sessions.js"
  - "lib/routes/lookup.js"
  - "public/js/views-session.js"
  - "public/js/views-regal.js"
  - "public/js/game-info.js"
  - "public/js/metadata-filter.js"
---
# The provider-info backfill: WHERE it is triggered, and what it may STAMP (#736)

`.claude/rules/provider-info-is-a-field-set.md` answers *which* fields the lazy
backfill carries. This file answers the two questions next to it — *when* it runs
and *which games it may record an attempt against* — because #736 found both
wrong at once, and each failure is silent in a different way.

## 1. A field that is FILTERED on needs a trigger where the filter is

The lazy design has a second failure mode, and #725 walked straight into it: it
gave the session setup screen and the Regal filters over these fields while
neither screen was a backfill trigger. Combined with the deliberate permissiveness
below — **an absent value on the game passes every filter** — the result is a
filter that silently does not filter, on exactly the games that most need it.
Pick „max. Komplexität 1" and Agricola stays in the pool, with nothing on screen
to explain it.

It degrades the **controls** too, one step worse: `metadataFilterOptions` derives
which controls exist from stored values, so an unfilled shelf offers no complexity
control *at all* and a half-filled one offers a control that half works.

So the rule that pairs with the field set: **a field the app filters on must have
a trigger on the screen that filters it.** `lib/provider-info.js`'s header lists
all five triggers; two of them (#736) exist purely to satisfy this. Note the
asymmetry that makes one of them blocking: a *screen* can fold the answer in when
it lands, but a **draw** cannot — the pool is built once — so a session start
carrying metadata filters awaits the fill, bounded by `DRAW_BACKFILL_TIMEOUT_MS`,
and falls back to stored values on timeout.

**The ordering inside that draw is the trap.** `normalizeMetadataFilters` drops
every filter over a field no game on the shelf carries, so normalizing before the
fill collapses the user's filter to "unfiltered" *on precisely the unfilled shelf
the fill exists for* — and the draw then returns the whole shelf while looking
entirely healthy. Fill first, normalize against the shelf you now have. The tell
is the stored #252 preset, which remembers it as an unfiltered draw.

## 2. Only stamp a game the provider was actually ASKED about

`providerInfoAt` records the *attempt*, and it is what suppresses the next
fetch — so stamping a game no request covered hides it for the full 7-day TTL
with no request ever having left the process. That was live from #717: BGG's
`gameInfo` caps the ids it will carry (300) and silently drops the overflow, while
the write loop iterated every eligible game. It needed an import of more than 300
games to bite, so it was rare — and a shelf-wide trigger makes it routine.

The fix is structural rather than a bound copied into the caller: `gameInfo`
returns **`{ items, asked }`**, and the backfill stamps only ids in `asked`.
A caller cannot re-derive a ceiling that is not its own, and the two cannot drift.
`gameInfo` also takes `{ maxBatches }` — how many upstream requests the caller
will spend — so the batch **size** stays the provider's business while the shelf
trigger can say "one request" without restating 60.

A tokenless instance therefore reports `asked: []` rather than an empty item list
over a full set. That direction matters: reporting them as covered would stamp the
whole shelf as "BGG had nothing", so configuring the token later would leave every
game waiting out a TTL for data it could have had at once.

## 3. Anything that STAMPS must also write, or it defers by a whole TTL

The link-provider `PATCH` offers a chip for `weight` only (it was `weight` and
`description` until #729) — what the sheet previews — so writing just that looks
right. It is not, and the
reason generalises to any future handler that resolves provider info itself:
**the stamp is what suppresses the backfill.** `providerInfoAt` is set on that
path, so the unchipped fields would not arrive until the next trigger *after* the
TTL expired — leaving the user who explicitly asked for BGG's data waiting a week
for most of it, silently and self-healingly enough that nobody would report it.

So the route writes the unchipped fields whenever the hop has already run, via
the shared `assignProviderInfo(patch, info, UNCHIPPED_PROVIDER_INFO_FIELDS)`.
Using the shared guards rather than a plain copy matters **more** here than in
the repo: `updateGame` `Object.assign`s the patch verbatim, so an unfiltered
write would store `categories: []` and a row of nulls and split absent-key parity
between the backends — the one place in this feature where a naive write reaches
the store unchecked.

**Related:** `.claude/rules/provider-info-is-a-field-set.md` (the field set this
splits from, and the accretion rule the fold-in mirrors),
`.claude/rules/provider-metadata-is-a-filter-not-a-tag.md` (§2, the absent-value
rule that makes an unfilled shelf fail silently rather than loudly),
`.claude/rules/add-game-lookup-provider.md` (BGG's throttling terms the batch
bound answers to), `.claude/rules/shared-constants-across-the-stack.md`
(`draw-pool.js`, which both filter screens and the draw apply),
`.claude/rules/break-the-code-on-purpose.md`.
