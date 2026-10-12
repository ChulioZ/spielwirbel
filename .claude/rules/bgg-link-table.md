---
paths:
  - "lib/bgg-links.js"
  - "lib/repo/bgg-links-file.js"
  - "lib/repo/bgg-links-rows.js"
  - "lib/routes/bgg-links.js"
  - "public/js/bgg-links.js"
  - "public/js/game-info.js"
  - "test/bgg-links-fill.test.js"
---

# The BGG link table (#1638): three things that fail silently

Category, mechanic and designer names link to their BGG pages through a global
`(type, bggId, name)` table that every BGG parse fills on the side. Games keep
their name lists, and a surface resolves a link by `(type, name)`. Each
failure below leaves a name plain text, which is also what an ordinary unknown
name looks like, so none of them shows up on screen.

## 1. Names are matched VERBATIM, so the store must never tidy them

The game row holds BGG's string untouched (the licence forbids modifying it),
and the lookup compares exactly. A store that trimmed or re-cased a name would
stop matching the row's copy. A case-insensitive *lookup* is not the danger:
the answer is keyed by the stored name, so the client cannot tell the two
apart. The contract spec therefore stores a name with outer spaces and breaks
the write side, never the read side.

## 2. The name dedupe is load-bearing on Postgres only

`normalizeLinkRows` dedupes a batch by `(type, bggId)` and again by
`(type, name)`. On the JSON backend the second pass is redundant, because the
upsert's own "drop a different id holding this name" filter covers the same
case. Deleting it leaves `npm test` green. On Postgres it is what stops one
`INSERT … SELECT` from writing two rows with one name into the unique index.
Measured: with it removed, the JSON contract is green and the Postgres one red.
Do not delete it on the strength of a JSON run. The stale-row `DELETE` is the
same: JSON answered correctly with it gone, purely by list order. The contract
now renames the new holder afterwards, which is the only shape that reaches it.

## 3. The vote sheet stays unlinked on purpose

`gameInfoBody` (the vote cards' ⓘ) shares `factRow` with the detail screen but
never calls `linkGameInfoNames`, so a vote never leads out of the app.
`test/bgg-links-view.test.js` asserts the sheet renders no anchor and asks for
nothing. Keep that call out when the two builders are tidied together.

**No backfill exists, and none is needed.** The corpus re-enriches every row
within `BGG_CORPUS_STALE_DAYS`, and any game fetched from BGG fills its own
names at once. The ids are deliberately NOT a `PROVIDER_INFO_FIELDS` entry,
because that would re-ask BGG for every already-complete game
(`.claude/rules/provider-info-is-a-field-set.md`).

**Related:** `.claude/rules/bgg-corpus.md` (the store this mirrors, and why it
must never ride `data.json`),
`.claude/rules/redundant-guards-make-each-other-untestable.md` (§2's shape,
except here the "redundancy" is real on only one backend),
`.claude/rules/shared-constants-inventory.md` (the thirtieth entry).
