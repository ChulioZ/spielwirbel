# "Active games" is filtered in ~10 places — two of them server-side (#250)

Adding the `completed` state (#250) meant every place that used `!g.retired` to
mean *"in the active collection"* had to become `!g.retired && !g.completed`.
The trap: the filter is **not** centralized, and the two most consequential
sites are on the **server**, where no view test would catch a miss.

The full set — grep `retired` in `routes/`, `lib/` and `public/js/`
before assuming you have them all:

**Server (the ones that bite silently):**
- `lib/repo/{json,postgres}.js` `listRoundSummaries` `gameCount` — the
  home-screen count **and** the import dropdown's "n games". `createRound`'s
  import skips both archives, so a `gameCount` that counts an archived game
  **promises more games than the copy delivers**. These two must stay in
  agreement; `test/rounds.test.js` asserts
  `copy.games.length === entry.gameCount` for exactly that reason.
  (It lived in `routes/rounds.js` when #250 wrote this rule; #301's summary
  read moved it down into the repo, where each backend now filters on its own —
  `json.js` with `!g.retired && !g.completed`, `postgres.js` with two
  `IS NOT TRUE` clauses in the `listRoundSummaries` SQL. Both must change
  together.)
- `routes/sessions.js` — **two** guards, easy to fix one and miss the other:
  the draw `pool` filter *and* the direct-pick `if (game.retired)` 400. Miss the
  latter and an archived game stays playable by id even though it is invisible
  in the UI that would offer it.
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

**Deliberately NOT filtered — don't "fix" these:**
- The games quota (`routes/games.js`, `lib/quota.js`) counts **every** game
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
