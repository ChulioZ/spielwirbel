---
paths:
  - "lib/repo/**"
  - "lib/draw.js"
  - "lib/routes/sessions.js"
  - "lib/routes/games.js"
  - "public/js/views-round*.js"
  - "public/js/views-member.js"
  - "public/js/round-rail.js"
  - "public/js/recap.js"
  - "lib/quota.js"
  - "lib/routes/rounds.js"
  - "test/support/repo-contract.js"
---
# "Active games" is filtered in ~10 places — two of them server-side (#250)

Adding the `completed` state (#250) meant every place that used `!g.retired` to
mean *"in the active collection"* had to become `!g.retired && !g.completed`.
The trap: the filter is **not** centralized, and the two most consequential
sites are on the **server**, where no view test would catch a miss.

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
- `lib/draw.js` `isActiveGame` — the draw `pool` filter *and* `lib/routes/sessions.js`'s
  direct-pick 400 both go through this **one** predicate since #486. They used to
  be two inline copies in the route, "easy to fix one and miss the other" — miss
  the direct-pick one and an archived game stays playable by id even though it is
  invisible in the UI that would offer it. A third archive state is now one edit
  here, and `test/draw.test.js` unit-tests the predicate directly rather than only
  through an HTTP round-trip. The route still spells the *message* per archive
  ("Game is retired" / "Game is completed"), so that branch survives — but the
  400 itself no longer can be missed. `drawPool` also carries the
  **player-count** arithmetic, which is mirrored in `showStartSession()`'s live
  preview and has had a team term in it since #575 — see
  `.claude/rules/session-teams.md` §2; the two copies must move together.
- `lib/repo/{json,postgres}.js` `createRound` import filter (Postgres needs a
  second `whereRaw`, the JSON one a second `&&`).

**Frontend:** `views-round.js` `activeGames`, `views-session.js` `activeGames`,
`views-round-tabs.js` (the Pokale "best rated" list, the stats scope, and the
per-row "Jetzt spielen" launcher at the `gameStatCard` level),
`round-rail.js` `activeGames` (the desktop rail's counts), and `recap.js`
**twice** — its game pool, plus an active/archived split whose two halves sit on
adjacent lines and must be edited as a pair (`!retired && !completed` for one
count, `retired || completed` for the other). `views-session.js` also carries an
inverse check of that second shape, gating the per-game "Aussortieren" button.

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

Also deliberately **not** in the set, though they are one line away:
`bestAndWorst` (Bestbewertet/Schlechtbewertet) and the Staubfänger keep the
active-only filter — they answer "what should we reach for", which only a game
still on the shelf can. And `collectRatings` / `recap.totals.ratings` /
`memberStats`'s `avgGiven` filter **nothing**: they measure how much the group has
rated, not what is on the shelf.

`test/pokale-retired.test.js` uses a fixture whose retired game leads on every
metric and whose runner-up is a **completed** game, so it fails both when a
filter is missing and when one is widened to both archives.

**Deliberately NOT filtered — don't "fix" these:**
- The games quota (`lib/routes/games.js`, `lib/quota.js`) counts **every** game
  regardless of state: an archived game still holds a row and a possible cover.
- The game **detail page** renders archived games fine (that is how you restore
  one); only the actions change.

## Related: the delete guard covers both archives

`deleteGame`'s refusal marker was renamed `'not_retired'` → **`'not_archived'`**
in both backends, and the route message to "Only retired or completed games can
be deleted". If you add a third archived state, that guard and this list are
what need editing — the marker name is asserted in
`test/support/repo-contract.js`, so a rename fails loudly rather than silently
letting active games be deleted.

## Exclusivity is enforced in the repo, not the UI

`retireGame` clears `completed`/`completedAt` and `completeGame` clears
`retired`/`retiredAt`, in **both** backends. Doing it only in the views would
let a client that calls both endpoints produce a game listed in two archives at
once. The contract suite pins the round-trip in both directions.
