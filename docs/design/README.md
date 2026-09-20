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
| `tools/audit.js` | The contrast + hit-size audit that measured the Tisch sheets (see below). |

The issues that implement the programme start at #1184 (the design layer) and
end at #1202 (the flip); #1203–#1207 are one placeholder epic per remaining
design. The decisions behind them are in the handover's §1 and in the issues
themselves; do not re-derive them.

## Opening a sheet

The sheets are **design references**, not app code: inline-styled HTML rendered
by `tisch/support.js` (a generated runtime that loads React and Babel from
unpkg). They reference the app's fonts and icons at `../../../public/…`, so they
must be served from the **repository root**:

```bash
python3 -m http.server 3199
# then open http://localhost:3199/docs/design/tisch/Tisch-T3-Runde-Desktop.dc.html
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
3. **Check the words** against `handover-vokabular-2026-09-20.md` §1 (never
   renamed) and §2 (may be themed), the evening-word ban, and the app's own
   strings (`public/js/lang/de.js`): the three hub presets, the veto reason
   „1× gar nicht", „Sortiert: Bewertung", the Kümmerliste entries, the settings
   entry. Paraphrases are findings.
4. **Check the IA** against handover §2: screen set complete, the hub's blocks
   and three previews, five entries reachable on every desktop round screen,
   exactly four in the phone dock, the vote card full-screen with a ≥ 44 px back
   control, the top bar (language · inbox · account) everywhere else.
5. **Check the source.** Every hex value used in X2–X15 must be declared in X1;
   the marker colours and the score ramp live in X1 and are only *measured* in
   X8. Two sheets citing different contrast numbers for one pair is a finding.
6. **Write the review** in `pruefung-tisch-2026-09-20.md`'s format: systemic
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
propagated; that is why steps 2 and 5 come before anything visual.
