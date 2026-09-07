# "Known and tracked by #N" is a claim to VERIFY, not a mitigation

<!-- scope: global — the trap surfaces when writing or reading any rule, criteria entry or code comment that defers a known weakness to an issue, whatever area that weakness is in. -->

Two files described the same accepted weakness — `/uploads` served any object to
any valid account — and both said it was covered:

```
.claude/rules/accounts-mode-gate.md   "Per-tenant /uploads isolation is still
                                       follow-up (#207/#137)"
security-audit/criteria.md  S-021     "Known and tracked — a *new* instance of
                                       the shape is the finding."
```

**#207 and #137 both closed without shipping it**, months earlier. Nothing
re-checked the attribution when they closed, and no *new* issue was opened —
so the exposure was simultaneously "tracked" and tracked by nothing, on a live
public multi-tenant instance. It took a whole audit domain sweep (#955) to
notice that the two issues the note pointed at were green ticks.

## Why this rots silently, and in the worst direction

- **The note reads as a decision, not as a to-do.** "Known and tracked" is the
  phrasing of something under control, so a reader stops there. That is the
  whole point of writing it — and it is exactly what makes a stale one dangerous.
- **The audit criterion actively suppresses the finding.** S-021 said a *new*
  instance of the shape is the finding, i.e. the note told every future audit to
  skip this one. A stale deferral does not merely fail to help; it disables the
  instrument that would otherwise find the problem.
- **Closing #N cannot notice.** The issue closes because *its own* scope shipped.
  Nothing links back from #207 to the four files that named it as their
  mitigation, and no test can see it: the code is correct-by-its-own-lights and
  the prose is what is wrong.

## The rule

**When you read a "tracked by #N" / "follow-up in #N" / "deferred to #N" note,
check #N before relying on it** — one `gh issue view <N> --json state`. If it is
closed and the weakness is still there, that is a finding *now*, whatever the
note says.

**When you write one, name what it is deferred to and make it real:** an OPEN
issue whose own scope is this weakness, not a neighbouring issue that merely
touches the area. "#207 will probably cover it" is how this one started. If no
such issue exists, open one in the same change — a deferral with no owner is
just an undocumented acceptance.

**When you CLOSE an issue, grep for it.** This is the cheap half and the one
nobody does:

```bash
grep -rn "#207" .claude/ docs/ lib/ public/ *.md
```

Any hit that describes #207 as *mitigating* something is now wrong and needs
either a re-point or a fresh issue, in that same moment.

**Related:** `.claude/rules/ops-only-changes-still-stale-the-docs.md` (the same
shape from the other direction — a change with no diff that nothing can catch),
`.claude/rules/token-friendly-source-files.md` (a move that invalidates a rule's
pointer; here it is a *status*, not a path, that goes stale),
`.claude/rules/accounts-mode-gate.md` and `.claude/skills/security-audit/criteria.md`
S-018/S-021 (the two notes this happened to).
