# Ship a feature, PROPOSE its adoption stat — the operator cannot see uptake otherwise

<!-- scope: global — the trap surfaces when a FEATURE ships, in whatever file that feature lives in, so a `paths:` scope on the admin panel would load this rule at exactly the moment it is no longer useful. -->

The operator panel's „Funktionsnutzung" card answers one question: **is any of
this being used?** Nothing else in the app answers it. The in-app surfaces are
per-round and tenant-scoped by construction, the public statistics block reports
four totals, and the only other route to "did passkeys land" is a database
console — which means, in practice, that nobody looks.

#1124 found the cost of that. Of everything shipped in the six months to
2026-09: passkeys (#418), the BGG collection import (#481), owned expansions
(#653), box owners, session guests (#532), teams (#575), shared vote links
(#652) and custom round tags (#238) — **not one had an uptake figure anywhere**.
Each had been built, tested, documented and announced; none could be measured.
Nothing was wrong with any of those PRs, which is the point: no step in the
workflow asked the question.

## The rule

**When a change ships a user-facing capability, ask whether the operator can see
whether anyone uses it.** If the only answer is "open a database console",
propose a „Funktionsnutzung" tile — naming the figure, its denominator, and
where it comes from.

**Propose, never add unasked.** Every tile costs a field in two backends, a case
in the repo contract, a render assertion and a permanent maintenance obligation.
The operator decides — same budget posture as the „Was ist neu" list in
`.claude/rules/keep-readme-current.md`, and for the same reason: a card that
grows a row per PR stops being read, and then it measures nothing at all.

Four constraints on what may be proposed:

- **Two shapes only.** A **limit** (`used / limit`, graded pill) or an
  **adoption share** (`n / total`, neutral pill). A bare count is what the card
  was cleaned of: „18 Runden" cannot be read without knowing how many rounds
  exist, and the operator is precisely the person who should not have to
  remember. **„Konten" is the single sanctioned exception** — site adoption has
  no population of would-be accounts to divide by — and it is named here so it
  stays an exception rather than becoming the precedent.
- **It must be computable from data that already exists.** A figure needing a
  new stored field, a `createdAt` backfill or a snapshot table is a separate
  decision with its own cost, not a rider on the feature's PR.
- **It must survive the demo filter and the two generic sweeps.** Demo tenants
  are excluded from every figure, and every leaf of `metrics` must be a plain
  number — a figure that wants to report *which* thing is most used would put
  user-authored text in the payload (`.claude/rules/admin-kennzahlen-card.md`).
- **Check which side of `atx()` the source table is on**, by reading its
  migration rather than guessing. An RLS-scoped table read outside the admin
  escape returns zero rows and no error, and zero is a perfectly plausible
  reading for an adoption figure — so the tile would report „nobody uses this"
  forever, on production only.

## Why this is a discipline and not a test

Nothing can detect the absence of a metric nobody asked for. The feature works,
its own tests pass, the panel renders, and the missing tile is invisible in every
direction — the `.claude/rules/ops-only-changes-still-stale-the-docs.md` shape,
one surface over. So it rides on `.claude/skills/implement/SKILL.md` §2, beside
the README and „Was ist neu" questions, and the default answer there is **no**:
most changes are fixes, tweaks and refactors, which have no uptake to measure.

**Related:** `.claude/rules/admin-kennzahlen-card.md` (the cards, the two tile
shapes and the sweeps), `.claude/rules/keep-readme-current.md` (the sibling
per-change question, and the budget argument this one borrows),
`.claude/rules/admin-moderation-surface.md` (the panel).
