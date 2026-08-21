---
paths:
  - "public/js/table-split.js"
  - "public/js/session-outcome.js"
  - "public/js/views-session-tables.js"
  - "lib/session-split.js"
  - "lib/routes/sessions.js"
  - "test/table-split.test.js"
  - "test/sessions-multi-table.test.js"
---

# Splitting one voted session across several tables (#796) — five silent traps

„Mehrere Tische" relaxes the draw pool, then replaces the results screen with a
builder that proposes complete splits of the people and the drawn games. Nothing
below throws, 400s or reddens on its own; each is a plausible-looking evening.

## 1. "The best-scoring table count" is ALWAYS the most fragmented one

The objective improves **monotonically with the number of tables**: more tables
means more distinct games, which means fewer tier-1 violations and a higher
rating sum, with only the last tiebreak pushing back. So ranking the feasible
counts by score and keeping a window "around the best" yields five variations of
the most shattered arrangement — precisely the failure §3a of the issue warns
about, arrived at by the mechanism it prescribed to avoid it.

`proposeTableSplits` therefore keeps the **`MAX_TABLE_PROPOSALS` smallest**
feasible counts. That is also where the default belongs (fullest tables), so the
window starts at the highlight rather than around a maximum nobody wants.

**The general form:** before ranking candidates by an objective, check whether the
objective is monotone in the very dimension you are ranking. If it is, the ranking
carries no information and the dimension has to be *exposed* rather than
optimised.

## 2. `MIN_TABLE_PARTIES` is why the pool predicate is not in `draw-pool.js`

`fitsSomeTable` is a sibling of `fitsPlayerCount` and belongs beside it. It
cannot be there: these are classic scripts over **one global lexical scope**, so
two files declaring `const MIN_TABLE_PARTIES` is a `SyntaxError` at load —
"Identifier has already been declared" — and every other user of that constant is
in `table-split.js`. Injecting the constant instead would have meant a fourth
injected dependency for one integer.

So it lives in `table-split.js` and `draw-pool.js` carries a **pointer comment**,
because a `grep` for the pool predicates otherwise finds one of the two.

## 3. A child must carry NO votes, and FRESH guest ids

Both are the natural thing to copy over, and both are wrong:

- **Votes.** `gameStats` tallies every session whose `gameIds` holds the game
  (`core.js`), so copying the parent's column into a child would count each
  rating twice and quietly move the game's average — a number that changed
  because the evening was split, with nothing on any screen to explain it.
- **Guest ids.** A guest id is a key in *that session's* vote map and in its
  `winnerIds` (`.claude/rules/session-guests-are-not-members.md`), so re-using the
  parent's would make two evenings' records collide on one person. They are
  re-minted per child, from the parent's names; teams are rebuilt against the new
  ids in the same pass.

## 4. Direct-pick consults NO player range, so the confirm must check it itself

A child is an ordinary direct-pick session (#532), and that path deliberately
ignores `minPlayers`/`maxPlayers` — a spec has pinned it since then. So nothing
downstream catches an over-full table: without `validateSplitTables`'s own range
clause the split simply creates a session with five people at a four-player box,
and the group finds out at the table.

The same function is the only thing enforcing that a **team is not split** across
two tables. The builder moves *parties*, so it cannot produce one — which means
this refusal is only ever reached by a hand-rolled request, and is exactly the
kind of check that gets "simplified" away as unreachable.

## 5. `sessionOutcome` is tested SPLIT-FIRST, and that ordering is load-bearing

`split` is derived from the child ids, ahead of `cancelled` and `finished`. The
routes refuse both combinations, so it can only be reached by a hand-crafted blob
— but a screen saying „Abgebrochen" while listing the three tables it spawned is
incoherent in a way "split" never is. The children are a material fact; the
booleans are flags.

The helper exists because **sixteen sites** read `session.cancelled` to mean "this
evening did not happen at one table" and every one of them fails quietly on a
split parent: the Chronik draws it with the played icon, the hub offers to resume
it, the share text describes an evening nobody played, and `partyDistribution`
teaches the recommender that the round routinely plays twelve-handed.
`test/split-parent-sites.test.js` pins those four; each was verified by
reinstating the boolean and watching one named test redden.

## Why the proposals are computed on the SERVER and persisted

Three reasons, and only the third is about cost:

- several people are looking at their own devices (#209, #652), so two of them
  would otherwise see different splits at the same moment;
- the shell is served **cache-first**, so during a rollout some devices run an
  older algorithm than the others;
- with no cap on the table count (§1), a sixty-person group means sixty phones
  each running the search.

The search is **seeded from the session id** even so. That does not replace
persistence — a change to the algorithm would still move the answer for a session
whose builder is open — but it makes the first-writer-wins write *benign* rather
than merely rare (two simultaneous first opens compute byte-identical proposals),
and it makes a reported bad split reproducible from the stored session.

Both repo mutators are first-writer-wins for that reason, and `splitSession`
pushes its log entry **inside** the claim rather than through `withSession`'s
`events` argument — an unconditional append would give a double tap two
„Aufgeteilt" lines for one split.

## Smaller things

- **The seating atom is a PARTY, not a person** (#575): three parties is three
  hands whatever the headcount behind them, so `MIN_TABLE_PARTIES` and every range
  check counts parties while every rating counts people. The two are never
  conflated, and `sessionPartyGroups` is the name-free resolver the server needs
  (`partyName` reads `t()`, which does not exist in Node).
- **An admitted table size may have HOLES.** A 3-4 base with a 6-8 expansion
  admits {3,4,6,7,8} and nothing at 5, so the search enumerates admitted sizes
  rather than reducing them to a min/max pair
  (`.claude/rules/expansions-widen-by-union.md`).
- **`VIOLATION_MAX` is coupled to the vote scale.** "1 or 2" became "at or below
  2 on the 0-5 scale" when #797 made retirement the zero, which is also why a
  retire vote is a violation with no clause of its own. Change the scale and this
  moves in the same change.
- **Never show a score.** An aggregate number invites arguing about the formula
  instead of about the evening; the builder shows each table's average, its
  *lowest*, and every unhappy seating by name.
- **The two range predicates COINCIDE on the obvious fixture.** At a table of
  four they differ only on a box that seats three but not four, so a preview-vs-
  draw parity spec written over an ordinary shelf stays green against a preview
  that ignores the flag entirely. The fixture needs a `3-3` game
  (`.claude/rules/break-the-code-on-purpose.md`).

## The browser pass found three defects a green suite could not

All three were an existing component brought into a new screen and behaving
differently there — `.cover-ph` covering the viewport, `.score-pill` flying to the
page corner, three `ti-*` classes rendering nothing. None is specific to this
feature, so they live in
`.claude/rules/absolutely-positioned-components-escape-a-new-host.md` and
`.claude/rules/tabler-icon-codepoints.md`. What belongs here is only that they all
survived the suite, `lint`, `coverage:ci` and a full round of DOM probes:
**screenshot a new screen once, at a real viewport, before believing the probes.**

**Related:** `.claude/rules/shared-constants-across-the-stack.md` (entries ten and
eleven), `.claude/rules/active-games-filter-sites.md` (the pool predicates this
adds one to), `.claude/rules/session-teams.md` (the party arithmetic),
`.claude/rules/retire-is-the-zero-of-the-vote-scale.md` (what one vote is worth),
`.claude/rules/session-guests-are-not-members.md` (why guest ids are per session).
