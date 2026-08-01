---
paths:
  - "lib/routes/account.js"
  - "lib/mail.js"
  - "test/account.test.js"
---
# An unauthenticated endpoint that SENDS MAIL needs a per-ACCOUNT cooldown (#435, #447)

`POST /api/account/resend-verification` mails a fresh verification link to any
address a caller names. Three endpoints have that shape — `register`,
`forgot-password` and `resend-verification` — and they share a constraint that is
easy to miss because the obvious protection is already in place and does not
actually protect anything here.

## The IP limiter is not the defence

All of `/api/account` sits behind `authLimiter` (`lib/app.js`,
`AUTH_RATE_LIMIT_MAX`, default 100 per window). That reads like enough. It is
not, for this class of endpoint, because the limiter counts **requests from one
IP** while the thing being abused is **someone else's inbox**: an attacker who
rotates addresses spends one request per IP and still delivers unlimited mail to
a victim they can name. The limiter caps the attacker's convenience, not the
victim's exposure.

Two things make that worse than ordinary spam here:

- The operator sends through a **mailbox.org account, not an ESP** — there is no
  headroom beyond a mailbox's own sending limits
  (`.claude/rules/transactional-mail-provider.md`). Exhausting the daily quota
  does not merely annoy one victim; it stops **registration working for
  everyone**, because verification mail is the only way through signup.
- The send is **awaited in the request path**, so a flood costs server time too.

So the cooldown is stored **on the account** — `verification.sentAt` and
`reset.sentAt`, both compared against `MAIL_COOLDOWN_MS` = 60 s in
`lib/routes/account.js` via the shared `mailThrottled(record)` helper. Rotating IPs
cannot move it, because it is keyed to the thing being protected rather than the
thing doing the protecting.

**`forgot-password` got the same cooldown in #447**, having been left out of #435
as out of scope. One thing there is worth keeping deliberately: the throttled
request skips the **mint** as well as the send. Every call used to replace the
`reset` token, so a user who double-submitted the form invalidated the link in
the mail they had just been sent, by their own second click. Skipping the whole
block is what makes that impossible — `test/account.test.js` pins it by reset­ting
with the pre-throttle link *after* a throttled call.

**`register` is NOT fixable this way, and that is not an oversight** (#448): a
second registration for the same address hits `email_taken` and mails nothing, so
there is no prior record to throttle against on the one request that does send.
Its residual risk is breadth (one mail each to many addresses, plus address and
username squatting), which needed a different mechanism. **#448 resolved it with
two bounds** — a tighter per-IP cap on that one route
(`REGISTER_RATE_LIMIT_MAX`) plus a global daily send budget in `lib/mail.js`
(`MAIL_DAILY_MAX`) that bounds the mailbox quota itself rather than the mechanism
abusing it. See `.claude/rules/bounding-bulk-registration-mail.md`. The third
option, reaping expired unverified accounts, was **not** taken: the squatting
half is still open.

## Every skip must stay silent — including the cooldown one

The endpoint answers `{ ok: true }` for an unknown address, an already-verified
account, a malformed address, a missing body **and** a throttled resend. That
last one is the one that gets "improved" into a `429 too_soon` by someone making
the UI more helpful — and a distinct answer for "throttled" is a perfect
account-existence probe, since only a real unverified account can *be*
throttled. The anti-enumeration invariants in `.claude/rules/user-accounts.md`
cover this endpoint in full; there is no honest error it can report.

The client side follows from that: the confirmation is worded conditionally
("falls zu dieser Adresse ein unbestätigtes Konto existiert"), because the
browser genuinely does not know whether anything was sent. `authErrorKey`
(`public/js/auth-error.js`) needs no per-form map for `'resend'` — like
`'forgot'`, the only codes that can reach it are the cross-cutting `rate_limited`
/ `auth_required` (#399).

## `Date.parse` on an absent field: the fallback must read as "long ago"

`sentAt` did not exist before #435, so a record written earlier has none, and the
cooldown must treat that as *expired* — not as *just now*, which would make the
one recovery path permanently unavailable to exactly the accounts that predate it.

```js
const sentAt = Date.parse((record || {}).sentAt || '');   // NaN when absent
return Number.isFinite(sentAt) && Date.now() - sentAt < MAIL_COOLDOWN_MS;
```

`Date.parse('')` is `NaN` and the `Number.isFinite` guard makes the absent case
fall through to "send". **Do not write `|| 0` there**: `Date.parse(0)` coerces to
the string `'0'`, which V8 parses as **the year 2000** — a real timestamp, 26
years in the past, which happens to give the right answer for a cooldown and the
wrong one for anything comparing forwards (an expiry check would read it as long
expired). It is a live footgun in any `Date.parse(x || 0)`.

`test/account.test.js` pins the legacy shape for **both** endpoints, by rewriting
a `verification` record and a `reset` record down to `{ tokenHash, expiresAt }`.
Note what those tests do and don't catch: a fallback that reads as *"just now"*
(`|| new Date().toISOString()`) turns them red, but `|| 0` does **not** — the year
2000 is comfortably outside a 60 s cooldown, which is exactly why that footgun
survives a green suite here and would only bite a forward-looking comparison.

## Verifying it

Every assertion here was checked by breaking the production code on purpose and
watching it go red (the discipline in
`.claude/rules/break-the-code-on-purpose.md`) — a `mailThrottled` stubbed to
`false` fails the cooldown tests on **both** endpoints (which is also how you
confirm the shared helper is really wired to each), re-minting the token inside
the throttled branch fails the still-valid-link assertion, an absent-`sentAt`
fallback of "now" fails both legacy-record tests, and a `404` for an unknown
address fails the identical-answers test. Back the file up to the scratchpad
first; `git checkout`
restores from the index and discards the whole uncommitted change
(`.claude/rules/css-text-assertions-strip-comments.md`).

**Related:** `.claude/rules/user-accounts.md` (the anti-enumeration invariants),
`.claude/rules/transactional-mail-provider.md` (why the sending quota is small
and shared), `.claude/rules/security-middleware.md` (the IP limiter this does not
rely on).
