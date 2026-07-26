---
name: ui-audit
description: >-
  Audit the app's visual design — colour, layout, spacing, typography, depth,
  iconography, imagery and motion polish — against a maintained criteria list, and
  drive it toward being genuinely beautiful and characterful while staying within
  the brand. Use when asked to improve the UI, make the app prettier/fancier/more
  polished/stunning, review the visual design, or tighten the look and feel. Plain
  UI only — never UX (no flows, steps, screen order or copy); accessibility is the
  accessibility-audit skill's job. Drives the real app in a browser over generated
  data. Produces a ranked report with before/after evidence; files issues only
  with your approval.
---

# UI audit

Two jobs: keep `criteria.md` current with what visual quality means for *this*
app, then judge the running UI against it and drive it toward something people
genuinely enjoy looking at — beautiful, polished, characterful — **within the
brand**.

**Read `.claude/skills/audit/audit-loop.md` first** — it owns the loop (research
gating, the critique test, how criteria change, the report format, and the rule
that findings only become issues with the user's approval). This file owns the
domain: what "good-looking" means here and how to see it truthfully.

Pass `--research` to force a research pass; otherwise the cadence in `criteria.md`
decides (90 days).

## The three fences (internalize these before anything else)

Everything this skill does lives inside three lines it must not cross. They are
the whole reason it can be trusted to touch a live product's look:

1. **Visual, never UX.** In scope: colour, layout, spacing, type, depth,
   radii/borders, iconography, imagery treatment, motion-as-polish, empty-state
   *visuals*. Out of scope: flows, step order, screen structure, navigation, what
   a control *does*, and copy/wording. Test: *does the fix change what the user
   sees, or what the user does?* Only the first is yours (U-R03).
2. **Evolution, never rebrand.** Stay within `--brand` (`#c2410c`), the 8 `THEMES`,
   and the `color-mix`-derived token families. The app must be recognizably itself
   tomorrow. Refine a ramp; never swap the palette or default to dark (U-R02, U-R05).
3. **Above the accessibility floor, always.** `accessibility-audit` owns contrast,
   focus, target size, ARIA, keyboard and reduced-motion *compliance*
   (A-001..A-016). Never re-report those, and never propose a change that would
   fail one of them — beauty is achieved *above* the floor, not by lowering it
   (U-R04).

The goal is *more* character executed well, not the trendy minimalism that would
flatten a warm, playful board-game app into generic SaaS (U-013).

## Research sources (phase B)

Ask what has moved in **visual** design since `last-researched`:

- **Design-system and craft references** — Refactoring UI's visual principles
  (hierarchy, spacing, depth, colour), Material 3 and Apple HIG for their *visual*
  guidance (elevation, type scale, motion feel — not their component libraries or
  interaction patterns, which are UX), and current design-token practice.
- **Modern CSS that raises visual quality with no framework** — `color-mix`
  (already used), `oklch` for smoother ramps, `:has()`, container queries, subgrid,
  view transitions and scroll-driven animation *as polish*. These fit the
  no-build-step architecture; a technique that needs a bundler does not.
- **Type and colour craft** — pairing, scale, optical sizing, harmonious accent
  ramps.

Then run the critique in `audit-loop.md` §C, filtered hard through U-013: for each
trend, ask *does this fit a warm, friendly, playful game companion, or is it
generic?* Six conflicts are pre-recorded as rejected criteria (U-R01 framework,
U-R02 rebrand, U-R03 UX, U-R04 a11y trade, U-R05 hardcoded hex, U-R06 illustration
pipeline) — if research proposes one again, that is the ledger working.

## Seeing the UI truthfully (phase E) — this is most of the value

A UI audit that only reads CSS is nearly worthless; the finding *is* what the
screen looks like. So this runs in a real browser, and three things will each
ruin it if ignored.

### 1. Never audit against production data

`.claude/launch.json`'s default/`production-data` config points at the real
`data/` folder — the group's private rounds and members. A screenshot of that is a
data leak (`.claude/rules/no-reading-production-data.md`). Launch the committed
**`dev-temp-data`** config instead (`preview_start {name: "dev-temp-data"}`): port
3100, gitignored `.devdata/`, accounts + admin on. Seed it with generated data
(`test-data` skill) covering every screen you mean to judge — an empty Pokale tab
renders an empty state and tells you nothing about the populated one. Leave
`launch.json` unmodified; the `dev-temp-data` entry is permanent.

The dataset must be *pretty enough to judge*: a round with ~12 games across several
tags (some with real provider covers, some on the placeholder gradient), archived
and completed games, a finished session with a podium, an abandoned draw, and a
couple of different `THEMES` applied so you see the design on more than the
standard palette.

### 2. The Browser pane lies in ways that look like design bugs

All documented, none are app defects (`preview-pane-paint-artifacts.md`):

- `innerWidth`/`innerHeight` can be `0` after a navigation → everything measures
  `width: 0`. `resize_window` to a real size and re-probe.
- **Screenshots go blank after any programmatic scroll** — and screenshots are
  your primary instrument here, so capture **only right after a fresh `navigate`**,
  and navigate again rather than scrolling to reach a lower section.
- Lazy covers never load (zero-height viewport starves the IntersectionObserver),
  so the Regal grid can look empty — judge covers on the game-detail hero and the
  vote screen, which set `background-image` inline, not on the lazy grid.
- Clear the service worker after any `styles.css` edit or you are looking at stale
  bytes (`pwa-service-worker.md`, "Verifying a shell-asset change").

### 3. Judge at all three presentations

Walk every screen at **390 / 1024 / 1440** so you see the phone dock (<860), the
strip (860–1279) and the desktop rail (≥1280) — they are three different visual
compositions (`responsive-hub-tabs.md`, `responsive-content-width.md`), and a
change that flatters one can break another. Use `resize_window`.

## What to walk

Every surface, because inconsistency between them is the commonest finding:

- **Lobby & entry:** home/round list, new round.
- **Round hub:** Start, Regal, Chronik, Pokale — and the dock, the strip and the
  rail as three separate looks.
- **Sub-screens:** game detail (the cover hero is a showcase surface), member, tags,
  providers, design/theme picker, move games, both archives.
- **Session flow (visual only):** setup, a vote card, the finale/reveal, the
  results podium — judge the *look* of each; do **not** touch the flow (U-R03).
- **Sheets & popovers:** add game, link provider, feedback, support, the editors —
  one overlay language across all of them.
- **Empty / loading / error states** — the first impression surfaces (U-009).
- **Auth & standalone pages:** login/register (need accounts env on your throwaway
  instance), and the legal/contact pages, which have their own token copy
  (`shared-constants-across-the-stack.md`) — check they still match the app.

## Remedies — a tight polish PR, a token, or an issue

Most UI findings are small CSS changes that batch well:

1. **A polish PR through `implement`** — the default. Group the small, high-confidence
   fixes (unify the shadow ramp, align the gutters, regularize the radii, tighten
   the type scale) into one reviewable change. Every change goes **through the
   tokens**, never a raw hex (U-001/U-R05), and stays inside `styles.css` — no new
   dependency, no framework.
2. **A design-token or a rule** — when the finding is really "there is no single
   source for X". Adding a `--shadow-1/2/3` elevation ramp or an `--radius-*` set to
   `:root` and migrating components onto it is the highest-leverage kind of fix, and
   a short `.claude/rules/` note keeps the next component on-system. A
   token-adherence assertion (no orphan accent/neutral hex; radii/shadows from the
   set) is a good mechanizable guard in the spirit of `test/content-width.test.js` —
   and if you add one, **break the CSS on purpose once** to watch it go red
   (`css-text-assertions-strip-comments.md`).
3. **A GitHub issue through `create-issue`** — for a larger visual redesign of one
   surface that needs its own review, labelled `audit` and `ui`, deduped against
   open and closed issues first.

**Every finding carries before/after evidence.** A screenshot of the current state
and either a screenshot of the proposed state (make the edit on your throwaway
instance, clear the SW, capture) or a precise description of the change. An
aesthetic claim with no picture is not reviewable — and a UI change is exactly the
case where a human does the final visual sign-off, so give them something to look
at.

## Do not report these

Settled in the Rejected ledger; re-raising them wastes the user's review: a
framework/Tailwind adoption (U-R01), any rebrand or default dark theme (U-R02), any
flow/UX/copy change (U-R03), anything that trades away the accessibility floor
(U-R04), a hardcoded shade instead of a token (U-R05), and an illustration/stock
pipeline (U-R06). Also do not relitigate the settled layout calls — the single
column width (`responsive-content-width.md`) and the tiles-vs-lists decisions
(`tiles-vs-lists.md`) — those are composition constraints you work within.
