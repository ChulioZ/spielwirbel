---
paths:
  - "lib/admin.js"
  - "lib/routes/admin.js"
  - "public/admin.html"
  - "public/js/pages/admin.js"
  - "test/admin.test.js"
---
# The operator moderation surface (#268/#273/#274/#275) — traps

`ADMIN_PASSWORD` turns on `/admin.html` + `/api/admin`: lookup/takedown/
redaction, account suspend/restore, GDPR export/erasure, the action log, the
Kennzahlen card. `lib/admin.js` · `lib/routes/admin.js` · `public/admin.html` +
`public/js/pages/admin.js`. Every trap below fails *silently* or *dangerously* if
undone.

**Two halves were split out** when this file reached 277 lines — each had its own
file set and changed independently of the rest:

- `.claude/rules/admin-cross-tenant-escape.md` — the RLS escape widens **reads
  only**, every operator write goes through the tenant path, and proving either
  needs a plain (non-superuser) role. Read that before touching `atx()`,
  `redactText`, `takedownImage`, `eraseAccount` or `exportTenant`.
- `.claude/rules/admin-kennzahlen-card.md` — `lib/status.js`, and the two generic
  sweeps that stop a secret or a personal-data field reaching the panel.

## 1. ADMIN_PASSWORD must never be AUTH_PASSWORD

`AUTH_PASSWORD` is known to the whole group; these powers are cross-tenant, so
sharing the value is privilege escalation for every member (same call
`user-accounts.md` made for `SESSION_SECRET`). And since the *signing* secret
may legitimately be a shared `SESSION_SECRET`, the admin HMAC payload is
**domain-separated** (`admin.` prefix, own token version `a1`, own cookie
`aid`, `sameSite=strict`). Drop the prefix and an app `sid` token becomes a
valid admin token whenever `SESSION_SECRET` is set. `test/admin.test.js`
asserts an app token is rejected.

## 2. Moderation methods are global on purpose — keep them out of TENANT_METHODS

`findImageOwner`, `takedownImage`, `logModeration`, `listModeration`,
`listUsers`, `exportTenant`/`eraseAccount` (#273),
`findRoundOwner`/`tenantSummary`/`roundContent`/`redactText`/
`moderationActions` (#275) and `instanceMetrics` (#404) are **absent** from
`TENANT_METHODS` (`lib/repo/index.js`). That absence is the enforcement:
handlers only hold `req.repo`, so they cannot reach cross-tenant methods.
Since #419 the admin-gated `lib/routes/admin.js` is no longer the *only* caller of
the module-level repo: `lib/routes/account.js` reaches `eraseAccount`,
`tenantSummary` and `exportAccountData` for **self-service** deletion/export —
that is safe because every such call is bound to the authenticated caller's
own uid/tenant behind `requireUser` plus a password re-auth, never to a
request-supplied id. The invariant is therefore: a global repo method is
reachable outside `lib/routes/admin.js` **only when bound to the caller's own
account**. Adding one
to `TENANT_METHODS` would both break it (no tenant argument) and expose
cross-tenant reads to every route. Also: `listUsers()` returns the raw stored
user shape **including secrets** — `lib/routes/admin.js` projects it down to the
safe fields; never respond with it directly.

## 3. Redaction blanks TEXT; it must never delete a row

`redactText` overwrites one field with the fixed marker `'[entfernt]'` and
returns the previous value.

- A tag is redacted by **name only — its id survives** (deleting or re-minting
  it would strip the tag from every `game.tagIds`; the contract suite asserts
  id and references untouched).
- The replacement is **fixed, not operator-supplied** — free text would be a
  larger power than the one exercised, and an empty string reads like a bug.
- The original wording lives on the log entry (`previous`) and the CSV's
  `Vorher` column — after blanking it is the only remaining evidence, which is
  precisely what an Art. 17 statement of reasons must quote.

There are **no rating comments** (votes are numeric), so user-authored text is
exactly: round name, game title, member name, tag name, feedback message.
Feedback is global/un-scoped → it redacts by id alone, no tenant transaction.

## 4. Inclusive date bounds are load-bearing, and asymmetric

The log filter widens a bare `YYYY-MM-DD` in **opposite** directions: `from` →
`T00:00:00.000Z`, `to` → `T23:59:59.999Z` (a naive `at <= '2026-07-20'` hides
the whole 20th from the record backing Art. 17). The widening happens in the
ROUTE so both backends receive exact instants; `at` is compared as **text**
(ISO-8601 sorts lexicographically), so one malformed historical value can't
error the whole query. `countModeration` and `/log.csv` honour the same filter
— otherwise the card's "20 von 300" lies, and an export prepared for one
account silently widens to every tenant.

## 5. Per-tenant storage bytes are best-effort and capped

`storage.size(publicPath)` is guarded in `lib/storage/index.js` the same way
`remove()` is: both backends `path.basename()` the input, so a hotlinked
provider URL (#172) ending in `/pic123.jpg` would size **our** object of that
name and report a stranger's bytes. The route sizes at most `SIZE_SAMPLE_MAX`
(500) objects and reports `{ count, sized, bytes, complete }` so the panel can
render "≥" rather than a wrong total; unreadable objects are skipped.

## 6. Search-first Konten is a DATA-PROTECTION invariant, not a UI preference (#403)

The panel's tables are row-click → one shared native `<dialog>`, and the Konten
card fetches **nothing** until the operator searches. Three parts of that are
load-bearing and all three fail silently if "tidied up":

- **`enterPanel()` must NOT call `loadUsers()`.** Re-adding it looks like an
  obvious omission (every other card loads there) and quietly restores the thing
  the issue removed: `GET /api/admin/users` shipping **every** user's e-mail
  address to the browser on every panel visit, whatever the operator came to do
  (Art. 25 DSGVO, minimisation by default). The `userQuery === null` guard in
  `loadUsers()` is the second half of the same fence — it makes an accidental
  call a no-op rather than a full fetch.
- **An empty search box must not fall through to the unfiltered list.** `''` is
  the *deliberate* "Alle anzeigen" value, so a submit handler that just assigns
  `input.value.trim()` puts the whole address list one stray Enter away. The
  submit handler bails on an empty term; only the button sets `''`.
- **The filter is server-side (`?q=`), not a client-side `Array.filter`.** The
  point is that non-matching accounts' e-mail addresses never leave the server;
  filtering in the browser would satisfy the *UI* half and none of the privacy
  half. `test/admin.test.js` ("the account list can be filtered by ?q=") pins
  both the filtering and the unchanged no-`q` behaviour.

Two smaller things about the dialog itself:

- **Use `<dialog>` + `showModal()` here, NOT the SPA's `openSheet`.** `admin.html`
  is a standalone page — `views-round-detail.js` and `focus-trap.js` are not
  loaded, so `.claude/rules/accessibility-contrast-and-modals.md` §2's machinery
  simply isn't there. `showModal()` brings Esc, the backdrop, focus containment
  and **focus restoration to the opener** natively, which is why the rows are
  `tabIndex = 0` — a row that was never focusable would "restore" focus to
  `<body>`.
- **The row gets `tabindex` + `aria-haspopup="dialog"` + a keydown handler, never
  `role="button"`.** The role would detach the cells from their row for a screen
  reader (a `<td>` whose parent is no longer a `row`), trading a real semantic
  loss for an affordance the tabindex already provides. `aria-haspopup` is the
  part that must not be dropped: the rows *replaced* labelled per-row buttons, so
  without it a keyboard user tabs onto a focusable row with nothing announcing
  that Enter opens anything — a discoverability regression against the design it
  replaced, invisible to every automated check.
- **Actions close the dialog BEFORE running.** Every one of them either reloads
  the list underneath (leaving the dialog on a stale record) or scrolls to the
  Zuordnen card (`assignNotice`/`lookupUsername`), and a modal blocks the latter
  outright.

## Smaller things

- **Suspension is enforced in `lib/tenant.js`** (which already loads the user
  row per `/api` request), so it bites immediately rather than after the
  15-min access-token TTL. It also clears `refreshTokens`, so a suspended
  refresh answers `invalid_refresh_token`; the `account_disabled` guard in
  `lib/routes/account.js` stays as defence in depth.
- **Takedown clears the DB reference before deleting the bytes** — the reverse
  order leaves a permanently broken cover on partial failure. `cleared: 0` is
  reported honestly rather than as an error.
- **`admin.html` must be in `REWRITE_FILES` in `scripts/build.js`** or its
  `<script src>` 404s in a built production deploy — see
  `.claude/rules/frontend-build-cache-busting.md`.
- **The page is German-only, outside the i18n system** (operator tool,
  `login.html` precedent — no `lang/*.js` parity obligation), and links no web
  manifest, so it never becomes installable or offline-cached.
- **Deleting a Meldung / Feedback (#389): the retention guard is in the ROUTE,
  not the repo.** `deleteFeedback`/`deleteContactNotice` (both backends,
  un-scoped/no-RLS — no `atx()`/plain-role subtlety) remove *any* id; the
  contract suite pins that they delete even a decided notice, precisely to prove
  the guard is not baked into the store. `DELETE /api/admin/notices/:nid` reads
  the notice first and refuses a **decided** one (`decidedAt` set — Art. 17
  3-year retention evidence, §3’s reasoning) with **409 `notice_decided`** unless
  the operator passes **`?force=1`**. Don't move the guard into the repo (it
  would then also block the legitimate override and the retention purge #311) and
  don't drop the `decidedAt` check — deleting a decided notice silently defeats
  the published retention promise. Feedback carries no such duty (policy §11
  promises its deletion) and is freely deletable.
