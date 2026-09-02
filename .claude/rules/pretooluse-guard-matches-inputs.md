---
paths:
  - ".claude/settings.json"
  - ".claude/hooks/**"
  - "test/guard-protected-paths.test.js"
---

# The data-prohibition hook matches tool INPUTS, never tool NAMES

`.claude/settings.json` wires `.claude/hooks/guard-protected-paths.js` as a
`PreToolUse` hook over matcher `"*"` (#880). It enforces the two absolute
prohibitions — `.claude/rules/no-reading-production-data.md` and
`.claude/rules/no-reading-env-files.md` — which until then were the only
invariants of that weight backed by prose alone.

## Why the matcher is `"*"` and not `"Read|Grep"`

The obvious wiring is a tool-name list. It is the wrong one, twice over:

- **It is shape-blind.** `Read(file_path: 'data/data.json')` is denied while
  `Bash(command: 'cat data/data.json')` sails through — and the rules forbid
  `cat`/`grep`/`head` in the same breath as opening the file. Same family as
  `.claude/rules/source-scanning-guards-enumerate-shapes.md`: what varies is the
  syntax around the token, not the token.
- **It stops matching silently.** Rename a tool, add a new one, and the hook
  denies nothing while still reading as protection — which #880 itself named as
  *worse* than having no hook.

So the script ignores `tool_name` entirely and walks every string in
`tool_input`. A tool that does not exist yet is covered by construction.
`test/guard-protected-paths.test.js` pins `matcher === '*'`; narrowing it goes red.

## Two properties that fail silently if inverted

- **`NOT_A_PATH` is an EXCLUSION list, not an allowlist.** A tool shipping a new
  field name is scanned by default. The inverse fails *open*, which is the one
  outcome an absolute prohibition must not have — the allowlist-not-denylist
  lesson from `.claude/rules/ci-aggregate-gate.md`, pointed the other way because
  here the unenumerated case must be caught rather than let through.
- **The dataset patterns need their preceding-character guard.**
  `/data\/data\.json/` alone matches inside `.devdata/data.json` — the *sanctioned
  throwaway* dataset — so dropping `(?:^|[^\w.-])` blocks the very folder the rule
  tells sessions to use. That case is in the spec's ALLOW table for this reason.
- **`.env.example` must never read as `.env`.** The bare branch is
  `/\.env(?![\w.-])/`: `.` counts as a name character, so the committed template
  falls out while `.env.local` is caught by the branch above it.

## The tax it charges, and why it is the right side to err on

A Bash command that merely *mentions* a protected path is blocked even when it
reads nothing — a `perl -pi -e` that edits a file mentioning `data/data.json`, or
a `grep -rn` searching for the string. This bit during #880's own verification.

It is deliberate. Distinguishing "path as file operand" from "path inside a
quoted string" cannot be done reliably in shell, and every relaxation that looked
plausible opened a bypass (stripping heredoc bodies also lets `bash <<'EOF'
cat .env EOF` through). Both false-positive classes have a first-class
alternative — the **Write/Edit** tools for editing, **Grep** for searching, whose
`content`/`old_string`/`new_string`/`pattern` fields are exempt — so the hook
pushes toward the proper tool rather than toward a workaround that defeats it.

## What it is NOT

**A guardrail against accident and drift, not a sandbox.** An agent that means to
bypass it can `Write` a script and then run it; neither call carries a protected
path. Nothing can fix that from inside a `PreToolUse` hook, and claiming
otherwise would be the "reads as protection" failure one level up. What it does
remove is the *accidental* read — the class the near-miss in
`no-reading-production-data.md` actually was, where a mistyped launch-config name
silently fell through to the production one.

**Related:** `.claude/rules/no-reading-production-data.md` and
`.claude/rules/no-reading-env-files.md` (the prohibitions it enforces),
`.claude/rules/break-the-code-on-purpose.md` (six breaks, each reddening a named
test, are what this file's claims rest on), `claude-file-audit` criterion C-026.
