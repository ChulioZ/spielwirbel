# UI criteria

- **last-researched:** never
- **cadence:** 90 days

Seeded 2026-07-26 from `public/styles.css`, the `THEMES` table
(`public/js/views-round-detail.js`), `.claude/rules/theme-derived-colors.md`,
`tiles-vs-lists.md`, `responsive-content-width.md` and the redesign memory —
**not** from research. The first run must do a full research pass.

**Goal.** Make the app *visually* excellent — something people want to open and
enjoy looking at. Beautiful, polished, characterful. This is the one audit whose
findings are partly aesthetic, so the criteria are written to be as **concrete and
observable** as an aesthetic judgement can be: a consistent spacing scale, one
elevation ramp, a clear type hierarchy, disciplined use of the token system.
"Make it prettier" is never a finding; "these six cards use five different shadow
values — unify them into a 3-step ramp" is.

**Two hard fences — see the Rejected ledger before every run:**
- **Visual only, never UX (U-R03).** Colours, layout, type, spacing, depth,
  motion-as-polish, iconography, imagery treatment. **Not** flows, steps, screen
  order, information architecture, what a control does, or copy. If the fix
  changes what a user *does* rather than what they *see*, it is out of scope.
- **Evolution within the brand, never a rebrand (U-R02).** Every change stays
  inside `--brand` (`#c2410c`), the 8 `THEMES`, and the `color-mix`-derived token
  families. The app must look like itself tomorrow. Refining a token ramp is in
  scope; swapping the palette or defaulting to a dark theme is not.

**Not accessibility (U-R04).** Contrast ratios, focus indicators, target sizes,
ARIA, keyboard, reduced-motion *compliance* belong to `accessibility-audit`
(A-001..A-016) — do not re-report them. But every visual change must stay **above
that floor**: when beauty and accessibility conflict, accessibility wins and you
find another way to be beautiful. A proposal that would fail an `A-0xx` criterion
is not a UI finding, it is a rejected idea.

---

## Design-system coherence

### U-001 — Colour stays within the token system; no orphan hardcoded hex
- **Status:** adopted · 2026-07-26
- **Source:** `.claude/rules/theme-derived-colors.md`
- **Check:** Every colour that is "a shade of the page or the accent" is a
  `color-mix()` on `--page-bg`/`--brand` or one of the prepared families
  (`--sunken*`, `--line`, `--brand-tint*`, `--brand-edge`, `--page-glow`, `--stage-*`).
  A raw hex in a rule that is really an accent/neutral tint is a finding — it will clash
  on the non-standard themes (Blaugrau, Schiefer, Lavendel …). Semantics
  (`--good/--warn/--danger`) and the trophy `--gold*` / medal silver-bronze are
  **intentionally** theme-independent — leave them fixed.
- **Enforced by:** — (a token-adherence assertion is a good candidate; see SKILL.md)

### U-002 — One spacing scale, applied consistently
- **Status:** adopted · 2026-07-26
- **Source:** `public/styles.css`
- **Check:** Padding, margin and gap values draw from a small, regular scale (e.g. a
  4/8-based rhythm), not a scatter of one-off pixel values. Vertical rhythm between
  sections is even; related elements are grouped by proximity. A screen where every block
  invents its own gap reads as unpolished even when each block is fine alone.
- **Enforced by:** — (manual; measure computed spacing across a screen)

### U-003 — One elevation/depth system
- **Status:** adopted · 2026-07-26
- **Source:** `public/styles.css`
- **Check:** Shadows, borders and surface tints express a **single, legible hierarchy**
  (page → card → raised → overlay), with a small set of shadow tokens rather than ad-hoc
  `box-shadow` values per component. Cards, sheets, popovers, the dock and pills should
  agree on what "one level up" looks like. Depth should feel intentional and soft, in
  keeping with the warm brand — not five unrelated shadow recipes.
- **Enforced by:** — (manual)

### U-004 — Consistent radii, borders and surface treatment
- **Status:** adopted · 2026-07-26
- **Source:** `public/styles.css`
- **Check:** Corner radii come from a small set (e.g. chip / card / sheet radii), not a
  different number per component. Border weights and colours (`--line`, `--brand-edge`)
  are used consistently for the same meaning. Rounded, friendly geometry suits the brand;
  a stray sharp corner or a 5px-vs-6px radius drift is the kind of thing this catches.
- **Enforced by:** — (manual)

### U-005 — A clear typographic hierarchy from a coherent scale
- **Status:** adopted · 2026-07-26
- **Source:** `public/styles.css` (`--font` Nunito, `--font-display` Baloo 2)
- **Check:** Headings, body, labels and metadata sit on a deliberate type scale with
  obvious steps; weight and size do the hierarchy, not colour alone. Baloo 2 (display)
  and Nunito (body) are paired with intent — display for identity/headings, body for
  content — and line-height/measure keep text comfortable. Flag competing sizes that are
  almost-but-not-quite equal, or a screen where everything is the same weight.
- **Enforced by:** — (manual)

## Layout & composition (visual, not IA)

### U-006 — Alignment and grid discipline
- **Status:** adopted · 2026-07-26
- **Source:** `public/styles.css` · `responsive-content-width.md`
- **Check:** Elements align to shared edges and a consistent gutter; nothing is a few
  pixels off its neighbours. The content column, the rail and the tile grids share a
  rhythm. This is composition, **not** re-architecting the page — the column-width
  invariant (`responsive-content-width.md`) and the tiles-vs-lists decisions
  (`tiles-vs-lists.md`) are settled and out of scope to relitigate.
- **Enforced by:** partially — `test/content-width.test.js` pins the column width

### U-007 — Visual density and balance are considered at every breakpoint
- **Status:** adopted · 2026-07-26
- **Source:** `responsive-hub-tabs.md`, `responsive-content-width.md`
- **Check:** The three presentations (phone dock <860, strip 860–1279, desktop rail
  ≥1280) each look composed, not merely reflowed — the desktop rail's extra width is used
  gracefully, the phone view isn't cramped, and no view has large awkward voids or
  content hugging one edge. Balance and whitespace, not layout structure.
- **Enforced by:** — (manual; walk all three widths)

### U-008 — Every screen is visually consistent with its siblings
- **Status:** adopted · 2026-07-26
- **Source:** the redesign memory (`full-ui-redesign-spieleabend`)
- **Check:** A card on the Regal, a row in the Chronik, a tile in Pokale and the same
  patterns on the sub-screens share their component language — one card style, one row
  style, one chip style. Divergence (two different card shadows, two chip shapes) is the
  most common polish defect once a UI grows. The whole app should feel authored by one
  hand.
- **Enforced by:** — (manual)

## Polish, character & delight

### U-009 — Empty and loading states are designed, not blank
- **Status:** adopted · 2026-07-26
- **Source:** `public/styles.css`
- **Check:** A round with no sessions, an empty shelf, a fresh account — each has a
  considered visual state (illust/icon from the existing icon set, a warm line of guidance,
  balanced spacing), not a bare centered sentence. These are first impressions and set the
  quality bar. (Content/wording is out of scope — the *visual treatment* is in.)
- **Enforced by:** — (manual)

### U-010 — Iconography is one coherent set, used consistently
- **Status:** adopted · 2026-07-26
- **Source:** `.claude/rules/tabler-icon-codepoints.md`
- **Check:** Icons come from the Tabler subset, at consistent sizes and weights, aligned
  with their labels, one icon per concept across the app. A missing glyph (renders as
  nothing — see the rule) or a stylistically odd one is a finding. Do not introduce a
  second icon family.
- **Enforced by:** — (manual; verify a new glyph against the bundled cmap per the rule)

### U-011 — Cover art and imagery are framed consistently and never distort
- **Status:** adopted · 2026-07-26
- **Source:** `.claude/rules/provider-cover-sizing.md`, `deterministic-cover-placeholders.md`
- **Check:** Covers keep a consistent aspect ratio and object-fit, share one corner
  treatment, and the deterministic placeholder gradient is attractive and on-brand for
  games with no art. No stretched, letterboxed or inconsistently-cropped covers. The
  blurred backdrop layer is part of the look — keep it, it is cheap at the sized
  resolution.
- **Enforced by:** — (manual)

### U-012 — Motion is purposeful, brief, and expresses the brand's playfulness
- **Status:** adopted · 2026-07-26
- **Source:** `public/styles.css` (the finale/reveal, the tornado)
- **Check:** Transitions and micro-interactions (hover, press, sheet-open, the session
  reveal) are smooth, quick and consistent in easing/duration — they add delight, not
  lag. The "Spielwirbel" tornado and the finale are signature moments; lean into that
  character rather than flattening it into generic fades. This is visual quality of
  existing motion, **not** adding new animated flows. Must respect `prefers-reduced-motion`
  (that *compliance* is `accessibility-audit`'s A-015 — here it is a constraint, not the
  goal).
- **Enforced by:** — (manual)

### U-013 — The app has a distinct, warm personality — amplify it, don't flatten it
- **Status:** adopted · 2026-07-26
- **Source:** the brand (`Spielwirbel`, Baloo 2, `#c2410c`, the paper-grain backdrop)
- **Check:** The app should feel like a warm, friendly, slightly playful board-game
  companion — not generic minimalist SaaS. When research offers a trend, ask whether it
  *fits this personality*. The accent glow, the paper grain, the rounded display type and
  the trophy gold are personality carriers; a "cleaner" change that erases them is a
  regression, not an improvement. Beauty here means *more* character, executed well — not
  less.
- **Enforced by:** — (manual; the judgement criterion the others serve)

---

## Rejected — settled, do not re-litigate

### U-R01 — "Adopt Tailwind / a component library / a design-system framework"
- **Status:** rejected · 2026-07-26
- **Why:** Contradicts a deliberate, re-examined architecture call (CLAUDE.md: no frontend
  framework, no build step beyond the optional cache-buster). The design system already
  exists as CSS custom properties + `color-mix`; improve *within* it. A UI finding never
  requires a framework — if one seems to, the finding is mis-scoped.

### U-R02 — "Rebrand: new palette, new logo, dark theme by default"
- **Status:** rejected · 2026-07-26 — **a hard fence, do not remove**
- **Why:** The user's explicit constraint: the app must not look 100% different from one
  day to the next. Every change stays within `--brand` and the 8 `THEMES`. Refining a
  derived token (a better tint ramp, a softer shadow) is in scope; replacing the brand
  colour, adding a new default theme, or a dark mode as the default is not. (A user-chosen
  dark *theme* could be a legitimate feature — but that is a `create-issue` proposal to the
  user, never a UI-audit finding filed on its own.)

### U-R03 — "Improve this by changing the flow / step order / what this screen does"
- **Status:** rejected · 2026-07-26 — **a hard fence, do not remove**
- **Why:** The user scoped this skill to *plain UI*, explicitly not UX. Reordering steps,
  merging screens, changing navigation, altering what a control does, or rewriting copy is
  out of scope even when it would help. If you spot a genuine UX improvement, mention it to
  the user as an aside — never file it as a UI finding or implement it here.

### U-R04 — "This looks sleeker with lower contrast / smaller text / a thinner focus ring"
- **Status:** rejected · 2026-07-26
- **Why:** Accessibility is a floor, not a trade. `accessibility-audit` owns contrast,
  target size and focus (A-001/003/007/008); a visual change that dips below any of them is
  rejected outright, not weighed against aesthetics. Beauty must be achieved *above* the
  floor. Trendy low-contrast greys are the single most common way a "redesign" regresses.

### U-R05 — "Just hardcode this nicer colour here"
- **Status:** rejected · 2026-07-26
- **Why:** A raw hex that is a shade of the page or accent breaks on the non-standard
  themes and is exactly what `theme-derived-colors.md` forbids. The nice colour goes in as
  a `color-mix()` on the tokens (or a new derived family token), so all 8 themes get it.
  See U-001.

### U-R06 — "Add illustrations / stock imagery / an illustration pipeline"
- **Status:** rejected · 2026-07-26
- **Why:** The repo has no image-generation tooling and deliberately doesn't re-host art
  (`provider-cover-hotlinking.md`); covers are provider art or the deterministic
  placeholder gradient. Polishing the placeholder, the icons and the CSS backdrop is in
  scope; introducing an illustration set or a stock-image dependency is a new,
  heavyweight decision for the user, not a UI-audit remedy.
