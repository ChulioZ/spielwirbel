---
paths:
  - "lib/recommend.js"
  - "lib/corpus-cache.js"
  - "lib/routes/recommendations.js"
  - "public/js/views-recommend.js"
  - "test/recommend.test.js"
  - "test/recommend-view.test.js"
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

  **The ladder is `retired -1.0` / `rated (avg-1)/2` / `unrated 0.6` (#799), plus
  an additive play bonus of up to `1.0` on the two non-retired arms (#778, §12),
  and both ends were re-tuned away from the obvious values.** Unrated used to be
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
- **The ceiling moves from 2.0 to 3.0 and NO weight needed re-tuning.** Nothing
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

**Related:** `.claude/rules/bgg-corpus.md` (the pool this scores, and its licence
conditions), `.claude/rules/break-the-code-on-purpose.md` (every assertion above
was seen red against a deliberate break), `.claude/rules/session-teams.md` §4,
`.claude/rules/shared-constants-across-the-stack.md`.
