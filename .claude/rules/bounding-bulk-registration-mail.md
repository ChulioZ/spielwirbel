---
paths:
  - "lib/app.js"
  - "lib/mail.js"
  - "lib/routes/account.js"
  - "test/account.test.js"
  - "test/mail.test.js"
  - "test/helpers.js"
---
# Bound the RESOURCE, not just the mechanism: registration mail (#448)

`POST /api/account/register` mails a verification link to any address a caller
names. The per-**account** cooldown that fixed `resend-verification` (#435) and
`forgot-password` (#447) cannot fix this one — a second attempt at the same
address hits `email_taken` and mails nothing, so on the one request that *does*
send there is no prior record to throttle against
(`.claude/rules/mail-sending-endpoints-need-a-per-account-cooldown.md` says why).

So #448 shipped **two** bounds, and the split between them is the whole lesson.

## The two bounds do different jobs — don't collapse them

| | Where | What it bounds | Defeated by |
|---|---|---|---|
| `REGISTER_RATE_LIMIT_MAX` (10/15 min) | `lib/app.js` | one **source**'s convenience | rotating IPs |
| `MAIL_DAILY_MAX` (200/UTC day) | `lib/mail.js` | the **mailbox quota** itself | nothing — it is the resource |

The per-IP cap is the obvious fix and it is **not** the defence. What is actually
at risk is the operator mailbox's sending quota: production submits through a
mailbox.org account, not an ESP, so there is no headroom
(`.claude/rules/transactional-mail-provider.md`), and the mail that stops going
out is *verification* mail — i.e. **signup breaks for everyone**, which is far
worse than the nuisance to any one recipient. An IP-rotating attacker walks past
the limiter and reaches that quota untouched.

Hence a budget on the resource. Bounding the resource rather than the mechanism
also means it covers **every present and future mail path** for free — contact
form, invitations, resets — without anyone remembering to add a limiter when a
new one lands. A tripped breaker stops legitimate mail too; that is the accepted
trade, because it trips at *our* threshold, below the provider's, so the mailbox
stays healthy and the operator gets a log line instead of a flagged account.

## Four things that are load-bearing

- **The budget counts the outbox (unconfigured) path too.** It costs no real
  quota, so counting it looks wrong. It is what makes the breaker behave
  identically in dev, test and production, and what lets a test drive it with no
  SMTP config at all. The price: **`test/helpers.js` must raise `MAIL_DAILY_MAX`**
  (it does, to 1e6) or a long account spec trips the breaker on its own traffic —
  the same reasoning as the rate-limit ceilings there.
- **The refusal must stay silent at the route.** `send()` *throws*, `sendSafe()`
  in `lib/routes/account.js` already log-and-continues, so register still answers
  `{ ok: true }`. A distinct code would be a perfect account-existence probe —
  the anti-enumeration invariants in `.claude/rules/user-accounts.md` bind here
  exactly as they do for the cooldown skips. `test/account.test.js` pins that the
  budget-refused answer is byte-for-byte the `email_taken` answer.
- **`bookSend()` is checked before the transport is built.** Refusing after would
  still open an SMTP connection and, against a real host, still spend the quota
  the breaker exists to protect.
- **The mount order matters.** `app.use('/api/account/register', registerLimiter)`
  must come **before** `app.use('/api/account', …)`, or the account router fields
  the request first and the limiter never runs. It *stacks* with `authLimiter`
  rather than replacing it — a signup spends one from each.

## `sentAt` is stamped even when the send was refused — leave it

A budget-refused registration still writes `verification.sentAt`, so the 60 s
per-account cooldown briefly suppresses a resend for a mail that never went out.
That reads like a bug and is not worth fixing: the budget is a whole-UTC-day
breaker, so by the time a resend could actually deliver, the cooldown has long
lapsed — it is never the binding constraint. **Don't "fix" it by moving the mint
after the send:** #447 pins that the mint and the send stay together, or a
double-submit invalidates the link already sitting in the user's inbox.

## Testing it

- **Size every budget test relative to `mail.budgetState().sent`.** The counter is
  per-process and deliberately has no reset hook (the reset is lazy, on the first
  send of a new UTC day, so an idle process holds no timer). A test that assumes
  a clean slate passes alone and fails in file order.
- **Raise `AUTH_RATE_LIMIT_MAX` out of reach in the register-limiter test.** Both
  limiters answer the identical `429 { error: 'rate_limited' }`, so with the auth
  ceiling left low the test passes even if the register limiter was never
  mounted — a vacuous green.

Both assertions were verified by breaking the production code on purpose (the
discipline in `.claude/rules/admin-cross-tenant-escape.md` §4): stubbing the
`budget.sent >= dailyMax()` check reddens 3 mail tests + the anti-enumeration
one, and deleting the limiter's `app.use` line reddens the security test. Back
the files up to the scratchpad first — `git checkout` restores from the index and
discards the whole uncommitted change
(`.claude/rules/css-text-assertions-strip-comments.md`).

## What #448 deliberately did NOT do

- **No CAPTCHA or third-party anti-bot service.** That is a new processor and a
  new recipient of visitor data, needing its own legal review
  (`.claude/rules/keep-legal-docs-current.md`) — it must never arrive as a side
  effect of a rate-limiting change.
- **No reaper for expired unverified accounts.** The *squatting* half (a
  registration parks someone's address **and** username with nothing reaping it)
  is untouched and remains open. A reaper must key off the **account's** age, not
  the current token's expiry, or a user who legitimately resends (#435) is deleted
  out from under themselves.
- **The counters are per process and in memory**, so each instance carries its own
  budget and a restart clears it — the same caveat as the rate limiters, and the
  reason #215 (a shared limiter store) exists.

**Related:** `.claude/rules/mail-sending-endpoints-need-a-per-account-cooldown.md`
(the sibling defence and why it doesn't transfer),
`.claude/rules/transactional-mail-provider.md` (why the quota is small and shared),
`.claude/rules/security-middleware.md` (read every ceiling per call, never at
module load), `.claude/rules/user-accounts.md` (the anti-enumeration invariants).
