---
paths:
  - "lib/routes/round-messages.js"
  - "lib/repo/json.js"
  - "lib/repo/postgres.js"
  - "lib/repo/migrations/20261112120000_round_messages.js"
  - "public/js/views-round-chat.js"
  - "public/js/round-chat.js"
  - "lib/chat-inbox.js"
---
# The round chat (#1781): tenant-scoped messages whose AUTHOR crosses tenants

`round_messages` is round data — FORCE RLS like `activities`, stored under the
round OWNER's tenant, reached by a grantee through the ordinary re-scope
(`.claude/rules/round-grant-resolver.md`). Three things fail silently:

1. **Erasing an author is a cross-tenant delete.** An account's messages sit in
   other people's tenants, so neither the tenant cascade nor a `round_id` FK
   reaches them. `eraseAccount` finds the tenants under `atx()` (READ only) and
   deletes under each `tx(tenant)`; `removeRoundMessage` (the operator) does the
   same. Under `atx()` the DELETE matches zero rows and reports success — only
   the plain-role child-process probe in `test/repo.postgres.test.js` sees it
   (measured: both breaks red there, everything else green).
   `round_message_reads` is global (keyed by account) for the same reason.
2. **`seq` is never reused.** The read marker compares seqs, so the JSON
   backend keeps a persistent counter (`data.roundMessageSeq`); deriving it from
   the array would hand a deleted newest message's seq to the next one, which a
   marker already at that value reads as read. Postgres `seq` is a bigserial and
   comes back as a STRING — every read goes through `Number()`.
3. **Posting does NOT mark the thread read.** It looked natural and it was
   redundant with `roundMessageHeads` skipping the reader's own messages — and
   wrong: it marked read a message someone else posted a moment earlier that the
   client never showed. The view marks what it has SHOWN. The break sweep found
   it (`.claude/rules/redundant-guards-make-each-other-untestable.md`).

The text is user-authored and shown to other accounts: `textContent` only, links
built from `chatSegments` (http(s) only), and never in a log line or a
`trackEvent` — `test/round-messages.test.js` captures stdout and asserts it.

## The inbox item (#1784) — `lib/chat-inbox.js`

One `chat_unread` item per (account, thread key `round:<rid>`). Three traps:

- **The count is recomputed, never incremented** — from
  `countUnreadRoundMessages` (the heads' filter) and the read marker, on every
  post, read and delete. A tally drifts the first time a delete or a read lands
  between two posts; a recount cannot.
- **Only a post may CREATE.** A read or a delete passes `create: false`, which
  rewrites an existing item or removes it — otherwise lowering a count
  resurrects an item the user dismissed. The author exclusion on the post is NOT
  redundant with the count skipping own messages: it is what keeps the author's
  item for *others'* unread messages from being bumped back (measured: the
  exclusion's own spec is the only red when it goes).
- **Recipients are read BEFORE grants are deleted** on round delete — after, the
  grantees are no longer recipients and keep an item leading to a 404. The owner
  holds no grant; it is found by `getUserByTenant` on the storing tenant.

