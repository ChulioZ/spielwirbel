# The design programme

Spielwirbel is moving from **per-round** colour schemes and worlds to
**per-user designs**: every account picks one look for the whole app, and a
round keeps only a colour marker. Seven looks are planned — Klassisch (today's
look), Der Tisch, Das Programmheft, Die Brücke, Der Run, Forest, Ocean — and
Der Tisch is also the *face*: what logged-out visitors see. This folder holds
everything that decides how that works. The code follows it; this file is the
map.

## The documents

| File | What it is |
|---|---|
| `handover-claude-design-2026-09-19.md` | The programme's specification: the decisions table (§1), the **information architecture every design shares** (§2), the per-design deliverable checklist (§3), the hard constraints (§5), and the brief plan T1–T15 / X1–X15 (§8). Read §1 and §2 before touching any design. |
| `handover-vokabular-2026-09-20.md` | The vocabulary rule: **nouns and navigation are Spielwirbel's, the ritual is the theme's.** §1 lists the words no design may rename, §2 the few places a design may have its own words. |
| `pruefung-tisch-2026-09-20.md` | The review of the first package (Der Tisch), in the format every later review uses: Datei · Screen · Befund · Messwert · Vorschlag. Its A/B findings are binding rules for every design. |
| `tisch/` | The reviewed „Der Tisch" package (V2, sixteen sheets T1–T15b), one HTML sheet per brief, plus the runtime that renders them and the package's own README. |
| `pruefung-ocean-2026-09-20.md` | The review of the second package (Ocean), over two rounds. Its closing section is binding for every later package — in particular that the audit tool over-reports on gradient-led designs (see step 2). |
| `ocean/` | The reviewed „Ocean“ package (fifteen sheets O1–O15b plus the concept sheet), same shape as `tisch/`. |
| `pruefung-bruecke-2026-09-22.md` | The review of the third package (Die Brücke), over two rounds. Its closing section adds four rules for the remaining designs — in particular that a word finding binds to the **package**, not to the screen it was spotted on, and that icons and locales are checked against the **repo**, never against the previous package. |
| `bruecke/` | The reviewed „Die Brücke“ package (sixteen sheets B1–B16 plus the concept sheet), same shape as `tisch/`. B16 is the density sheet — twelve seats, a 42-game shelf, a tie and two long locales. The shared vote and the pass-device blind arrived in round 3 as B4.5/B6.9 and B4.6/B6.10. |
| `tools/audit.js` | The contrast + hit-size audit that measured the Tisch sheets (see below). |

The issues that implement the programme start at #1184 (the design layer) and
end at #1202 (the flip); #1203–#1206 are one placeholder epic per remaining
design. **Ocean's slices are #1210–#1222**, filed from the package in PR #1209;
its epic #1207 closes when Ocean is enabled. **Die Brücke's slices are
#1237–#1249**, filed from the package in PR #1234 (round 2) and PR #1236
(round 3, which added the shared vote and the blind); its epic #1204 closes when
Die Brücke is enabled. The decisions behind them are in the handover's §1 and in the issues
themselves; do not re-derive them.

## Opening a sheet

The sheets are **design references**, not app code: inline-styled HTML rendered
by each package's `support.js` (a generated runtime that loads React and Babel from
unpkg). They reference the app's fonts and icons at `../../../public/…`, so they
must be served from the **repository root**:

```bash
python3 -m http.server 3199
# then open http://localhost:3199/docs/design/tisch/Tisch-T3-Runde-Desktop.dc.html
#   or http://localhost:3199/docs/design/ocean/Ocean-O3-Runde-Desktop.dc.html
#   or http://localhost:3199/docs/design/bruecke/Bruecke-B3-Runde-Desktop.dc.html
```

Opening a sheet as a `file://` URL renders a static snapshot with `{{ … }}`
placeholders — the runtime cannot fetch its data that way. Each screen on a sheet
carries a `data-screen-label` (e.g. `T3.2 Hub`); issues and reviews address
screens by that label. Do not lint, format or "fix" `support.js`; it is not part
of the app and lives outside `public/`, so the ESLint frontend blocks do not
cover it.

## From a design package to issues

Every further design arrives as a package like `tisch/` — one sheet per brief
X1–X15 (handover §8). Any session can take it from package to filed issues; this
is the procedure that produced #1188–#1200 for Der Tisch.

1. **Commit the package** under `docs/design/<id>/` with the same asset-path
   rewrite as Tisch (`public/…` → `../../../public/…`), and read its README: the
   designer states what changed and what is open.
2. **Measure, don't read.** Serve the repo root and open each sheet in the
   Browser pane. Load the audit into the page and run it:

   ```js
   await new Promise((res, rej) => { const s = document.createElement('script');
     s.src = '/docs/design/tools/audit.js?' + Date.now(); s.onload = res; s.onerror = rej;
     document.head.appendChild(s); });
   window.__audit()
   ```

   It walks every text node against its **real** background (gradient stops
   included, worst stop counts), applies WCAG 1.4.3 as written (4.5:1, 3:1 from
   24 px / 18.66 px bold), and measures every control against 24 px (44 px on
   the vote card and the dock). Results are keyed by `data-screen-label`.
   Disabled states and the placeholder cover tiles are expected hits — ignore
   those, and only those. Render the full sheets with headless Chrome
   (`--headless=new --screenshot --window-size=<w>,<h>`) for the visual pass;
   the pane shows them too small to judge.

   **The worst-stop rule over-reports on a gradient-led design, and you cannot
   tell the real hits from the false ones without a second pass.** It suits flat
   surfaces like Tisch's felt. Ocean's sheets sit on page-height gradients, and
   the audit reported **31 contrast failures of which 28 were not** — text at the
   light end of a gradient, scored against its dark end. So when a package uses
   gradients behind text, confirm every hit against the pixels that were actually
   painted: set every glyph to `color: transparent`, take **one** screenshot per
   sheet, and read each text node's own box out of it.

   Take the **modal** colour of that box, not its darkest pixel — a neighbouring
   element that overlaps the box otherwise decides the answer. On Ocean the
   darkest-pixel rule invented 19 further ghosts, among them every member
   initial whose box includes its colour ring. Report both: `mode` is the
   finding, a `mode`-passes/`p10`-fails split is a box that straddles something.

   The inverse also happens and reads as a severe failure: a **`mode` far below
   the floor with a tiny `share` while `p10` passes** is text inside its own
   coloured border — the border wins the mode because the glyphs are
   transparent. On Brücke that was a green „Gespielt" stamp at `mode` 1.00,
   `share` 0.11, `p10` 10.66. Rule of thumb: **`share` under ~0.3 and `p10`
   passing → read the markup, don't report it.**

   **`audit.js`'s hit-size pass only sees `button`, `a[href]`, `input`,
   `select` and ARIA roles.** A package that draws its controls as plain `div`s
   is therefore *vacuously* clean — Brücke has **zero** `<button>` against
   Tisch T1's 36 and Ocean O1's 24, and its nine real target failures (including
   a 34 px back control on the vote card) were invisible to the tool. Always run
   a second sweep over control-*shaped* boxes: an element with its own
   background or border, a short label or a lone icon, and no block-level child.
   Report the shapes and judge them — a desktop live-vote top bar sits at the
   24 px floor, not 44.
3. **Check the words** against `handover-vokabular-2026-09-20.md` §1 (never
   renamed) and §2 (may be themed), the evening-word ban, and the app's own
   strings (`public/js/lang/de.js`): the three hub presets, the veto reason
   „1× gar nicht", „Sortiert: Bewertung", the Kümmerliste entries, the settings
   entry. Paraphrases are findings.
4. **Check the IA** against handover §2: screen set complete, the hub's blocks
   and three previews, five entries reachable on every desktop round screen,
   exactly four in the phone dock, the vote card full-screen with a ≥ 44 px back
   control, the top bar (language · inbox · account) everywhere else.

   **Tick the list against the DOM, not against the rendered text.** An entry
   may be an icon with no text at all — Brücke's phone-hub settings entry is a
   bare `ti-settings` in the top bar, which a word-level sweep reports as a
   missing IA block. Where a screen looks like it is missing something, list its
   `i.ti` classes before writing it up.

   **Tick the SESSION LOOP too — all four numbered items of §2, not just the
   vote card.** The rail, the dock, the hub blocks and the vote card are the
   easy half and the one everybody checks. Brücke shipped two accepted review
   rounds with **no live shared vote at all** (§2 item 2: "each person on their
   own phone via link/QR — #1170"), and it surfaced only when the slice issues
   had nothing to cite. Enumerate the screens per package and diff them against
   Tisch's, which is the structural reference every design is cut from.

   **Careful with „Übergabe": it is the name of the closing summary panel on
   every Tisch and Ocean sheet** ("Was T4 entscheidet"), not a screen. Reading
   those ids as drawn handover screens is what made the Brücke review overstate
   its own finding. The pass-device blind is Ocean's **O6.5 „Sichtblende"**, and
   Tisch has none.
5. **Check the source.** Every hex value used in X2–X15 must be declared in X1;
   the marker colours and the score ramp live in X1 and are only *measured* in
   X8. Two sheets citing different contrast numbers for one pair is a finding.
   Exempt, per Tisch A8 and Ocean R4: `#000`/`#fff`, the poster colours of the
   *other* designs on the chooser screen, and colour-vision simulations.

   **Check icons and locales against the repo, never against the package.** A
   package inherits the previous one's `public/` copy, and those copies drift:
   Brücke shipped Ocean's `tabler-icons.css` (108 rules — `anchor`, `droplet`,
   `wave-sine` added, `qrcode` missing, which the app uses at
   `views-session-live.js:329`) and validated „adds no glyph" against it, while
   the repo declares 106. The two lists that settle it are
   `public/fonts/tabler-icons.css` and `public/js/locales.js` — the app's nine
   locales are en de es fr it nl pt **fi ko**, and Brücke's language picker
   drew Polish and Swedish instead. Never commit a package's `public/` folder;
   the sheets point at the real one via `../../../public/`.
6. **Write the review** in `pruefung-tisch-2026-09-20.md`'s format (or
   `pruefung-ocean-2026-09-20.md`'s, which adds the round-1/round-2 table): systemic
   findings (source sheet + every sheet they reach) first, then words and
   content, then IA, then decisions the designer took that the operator must
   confirm. Send it back; a package goes to issues only after the operator's go.
7. **File the slices** as copies of #1188–#1200 with the new design in place of
   Tisch: tokens + components, hub + lobby, Regal + Spielepass + lookup, session
   loop, live vote, account screens, empty states, overlays, tier 2a, tier 2b,
   recap card + icons, motion (droppable, one PR per ritual). No public-surface
   or landing-screenshot slice — the face stays Tisch. Wire `blocked-by`
   relations the same way (`.claude/skills/create-issue/SKILL.md` §6): every
   screen slice on the tokens slice, the flip-equivalent last slice („set
   `enabled: true`") on all of them. Close the design's placeholder epic when it
   is enabled in production.

The Tisch review found that every systemic defect lived in the token sheet and
propagated; that is why steps 2 and 5 come before anything visual. The Ocean
review adds a fourth habit: a package states which of the earlier reviews'
binding rules it has applied, and that claim is checkable — Ocean named four of
the nine and the one it left out (hit sizes) was the one it failed.
