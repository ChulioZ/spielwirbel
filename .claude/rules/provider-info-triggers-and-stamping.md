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
  - "public/js/filter-panel.js"
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

**A trigger is only as good as the request behind it — see §4.** #736 satisfied
this rule and the symptom did not move, because every batched request it made was
refused by the provider.

## 2. Only stamp a game the provider was actually ASKED about

`providerInfoAt` records the *attempt*, and it is what suppresses the next
fetch — so stamping a game no request covered hides it for the full 7-day TTL
with no request ever having left the process. That was live from #717: `gameInfo`
caps the ids it will carry and silently drops the overflow, while the write loop
iterated every eligible game.

The fix is structural rather than a bound copied into the caller: `gameInfo`
returns **`{ items, asked }`**, and the backfill stamps only ids in `asked`.
A caller cannot re-derive a ceiling that is not its own, and the two cannot drift.
`backfillProviderInfo` takes `{ maxBatches, pauseMs }` — how many upstream
requests the caller will spend and how far apart — so the batch **size** stays
the provider's business (`MAX_THING_IDS`) while the shelf trigger can say "one
request" without restating a number.

**Since #828 that guard is observable in exactly ONE case**, and it is worth
knowing which before trusting a green suite: the caller chunks by precisely
`provider.MAX_THING_IDS`, so `slice` and `asked` coincide everywhere else and
deleting the guard changes nothing. The discriminating case is the **tokenless**
instance, where `gameInfo` answers `{ items: [], asked: [] }` — a healthy answer
over a full list — rather than throwing. `test/provider-info.test.js`'s
"a TOKENLESS instance stamps nothing at all" is the only spec that goes red for
it; found by deleting the guard and watching all 21 others stay green
(.claude/rules/break-the-code-on-purpose.md).

**The corpus path (#829) is the same rule from the other side.** The local BGG
corpus is read before the upstream hop, and `setGameProviderInfo` *always* stamps
— so a row that fills a game only partly must fill it **not at all**. Writing the
half it knows would suppress the game for the full TTL from the very hop that
could have completed it, with no request ever going out. Hence `corpusPatch`
returns null unless every `PROVIDER_INFO_FIELDS` entry passes `hasProviderField`;
the skipped game costs nothing, because the hop behind it fills and stamps it a
moment later. Note the three shapes of "partial" that must all be caught: an
un-enriched row (the CSV's `rating` and nothing else), a missing number, and an
**empty list** — which `hasProviderField` counts as absent rather than as "BGG
named none".

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

## 4. The trigger fired, the request was refused, and nobody heard (#828)

Everything in §1 shipped and the reported symptom did not move: a round whose
games came from a collection import still showed no „Weitere Filter" at all. The
cause was one number. **BGG carries at most 20 ids on `/thing`** — its docs say
"Maximum 20" and the server enforces it with `400 Cannot load more than 20
items` — and `MAX_EXPANSION_BATCH` was **60**, so every bulk hop was refused:
the import, both filter screens, the session start, and `expansionParents` on top.
A 400 is not retryable, so it failed in ~300 ms, completely, every time.

Three properties made it invisible for a year:

- **Four nested catches and no log line.** The provider threw, the backfill
  `continue`d, the route swallowed, the client `.catch(() => {})`d. There is now a
  `provider_info_backfill_failed` warn at the one layer that can see both the
  status and the id count.
- **The demo round worked.** Nine seeded games is one under-limit request, so the
  one shelf every developer and every reviewer looked at was the one shelf that
  could not reproduce it. So did every spec: a fixture inside one batch is green
  whatever the bound is.
- **The correct number was written down, next to the wrong one.** `corpus()` used
  20 and its comment said the neighbours' 60 was "a pre-existing question
  deliberately left alone". It was not a question.

**So: a provider's documented limit is a fact to MEASURE, and to state once.**
The two values are now one `MAX_THING_IDS`, and `test/providers-bgg.test.js` pins
it to **20 as a literal** while every other assertion reads the constant — a
`n <= bgg.MAX_THING_IDS` loop cannot see a raised constant, which is the
`.claude/rules/shared-constants-across-the-stack.md` "import the wrong list" trap
one level up. Any fixture written to exercise a batching bound must exceed it: 25
games, not 20.

**Related:** `.claude/rules/provider-info-is-a-field-set.md` (the field set this
splits from, and the accretion rule the fold-in mirrors),
`.claude/rules/provider-metadata-is-a-filter-not-a-tag.md` (§2, the absent-value
rule that makes an unfilled shelf fail silently rather than loudly),
`.claude/rules/add-game-lookup-provider.md` (BGG's throttling terms the batch
bound answers to), `.claude/rules/shared-constants-across-the-stack.md`
(`draw-pool.js`, which both filter screens and the draw apply),
`.claude/rules/break-the-code-on-purpose.md`.
