---
paths:
  - "public/js/draw-pool.js"
  - "public/js/filter-panel.js"
  - "public/js/views-session.js"
  - "public/js/views-regal.js"
  - "lib/draw.js"
  - "lib/routes/sessions.js"
---

# A provider FACT is a filter; a round's own vocabulary is a tag — and the two must never merge

The app has two ways to narrow a shelf, and since #827 they look **more**
interchangeable than ever: two labelled sections inside one „Filter" panel, under
one count, on the same two screens. They are not interchangeable, and the line
between them is what keeps either of them useful:

| | Tags (#238/#241/#726) | Metadata filters (#725) |
|---|---|---|
| Where the value comes from | the round types it | BGG's import (#724) |
| Who maintains it | the group, forever | nobody |
| Vocabulary size | a handful, chosen | ~84 categories, ~180 mechanics |
| Included values combine | AND by default, OR opt-in | **OR, always** |
| An unset value on the game | the game simply lacks the tag | **the game passes** |

The user request that produced #725 states the failure of ignoring this: *"as
tags it will probably get chaotic at some point."* Expressing provider facts as
tags means every round hand-maintaining a parallel copy of what BGG already
knows, going stale the moment a game is added by someone in a hurry.

**#242 is the other direction of the same mistake and must not be re-run.** It
retired a hand-set `duration` **enum** and its filters. #725 reinstates neither:
nothing here is typed by a user, and nothing is stored per round.

## 1. The OR is not a style choice — AND collapses the pool to zero

A game carries 3–8 categories drawn from BGG's ~84. AND-ing two picks therefore
finds almost nothing, while AND-ing two *round tags* is meaningful precisely
because a round has few and chose them. So `matchesAnyOf` is `some`, not `every`,
and the AND lives only **between** the two lists (a category clause and a
mechanic clause both have to hold).

Do not "unify" this with the tag chips' tri-state cycle either. There is no
exclude state here: with OR semantics a third click would have nothing to mean.

## 2. An ABSENT field on the game passes EVERY filter — get this backwards and the shelf empties

`fitsMetadataFilters` guards each clause with a `typeof` on the *game's* value,
the same shape `fitsOwnRange` uses for an unfilled player range. Reversing it —
"no playtime, so it cannot satisfy a playtime budget" — silently hides:

- every game linked to a provider that carries none of these fields (the four
  digital storefronts did, until #744 retired them — a legacy row still has no
  metadata and still passes every filter),
- every hand-typed game,
- **the entire shelf** on an instance with no `BGG_API_TOKEN`.

Under-filtering is recoverable: the user sees a game and skips it. Over-filtering
hides games with nothing on screen to say so, on the one screen whose whole job
is to answer "what can we play tonight".

**That permissiveness is why these screens must TRIGGER the backfill (#736), and
#725 shipped without doing so.** A game whose BGG metadata was never fetched is
indistinguishable here from one BGG genuinely knows nothing about — so on a shelf
nobody had opened the detail pages of, „max. Komplexität 1" drew Agricola and the
complexity control did not exist at all (§3's option list is derived from stored
values). The rule stays exactly as written; what changed is that the values are
now fetched where they are read. See
`.claude/rules/provider-info-triggers-and-stamping.md`.

## 3. The OPTIONS come from the shelf, never from the vocabulary

`metadataFilterOptions(games)` derives the categories and mechanics on offer from
the round's own games, and reports each numeric field as available only if some
game carries it. Three properties follow, and each is load-bearing:

- the list is **self-pruning** — it shrinks and grows with the shelf, with no
  configuration anywhere;
- it **cannot offer a filter that yields an empty pool** (of that clause alone);
- a shelf carrying none of a field renders **no control at all**, rather than an
  empty one — the same thing the tag field already does with no round tags.

**That last one has a second half that is easy to miss: a stored filter whose
control is gone must be dropped too.** `normalizeMetadataFilters(raw, options)`
is where both happen, which is why every entry point goes through it — the route,
the #252 preset restore, and the Regal on every render. Skip it in one place and
that screen shows an active-filter count over a control that is not on screen,
i.e. a filter the user can neither see nor clear. The frontend spec for this
needs the **numeric** case or the payload, not the chips: a category with no chip
looks identical whether it was dropped or not (found by breaking exactly that,
`.claude/rules/break-the-code-on-purpose.md`).

## 4. What is shared with the server, and what deliberately is not

`fitsMetadataFilters` and the three ladders (`PLAYTIME_CHOICES`, `AGE_CHOICES`,
`WEIGHT_CHOICES`) live in `public/js/draw-pool.js`, which `lib/draw.js` and
`lib/routes/sessions.js` require — the shape
`.claude/rules/shared-constants-across-the-stack.md` exists for. The ladders are
validated by **membership, not by range**, so the client cannot offer a step the
route would reject and the two cannot disagree about granularity.

The route re-normalizes rather than trusting the body: an unknown category is
dropped exactly like an unknown tag id, an off-ladder value collapses to
"unfiltered", and **nothing here can 400** (`startSessionSchema`'s stated
contract). An inverted complexity range is **swapped** in the shared normalizer
rather than dropped, so the preview and the draw cannot disagree about what a
hand-crafted one means.

The **rendering** is a separate file (`public/js/filter-panel.js`) because it
is DOM code: requiring it into a Node test would put it in the coverage report at
~10% and redden `coverage:ci` with every test green
(`.claude/rules/frontend-helper-modules-and-coverage.md`). Test it through the
jsdom harness instead.

## 5. One control, two sections — what #827 changed and what it did not

The two halves share a single `<details>` now (`renderFilterPanel`), because
narrowing the pool is one job and the screen was asking it in three grammars.
Merging the *presentation* is not licence to merge the *semantics* in §1–§3: they
stay separate labelled sections, with a hairline between them, and every clause
above still holds unchanged.

Two smaller traps, one of which #827 rewrote:

- **The metadata chips are `.mfilter__chips`, not the shared `.filter-chips`.**
  The original reason is **gone**: it was that the Regal's phone block hid
  `.regal-filter .filter-chips` behind its own „Filter" button, and #827 deleted
  that block along with the button. What survives is the better reason — the two
  chip rows are different controls. `.filter-chips` carries the tags' tri-state
  cycle (ignore → include → exclude); these are plain multi-select, because with
  OR semantics a third click would have nothing to mean (§1). Sharing the class
  would invite sharing the behaviour. Nothing in jsdom can see a stylesheet, so
  this is asserted over the markup the renderer emits.
- **The two badges are now ONE number, and that reversal is deliberate.** They
  were separate while they were two controls that collapsed on **different
  triggers** (the chips only below 860px, the drawer at every width) — one number
  over two independently-hidden controls could not say which was filtering. With
  a single control and a single trigger that question no longer exists: opening
  the panel shows both labelled sections at once. Do not re-split it without
  re-splitting the control.

**Related:** `.claude/rules/active-games-filter-sites.md` (the other predicates
this joins), `.claude/rules/expansions-widen-by-union.md` (the previous addition
to the same shared file, and its own absent-value asymmetry),
`.claude/rules/shared-constants-across-the-stack.md`,
`.claude/rules/hidden-attribute-vs-display-rule.md` (the badge's paired
`[hidden]` rule).
