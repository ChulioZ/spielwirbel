# UI criteria

- **last-researched:** 2026-07-26
- **cadence:** 90 days

Seeded 2026-07-26 from `public/styles.css`, the `PALETTES` table (`public/js/round-designs.js`)
(`public/js/views-round-detail.js`), `.claude/rules/theme-derived-colors.md`,
`tiles-vs-lists.md`, `responsive-content-width.md` and the redesign memory.
The first research pass ran the same day and added **U-014**, sharpened **U-003**
and **U-005** with measured state, and rejected **U-R07/R08/R09**.
On 2026-07-29 (operator direction, outside the research cadence) **U-015** and
**U-016** were added and **U-013** sharpened, so the audit judges screen-level
composition and character coverage, not only token/consistency discipline — see
"The big-picture pass" in SKILL.md.
The 2026-08-07 sweep (cadence-skip, no research) refreshed stale state: **U-014**
is resolved (#692), `test/design-tokens.test.js` now enforces U-003/U-005/U-014
and parts of U-004, and **U-R10** records the settled per-component radii call.

**Goal.** Make the app *visually* excellent — something people want to open and
enjoy looking at. Beautiful, polished, characterful. This is the one audit whose
findings are partly aesthetic, so the criteria are written to be as **concrete and
observable** as an aesthetic judgement can be: a consistent spacing scale, one
elevation ramp, a clear type hierarchy, disciplined use of the token system.
"Make it prettier" is never a finding — but **two** finding shapes are:

- the **detail finding** — "these six cards use five different shadow values —
  unify them into a 3-step ramp";
- the **screen-level composition finding** — "the Chronik reads as an
  undifferentiated list with no visual anchor; here is a mocked recomposition
  within the tokens".

Both are equally legitimate outputs. A run that produces only the first kind has
under-delivered — the consistency criteria (U-001..U-008) can *only* yield
convergence nits, so the screen-level judgement (U-013/U-015/U-016, driven by the
mandatory big-picture pass in SKILL.md) is where the audit earns its "make it
genuinely beautiful" mandate.

**Two hard fences — see the Rejected ledger before every run:**
- **Visual only, never UX (U-R03).** Colours, layout, type, spacing, depth,
  motion-as-polish, iconography, imagery treatment. **Not** flows, steps, screen
  order, information architecture, what a control does, or copy. If the fix
  changes what a user *does* rather than what they *see*, it is out of scope.
- **Evolution within the brand, never a rebrand (U-R02).** Every change stays
  inside `--brand` (`#c2410c`), the 8 `PALETTES` (plus the worlds, #903), and the `color-mix`-derived token
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
  (page → card → raised → overlay), expressed as a **3-step ramp** (`--shadow-1/2/3`)
  rather than ad-hoc `box-shadow` values per component. Three is the number Fluent 2,
  Material, Atlassian Design and Polaris all independently converge on — enough to say
  resting / raised / overlay, few enough that each step reads as a distinct level. Each
  step layers a sharp *key* shadow (defines the edge) over a soft *ambient* one (implies
  distance), which is what the existing `--shadow` already does. Cards, sheets, popovers,
  the dock and pills must agree on what "one level up" looks like. Depth should feel
  intentional and soft, in keeping with the warm brand — not five unrelated recipes.
  **State as of 2026-07-29: SHIPPED.** `--shadow-1/2/3` are defined in `:root` (with the
  key+ambient rationale in a comment) and every elevation site uses them — `.sheet` sits
  on `--shadow-3`, the old inversions are gone. The remaining non-token `box-shadow`s are
  deliberately off-ramp: focus/selection rings (`0 0 0 3px var(--brand-edge)` etc.),
  `.ticket--live`'s inset accent edge, and a `0 0 0 1px var(--line)` hairline — those are
  not elevation. Audit against drift (a new ad-hoc elevation value), not against the old
  gap. (Previously: one `--shadow` token plus 8 ad-hoc values, inverted at both ends.)
- **Enforced by:** `test/design-tokens.test.js` (every elevation box-shadow must be a
  ramp token; rings/inset/none are the documented off-ramp, and the ramp's ordering is
  asserted too)

### U-004 — Consistent radii, borders and surface treatment
- **Status:** adopted · 2026-07-26
- **Source:** `public/styles.css`
- **Check:** Corner radii come from a small set (e.g. chip / card / sheet radii), not a
  different number per component. Border weights and colours (`--line`, `--brand-edge`)
  are used consistently for the same meaning. Rounded, friendly geometry suits the brand;
  a stray sharp corner or a 5px-vs-6px radius drift is the kind of thing this catches.
  **Scope note (2026-08-07):** the in-between literal radii (2/6/10/14/16/22px) are a
  **settled per-component choice**, recorded in `test/design-tokens.test.js` — see
  U-R10 before re-raising them. What this criterion still catches: a literal that
  *duplicates* a token value, a bare pill radius, an off-recipe selection ring (all
  three now test-enforced), and any genuinely new one-off geometry.
- **Enforced by:** partially — `test/design-tokens.test.js` (no literal radius may
  duplicate a token value, pills use `--radius-pill`, `--brand-edge` rings are 3px);
  the "same meaning, same treatment" judgement stays manual

### U-005 — A clear typographic hierarchy from a coherent scale
- **Status:** adopted · 2026-07-26
- **Source:** `public/styles.css` (`--font` Nunito, `--font-display` Baloo 2)
- **Check:** Headings, body, labels and metadata sit on a deliberate type scale with
  obvious steps; weight and size do the hierarchy, not colour alone. Baloo 2 (display)
  and Nunito (body) are paired with intent — display for identity/headings, body for
  content — and line-height/measure keep text comfortable. Flag competing sizes that are
  almost-but-not-quite equal, or a screen where everything is the same weight.
  The scale must exist as **named tokens** (`--text-*`), not as hardcoded px values
  scattered through the sheet — otherwise there is no scale, only a habit.
  **Fluid `clamp()` sizing is in scope for display/hero type only**: never for body text
  (a `vw`-driven body size shrinks exactly where reading is hardest), and never below a
  size's current value — see **U-R04**, the floor is not negotiable.
  **State as of 2026-08-05 (#470 shipped, closed 2026-08-02 — this is now a *done*
  criterion, not a debt list):** the scale exists as **8 tokens** (`--text-xs` 12px →
  `--text-4xl` 40px, each carrying the sizes it absorbed as a comment) with **226**
  `var(--text-*)` uses. The old note read "22 distinct hardcoded sizes, no tokens".
  The residual is **35 hardcoded px `font-size` declarations — and all 35 carry the
  marker `/* glyph, not type */`**, i.e. they size a Tabler `.ti` glyph or an avatar
  initial, which are *artwork* and correctly outside the type scale. **Zero unannotated
  px sizes remain** (measured, not estimated). So do not re-raise the residual as
  partial migration; the finding to look for now is the *new* one that skipped the
  scale.
- **Enforced by:** `test/design-tokens.test.js` (every font-size draws from the scale
  except the named glyph literals, the exemption list is checked for staleness, the
  scale must ascend, and the four reading steps carry U-R04 px floors)

### U-014 — Colour mixing happens in a perceptually uniform space
- **Status:** adopted · 2026-07-26
- **Source:** MDN [`<color-interpolation-method>`](https://developer.mozilla.org/en-US/docs/Web/CSS/color-interpolation-method)
  · CSS Color 5 · [w3c/csswg-drafts#10484](https://github.com/w3c/csswg-drafts/issues/10484)
  (should `color-mix()` default to oklab). Baseline in every major browser since 2023
  (Chrome 111, Safari 15.4, Firefox 113, Edge 111); >93% global as of mid-2025.
- **Check:** `color-mix()` interpolates in **`oklab`** — or `oklch` where hue travel is
  the point, e.g. a multi-stop ramp — **not `srgb`**. sRGB is neither linear-light nor
  perceptually uniform, so mixes toward black/white darken unevenly and mixes between
  distant hues pass through a muddy, desaturated middle. Since this app *derives its
  entire palette* by mixing (`--sunken`, `--line`, `--brand-tint*`, `--brand-edge`, the
  whole `--stage-*` family), the interpolation space is a design decision, not a detail.
  **State as of 2026-08-07: RESOLVED.** #692 (closing #544) migrated every mix to
  `in oklab` with re-tuned percentages; `grep -c 'color-mix(in srgb' public/styles.css`
  returns 0. The criterion stays adopted for *new* mixes only — and the test below
  asserts the space allowlist-style across all four CSS-bearing surfaces, so a fresh
  srgb mix fails CI rather than waiting for a sweep.
- **Caveat — this is not a find-and-replace.** Changing the space **changes the rendered
  colour** of every derived token: an oklab mix toward `#000` at the same percentage
  lands lighter than the sRGB one, so the percentages have to be re-tuned by eye, not
  just the keyword swapped. Any migration must re-run **`test/a11y-contrast.test.js`**
  and re-check the derived tones against **every** design's own page — since #904 a
  design may be dark, so there is no single darkest page to measure against, and the
  neutral mixes travel toward `#fff` rather than `#000` on one
  (`.claude/rules/accessibility-contrast-and-modals.md` §1). A migration that keeps
  the numbers and only edits the keyword is a regression, not an improvement.
- **Enforced by:** `test/design-tokens.test.js` (oklab allowlist over styles.css,
  kontakt.html, login.html and lib/faq.js, with a per-surface anti-vacuous floor)

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

### U-015 — Every major screen has a deliberate focal point
- **Status:** adopted · 2026-07-29
- **Source:** operator direction 2026-07-29 (the audit must judge compositions, not only
  consistency) · Refactoring UI's hierarchy principles
- **Check:** Judge each major surface **as a composition, not as a sum of conforming
  parts**: something on the screen should lead — a hero, a dominant card, a strong
  heading block, the cover art — and the rest should visibly rank below it. A screen
  that is a uniform stack of equal-weight blocks is a finding **even when every block
  individually passes U-001..U-008**; passing the consistency criteria is not evidence
  the screen is good, and "every nit fixed, still dull" is precisely the state this
  criterion exists to name. Remedies recompose the *same* content — size, weight,
  placement, framing, backdrop — and never add/remove content, controls or steps
  (U-R03), and stay inside the settled layout calls (`responsive-content-width.md`,
  `tiles-vs-lists.md`).
- **Enforced by:** — (manual; the big-picture pass in SKILL.md)

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

### U-016 — Backgrounds and large surfaces do atmospheric work
- **Status:** adopted · 2026-07-29
- **Source:** operator direction 2026-07-29 · the existing backdrop (the `body` accent
  glow + paper grain, `.claude/rules/theme-derived-colors.md`)
- **Check:** The accent glow, the grain and the theme-derived tint families are
  *composed per screen*, not merely present globally: a large flat expanse of bare
  `--page-bg` — or bare `--surface` inside an oversized card — with nothing doing
  atmospheric work is a finding. "This screen's background is boring" is exactly the
  class of observation this criterion admits; the remedy makes it concrete (a derived
  wash, a scoped glow, a tinted band that anchors a section). Every new tone is derived
  via `color-mix()` on `--page-bg`/`--brand` or an existing family (U-001/U-R05) so the
  treatment holds on all 8 themes, and it stays above the contrast floor (U-R04) —
  atmosphere goes *behind* content, never into competition with reading it.
- **Enforced by:** — (manual; the big-picture pass in SKILL.md)

### U-013 — The app has a distinct, warm personality — amplify it, don't flatten it
- **Status:** adopted · 2026-07-26 · sharpened 2026-07-29 (offensive half added)
- **Source:** the brand (`Spielwirbel`, Baloo 2, `#c2410c`, the paper-grain backdrop)
- **Check:** The app should feel like a warm, friendly, slightly playful board-game
  companion — not generic minimalist SaaS. When research offers a trend, ask whether it
  *fits this personality*. The accent glow, the paper grain, the rounded display type and
  the trophy gold are personality carriers; a "cleaner" change that erases them is a
  regression, not an improvement. Beauty here means *more* character, executed well — not
  less.
  **This criterion fires in both directions.** The defensive half above (don't let a
  change erase character) is not the whole check: walk every major surface and flag the
  screens carrying **none** of the personality carriers — *absence* of character on a
  screen is a finding exactly as erasure is. A functional-but-anonymous screen that
  could belong to any generic app is what this criterion exists to catch, not only the
  trend that would flatten a good one.
- **Enforced by:** — (manual; the judgement criterion the others serve, driven per
  screen by the big-picture pass in SKILL.md)

> **Note (2026-07-26 research pass) — the trend is coming *toward* this app.** The
> 2026 "neo-minimalism" material (warmth, paper/linen texture, film grain, anti-flat
> tactile surfaces, character over sterile minimalism) was reviewed and produced
> **no criteria change**: the sources are trend listicles and fail the authority test
> in `audit-loop.md` phase C step 1, so none of it is adoptable as a criterion. It is
> recorded here because it *independently validates U-013* — the paper-grain backdrop,
> the warm earthy palette and the rounded display face are precisely what that trend is
> reaching for, and this app already ships them. Read it as a reason to hold the line
> on U-013, not as a licence to chase the listicles.

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
  day to the next. Every change stays within `--brand` and the 8 `PALETTES` (plus the worlds, #903). Refining a
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

### U-R10 — "Migrate the in-between component radii (6/10/14/16/22px) onto the --radius-* scale"
- **Status:** rejected · 2026-08-07
- **Why:** Raised by the 2026-08-07 sweep as U-004 drift and dropped on the operator's
  call, because it re-litigates a recorded decision: the pass that introduced the
  radius tokens kept these literals **on purpose** — "each is a per-component call,
  so a blanket 'no literal radius' rule would be a lie" (`test/design-tokens.test.js`,
  which instead pins the two real defect shapes: token-value duplicates and bare
  pill radii). A migration would also visibly retune buttons, cards and stage
  corners app-wide for no stated gain. Re-open only with a *visual* argument that
  specific components disagree where they should match — not a tokens-for-tokens'-sake
  sweep.

### U-R07 — "Adopt the View Transitions API / CSS scroll-driven animations"
- **Status:** rejected · 2026-07-26
- **Why:** Both reached Baseline in 2026, both run on the compositor and ship zero KB of
  JS, and neither is a bad idea — this rejection is about **scope, not quality**. A
  same-document view transition means wiring `document.startViewTransition()` into
  `public/js/router.js`, i.e. new JavaScript in the one file that carries the delicate
  popstate/flow contract (`.claude/rules/session-flow-history.md`,
  `sheet-history-back-dismissal.md`), and it changes **how screens appear as you move
  between them** — new motion where there was none. U-012 deliberately scopes this skill
  to the visual quality of *existing* motion, not to adding animated flows. So this is a
  **feature proposal to put to the user** (via `create-issue`), never a finding this
  audit files on its own. Same for scroll-driven animation: a scroll-linked reveal is a
  new behaviour, not a polish pass on an old one.

### U-R08 — "Use container queries for component-level layout"
- **Status:** rejected · 2026-07-26
- **Why:** Container queries are well-supported in 2026 and genuinely useful in general —
  but they key a component's layout off **its own box**, and this repo has a deliberate,
  test-pinned rule that layout widths derive from the **viewport only**
  (`.claude/rules/responsive-content-width.md`; `test/content-width.test.js` fails any
  rule that picks a width from content via `:has()`, a state class or an attribute
  selector). That rule exists because a content-selected width shipped once (#332) and
  moved the navigation 220px sideways between sibling tabs. A container query is not
  literally what that test forbids, but it sits close enough that adopting one as a
  *criterion* would invite exactly the class of change the rule was written to stop.
  Concretely: the layout defects this audit actually measures are **alignment and
  rhythm** (a 43px title spread, a 46px perforation offset, a zero-px gap) — none of
  which a container query addresses. Revisit only if a finding genuinely requires
  component-box-driven sizing, and take it to the user with the rule in hand.

### U-R09 — "Adopt Material 3 Expressive: spring physics, the 35-shape library, shape morphing"
- **Status:** rejected · 2026-07-26
- **Why:** M3 Expressive's core moves don't port. Replacing duration+easing with
  **spring physics** (stiffness/damping) needs a JS animation runtime to integrate the
  springs — CSS has no spring primitive — and **shape morphing** ships as a Jetpack
  Compose / Figma library, not as CSS. Both land squarely in **U-R01** (no framework, no
  build step). The one genuinely transferable idea, *emphasized typography* as a
  hierarchy device, is already **U-005** and needs no new entry. Don't re-raise this as
  "just the shapes" either: 35 squircle/scallop/burst variants is a rebrand of the app's
  geometry (**U-R02**), not a refinement of it.
