---
paths:
  - "lib/repo/json.js"
  - "lib/repo/postgres.js"
  - "lib/routes/games.js"
  - "lib/routes/sessions.js"
  - "test/support/repo-contract.js"
---
# A bulk mutation is not "the single one in a loop" — it re-decides four things

`moveGames` (#253), `createGames` (#481) and now `retireGames`/`deleteGames`
(#832) all exist because the single-game path does not scale to a shelf that was
filled in one action. Each time, the same four questions come up, and three of
them fail **silently** if answered by reflex.

## 1. The activity is ONE counted row, not N

`games_imported`, `games_moved_out`/`games_moved_in`, `games_retired`,
`games_deleted` all carry `{ count }` instead of a title. Undoing a 200-game
import as 200 `game_deleted` rows would bury every other event the round has ever
had — the Chronik is a shared, human-read log, not a journal.

Consequence for the client: `public/js/views-chronik.js` must learn the new type,
or the row renders as **nothing at all** (`if (!meta) return;`). That is the
`session-log.js` failure mode in
`.claude/rules/shared-constants-across-the-stack.md`, one entity over.

## 2. Every side effect of the single path has to be re-derived, and two leak quietly

- **Cover objects.** `DELETE …/games/:gid` frees the image when
  `isImageReferenced` says nothing else points at it. A bulk delete that skips
  that leaks **one object per game** — 200 files on the very operation the
  feature exists for, with nothing anywhere to say so
  (`.claude/rules/deletion-paths-must-free-cover-objects.md`). The repo therefore
  returns `images: [...]`, and the route loops the reference check **per image**:
  an imported round copies the cover *path*, not the file, so "these games are
  gone, so their covers are" is wrong.
- **The session/feed scrub.** Same reasoning, and here the bulk path must not
  merely call the single helper in a loop: `scrubGame` walks every session, so N
  calls is O(games x sessions) — over the wire, inside one transaction, on
  Postgres. Both backends therefore take a **`Set`** (`scrubGames`) and the
  single-game helper is that same pass over a one-element set, so the two cannot
  drift.

**Resist the neighbouring "optimisation" while you are in there.** Skipping the
rewrite of a session the selection did not touch looks free and is not: the JSON
backend cleans stray votes on every surviving session, so a Postgres skip makes
the two backends answer differently on a shape only one of them can produce. The
repo contract is what would eventually catch that; not writing it is cheaper.

## 3. A stale selection is refused WHOLE, and `gameIds` is not optional

`moveGames` set the contract: an id naming a game of another round returns
`'unknown_game'` and **nothing is written**. Silently acting on the subset the
caller got right is worse than an error it can show.

The schema half is separate and sharper for a destructive route. `moveGamesSchema`
makes `gameIds` **optional**, where absent means "the whole shelf" — deliberate
there (#402 kept #253's behaviour). Do **not** copy that shape onto a bulk
retire or delete: a missing field must never be read as "everything". Both
`bulk-*` routes require a non-empty array, and `test/games-bulk.test.js` pins
that `{}` and `{ gameIds: [] }` are 400s.

## 4. The role it costs is the SINGLE path's, per action — never one gate for the pair

`POST /games/bulk-retire` costs `round.write` and `POST /games/bulk-delete` costs
`game.delete` (co-owner), exactly as `…/:gid/retire` and `DELETE …/:gid` do.
Doing something to twenty games at once changes the scale, not the kind of act —
so gating the pair together would either hand a plain grantee a way around the
co-owner delete guard, or take an ordinary write away from them.
`test/round-grants-access.test.js` drives both directions against a real grant.

## The one place #832 deliberately BREAKS symmetry — and what it makes stale

`deleteGames` **accepts a game still on the shelf**; `deleteGame` refuses one
with `'not_archived'`. That is the feature rather than an oversight: the single
guard exists so a stray `DELETE` cannot erase an active game, and making a user
retire 200 games *and then* delete them is the two-step in bulk, i.e. the problem
this route was opened for. What replaces the guard is the co-owner capability
above plus a client confirm naming the count and stating that the games leave
every past session with them.

So **`.claude/rules/active-games-filter-sites.md`'s "Related: the delete guard
covers everything off the shelf" is now true of `deleteGame` only** — it is
cross-linked there, and `docs/features.md` states the same split. If you are
reading either as "nothing in the active collection can ever be deleted in one
call", that stopped being true in #832.

**Related:** `.claude/rules/active-games-filter-sites.md` (the archive states and
the single-game guard), `.claude/rules/round-roles-are-a-chokepoint.md` (§4's
table), `.claude/rules/shared-constants-across-the-stack.md` (§1's client half),
`.claude/rules/deletion-paths-must-free-cover-objects.md`.
