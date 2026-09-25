---
paths:
  - "lib/recommend.js"
  - "lib/recommend-spotlights.js"
  - "lib/corpus-cache.js"
  - "lib/routes/recommendations.js"
  - "public/js/views-recommend.js"
  - "test/recommend.test.js"
  - "test/recommend-view.test.js"
  - "test/recommend-spotlight.test.js"
---
# The recommender (#682): a weighted score fails by RANKING, never by throwing

Every mistake in `lib/recommend.js` produces a plausible, confident, wrong list.
No exception, no 400, no red test — the screen looks finished and the ordering is
simply not the one anybody intended. That single property decides how this code
is written and how it is tested.

## 1. Isolate each term in its own test, against its exact weight

The natural spec ("the better game came first") is satisfied by roughly half the
mistakes the file can make — a term reading the wrong field, two weights swapped,
a missing clamp. `test/recommend.test.js` therefore scores **two candidates that
differ in exactly one attribute** and asserts the *difference* equals that term's
weight:

```js
assert.equal(delta(profile, entry({ bayesRating: 8.5 }), entry({ bayesRating: 5.5 })), W_QUALITY);
```

Each of those cases also pins the field the term must **not** read, which is
where the real bugs live: `rating` instead of `bayesRating` (the raw mean lets
twelve enthusiasts outrank a classic), and `minPlayers`/`maxPlayers` instead of
the `suggested_numplayers` poll (the box routinely lies). Both breaks were
verified to redden exactly their own named case.

**The isolation shape is right and the FIXTURE decides whether it means anything
— #772.** For the two cosine terms the delta equals the weight only if the
candidate can reach 1.0, and against `shelfCorpus` — one mechanic, one category —
it always could. So both cases passed at full weight while the terms delivered
~70% of it on any real shelf: raw cosine compares an L2-normalised profile spread
over dozens of mechanics against a candidate's handful, so a candidate whose
*every* mechanic was a round favourite scored **0.536** against the 0.5 naming
threshold, where complexity, players and time saturated at 0.98–1.0. The rescale
(`attainable()`) divides by the best a candidate of that size could reach against
this profile, so the assertion measures the term's range rather than a fixture
artefact.

Hence `tasteCorpus` beside `shelfCorpus`: eight mechanics over eight games. Two
traps live in that fixture, both producing a **vacuously green** test, both
measured while writing #772's:

- **A uniform profile scores every candidate 1.0** — equal components mean any
  candidate drawing only from the taste set is a perfect match by construction,
  the standard deviation is zero, and a spec about *variation* sees nothing. Mix
  foreign values in.
- **Two corpora from one periodic formula carry the same distribution**, so a
  corpus-size test built that way has no difference to detect: the deliberate
  break stayed green at three strengths. What the bigger corpus *adds* must be a
  genuinely different population.

## 2. An absent attribute must score NEUTRAL, not zero

A corpus row missing a playtime has made no claim about evening length; scoring
that as maximally wrong systematically buries every thinly-documented game —
invisibly, since the list stays full. This is the same asymmetry
`.claude/rules/provider-metadata-is-a-filter-not-a-tag.md` §2 records one layer
up, where an absent value *passes* a filter.

The consequence for the reasons is the mirror image: only a term scoring **above**
neutral may be named, or a card compliments a game on an attribute nobody knows.

## 3. The implementation link needs BOTH directions, and they read different sets

A `boardgameimplementation` link is stored as the *names* it points at. So "the
owned row names this candidate" and "this candidate names an owned game" are two
separate lookups — against the profile's collected `implementations` and against
the owned rows' own `name`s. BGG usually records the link on both items, but not
always, so checking one side leaves the common case unfiltered: the group owns
the classic, the candidate is the reprint.

Found by a test asserting the reverse direction, against code that had only the
forward one. It is exactly the shape that could not have failed loudly.

**Since #900 this governs a FILTER, not a penalty** — `reimplementsOwned`, §5's
fourth hard filter — and the constraint is unchanged but now sharper: a missed
direction no longer costs 3% of a score, it leaves a game the round already owns
in the list. The same both-directions shape is mirrored by the within-list
dedupe in the same §5 bullet, with "what has been kept so far" standing in for
the shelf.

**A fixture that records the link on both rows cannot see the bug.** BGG usually
writes both, so the natural test passes against a one-directional
implementation — which is how the original was found. Each direction needs its
own case, with the link on **one** side only.

## 4. The party-size distribution must come from the shared resolver

The round's real table sizes are the half BGG cannot know, and they are **parties,
not bodies** — six people in three pairs want a three-player game. Deriving it
here from `round.members` would silently drop guests and flatten teams, so
`lib/recommend.js` requires `sessionPartyCount` out of `public/js/session-people.js`
(the deliberate direction in
`.claude/rules/shared-constants-across-the-stack.md`). That function exists
*because* the naming path (`partyName` → `t()`) is unreachable from Node — see
`.claude/rules/session-teams.md` §4.

## 5. Four hard filters that are not optimisations

- **A game already in the round in ANY state is dropped**, retired included, and
  retired is the sharpest of the five: they explicitly got rid of it. A test
  covers all four off-shelf states, because the natural implementation filters
  the *active* shelf and quietly recommends a retired game back.

  **"Already known" and "shapes the profile" are two different lists (#776), and
  one loop in `buildProfile` builds both.** A **wished** game is in the first and
  not the second: it must never be recommended back, and it must contribute
  nothing — no vector component, no pull on the complexity/time targets, no
  novelty comparison, no reason contributor, and no place in either count. It had
  carried affinity **1.5**, the *top* of the `gameAffinity` ladder, on the
  argument that a want with no play data beats a game sitting unplayed. True
  about wanting, wrong as an input: a wish is not a statement about what the group
  likes to **play**, and the reader cannot verify it against their own shelf — so
  the list a round saw was steered hardest by games it does not own, and
  „Ähnliche Mechaniken wie X" routinely named one of them, on a screen whose
  entire premise is games you do not own. `gameAffinity` therefore has **no wish
  rung at all** rather than an unreachable branch; the filter happens one level
  up. Adding one back is the obvious-looking omission this paragraph exists to
  stop. **The same sentence had a second cause one state over** — a *retired*
  game could be named for the same reason and could **not** be fixed this way;
  see §11's affinity-ranked-contributors bullet (#798) for why the remedies
  differ.

  **The ladder is `retired -1.0` / `rated 0.6 + (score-3)/2, floored at -0.5` /
  `unrated 0.6 fading with the round's history` (#799, re-anchored by #1227 —
  §15), plus an additive play bonus of up to `1.0` on the two non-retired arms
  (#778, §12), and both ends were re-tuned away from the obvious values.**
  Unrated used to be
  `1.0` — exactly what a game rated 3.0 earns, and more than anything below it.
  Since a rating only exists where somebody voted in a *voting* session, every
  other route onto the shelf (the BGG import, a manual add, a direct-pick
  evening) produced that value, so a normal round's profile was dominated by
  games nobody has said anything about. Be honest about the size of the lever
  though: mass share is driven mainly by COUNT, so on an import-shaped shelf
  (8 rated / 30 unrated) `0.6` moves the unrated block from 71% to 60%, not into
  a minority. `0` was rejected — a collection-import round would have almost no
  profile, and a direct-pick round none at all, since every one of its
  most-played games is unrated. **That last clause is what #778 then answered
  directly** — the play bonus is precisely what distinguishes an unplayed shelf
  entry from a game the round puts on the table constantly, and `0.6` was chosen
  partly in anticipation of it. The two changes reinforce each other; read §12
  before re-tuning either.

  **`-1.0` deepens the negative past the unrated rung's height on purpose:**
  retiring is the strongest explicit verdict a round can give, and at `-0.5` it
  was worth less in absolute terms than a game the round has never formed an
  opinion about. Two mechanisms already absorb it and needed no change —
  `prefixSums` drops negatives so the attainable ceiling is untouched at any
  magnitude, and `cosine` clamps at 0 so a more negative dot cannot become a
  second penalty with a weight nobody chose. The L2 worry (a bigger negative
  lengthens the vector and shrinks every positive component) does not
  materialise, because the same retired game usually also subtracts from the
  mixed components. Measured on `[loved, shared-with-retired, retired-only]`:
  `-0.5` gives `0.920 / 0.383 / -0.077`, `-1.0` gives `0.937 / 0.312 / -0.156` —
  the loved component goes **up**.

  **What it broke in the SPEC is the thing to remember.** Three existing cases
  went red, none of them about the ladder: a `targetWeight` pinned at exactly `3`
  (eight games at 0.6 sum to `3.0000000000000004`), and both retired-naming cases
  in §11, where one unrated game at `0.6` no longer outweighs a retired one at
  `-1.0` — so the shared mechanic went negative, the term stopped clearing the
  `> NEUTRAL` gate, and the specs would have passed **for the wrong reason**,
  exactly the failure their own comments warn about. The fix is to RATE the
  fixture's shelf, never to soften the assertion; both were re-verified against
  their original deliberate breaks afterwards.

  **Both counts move, and that is load-bearing** — §6's five empty states are
  picked from them. Wishes counted in `linkedGames` would send a round of ten
  wishes and two owned games to `unknownGames` ("the database does not know your
  shelf") when the true answer is `fewGames`, the one state carrying the
  BGG-import button. Verify `linkedGames` **and** `profileGames`, never just the
  list.
- **A title the round has DISMISSED is dropped (#782)** — „Nicht interessiert",
  stored as `round.dismissedRecommendations` (`[{ externalId, title, at }]`). It
  is a **filter and nothing else**: it touches neither count, contributes no
  vector component, and has no `gameAffinity` rung — the same shape a wish took
  after #776, for a related but distinct reason. The symmetry with retiring
  (`-1.0`, which *does* reshape the profile) is tempting and was rejected: a
  retired game is bounded by what the round once owned, while a dismissal is one
  tap and unbounded, so thirty of them at a negative rung would outweigh a
  40-game shelf in the two list-valued vectors and narrow the list onto a
  shrinking niche — a self-reinforcing loop with no play data behind it. It would
  also be the first input where a UI action reshapes the ranking. If that is ever
  revisited, the open question is the **cap** on the dismissals' combined
  negative mass, not the value (operator, 2026-08-15).

  **The list rides on the response ahead of the thin-profile early return**, so a
  round below the floor can still see and undo what it ignored. A dismissal is
  also **not a game row** in any backend — see the issue and
  `lib/repo/json.js`'s `dismissRecommendation` for why inventing one would put a
  title the round never owned into `gameCount`, the Regal's archive views, the
  Chronik, the public stats and the per-round game quota.
- **A REIMPLEMENTATION of a profiled game is dropped (#900)** — BGG's own
  `boardgameimplementation` link, in both directions (§3). It was a soft
  `W_NOVELTY_PENALTY` until #900, and the arithmetic is why it had to stop being
  one: 3% against a quality term carrying 35% cannot displace a strong candidate,
  so a highly-ranked reprint of a shelf game still landed near the top — exactly
  what the constant's own comment says must not happen. The cheaper-looking
  implementation that silently gets it wrong is checking **one** link direction;
  see §3 for why, and for the fixture shape that hides it.

  **It inherits the wish exclusion rather than restating it.** Both sets it reads
  are built from `profiled` (owned, non-wish), so a reprint of a **wished** game
  stays in the list — they do not own it, so a second route to it is a live
  suggestion, not a duplicate. That is the same #776 decision the bullet above
  states, and the reasoning holds harder for a filter than for a penalty.

  **What stayed a penalty, deliberately:** the same-designer + shared-mechanics
  half of the old `noveltyPenalty`. It is a guess with a 0.6 threshold on it, and
  hard-dropping on it would silently bury legitimately distinct games by prolific
  designers. So `W_NOVELTY_PENALTY` keeps its weight and has one path left
  instead of two.

  **The sibling is the WITHIN-LIST dedupe**, which is not a fourth filter but the
  same relation applied to the candidates against each other: nothing compared
  them, so a round whose taste points at a family of reimplemented classics got
  several editions of one game — a list that looks varied and is not. Three
  things about `dedupeReimplementations` are load-bearing and each fails silently:
  it runs **after** the score sort (so "the best-scoring member survives" falls
  out of the walk order and needs no second comparison), **before** the slice (so
  a list holding duplicates still comes back `limit` long instead of short by
  however many it contained), and it stops at `limit` survivors (so it never
  becomes a second full pass over ~17.5k rows — §7 has the budget). A dedupe test
  whose duplicate sits *past* the cutoff would be absent anyway and passes against
  a build that does no deduping at all.

  **It matches only the DIRECT link, unlike the shelf filter**, which also treats
  a candidate and an owned game naming the same third title as a match. BGG has
  not said A and C are one game because both reimplement B, so the greedy walk
  keeps A, drops B, keeps C — intended, not a transitive closure left for later.
- **An un-enriched corpus row is dropped**, since it carries no attributes at all
  — it could be neither scored nor explained. The response still reports
  `corpusRows` over the whole corpus, which is what lets the screen tell "your
  shelf is too thin" from "this instance has no database".

## 6. The five empty states are not interchangeable

`few linked games` / `the corpus does not know your shelf` / `no corpus at all` /
`you have ignored everything that was left` / `nothing left to suggest` ask the
reader for opposite things, and only two have an action behind them (import a BGG
collection; un-ignore something). Collapsing them into one "nothing to show"
sends someone off to re-import a collection they already imported.
`test/recommend-view.test.js` asserts one per state; collapsing the selector
reddens four.

**`allDismissed` is checked fourth, and its position is the whole assertion**
(#782): after the three database states, which answer the more fundamental
question of whether anything could be said at all — but **before** `noneLeft`,
which claims "you already own everything that fits". That claim is false and
unactionable for a round that has merely hidden what was left, and it is the one
empty state the reader can fix from where they are standing, so the „Ignorierte"
restore surface is rendered on the empty screen too.

## 7. Size the snapshot against the ELIGIBLE count, not the default

`BGG_CORPUS_SIZE` defaults to 5000, and reasoning from that default understates
this feature's cost by ~3×: `docs/configuration.md` records that a real dump
yields **17,483 eligible** rows and advises setting the ceiling *above* that, so
the ratings floor rather than the rank cap decides what is kept. Measured
2026-08-14 (`recommend()` over 40 owned games):

| rows | JSON | heap held / process | per request |
|---|---|---|---|
| 5,000 | 2.5 MB | 4 MB | 9.6 ms |
| **17,483** | 8.9 MB | 10 MB | 27.7 ms |
| 100,000 (the `num()` ceiling) | 50.4 MB | 68 MB | 171 ms |
| **17,483, with the three spotlights (#1228)** | — | — | **29.2 ms** (27.5 without, same run) |

The #1228 row was measured 2026-09-25 on a synthetic 17,483-row corpus (40 owned
games, 30 runs, median), with the pre-#1228 `recommend()` timed in the same
process as the control — so read the **difference**, not the absolute figure,
which is a different machine from the 2026-08-14 rows. Two things decided it:

- **The naive one-pass version cost +13 ms**, nearly all of it the complexity
  tile's second `scoreCandidate` per candidate. The exact prune (§16) brought it
  to +1.7 ms. Four independent walks would have been roughly four times the row
  above.
- **The Geheimtipp threshold is a walk plus a sort, ~0.8 ms**, paid once per
  corpus snapshot and cached on the array `corpus-cache.js` hands out — so the
  first request after a reload pays it and no other does.

Two things that measurement settled and one it did not:

- **The ranking does not change with corpus size.** Rows are rank-ordered and
  quality carries 35% of the score, so a bigger corpus only adds candidates that
  were already going to lose. Growing the pool is a cost question, never a
  correctness one.

  **#772 put one corpus-relative statistic in this file, and the line it must not
  cross is here.** Reason lines are ranked by how *unusual* a value is (a per-term
  z-score, streamed via Welford during the scoring pass — §11). It feeds the
  **reasons only, never the score**: a corpus-relative term in the score would
  make the ranking depend on corpus composition and break exactly the invariance
  above. A reason line re-ordering as the corpus grows is acceptable; the
  recommendation order is not. `scoreCandidate` cannot see the statistics at all,
  which is the structural half of that guarantee — and §1's rescale is
  **profile**-relative for the same reason, the candidate-relative version being
  the cheaper implementation that breaks it.
- **The obvious suspect is not the cost.** Rebuilding the 17k-entry `corpusById`
  Map per request looks like the expensive part and is **1.5 ms**; scoring is
  10 ms and the rest is the sort over every scored candidate. Don't "optimise"
  the Map away — measure first.
- **The heap figure is PER PROCESS**, and a Railway deploy overlaps two
  (`.claude/rules/deploy-invariants-are-pinned-in-code.md`). At the ceiling that
  is ~136 MB of snapshot alone. Unreachable from today's dump, since above the
  eligible count the cap stops binding — but it is the number to check before a
  future dump makes it reachable.

## 8. The corpus snapshot needs a TTL as well as an invalidate

`lib/corpus-cache.js` is dropped by `lib/corpus.js` on every write **this process**
makes. That is not enough on its own: Railway overlaps two containers on every
deploy (`.claude/rules/deploy-invariants-are-pinned-in-code.md`), so the
enrichment tick that wrote a row may have run in the other one, where no
`invalidate()` of ours can reach. Without the TTL that process serves its
boot-time snapshot until it is replaced.

## 9. What the browser pass caught — and the width it never rendered

**Caught:** `localeTag()` takes the locale **explicitly** and falls back to
English when called bare, so `localeTag()` rather than `localeTag(getLocale())`
prints `8.4` to a German reader who should read `8,4` — nothing throws, only the
separator is wrong. And BGG's two range bounds are not guaranteed ordered:
rendering them verbatim printed `80–60 Min.`, which reads as a bug in the app.
Ordering them is not *modifying* the data — both numbers still show, unrounded
(`.claude/rules/bgg-corpus.md`).

**Missed:** the screen needs TWO entry points. The Regal's narrow entry to
„Könnte euch gefallen" is `.rail-owned`, so from 1280px up it is `display: none`
and the **rail** is the only way in — and #682 shipped with the narrow row alone,
leaving the feature unreachable on a desktop-width window. Reported by the
operator, who had read the news entry and then could not find it. The pass that
missed it ran at 1180px and 390px: two widths, both **below the one breakpoint
that mattered**. `test/off-shelf-parity.test.js` now pins the narrow surface's
links as a subset of the rail's; see
`.claude/rules/responsive-content-width.md`.

**Where that narrow entry lives moved in #777**, and the lesson above is exactly
why it moved: it was a `.round-footer` row below the *entire* cover grid, i.e.
present but, on a phone column of 1–2 covers, unreachable in practice. It is now
a „Nicht im Regal" control in the Regal's `.section-tools` header row, opening a
sheet with all four off-shelf destinations (`openOffShelfSheet`,
`public/js/views-regal.js`). The parity test was retargeted at that sheet in the
same PR rather than left watching an empty `.round-footer` selector.

## 10. #264 removed a recommender, and its guard had to be re-aimed rather than deleted

`test/rounds.test.js` asserted the whole `…/recommendations` path 404s. This
feature is deliberately not that one — local corpus, weighted arithmetic, no
model, no processor, nothing that can hallucinate a title — so the read answers
now. What the guard still holds is #264's actual shape: **no POST, no DELETE, no
stored runs**. Deleting the test because "recommendations exist again" would have
lost the guard entirely; the sibling `recommendationRuns` assertion is untouched.

**#782 added the first writes under this path and the guard still passes
UNMODIFIED**, which is what the sub-path is for. `POST …/recommendations/dismissed`
and `DELETE …/recommendations/dismissed/:externalId` sit one segment deeper than
the two paths the guard names, so a bare `POST …/recommendations` and a
`DELETE …/recommendations/anything` still 404 exactly as asserted. That is not a
loophole: what #264 forbids is a **stored model run** — something scored, billed,
persisted and re-triggerable — and a list of ids the read filters against is none
of those. Do not "tidy" the writes up to `POST …/recommendations`; the depth is
carrying the guarantee.

**The role table was blind to this router until #782.** `test/round-roles.test.js`
walks a hand-copied `MOUNTS` mirror of `lib/app.js`, and `/recommendations` was
missing from it from #682 onward — so both of its guards would have reported
"every mutating round route states a required role" without ever having looked at
this file. It cost nothing only because the router had no mutating route to miss.
The list now has its own completeness test against `lib/app.js`.

## 11. Three of the six reasons were UNREACHABLE, and the weights were why (#772)

`reasonsFrom` sorted qualifying terms by `weight × value`, so the ordering was
decided by the constants and not by the candidate: mechanics' *maximum*
contribution (0.130) sat below quality's *minimum qualifying* one (0.175), so a
mechanics reason could surface only when quality failed its threshold — which a
top-24 candidate essentially never does, since quality is 35% of the score that
put it there. Categories and time needed **both** quality and complexity to fail.
The live list read rating, complexity, players, forever, and the operator
reported that mechanics and categories appeared to play no role at all.

- **Rank by standout, keep the absolute gate.** The z-score decides the *order*
  among qualifying terms; §2's `> NEUTRAL` gate still decides *admission*, or a
  card compliments a game on an attribute nobody knows. The rescale is what made
  that gate passable for the taste terms at all — the two halves are coupled.
- **Four of the six reasons restate the fact row** (`★ 8.4 · complexity 3.2 ·
  2–4 players · 90 min`, `recFacts`), so mechanics and categories — the only two
  saying something new, naming the round's *own* games — were exactly the two the
  ordering could not reach. When adding a reason type, ask what it tells a reader
  that the card does not already print.

**And the two that don't restate the fact row restate EACH OTHER (#775).** Making
them reachable revealed the same question one level in: they surfaced *together*,
naming the same owned games, so a card read „Ähnliche Mechaniken wie Ark Nova und
Wingspan" directly above „Gleiche Art Spiel wie Ark Nova und Wingspan" — two of
three lines, one piece of information. BGG categories correlate heavily with
mechanics and `topContributors` derives both from the same shelf by the same
"most shared values" rule, so the overlap is the common case rather than a
coincidence. `reasonsFrom` therefore names **at most one** of them:

- **The survivor is the more unusual one**, decided by the same standout ordering
  every other reason uses rather than a preference of its own. On an exact tie
  mechanics wins — higher weight, and the signal people cannot articulate
  themselves. The exclusion is **unconditional**, not "only when the two name
  overlapping games": a card whose shape depends on a coincidence the reader
  cannot see is less predictable for no gain.
- **Presentation only.** Both terms keep their weights and both still contribute
  to the score; nothing about the ranking moves.
- **The z-score over a SPIKE distribution is value-independent**, which is the
  fixture trap here and it is sharp: one candidate above a floor of zeros scores
  z = 5.477226 whether its value is 0.75 or 1.0, bit-identical. So a fixture that
  varies only the two candidate *values* produces an exact tie, and a spec
  asserting "the higher standout survives" is **vacuously green against a rule
  that always keeps mechanics**. Vary the two terms' *distributions* — in
  `test/recommend.test.js`, by letting some fillers share the candidate's
  mechanics, which makes a perfect mechanics match ordinary while a weaker
  category match stays unusual. Measured: mechanics v=1.0 z=2.598 c=0.130 against
  categories v=0.75 z=5.477 c=0.053, so the case discriminates against "keep
  mechanics", "keep the stronger match" and "keep the bigger contributor" at once.
- **The reason contributors are AFFINITY-ranked, and a retired game must be
  excluded there even though it stays in `profile.games` (#798).**
  `topContributors` ranked by the raw count of shared values, which knows nothing
  about the *direction* a game pulled the vector — so a retired game, whose
  affinity is negative and which pushed the profile **away** from the very
  attributes being matched, could be named first: „Ähnliche Mechaniken wie X"
  naming the game they explicitly got rid of, as the reason to consider a new
  one. This is the wish bug of §5 one state over, and it needs the **opposite**
  remedy: a wish could leave `profile.games` outright, a retired game cannot,
  because its negative contribution is how "we threw this out" reaches the
  vectors at all. Rank by `shared × max(0, affinity)` and keep **both** filter
  clauses — `shared > 0` says "this game has something to do with the term",
  `rank > 0` says "the profile weighted it positively", and a future rung of
  exactly 0 must drop out rather than sit in the list at rank 0.

  **The obvious test covers only the sort half, and goes green with the filter
  clause deleted** — measured. Against a normal shelf the retired game sits at
  rank 0 with ten positive contributors above it, so the *sort* already pushes it
  past `REASON_GAMES` and the filter never runs. The clause only bites when FEWER
  than `REASON_GAMES` contributors qualify, because then the slice has a free
  slot to fill with a rank-0 game. So the filter needs its own case built on a
  shelf where exactly **one** owned game carries the attribute. The count alone
  also favoured games with **long attribute lists**, so a game listing eight
  mechanics beat a beloved game listing three whatever the round thought of
  either.
- **The empty-contributors filter runs BEFORE the slice**, or dropping that line
  costs the card a slot a qualifying term would have filled. The state is still
  unreachable through `recommend()` after #798 — but **the argument changed and
  the old one no longer closes**, which is the kind of stale premise a rule file
  keeps authoritative-looking for years. It used to be "a term only clears the
  `> NEUTRAL` gate by matching a game in `profile.games`, which is the very list
  the contributors are drawn from"; the contributors are now only that list's
  **positive-affinity subset**, so matching a profiled game is no longer
  sufficient. What still closes it: clearing the gate needs a positive dot
  product, a positive dot needs a positive component in the profile vector, and
  only a positive-affinity game can accumulate one — and that game is itself a
  qualifying contributor. Measured while writing #798: a mechanic carried solely
  by a retired (-1.0) and a rated-1 (0.0) game scores exactly **0**. So it stays
  pinned by a hand-built `reasonsFrom` call rather than through `recommend()`,
  and the ordering is what keeps it harmless if a future rung breaks that chain.

## 13. Ratings are SHRUNK before they reach the ladder (#894)

`ownRating` no longer feeds `gameAffinity` its raw Spielwirbel-Score: the score
is pulled toward a fixed neutral prior in proportion to how thin it is, so a
game three people rated 5,5,5 on its one evening stops shaping the taste profile
as hard as a staple forty votes agree on. (It was the round's OWN prior until
#928 — see the third bullet.) Three things about how it landed:

- **`gameAffinity(game, playScale, shelf)` — `round` left the signature.** The
  scores come from `buildShelfIndex(round)`, built once per profile beside
  `buildPlayScale`, so the function walks no sessions at all. Same hoisting
  argument as §12's: the prior is a property of the shelf, not of the game being
  scored, and per-game derivation is the 19.8 ms → 364 ms mistake this file
  already records. Total session walks are unchanged, not increased.
- **`W_PLAYS` SURVIVED #894, and the measurement is why.** That issue proposed
  retiring it and letting plays reach the profile by lifting the prior instead;
  its own §0 required §12's three cases to be measured first, and they invert.
  Because the lift fades as `m/(n+m)`, a gateway game rated 3,0 by twenty people
  and played twenty times scores **1,08** while a never-rated game played ten
  times floats at **1,42** — the game they play most and have an opinion about
  ranking below one they have never rated, which is precisely the case §12
  exists to serve. The inversion is structural: restoring the order needs the
  prior to outweigh twenty real votes (`k ≥ 300`, or `SHRINK_M ≥ 250`), at which
  point every shelf score collapses onto the prior and the shrinkage stops
  discriminating at all. So the shelf DISPLAY lifts its prior by plays and this
  file does not — two mechanisms, one argument, each where it works. Those two
  figures were measured at #894's `PLAY_LIFT` of 1,0; #928 raised it to 2,0,
  which widens the inversion (1,15 against 1,83) rather than closing it, so the
  conclusion is unchanged and the argument is stronger than when it was made.
- **The prior is `PRIOR_DEFAULT` (3) since #928 — and the `UNRATED_EQUIV` floor
  that used to guard it is gone.** #894 shrank toward the round's OWN shelf, and
  that interacted with the fixed unrated rung in a way it had not anticipated: a
  thin verdict is pulled toward the prior, so a prior below what the ladder pays
  for no verdict at all made one „😐 passt schon" vote rank a game BELOW never
  having been rated — the profile saying some evidence is worth less than none.
  The floor was derived (`A_UNRATED × 2 + 1`) because the inversion starts under
  a prior of exactly 2,0.

  #928 removed the shelf-relative prior outright: it had collapsed to ≈ 0,4 on a
  real family shelf, and this file's own premise („a shelf whose prior is above
  this is untouched, which is every ordinary round") was false there — the
  recommender reasoned with 2,2 while the Regal printed 0,4, one shelf and two
  beliefs. With a constant 3 the floor is unreachable by construction, so it was
  deleted rather than left asserting a property of a mechanism that no longer
  exists. What is still guarded, and now by the constant itself, is the
  PROPERTY: `test/recommend.test.js` asserts one 😐 vote beats no vote at all.
  Since #1227 that assertion must be read against the round's **effective** rung
  (`buildShelfIndex(round).unrated`), not against `A_NEUTRAL` — the rated rung is
  now anchored AT the neutral constant, so a unanimous „passt schon" ties 0,6
  exactly and beats only the faded rung a round with history actually carries.
  Pointed at the constant, the spec would assert `0.6 > 0.6` and fail for the
  right reading of the wrong number.

## 12. Plays are a PROFILE input, not a scored term (#778)

`gameAffinity` read only state and ratings, so a **direct-pick** evening left no
trace in the taste profile at all. Those sessions are created with `votes: {}`
and born `done` (`lib/routes/sessions.js`), so no vote is ever written against
them, `ownRating` finds nothing, and the game lands on the unrated rung —
**exactly what a game that has sat unplayed on the shelf since the day it was
added scores.** A round that runs its evenings by direct pick, which is the whole
point of that mode, therefore had a flat profile: every mechanic weighted alike,
the targets the plain mean of the shelf, and the list degenerating to
"well-rated games near the middle of what you own".

Measured as the free Route-1 red: three direct-pick evenings gave a profile
component of `0.1414213562373095` against the same round with **no sessions at
all** — `0.1414213562373095`. Byte-identical.

- **A play bonus is ADDED to the ladder, never a fourth rung.** `W_PLAYS × (plays
  / the round's own most-played)`, on top of whatever state and ratings say. A
  rung would have to choose between "played" and "rated", and the two are
  independent facts about the same game.
- **The retired arm short-circuits before the bonus is read.** Twenty nights do
  not soften "we got rid of it" — the state ordering §5 describes is unchanged.
- **The ceiling moves from 2.0 to 3.0 — 2,43 since #1227's re-anchor (§15) — and
  NO weight needed re-tuning.** Nothing
  downstream reads the magnitude: `accumulate`/`normalize` are L2-normalised and
  `weightedMean` divides by its own weights, so only ratios reach a score. Check
  that property before changing any rung — it is what makes the ladder cheap to
  re-tune and is not obvious from the call sites.
- **The scale is ROUND-relative, and that does not touch §7.** The denominator is
  the round's own most-played game, so a very active shelf where everything is
  past five plays keeps discriminating, where an absolute
  (`log2`-with-saturation) scale would saturate. §7's guarantee is about **corpus
  size**; the profile has always been round-relative, exactly as `attainable` is
  profile-relative.
- **`PLAY_SCALE_FLOOR = 3` is the relative scale's one weakness answered.** Purely
  relative, a round whose entire history is one evening hands that game the
  maximum play signal available. One night is not a favourite.
- **The denominator is taken over the games that can RECEIVE the bonus** —
  walking `round.games`, skipping retired and wished. A retired game played
  twenty times and then thrown out would otherwise shrink every remaining game's
  bonus toward nothing while earning none itself. Walking the games rather than
  the counts also means a `chosenGameId` naming a **deleted** game can never be
  read. The naive `Math.max(...counts.values())` reddens exactly here.
- **The `wish` clause in that loop looks dead after #776 and is NOT.** Plays are
  history while the wish flag is current: `POST …/games/:gid/wish { wish: true }`
  moves a game the round has played for years back onto the Wunschliste. The UI
  only ever sends `wish: false`, but the route takes both directions and says so
  ("the other direction comes free"). Deleting the clause as unreachable is the
  plausible-looking mistake this bullet exists to stop.
- **`playScale` has no default, on purpose.** A caller that forgot it would
  silently get the pre-#778 scoring back — a confident, wrong list with no error
  — where an absent argument is a programming error. Same reasoning as
  `attainable`'s missing `prefix`, and the reason this file exists at all.
- **What it deliberately is NOT:** a scored term. Plays decide which owned games
  shape the *target*, never how a candidate is scored against it, so
  `W_QUALITY … W_NOVELTY_PENALTY` are untouched and §1's isolation cases stayed
  green unmodified. (#900 later removed one of them — the implementation-link
  case, which became a filter and is now asserted through `recommend()` instead;
  the count in §1 is whatever the file holds, not a fixed seven.) There is also no new reason type — a card does not
  say "you play a lot of X".
- **Do not unify the counter with the Pokale „Meistgespielt" card.** That card
  counts retired games on purpose: it is a record of nights that happened, not a
  claim about the current shelf (`.claude/rules/active-games-filter-sites.md`).
  The recommender asks the opposite question and must keep dropping them. Two
  different questions over one field, so this is not a
  `shared-constants-across-the-stack.md` case.

`W_PLAYS` and `PLAY_SCALE_FLOOR` are approved starting values with the same
status as the seven weights: changing a number is expected, changing the set of
terms is a scope change.

## 14. A tolerance change is INVISIBLE to §1's isolation specs (#975)

§1's shape is right and it cannot see a tolerance at all. Every isolation case
puts its "wrong" candidate far enough out to **saturate at 0 under any
tolerance**, so the delta stays the term's full weight however the curve is
retuned. Measured on the pre-#975 suite, against the then-current pair of fixed
constants: halving either of them — to `0.6` and to `30` minutes — left
`test/recommend.test.js` + `test/recommendations.test.js` at **70 pass / 0 fail**.
Both could have been any number.

This is §1's own fixture trap one term over, and the fix is the same in kind:
assert the **curve**, not the gap. A spec pins `scoreCandidate`'s per-term
`value` at the target, at half the tolerance (exactly `NEUTRAL`) and at the
tolerance (exactly 0) — in **literals**, never in the constant it guards, because
a test written in terms of `WEIGHT_TOLERANCE` holds at every value of it.

Half the tolerance is the number that matters, not the tolerance: `NEUTRAL` is
what an *undocumented* game scores, so a candidate past the half-way point is
worse than one BGG knows nothing about, and `> NEUTRAL` is also the reason gate.
The effective window is half the constant — ±0.3 of weight, not ±0.6.

**Time is target-RELATIVE, and that is a shape claim a fixed constant cannot
satisfy.** `TIME_TOLERANCE_SHARE = 0.5` — the tolerance is half the round's own
`targetTime`, computed at the call site so `proximity()` stays shared with
complexity. A fixed 60 made "30 minutes away" cost the same at every scale: a
15-minute-filler shelf was offered 40-minute games at above-neutral credit while
a 180-minute shelf was penalised for 150, and **narrowing the constant fixes one
only by worsening the other**. So the spec's load-bearing assertion is a *pair* —
half credit 10 minutes out on a 40-minute shelf and 30 minutes out on a
120-minute one, which no single constant can be. Verified red against a fixed 60
**and** against a fixed 20; the narrowed one passes every other assertion in that
test, which is exactly why the pair has to be there.

No division-by-zero path, and it is worth not re-deriving: `toPositiveInt()` in
`lib/providers/bgg.js` normalises BGG's "0 = no data" to `null`, so `targetTime`
is either null — which `proximity()` answers with `null` — or positive.

**And the FIGURE being compared is a midpoint, not a bound (#1141).**
`representativePlaytime(info)` collapses the corpus's `minPlaytime`/`maxPlaytime`
band to one number, and all three sites use it — the shelf target, the candidate's
`time` term, and the reason line's `minutes` — because a comparison is only
like-for-like if both sides are read the same way. It used to be `maxPlaytime` on
both sides: consistent, but consistently inflated (27 % high on the demo shelf),
and the reason line then called that upper bound „Rund {minutes} Minuten" directly
under a fact chip printing the honest range.

The non-obvious half is the exception. Past `CAMPAIGN_BAND_RATIO` (10, strictly
greater) the helper returns `minPlaytime` instead, because such a band is not a
range: `lib/providers/bgg.js` keeps both bounds precisely because "the spread is
the information … any single number describes neither", and Toriki's 20–600 is one
sitting against a whole legacy arc — whose midpoint, 310, is a length nobody has
ever played it at. So the midpoint is right for a *range* and wrong for a
*campaign*, and 10× is where one stops being the other. `30–300` is still a range
(165); `30–301` is not (30).

Two things this deliberately does not touch: the game-detail **fact chip** stays a
range, which is the one place the spread should survive; and `draw-pool.js`'s
filters keep comparing bounds to bounds, where „at most M" against `maxPlaytime`
is the honest worst case rather than a point estimate
(`.claude/rules/provider-info-is-a-field-set.md`).

And a midpoint can be a **half**, which the reason payload has to absorb:
`reasonsFrom` rounds `minutes` exactly as it already rounded `target`. A 45–70
game scores on 57,5 and the sentence says 58 — otherwise „Rund" promises a round
number and delivers a decimal separator `t()` does not localise. The *scorer*
keeps the exact figure; only the sentence rounds.

The fixture trap that comes with it: `test/recommend.test.js`'s `info()` helper
defaults to `minPlaytime: 60, maxPlaytime: 60`, so an override passing only
`maxPlaytime: 120` is a **60–120** game and scores as 90 — it does not mean what it
reads as. Every fixture now states both bounds; keep it that way.

### A reason line must name the ROUND's half of the comparison

`quality` stands alone and the two taste terms name the owned games. The other
three compared the candidate against something invisible: „Gewicht 2,8" restates
the fact row directly above the title and attaches a claim the reader cannot
judge. `reasonsFrom` now sends `target` for `complexity` and `time`.

`players` deliberately sends **no** field — the count is by construction a size
out of the round's own `partyDistribution`, so the wording carries it. Note it
keeps the „{n} Personen" phrasing #805 settled on rather than the collective
numeral („zu {n}"), which reads as an ordinal in German.

**And the time line must say GAMES, not sessions.** It said „wie eure üblichen
Sessions" in every shipped locale for the life of the feature, and **sessions record
no duration anywhere in this app**: `targetTime` is the affinity-weighted mean of
the shelf's *representative* playtime (above), a property of the boxes they own —
it was the shelf's `maxPlaytime` until #1141. A reason line
claiming a measurement the app never takes is the failure mode §10's guard exists
for, arrived at by wording rather than by a model.

**Related:** `.claude/rules/bgg-corpus.md` (the pool this scores, and its licence
conditions), `.claude/rules/break-the-code-on-purpose.md` (every assertion above
was seen red against a deliberate break), `.claude/rules/session-teams.md` §4,
`.claude/rules/shared-constants-across-the-stack.md`.

## 15. A formula survived the SCALE changing underneath it (#1227)

`gameAffinity`'s rated rung read `(score - 1) / 2` from #682 to #1227, with a
comment reading `(avg-1)/2 — 0.0 at 1, 1.0 at 3, 2.0 at 5` and a variable named
`avg`. That was exactly right while `ownRating` returned the **raw mean of 1–5
ratings**: 1 was unanimous „gar nicht" and therefore affinity 0.

**#893 changed `ownRating` to return the Spielwirbel-Score** — `TILE_VALUE`
`[-5, 1, 3, 4, 5]` — and the formula stayed. Nothing broke, nothing went red,
and the ladder still looked untouched, because `TILE_VALUE` prices „passt schon"
at 3 and the two scales agree there:

| unanimous, 20 voters | old anchor | the comment's claim | after #1227 |
|---|---|---|---|
| gar nicht | −0,50 | +0,00 | −0,50 (floor) |
| **nicht so** | **+0,17** | +0,50 | **−0,23** |
| passt schon | +1,00 | +1,00 | **+0,60** |
| gut | +1,42 | +1,50 | +1,02 |
| begeistert | +1,83 | +2,00 | +1,43 |

The zero crossing had silently moved from *unanimous „gar nicht"* to *unanimous
„nicht so"*, because `TILE_VALUE[2]` is exactly the **1 the formula subtracts**.
So a game twenty people agreed they did not enjoy still scored **+0,17** and
kept pulling the profile toward games like it. The rung is now anchored at the
neutral tile — `A_NEUTRAL + (score - PRIOR_DEFAULT) / 2`, floored at
`RATED_FLOOR` — so below `PRIOR_DEFAULT` a game pulls the profile *away* from
itself, which is what a bad verdict means.

**This is the class of bug this whole file exists for** (§0's premise): every
mistake in `lib/recommend.js` is a plausible wrong list, never an error. The
specific shape to recognise — **a formula whose constants were calibrated
against a scale that a later issue replaced** — has one tell, and it is the
tell that hid this one: *the calibration point the two scales share stays
correct*, so the ladder reads fine at exactly the value a reader spot-checks.

Two corollaries when you next touch either end:

- **A comment naming a scale is a claim about another file.** `avg` and
  `0.0 at 1` were both wrong for two months and no test could see it. When you
  change what a shared function RETURNS, grep for the callers' comments, not
  just their code (`.claude/rules/token-friendly-source-files.md` — this is the
  *value* half of that rule, not the path half).
- **`A_UNRATED` is gone; the name is `A_NEUTRAL`.** §13's third bullet still
  narrates #894's deleted `UNRATED_EQUIV` floor as derived from
  `A_UNRATED × 2 + 1` — kept as history, but the constant no longer exists.

### The unrated rung now FADES, and why a smaller constant is not the same fix

`A_UNRATED = 0.6` × the never-played part of the shelf is a **constant** block of
profile mass, while the play history only ever grows *within* the shelf. Measured
on three rounds sharing one 40-game shelf with disjoint 8-game histories: 19,2
units from 32 unplayed entries against 22,0 from the eight they actually play — a
**47 % shelf share that barely moves however long the round runs** (45 % at 160
evenings). On a **direct-pick** round it is worse and it *inverts*: the played
block froze permanently **below** the shelf at 0,56 : 0,83.

So `buildShelfIndex` hands `gameAffinity` a rung rather than a constant:
`A_NEUTRAL × (UNRATED_HALF / (UNRATED_HALF + n))` over the round's played
sessions, `UNRATED_HALF = 25`.

- **The SHAPE is the change, not the value.** A flat 0,2 reaches the same end
  state but arrives there immediately — which is exactly the young-round case the
  shelf rung exists for. At 0 sessions the rung is unchanged, so a
  collection-import round scores byte-identically to before (pinned as a literal
  list in `test/recommend.test.js`).
- **Dropping it to 0 was measured and rejected.** It survives a direct-pick round
  (plays are additive) but collapses a pure collection-import round to **no
  profile at all** — no mechanic components, no target weight.
- **Which sessions count: non-cancelled, skipping split parents** — the same two
  exclusions `partyDistribution` applies, for the same reason (#796: a twelve-
  person evening split across three tables is three played sessions, not four).
- **It counts SESSIONS, not plays.** A round that plays one game weekly for a
  year has a year of history, not one game's worth.

### The measurement in the issue that did NOT reproduce — and what replaced it

#1227 argues part 2 from a **shared-title count in a top-24** across three
rounds. The *mechanism* reproduces to the decimal (19,2 / 22,0 / 47 %). The list
figures do not: rebuilt on three independently constructed corpora, the **old**
code separated two disjoint histories just as completely as the new one, because
a cosine ranking over hundreds of graded candidates reorders entirely on any tilt
at all, however small.

That matters beyond this issue. An overlap assertion written from the issue's
table would have been **green against the very code #1227 replaces** — the
`.claude/rules/break-the-code-on-purpose.md` trap, reached by faithfully
following a spec. The spec asserts the profile's **composition** instead (the
played block's mechanic component against the shelf's), which is what the issue
actually argues from and is fixture-stable.

**Generalise it:** a top-N overlap is a *saturating* instrument — it answers
"did the ranking move at all", not "by how much" — so it cannot measure a change
of degree. Reach for the quantity the change is about.

### What is deliberately NOT changed

The play bonus is **additive** and the rungs are not floors on the total, so ten
nights can lift a game rated „gar nicht" to a **positive** affinity (measured:
+0,50, contributing +0,118 to the mechanic vector and setting `targetWeight` /
`targetTime`). That is §12's revealed-preference argument working as designed —
they keep choosing it — and it is written down here so a future session does not
read the ladder as an unconditional claim and „fix" it.

The slope (`/ 2`) is an approved starting value like the six weights, and a
steeper one is not free: at `/ 1` a unanimous „nicht so" reaches −1,07 and
inverts the `A_RETIRED` invariant. `UNRATED_HALF = 25` has the same standing — a
different half-life is a constant change, a different **curve** is a scope
change.

## 16. The spotlights re-score with ONE term altered (#1228)

Three tiles above the list, each the best candidate under one deliberate change:
`different` inverts the two taste cosines, `complexity` shifts `targetWeight`
half a step (up below 3.0, down at or above it), `hidden` restricts the pool to
rows under the **median** `usersRated` of the enriched snapshot. The variants
live in `lib/recommend-spotlights.js`; the pass that feeds them stays here.

- **`scoreCandidate` has no variant branch, and the base list is pinned
  byte-for-byte** (`test/recommend-spotlight.test.js`, a hash captured before
  any spotlight code existed). A shallow profile copy that is accidentally
  `Object.assign`ed onto the real profile reddens it — measured.
- **`different` is a transform of the base terms, not a profile** — the one
  departure from the issue's "every variant is a derived profile". A clamped,
  rescaled cosine cannot be inverted by any vector: negating the profile scores
  0 for every candidate, a flat term rather than an inverted one.
- **The complexity prune must be a CEILING, never an estimate.** The shift moves
  one term, so `base − complexity share + W_COMPLEXITY` bounds the shifted score;
  a candidate whose bound cannot reach the shortlist is skipped unscored. A
  brute-force spec re-scores every candidate and compares — dropping the
  `+ W_COMPLEXITY` reddens exactly that one test.
- **The median is corpus-relative on purpose, and only ever gates the hidden
  POOL.** It never touches a score, so §7's invariance holds for the list. It was
  NOT derived from a real dump (none is in the repo); re-measure `usersRated`'s
  real distribution before retuning it.
- **Every hard filter applies because the filters run before the pass offers
  anything.** The owned-filter spec must check *every* owned id, not a planted
  one: with the filter broken for the tiles only, the shelf's own rows win the
  hidden tile ahead of the plant, so a spec naming the plant stays green.
- **Reasons come from `reasonsFrom` minus the terms a tile must not claim** —
  `different` drops both taste terms, `complexity` drops complexity (its winner
  can sit AT the centre when quality outweighs the shift, and the line would then
  read "your average is 2.4" under "Mal was Komplexeres").
