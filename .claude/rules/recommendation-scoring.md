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

**Related:** `.claude/rules/bgg-corpus.md` (the pool this scores, and its licence
conditions), `.claude/rules/break-the-code-on-purpose.md` (every assertion above
was seen red against a deliberate break), `.claude/rules/session-teams.md` §4,
`.claude/rules/shared-constants-across-the-stack.md`.
