# A mailed link must fit on ONE quoted-printable line (#434)

The verification link arrived **cut in half** for a real user, who had to copy
and paste the two halves together by hand. The cause is not the mail provider,
not the client, and not anything visible in the source of `routes/account.js` —
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
  `tokenHash`, never the assembled token — which is what lets a legacy
  `?uid=…&token=…` link still verify. That fallback (`linkCredentials` in
  `routes/account.js`) is **not dead code**: a verification mail is valid for
  24 h, so links in the pre-#434 shape were still sitting in inboxes at deploy
  time. Deleting it strands exactly the users who signed up just before a deploy.
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
assertion go red (and separately: stubbing out the legacy fallback reddens the
back-compat tests, and dropping the version check reddens the cross-token one).
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
