# Per-tenant quotas (lib/quota.js, issue #139) — gotchas

Issue #139 added per-tenant cost/abuse caps. They are all **state caps** — they
count current data rather than metering a rate — and `lib/quota.js`'s own header
comment is the authoritative list. Today it holds **six** ceilings, in two
groups:

| Cap | Checked in | Refusal | Since |
|---|---|---|---|
| rounds per tenant | `routes/rounds.js` | `quota_rounds` | #139 |
| games per round | `routes/games.js`, `routes/lookup.js` | `quota_games` | #139 |
| tags per round | `routes/tags.js`, `routes/games.js` | `quota_tags` | #238 |
| members per round | `routes/members.js` | `quota_members` | #563 |
| accepted friends per user | `routes/friends.js` | `quota_friends` | #325 |
| open outgoing friend requests per user | `routes/friends.js` | `quota_requests` | #325 |

The last two are per **account**, not per tenant — the friendship layer is a
cross-account social surface rather than tenant data — but they take the same
shape (env-tunable, read per call, distinct 403 → localized toast). They need no
`enforced()` gate of their own: the friend routes 404 outright when accounts are
off.

**This list has gone stale twice** (#325 and #563 each added caps without
updating it), so `test/rule-enumerations.test.js` now asserts every `quota_*`
code emitted under `routes/` is named in this file. Add the row when you add a
cap; the test tells you if you forget.

Things that will bite if you forget them:

- **Quotas are enforced ONLY when `accounts.accountsEnabled()`** (the public
  multi-tenant mode). `quota.enforced()` gates every check. With accounts off —
  password-only or open mode, where every caller is the one `'default'` tenant —
  the caps are inert, so that instance is
  byte-for-byte unchanged and an existing group already past a cap is never
  suddenly blocked. This mirrors how tenancy (#136) and onboarding (#138) gate
  their behaviour. Don't make a quota fire in legacy mode.

- **State caps count current data; deleting frees the slot.** The rounds cap
  counts `req.repo.listRounds().length` (tenant-scoped) and the games cap counts
  `round.games.length` (**active + archived**, i.e. retired *and* completed —
  every state holds a row and a possible cover). They're checked *before*
  persisting: the games check sits after the
  round-404 check but before `saveUploadedImage`, so a refused add
  leaves no orphan file even though multer already buffered the upload in memory.
  There is deliberately no `countRounds` repo method — reusing `listRounds` avoids
  widening the repo contract for a ≤10-row count.

- **All ceilings are read per call, from env** (`MAX_ROUNDS_PER_TENANT`,
  `MAX_GAMES_PER_ROUND`, `MAX_TAGS_PER_ROUND`, `MAX_MEMBERS_PER_ROUND`,
  `MAX_FRIENDS_PER_USER`, `MAX_FRIEND_REQUESTS_PER_USER`; defaults
  10 / 1000 / 30 / 50 / 500 / 50), so a test — or a live re-tune — picks up the
  current env without a rebuild, matching the rate-limit ceiling in `lib/app.js`
  (see `security-middleware.md`).

- **Error contract → frontend toasts.** Every refusal returns its own code (the
  table above). `core.js` `api()` throws `new Error(payload.error)`, so each catch
  maps the code to a localized toast (`newRound.toast.quota`,
  `addGame.toast.quota`, `tags.toast.quota`, `member.toast.quota`,
  `moveGames.toast.quotaGames`/`quotaTags`, `bggImport.toast.quota` in
  `lang/{de,en}.js`). The `limit` field in the 403 body is
  not surfaced (api() drops it) — the messages are intentionally number-free
  since the limits are env-tunable.

- **Testing needs accounts ON** (so the caps aren't inert). `test/quota.test.js`
  enables accounts, drives real tenants via the register→verify→login helper
  (like `test/tenant.test.js`), and sets tiny ceilings via env. It also asserts
  inertness with a fresh `createApp()` built with accounts off.

**Historical note (#264):** there used to be one more cap — a per-tenant monthly
limit on the *billed* buy-next LLM call, implemented as a hand-rolled
calendar-month counter rather than an `express-rate-limit` limiter (a ~30-day
`windowMs` overflows Node's 32-bit timer and the cap silently never holds). It
counted on success rather than reserving, so an aborted request couldn't leak a
slot. All of it went away with the feature in #264; the note survives only so
nobody reinvents a monthly `rateLimit()` window and hits the same timer trap.
