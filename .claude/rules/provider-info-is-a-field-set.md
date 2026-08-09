---
paths:
  - "lib/provider-info.js"
  - "lib/providers/bgg.js"
  - "lib/routes/games.js"
  - "lib/routes/vote-link.js"
  - "public/js/game-info.js"
  - "lib/repo/json.js"
  - "lib/repo/postgres.js"
---
# Widening the provider-info field set STARVES the best-covered games (#724)

`needsProviderInfo` (`lib/provider-info.js`) decides whether to ask BGG about a
game, and it short-circuits on a **completeness check**. Add a field to the
import without adding it to that check and the failure is inverted from what you
would guess:

```js
if (game.weight != null && game.description != null) return false;   // the #717 pair
```

Every game the previous backfill already filled returns `false` here **forever**,
so the games with the *best* coverage are exactly the ones that never receive the
new field. Nothing errors, no route 400s, no test reddens, and the feature looks
implemented — on a fresh game it genuinely works, which is the case anyone tests.

The mirror-image break is just as quiet: a field **counted but never written** can
never complete, so every game re-asks BGG once per `PROVIDER_INFO_TTL_MS` (7 days)
forever — a standing upstream request per game per week against a provider whose
terms ask for few requests.

**So the field list is ONE module**, `lib/provider-info-fields.js` — the field
names *and* the guard deciding what counts as a value — read by the check, the
write loop, both repo backends and the games route. It is dependency-free on
purpose: `lib/provider-info.js` requires `./providers`, so putting the shape
there would give the repo layer a path to the provider registry.

Adding a field there is the whole change; the 7-day TTL then
lets every already-stamped game through once, lazily, with no migration code
(CLAUDE.md) and no thundering herd. Two accepted costs, stated in the code because
they read as bugs otherwise: a game BGG genuinely has no categories for is re-asked
once per TTL forever (already true for a weightless game before #724), and the
one-time re-fetch after a deploy is spread across every game's next view.

**Empty arrays count as absent, on both sides.** `categories: []` is "BGG named
none", so `setGameProviderInfo` skips it like a null (values only accrete — an
empty answer must never erase a stored list) and `hasProviderField` treats it as
unfilled. Get those two out of step and a game with no categories either loops
forever or is written as permanently empty.

**#729 will exercise all of this in reverse** by removing `description`. Leaving it
in the list while nothing writes it is precisely the second failure above.

## Anything that STAMPS must also write, or it defers by a whole TTL

The link-provider `PATCH` offers a chip for `weight` and `description` only — the
two the sheet previews — so writing just those looks right. It is not, and the
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

## The rating is detail-only, and the guarantee is SERVER-side

`average` is imported (#724 partially reverses #717's "no community score"), but
it must never reach a voting surface — vote anchoring is a property of the voting
*screen*, not of the data. The enforcement is the ballot projection in
`lib/routes/vote-link.js`, which simply has no `rating` key: a link voter can read
that JSON whether or not a view renders it, so withholding it there is strictly
stronger than withholding it in the client.

The client half is still worth its shape: `gameInfoBody` and `hasGameInfo`
(`public/js/game-info.js`) both **default `rating` to off**, so the one builder
that fills three surfaces — two of them vote cards — fails safe when a caller
forgets the flag. Only `renderGameInfoSection` opts in. A spec that passes
`{ rating: false }` itself cannot see a flipped default; the sheet spec asserts
the default by passing nothing
(`.claude/rules/break-the-code-on-purpose.md`, "A test that SETS the state it
asserts").

Note the two gates must *disagree* for a rating-only game: no ⓘ (its sheet would
be empty) but a detail section (it has something to say).

## What the live captures settled — don't re-measure these

Measured 2026-08-09 against `/thing?id=…&stats=1` for Catan (13), Ark Nova
(342942), Toriki (417403) and the expansions Seafarers (325) and Marine Worlds
(368966):

| Question | Answer |
|---|---|
| Does `inbound="true"` appear on category/mechanic links? | **No** — 2 of 2 inbound flags sat on `boardgameexpansion` links, 0 of 41 on taxonomy links, *including on both expansion items*. It marks the inverse of a **relation**, and a taxonomy link has no inverse, so these are deliberately not filtered on it |
| Is `<playingtime>` worth storing? | **No** — it equalled `<maxplaytime>` on all five (120/120, 150/150, 600/600, 90/90, 150/150) |
| Do the new fields cost a request or a byte? | **No** — the category/mechanic links ride the **base** `/thing` body (a no-stats Catan body carries the same 2 categories and 15 mechanics), so only `average`/`averageweight` need `stats=1`, which was already on. The +885 B `stats=1` delta #717 recorded re-measured identically (47,659 → 48,544) |

**The `inbound` category link in `test/providers-bgg.test.js` is a hand-written
distractor** for the expansion-parent parser, not BGG data — it is what made the
question look urgent. Don't read a fixture as evidence about the upstream.

**Store BOTH playtime bounds.** Toriki reports **20–600**, where 20 is one sitting
and 600 the full campaign; any single number describes neither, and the average
(310) describes nothing at all. A future filter tests the **minimum**
(`minPlaytime <= budget`), the same interval shape `fitsPlayerCount` uses — filter
on the maximum and Toriki leaves every realistic budget.

**Match `average` by exact node name.** `parseItems` flattens every descendant into
one child list, so `average`, `bayesaverage`, `stddev`, `median` and `rank` all sit
beside `averageweight`. A `startsWith`/`includes` match silently stores the **geek
rating**; the two differ on every game and by 2.5 points on a thinly-rated one
(Toriki 8.51 vs 6.02). Each item carries exactly one `average` node, so the exact
match is safe.

## This partially revisits #242, and that is not drift

#242 retired a hand-set `duration` **enum** and its filters in favour of custom
tags. Nothing here reinstates it: `minPlaytime`/`maxPlaytime` are provider-sourced
integers nobody types, and tags remain the only hand-assigned categorization. The
user feedback that asked for this said the same thing — provider facts every round
would otherwise re-enter by hand are not tag-shaped.

**Related:** `.claude/rules/add-game-lookup-provider.md` (the provider contract and
BGG's licence/throttling rules), `.claude/rules/bgg-collection-import.md` (the
"capture live, the document lies" pattern this follows),
`.claude/rules/break-the-code-on-purpose.md`,
`.claude/rules/postgres-backend.md` (absent-key parity, which the accretion rule
is what preserves).
