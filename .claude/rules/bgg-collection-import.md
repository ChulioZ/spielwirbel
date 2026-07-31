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

## 4. The cache key is the BGG HANDLE, so tests must not share one

Keyed by handle alone, on purpose — the collection belongs to that BGG user, not
to our account, so two of our accounts linking the same handle correctly share one
fetch. The consequence for the suite is that **every spec needs its own handle**:
reuse one and the first spec's stubbed body answers the next one, which presents
as "my `global.fetch` stub is being ignored". Three specs in
`test/bgg-import.test.js` failed exactly that way before each got its own.

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

- **Expansions are excluded here** (`excludesubtype=boardgameexpansion`) although
  the *search* offers them deliberately — a bulk import is the one place where 50
  expansions of one game are noise rather than choice.
- **Games already on the shelf are shown, checked and disabled — not hidden.** The
  list is the user's own collection; silently dropping half of it reads as the
  import having lost games.
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
