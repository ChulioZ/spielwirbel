---
paths:
  - "public/js/draw-pool.js"
  - "lib/draw.js"
  - "lib/routes/games.js"
  - "lib/routes/lookup.js"
  - "lib/repo/json.js"
  - "lib/repo/postgres.js"
  - "lib/providers/bgg.js"
  - "public/js/views-round-detail.js"
  - "public/js/views-session.js"
  - "public/js/views-round-tabs.js"
  - "test/draw-pool.test.js"
  - "test/game-expansions.test.js"
---

# An owned expansion widens a game's range by UNION, and an absent range means the OPPOSITE thing on it

`game.expansions` (#653) is the only thing an expansion reaches into: a round
that owns Catan's 5–6-player extension can draw Catan at six. The predicate is
`fitsPlayerCount` in `public/js/draw-pool.js`, shared by `lib/draw.js` (the real
pool) and `showStartSession()` (the live preview). Two things about it are wrong
in the natural implementation, and **both produce a plausible pool rather than an
error** — no throw, no 400, no red test.

## 1. A hull admits counts NO BOX in the cupboard supports

The obvious shape is "widen the interval":

```js
min = Math.min(base.min, ...exp.mins);   // WRONG
max = Math.max(base.max, ...exp.maxes);
```

Base 3–4 plus a **solo** expansion 1–1 hulls to **1–4**, which admits a table of
**2**. Nothing the group owns seats two people. The game is then offered to a
pair, drawn, and carried to the table before anyone finds out.

The rule is a union of the *admitted counts*, never a hull of the bounds:

```js
fitsPlayerCount(game, n) = fitsOwnRange(game, n) || expansions.some(e => expansionAdmits(e, n))
```

3–4 + 1–1 therefore admits 1, 3 and 4 and rejects 2.
`test/draw-pool.test.js` pins exactly that five-element vector, because a hull
implementation passes every *other* case in the file.

## 2. "No numbers" means "any table size" on the base game and "widens nothing" on an expansion

`fitsOwnRange` guards each bound with a `typeof` precisely so a game whose range
was never filled in stays drawable at every count (#634). Reading an expansion
the same way inverts the feature: one expansion BGG has no counts for would make
its game drawable at **every** count, which is the opposite of what recording it
was for.

So `expansionAdmits` requires **both** bounds, and that is stricter than it first
looks — a lone bound is refused too:

| Owned expansion | Reads as | Why not the other thing |
|---|---|---|
| `{min: 5, max: 6}` | admits 5–6 | — |
| `{}` | admits nothing | an open interval would admit everything |
| `{max: 6}` | admits **nothing** | as an open interval it would push a 3–4 game down to **solo** |
| `{min: 5}` | admits **nothing** | …and up to infinity |

The cost is under-admission on a half-declared expansion. That is the safe
direction and it is fixable in the UI: the detail page's free-text form takes
both numbers or neither, and refuses one (`detail.toast.expansionNeedsBoth`).
The route enforces the same both-or-neither rule, so a hand-rolled request cannot
store a half range either.

## 3. `requiredExpansions` must derive from the SAME predicate

The results screen names the expansion the table actually needs
(„Braucht Erweiterung: …"). Computing that from a second rule — "the ones whose
max exceeds the base's", say — lets the warning and the pool disagree: a game
drawn because of an expansion, with the warning naming a different one or none at
all. `requiredExpansions` is therefore `expansionAdmits` again, gated on the base
box *not* fitting, and both live in the one shared file.

## Where an expansion deliberately does NOT reach

Worth stating, because each looks like an omission:

- **The BGG collection import still excludes expansions**
  (`excludesubtype=boardgameexpansion`). A bulk shelf import is the one place 50
  expansions of one game are noise — `.claude/rules/bgg-collection-import.md`.
- **No `trackEvent`.** Adding a product counter is a deliberate act, not symmetry
  with `game_added` (`.claude/rules/product-event-logging.md`).
- **No feed event, no Home surface, no rating, no tag, no cover, no vote.** An
  expansion is a title, a link and optionally two numbers.
- **The round-copy import carries expansions but still drops the player range**,
  because `createRound`'s import has only ever copied title + image. So a copied
  game's expansions widen nothing until someone re-enters its range — the
  inventory value ("do we have Seefahrer?") is what survives the copy, and that
  is the half worth having there.

## A stored expansion is IMMUTABLE, and that is a licence constraint

`PUT …/games/:gid/expansions` replaces the whole list. An entry already on the
game may be kept (send its `id`) or dropped (omit it) — **never edited**. The
route re-reads the stored record and ignores every other field the body carries
for it.

That is not tidiness: a BGG-sourced expansion's title is BGG's data, and the XML
API terms forbid modifying what is retrieved
(`.claude/rules/add-game-lookup-provider.md`). Per-field trust rules would have
to distinguish provider entries from hand-typed ones on every save; immutability
gets the same guarantee for free. Fixing a wrong range is remove-and-re-add.

For the same reason the **provider resolves the newly ticked ones server-side**
(one batched `/thing?id=a,b,c`), exactly like the collection import re-resolves
titles: the body's `title`/`minPlayers`/`maxPlayers` are ignored for anything
carrying a `providerId`.

## An expansion title is user-authored text, so it is REDACTABLE

It is the fifth such field after round name, game title, member name and tag
name, and adding one without a takedown path would have left a DSA notice with no
answer. `redactText({ kind: 'expansion', roundId, id })` blanks it and — like a
tag — **keeps the row**, so redacting a name never silently shrinks a draw pool.

The one shape decision: the redact API is keyed `{ kind, roundId, id }` with no
room for the owning game, so `roundContent` flattens every game's expansions into
one list and `redactText` scans the shelf for the id. That is only sound because
ids are minted per expansion and **re-minted on a round copy** — reusing them
would make the lookup ambiguous across games.

**Related:** `.claude/rules/active-games-filter-sites.md` (the other filters this
predicate sits among), `.claude/rules/shared-constants-across-the-stack.md` (why
the predicate is one file both sides require),
`.claude/rules/session-teams.md` §2 (the party count it is applied to — bodies
are not the number), `.claude/rules/admin-moderation-surface.md` §3 (the
redaction contract).
