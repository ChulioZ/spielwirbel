---
paths:
  - "lib/repo/**"
  - "lib/routes/admin.js"
  - "lib/routes/account.js"
  - "test/repo.postgres.test.js"
  - "test/admin.test.js"
---
# The moderation escape widens READS only — every operator write goes through the tenant path

Extracted from `.claude/rules/admin-moderation-surface.md` (#268/#273/#275),
which had grown to eleven sections over one surface. This is the half that is
really about **RLS**, and it is cited from `tenancy-rls.md`,
`round-grant-resolver.md`, `lib/tenant.js` and both migrations — so it now has a
name of its own rather than a section number those citations have to track.

Everything here fails **silently**: the SELECT succeeds, the write matches zero
rows, and the route reports success.

## 1. The escape is a separate `FOR SELECT` policy — never `OR`ed onto the existing one

Abuse lookups are inherently cross-tenant (a notice names an image, not a
tenant), so migration `20260720140000_moderation.js` admits
`current_setting('app.admin', true) = 'on'`, set transaction-locally by `atx()`
in `lib/repo/postgres.js`. The tempting shape — `OR` the flag into the existing
`FOR ALL` policy's `USING` clause — silently permits cross-tenant **`DELETE`**:
`DELETE` is governed by `USING` alone (there is no `WITH CHECK` for it).
Measured on a real DB: a cross-tenant `DELETE FROM games` under that shape
reports `rowCount 1`.

Correct shape (what the migration does): leave `<t>_tenant_isolation` untouched
and add a separate, additive `<t>_admin_read` policy that is **`FOR SELECT`
only**. Permissive policies OR-combine *per command*, so reads widen while
writes still consult only the tenant policy — read-only becomes structural, not
convention. `takedownImage` accordingly reads under `atx()` and writes through
the ordinary `tx(tenant, …)` path.

## 2. Erasure & export run tenant-scoped — the escape cannot delete

`exportTenant`/`eraseAccount` (#273) do **not** use `atx()`: resolving the
account yields its tenant, and for erasure the tenant path is *required* — a
`DELETE` inside `atx()` matches zero rows (§1), so `eraseAccount` would report
`rounds: 0` **while claiming success**: a legal erasure duty that quietly erases
nothing.

Also baked into erasure: it refuses with `'tenant_shared'` → 409 when a second
account shares the tenant (the no-undo mistake once tenant sharing #207 lands);
the log entry carries **no erased personal data** (account id, tenant, date,
reason, counts — the record outlives the erasure it evidences); the route demands
the account's own e-mail as `confirmEmail`, checked server-side.

## 3. Redaction: reads are cross-tenant, writes are NOT

`redactText`'s reads (`findRoundOwner`/`tenantSummary`/`roundContent`) are
genuinely cross-tenant, so doing the whole method inside `atx()` looks natural —
and produces the worst silent failure of the three: the SELECT succeeds, the
UPDATE matches zero rows, and because the return value derives from the row
*read*, the route logs a successful takedown **while the content stays live for
every user**. So `redactText` resolves the tenant under `atx()` and performs
every write via `tx(tenant, …)`, exactly like `takedownImage`.

`instanceMetrics` (#404) is the same trap in *read* form and is covered in
`.claude/rules/admin-kennzahlen-card.md`: it must read the round tables **under**
`atx()`, or a plain-role query returns 0 rows rather than an error and the panel
reports a healthy-looking zero.

## 4. Cross-tenant behaviour must be tested through a PLAIN ROLE

The contract suite's Postgres connection is a **superuser, which bypasses RLS
entirely** — its cross-tenant assertions pass even with the policies broken. The
probes that actually catch a break live in `test/repo.postgres.test.js` and run
through a dedicated non-superuser role:

- *"the moderation admin escape widens reads only, never writes"* — the flag
  widens SELECT but refuses cross-tenant INSERT/UPDATE/**DELETE** (the DELETE
  assertion pins §1's trap) and dies with the transaction.
- *"erasure deletes tenant rows as a non-superuser under FORCE RLS"* — §2.
- *"redaction writes tenant-scoped, never under the read-only admin escape"* —
  §3. This one runs **the repo method itself** as the plain role via a child
  process (`DATABASE_URL` pointed at the probe role — the knex is built at
  require time, so a child is the only way) and asserts the **stored value
  changed**, not merely that the call reported success.

**Rule:** any future operator write gets an end-to-end plain-role probe, not just
a hand-written-SQL policy probe.

### This section is the canonical home of the break-on-purpose discipline

Stated generally, because ~8 rules across the corpus cite it and none of them is
about RLS: **break the production code on purpose once and watch the probe fail.**
A test you have never seen red is not evidence — it may assert nothing, assert it
vacuously, or not be wired to the thing it names.

Verified here on #275: with `redactText` deliberately rewritten onto `atx()`,
everything except that one child-process assertion stayed green. The same loop has
since caught a vacuous landing-page assertion
(`.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md` §3) and a team
resolver whose test passed against the broken ordering
(`.claude/rules/session-teams.md` §4).

Two habits that go with it, both learned the hard way:

- **Confirm the break actually landed** (`grep -c` for what you removed) before
  reading a green suite as evidence — a `perl` pattern that guessed the wrong
  indentation once reported success while changing nothing.
- **Back the files up to the scratchpad first.** `git checkout <file>` restores
  from the *index*, so with nothing staged it silently discards the whole
  uncommitted change along with the break
  (`.claude/rules/css-text-assertions-strip-comments.md`).

**Related:** `.claude/rules/admin-moderation-surface.md` (the surface these
methods serve, and its remaining traps),
`.claude/rules/admin-kennzahlen-card.md` (the read-form version of §3),
`.claude/rules/tenancy-rls.md` (the tenant policies this must not touch, and the
two PostgreSQL facts a cross-tenant *write* would need),
`.claude/rules/erased-account-token-fallback.md` (the stateless token that
outlives the deleted row).
