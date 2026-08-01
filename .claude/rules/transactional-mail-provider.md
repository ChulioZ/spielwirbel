---
paths:
  - "lib/mail.js"
  - "lib/routes/account.js"
  - "test/mail.test.js"
---
# Transactional mail: three providers in one day, and why it ended at plain SMTP

`lib/mail.js` submits over **plain SMTP via nodemailer** since #440 — in
production through the operator's own mailbox at mailbox.org. It went
Brevo → Scaleway → mailbox.org in a single day. The env vars are deliberately
provider-neutral (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`) so a fourth move needs no
rename.

| Provider | Why it lost |
|---|---|
| **Brevo** | Injects an open-tracking pixel and bulk-marketing headers into transactional mail; **not disableable** below Enterprise. An undisclosed processing (#439). |
| **Scaleway** | Tracks nothing — but **not CSA-certified**, and its mail landed in the **GMX spam folder** while scoring 10/10 on mail-tester. Also refuses domains with no MX (see below). |
| **mailbox.org SMTP** | **Chosen.** GMX inbox, SPF *and* DKIM aligned on our own domain, and it adds **no processor at all** — the AVV already exists for the operator mailbox. |

The decisive argument was not deliverability but the processor count: mailbox.org
is the only option that made `vvt.md` row 5 *shrink* — it collapses into the
existing Heinlein entry, and policy §9 no longer names a delivery provider.
A mailbox host also cannot inject tracking: there is no feature to switch off,
which is a stronger guarantee than a setting.

**What was given up, knowingly:** no delivery webhooks (a hard bounce arrives as
an ordinary DSN e-mail in the operator's mailbox instead — #442 was closed for
this), a few hundred ms more latency because the send is awaited in the request
path, and no headroom beyond a mailbox account's sending limits.

## The three things worth remembering

**1. Click tracking rewrites `<a href>` — so a bare text URL is accidentally
safe.** Our verification link arrived *unrewritten* under Brevo purely because
the body contained no anchors. That means "let's send a proper HTML mail with a
button" (#434) would have silently switched click tracking on for a
security-sensitive one-time link. If you ever add an HTML part, check what the
provider does to anchors **before** shipping it.

**2. A long URL breaks across a quoted-printable soft line break — FIXED in #434,
and the constraint is permanent.** `Content-Transfer-Encoding: quoted-printable`
wraps at 76 columns, and the pre-#434 108-character verification link landed a
`=`-terminated soft break mid-token, so clients whose auto-linkifier doesn't run
across the break showed the link "cut in half". **That was ours, not the
provider's** — it survived all three migrations unchanged, which is why no
provider change could have fixed it.

The link is now 70 characters (`/v?t=v1.<uid>.<secret>`, `lib/routes/account.js`) and
`test/account.test.js` pins every mailed line at ≤75 characters. Anything that
lengthens one of these links re-breaks it — the full budget, the reasoning behind
the shortened token, and how to verify a real send live in
`.claude/rules/mailed-links-must-fit-one-qp-line.md`. Read that before touching
the link shape.

**3. `curl -I` cannot see any of this.** The pixel, the headers and the rewriting
are all in the message body/headers as delivered, not in anything the server
exposes. The only diagnostic is **the raw source of a real send** — in Gmail,
⋮ → *Original anzeigen*. Same family as
`.claude/rules/link-preview-card.md` §5, where a `same-origin` CORP broke the
preview image while `curl` reported a healthy 200.

## Testing deliverability: mailing yourself proves nothing

The report that started this was a stranger's mail landing in spam. Our own test
registration to the operator's Gmail landed in the **inbox** — under Brevo *and*
under Scaleway. Gmail weights prior interaction with a sender domain heavily, and
the operator owns the domain, so a self-addressed test is a biased experiment
that cannot reproduce a cold recipient's placement.

Use a neutral cold recipient ([mail-tester.com](https://www.mail-tester.com)
itemises what costs points) if deliverability is the question. The #440 migration
was decided on the *other* grounds — no tracking, no bulk headers, both DMARC
legs aligned, body sent unmodified — precisely because the deliverability
question stayed unproven.

## Configuration notes

- **Railway blocks outbound SMTP below the Pro plan** (ports 25, 465, 587, 2525).
  This is a hard prerequisite for the whole approach — on Hobby the connection
  simply times out however correct the code is. Check the plan before assuming
  any SMTP provider is available.
- **Use an app password scoped to SMTP only.** mailbox.org's app passwords are
  protocol-scoped, so the credential in `SMTP_PASS` cannot read the mailbox over
  IMAP. Never the account password: an IMAP-capable secret in an env var would
  expose the operator's entire mailbox — DSA notices included — where an ESP's
  send-only API key exposed nothing but the ability to send.
- **`MAIL_FROM` must exist on the sending account.** mailbox.org refuses a From
  that is not one of the account's addresses or aliases (their anti-forgery rule
  since 2020-09-29). That same integration is what lets it DKIM-sign as
  `d=spielwirbel.app` rather than rewriting the header — verified on a live send:
  From, Return-Path and the signature all stay on our domain.
- **`secure` follows the port.** 465 is implicit TLS, 587 upgrades via STARTTLS.
  Getting it wrong against 465 hangs until the connection timeout instead of
  failing clearly.
- **Every phase is timeout-bounded**, because the send is awaited before the HTTP
  response — an unbounded connection would hold a registration open until the
  client gives up.
- **The transport is built per send, not memoized.** At a handful of messages a
  day a pool would be cold anyway, and a cached transport silently keeps stale
  credentials after an env change.
- **Never add an `html` part.** A `text/plain` body cannot carry a tracking pixel.
  #439/#440 exist because a provider injected one into HTML.

**Related:** `.claude/rules/mailed-links-must-fit-one-qp-line.md` (§2's fix, and
the one-line budget every mailed link must keep),
`.claude/rules/keep-legal-docs-current.md` (the processor change
this drove through the policy + VVT), `.claude/rules/user-accounts.md` (the
outbox fallback the test suite depends on).
