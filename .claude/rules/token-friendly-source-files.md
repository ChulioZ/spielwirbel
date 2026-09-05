# Keep source files token-friendly for agentic editing

<!-- scope: global — a discipline for every file added, moved or renamed -->

Agents pay tokens every time they read or edit a file. A file that must be loaded
whole for a one-line change, that hides the right spot, that repeats boilerplate,
or that has its own idiosyncratic shape makes every routine change slower and more
expensive. Keep new and changed files cheap to work with along four dimensions —
**token-first, within reason** (accept a minor human-readability cost, but never
break an existing `.claude/rules/` constraint or change runtime behavior to save
tokens):

- **Read/edit size — one file, one concern.** Prefer a file an agent can load
  whole cheaply. When a file grows to cover several *independent* concerns (each
  editable without touching the others), that is the signal to split it along
  those seams, not line count alone. A large file that is a *single* cohesive
  flow (e.g. `views-session.js`: start → vote → finale → results) or a flat data
  table (`lang/*.js`) is fine — splitting it only adds indirection. Rough smell:
  a view/router file past ~700 lines that mixes unrelated screens.
- **Locating code — make the spot findable.** Order related code together, name
  `show*`/`render*`/`parse*` functions for what they do, and keep one predictable
  shape per file so an agent greps to the edit instead of reading the whole file.
- **Verbosity — comments must carry signal.** Explain *why* (a gotcha, a
  constraint, a non-obvious choice), not *what* the next line already says. Don't
  add boilerplate that inflates every read without adding information. The current
  code already does this well — keep it that way.
- **Consistency — one shape, generalized once.** Match the established patterns so
  an agent learns the shape once and reuses it: `lib/routes/*.js` (`'use strict'`,
  header comment, data access via `req.repo`, an `express.Router`), providers
  (`search`/`detail` + pure `parse*` exports), and the frontend `show*` view
  convention. A new file that invents its own layout costs a re-learn every visit.

**Splitting a `public/js` file is not free — respect the load order.** These are
classic `<script>`s over one shared global scope; a split adds a new file that
must be inserted in `index.html` at the right point, added to the `globals` list
in `eslint.config.js`, and kept clear of the load-order trap (see
`frontend-script-load-order.md` and `eslint-frontend-shared-scope.md`). Split
when the concern boundary is real, not reflexively by size.

**Moving or renaming code also invalidates any RULE that cites its old home** —
and changing a **value** does the same to whatever states it as a premise.
`.claude/rules/**` is full of precise pointers (`lib/routes/rounds.js` `gameCount`,
`core.js` `gameStats`, …), and those pointers are what make a rule actionable —
so a move turns the rule into a wrong map without touching a line of it. Nothing
catches it: the code still works, every test stays green, and the rule still
*reads* authoritative.

It has happened. #301's summary-read work moved `gameCount` out of
`lib/routes/rounds.js` into `listRoundSummaries` in both repo backends;
`active-games-filter-sites.md` kept naming the route file, and that rule exists
precisely to enumerate the filter sites — so the one pointer it got wrong was the
one a future session most needed. Nobody looked, because #301 was a *performance*
change while the rule is about *archived-game filtering*: **the rule a move
invalidates is usually on a different topic than the PR doing the moving**, which
is why it never occurs to anyone to check.

So when you move or rename a function, `const` or file — or change a **value**
another file's prose cites — grep for the old name across source and docs, not
just the rules, and fix every hit in the same PR:

```bash
grep -rn --exclude-dir=node_modules --exclude-dir=worktrees \
  "gameCount\|min(85vh, 660px)" .claude/ lib/ public/ docs/ *.md
```

**The class `.claude/rules/` alone misses is a code comment citing a value or
invariant owned by another file.** #678 moved `.sheet`'s `max-height` off
`min(85vh, 660px)`, and two places held that value as a load-bearing premise:
`.claude/rules/overlay-page-lock.md`, which the narrow grep finds, and
`public/js/page-lock.js`'s header comment, where it is the justification for the
whole module — found only by accident, via a hit inside a stale
`.claude/worktrees/` checkout. A comment reads as documentation, so nobody greps
it, and nothing can go red over it.

`test/skills.test.js` catches a moved **file** — it asserts every repo path cited
in `.claude/rules/`, `.claude/skills/` or the five root docs still exists. It
cannot see a moved **function**, a stale value, or anything cited from a source
comment (wrong file set, and it checks paths only), so that grep is on you. It is also a
bullet in `implement`'s review phase, because the rule was already right and got
skipped anyway — the adherence-failure remedy is a check that cannot be skipped,
not a reworded rule.

## The budget is a signal, not a ceiling — `test/token-budget.test.js`

Everything above is a **judgement**, so nothing can assert it. What *can* be
asserted is that a file crossed a threshold **without anyone noticing**, which is
the failure that actually happens: between the 90-day `M-001` audits, a file
could double with no signal at all.

So there is a budget per file class, plus an allowlist where each entry carries a
written reason:

| Class | Budget | Where the number comes from |
|---|---|---|
| source (`lib/` incl. `lib/routes/`, `public/js/`, `scripts/`, `test/`, `server.js`) | **700** | the "rough smell" above |
| a rule file | **150** | half of `CLAUDE.md`'s ~200 (a one-learning file should never be the larger document) |
| a `SKILL.md` | **250** | loaded whole on invocation |
| `CLAUDE.md` | **200** | the harness's own adherence guidance |

Three things about that shape are deliberate:

- **Crossing the budget is not a failure — crossing it silently is.** The remedy
  for a red test is the seam test, and if the file is genuinely one concern, the
  allowlist entry *is* the answer. Trimming a file to hit a number, at the cost of
  a `why` comment or a load-bearing constraint, is the outcome this rule exists to
  prevent, not to cause.
- **Allowlist entries are `judged` or `recorded`**, and the test cannot tell them
  apart. `recorded` means "over budget, nobody has applied the seam test yet" —
  writing that down is the whole point, because otherwise it is indistinguishable
  from "this one is fine". They are `M-001`'s worklist.
- **An entry must stay over budget or be removed.** A file that shrinks back under
  its budget fails the test until its entry goes, so the list cannot rot into
  names nobody has looked at — the anti-vacuous half, and the reason the list is
  worth trusting at all.

`public/js/lang/**` is excluded outright rather than allowlisted: it is the
flat-data-table case, so it is not an outlier to record. `criteria.md` files are
excluded for the same reason — a catalogue of independent entries.

**Why:** the codebase was assessed against these four dimensions (issue #38). The
backend (`lib/routes/`, the rest of `lib/`, providers) and most frontend files were already
token-friendly. The one clear outlier was `public/js/views-round.js` (~2237
lines spanning ten unrelated screens — a one-line change forced loading
everything). It has since been split along its real seams into `views-round.js`
(hub + Start), `views-round-tabs.js`, `views-round-detail.js` and
`views-round-lookup.js`; this rule keeps future files from regrowing the
pattern.

**`views-round-tabs.js` then regrew it and was split again (#528)** — 1120 lines
at the time the issue was filed, 1340 by the time it was picked up. Worth knowing
because it is the same file twice: the first split moved four screens *out* of
`views-round.js` into one sibling, which is a smaller unit than the original but
still four independently-edited concerns. It is now one file per hub tab
(`views-regal.js`, `views-chronik.js`, `views-pokale.js`) plus `views-archive.js`
for the three off-shelf screens, plus `views-round-actions.js` for the two
sheets whose entry points #561 had already moved to Einstellungen
(`showTransferGames`, `showInvite`) while their markup stayed behind. **A split that lands the parts in one new
file rather than one per seam only defers the budget** — the seam test asks
whether the *parts* are independently editable, not whether the result is smaller
than what you started with.

**`views-round.js` was split a third time by #923**, and this one is the pattern
working as intended rather than a regrowth: the file sat at 549 lines, well under
budget, and the Start tab's six new modules would have pushed it past 900. The
seam was the one its own header already named — the hub SHELL (`showRound`, the
tab strip, the round-name editor) versus the Start TAB's content — so
`views-round-start.js` took the tab and the shell dropped to 231 lines. Worth
recording because the budget was not yet red: applying the seam test *before* the
test forces you to is what keeps the split along a real boundary instead of
wherever the line count happens to land.
