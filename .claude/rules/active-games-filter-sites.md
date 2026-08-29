---
paths:
  - "lib/repo/**"
  - "lib/draw.js"
  - "public/js/draw-pool.js"
  - "lib/routes/sessions.js"
  - "lib/routes/games.js"
  - "public/js/views-round*.js"
  - "public/js/views-member.js"
  - "public/js/views-session.js"
  - "public/js/round-rail.js"
  - "public/js/recap.js"
  - "lib/quota.js"
  - "lib/routes/rounds.js"
  - "test/support/repo-contract.js"
---
# "Active games" is filtered in ~10 places — two of them server-side (#250, #560)

Adding the `completed` state (#250) meant every place that used `!g.retired` to
mean *"in the active collection"* had to become `!g.retired && !g.completed`.
**#560 added a third, `wish`** — the Wunschliste, games the round wants but does
not own — so the clause is now `!g.retired && !g.completed && !g.wish`
(Postgres: a third `(data->>'wish')::boolean IS NOT TRUE`).
The trap: the filter is **not** centralized, and the two most consequential
sites are on the **server**, where no view test would catch a miss.

**`wish` is the sharpest of the three:** retired and completed games were *once*
on the shelf, so a missed filter merely surfaces something the group really
owns. A wish is a game they **do not own at all**, so a missed filter offers a
night with a box nobody can put on the table.

The full set — grep `retired` in `lib/routes/`, `lib/` and `public/js/`
before assuming you have them all:

**Server (the ones that bite silently):**
- `lib/repo/{json,postgres}.js` `listRoundSummaries` `gameCount` — the
  home-screen count **and** the import dropdown's "n games". `createRound`'s
  import skips both archives, so a `gameCount` that counts an archived game
  **promises more games than the copy delivers**. These two must stay in
  agreement; `test/rounds.test.js` asserts
  `copy.games.length === entry.gameCount` for exactly that reason.
  (It lived in `lib/routes/rounds.js` when #250 wrote this rule; #301's summary
  read moved it down into the repo, where each backend now filters on its own —
  `json.js` with `!g.retired && !g.completed`, `postgres.js` with two
  `IS NOT TRUE` clauses in the `listRoundSummaries` SQL. Both must change
  together.)
- **`public/js/draw-pool.js` `isActiveGame`** — the draw `pool` filter *and*
  `lib/routes/sessions.js`'s direct-pick 400 both go through this **one**
  predicate since #486. They used to be two inline copies in the route, "easy to
  fix one and miss the other" — miss the direct-pick one and an archived game
  stays playable by id even though it is invisible in the UI that would offer it.
  A third archive state is now one edit here, and `test/draw.test.js` unit-tests
  the predicate directly rather than only through an HTTP round-trip. The route
  still spells the *message* per archive ("Game is retired" / "Game is
  completed"), so that branch survives — but the 400 itself no longer can be
  missed.

  **It lived in `lib/draw.js` until #634**, which moved it (with the player-range
  clause, now `fitsPlayerCount`) into a shared `public/js/` module so the setup
  screen's live preview applies the server's own predicate instead of a
  hand-synced copy — `lib/draw.js` requires it and re-exports `isActiveGame`, so
  the route's import is unchanged.

  **A THIRD predicate joined it in #725**: `fitsMetadataFilters`, over the
  metadata BGG's import writes (#724). It is not an "active games" clause and
  does not belong in the set below — it is listed here because it sits in the
  same file and is applied at the same three sites (`drawPool`, the setup
  screen's preview, the Regal's grid), so a `grep` that lands here needs to know
  which of the two questions it is looking at. Its absent-value rule is the
  *base game's*, not the expansion's: a game the provider knows nothing about
  passes every filter. See
  `.claude/rules/provider-metadata-is-a-filter-not-a-tag.md`.

  **A FOURTH predicate joined the same three sites in #796 — and it is NOT in
  this file.** `fitsSomeTable` is the pool clause a multi-table session draws
  with ("can this box seat *some* table of three or more?" rather than "does it
  seat the whole party?"), applied by `drawPool` and by `showStartSession`'s
  preview exactly where `fitsPlayerCount` is. It lives in
  `public/js/table-split.js`, not here, because these are classic scripts over one
  global lexical scope and `MIN_TABLE_PARTIES` — which every other user of is in
  that file — cannot be declared twice. `draw-pool.js` carries a pointer comment
  so a `grep` landing here finds it; see
  `.claude/rules/multi-table-sessions.md` §2.

  **`fitsPlayerCount` grew a second term in #653**: the range a game admits is
  now the base box's *union* the ranges of the expansions the round owns for it,
  so a 3–4 game with a 5–6 extension is drawn at six. It is still one edit in one
  file — but note it is a union and **not** a widened interval, and that an
  absent range means the opposite thing on an expansion than it does on the base
  game. Both traps produce a plausible pool rather than an error; see
  `.claude/rules/expansions-widen-by-union.md` before touching it. That collapses two of the frontend sites below
  and is why this bullet no longer names a filter that a `grep retired` in `lib/`
  would find. The **player-count arithmetic** still lives per caller and still has
  a team term in it since #575 (`.claude/rules/session-teams.md` §2) — only the
  *range check* it feeds is shared.
- `lib/repo/{json,postgres}.js` `createRound` import filter (Postgres needs one
  `whereRaw` per state, the JSON one a `&&` per state).
- `lib/repo/{json,postgres}.js` `tenantSummary` → `activeGames`, the operator
  panel's per-round row. Easy to miss because it sits among *count* fields that
  deliberately do **not** filter: the sibling `games` counts every state, since
  the quota does (`.claude/rules/per-tenant-quotas.md`).

**Frontend:** `views-round.js` `activeGames`, `views-session.js` `activeGames`
(the one site that is **not** a copy — it passes the shared `isActiveGame`
straight to `filter`, and its pool preview uses `fitsPlayerCount` too, #634),
`views-pokale.js` (the Pokale "best rated" list, the stats scope, and the
per-row "Jetzt spielen" launcher at the `pokaleGameCard` level — it lived in
`views-round-tabs.js` until #528 split that file),
`round-rail.js` `activeGames` (the desktop rail's counts), and `recap.js`
**twice** — its game pool, plus an active/archived split on adjacent lines.

**Those two recap halves stopped being complements in #560, and that is the
point.** `games` is `!retired && !completed && !wish`; `archived` stays
`retired || completed` and must **not** grow a wish arm. A game the round does
not own belongs in neither half of a recap of their year — it is not on the
shelf, and it is not something they had and moved on from. Widening `archived`
to "everything not active" is the natural tidy-up and it is wrong.

`views-session.js` carries an inverse check of that second shape, gating the
results row's per-game "Aussortieren" button — and it **does** take the wish
arm (`retired || completed || wish`), because offering it would claim the group
is discarding a game they never owned.

## A THIRD semantics since #643: TASTE stats drop retired games only

The two archives are **not** interchangeable for a stat that claims the group
*likes* something. Retiring is the user saying the game has left the collection,
so calling it a favourite afterwards asserts a preference they have withdrawn;
completing is not — the game was played through, the opinions stand, and it
stays. The rule is one function, **`isNameableGame`** in `recap.js`
(`!game.retired`), and reading it as the `!retired && !completed` shape above is
wrong in the direction that silently drops completed games.

Its consumers:

- `recap.js` `retiredIds` — the `Set` built from it, used by **`mostDivisive`**
  (Größte Uneinigkeit) and **`memberFavourites`** (Lieblingsspiele). The skip in
  `memberFavourites` sits inside the per-member scan on purpose: that is what
  makes a member fall through to their best remaining game instead of vanishing.
- `views-member.js` `memberStats` — the member page's **Lieblingsspiel**.

**Why it is a shared function and not `!g.retired` written twice:** `memberStats`
computes its favourite from the raw sessions rather than through `recap.js`'s
index, so the two are separate implementations of one rule — the drift
`.claude/rules/shared-constants-across-the-stack.md` is about. A game must not be
able to vanish from the Pokale Lieblingsspiele while still sitting on that
member's own page.

### Meistgespielt counts retired games — do NOT "fix" it

`renderPokaleTab`'s play tally is the trap this section sets, because it sits
beside the cards above and looks like it was missed. It is not: **that card is a
record of nights that happened, not a claim of taste**, and retiring a game does
not unmake the evenings the group spent on it — so a retired game may still top
it (operator decision, 2026-08-04, revising #643's own acceptance criteria).
`test/pokale-retired.test.js` pins that Azul, retired, still wins the card on
three nights, right beside the specs that keep it out of every taste card.

**There are TWO of these cards since #800** — the period recap under the
Rückblick renders its own Meistgespielt over one calendar month or year, and it
counts retired games for the identical reason. The spec's exclusion list is
therefore a list rather than one card; see
`.claude/rules/a-second-section-must-not-reuse-a-card-label.md` for why both
cards need distinct LABELS for that list to work at all, and for the two
assertions that keep widening it from becoming a way to hide a card.

**A SECOND feature now counts the same field, and it must keep disagreeing with
this card (#778).** The recommender's play bonus (`playCounts` /
`buildPlayScale` in `lib/recommend.js`,
`.claude/rules/recommendation-scoring.md` §12) tallies the same `chosenGameId`
over the same sessions — and **drops retired games**, both from the bonus and
from the denominator it is scaled against. That is not an inconsistency to
unify: the card asks "what did we play", which retiring cannot unmake, and the
recommender asks "what should we play more of", which retiring answers
explicitly. Two questions over one field is exactly the case
`.claude/rules/shared-constants-across-the-stack.md` is **not** about — sharing
a counter here would need a parameter meaning "and should this pretend the game
is still on the shelf", which is the tell that the two are different
functions.

Also deliberately **not** in the set, though they are one line away:
`bestAndWorst` (Bestbewertet/Schlechtbewertet) and the Staubfänger keep the
active-only filter — they answer "what should we reach for", which only a game
still on the shelf can. **The period recap's `bestRated` (`public/js/period-recap.js`,
#800) joins them**, and it is the case that shows the split is about the CARD and
not about the window it covers: that section's Meistgespielt counts retired games
while its Bestbewertet, four lines away over the very same sessions, does not.
What forces it is not taste-vs-record reasoning alone — it renders under the same
word as `bestAndWorst`'s card, so two „Bestbewertet" cards disagreeing about
whether a retired game may be named would be incoherent whichever answer is right.
It takes the predicate by injection (`deps.isActive` = `isActiveGame`) rather than
spelling out a fourth `!retired && !completed && !wish`. And `collectRatings` / `recap.totals.ratings` /
`memberStats`'s `avgGiven` filter **nothing**: they measure how much the group has
rated, not what is on the shelf.

`test/pokale-retired.test.js` uses a fixture whose retired game leads on every
metric and whose runner-up is a **completed** game, so it fails both when a
filter is missing and when one is widened to both archives.

**Deliberately NOT filtered — don't "fix" these:**
- The games quota (`lib/routes/games.js`, `lib/quota.js`) counts **every** game
  regardless of state: an archived game still holds a row and a possible cover.
- The game **detail page** renders every off-shelf game fine (that is how you
  restore one); only the actions change. **Since #663 that is a linked path
  rather than a URL-only one** — the rows on all three off-shelf screens open it
  — so the page carries a branch per state: retired and completed offer
  „Wiederherstellen", a wish offers „Ins Regal", and only an active game is
  offered „Direkt spielen". That last branch is the load-bearing one: the direct
  pick goes through `isActiveGame` above, so offering it for a wish hands the
  user a seat picker and an English 400.

## Related: the SINGLE delete guard covers everything off the shelf

**Read this as being about `deleteGame` only.** #832 added `deleteGames`, the
bulk path behind the Regal's selection mode, and it deliberately carries **no**
such guard — it accepts a game still on the shelf, because making a user retire
200 games before deleting them is the two-step in bulk. What replaces the guard
there is the co-owner `game.delete` capability plus a confirm naming the count;
see `.claude/rules/bulk-paths-restate-the-single-path.md`.

`deleteGame`'s refusal marker was renamed `'not_retired'` → **`'not_archived'`**
in both backends. The guard is `!retired && !completed && !wish`, i.e. *"not in
the active collection"* rather than *"in one of the two archives"* — a wish must
be removable or the list could never be tidied. The **marker name kept its
`archived` spelling on purpose**: it is asserted in
`test/support/repo-contract.js`, and renaming it to match the widened meaning
would be a rename with no behaviour behind it. The route *message* did widen
("Only retired, completed or wished-for games can be deleted").

## Exclusivity is enforced in the repo, not the UI — and it is now THREE-WAY

`retireGame`, `completeGame` and `wishGame` each clear the other two states'
flags, in **both** backends. Doing it only in the views would let a client that
calls two endpoints produce a game that is both wished-for and retired — a game
the round simultaneously wants and has thrown out. The contract suite pins every
direction.

**`wishGame` breaks the other two's symmetry in exactly one way, deliberately:
only the ACQUISITION is an event.** `wishGame(…, false)` ("Ins Regal") writes the
ordinary `game_added` activity plus the `trackEvent` and the feed event, so a
game reaching the shelf via the wish list is indistinguishable from one added
directly. Setting the flag, creating with `wish: true`, and the whole
`wishlist=1` bulk import write **nothing** — no activity, no product event, no
Freundeskreis line. Wanting a game is not something the round did; buying it is.

That silence is also what makes the list safe to fill in bulk (a 200-game BGG
wishlist would otherwise be 200 announcements that the group acquired nothing),
and it is why `createGame`/`createGames` take the flag and decide the activity
**inside the repo** — a caller cannot get the pairing wrong.
