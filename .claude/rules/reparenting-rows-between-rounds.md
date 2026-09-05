---
paths:
  - "lib/repo/**"
  - "lib/routes/games.js"
  - "public/js/views-round-actions.js"
  - "test/support/repo-contract.js"
---

# Moving games between rounds (#253) — three things that fail silently

`moveGames(tenant, rid, targetRid, limits, gameIds)` reparents games of one
round into another and merges the two rounds' tags by name. Three parts of it
are non-obvious, and each fails *quietly* — wrong order, wrong count, or a
deadlock under concurrency, none of which throws.

**`gameIds` is the #402 subset, and absent ≠ empty** (the same discipline the
retired per-round `providers` setting followed): null/undefined moves the **whole
shelf** — #253's behaviour, still what an old client sends — while an array
moves exactly those games. The route rejects `[]` at the schema (nothing to
move is a client error, not a no-op) and dedupes before calling down. Membership
is checked in the **repo**, not the route, and returns the marker
`'unknown_game'` → 400: the shelf is already loaded inside the move's own
transaction, so the check is atomic instead of racing a snapshot read. Both
backends filter the loaded shelf in JS — Postgres deliberately does **not** use
a `whereIn`, because the refusal is a *count* comparison (`moving.length !==
want.size`) and a `whereIn` would need a second query to tell "not yours" from
"doesn't exist".

## 1. Postgres must take a FRESH `seq` per reparented row, or the backends diverge

Reads order children by `seq` (a `bigserial`), and the JSON backend appends the
moved games to the end of the target's `games` array. So a plain
`UPDATE games SET round_id = <target>` is **not** equivalent: the moved rows
keep their original `seq`, which was minted when they were first inserted. If
the source round is older than the target, they sort *before* the target's own
games instead of after them, and the two backends assemble a different round.

The fix is to update one row at a time, in the source's `seq` order, taking
`nextval(pg_get_serial_sequence('games', 'seq'))` for each. Note a bulk
`UPDATE … SET seq = nextval(…)` is *not* enough even though nextval is volatile
and evaluated per row: the row update order is unspecified, so the moved games
would land at the end in an arbitrary order among themselves.

`test/support/repo-contract.js` pins this down by asserting the exact title
order (`['Keeper', 'Tagged', 'Plain', 'Archived']`) after a move — that
assertion is the only thing standing between here and a silent ordering split
that `npm test` alone (JSON backend only) would never show.

## 2. Lock BOTH round rows in one id-ordered statement

The move writes the target round's `tags` and reads the source's, so both rows
are locked `FOR UPDATE`. Locking them in two statements — or in argument order —
lets two concurrent moves between the same pair of rounds in opposite directions
each hold the row the other wants, i.e. a deadlock. One
`whereIn('id', [rid, targetRid]).orderBy('id').forUpdate()` acquires them in a
deterministic global order, so the two transactions serialize instead.

This relies on the sort happening *below* the locking, which is worth knowing is
real rather than assumed — `EXPLAIN` on the emitted statement puts `LockRows`
above `Sort`, so rows are locked in the order the sort emits them:

```
LockRows
  ->  Sort  (Sort Key: id)
        ->  Bitmap Heap Scan on rounds
```

## 3. The quota check lives in the REPO, not the route

Every other quota (`.claude/rules/per-tenant-quotas.md`) is checked in the route
before calling the data layer. This one cannot be, because the number of tags the
move would *create* in the target is only known after building the tag remap —
computing it in the route would mean duplicating the whole find-or-create-by-name
reconciliation. So the route passes `limits` (`{ maxGames, maxTags }`, or `null`
when `quota.enforced()` is false) down and the repo returns the marker
`'quota_games'` / `'quota_tags'`, which the route maps to the same
`403 { error, limit }` contract the other caps use.

The check runs **before any write**, inside the transaction, so a refusal is
genuinely atomic. That matters more here than for the other caps: a half-moved
shelf has no undo.

## Smaller things worth keeping

- **A moved game drops out of the source's sessions.** Each session's `gameIds`
  loses the moved ids, and a session left with none is dropped — the exact rule
  `deleteGame` already applies. Moving the *whole* shelf therefore takes the
  round's whole history with it; a #402 subset move leaves the sessions that
  still hold a kept game, scrubbed. The sheet's confirm reflects that: it warns
  about history **only when a selected game actually appears in a session**
  (`round.sessions` is already on the snapshot it holds), because a warning that
  cries wolf on a tidy-up of never-played games gets clicked through.
- **A reused tag keeps the TARGET's spelling and icon.** Matching is trimmed and
  case-insensitive, but the target round is never renamed or restyled by a move —
  same reasoning as `addTag` refusing to restyle on a duplicate name (#255).
- **Unused source tags are not copied, and tags left behind are not cleaned up.**
  A tag no moved game carries has nothing to remap; a source tag whose every game
  just left is simply left in place, since nothing treats an unused round tag as
  invalid.
- **Absent-key parity survives a refusal.** The target's `tags` array is only
  written back when tags are actually created, so a quota-refused move cannot
  leave `tags: []` on a round that had no tags (the Postgres column would still
  be NULL — see `.claude/rules/postgres-backend.md`).
- **The sheet always sends an explicit `gameIds`, even when everything is
  checked.** It could omit the key and get the same result via the "all" default
  — but then the count the user just confirmed is not what the server moves: a
  game added from another device since the sheet opened would ride along
  unseen. The absent-means-all default exists for *older/other* clients, not as
  the UI's happy path.
- **The Regal entry point is gated on `round.games.length`, not `activeGames`** —
  archived games move too, so a round holding nothing but retired games must
  still offer the action — **and on `!round.shared`**: moving is owner-only
  (#411), so the entry point is hidden on a shared round and the route answers a
  grantee `403 not_owner` before it looks anything up. That guard is what stops a
  grantee reparenting the shelf into a round of the owner's they were never
  invited to; see `.claude/rules/round-grant-resolver.md` §2.

## `copyGames` is a SIBLING, not a mode (#916)

The copy that leaves the source shelf alone is its own route
(`POST …/games/copy-to`), repo method and capability (`games.copyOut`). Four
things about that split are load-bearing:

- **The risky half is not shared.** The session scrub, vote deletion and `seq`
  re-minting above are the parts that can lose data, and a copy needs none of
  them; a `mode` flag would have put it inside the one function whose bugs
  destroy history. What *is* shared is what both genuinely answer alike:
  `mergeTagsInto` (`lib/repo/import-copy.js`) holds the find-or-create remap for
  both backends and both verbs.
- **`copyGame` differs from `importGame` by exactly one thing: it KEEPS the shelf
  state.** The round-creation import starts an empty round, so everything it
  carries belongs on the active shelf; a copy answers „we have these here too",
  and the picker offers archived and wished rows. Reviving them silently would
  make the sheet lie about what it just did, and a revived wish would claim the
  target round owns a box nobody has bought.
- **Owner-only for the move's reason, which is the TARGET round and not the
  source:** a grant re-scopes the request to the owner's whole tenant
  (`.claude/rules/round-grant-resolver.md`), so a grantee clearing this could
  write games into any round of the owner's they were never invited to. „It
  destroys nothing" is not an argument for widening it.
- **`games_copied_out` is in NEITHER period-recap bucket**, and unlike
  `games_moved_out` that is not a judgement call: *nothing left*. Only
  `games_copied_in` is shelf growth.

**The duplicate flag needs the TARGET's shelf, which the sheet does not hold** —
`fetchRoundList` gives the round list, not their games — so `showTransferGames`
(`public/js/views-round-actions.js`, renamed from `showMoveGames` when it stopped
being move-only) fetches the chosen target with `fetchRound` on change, in copy
mode only. Having the route report skipped titles instead was rejected: the flag
must be visible while the user still has a choice, and the picker's job is
letting them tick one back on. Two identically-titled games on one shelf stays
**allowed** (`test/games-copy.test.js` pins that the server does not dedupe by
title behind the picker's back), so the flag is an aid and never a gate — a
failed lookup flags nothing rather than blocking the copy.
