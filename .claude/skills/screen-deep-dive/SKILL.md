---
name: screen-deep-dive
description: >-
  Take ONE screen of the app apart and rebuild the case for it: measure how it
  lays out at phone, tablet, laptop and desktop widths over generated data,
  diagnose where the height and the width actually go, propose tiered
  improvements (layout only → structure → character) as live, clickable
  prototypes in a device-frame artifact, get the operator's decision, and file
  one implementable issue per agreed slice. Use when asked to rethink, redesign,
  improve or make "first-class" a specific screen or flow at all screen sizes,
  when a screen scrolls or wastes space on some device, or when a UX + layout
  proposal for one screen is wanted before any code. Not a whole-app audit (that
  is ui-audit / accessibility-audit); it writes no product code.
---

# Screen deep-dive

One screen, all sizes, UX and layout and visuals together, ending in a decision
and issues — not in code. The audits judge the whole app against criteria; this
argues for one screen from measurements and shows the alternatives working.
Product code ships afterwards through `create-issue` → `implement`.

**The lever is frequency.** Every screen has controls used every time and
controls used rarely. Most layout trouble is rare controls rendered at the size
of common ones. Classify before you measure; it decides tier B below.

## 0. Pin the screen

- Which `show*` function renders it (`public/js/views-*.js`), what it asks the
  user, what it leads to, and every entry point (a hub CTA, a rail entry, a
  deep link, quick-start chips that prefill it).
- Each control: **every visit / sometimes / rare**, and whether it is *the*
  action of the screen. The action is what must be reachable without scrolling.
- What is shared: components mounted here and elsewhere (pickers, the seat
  ring, the filter panel) — a change here reaches those screens
  (`.claude/rules/tiles-vs-lists.md` says which screens may be reshaped at all).

## 1. Read before measuring — a few batched calls

The view file end to end; its CSS blocks (`grep -n '<class prefix>'
public/styles.css` and the container rules in the layout section); the shared
components and who else mounts them; the rules that name it (`grep -l
'<class or function>' .claude/rules/*.md`); the tests that pin its shape (for a
layout: `test/content-width.test.js`); its paragraph in `docs/features.md`; and
`git log --oneline -- <view file>` for the issues that shaped it. The code
comments here explain *why* things sit where they sit — read them, because a
proposal that undoes a documented decision must say so.

## 2. Measure at a fixed viewport set

Numbers, not impressions. Walk **all** of these, phone to large desktop:

| Viewport | Stands for |
|---|---|
| 390 × 844 | phone |
| 768 × 1024 | tablet portrait — often the gap between phone and desktop rules |
| 1024 × 768 | tablet landscape / small laptop |
| 1280 × 800 | small notebook, and the rail breakpoint |
| 1470 × 870 | MacBook Air 13″ browser viewport |
| 1728 × 1030 | MacBook Pro 16″ |
| 1920 × 1080 | desktop |
| 2560 × 1440 | large desktop |

Procedure, per width: `resize_window` → fresh `navigate` → reach the screen
through its **real entry point** → JS probe → one screenshot. Details that cost
a cycle each when skipped:

- `preview_start {name: "dev-temp-data"}`, never production data
  (`.claude/rules/no-reading-production-data.md`). The landing page's demo
  button seeds rounds with tags, owners and BGG metadata; pick the richest one so
  every control exists. An empty screen measures nothing.
- Clear the service worker once before trusting any CSS
  (`.claude/rules/pwa-service-worker.md`).
- A cold load of a transient path (the session setup, the wizard) resolves to
  the hub (`.claude/rules/session-flow-history.md`) — click the CTA from the
  hub instead of navigating to the path.
- The demo banner adds ~45 px at the top; a registered account has none. Say so
  next to every height.
- Probe, don't eyeball: `innerWidth/innerHeight`, `scrollHeight`, the rects
  (`x`, `y + scrollY`, width, height) of the head, the grid, each column and
  each block, `gridTemplateColumns`, and whether the primary button's bottom
  is below `innerHeight`. Screenshot only right after the fresh navigate —
  captures after a programmatic or hash scroll come back blank
  (`.claude/rules/preview-pane-paint-artifacts.md`), and the pane is
  Chromium only (`.claude/rules/browser-pane-is-chromium-only.md`).
- Measure a second dataset when the screen scales with data (a six-member
  round, a long shelf): the defect may only exist at one size.

Record it as a table: viewport, form width, gutter per side, each column's
height, page height, where the action sits, verdict. Reset the viewport
(`preset: "desktop"`) when done.

## 3. Diagnose — separate width from height

- **Width:** what caps the content (`--w-*` tokens, a `max-width`), and how much
  of the pane becomes gutter at each size.
- **Height:** which blocks are always open, what they cost, how much of it is
  hint text, and how much is *content narrower than its column* (a fixed
  280 px graphic centred in a 604 px column is tall AND empty).
- **The fold:** at each width, what a user sees without scrolling, and whether
  the primary action is in it. On a phone, everything above the action is a
  toll.
- **Feedback distance:** when a control changes something the screen shows
  (a seat toggle changing a pool count), are both on screen at once?
- **Breakpoint gaps:** the size between the phone stack and the desktop split —
  tablet portrait usually — and components that do not scale (fixed-size
  graphics, rings that overlap past n items).
- Then the one-paragraph diagnosis, in the form "the screen asks X every time
  and Y rarely; it renders both at the same size; fixing width alone leaves the
  height, fixing height alone leaves the gutters".

## 4. Propose in tiers that stack

- **A — layout only.** Caps, column ratios, sub-grids, viewport-height panels,
  sticky columns, scaling graphics. CSS plus test numbers. Often not enough.
- **B — structure.** Frequency-driven disclosure (rare controls collapse into a
  labelled row that carries its state once set), the action where the thumb or
  cursor already is (a sticky bar with a live summary), the compact phone order.
  Usually the recommendation.
- **C — character.** The bold version: what the two everyday questions would
  look like as one scene, the brand's verb made visible. Slices, after B.

For each tier: what changes (with the real file, class and rule names), what it
fixes and what it leaves, effort, which tests pin the current shape and which
rules constrain it (`.claude/rules/responsive-content-width.md`,
`.claude/rules/setup-screens-two-column-layout.md` for the width question).
Close with a matrix of problem × tier and one recommendation. Follow the
operator's calibration: character features start one notch bolder than feels
safe; consistency across sibling screens beats a narrow scope.

## 5. Prototype — and MEASURE the prototypes

The proposal is an artifact page the operator can click and resize: findings,
diagnosis, the tier cards, live prototypes, recommendation, implementation
notes. Start from `bench.html` in this skill's folder — the device-frame
scaffold — and load the `artifact-design` skill before writing.

- **Container queries, not viewport queries.** Each frame is a fixed-size
  `.device` with `container: device / size`; the prototype's breakpoints are
  `@container device (min-width: …)`, so phone, tablet and laptop sit side by
  side on one page. Where the app uses `dvh`, the prototype uses `cqh` — say so
  on the page.
- **Scale frames with `transform: scale()` and a JS-sized wrapper**, never
  `zoom`: transforms leave the container's own width intact, so the queries
  resolve at the real device width.
- **Reconstruct "Today" with the same components** as the proposals (a tab per
  version), from the measured CSS values, so the comparison is fair.
- **Interactive where it argues:** seats toggle, options open, the pool
  recomputes with the app's own predicates. Fake covers, real rules.
- **A live caption per frame** reads the frame's `scrollHeight − clientHeight`
  and prints "fits" or "scrolls N px" (and the gutter for the laptop frame).
  This is the honest step: run it for **every** tier at every frame, and when
  a tier does not fit — layout-only tiers usually don't on a 13″ — the page says
  so and the recommendation is argued from it, not softened.
- Artifact hygiene that cost a cycle: a page laid out with `display: grid`
  needs `grid-template-columns: minmax(0, 1fr)` or a `nowrap` table widens
  the whole page past the viewport; `position: sticky` works inside a scaled
  frame, `position: fixed` does not; the app's fonts come from Google Fonts,
  its tokens are copied in (a throwaway page, not a second source of truth).

Look at the published page once, fix what that look shows, stop.

## 6. Decide, record, file

- Present in the terminal: diagnosis, the table, the tiers in a few bullets,
  the recommendation, the open calls with your pick — and the link. Do not file
  anything yet; issues on the public repo are the operator's call.
- When the operator decides: write the decisions **onto the page** (a
  "Decided <date>" line, dropped items named with the reason) and into memory,
  and cut the prototype down to the agreed scope so it is the spec.
- Then one issue per slice via `.claude/skills/create-issue/SKILL.md`, and
  make each **self-contained**: the artifact is private to the operator, so the
  body carries the measurements table, the approach with file and rule
  pointers, the i18n keys, the tests to update and add, the acceptance
  criteria. Wire real `blocked_by` links between slices. Hand off to
  `.claude/skills/implement/SKILL.md`.

## What this skill is not

- Not `.claude/skills/ui-audit/SKILL.md`: that is visual-only, criteria-driven
  and app-wide; this is one screen, UX included, argued from numbers.
- Not accessibility: keep proposals above the floor (labelled disclosures,
  real buttons, target sizes), but the audit owns compliance.
- Not implementation. The temptation after a good prototype is to start
  coding — the prototype is CSS on fake data; the app's tests, i18n parity,
  shared components and rules are what `implement` is for.

## Traps, in one place

The pane never delivers Escape and fires no blur
(`.claude/rules/escape-keypresses-never-reach-the-preview-pane.md`,
`.claude/rules/blur-events-never-fire-in-the-preview-pane.md`); a freshly
opened tab can report a 0 × 0 viewport until `resize_window`; a claim about
sticky, `dvh`, `scroll-snap` or multicolumn needs WebKit too; the prototype
bench's static server (`python3 -m http.server` in the scratchpad, for the one
look) sends no charset — the mojibake is the server, not the page; and the
operator judges from what they can click, so a static mockup is the weaker
deliverable here.
