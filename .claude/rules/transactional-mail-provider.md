# Transactional mail: the provider rewrites your message, and only the raw source shows it

`lib/mail.js` sends through **Scaleway Transactional Email** (fr-par) since #440.
It used to be Brevo. The switch was not about price or deliverability — it was
about what the provider silently did to every message on the way out, which
nothing in this repo could see and no test could catch.

## What Brevo did, and why it took a user report to find

Read off the raw source of a real production send (2026-07-25):

- **Injected two open-tracking pixels** (`https://…sendibt2.com/tr/op/…`), so it
  recorded per-recipient opens and the recipient's client disclosed its IP to a
  third party — on account-verification and password-reset mail.
- **Converted our `text/plain` body to `text/html`.** We only ever passed
  `textContent`; Brevo wrapped it in `<html><body>` and turned `\n` into `<br/>`.
- **Attached bulk-marketing headers** — `List-Unsubscribe`,
  `List-Unsubscribe-Post: One-Click`, `Feedback-ID`, `X-CSA-Complaints`. A
  one-click unsubscribe on a mail whose only purpose is confirming your own
  address.
- **Embedded the recipient's address in `X-Mailin-EID`**, base64-encoded — so a
  header dump that masks `To:` still leaks it.

None of it is disableable below Brevo's Enterprise tier; their staff answer is
that the redirects help them "identify potential compromises". Scaleway's API
exposes no tracking concept at all, which is a stronger guarantee than a setting
someone can flip back.

## The three things worth remembering

**1. Click tracking rewrites `<a href>` — so a bare text URL is accidentally
safe.** Our verification link arrived *unrewritten* under Brevo purely because
the body contained no anchors. That means "let's send a proper HTML mail with a
button" (#434) would have silently switched click tracking on for a
security-sensitive one-time link. If you ever add an HTML part, check what the
provider does to anchors **before** shipping it.

**2. A long URL breaks across a quoted-printable soft line break.** `Content-Transfer-Encoding:
quoted-printable` wraps at 76 columns, and our 108-character verification link
lands a `=`-terminated soft break mid-token:

```
…verify-email?uid=3De3c6fbf42291bfcc&token=3D0EdimFR=
JWyDONW54GoOtTrpXMao91AUQyVt4_-NA30U
```

A compliant client reassembles it, but a bare text URL then depends on the
client's auto-linkifier running across that break — and some don't, which is the
"link was cut in half" bug users report. **This is ours, not the provider's**: it
survived the migration unchanged. The fix is a link short enough to fit one QP
line (#434), not a provider change.

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

- **`SCW_SECRET_KEY` + `SCW_PROJECT_ID` are one setting.** A key without a
  project id is accepted by our config check's shape but rejected by the API, so
  `isConfigured()` and the admin status card both require the pair — otherwise
  the panel reports healthy mail that delivers nothing.
- **`SCW_REGION` defaults to `fr-par`** and is read per call, not at module load
  (same reasoning as `lib/app.js`'s rate-limit ceilings).
- **Scaleway has no reply-to field.** The contact form's `Reply-To` (#224) rides
  in `additional_headers` as `[{ key, value }]` — their own documented example.
  Get this wrong and replies to a contact message go to the no-reply sender
  instead of the visitor; `test/mail.test.js` pins the shape.
- **The IAM key needs only `TransactionalEmailEmailApiCreate`.** Not
  `…EmailFullAccess`: "full access to e-mails" includes *reading* them, and our
  sent messages contain live verification and reset tokens, so a leaked
  full-access key is account takeover rather than spam.
- **DNS**: SPF must be **merged** into the single existing record (two `v=spf1`
  records is a `permerror` that fails SPF for *every* sender), and the DMARC
  record Scaleway offers must **not** be added — we already have one, and two
  DMARC records means DMARC is not applied at all (RFC 7489 §6.6.3). Only the
  DKIM record is a genuine addition.

**Related:** `.claude/rules/keep-legal-docs-current.md` (the processor change
this drove through the policy + VVT), `.claude/rules/user-accounts.md` (the
outbox fallback the test suite depends on).
