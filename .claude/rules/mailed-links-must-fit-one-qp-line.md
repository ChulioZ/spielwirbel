---
paths:
  - "lib/routes/account.js"
  - "lib/accounts.js"
  - "lib/mail.js"
  - "test/account.test.js"
---
# A mailed link must fit on ONE quoted-printable line (#434)

The verification link arrived **cut in half** for a real user, who had to copy
and paste the two halves together by hand. The cause is not the mail provider,
not the client, and not anything visible in the source of `lib/routes/account.js` —
it is an interaction between the body's encoding and the URL's length, and it
survived three provider migrations in one day untouched.

## The mechanism

The account mails are `text/plain` with German text, so the umlauts force
`Content-Transfer-Encoding: quoted-printable`. **QP wraps at 76 columns**,
inserting a `=` soft line break. The pre-#434 URL was **107 characters**:

```
…/verify-email?uid=3b58bac60038176b&token=PTSz72TCOPGJQK19DW9hnfCLHnFKD09-4Pw…
```

so the break landed *inside* it:

```
…verify-email?uid=3De3c6fbf42291bfcc&token=3D0EdimFR=
JWyDONW54GoOtTrpXMao91AUQyVt4_-NA30U
```

A compliant client removes the soft break and reassembles the URL — so the
*address* is fine. But the body carries a **bare text URL, not an `<a href>`**,
so whether it becomes clickable depends on the receiving client's
**auto-linkifier** running across that break. Some do; the reporter's did not.

**RFC 2045: a QP line may be at most 76 characters including the trailing `=`.**
So **75 characters of content is the last width that is never broken**, and that
is the number `test/account.test.js` (`QP_SAFE_LINE`) pins.

## The fix, and why the obvious ones are wrong

The link is now `https://spielwirbel.app/v?t=v1.<uid>.<secret>` — **70
characters**, with the uid moved *inside* a combined token in the same
`<version>.<uid>.<secret>` shape `lib/accounts.js` already uses for refresh
tokens. Three parts of that are load-bearing:

- **The secret is 16 bytes, not the 32 `newRawToken()` uses.** 22 base64url
  characters instead of 43 is most of the saving. 128 bits is still ample for a
  token that is single-use, time-limited (24 h / 1 h) *and* behind the auth rate
  limiter — don't "harden" it back to 32 and silently re-break the link.
- **The stored record shape did NOT change.** Only the *secret* is hashed into
  `tokenHash`, never the assembled token — so the record never encoded which link
  shape produced it, and a legacy `?uid=…&token=…` link kept verifying across the
  deploy. That fallback (`linkCredentials` in `lib/routes/account.js`) was **not**
  dead code at the time: a verification mail is valid for 24 h, so links in the
  pre-#434 shape were still sitting in inboxes when #434 shipped on 2026-07-25,
  and deleting it then would have stranded exactly the users who signed up just
  before the deploy. **It was removed in #451 on 2026-07-26** under the
  transitional-code discipline in `CLAUDE.md`.

  **Mind the arithmetic if you ever date a removal like this again.** #451's
  issue reasoned "#434 merged on 2026-07-25, so from 2026-07-26 no old link can
  still verify" — which quietly assumed the deploy landed early in the day. It
  landed at **2026-07-25T23:59:10Z**, 50 seconds before midnight UTC, so the last
  legacy links actually lived until **2026-07-26T23:59Z**. The removal shipped
  that morning, ~16 h early, as a deliberate operator decision: the residual
  cohort (registered in the 24 h before the deploy, still unverified) gets
  `invalid_token` and recovers through resend-verification, which mails a fresh
  short link. A removal gated on a TTL expiring must be measured from the
  **deploy timestamp + TTL**, not from the merge *date*.

  `verifyEmail()` and the `reset-password` handler now
  call `accounts.parseLinkToken` directly and answer `400 invalid_token` when it
  returns null; `test/account.test.js` pins the refusal so the branch does not
  come back as a "bug fix". A stray `uid` in the *request body* is still accepted
  and ignored — that was the documented client API, and only credential
  resolution changed.
- **`v1.` and `p1.` are distinct on purpose.** Both records hash into the same
  `tokenHash` field, so without the version check a verification link would
  double as a working password-reset link. `parseLinkToken` takes the expected
  version and refuses the other.

**Do NOT "fix" this by adding an `<a href>` / HTML part.** That is the robust
fix in general and it is forbidden here — see
`.claude/rules/transactional-mail-provider.md`: a `text/plain` body cannot carry
a tracking pixel, which is why #439/#440 happened, and `test/mail.test.js`
asserts no `html` part is ever sent. The issue's own title says "multipart";
that predates the provider move and the corrected root-cause analysis in its
body.

## Testing it: the default base URL hides the bug

The suite runs without `APP_BASE_URL`, i.e. against `http://localhost:3000` —
**21 characters shorter than the production origin**. A length assertion made
under that default passes no matter how long the link grows. `withProdBaseUrl()`
in `test/account.test.js` sets the real `https://spielwirbel.app` around the
send for exactly this reason.

Note what the test can and cannot see: it measures the **literal** line length,
which equals the QP-encoded width only because every character of the link is
QP-safe (hex uid, base64url secret, no `=`). A future link component that needed
escaping would encode wider than it measures — re-derive the budget rather than
trusting the number.

Verified by reinstating the pre-#434 long link on purpose and watching the
assertion go red (and separately: dropping the version check reddens the
cross-token test, and re-adding the removed legacy fallback reddens #451's
refusal test — which is what that test is for).
Back the files up to the scratchpad first — `git checkout` restores from the
index and discards the whole uncommitted change
(`.claude/rules/css-text-assertions-strip-comments.md`).

## Verifying for real

Nothing local proves a link survives delivery. The tests prove the width; the
actual check is **the raw source of a real send** (in Gmail, ⋮ → *Original
anzeigen*), looking for a `=` at the end of the link's line. `curl` cannot see
any of this — same blind spot as
`.claude/rules/transactional-mail-provider.md` §3.

**Related:** `.claude/rules/transactional-mail-provider.md` (why the body is
text-only and where the 76-column wrap comes from),
`.claude/rules/mail-sending-endpoints-need-a-per-account-cooldown.md` (the other
constraints on these three endpoints),
`.claude/rules/user-accounts.md` (the token model this reuses).
