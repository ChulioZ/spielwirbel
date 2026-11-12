---
paths:
  - "lib/routes/round-messages.js"
  - "lib/repo/json.js"
  - "lib/repo/postgres.js"
  - "lib/repo/migrations/20261112120000_round_messages.js"
  - "public/js/views-round-chat.js"
  - "public/js/round-chat.js"
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
