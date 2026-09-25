# Spielwirbel design overhaul — handover to Claude Design

Date: 2026-09-19 (revised the same day: Gilde dropped, Ocean + Forest added, session plan; **vocabulary addendum 2026-09-20** — read `handover-vokabular-2026-09-20.md` with this) · Source project: `Spielwirbel-Konzepte` (Claude Design `272c9f76-…`), exported as `Spielwirbel design overhaul.zip`
Status 2026-09-20: all product decisions are made (section 1). **F0 and O0 are delivered** (`Konzept-G-Forest.dc.html`, `Konzept-H-Ocean.dc.html`, operator approval pending). **T1–T14 delivered and reviewed 2026-09-20** (`pruefung-tisch-2026-09-20.md`): workable as the template. **Next: the A/B corrections from that review in T1/T8 + the named sheets, then T15 (overlays), then phase 2.** This document says what Claude Design delivers, in which **bounded sessions** (section 8), and under which constraints. UI copy in the mocks stays **German**, as in the existing concepts.

---

## 0. How to run this handover — one brief per session

This document is a **plan of numbered briefs** (section 8), not one task. Each brief is sized for a single Claude Design session and must be run as one:

- **Start a session with exactly one brief id** (e.g. „Run T2"). Read that brief's *Inputs*, produce its *Deliverable*, save it under the named file, add a one-paragraph note to the comparison canvas, and **stop**. Do not begin the next brief in the same session, even with headroom left — a brief that dies half-way leaves nothing usable.
- A brief is at most **one component sheet, or ~8 screens at one width, or one state set**. If a brief turns out too large, split it and say so at the top of the deliverable; never merge two.
- Every brief lists the files it reads, so a **fresh session can run it** without the previous session's memory. Prior deliverables are the only shared state.
- File naming: `<Design>-<BriefId>-<Topic>.dc.html`, e.g. `Tisch-T1-Komponenten.dc.html`. The comparison canvas `Spielwirbel-Konzepte.dc.html` is edited only in the concept briefs (O0, F0, K0).

---

## 1. Decisions already made (do not reopen)

| Topic | Decision |
|---|---|
| Who owns the design | **The user, not the round.** Every account picks one design. Rounds no longer carry a design. |
| The set | Six designs — **Der Tisch, Das Programmheft, Die Brücke, Der Run, Ocean, Forest** — plus **Klassisch** (today's cream/orange look, kept permanently as a choice). **Die Gilde is dropped** (file stays in the project, marked „verworfen" like Die Kneipe). **Ocean and Forest are new** and need a concept round first (section 4b). |
| Scheme | **One scheme per design.** Dark: Tisch, Brücke, Run. Light: Programmheft, Ocean, Forest, Klassisch. No light/dark variants. Ocean and Forest are light **by decision**, to balance the set. |
| The face | **Der Tisch** is the logged-out face (landing, login, legal, FAQ, Kontakt, vote-link page, intent pages), the default for every account at launch, and the demo-account default. It drives the app icons, the Open Graph image and the landing screenshots. |
| Navigation | **One information architecture for all seven looks** (section 2). The round screen is the hub; Regal, Chronik, Pokale, the off-shelf lists and settings are sub-pages. Phones keep the four-entry bottom dock. Klassisch adopts the hub too (we build that ourselves — not a Claude Design deliverable). |
| Round identity | A round keeps a **colour marker only** — one of ~8 colours the design defines, auto-assigned at creation, changeable in round settings, shown to everyone in the round inside their own design. No emblem, no image. |
| People colours | The **eight global member colours stay** (`#c6522c #198663 #726bc7 #a66815 #c34d74 #2f6f9e #54821d #993556`). Every design must render them legibly; propose adjusted hexes only where a pair fails, and say which. |
| Rating faces / score ramp | The **five faces stay global** (Tabler `mood-cry, mood-sad, mood-neutral, mood-smile, mood-crazy-happy`, labels „gar nicht" … „unbedingt"). The **five-step colour ramp may be per design** (today: red → green by hue) and must read with colour-vision deficiency. |
| Vocabulary | **Nouns and navigation are Spielwirbel's, the ritual is the theme's** — see `handover-vokabular-2026-09-20.md`, which supersedes the earlier „full in-world" decision. Only the pot word, the two main-action verbs, the vote card wording (question, scale ends, reveal), the lobby greeting and sub-brand line, the notice kicker and decorative notation may be themed. Everything that names a thing or a secondary action stays standard. The FAQ keeps standard names; each design ships a **short glossary** covering only the themed places. |
| Motion | **Designed with each design**, as previewable prototypes the operator watches in Claude Design. Every animation has a static end state that is the reduced-motion fallback. |
| Match report prose | **Later slice.** Every hero and result must work with the structured facts alone (game, winner, score, streak, count); show the prose variant as an overlay, not as the base. |
| Contrast | **WCAG 2.2 as written**: 4.5:1 for text, 3:1 for large text (≥ 24 px regular or ≥ 18.66 px bold), 3:1 for UI components and meaningful graphics. Details in section 5. |
| Viewports | **Phone 390 + desktop 1440** for every tier-1 screen; **tablet only where both are wrong at 768–1024**. Tier 2 at desktop, phone for Chronik, Pokale and the member page. |
| Rollout | Tisch first, complete, then the other five **one at a time** (order set after Tisch). At launch everyone is on Tisch; a **one-time chooser sheet** on first visit offers Klassisch and, later, the others. Picker lives in account settings. No seeding from old rounds; one notice. |
| Old designs | The seven worlds and nine palettes are **retired**. Their colours map onto round markers. Forest and Ocean live on as *designs*, re-conceived at the new tier, not as the old ornament sets. |

---

## 2. The one information architecture every design skins

All seven looks share this structure. A design may change *how* it looks, never *what is reachable from where*.

**Lobby** (`views-home.js`) — the account's rounds as tiles (name, marker colour, member initials, games/sessions counts, last played), the "vote is running" notice, „Neue Runde gründen", footer.

**Round hub** (`views-round.js` + `views-round-start.js`) — one screen:
- the people of the round (name, wins, „Platz dazu")
- the one action: **Session wirbeln**, with the three quick filters (Unter 60 Min · Leichte Kost · Familientauglich)
- last played (game, winner, score, date)
- „Wie wär's mit" (three suggestions with a reason)
- Rundenpuls (12-month bar row), Kümmerliste (games without cover, missing results)
- **previews** of Regal (a handful of covers + count), Pokale (standings) and Chronik (count, last date), each opening its sub-page
- the off-shelf entry points: Aussortiert · Durchgespielt · Wunschliste · Könnte euch gefallen
- settings entry (Einstellungen: name, marker colour, tags, invite, transfer)

**Sub-pages of a round:** Regal (`views-regal.js`, with search, sort, filter panel, bulk select, BGG import, add tile), Chronik (`views-chronik.js`, sessions list; the period recap + share moved to `views-period-recap.js` in #1345), Pokale (`views-pokale.js`, podium + standings), the three off-shelf lists + recommendations (`views-archive.js`, `views-recommend.js`), game detail „Spielepass" (`views-round-detail.js`), add-game lookup (`views-round-lookup.js`), member page (`views-member.js`), round settings (`views-round-settings.js`).

**Reachability rule:** on desktop every round screen carries a persistent way to Hub · Regal · Chronik · Pokale · Einstellungen (Programmheft's section links are the model; a rail or breadcrumb is fine if all five are one click away). On phones the existing dock holds exactly Hub · Regal · Chronik · Pokale.

**Session loop** (`views-session.js`, `views-session-live.js`, `views-session-tables.js`, `views-vote-link.js`):
1. Setup — who plays (seats, guests, „Jemand ohne Spiele?", Teams, Mehrere Tische), the pot (filters, count, „N weitere fehlen, weil ihre Besitzer nicht mitspielen"), how many to draw, the one button.
2. Vote — one card per drawn game per person, secret, 1–5 with faces, progress, back; the **live shared vote** (each person on their own phone via link/QR — `#1170`) and the **unlinked voter page** (`/vote/<token>`, no account, face design only).
3. Result — winner headline, who was there, the table with vote distribution and score, the played game with „Gespielt", change winner / other game / reset, share (recap card), „Noch eine Runde".
4. Multiple tables — the result split across tables.

**Account & social** (`views-account.js`, `views-profile.js`, `views-friends.js`, `views-inbox.js`, `views-news.js`, `views-stats.js`, `views-auth.js`): account settings incl. the **design picker**, profile („Spielerkarte"), friends + feed, inbox (invitations, shares), „Was ist neu", public statistics/Entdecken, login / register / passkey / magic link.

**Logged-out** (face design only): landing (`views-landing.js`, `login.html`), legal pages + FAQ + glossary (server-rendered), Kontakt (`kontakt.html`), vote-link page, the intent page „Was spielen wir heute?" (#1171).

**Not in scope:** the admin panel, e-mail templates.

**Overlays that exist today and need a designed form in every design:** 18 bottom sheets (phone) / popovers (desktop) — add game, edit game, edit member, seat picker, filter panel, invite, transfer, marker picker, teams, guests, tables, period recap, share; ~30 confirm dialogs; toasts; the „…" menu; the language picker (9 locales) in the top bar; the inbox and account entries in the top bar.

---

## 3. Deliverables per design (the checklist the briefs in section 8 are cut from)

### A. Component sheet (before the screens)
- **Tokens:** page, surface, raised surface, ink, soft ink, accent, on-accent, winners' gold (must stay distinct from the accent — gold is the ranking colour on the podium and in the result table), semantic ok / warn / danger, border, shadow, radii, spacing scale, type scale (display + body face with the exact weights used).
- **Components, each with default / hover / focus-visible / disabled / loading:** primary, secondary, ghost and danger buttons; text input, search, select, stepper (+/−), checkbox and toggle; chips and custom round tags (with a Tabler icon); sheet (phone) and popover (desktop) with header, close and scroll; confirm dialog; toast; „…" menu; tabs/segmented control; table (the result „Tafel" with a gold winning row); progress dots and step indicator; avatar (initials on member colour, with the wins badge and the winner crown); cover tile and **no-cover placeholder**; score pill (five ramp stops); rating face row; empty state; skeleton/loading; language picker; footer with FAQ · Kontakt · Impressum · Datenschutz · Nutzungsbedingungen · „Kein Tracking · EU-Hosting" · the **„Powered by BGG" badge** (a licence requirement wherever BGG data appears).

### B. Screens — tier 1 (phone 390 + desktop 1440; tablet where both fail)
Lobby · round hub · Regal · game detail · add-game lookup · session setup · vote card · live shared vote · result · multiple tables · login/register · design picker + **first-run chooser sheet** (poster cards for all seven looks).

### C. Screens — tier 2 (desktop; phone for Chronik, Pokale, member)
Chronik (incl. period recap) · Pokale · member page · profile · friends + feed · inbox · „Was ist neu" · statistics · round settings · off-shelf lists · recommendations.

### D. Empty and young states (most rounds are in one of these)
- Lobby with **exactly one** round, and with none.
- A round with **0 games** (fresh), a round with games and **0 sessions** (imported a shelf, never played), a round after its **first** session (no streaks, no trends).
- The demo round (seeded, fully populated).
- Regal with 40+ games (density), a 12-person round, 30-character round names, long Finnish/French strings (+30 % length on every label).

### E. Round marker colours
About eight per design, each with a name, its rendering (felt, masthead, LED, tide-line, leaf …) on the lobby tile, the hub header, the session screens and the recap card, and a text-on-marker contrast check where text sits on it. Say which one a round gets by default.

### F. Score ramp
Five stops (1 → 5) plus the veto tone below 1, checked for deuteranopia/protanopia/tritanopia; the faces carry meaning, the colour supports it.

### G. Vocabulary
Per `handover-vokabular-2026-09-20.md`: the themed words for exactly the allowed places — the pot word and count question, the two main-action verbs, the vote question, scale ends and reveal verb (the scale words propagate to the result table, the score explanation and the Chronik), the lobby greeting and sub-brand line, the notice kicker — in **German and English** (we translate the other seven locales), plus the short glossary text for those places. Every other word is the standard one. Constraint: never call a session „Abend", „Spielabend", „game night" or a time-of-day word — a test bans those in every locale.

### H. Motion
Each ritual as a previewable prototype (the pot filling, the countdown, the reveal …), each with its static end state. Judged in Claude Design before anything is built.

### I. Recap card
The shareable image (portrait, exported as PNG). **No SVG patterns** in it — WebKit taints the canvas on those.

### J. Fonts
Faces and the exact weights used, all OFL, ≤ 2 faces per design plus Tabler icons. They will be self-hosted (fontsource builds). Single-weight faces must not be faux-bolded.

---

## 4. Tisch-specific (the face — first and fullest)

- **The phone composition.** The round table with seats around it and the pot in the middle has no phone form yet. This is the first screen brief (T2): how the table, the seats, the pot and the shelf stack at 390 px, and what the dock looks like on felt.
- **Real covers.** Replace the uniform gradient tiles on the boards and in the pot with real, uneven cover art (portrait, landscape, busy, and missing) — the shelf lives or dies on this.
- **Contrast on walnut.** Light gold `#f0cf86` on `#3b2a12` is ≈ 9:1 (fine). The brass tones are not: `#b98a55` ≈ 4.5:1 (borderline) and `#9a6d2b` ≈ 3.0:1 fail for small text such as footer links and small caps. Re-tone or enlarge.
- **Logged-out surfaces:** landing (hero, three feature moments, the three steps, screenshot frames), login/register/passkey, legal + FAQ + glossary, Kontakt, the vote-link page, the intent page.
- **Brand assets:** app icon 192/512 + maskable + apple-touch, favicon, Open Graph image, the three landing screenshot compositions (we render them in nine locales).
- **The chooser sheet** shown once to every existing account at launch, in Tisch, offering Klassisch.

## 4b. Ocean and Forest — two new concepts, light, at the same tier as the others

Neither exists yet. Each gets a **concept brief** (O0 / F0) that produces what the other concepts have: a thesis, material & type, a ritual, and the **same six desktop screens** at 1440 (lobby, round hub in the shared IA of section 2, Regal, session setup, vote card, result), plus its entry on the comparison canvas. The operator approves the concept before that design's checklist starts.

Requirements for both:
- **Light scheme**: a pale page, dark ink; contrast per section 5. Run and Brücke already cover the dark end.
- **The same depth as Tisch/Programmheft/Brücke/Run**: rituals for the four moments (start, pot, vote, reveal), a vessel for the pot, a home/lobby framing, a recap card idea — with the theme in the words only where `handover-vokabular-2026-09-20.md` allows it (the pot, the two main actions, the vote card, the lobby voice). Not a palette with ornaments — that is what the retired worlds were.
- **Recognisable descent from the current world**, so the rounds that chose it feel continuity. Seed material from today's registry:
  - **Forest:** page `#ecf1e4`, accent `#356427`, face Averia Serif Libre; vines/trees ornaments, a tree stump as the pot's vessel, the victory scene „a tree grows while fireflies drift up", emblem `ti-trees`. Keep the trees and the fireflies; everything else may change. Watch the collision with Tisch's green felt — Forest's green must read as foliage and light, not as a table.
  - **Ocean:** page `#e4f1f5`, accent `#0e6690` (blue-led by decision, never teal — teal was Dinosaurs'), face Comfortaa; whale/bubbles ornaments, an open clam as the pot's vessel, the victory scene „a whale surfaces among rising bubbles", emblem `ti-fish`. Keep the whale; everything else may change.
- Fonts OFL, ≤ 2 faces; propose the faces with the concept.

---

## 5. Hard constraints (apply to every design)

**Accessibility**
- Text contrast per WCAG 1.4.3 as written (4.5:1; 3:1 from 24 px regular / 18.66 px bold). Accent used as text counts as text. Programmheft's vermilion `#e8451c` is 3.79:1 on its paper — fine for the giant numerals, not for small labels, links or the 3,3 / 3,1 / 2,7 scores drawn in it.
- Soft ink is measured over the **densest pixel of any motif behind it**, not over the plain page. Get boldness from scale and text-free bands, not from alpha under text.
- UI components and meaningful graphics 3:1 (1.4.11). A visible focus ring per design, 3:1 against its surroundings.
- Targets ≥ 24 × 24 px (2.5.8), 44 px on the vote card and the dock.
- Dark designs: the neutral ramp runs upward (surfaces lighter than the page). Light designs: surfaces at or above the page tone, shadows carry depth.
- No information by colour alone; the ramp is paired with the faces and numbers.

**Product**
- „Session" is the entity name in every locale; a design may rename it in-world, never to an evening word (see 3G).
- Body text stays legible at 16 px; Finnish and French run ~30 % longer than German.
- The score is one decimal, comma in German (4,8).
- Covers are hotlinked from providers and vary; every screen needs the no-cover state.
- The „Powered by BGG" badge and the legal footer links are mandatory on every page that shows them today.
- Spielwirbel stays the name; the whirl glyph (Tabler `tornado`) is the app's mark and appears on „Session wirbeln".
- Nine locales, picker in the top bar on every screen.

**Technical shape (so the designs map onto the code)**
- Each design becomes tokens + a root attribute + one override stylesheet loaded on demand. Anything that cannot be expressed as tokens or as a per-design layout of the shared markup costs a design-specific view — name it when you know you are doing it.
- Icons come from the bundled Tabler subset (106 declared today); any Tabler glyph can be added.
- Motion must degrade to its end state under `prefers-reduced-motion`.

---

## 6. Sample data for the mocks

Keep „Donnerstagsrunde" (Marco · Jonas · Lea · Tim, 12 games, 23 sessions, last: Nordlichter, Jonas). Add: „Familie Berger" with 31 imported games and **no** session; a brand-new round with no games; a lobby with one round; a 12-person round with two guests and two teams; a result with a veto („1× gar nicht") and one with a tie; a Regal of 40+ games with mixed real covers and two without.

---

## 7. What we do on our side (not Claude Design)

The hub IA in Klassisch (ships first, so Tisch lands on it) · the architecture spike (tokens + per-design override files, service-worker precache, cache-busting) · the account design field and the per-device fallback for self-hosted instances without accounts · the palette→marker mapping and the one-time notice · the chooser and picker plumbing · translation of vocabulary and glossary into the other seven locales · the admin uptake tile (accounts per design, switch-back) · test reshaping (contrast suite over designs with the large-text carve-out, registry specs, recap card, theme-colour, standalone-page token parity) · FAQ glossary rendering · news entry, docs, landing screenshot rendering in nine locales · retirement of the world CSS, fonts and specs.

---

## 8. The session plan — numbered briefs

Run in this order. Each brief: **Inputs** (files a fresh session reads) → **Deliverable** (one saved file) → stop. „Concept set" means that design's existing six concept screens.

### Phase 0 — canvas and the two new concepts

| Id | Brief | Inputs | Deliverable |
|---|---|---|---|
| **K0** | Canvas cleanup: mark Die Gilde „verworfen" like Die Kneipe, add placeholders for Ocean and Forest, add a „Sessionplan" note listing the brief ids. | this document, `Spielwirbel-Konzepte.dc.html` | updated canvas |
| **V0** ▶ next | Apply the vocabulary addendum to **all six** concept sets: the four older ones by its §4 revert lists, Forest and Ocean by its §1/§2 tables (no specific list exists for them yet — every renamed noun, navigation word or secondary action goes back to the standard word; only the allowed places keep their theme). Words only, visuals untouched, so every later brief starts from compliant screens. **Two designs per session at most**; split as V0a (Tisch, Programmheft), V0b (Brücke, Run), V0c (Forest, Ocean) if needed. | `handover-vokabular-2026-09-20.md`, the six `Konzept-*.dc.html` files | the six files, updated |
| **F0** ✅ | Forest concept (section 4b): thesis, material & type, ritual, six desktop screens at 1440 in the shared IA, canvas entry. **Delivered 2026-09-20**, drawn before the vocabulary addendum — V0 covers it. | this document (§2, §4b, §5, §6), `Ist-Zustand.dc.html`, `Konzept-A-Der-Tisch.dc.html` as the depth reference | `Konzept-G-Forest.dc.html` |
| **O0** ✅ | Ocean concept, same shape. **Delivered 2026-09-20**, drawn before the vocabulary addendum — V0 covers it. | as F0 | `Konzept-H-Ocean.dc.html` |

Operator approves F0 and O0 before F1/O1 run (their V0 pass does not wait for that approval). **V0 runs before T1.** K0 runs whenever convenient; it blocks nothing.

### Phase 1 — Tisch (the face)

| Id | Brief | Inputs | Deliverable |
|---|---|---|---|
| **T1** | Component sheet + tokens (§3A). | §3A, §5, concept set | `Tisch-T1-Komponenten.dc.html` |
| **T2** | Phone core at 390: hub, session setup, vote card, result, the dock on felt (§4 first bullet). | T1, §2, §4 | `Tisch-T2-Phone-Kern.dc.html` |
| **T3** | Round screens, desktop, in the shared IA: lobby, hub (with previews + reachability), Regal with real covers, game detail, add-game lookup. | T1, T2, §2 | `Tisch-T3-Runde-Desktop.dc.html` |
| **T4** | Session screens, desktop: setup, vote card, live shared vote, result, multiple tables. | T1, T2, §2 | `Tisch-T4-Session-Desktop.dc.html` |
| **T5** | Account screens, desktop + phone: login/register/passkey, design picker, first-run chooser sheet (seven poster cards). | T1, §3B | `Tisch-T5-Konto.dc.html` |
| **T6** | Phone for the rest of tier 1: lobby, Regal, game detail, lookup, live vote, tables; tablet only where §1 says so. | T1–T5 | `Tisch-T6-Phone-Rest.dc.html` |
| **T7** | Empty and young states + sample-data variants (§3D, §6), both widths. | T1–T6 | `Tisch-T7-Leerzustaende.dc.html` |
| **T8** | Marker colours (§3E), score ramp (§3F), people-colour check on every Tisch surface. | T1, T3, T4 | `Tisch-T8-Farben.dc.html` |
| **T9** | Vocabulary + glossary per the addendum (§3G), DE + EN: the pot word, the two action verbs, the vote card wording, the lobby voice, the notice kicker. Small for Tisch; may be merged into T8 only if T8 is complete and saved first. | T3, T4, `handover-vokabular-2026-09-20.md` | `Tisch-T9-Vokabular.dc.html` |
| **T10** | Motion prototypes (§3H) with static end states. | T2–T4 | `Tisch-T10-Motion.dc.html` |
| **T11** | Recap card (§3I) + brand assets: icons, favicon, OG image, three landing screenshot compositions. | T1, T4, T8 | `Tisch-T11-Karte-Marke.dc.html` |
| **T12** | Logged-out surfaces: landing, login page, legal + FAQ + glossary, Kontakt, vote-link page, intent page (§4). | T1, T5, T11 | `Tisch-T12-Oeffentlich.dc.html` |
| **T13** | Tier 2, part 1: Chronik + period recap, Pokale, member page (desktop + phone), off-shelf lists, recommendations. | T1, T3 | `Tisch-T13-Tier2a.dc.html` |
| **T14** | Tier 2, part 2: profile, friends + feed, inbox, „Was ist neu", statistics, round settings incl. marker picker. | T1, T3, T8 | `Tisch-T14-Tier2b.dc.html` |
| **T15a** | Overlays, part 1: the 18 sheets (phone) / popovers (desktop) drawn out — seat picker, filter panel, teams, guests, tables, add/edit game, edit member, invite, transfer, marker picker, period recap, share. | T1, T3, T4 | `Tisch-T15a-Sheets.dc.html` |
| **T15b** | Overlays, part 2: confirm dialogs (the ~30 grouped by shape), toasts, the „…" menu, the language picker open. | T1 | `Tisch-T15b-Dialoge.dc.html` |

### Phase 2 — the other five, one design at a time

Order set after Tisch ships. For each design X ∈ {Programmheft **P**, Brücke **B**, Run **R**, Ocean **O**, Forest **F**}, the same sequence with ids **X1–X10, X13, X14** (no X11 brand assets, no X12 public surfaces — those are face-only; the recap card moves into X8). Inputs are the design's concept set plus the corresponding Tisch brief as the **structural** reference (same screens, same IA, same states), never as a visual one.

| Id | Brief |
|---|---|
| X1 | Component sheet + tokens |
| X2 | Phone core at 390 |
| X3 | Round screens, desktop |
| X4 | Session screens, desktop |
| X5 | Account screens: login/register, design picker, chooser sheet in this design |
| X6 | Phone for the rest of tier 1 |
| X7 | Empty and young states |
| X8 | Marker colours, score ramp, people-colour check, recap card |
| X9 | Vocabulary + glossary per the addendum (largest for Brücke and Run; propagate the scale words to result table, score text and Chronik) |
| X10 | Motion prototypes |
| X13 / X14 | Tier 2, parts 1 and 2 |
| X15a / X15b | Overlays: sheets/popovers; dialogs, toasts, menu |

Roughly 16 briefs for Tisch and 14 per further design, plus phase 0. That is the size of the work; it is not one session.

### Rules added after the Tisch review (2026-09-20) — binding for every further design

1. **X1 is the source, really.** Marker colours and every surface token live in X1; X8 only measures. Cover placeholders are non-tokens (grey, marked „Cover") so nobody implements them.
2. **Accent on the marker colour only at ≥ 24 px or as a glyph.** Text on the marker surface is paper/ink. (Tisch: gold on the light felt stop measured 4.2:1 and was used at 12 px in the dock.)
3. **No text on a cover image.** Meta lines sit on an opaque band.
4. **Text links 24 px, footer rows 32 px, toast actions 24 px** — as tokens in X1, not as per-sheet fixes.
5. **Copy app strings verbatim, never paraphrase:** the three hub presets („Unter 60 Min · Leichte Kost · Familientauglich"), the veto reason („1× gar nicht"), „Sortiert: Bewertung", the Kümmerliste entries, „Einstellungen · <Marker> · Tags · Einladen". Invented sample content is marked as such.
6. **Glossary only when the design renames something.**
7. **The vote card is full-screen without dock and top bar, back control ≥ 44 px** — the rule, not an exception; the same for `/vote/<token>`.
8. **One sheet computes a contrast number, the others cite it.** Tisch's T2 and T8 gave different values for the same pair.
