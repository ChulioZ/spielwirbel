# Legal criteria

- **last-researched:** 2026-07-24
- **cadence:** 90 days

Seeded 2026-07-23 from `.claude/rules/keep-legal-docs-current.md`, `docs/legal/`,
`lib/legal.js` and `test/legal.test.js` — **not** from research.

## This list holds consistency checks, not legal opinions

Every criterion below is **mechanically checkable against this repo**: does the
code contradict what the published documents promise, and do the internal records
still match the code? That is the half of a legal audit an agent can do well.

Research (phase B) produces a **reading list with sources and dates**, presented
to the user. It does **not** write criteria here. A new legal duty enters this
file only after the user explicitly says so — see L-R04. The reason is not
timidity: these documents are public statements about processing real people's
personal data, and a confidently wrong assertion about German or EU law is worse
than an acknowledged gap.

---

### L-001 — Every third party the *server* contacts is disclosed, in both languages
- **Status:** adopted · 2026-07-23
- **Source:** Art. 13, 30 GDPR · `keep-legal-docs-current.md` direction 1
- **Check:** Derive the real list from code — `package.json` runtime deps that open
  connections, `lib/mail.js`, `lib/storage/`, the `DATABASE_URL` host, `lib/providers/*`,
  the donation target. Each must appear in the policy's processor section **and** the
  recipient list in **both** DE and EN, with a `docs/legal/vvt.md` row and an AVV
  inventory entry. Currently disclosed: Railway, Cloudflare, Heinlein/mailbox.org,
  Ko-fi (+ Stripe, PayPal), BoardGameGeek. (Sony, Microsoft, Nintendo and Valve
  were recipients until #981 cleared the last hotlinked storefront covers.)
- **Enforced by:** `test/legal.test.js` pins markers for named processors — which catches
  *removing* one, never *adding* one in code. This direction is the manual half.

### L-002 — Every third party the *visitor's browser* is made to contact is disclosed
- **Status:** adopted · 2026-07-23
- **Source:** Art. 13 GDPR · `provider-cover-hotlinking.md`
- **Check:** Provider covers are hotlinked (#172), so the visitor's IP reaches Sony,
  BGG directly — and, until #981 cleared the last stored ones, the four
  storefront CDNs. Any new `IMAGE_HOSTS` entry, embed,
  iframe, remote font, CDN script or pixel adds a recipient. Cross-check the CSP
  `img-src`/`connect-src`/`script-src` in `lib/app.js` against the disclosed list — the
  CSP is the machine-readable inventory of who the browser may talk to.
- **Enforced by:** — (manual)

### L-003 — The on-device storage inventory matches reality
- **Status:** adopted · 2026-07-23
- **Source:** § 25 TDDDG
- **Check:** Grep `localStorage`, `sessionStorage`, `document.cookie`, `caches.open` and
  every `res.cookie` across `public/`, `lib/` and `lib/routes/`. Each item must appear in the
  policy's § 25 inventory with its purpose and lifetime. Known: the locale preference
  (`i18n.js`), account tokens (`core.js`, `account.js`), the `sa` access cookie, the
  admin `aid` cookie, and the service-worker shell cache.
- **Enforced by:** — (manual)

### L-004 — Every stored personal-data category has a policy section and a VVT row
- **Status:** adopted · 2026-07-23
- **Source:** Art. 13, 30 GDPR
- **Check:** Walk the schema (users, members, feedback with its opt-in `context.email`,
  contact notices, the moderation log) and confirm each category, its legal basis and its
  retention appear in both the policy and `docs/legal/vvt.md`. A new column or a new
  free-text field is the usual trigger.
- **Enforced by:** — (manual)

### L-005 — The code does not breach a commitment the documents make
- **Status:** adopted · 2026-07-23
- **Source:** `keep-legal-docs-current.md` direction 2 · Art. 5(2) GDPR
- **Check:** The published text is a ceiling. Verify against code, not intent:
  no analytics or tracking storage; `trackEvent`'s field allowlist still refuses anything
  beyond `event` + `tenantId`; `requestLogger` still logs no bodies, query strings,
  headers or cookies (check `customProps` AND `customSuccessObject`/`customErrorObject`,
  which carry four of the five fields); feedback deletion works; erasure leaves an e-mail-free
  record; sharing stays limited to the named recipients.
- **Enforced by:** partially — `test/status.test.js` sweeps secrets out of the admin
  status response; the logging allowlists are manual.

### L-006 — DE/EN parity, and a test marker per named processor
- **Status:** adopted · 2026-07-23
- **Source:** `keep-legal-docs-current.md`
- **Check:** Every section exists in both languages and says the same thing — a processor
  disclosed only in German is not disclosed. Every named processor has a marker string in
  `test/legal.test.js` so renaming or dropping it fails loudly.
- **Enforced by:** `test/legal.test.js` (markers) · parity is manual

### L-007 — No trigger for a minimum-age clause has appeared
- **Status:** adopted · 2026-07-23
- **Source:** `keep-legal-docs-current.md` (operator decision 2026-07-21, #140)
- **Check:** The Nutzungsbedingungen carry no age clause on purpose. Re-evaluate — in the
  same change — if any of these appears: **consent-based processing** (tracking, ads,
  newsletter, any Art. 6(1)(a) purpose), a **paid tier** (§§ 104 ff. BGB), **public
  dissemination of user content** (public rounds/sharing moves the service toward the DSA
  platform tier and Art. 28's minors duties), or **child-directed features**.

  **"Sign-in-gated" is not a dissemination barrier here** (added 2026-08-04, first applied
  to the #558 profiles). `DEMO_ENABLED` has been on in production since 2026-07-27 (#427),
  so any visitor gets a seeded, fully writable account **in one request, without
  registering** — a gate that anyone can walk through on demand keeps nothing out. So when
  judging whether a surface counts as public dissemination, weigh **how thin the disclosed
  data is**, never the fact that a login sits in front of it. An argument of the form "only
  logged-in users can see it" is invalid on this instance and should be treated as a
  finding in its own right if a document leans on it.
- **Enforced by:** — (manual)

### L-008 — The internal records still describe the running system
- **Status:** adopted · 2026-07-23
- **Source:** Art. 5(2), 30, 32 GDPR · DSA
- **Check:** `retention.md` against implemented retention (the 3-year moderation-log purge
  is still manual — #311); `dsar-process.md` against the admin export/erasure routes;
  `notice-and-action.md` against the actual notice workflow and the operator inbox;
  `toms.md` against the security measures really in place; `breach-process.md` against who
  and what exists today.
- **Enforced by:** — (manual)

### L-009 — The legal surface fails closed
- **Status:** adopted · 2026-07-23
- **Source:** § 5 DDG · `.claude/rules/` (env-gating pattern)
- **Check:** `/impressum`, `/datenschutz` and `/nutzungsbedingungen` 404 until
  `IMPRESSUM_ADDRESS` **and** `IMPRESSUM_EMAIL` are both set — one alone must not produce a
  partial Impressum. A half-configured deploy must never publish an incomplete identity.
- **Enforced by:** `test/legal.test.js`

### L-010 — Citations name law that is actually in force
- **Status:** adopted · 2026-07-23
- **Source:** `test/legal.test.js`
- **Check:** The Impressum cites **§ 5 DDG**, never the repealed TMG. Any GDPR/DSA article
  reference resolves to the article it claims. A repealed or renumbered citation is a
  finding even when the substance is right.
- **Enforced by:** `test/legal.test.js` (DDG/TMG)

### L-011 — Stated processing locations match the deployment
- **Status:** adopted · 2026-07-23
- **Source:** Art. 13(1)(f), 44 ff. GDPR
- **Check:** The transfer statements must match where the services actually run. This has
  been wrong before: the Postgres service sat in a **US region under an EU app** until
  2026-07-20 (`railway-db-same-region.md`) — a performance bug *and* an undisclosed
  transfer. Re-verify the region of every Railway service and the R2 bucket, not just the
  app's. Also confirm the EU-US Data Privacy Framework adequacy decision still
  stands — the Cloudflare transfer statement leans on it, with SCCs as fallback
  (General Court upheld it 2025-09, *Latombe*; appeal C-703/25 P pending as of
  2026-07-24).
- **Enforced by:** — (manual; check the platform, not the code)

### L-012 — Donations stay unconditional
- **Status:** adopted · 2026-07-23
- **Source:** operator decision (#173, 2026-07-22)
- **Check:** No feature, quota, tier or badge is gated behind donating. The moment one is,
  the service has a paid tier — which pulls in consumer-contract duties, Widerruf, and the
  L-007 age question at once. This is a legal-shape criterion, not a product preference.
- **Enforced by:** — (manual)

### L-013 — Erasure and export reach every store that holds account data
- **Status:** adopted · 2026-09-12
- **Source:** Art. 17, 15, 20 GDPR · #1036
- **Check:** `eraseAccount` and `exportAccountData` (`lib/repo/postgres.js`, and their
  siblings in `lib/repo/json.js`) name the global, non-RLS stores **one at a time**. The
  repo has added five global tables since the initial schema, and a sixth arriving with no
  disposition is total silence: no error, no red test, an erasure that reports success
  while leaving rows behind, and an export that under-answers an Art. 15 request. The
  check is therefore mechanical: derive the live table list, split it by whether the table
  carries `tenant_id`, and require every global one to be erased, exported, or named in a
  reasoned exclusion list. The exclusion list is the load-bearing half — it is what makes
  a *new* table a failure rather than a default pass.
- **Enforced by:** `test/erasure-completeness.test.js` (runs in the `postgres` CI job)

### L-014 — Every stored field is necessary, not merely disclosed
- **Status:** adopted · 2026-09-12 · **judgement, no test possible**
- **Source:** Art. 5(1)(c) GDPR
- **Check:** Every other criterion here asks whether a field is *disclosed*; none asks
  whether it is *needed*. A field fully documented in `docs/legal/vvt.md` and required by
  nobody passes the whole suite. Walk the schema and the `data` JSONB shapes and, per
  field, ask what breaks if it were not stored — then compare against the purpose its VVT
  row states. "It might be useful later" is the finding. Likeliest candidates, so a run
  starts somewhere rather than sweeping open-ended: free-text fields, imported third-party
  payloads (the BGG collection/wishlist import, #481), and anything retained after the
  feature that wrote it was removed (#744's retired storefront `source` links are the
  worked example — #981).
- **Enforced by:** — (manual)

### L-015 — Art. 32 measures are verified against the platform, not read back
- **Status:** adopted · 2026-09-12
- **Source:** Art. 32 GDPR · `.claude/rules/ops-only-changes-still-stale-the-docs.md`
- **Check:** L-008 reads `docs/legal/toms.md` "against the security measures really in
  place", which in practice is prose against prose — and it has burned once: `toms.md`
  claimed platform backups from the day it was written while the Railway project had
  **none configured at all** (found 2026-08-04). So each claim gets a stated verification
  route, and the route matters more than the claim: backups and their real window
  (Railway dashboard — and beware reading the PITR window too early, it only grows until
  the first truncation, `.claude/rules/railway-postgres-floating-major.md`), encryption at
  rest (Railway Postgres, R2), TLS, access control and whether the app's DB role is a
  superuser, `ipHash` pseudonymisation (code), and the deployment regions of every service
  (dashboard, cf. L-011). A **platform-side** claim is the one no commit can touch, so it
  is the one that rots.
- **Enforced by:** — (manual; platform-side by construction)

### L-016 — No personal data reaches a derived or public surface undeclared
- **Status:** adopted · 2026-09-12
- **Source:** Art. 5(1)(a), 6, 13 GDPR
- **Check:** S-017 covers logs only. Enumerate the surfaces that publish anything
  *computed* from tenant data and state, per surface, whether a **structural guarantee**
  exists or only a convention: `lib/public-stats.js` (the landing page and `/entdecken` —
  the one with a real guarantee, that no user-authored byte reaches the payload because
  titles and covers resolve from the provider; its header documents it and the criterion's
  job is to check it still holds), `feed_events` and its allowlist, shared vote links
  (#652), public profiles (#558), and the recap/share text. A surface leaning on "only
  logged-in users can see it" is a finding: L-007 already records that as invalid on this
  instance, since `DEMO_ENABLED` has been on since 2026-07-27 and an unauthenticated
  visitor reaches the authenticated surface in one request.
- **Enforced by:** — (manual)

---

## Rejected — settled, do not re-litigate

### L-R01 — "Add AGB and a Widerrufsbelehrung"
- **Status:** rejected · 2026-07-23
- **Why:** Decided in #140 (2026-07-21). The service is free and donation-funded, so there
  is no paid consumer contract to withdraw from. Reopens only if L-012 falls.

### L-R02 — "Add a minimum-age clause to the Nutzungsbedingungen"
- **Status:** rejected · 2026-07-23
- **Why:** Decided in #140 with reasoning on three legs: no consent-based processing (so
  Art. 8 GDPR's 16-year consent age never triggers), a DSA *hosting* service whose tenant
  content is not disseminated to the public (so Art. 28's platform minors-duties do not
  apply), and children join as name-only members without accounts. Each leg is a trigger —
  tracked as L-007, not as an open question.

### L-R03 — "Add a cookie/consent banner"
- **Status:** rejected · 2026-07-23
- **Why:** § 25(2) TDDDG exempts storage strictly necessary for the service the user
  requested, and that is all this app stores: auth tokens, a locale preference, the PWA
  shell cache. There is no analytics, no ads, no third-party script. A banner would ask
  for consent that is neither needed nor legally meaningful. Verify the *inventory* each
  run (L-003) rather than the conclusion — the conclusion changes only if something
  non-necessary appears.

### L-R04 — "Adopt researched legal duties into this file automatically"
- **Status:** rejected · 2026-07-23 — **meta-criterion, do not remove**
- **Why:** Operator decision when this skill was built. Research output is a reading list
  with sources, for the user to judge. An agent is not a lawyer, web results on German and
  EU law are of wildly uneven reliability, and the artefacts here are public statements
  about real personal data. A wrong criterion adopted silently would generate confident,
  wrong issues against a live service.

### L-R05 — "Adopt BFSG/EAA accessibility duties as legal criteria"
- **Status:** rejected · 2026-07-24
- **Why:** § 3 Abs. 3 BFSG exempts service-providing microenterprises (<10 heads,
  ≤€2M turnover), which covers this solo-operated, donation-funded service — so no
  binding accessibility duty attaches today. Accessibility stays covered by the
  dedicated `accessibility-audit` skill on product merits (WCAG 2.2 AA as the bar;
  its side of this decision is A-R05). Re-open if the operator grows past the
  thresholds, a paid tier changes the classification, or the EAA/EN 301 549
  harmonisation (V4.1.1 expected in the OJEU ~Oct 2026) shifts the applicability
  analysis.

### L-R06 — "Add a standalone data-protection-audit domain"
- **Status:** rejected · 2026-09-12
- **Why:** Considered in #1036 for the four checks above and rejected: a seventh domain
  would re-derive `legal-audit`'s recipient/category/retention method wholesale, add a
  seventh pass to every `/audit` sweep, and split the remedy from the documents it
  changes. Data protection **is** this skill's domain — L-001/L-002 (recipients), L-003
  (§ 25 TDDDG storage), L-004 (categories, basis, retention → VVT), L-005 (code breaches a
  promise), L-008 (internal records), L-011 (transfer locations) — and L-013…L-016 are
  criteria in it, not a domain beside it.
