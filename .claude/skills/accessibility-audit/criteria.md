# Accessibility criteria

- **last-researched:** 2026-07-24
- **cadence:** 180 days

Seeded 2026-07-23 from `.claude/rules/accessibility-contrast-and-modals.md`,
`.claude/rules/in-app-nav-links.md` and WCAG 2.1/2.2 AA — **not** from research.
The first run must do a full research pass (phase B of `audit-loop.md`).

Baseline target: **WCAG 2.2 level AA**. Whether a legal regime (EAA/BFSG,
EN 301 549) *binds* this app is an open question for the first research pass —
see A-R05. AA is held here as the product bar regardless.

---

### A-001 — Text contrast ≥ 4.5:1 against both the card and the darkest theme page
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 1.4.3 · `accessibility-contrast-and-modals.md` §1
- **Check:** Any colour used as text clears 4.5:1 against `--surface` *and* against
  the darkest `THEMES` page (Schiefer `#e9eef3`). Bare `.link-btn`s paint straight
  onto `--page-bg`, so "passes on white" is not the test.
- **Enforced by:** `test/a11y-contrast.test.js` (semantic colours, member colours, ratings)

### A-002 — A theme accent clears 4.5:1 as text on its own page
- **Status:** adopted · 2026-07-23
- **Source:** `accessibility-contrast-and-modals.md` §1
- **Check:** `THEMES[].accent` becomes `--brand` and paints every `.link-btn`, so a new
  or edited theme must clear AA on its own `page` value. Resolved at render time via
  `resolveAccent(bg)` — a corrected theme needs no migration.
- **Enforced by:** `test/a11y-contrast.test.js`

### A-003 — Non-text and large-text contrast ≥ 3:1
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 1.4.11, 1.4.3 (large text)
- **Check:** UI component boundaries, focus indicators and the score ring
  (`.gd-ring__num`) clear 3:1. `avgColor()`'s 30% lightness (for values at or
  above 1; it ramps darker below, #890) is tuned to sit at the boundary of two
  competing uses — fill under white text *and* stroke on the page; re-check both
  if it moves.
- **Enforced by:** `test/a11y-contrast.test.js` (ring only)

### A-004 — Every sheet traps focus and restores it on close
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 2.4.3 · `accessibility-contrast-and-modals.md` §2
- **Check:** Every sheet opens through `openSheet(backdrop, onKey)`, never by assigning
  `activeSheet`. Tab from the last focusable node must not reach the page behind the
  backdrop; closing returns focus to the opener. Install the trap *before* moving focus
  in, release it *after* removing the sheet.
- **Enforced by:** — (manual; verify by real Tab keypresses)

### A-005 — State is never conveyed by colour alone
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 1.4.1
- **Check:** Toggles carry `aria-pressed`; the current tab carries `aria-current`
  (`"page"` on a hub tab, `"true"` on a sub-screen — see `responsive-hub-tabs.md` §4).
  Seat picker, rating buttons and chips must not signal state with a class + colour only.
- **Enforced by:** — (manual)

### A-006 — The live region is permanently in the tree and toggled by class
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 4.1.3 · `accessibility-contrast-and-modals.md` §4
- **Check:** `toast()` is the only channel for confirmations *and* errors. The element
  stays in the DOM; visibility is `.toast.is-on`, never the `hidden` attribute, and the
  text is cleared on hide so re-showing the same message is still a reported mutation.
- **Enforced by:** — (manual)

### A-007 — Focus is always visible
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 2.4.7, 2.4.11
- **Check:** No global `outline: none`. The two scoped instances
  (`.search-pill input`, `.paste-zone`) each provide a replacement indicator.
  Probe with a real Tab keypress — `el.focus()` from a script does not set
  `:focus-visible` in Chrome, so scripted focus "finds" bugs that do not exist.
- **Enforced by:** — (manual)

### A-008 — Target size ≥ 24px, or the spacing exception
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 2.5.8
- **Check:** Either the target is ≥24×24 CSS px, or ≥24px separates the centres of
  adjacent targets. `.round-footer .link-btn` and `.tl-act__del` pass on spacing
  (33.5px between centres) — that is compliant, not a finding.
- **Enforced by:** — (manual)

### A-009 — Every route-changing control is a real anchor
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 2.1.1, 4.1.2 · `in-app-nav-links.md`
- **Check:** Built by `navLink(el, path, onNav)`; only a plain left-click is swallowed.
  An `<a href>` is focusable and Enter-activated natively — an `<a>` with no href is not
  a link at all, and a `<span>`/`<div>` with a click handler is not either. Controls with
  no resolvable URL (sheets, actions, the session flow) correctly stay `<button>`.
- **Enforced by:** — (manual; see the rule's `dispatchEvent` trap before probing)

### A-010 — Informational images carry a text alternative; decorative ones do not
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 1.1.1
- **Check:** Covers render as `background-image` and are decorative — the title is
  adjacent text, so they need nothing. Any `<img>` conveying information (provider
  logos, the BGG attribution mark, icons that are the only label) needs `alt`, and a
  `ti-*` icon that stands alone needs an accessible name on its control.
- **Enforced by:** — (manual)

### A-011 — Every form control has a programmatic label
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 1.3.1, 3.3.2, 4.1.2
- **Check:** `<label for>`, `aria-label` or `aria-labelledby` on every input, select and
  textarea — placeholder text alone is not a label. Includes the lookup input, the seat
  picker, the feedback and contact forms, and the auth screens.
- **Enforced by:** — (manual)

### A-012 — `<html lang>` follows the active locale
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 3.1.1
- **Check:** Set dynamically by `i18n.js`; the static `lang="en"` in `index.html` is only
  the pre-boot value and is not a finding. The standalone pages (`login.html`,
  `admin.html`, the legal pages) must each declare a correct static `lang`.
- **Enforced by:** — (manual)

### A-013 — Everything is operable by keyboard, with no trap outside sheets
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 2.1.1, 2.1.2
- **Check:** Tab reaches every interactive control in a sensible order and Enter/Space
  activate per role. The session flow, the rating faces, the dock/rail and the lookup
  dropdown are the risky surfaces. The lookup menu is `position: fixed` and JS-placed —
  confirm the keyboard can reach and dismiss it.
- **Enforced by:** — (manual)

### A-014 — Headings are hierarchical and each screen has exactly one `h1`
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 1.3.1, 2.4.6
- **Check:** No level skips; the `h1` names the screen. Each `show*` clears `#app` and
  rebuilds it, so this is per-screen, not per-document-load.
- **Enforced by:** — (manual)

### A-015 — Animation respects `prefers-reduced-motion`
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 2.3.3
- **Check:** The sheet open transform, the finale/reveal sequence and any tornado or
  confetti motion are reduced or removed under the media query. Nothing flashes more
  than three times per second (SC 2.3.1).
- **Enforced by:** — (manual)

### A-016 — Errors are announced, identified in text, and not colour-only
- **Status:** adopted · 2026-07-23
- **Source:** WCAG 2.2 SC 3.3.1, 3.3.3
- **Check:** Client-side validation messages are localized, sit next to (or are
  `aria-describedby`-linked to) their field, and reach the live region. A red border
  alone fails.
- **Enforced by:** — (manual)

### A-017 — An accessible name contains the visible label
- **Status:** adopted · 2026-08-21
- **Source:** WCAG 2.2 SC 2.5.3
- **Check:** Where a control has visible text AND an `aria-label`/`aria-labelledby`,
  the accessible name contains that visible text as a substring. A shortened visible
  label (`BGG`) with a spelled-out name (`Auf BoardGameGeek ansehen`) fails; `Auf BGG
  ansehen` passes. Icon-only controls have no visible text and are out of its scope —
  they are covered by their `aria-label` alone.
- **Enforced by:** — (manual)

---

## Rejected — settled, do not re-litigate

### A-R01 — "Remove every `outline: none`"
- **Status:** rejected · 2026-07-23
- **Why:** The two occurrences are scoped and each supplies a replacement indicator.
  Blanket removal is a lint rule, not an accessibility criterion. See A-007.

### A-R02 — "All touch targets must be 44×44 px"
- **Status:** rejected · 2026-07-23
- **Why:** 44px is the AAA figure (SC 2.5.5) and an Apple HIG convention. The AA bar this
  app targets is SC 2.5.8's 24px **with a spacing exception**, which the two small targets
  already satisfy. Adopting 44 would report compliant UI as broken. Revisit only if the
  target level moves to AAA — the native-app trigger lapsed when #143/#144 were closed
  won't-do-now on 2026-07-27 (reversibly; see `docs/production-readiness.md` §2.4).

### A-R03 — "`role="dialog" aria-modal="true"` is sufficient for a modal"
- **Status:** rejected · 2026-07-23
- **Why:** Measured false here. `aria-modal` constrains screen-reader traversal but not
  the keyboard: all five sheets carried it and Tab still walked into the page behind the
  backdrop. A real focus trap is required — this is exactly the contradiction A-004
  exists to encode.

### A-R04 — "Adopt an accessible component library / framework"
- **Status:** rejected · 2026-07-23
- **Why:** Contradicts a deliberate, re-examined architecture decision (CLAUDE.md: no
  framework, no build step). Accessibility defects here are specific and fixable in place;
  none of the findings so far argued for a rewrite. A finding must show a defect that
  *cannot* be fixed without a framework before this reopens.

### A-R05 — "The EAA/BFSG makes WCAG conformance legally binding on this app"
- **Status:** rejected · 2026-07-24 — settled (verified via `legal-audit`, first research pass)
- **Why:** Verified 2026-07-24: § 3 Abs. 3 BFSG exempts service-providing
  microenterprises (<10 heads, ≤€2M turnover), which covers this solo-operated,
  donation-funded service — no binding accessibility duty today. Context for a later
  re-check: EN 301 549 V4.1.1 (incorporating WCAG 2.2) is expected in the OJEU around
  Oct 2026, and the EAA/EN-301-549 harmonisation is still pending. Re-open only if the
  operator grows past the microenterprise thresholds or a paid tier changes the
  service classification. This does not lower the product bar: AA is the target
  either way. The legal side is recorded as `legal-audit` L-R05.

### A-R06 — "Replace the hand-rolled sheets with native `<dialog>` / Invoker Commands"
- **Status:** rejected · 2026-07-24
- **Why:** First research pass surfaced the platform's new modality primitives
  (`<dialog>`, Popover API, `command`/`commandfor` — Baseline 2025; `closedby` still
  limited availability mid-2026). WCAG requires the *outcome* — focus containment,
  restore-on-close, Escape — and `openSheet`/`trapFocus` already deliver exactly that
  (audited under A-004). A rewrite is an implementation choice with migration risk
  (history-marker integration, #333) and zero conformance gain. Reconsider only if
  A-004 audits start failing or `closedby` reaches Baseline and the sheets need its
  semantics.
