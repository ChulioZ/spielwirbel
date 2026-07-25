# Transactional mail: two provider moves in one day, and what each one taught

`lib/mail.js` sends through **Mailjet** (Send API v3.1) since #440. It went
Brevo → Scaleway → Mailjet in a single day, and both moves were driven by things
invisible from inside this repo — one by what the provider silently *added* to
every message, the other by what the provider silently *lacked*.

**Why Mailjet and not the other two:** Brevo forces an open-tracking pixel and
bulk-marketing headers onto transactional mail with no way to disable them below
Enterprise. Scaleway adds nothing at all — ideal — but is **not a member of the
Certified Senders Alliance**, and its mail landed in the GMX spam folder.
Mailjet is CSA-certified *and* exposes per-message tracking switches, so it is
the only one of the three that does not force a trade between deliverability and
privacy. `lib/mail.js` sends `TrackOpens`/`TrackClicks: 'disabled'` on **every**
message rather than relying on the account default, so a dashboard change cannot
silently reintroduce tracking; switch it off at account level too.

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

## CSA membership is a hard deliverability fact for a German app

The **Certified Senders Alliance** (eco + DDV) is a German whitelist. Certified
senders' mail **bypasses the receiving ISP's spam filter entirely** at
participating providers, which include **GMX, Web.de, 1&1, Freenet and Yahoo**.
Gmail and Microsoft (outlook.com, live.de, hotmail.de) deliberately do **not**
participate.

Measured on 2026-07-25 with a domain about six days old:

| Recipient | Brevo (CSA) | Scaleway (no CSA) |
|---|---|---|
| Gmail (operator's own) | inbox | inbox |
| mailbox.org | inbox | **554 rejected as spam** |
| mail-tester | — | **10/10**, auth clean, no blocklist |
| GMX | untested | **spam** |
| live.de (Microsoft) | **spam** | — |

The 10/10 matters: nothing was wrong with the *message*. A clean, authenticated,
unremarkable mail still lands in GMX spam if the sender has no standing.

Two consequences worth keeping:

- **CSA is held by the ESP, not by you.** You cannot certify your own domain —
  the only lever is choosing a certified ESP. So it is a provider-selection
  criterion, and for a German-language product it outranks most others.
- **It fixes nothing at Microsoft or Gmail.** Those need domain age and
  engagement under any provider. The original user report (spam at live.de,
  under CSA-certified Brevo) is exactly that case — don't read it as a provider
  failure.

## `X-CSA-Complaints` and `List-Unsubscribe` are NOT spam signals

Worth stating because it was got wrong twice in opposite directions during #440.
Brevo's transactional mail carried `List-Unsubscribe`, `List-Unsubscribe-Post:
One-Click`, `Feedback-ID` and `X-CSA-Complaints`, and these were first read as a
"bulk-marketing profile" causing spam placement. They are not:
`X-CSA-Complaints` is the CSA **certification marker**, an asset at participating
providers, and one-click `List-Unsubscribe` is *required* by CSA rules and by
Gmail's and Yahoo's bulk-sender requirements.

Then mail-tester flagged their **absence** as an improvement point. Also ignore
that: `List-Unsubscribe` is a bulk-mail affordance, we are far below any bulk
threshold, and offering an unsubscribe link on the mail confirming someone's own
address is nonsense. It cost **zero** points (10/10 without it). **Do not add
`List-Unsubscribe` to transactional mail.**

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

- **`MJ_APIKEY_PUBLIC` + `MJ_APIKEY_PRIVATE` are one setting.** Mailjet
  authenticates the Send API with a key **pair** over HTTP Basic
  (`base64(public:private)`), so a single key is not a working configuration.
  `isConfigured()` and the admin status card both require the pair — otherwise
  the panel reports healthy mail that delivers nothing.
- **Tracking is disabled per message, not just per account.** `TrackOpens` and
  `TrackClicks` are sent as `'disabled'` on every send. The account-level switch
  should be off as well: belt and braces, because the account setting is the one
  that survives a mistake in the code, and the code is the one that survives a
  mistake in the dashboard. `test/mail.test.js` pins both flags — if that test is
  ever "tidied away", tracking can return silently and #439's disclosure gap
  reopens.
- **Mailjet has a first-class `ReplyTo`** (`{ Email }`), unlike Scaleway, which
  needed `additional_headers`. The contact form (#224) depends on it; get it
  wrong and replies go to the no-reply sender instead of the visitor.
- **Scaleway's implicit-MX gap, for the record.** Scaleway refused to deliver to
  any domain publishing only an A record and no MX — RFC 5321 §5.1 requires
  treating the A record as an implicit MX, and most MTAs do. It surfaced as
  `-1 send email to <host>: non-existing domain or no MX found`. Check this if a
  future provider is evaluated; it silently excludes small self-hosted
  recipients.
- **DNS**: SPF must be **merged** into the single existing record (two `v=spf1`
  records is a `permerror` that fails SPF for *every* sender), and a DMARC record
  the provider offers must **not** be added — we already have one, and two DMARC
  records means DMARC is not applied at all (RFC 7489 §6.6.3). Only DKIM is a
  genuine addition. Remove the old provider's `include:` and DKIM records only
  **after** the new one is verified — they are the rollback.

**Related:** `.claude/rules/keep-legal-docs-current.md` (the processor change
this drove through the policy + VVT), `.claude/rules/user-accounts.md` (the
outbox fallback the test suite depends on).
