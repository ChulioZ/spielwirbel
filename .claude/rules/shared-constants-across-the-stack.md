# A constant the client offers and the server validates must be ONE file

<!-- scope: global — fires whenever a value crosses the client/server boundary, from either side -->

The member avatar palette lived twice: `MEMBER_COLORS` in `public/js/core.js`
(what the swatches render) and a hand-copied array in `lib/routes/members.js` (what
`PATCH …/members/:mid` validates), with a comment on the copy saying "keep in
sync". #145 darkened six of the eight hexes for WCAG AA and updated only the
frontend. Result (#420): **six of the eight colours the UI offered were rejected
with `400 Invalid color`** — for months, in production. The two lists intersected
in exactly the two colours #145 didn't need to touch.

## The rule

When the client **offers** a fixed set of values and the server **validates**
against it, they get one source of truth: a small, dependency-free file under
`public/js/` with the `module.exports` guard, loaded as a shared-scope script by
`index.html` **and** `require`d by the route.

```js
// lib/routes/members.js
const { MEMBER_COLORS } = require('../public/js/member-colors');
```

A backend file requiring out of `public/js/` looks wrong at first glance — it is
the deliberate shape here, and the alternative ("duplicate + a parity test") was
rejected: a parity test still needs someone to remember the second copy exists,
and it is the copy nobody remembers that rots.

**The second instance is `public/js/locales.js`** (#504): the shipped UI locales,
offered by the language picker and validated by `lib/routes/contact.js` for the
feedback-metadata `locale`. It replaced a hand-copied `['de', 'en']` in that
route — which had the palette bug's exact failure mode waiting, one locale
further on: feedback sent from any language nobody remembered to add there loses
the very field needed to route a "this wording is wrong" report. See
`.claude/rules/locale-set-is-data.md` for why a test over that list is *vacuous*
until you register a synthetic locale. Wire the new file into all four
places `.claude/rules/frontend-helper-modules-and-coverage.md` lists (script tag,
`SHELL`, `CACHE` bump, eslint globals — the last is a no-op if the name is
already listed).

**The third is `public/js/session-people.js`** (#458, #575): `MAX_SESSION_GUESTS`,
`GUEST_NAME_MAX` and `MIN_TEAM_SIZE`, offered by the guest and team pickers and
required by `lib/routes/sessions.js`. It is the sharpest case of the three, because the server is
deliberately **lenient** — it truncates an over-long guest list and an over-long
name instead of 400ing — so a drifted client copy would silently drop guests and
clip names with **no error anywhere**, i.e. the palette bug's failure mode minus
even the eventual 400 that exposed it. See
`.claude/rules/session-guests-are-not-members.md`.

**The fourth is `public/js/session-log.js`** (#209): `SESSION_EVENTS`, the session
activity log's event types mapped to the i18n keys that phrase them, written by
`lib/session-events.js` and rendered by the lobby and the results screen. It
inverts the direction of the three above — here the **server writes** the value
and the **client renders** it — and that inversion is what makes it belong here
rather than being left as two lists: an event type the client has no phrase for
renders as **nothing at all**, so the session log would quietly lose entries with
no error, no 400, and a screen that still looks finished. The write end drops an
unknown type for the same reason `trackEvent` does
(`.claude/rules/product-event-logging.md`).

**The fifth is `public/js/username-policy.js`**: what a username may be — the
charset/length pattern **and** the handles reserved as impersonations of an
official account — offered by the register form and enforced by
`lib/routes/account.js`. The shape half is the ordinary case (the bounds had been
hand-copied into six places, down to the input's `maxlength` and the two messages
that state them in prose, which is why the prose now takes `{min}`/`{max}`
params). The reserved half has a trap one layer *down* from drift: the list is
matched against a **normalised** handle (lower-case, `_`, `-` and digits
stripped), so an entry that is not itself in that form (`no-reply`, `Admin`, a
two-letter word) can never match and silently protects nothing while making the
list look longer than it is. `test/username-policy.test.js` asserts the shape of
every entry for that reason, and loops the *whole* set through the route rather
than a sample.

**The sixth is `public/js/draw-pool.js`** (#634, extended by #653):
`isActiveGame` and `fitsPlayerCount`, the two predicates deciding which games a
session draw may pick from — applied by `lib/draw.js` to build the real pool and
by `showStartSession()` to render the live preview of that pool. It is the first
instance that shares **logic rather than a value**, and it earns the shape for the
same reason the others do: the two sides answer one question, so a drifted copy
makes the preview promise a pool the draw will not produce (or hide games it
would) with no error anywhere — and the preview is precisely where the user
decides whether to draw at all. Note what deliberately stayed duplicated: the
**tag** clauses, because the server filters on resolved include/exclude id lists
while the client holds a tri-state chip map, so one shared function would need a
third representation invented for it. Sharing the clauses that are genuinely
identical is the rule; forcing the ones that are not is how a shared file grows a
parameter nobody can explain.

**#725 added a third clause to it — `fitsMetadataFilters`, plus the three
ladders `PLAYTIME_CHOICES` / `AGE_CHOICES` / `WEIGHT_CHOICES`** — and it is both
halves of this rule at once. The predicate is the logic half again (the setup
screen's preview and the Regal must narrow the shelf exactly as the draw does);
the ladders are the plain value half, because the route validates a step by
**membership in the list the UI offers** rather than by a range, so the two sides
cannot even disagree about granularity. Note the neighbouring
`metadataFilterOptions` / `normalizeMetadataFilters` are shared for a *different*
reason — they are the frontend's own two screens agreeing with each other — and
the DOM that renders the controls deliberately did **not** join this file (see
`.claude/rules/provider-metadata-is-a-filter-not-a-tag.md` §4).

It gained two more exports with owned expansions (#653), each for a different
half of this rule. **`requiredExpansions`** is the logic half again: the results
screen's „Braucht Erweiterung: …" line has to name the same set that made the
game drawable, so it is derived from the very predicate the pool used rather than
from a second "which ones are bigger" rule. **`EXPANSION_TITLE_MAX`** is the
plain value half — the free-text input's `maxlength` and the route's zod
`.max()`, i.e. the original palette shape. It sits here rather than in
`lib/quota.js` because the client *offers* it; the per-game **cap** is a quota,
which the client never states and only ever learns about from a 403.
See `.claude/rules/expansions-widen-by-union.md`.

**The seventh is `public/js/news.js`** (#741): `NEWS`, the „Was ist neu" entry
list, plus `newsRevision()`. It is the **fourth** direction this rule runs in —
neither side *offers* or *validates* a value; both read the same list and have to
agree on what its newest revision is. The client renders the entries and lights a
dot when the account's stamp is behind; `lib/routes/account.js` writes that stamp
from its own `newsRevision()` at registration and on `POST …/news-seen`, so a
client cannot claim to have seen an entry that does not exist. A drifted copy
would not 400 and would not blank a screen — it would stamp accounts as caught up
on a revision the list never held, permanently suppressing the dot for the entry
that mattered, with no error and a screen that still looks finished. The entry
text is deliberately **not** i18n keys but inline `de`/`en` objects, so adding an
entry stays one edit and `test/i18n-parity.test.js` never has to care.

**The eighth is `public/js/round-roles.js`** (#137): the owner/co-owner/editor
ladder, the capability each guarded action costs, and the `can`/`roundCan`
predicate — offered by the invite sheet's role picker and by every view that
hides an action, enforced by `lib/round-access.js` and the rounds/members routes.
It is the **logic** half of this rule, like `draw-pool.js`, and it is the sharpest
case for the shape because a drift is invisible in *both* directions: a client
copy that grants too much offers a button that 403s, and one that grants too
little hides a control the user is entitled to — with no error either way, and the
second variant indistinguishable from the feature simply not existing. Note what
deliberately did **not** join it: the route-to-capability **table**
(`ROUTE_ROLES`), because the client speaks in capabilities and never in paths, so
sharing it would export a list with no reader.

Its one trap is `roundCan`'s owner branch. A round payload carries `shared`/`role`
only for a grantee, so `can(round.role, …)` reads an owner's absent key as the
lowest role and hides every guarded action from the person who owns the round —
which is why the owner case is spelled out rather than left to `normalizeRole`'s
fallback. That fallback is itself deliberate in the other direction: an unknown
role loses power rather than gaining it.

**The ninth is `public/js/vote-scale.js`** (#797): `effectiveRating`/`wantsRetire`
— what one vote on a game is worth, now that the retirement proposal is the
**zero** of the 0–5 scale rather than a separate flag beside it. Logic, like
`draw-pool.js`, and it earns the shape because *nothing* is validated across the
boundary: the client renders every average (Regal pills, the detail ring, session
results, Pokale) and the server computes `groupRating` and the cross-tenant
corpus aggregate from **the same stored votes**, so a drifted copy makes two
screens state a different Ø for one game with no error, no 400 and no blank —
just a number that is quietly wrong wherever nobody is comparing. It carries the
precedence rule as well as the arithmetic: storage was **not** migrated, so a
pre-#797 row can hold `{ rating: 4, retire: true }`, and "retirement wins" has to
be answered identically in all eight places or a legacy round's history changes
depending on which screen is asked.

Its trap is the tenth site, which **cannot** require the file: the cross-tenant
aggregate `publicGameAggregates` in `lib/repo/postgres.js` is SQL. Both halves of
the rule are restated there by hand — it must admit a retire-only vote (the
pre-#797 clause `jsonb_typeof(…'rating') = 'number'` silently dropped it) and it
must let retirement win. #914 collapsed what had been a separate `WHERE` and
`CASE` into **one lateral `tile` expression**, so the admission test and the
resolved value are by construction the same decision instead of two spellings of
it that could drift apart. Note the comparison is `vote.val->'retire' = 'true'::jsonb`, not
`->>'retire' = 'true'`: the text form also matches the **string** `"true"`, which
`effectiveRating`'s `=== true` rejects — and the legacy `/results` route stores a
member's column unvalidated, so that is a shape the JSON backend really can hold.
`effectiveRating` uses `Number.isFinite` rather than `Number.isInteger` for the
same reason: it is the exact JS equivalent of `jsonb_typeof(…) = 'number'`, so
the two backends admit precisely the same values by construction.
`test/support/repo-contract.js` pins them against one fixture carrying both
legacy shapes.

Note `public/js/recap.js` reaches it by **injection**, not `require`: it is a
public/js file the test suite requires into Node, where the shared scope does not
exist, and `require` is deliberately not a frontend global. Its header already
established that shape for `sessionPeople`; `effectiveRating` is the second
parameter of the same kind.

**The tenth is `public/js/table-split.js`** (#796): the multi-table objective —
what one seating is worth, which table counts are feasible, and the seeded search
over them — plus `fitsSomeTable`, the relaxed pool predicate that mode draws with.
Logic, like `draw-pool.js`, and it runs in the **third** direction again: the
server computes the proposals once and persists them, while the builder screen
rescores every table live as people are dragged between them. So nothing is
validated across the boundary and nothing 400s — a drifted copy simply makes the
screen disagree with the recommendation it is showing, telling a group that a
table they just edited is worse (or better) than the one the server proposed, with
no error anywhere. The threshold `VIOLATION_MAX` is the sharpest single value in
it, and it is **coupled to the vote scale**: it is the bottom two of the 0-5 scale
whose zero is the retirement proposal (#797), so changing the scale moves it in
the same change.

`fitsSomeTable` lives here rather than beside `fitsPlayerCount` for a reason that
is structural rather than editorial: these are classic scripts over one global
lexical scope, so two files cannot both declare `MIN_TABLE_PARTIES`, and every
other user of that constant is in this file. `draw-pool.js` carries a pointer
comment to it so a `grep` for the pool predicates lands on both.

**The eleventh is `public/js/session-outcome.js`** (#796): `sessionOutcome`, what
became of a session — `open`, `played`, `cancelled` or `split`. It is the
`session-log.js` direction (the server writes, the client renders) with the
validation removed entirely: sixteen sites branched on `session.cancelled` to mean
"this evening did not happen at one table", and a parent split across several
tables is neither played nor cancelled, so **every one of those sites failed
silently** — the Chronik drew it with the played icon, the hub offered to resume
it, the share text described an evening nobody played, and the recommender learned
that this round routinely plays twelve-handed. Nothing throws at any of them.

`split` is derived from the presence of child session ids rather than stored as a
third boolean, so a flag can never disagree with the links the same screens render
— the `sessionOutcome`-not-`s.cancelled` discipline is the whole rule, and it is
the shape `.claude/rules/active-games-filter-sites.md` exists for one entity over.

**The twelfth is `public/js/avatar-policy.js`** (#841): what an account profile
picture may be — the upload byte cap, the stored square, and the accepted types.
The plain value half of this rule, like `EXPANSION_TITLE_MAX`: the Konto picker
*offers* them (the file input's `accept`, the pre-flight size check, and the
error line that states the limit in prose) and the server *validates* against
them (`lib/upload.js`'s avatar multer instance, `lib/avatar.js`'s pixel ceiling).

Its trap is that the two sides fail in **opposite directions**, so neither drift
looks like the other. A client cap larger than the server's produces the palette
bug exactly — the picker accepts a file the route then 413s. A client cap
*smaller* than the server's produces no error at all: the picker simply refuses
a picture the server would have taken, and the user reads it as their photo being
too big. The prose message takes `{mb}` derived from the shared constant for that
reason — a hand-written "at most 5 MB" is a third copy, and it is the one that
states a number nobody re-checks.

Note what deliberately did **not** join it: `AVATAR_SIZE` is *used* by the server
only. It lives here because it is the same decision as the cap — what we store —
and splitting one policy across two files to keep this one purely bidirectional
would be tidiness at the cost of the thing being findable.

**The thirteenth is `public/js/cover-policy.js`** (#867): what an uploaded game
cover may be — the upload byte cap, the ceiling on the stored long edge, and the
output format. The plain value half of this rule and the direct sibling of
`avatar-policy.js`: the two paste sites *offer* the cap (the pre-flight check on
the blob and the message that states the limit) and `lib/upload.js` /
`lib/cover.js` *validate* against it.

Its trap is that the two constants fail in **different directions**, so neither
drift resembles the other. `COVER_MAX_BYTES` is the avatar case exactly — a
client cap above the server's produces the palette bug (the zone accepts a paste
the route then 413s), one below it silently refuses a cover the server would
have taken. `COVER_MAX_DIM` is not offered to anyone: it is shared because
`lib/cover.js` writes it and the admin backfill's `coverIsCurrent` decides
against it, and if those two ever disagreed the backfill would either re-encode
every object on every press (a lossy generation each time, reclaiming nothing) or
skip the ones it exists to convert. The message takes `{mb}` from the derived
`COVER_MAX_MB` for the reason `avatar-policy.js` gives: a hand-written "at most
5 MB" is the third copy, and it is the one that states a number nobody
re-checks.

Note what deliberately stayed **out**: `.claude/rules/cover-image-storage-backend.md`'s
`/uploads/<key>` path shape, and `cover-size.js`'s `COVER_THUMB`/`CARD`/`HERO`
render widths. The latter look like they belong — they are about cover sizing and
they bound `COVER_MAX_DIM`'s justification — but nothing validates them across the
boundary: they are the frontend's own render-time choice, and the server has no
opinion about them at all.

**The fourteenth is `public/js/vote-score.js`** (#893): the Spielwirbel-Score —
what a SET of votes on a game is worth, once a veto counts for more than its
numeric distance. Logic, like `draw-pool.js` and its direct sibling
`vote-scale.js`, and it runs in the same direction as `vote-scale.js` for the
same reason: nothing is validated across the boundary. The client renders every
score (Regal pills, the detail ring, session results, Pokale) and the server
weighs the same votes in `lib/recommend.js`'s taste profile and in
`lib/session-split.js`'s table proposals, so a drifted copy makes two screens
state a different number for one game with no error, no 400 and no blank.

Its trap is that the curve has **two consumers with different arithmetic**, and
only one of them is obvious. `scoreRatings` is the mean of `tileValue` over a
game's votes; `tableFeedback` in `table-split.js` sums `tileValue` over a
table's seats. Those must move together — the whole point of #893 was that the
single-table results screen and the multi-table objective had been applying
*different* value judgements to the same evening — so `table-split.js` takes
`tileValue` as an **injected** parameter with no default, exactly as it takes
`effectiveRating`. A default would hand back a plausible, confident,
differently-scored split with no error anywhere, which is this rule's failure
mode expressed as a seating chart.

**#914 gave it a second input shape, `scoreTally`, and the reason is the trap
above seen from the other side.** The Discover podium (`lib/public-stats.js`)
ranks cross-tenant games on this score, and the aggregate feeding it is that same
SQL. Summing `TILE_VALUE` there would have hand-restated all six numbers in the
one place that can never require them — and this file's own header says those
numbers are *expected to be retuned*, so the copy would silently freeze the
public podium on the old curve while every other screen moved. It is the palette
bug with the blast radius pointed at the logged-out landing page.

So the aggregate reports a **per-tile histogram** — `count(*) FILTER` per tile,
which is pure *scale* and carries no curve at all — and `scoreTally` applies the
curve in JS. `scoreRatings` is now expressed through it, so the two shapes cannot
disagree. The generalisable move: when a boundary cannot take the shared
function, push the boundary **down** to something the function still owns, rather
than copying the function across it. `test/public-stats.test.js` proves the
ownership the only way that survives a retune — it changes `TILE_VALUE` in place
and asserts the published score follows, where a spec pinning a literal would
pass just as well against a SQL copy.

**#894 added a second half to the same file — the SHELF scope — and with it
`playCounts`, which is the plainest instance in this whole inventory.** That
function counts how often each game was put on the table; it was written in
`lib/recommend.js` (#778) and now lives here because the Regal's shelf score
lifts a game's prior by its plays and the recommender's `W_PLAYS` bonus divides
by the round's most-played. Nothing validates that across the boundary and
neither side 400s, so a drifted copy would simply make the shelf and the
recommender disagree about how often a game was played — a number one of them
prints. `lib/recommend.js` re-exports it so every existing caller and spec is
untouched.

The shrinkage half (`SHRINK_M`, `PRIOR_DEFAULT`, `PLAY_LIFT`, `PLAY_HALF`,
`playCredit`, `gamePrior`, `shrinkScore`, `shelfScore`) is the `draw-pool.js`
direction — shared logic — and it reaches **six** consumers, which is why it had
to be one file rather than a rule people remember: `core.js`'s
`roundScoreIndex` (the Regal pill and sort, the detail ring, the retirement
banner), `recap.js` via an injected lookup (the Pokale best/worst card),
`period-recap.js` via two more injected functions (the Chronik's per-period
card), `lib/recommend.js`'s `buildShelfIndex`, and — since #928 —
`lib/public-stats.js`'s `bestRated` podium. The Chronik case is the one
worth knowing: #914 had *just* finished making its „Bestbewertet" card and the
all-time card share one arithmetic, and shrinking only the all-time one split
them again within the same release — caught by
`test/chronik-period-recap.test.js`, which compares the two rendered numbers
rather than trusting either.

**#928 removed the shelf-relative prior entirely, and the shape of the fix is
this rule's own argument taken one step further.** `roundPrior` and
`PRIOR_MIN_GAMES` are gone, and `shelfScore`/`gamePrior` no longer take a prior
at all: it is the constant `PRIOR_DEFAULT`, lifted only by that game's own
plays. Sharing a *function* while each caller supplied its own prior — which
this paragraph used to defend — still let two surfaces print one label
(„Spielwirbel-Score", on the same 0–5 ring) for two different quantities, and
they did: the Regal shrank toward its own shelf while `/entdecken` applied the
raw curve with no prior at all. Removing the parameter makes "which prior did
this screen use" **unrepresentable**, which is strictly stronger than sharing
the function. `test/vote-score.test.js` asserts the ARITY for that reason —
an equality between two rounds is satisfied by a shelf-relative implementation
handed two similar shelves, where `shelfScore.length === 3` fails the moment a
prior parameter comes back.

The one remaining caller-supplied prior is `shrinkScore`, which is the
arithmetic rather than the policy: `lib/recommend.js` legitimately shrinks
toward `PRIOR_DEFAULT` with **no** play lift, because the play signal already
reaches its profile through `W_PLAYS` and applying both would count it twice
(stated in `gameAffinity`'s comment with the measurement behind it, #894 §0).
Its own `UNRATED_EQUIV` floor went with #928: it existed only to stop a
collapsed shelf prior from ranking one „😐" vote below no vote at all, and a
constant 3 is above that break-even by construction.

The Discover podium is the sharpest instance in this file of the trap named
under `vote-score.js`'s curve half, one layer over: `lib/public-stats.js` can
`require()` the shared module, but the Postgres aggregate feeding it cannot —
so the play lift needed an **all-time** play count the aggregate did not carry
(`plays.d7/d30/d365` only). Rather than restate the lift in SQL, the aggregate
grew a `plays.all` column in both backends and the lift stays in JS. Same move
as `scoreTally`'s histogram: when a boundary cannot take the shared function,
push the boundary **down** to something the function still owns.

Two neighbouring values deliberately did **not** join it. `VIOLATION_MAX` stays
in `table-split.js`: it is a threshold on the *tile* scale, not on the score, and
it is already coupled to the vote scale there. And `LOW_SCORE` in
`retireRecommendations` (core.js) stays in core.js — the client never states it
and the server has no opinion about it, so it is a render-time choice like
`cover-size.js`'s widths rather than a shared contract.

Each new instance must be named in this inventory — the fourteen paragraphs above.
`test/rule-enumerations.test.js` asserts every `require('../public/js/…')` under
`lib/routes/` and `lib/` appears in it, because the list had already gone stale by one
before anyone noticed. The check reads only the inventory section, so mentioning a
module further down this file does not satisfy it.

## Why no test caught it, and what a real one looks like

Both of the obvious guards were present and both were blind:

- `test/members.test.js` pinned `const A_VALID_COLOR = '#7f77dd'` — an
  **old-palette literal**. The happy path exercised a colour the UI had stopped
  offering and passed forever. A test constant hand-copied from the thing under
  test proves nothing; **require the real source** (`MEMBER_COLORS[0]`).
- `test/a11y-contrast.test.js` parsed the array out of `core.js` only, so the
  server copy was never in its field of view at all.

So the regression test asserts **every** entry round-trips, not one:

```js
for (const color of MEMBER_COLORS) { /* PATCH, expect 200 + stored */ }
```

Verified by reinstating the pre-#145 array on purpose: with the palettes drifted
the loop fails loudly (3 red), and a single-colour test still passes green. Do
that check when you write one of these — a loop over a list you imported from the
implementation can be vacuously true if you import the wrong list.

## The symptom to recognise

Client-side validation passes (the UI only ever offers palette values), the
request goes out, the server 400s, and the app surfaces a generic failure. Nothing
throws server-side, no test is red, and the feature looks *implemented* — it just
silently doesn't work for most inputs. Any "keep in sync with X" comment across
the client/server boundary is this bug waiting to happen; grep for that phrasing
before trusting it.

## The one duplicate that is fine — and why

`TAG_ICONS` is still mirrored in `lib/tag-icons.js` and `public/js/tag-icons.js`.
That one is safe because `test/tag-icons.test.js` asserts the two lists are
**identical**, so a one-sided edit goes red immediately — which is exactly the
guard the colour palette never had. Don't read it as precedent for a fresh
duplicate: the require-the-shared-file shape is cheaper than a parity test and
cannot drift at all. (Its frontend comment says the scripts "can't `require()`
it" — true of the browser, but the *route* can require the frontend file, which
is the direction this rule uses.)

## The second one: when sharing the file is not available at all (#391, #595)

`public/kontakt.html` declares its own `:root` copy of the app's design tokens
(`--brand`, `--page-bg`, `--ink`, the two font stacks …). This is **not** a
violation of the rule above, because the cheap fix does not exist here: the page
is a standalone document outside the SPA, and the only way to "import" the real
tokens is `<link href="/styles.css">`, which drags the entire 2400-line SPA
stylesheet — including its own `body`, `.card` and `.input` rules — onto a page
that has no round context and must render for a logged-out visitor. There is no
smaller unit to share; `:root` in `styles.css` is also where a **per-round theme**
gets written, which this page must never inherit.

So it takes the TAG_ICONS shape deliberately: a copy plus
`test/standalone-page-brand.test.js`, which walks every custom property the page
declares and asserts `styles.css` still declares the same value. Retune `--brand`
in one file and it goes red naming both values. **The test is the licence for the
copy** — if you add another token to the page, it is covered automatically; if you
ever make the page stop declaring them, delete the test with it.

**`public/login.html` joined it in #595**, which is why the test is parameterized
over a `PAGES` list rather than named after one page: covering a third standalone
document is one array entry, not a near-identical second file.

**`lib/faq.js` joined it in #489 — not an `.html` file at all**, but a
server-rendered page whose `<style>` lives in a template literal. The assertions
transfer because they read the file as text; the constraint that adds is that its
CSS must stay **inline in the template**, never hoisted into a `const`, or the
third assertion scans `${STYLE}` and passes vacuously. See
`.claude/rules/instance-specific-claims-must-be-server-rendered.md`.

Two properties of the `PAGES` generalization are load-bearing and each fails
silently:

- **The anti-vacuous floor is asserted PER PAGE** (`page.size >= 10`), never over
  the union — otherwise one well-populated page satisfies it for a page that
  declares nothing at all, and the copy it is meant to license goes unchecked.
- **A third assertion sweeps the page's own rules for a palette hex** outside the
  `:root` copy. Parity alone cannot see the failure that actually happened here:
  `login.html` declared a full blue-violet palette *and no tokens*, so there was
  nothing to compare and the page sat four releases past the #147 rebrand looking
  like a different product. `#fff`/`#000` stay allowed — the app's own rules use
  those two inline.

Use this as precedent only under the same condition: *sharing is structurally
impossible*, not merely inconvenient. A copy that could have been a `require()`
is still the palette bug.

**Related:** `.claude/rules/frontend-helper-modules-and-coverage.md` (why the
shared constant gets its own small file rather than an export from `core.js` —
that one is a hard `coverage:ci` constraint).
