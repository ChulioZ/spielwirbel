---
paths:
  - "lib/push.js"
  - "lib/routes/push.js"
  - "lib/chat-inbox.js"
  - "lib/repo/push-subscriptions-json.js"
  - "lib/repo/push-subscriptions-postgres.js"
  - "lib/repo/migrations/20261126120000_push_subscriptions.js"
  - "public/js/push-client.js"
  - "public/sw.js"
---
# Web push for chat (#1785): the endpoint is an SSRF surface, the payload is a promise

A device subscribes under Konto; `lib/chat-inbox.js` calls `lib/push.js` once per
recipient on every new round message, session comment or direct message. Off
unless `VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`/`_SUBJECT` are all set. Five things fail
silently:

1. **The server POSTs to whatever endpoint a client registers.** So the endpoint
   is validated against a HOST ALLOWLIST of the four browser push services
   (`isAllowedPushEndpoint` in `lib/routes/push.js`), never a URL sanitiser —
   otherwise any account could point our sender at an internal address
   (`.claude/rules/allowlist-request-values-that-reach-a-url.md`). A new browser
   vendor's push host is a new entry there, and its spec in `test/push.test.js`
   has the suffix-spoof cases that make an `endsWith` without the leading dot
   fail.
2. **The payload carries the thread NAME, one fixed line, the path and the key —
   never the text.** It is a public promise (privacy policy §5, VVT row 29), and
   the spec asserts the whole sent object, not "no `text` field": a payload that
   gained a `preview` would pass a field check.
3. **An endpoint plus its keys is a capability.** Never logged (failures log the
   status code only), never echoed, and the Art. 15 export carries the service's
   ORIGIN only. A device that signs into a second account MOVES (unique
   endpoint), so the first account stops reaching it.
4. **The collapse keys off the recount, not a timer alone.** `unread === 1` (the
   first unread after a read) always pushes; a larger count inside
   `COLLAPSE_MS` is the same burst. The slot is CLAIMED before the first await
   (sends run concurrently) and HANDED BACK when nothing is sent — otherwise a
   mute swallows the first push after it is lifted. The map is in memory —
   sound only with `numReplicas: 1`
   (`.claude/rules/deploy-invariants-are-pinned-in-code.md`) — and swept of
   expired slots past `COLLAPSE_SWEEP_AT`. Each break has its own named spec.
5. **Muting a round mutes its session comments** (`parentThread`, read off the
   comment's url). The session bell therefore renders disabled-and-pressed while
   its round is muted — a bell that toggles its own key under a muted round
   would be a control that changes nothing.

**The routes never wait for a push service.** `chat-inbox.js` calls
`notifyChatLater` (fire-and-forget); awaiting `notifyChat` there passes every
payload assertion and holds the sender's POST for up to 5 s per slow device.
Specs await `drainPushes()` after a post instead.

The permission prompt runs only inside the Konto toggle's `change` handler —
the issue's acceptance criterion, and Safari refuses a prompt no gesture
started. `test/push-client-view.test.js` asserts rendering the row never
prompts. Logout calls `disablePush({ leaving: true })` BEFORE the logout
request, while the access token still authorizes the DELETE — as a plain
`fetch`, because `api()`'s 401 recovery would route to the login screen
mid-sign-out.

**Related:** `.claude/rules/round-chat.md` (the inbox recount this rides on),
`.claude/rules/pwa-service-worker.md` (the `push`/`notificationclick` handlers
live in `sw.js`, which still never caches `/api/`),
`.claude/rules/keep-exploit-paths-private-until-deployed.md`.
