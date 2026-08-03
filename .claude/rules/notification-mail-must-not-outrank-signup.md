---
paths:
  - "lib/mail.js"
  - "lib/notify.js"
  - "lib/routes/invitations.js"
  - "lib/routes/friends.js"
  - "test/notify.test.js"
---

# Mailing an inbox item (#618): four things that fail silently, and one that fails loudly for everyone

`lib/notify.js` e-mails the two **actionable** inbox items — a round invitation
(#207) and a friend request (#325). Everything below cost reasoning rather than
debugging, and none of it is visible from the feature working.

## 1. The budget is shared with SIGNUP — so notification mail gets its own class

`MAIL_DAILY_MAX` bounds the operator mailbox's quota, and the mail that stops
when it trips is **verification mail**, i.e. registration breaks for everyone
(`.claude/rules/bounding-bulk-registration-mail.md`). Adding notifications to
that one undifferentiated bucket buys marginal re-engagement with the app's front
door.

So `bookSend(kind)` keeps the **last quarter** critical-only, and two details are
load-bearing in opposite directions:

- **An absent or unrecognised `kind` must behave as `critical`.** Writing the
  check as `kind === 'critical' ? 0 : reserve` looks equivalent and is not: a typo
  at a call site would then silently stop that mail — including a verification
  link — going out. It is `kind === 'notification' ? reserve : 0`.
- **The refusal logs a DIFFERENT event** (`mail_notification_budget_reserved` vs
  `mail_daily_budget_exhausted`). The first means the breaker is working; the
  second means signup is affected right now. One shared event buries the second
  in the noise of the first.

**Testing it needs the discriminating assertion**, not the obvious one: "sends
stop at the ceiling" passes just as well with no reserve at all, because the plain
ceiling stops them too. The real assertion is *a notification is refused while a
critical send, one line later, still succeeds*. Size it as
`MAIL_DAILY_MAX = budgetState().sent + 1` — the reserve is `ceil(limit/4) >= 1`,
so exactly one send is left and it is critical-only, whatever the file has already
sent (the per-process counter trap in `bounding-bulk-registration-mail.md`).

## 2. Two recipients must never be mailed, and neither is about preference

- **A guest demo** holds a synthetic `…@demo.invalid` address, reserved by
  RFC 2606 precisely so it can never route — every send is a guaranteed bounce
  that spends real budget and real domain reputation. A demo cannot *send* either
  request (`demo.refuseDemoAccount`), which is why this looks unreachable; a real
  account can address one by its `demo-<hex>` username. Classify with
  `isDemoTenant`, the one tested definition
  (`.claude/rules/guest-demo-accounts.md` §1).
- **An unverified account.** Its address is not a confirmed channel, it cannot
  even log in (`email_not_verified`), so it could never open the inbox the mail
  points at — and mailing it repeatedly is exactly the amplifier the per-account
  cooldown discipline exists to deny
  (`.claude/rules/mail-sending-endpoints-need-a-per-account-cooldown.md`).

Neither is in #618's issue body. Both are reachable today.

## 3. The throttle is stamped AFTER the send, never before

`notifiedAt` bounds one recipient's mail to one message an hour — keyed to the
**recipient**, because the thing being protected is one mailbox and any number of
senders can aim at it (every existing friend-request cap is per-*sender*, and
declining deletes the row, so A can re-request B immediately and repeatedly).

Stamp it before the send and one SMTP hiccup — or one budget refusal — **silences
the recipient for an hour over a message they never received**. The window must
start when a mail actually goes out.

The complement is what makes a suppressed item *delayed* rather than *lost*: past
the window the next item **coalesces**, naming the running unread count read out
of the inbox at send time. No stored counter, and nothing to keep in sync.

## 4. The allowlist is the point, and the mail body carries no free text

The inbox is a **generic store**, so without an explicit per-type map a future
`addInboxItem(uid, { type: 'whatever' })` inherits the mail path silently —
discovered only when a user complains. Same shape, same reason, as `trackEvent`'s
`EVENTS` (`.claude/rules/product-event-logging.md`).

And the body names the sender's **username** and nothing else. A username is
`[a-zA-Z0-9_-]{3,30}` and already refuses handles reading as an official account
(`public/js/username-policy.js`); the **round name** sitting beside it in the same
payload is free text. Putting free text into a message sent from our own domain
lends our sender reputation to whatever a stranger typed — and the recipient sees
the round's name the moment they open the inbox, so the mail gives up nothing.

## 5. Fire-and-forget work needs a way to be awaited, or every test races it

The routes must **not** await the send: a wedged SMTP connection would hold
`POST /api/account/friends` open, and a mail failure must not fail an invitation
that already exists. That makes the work invisible to the caller — so a test that
reads `mail.outbox` after the response is a race, and an unhandled rejection would
take the process down over a mail hiccup.

`notifyInboxItem` therefore never rejects, and the module tracks its in-flight
promises behind `idle()`. That is the seam tests await; without it the whole
feature is only testable by sleeping.

**The mailed link is `/inbox`, not `/#/inbox`** — the SPA uses the History API
with clean paths (`public/js/router.js`), and the issue body got this wrong. Both
links in the body must also survive quoted-printable's 76-column wrap
(`.claude/rules/mailed-links-must-fit-one-qp-line.md`).

**Related:** `.claude/rules/bounding-bulk-registration-mail.md` (the budget this
splits, and the resource-vs-mechanism reasoning),
`.claude/rules/mail-sending-endpoints-need-a-per-account-cooldown.md` (the
per-recipient throttle generalised one step),
`.claude/rules/transactional-mail-provider.md` (why the quota is small and why the
body stays text/plain), `.claude/rules/keep-legal-docs-current.md` (this was a new
purpose for the account address: policy §4 + §9 both languages, `vvt.md` row 18,
`PRIVACY_REVISION` bumped and `TERMS_REVISION` deliberately not).
