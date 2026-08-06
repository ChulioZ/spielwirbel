---
paths:
  - "lib/providers/bgg.js"
  - "lib/routes/lookup.js"
  - "lib/repo/**"
  - "public/js/views-round-lookup.js"
  - "public/js/wish-expansion.js"
  - "test/bgg-import.test.js"
  - "test/bgg-import-picker.test.js"
---
# The BGG collection import (#481): four traps, three of them silent

`GET /api/rounds/:rid/lookup/collection` + `POST …/lookup/import` pull a user's
owned BoardGameGeek shelf into a round. The provider hop reuses `fetchXml` and
`parseItems`, which makes it look like a third copy of search/detail. It is not,
and each difference below fails quietly.

## 1. A collection item is shaped UNLIKE a search or thing item

Same endpoint family, different document:

| | `/search`, `/thing` | `/collection` |
|---|---|---|
| the name | `<name value="CATAN"/>` — an **attribute** | `<name sortindex="1">CATAN</name>` — a **text node** |
| player counts | `<minplayers value="3"/>` children | attributes of the `<stats>` child (`stats=1` only) |
| the id | `id` attribute | **`objectid`** attribute |

Reuse `parseItems` by all means — it already yields both attrs and text — but a
parser written by copying `parseThing` reads `attrs.value`, finds nothing, and
returns **zero games with no error at all**. `parseCollection` reads the text and
falls back to the attribute, so a future shape change on BGG's side degrades to a
missing field rather than to an empty import.

## 2. An unknown username is an HTTP **200** error document

BGG answers a username it does not know with

```xml
<errors><error><message>Invalid username specified</message></error></errors>
```

served as `200`. It therefore parses to zero items and is **indistinguishable
from a real collection with nothing marked as owned** — and those two need
opposite messages ("check the name" vs "mark some games as Own"). Hence the
explicit `ERROR_DOC_RE` probe, applied **only when nothing parsed**, so a future
advisory `<error>` block alongside real items cannot discard a whole import.

It is safe against a game called *Error 404: The Game*: every title arrives
inside a text node or an attribute, where a literal `<` is entity-encoded.

## 3. A `queued` answer must NEVER be cached — this is the one that bites

`/collection` answers **`202` "queued, come back"** while BGG builds the export.
`fetchXml`'s `RETRY_STATUS` already contains 202, so it retries within the shared
8 s budget and then throws; `collection()` turns that final 202 into its own
`queued` state rather than an outage. **Do not widen `TIMEOUT_MS` to sit the
queue out** — that budget is shared with every search, and the queue is unbounded.

The trap is what happens next. The listing goes through the route's 10-minute
`cached()` helper, and putting a `queued` answer in it makes the user-facing
message *"BoardGameGeek is still building it, try again shortly"* **a lie for the
next ten minutes**: the retry the message asks for is served from the cache
instead of asking BGG whether it had finished. So `fetchCollection` deliberately
does **not** use `cached()` — it stores only a settled `state === 'ok'`.

Found by a test, not by review: the five-states spec went red because states 2–5
were all answered from state 2's cache entry.

## 4. The cache key is the BGG HANDLE **plus the shelf**, so tests must not share one

The handle is in the key on purpose — the collection belongs to that BGG user,
not to our account, so two of our accounts linking the same handle correctly
share one fetch. The consequence for the suite is that **every spec needs its own
handle**: reuse one and the first spec's stubbed body answers the next one, which
presents as "my `global.fetch` stub is being ignored". Three specs in
`test/bgg-import.test.js` failed exactly that way before each got its own.

**#560 added the `status` component, and it is load-bearing.** One handle now has
two shelves — `own=1` (the Regal import) and `wishlist=1` (the Wunschliste one) —
which are *different BGG documents*. Keyed on the handle alone, whichever ran
first answers the other for the remaining ten minutes: a full, plausible,
completely wrong list, indistinguishable from the user having an odd collection.
So the key is `bgg:collection:<status>:<handle>`, a spec needs its own handle
**and** the right status, and `collection(username, status)` takes the shelf.

The status is an **allowlist lookup, never interpolated** (`COLLECTION_STATUS`, a
`Map` so `__proto__` reaches nothing): it lands in a fetched URL's query string,
i.e. the `resolveLocale` shape in
`.claude/rules/storefront-lookup-locale.md` §1.

Two things about the wishlist import that are easy to get backwards: it is
**silent** (no `games_imported`, no `trackEvent`, no feed event — the group has
acquired nothing; see `.claude/rules/active-games-filter-sites.md`), and its
`present` set is deliberately **not** filtered by game state, so a game already
on the shelf shows as present here too — which is what stops the import re-adding
a game the group has since bought.

## The bulk write is a repo method, not a loop — and the dedupe lives in it

`repo.createGames` exists because `POST /api/rounds/:rid/games` emits, **per
game**, a `game_added` activity, a `trackEvent` and an `emitFeedEvent` to the
user's whole Freundeskreis (#325). A 200-game import through that route would
bury every other event on the round and flood every friend's feed. So the bulk
method writes **one** `games_imported` activity carrying a *count* (the shape
`games_moved_out`/`_in` already established), and the route fires one event and
one feed event.

Two placement decisions are load-bearing:

- **The already-present check is in the repo, inside the transaction**, not in
  the route — so it is atomic with the insert and two concurrent imports of the
  same collection cannot both find a game missing and both create it. Candidates
  are compared against the shelf **as it grows**, so a candidate list that itself
  repeats an id cannot slip two copies past the check.
- **The quota is checked once against the resulting total, before any write**, and
  refuses the import **whole** (`'quota_games'`). A bulk add has no undo, so a
  half-imported shelf is the one outcome that must be impossible — the same
  reasoning `moveGames` uses (`.claude/rules/reparenting-rows-between-rounds.md`).

Already-present candidates do **not** count toward the total, so re-running a
collection that fits stays possible at the cap.

## The one client-supplied field (#519)

The import screen now offers a **per-game edition cover**, so `covers:
{ <externalId>: url }` rides in alongside `externalIds` — the single exception to
"never titles or cover URLs" above. It is gated by `providerCoverUrl`, i.e.
exactly the host allowlist a single `POST /games` already applies to its
`imageUrl`, and a refused URL falls back to the collection's own cover. Titles and
player ranges are still re-resolved server-side. See
`.claude/rules/bgg-edition-covers.md`, including why the picker has to be a
sibling of the `<label>` row rather than a child of it.

## The handle comes from the ACCOUNT, never from the request

`resolveCollection` reads `bggUsername` off `req.userId`'s account. Taking it from
a query parameter or the body would turn the route into an **arbitrary-BGG-user
collection scraper running under our application token** — a licensing problem as
much as a privacy one. The import likewise re-resolves each selected id against
the fetched collection server-side, so a hand-rolled request cannot write an
invented title or an arbitrary image URL into a Regal.

Storing the handle is a new category of personal data: policy §5, `vvt.md` row 15
and the `REVISION` bump shipped in the same PR
(`.claude/rules/keep-legal-docs-current.md`). It adds **no** new processor or
recipient — BGG is already both, and the fetch is server-side, so the visitor's
browser contacts nothing new.

## Smaller things

- **The two shelves differ on expansions, and the split is the whole point
  (#664).** `excludesubtype=boardgameexpansion` is applied to `own` **only**:

  - **OWNED stays excluded.** A bulk shelf import is the one place where 50
    expansions of one game are noise rather than choice, and an expansion is
    recorded *on the game it belongs to* — so importing them as shelf entries
    would create that noise **and** the wrong kind of row. Unchanged by #653
    rather than grandfathered.
  - **WISHLIST includes them**, because there an expansion is exactly what the
    group means to record ("we own Catan, we want Seefahrer"). Excluding them
    silently dropped a large share of every wishlist import — half a list with no
    indication anything was left out.

  A wished expansion is a **game row with `wish: true` plus `expansionOf`**, the
  base games BGG names for it. `expansionOf`'s *presence* is what marks a row as
  an expansion, so it must stay **absent** on an ordinary game (absent-key
  parity) and may legitimately be **`[]`** — see the orphan case below.

  **#664 therefore partially reverses the 2026-08-05 operator decision** recorded
  here, which declined nesting imported expansions under their base game. Two of
  its three blockers are weaker on a wishlist: a wishlist is small, so "50
  expansions is noise" does not apply, and the atomicity worry disappears because
  a wished expansion needs no parent row while it is still a wish. The third
  (multi-parent) is handled by asking. **It does not reverse the owned half**, and
  that asymmetry is deliberate rather than drift.

- **The parents need a SECOND hop, and it degrades rather than failing.** A
  collection item's children are `name`, `yearpublished`, `image`, `thumbnail`,
  `stats`, `status`, `numplays` and **no `<link>` elements at all**;
  `/collection` has no links parameter. So the body says *that* an item is an
  expansion (`subtype`, which `parseCollection` reads into `expansion`) and never
  *which base game it expands*. `expansionParents(ids)` fills that in from
  `/thing?id=…`, reading the `inbound="true"` boardgameexpansion links — the exact
  inverse of what `parseExpansionLinks` filters out.

  Three things about it fail quietly if changed:

  - **Its cache key is the exact ID SET** (`bgg:expparents:<sorted ids>`), not the
    handle. Keyed on the handle, a wishlist that changed between two fetches would
    be answered from the previous set's entry — the §4 trap one level in.
  - **Every failure degrades to "no parents known"**, never to an error. The
    collection itself already arrived, and an expansion with no parent is a
    perfectly good unattached wish; failing the whole listing because the optional
    hop stumbled is a strictly worse answer.
  - **An orphan is kept, not dropped.** BGG does not always report an inbound
    link, so `expansionOf: []` is a real state the UI must show — it is the one
    where "Ins Regal" stops and asks the user to file the expansion by hand.

- **The `present` set must include ACQUIRED expansions**, which do not live in
  `round.games` at all but on a base game's `expansions`. Without that arm the
  wishlist import offers an expansion the group already owns on every re-run and
  re-adds it as a fresh wish — the game-state-unfiltered reasoning above, one
  level down. See `.claude/rules/expansions-widen-by-union.md` for the acquire
  itself.
- **Games already on the shelf are still SHOWN — never dropped — but out of the
  actionable list** (#625 changed the *placement*, not that reasoning: hiding
  half the user's own collection reads as the import having lost games). They
  used to render checked and disabled **inside** the one list to act on, so a
  mostly-imported shelf meant hunting past inert rows; they now sit below it in a
  collapsed `.bgg-import__present`, and no `is-present` row or disabled checkbox
  exists any more. It is a **native** `<details>`/`<summary>` (focus + Enter/Space
  from the platform, `.claude/rules/native-button-vs-focusable-span.md`) holding a
  plain `<ul>`, not a `.ds-row` — that would promise a click target that is not
  there (`.claude/rules/ds-row-is-a-click-target.md`) — and it is appended
  **before** `.sheet__actions`, which is `sticky; bottom: 0` and opaque, so
  anything after it scrolls under the submit button.
  `test/bgg-import-picker.test.js` runs the view in jsdom and pins all of it.
- **The picker must not be wrapped in a `.field`** — `.field label` (0,1,1) beats
  `.ds-row` (0,1,0) and silently flattens every row
  (`.claude/rules/label-rows-lose-to-field-label.md`). Verified in a browser:
  `getComputedStyle(row).display === 'flex'`.
- **Without `BGG_API_TOKEN` the feature degrades to an empty `ok`**, exactly like
  `search()` — visible as the empty state, never a throw. That is also what a dev
  instance shows, so the picker cannot be exercised there without stubbing.
- **`ti-download` (`\ea96`) was added to the font subset**, verified against this
  bundle's own cmap rather than tabler.io
  (`.claude/rules/tabler-icon-codepoints.md`).

**Related:** `.claude/rules/add-game-lookup-provider.md` (the two hops this joins,
and BGG's token/throttling rules), `.claude/rules/data-access-layer.md`,
`.claude/rules/per-tenant-quotas.md`,
`.claude/rules/product-event-logging.md` (why the feed event stays a plain
`game_added` — the allowlist has no count field, and widening it is a deliberate
act).
