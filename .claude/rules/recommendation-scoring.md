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

## 3. The novelty penalty needs BOTH directions of the implementation link, and they read different sets

A `boardgameimplementation` link is stored as the *names* it points at. So "the
owned row names this candidate" and "this candidate names an owned game" are two
separate lookups — against the profile's collected `implementations` and against
the owned rows' own `name`s. BGG usually records the link on both items, but not
always, so checking one side leaves the common case unpenalised: the group owns
the classic, the candidate is the reprint.

Found by a test asserting the reverse direction, against code that had only the
forward one. It is exactly the shape that could not have failed loudly.

## 4. The party-size distribution must come from the shared resolver

The round's real table sizes are the half BGG cannot know, and they are **parties,
not bodies** — six people in three pairs want a three-player game. Deriving it
here from `round.members` would silently drop guests and flatten teams, so
`lib/recommend.js` requires `sessionPartyCount` out of `public/js/session-people.js`
(the deliberate direction in
`.claude/rules/shared-constants-across-the-stack.md`). That function exists
*because* the naming path (`partyName` → `t()`) is unreachable from Node — see
`.claude/rules/session-teams.md` §4.

## 5. Two hard filters that are not optimisations

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
  stop.

  **Both counts move, and that is load-bearing** — §6's four empty states are
  picked from them. Wishes counted in `linkedGames` would send a round of ten
  wishes and two owned games to `unknownGames` ("the database does not know your
  shelf") when the true answer is `fewGames`, the one state carrying the
  BGG-import button. Verify `linkedGames` **and** `profileGames`, never just the
  list.
- **An un-enriched corpus row is dropped**, since it carries no attributes at all
  — it could be neither scored nor explained. The response still reports
  `corpusRows` over the whole corpus, which is what lets the screen tell "your
  shelf is too thin" from "this instance has no database".

## 6. The four empty states are not interchangeable

`few linked games` / `the corpus does not know your shelf` / `no corpus at all` /
`nothing left to suggest` ask the reader for opposite things, and only the first
has an action behind it (import a BGG collection). Collapsing them into one
"nothing to show" sends someone off to re-import a collection they already
imported. `test/recommend-view.test.js` asserts one per state; collapsing the
selector reddens three.

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

**Missed:** the screen needs TWO entry points. The Regal footer carrying „Könnte
euch gefallen" is `.rail-owned`, so from 1280px up it is `display: none` and the
**rail** is the only way in — and #682 shipped with the footer row alone, leaving
the feature unreachable on a desktop-width window. Reported by the operator, who
had read the news entry and then could not find it. The pass that missed it ran
at 1180px and 390px: two widths, both **below the one breakpoint that mattered**.
`test/rail-footer-parity.test.js` now pins the footer's links as a subset of the
rail's; see `.claude/rules/responsive-content-width.md`.

## 10. #264 removed a recommender, and its guard had to be re-aimed rather than deleted

`test/rounds.test.js` asserted the whole `…/recommendations` path 404s. This
feature is deliberately not that one — local corpus, weighted arithmetic, no
model, no processor, nothing that can hallucinate a title — so the read answers
now. What the guard still holds is #264's actual shape: **no POST, no DELETE, no
stored runs**. Deleting the test because "recommendations exist again" would have
lost the guard entirely; the sibling `recommendationRuns` assertion is untouched.

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
- **The empty-contributors filter runs BEFORE the slice**, or dropping that line
  costs the card a slot a qualifying term would have filled. The state is
  unreachable today — a term only clears the `> NEUTRAL` gate by matching a game
  in `profile.games`, which is the very list the contributors are drawn from — so
  it is pinned by a hand-built `reasonsFrom` call rather than through
  `recommend()`, and the ordering is what keeps it harmless if that ever changes.

**Related:** `.claude/rules/bgg-corpus.md` (the pool this scores, and its licence
conditions), `.claude/rules/break-the-code-on-purpose.md` (every assertion above
was seen red against a deliberate break), `.claude/rules/session-teams.md` §4,
`.claude/rules/shared-constants-across-the-stack.md`.
