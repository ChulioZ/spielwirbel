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
| Excluded values combine | AND-NOT | **AND-NOT** (#1003) |
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

### The EXCLUDE direction takes the opposite combinator (#1003)

Since #1003 these chips are **tri-state**, exactly like the round-tag chips:
ignore → include → exclude → ignore. This file used to say a third click "would
have nothing to mean" under OR semantics, and the user request that produced
#1003 answered that — *"se puede hacer en las etiquetas personalizadas, pero no
en las de la bgg"*. „Anything but Party Game" is what it means.

**`excludesAnyOf` is `some` and rejects outright — AND-NOT, the mirror image of
the include list's OR.** Requiring *every* excluded value to be present before
rejecting is the symmetry a later reader will reach for, and it is wrong for the
very reason inclusion is an OR: against a ~84-value vocabulary a conjunction
almost never fires, so „anything but Party Game" would hardly ever exclude
anything. Same shape as an excluded tag, which rejects on its own in both
combination modes.

**Exclusion BEATS inclusion on the same game**, unconditionally. Letting an
include rescue a game makes an exclusion unreachable on exactly the games it is
aimed at. The contradictory pair is unrepresentable in the UI (one chip, one
state) and reachable only from a hand-crafted preset, so `normalizeMetadataFilters`
also drops the value from the include list — which is what keeps the chip able to
paint exactly one state rather than picking one at render time.

**And the absent-value rule of §2 holds in this direction too**: a game BGG knows
no categories for carries none of the excluded ones and stays in. Inverting that
is the one way this feature empties a shelf.

**The chips' state moved from `aria-pressed` to `aria-label`** with the third
state, because a button has two pressed states and this control has three, so
"not pressed" cannot tell exclude from ignore. That is the answer `paintTagChip`
already reached, and the ban glyph keeps the exclude state off colour alone.

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

**A control is gated on the field its own CLAUSE reads.** Since #1025 the
playing-time pair is a **containment** test, so each control is gated on the
game field of the same name: „at most M" compares the game's `maxPlaytime` and is
gated on `playtimeMax: anyNumber('maxPlaytime')`; „at least N" compares
`minPlaytime` and is gated on `playtimeMin: anyNumber('minPlaytime')`.

**It was CROSSED until #1025, and un-crossing it is the half of that change that
fails silently.** While the clauses were overlap tests, „at most N" read the
game's `minPlaytime`, so its flag was `anyNumber('minPlaytime')` — which reads
like a typo and was the whole point. If you find a comment or a rule still
describing a crossing, it predates #1025. Getting the gating out of step with the
clause in either direction leaves a shelf whose games carry only one bound
rendering a control that *every* game passes — one that can never do anything,
which is the second bullet above inverted. BGG returns 0 for an unset bound and
`toPositiveInt` makes that a null, so the one-sided shelf is real, not
hypothetical.

### The recommendation toggle is gated on the SCREEN as well as on the shelf (#1005)

Every control above is available exactly when the shelf carries its field. The
„nur was BGG hier empfiehlt" toggle is the first that is not: it compares BGG's
suggested-players poll against the **party count**, and the Regal filters a shelf
rather than an evening, so there is no count to compare against. Two gates,
therefore — `options.recommended` (some game carries a NON-EMPTY poll) and the
screen's own `opts.tableSized` — and collapsing them into one either renders a
dead control in the Regal or hides a live one on the setup screen.

`options.recommended` tests non-emptiness rather than key presence, unlike
`anyNumber`: `[]` is a *stored* value for this field
(`.claude/rules/provider-info-is-a-field-set.md`), so gating on the key would
offer a toggle that can never do anything on a shelf BGG has polled nowhere.

The predicate is **`fitsRecommendedCount` in `draw-pool.js`, not a clause inside
`fitsMetadataFilters`** — that function takes a game and a filter set and nothing
else, while this question needs the count. Same shape and same reason as
`ownedByParty`. Three ways it must answer *yes*, each of which is a way to hide
games on missing data: the toggle is off, the poll is unanswered (BGG has no
not-recommended list, so silence must never read as rejection), or the count sits
**outside the game's own box** — the poll has no rows there, so a count reached
through an owned expansion is not its business. That last clause is
`fitsOwnRange`, deliberately, not `fitsPlayerCount`: the union with the
expansions is precisely the region the poll cannot speak about. And `lib/draw.js`
**skips the clause entirely under `multiTable`**, because the relaxed pool is
built for tables that do not exist yet and there is no one table size to ask
about.

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

**The playing-time pair IS swapped and DOES carry, since #1025 — it was neither
before.** Under containment the pair is a genuine interval like complexity: „at
least 120, at most 30" asks for a game that both finishes inside 30 minutes and
runs at least two hours, which nothing can satisfy, so the shared normalizer
swaps it and `rangeRow` is passed `carry: true`.

That is a reversal, and the reason for the old behaviour is worth keeping,
because it is what a reader will reconstruct from the shape: while the two
clauses read *opposite ends of the game's own range*, an inverted-looking pair was
a real query — a game whose spread covers both, i.e. exactly a 20–600 campaign —
so swapping or carrying would have answered a different question than the one
asked. `rangeRow`'s `carry` parameter in `filter-panel.js` is still that
distinction made explicit; today both ranges pass `true`, and a future
non-interval pair would pass `false`.

The **rendering** is a separate file (`public/js/filter-panel.js`) because it
is DOM code: requiring it into a Node test would put it in the coverage report at
~10% and redden `coverage:ci` with every test green
(`.claude/rules/frontend-helper-modules-and-coverage.md`). Test it through the
jsdom harness instead.

## 5. One control, two sections — what #827 changed and what it did not

The two halves share a single control now (`renderFilterPanel`), because
narrowing the pool is one job and the screen was asking it in three grammars.
Merging the *presentation* is not licence to merge the *semantics* in §1–§3: they
stay separate labelled sections, with a hairline between them, and every clause
above still holds unchanged.

**#844 changed WHERE that control opens, and nothing else here.** It was a
`<details>` unfolding in the page; it is a trigger opening an `openEditor` overlay
(popover ≥860px, sheet below). The two labelled sections and the hairline moved
into the overlay untouched — see
`.claude/rules/an-inline-disclosure-moves-its-own-trigger.md` for why the
disclosure had to go.

Two smaller traps, one of which #827 rewrote:

- **The metadata chips are `.mfilter__chips`, not the shared `.filter-chips`.**
  The original reason is **gone**: it was that the Regal's phone block hid
  `.regal-filter .filter-chips` behind its own „Filter" button, and #827 deleted
  that block along with the button. The *second* reason is gone too since #1003 —
  the two rows now share the tri-state cycle, so they are no longer different
  controls in that sense. What survives is that they are different **vocabularies
  with different combinators** (§1: round tags AND by default, provider values OR)
  over separately-scoped state, and that the two rows are styled and placed
  independently. Keep them separate classes; the shared fills (`.chip.is-on`,
  `.chip.is-excluded`) are base-component rules and arrive anyway. Nothing in
  jsdom can see a stylesheet, so this is asserted over the markup the renderer
  emits.
- **The two badges became ONE number (#827), and then no badge at all (#844).**
  They were separate while they were two controls that collapsed on **different
  triggers** (the chips only below 860px, the drawer at every width) — one number
  over two independently-hidden controls could not say which was filtering. With
  a single control and a single trigger that question no longer exists: opening
  the panel shows both labelled sections at once. Do not re-split the count
  without re-splitting the control.

  #844 then dropped the badge itself, because the applied filters now sit outside
  the panel as removable chips and a badge beside them is a **second, differently
  grained** statement of the same thing — the chips are per value (each category
  its own) where `countMetadataFilters` counts controls, so the two would disagree
  the moment anyone picked two categories. The count survives where it cannot
  contradict anything: the trigger's `aria-label`, computed from `chips.length`.
  `countMetadataFilters` itself is untouched — the **server** uses it
  (`lib/routes/sessions.js`) to decide whether a draw carried filters at all,
  which is a different question and must not be retuned to match the chips.

**Related:** `.claude/rules/active-games-filter-sites.md` (the other predicates
this joins), `.claude/rules/expansions-widen-by-union.md` (the previous addition
to the same shared file, and its own absent-value asymmetry),
`.claude/rules/shared-constants-across-the-stack.md`,
`.claude/rules/hidden-attribute-vs-display-rule.md` (the applied-chip row's
paired `[hidden]` rule — the badge's, until #844 replaced it),
`.claude/rules/an-inline-disclosure-moves-its-own-trigger.md` (why the panel is
an overlay), `.claude/rules/popover-vs-sheet-editors.md` (the presentation it
routes through).
