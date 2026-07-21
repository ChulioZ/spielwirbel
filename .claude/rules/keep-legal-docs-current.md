# Check every change against the legal documents — in BOTH directions

The repo ships real legal commitments: the Impressum + privacy policy rendered
by `lib/legal.js` (DE **and** EN, env-gated — #134/PR #308) and the internal
Art.-30 records under `docs/legal/` (`vvt.md`, `toms.md`, `dsar-process.md`,
`breach-process.md`). Nothing in CI diffs them against the code, so they drift
silently — and a drifted privacy policy is not a stale README: it is a wrong
public statement about personal-data processing (Art. 13 information duties,
Art. 5 Abs. 2 accountability).

**Rule:** when implementing a change (like the README check in
`keep-readme-current.md`, consciously, before committing), make TWO checks:

1. **Does the change make the legal documents stale?** Update them in the same
   branch/PR when the change
   - adds, swaps or removes a **processor/recipient** — hosting, database,
     object storage, mail, any third party the server *or the visitor's
     browser* is made to contact (hotlinked covers are the precedent, see
     `provider-cover-hotlinking.md`). Touch the policy's processor section,
     the "Weitergabe/Data sharing" recipient list (**both languages**), the
     affected `vvt.md` row **and** its AVV inventory;
   - stores a **new category of personal data** or changes a retention →
     policy section + `vvt.md` row;
   - adds **on-device storage** (cookie, localStorage, cache) → the § 25
     TDDDG inventory in the policy;
   - moves processing (provider, region) → the transfer statements.
2. **Is the change VALID against what the documents promise?** The published
   text is a ceiling. Check the change doesn't breach a stated commitment —
   "no analytics/tracking storage", "logs carry no message content"
   (`product-event-logging.md`), the named-recipients-only sharing claim,
   feedback deletion, the e-mail-free erasure record. If a feature needs more
   than the documents allow, the document change is *part of the feature* and
   ships with it — never silently after.

`test/legal.test.js` pins marker strings for every named processor (Railway,
Cloudflare, Brevo, Heinlein) — so *removing/renaming* one in the policy fails
loudly, but *adding* a processor in code without disclosing it fails no test.
Direction 1 is on you; when you add a processor, also add its marker there.

**Why:** added after #307 — the operator mailbox moved to Heinlein Hosting
(mailbox.org) with a concluded AVV, and nothing in the workflow prompted the
policy/VVT update; it surfaced only because the operator happened to ask.
`vvt.md`'s own header ("update both together when a data flow changes") said
it, but no rule enforced it at implementation time.
