---
paths:
  - "lib/corpus.js"
  - "lib/providers/bgg.js"
  - "lib/repo/corpus-file.js"
  - "lib/repo/json.js"
  - "lib/repo/postgres.js"
  - "test/corpus.test.js"
  - "test/bgg-corpus-parse.test.js"
---
# The BGG corpus (#681): four things that fail silently

The local candidate pool a recommender scores against — the operator-uploaded
ranks CSV plus a bounded, resumable enrichment pass. Each item below produced no
error and no failing test in the obvious implementation.

## 1. Every tag name in a BGG body is a PREFIX of another one

`parseCorpusThing` slices per-`<item>` blocks out before parsing, because
`parseItems` flattens every descendant into one child list — so a two-item body's
suggested-players polls would merge and every `<result>` would lose the
`<results numplayers=N>` it belongs to. The slicing regexes are the trap:

| Opening tag | Also matches | Closing tag matches only |
|---|---|---|
| `<item` | **`<items>`** (the document wrapper) | `</item>` |
| `<poll` | **`<poll-summary>`** | `</poll>` |
| `<result` | **`<results>`** | — |

Because the *opening* tag matches the wrong element while the *closing* one still
matches the right one, the block silently spans the wrong region. Measured: with
`<item((?:"[^"]*"|'[^']*'|[^>"'])*)>` the whole first game was consumed as the
`<items>` wrapper's "attributes" and **a two-item body parsed as one item**. No
throw — half the batch simply went missing.

So each pattern carries `(?=[\s>/])`. The `<poll` case is the nastiest, because
`<poll-summary name="suggested_numplayers">` carries the **same `name`
attribute** the parser filters on — the name check does not save you, and it
would have read a verdict out of BGG's English prose block.

## 2. Stamp every id you ASKED about, not every id BGG answered

An enriched row leaves the queue by having `enrichedAt` set. BGG legitimately
answers nothing for some ids (merged or deleted upstream), and stamping only the
answered ones puts the rest back at the **head** of the queue on every future
tick, forever, ahead of every row behind them. Nothing reports it; enrichment
just stops making progress somewhere in the middle of the corpus.

Hence `bgg.corpus(ids)` returns `{ items, asked }` — the #736 shape, for the same
reason (`.claude/rules/provider-info-triggers-and-stamping.md` §2). Note the
matching half: a row BGG had nothing for is stamped **without** an `info` key, so
the repo leaves the stored attributes alone. Nulling them would empty the corpus
one upstream hiccup at a time.

The tokenless case is the mirror image: `asked` is `[]`, so nothing is stamped at
all — otherwise configuring `BGG_API_TOKEN` later would leave every row waiting
out a staleness window for data it could have had at once.

## 3. A re-upload CARRIES OVER enrichment — which leaks between tests

`replaceCorpus` replaces the row set but keeps `enrichedAt` and `info` for every
id that survives. That is not an optimisation to trim: the operator re-uploads
monthly and the ranks barely move, so without it every upload would throw away
thousands of enriched rows and re-fetch them over another six hours — for data
that did not change.

The consequence in tests is what actually costs time. `test/corpus.test.js`
shares one `DATA_DIR`, so two specs seeding the *same ids* means the second one
starts with rows already enriched. It presents as **"the enrichment pass asked
nothing"** three specs later, in cases that have nothing to do with re-uploading;
four specs failed that way at once. Every seeding helper therefore mints its own
id namespace.

## 4. The corpus must NEVER ride `data.json`

`lib/store.js` rewrites the entire `data.json` on every mutation, so 5000 corpus
rows in there would make every game add and every vote re-serialize megabytes of
BGG facts that never change. Hence `lib/repo/corpus-file.js` — its own file under
`DATA_DIR`, loaded once, saved atomically.

Nothing observable breaks if you fold it back in: the app works, every other test
passes, and the cost shows up only as latency on an instance with real data. So
`test/corpus.test.js` asserts the bytes of `data.json` are **unchanged** across a
corpus write. Verified by routing the corpus through `saveData()` on purpose —
that one spec goes red, and its runtime goes from ~1 ms to ~1150 ms, which is the
regression itself showing up in the clock.

Two things make that assertion non-vacuous and both are easy to omit: a round has
to be created first (a never-written `data.json` compares equal to itself), and
the corpus file's row count is asserted afterwards (or "nothing was written
anywhere" would pass).

This is not a "third persistence backend" in CLAUDE.md's sense — that call is
about not fragmenting *round-data* storage, and this holds no round data, no
personal data and nothing a tenant owns.

## An operator-facing count must not merge two reasons under one label

The upload first reported a single `dropped = total - kept` and the card phrased
it as "*n* von *m* Zeilen verworfen: Erweiterungen, unplatzierte und zu selten
bewertete". On a real 180,000-row dump that read **"175000 von 180000 Zeilen
verworfen"** — and it was wrong, because `dropped` also contained every row that
passed all three filters and lost only to `BGG_CORPUS_SIZE`.

The two are not the same fact. A filtered row was never a candidate; an over-cap
row is an ordinary game the ceiling excluded. Merging them told the operator that
175,000 rows were unusable, and hid `overCap` — **the only number that says
whether the cap is set right**, and the number they would need to decide whether
to raise it. The operator asked "does it only take 5000, and why not all of
them?", which is precisely the question the message should have pre-empted.

So `parseRanksCsv` returns `filtered` and `overCap` separately, and the three
numbers are asserted to account for the whole file (`kept + filtered + overCap
=== total`) — that closure is what stops a future filter being added without a
counter. Nothing here throws either way: the wrong version is a plausible
sentence about a successful upload.

**The general form:** when a pipeline discards rows for reasons the reader can
*act on differently*, the count is per reason. One total with a list of causes
reads as if every cause applied to every row.

## A captured-real fixture is still not automatically a DISCRIMINATING one

`.claude/rules/bgg-collection-import.md` says to capture live rather than
hand-write a fixture, because a hand-written one stamps the shape the code
assumes. True, and it does not go far enough — the capture fixes *that* trap and
says nothing about whether the case you are asserting can fail.

Measured here on the "N+" player-count bucket. `parseInt('4+')` is 4, which would
merge "more than 4 players" into the real 4-player row, so the parser drops any
bucket that is not a bare integer. The captured Ark Nova body carries a `4+` row
of 4/9/1199 votes — a landslide **against** — so admitting it changes neither
verdict, and the assertion written over the real capture stayed **green against a
parser with the bug deliberately reinstated**.

The discriminating test builds the case the capture happens not to contain: it
rewrites the `4+` bucket to 9999 Best votes, where only a parser that admits the
bucket can report `bestWith: [4]`. Same discipline as
`.claude/rules/break-the-code-on-purpose.md` — the point is that "I used real
data" is not a substitute for having watched the assertion fail.

**Related:** `.claude/rules/add-game-lookup-provider.md` (the provider contract
and BGG's token/throttling terms), `.claude/rules/bgg-collection-import.md` (the
other bulk BGG path, and the capture-live discipline this qualifies),
`.claude/rules/data-access-layer.md`, `.claude/rules/postgres-backend.md`
(absent-key parity, which `enrichedAt`/`info` have to keep).
