---
paths:
  - "lib/routes/direct-messages.js"
  - "lib/repo/direct-messages-json.js"
  - "lib/repo/direct-messages-postgres.js"
  - "lib/repo/migrations/20261124120000_direct_messages.js"
  - "public/js/views-messages.js"
  - "lib/chat-inbox.js"
---
# Direct messages (#1783): a GLOBAL store whose access is the friendship, checked per request

`direct_messages` joins two ACCOUNTS and no tenant, so it is global and outside
RLS like `friendships` — keyed by the canonical pair (`user_lo <= user_hi`), not
by a friendship id, because ending a friendship deletes its row and the history
must survive that. The router sits ahead of the tenant gate and decides
everything from the caller's own friendship rows (`resolvePartner`). Four things
fail silently:

1. **The partner check MASKS the per-message check in a test.** Every route
   resolves the partner first and 404s a stranger, so a spec that addresses
   another conversation's message through a pair that is not friends never
   reaches `pairMessage` — measured, it stayed green with that check deleted.
   The discriminating fixture is the author addressing their OWN message through
   a conversation with a third person they ARE friends with
   (`test/direct-messages.test.js`). Two guards covering one case is
   `.claude/rules/redundant-guards-make-each-other-untestable.md`.
2. **An edit after the friendship ended is a new message by another name**, so
   PATCH needs `canPost` as well as authorship; DELETE needs only authorship (a
   person may always take their own words back). A stranger and an ex-friend
   with no remaining history get the SAME 404 as an unknown id — a distinct
   answer would tell anyone which two accounts once talked.
3. **Erasure takes the whole conversation, both sides** (operator decision,
   2026-11-24) — and the OTHER side's `chat_unread` item keyed `dm:<erased id>`
   with it, or it names a deleted account and leads to a 404. Export returns only
   what the account WROTE (with `withUserId`) plus its markers. Both are pinned in
   `test/support/direct-messages-contract.js` and declared in
   `test/erasure-completeness.test.js`.
4. **`seq` is a persistent counter in the JSON backend** (`data.directMessageSeq`),
   the round chat's §2. The contract only sees reuse when the deleted message is
   the store's NEWEST, so the fixture writes the unrelated pair first.

The demo guard covers the whole router (`refuseDemoAccount`) and a demo PARTNER
resolves as unknown: a throwaway account must never reach a real conversation.

## Where it lives, and why there

The store is two modules (`direct-messages-json.js`, a factory in
`direct-messages-postgres.js`) spread into the backends rather than written into
`json.js`/`postgres.js`: those were at their `test/token-budget.test.js`
allowance, and the store reads no round data. Erasure and export call the
modules' `eraseDirectMessagesOf`/`exportDirectMessagesOf` from the backends' own
`eraseAccount`/`exportAccountData`, so the two enumerations stay one place each.

The thread UI is the round chat's `mountChatThread` with `round: null` (nobody
moderates, nothing is purged), `readOnly` for an ended friendship and `onRead`
for the inbox badge — never a second thread component.

**Related:** `.claude/rules/round-chat.md` (the machinery reused, its seq and
no-mark-on-post rules), `.claude/rules/guest-demo-accounts.md`,
`.claude/rules/erasure-evidence-is-a-set-of-actions.md` (why
`remove_direct_message` is NOT in `ERASURE_ACTIONS`: it is moderation, not an
erasure record), `.claude/rules/admin-kennzahlen-card.md`.
