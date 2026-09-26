# Handover to Claude Design — „Abzeichen" (achievements), brief X17 for every design

Spielwirbel · 2026-09-26 · companion to `handover-claude-design-2026-09-19.md` (§1 decisions, §2 IA, §5 hard constraints, §8 brief plan) and `handover-vokabular-2026-09-20.md`. Everything in those two files binds here too. **One brief per session** as before: T17 (Tisch), O17 (Ocean), B17 (Brücke), then P17 / R17 / F17 when those packages are drawn. Klassisch (K17) is built by us — structure only, visuals as today — so it needs no sheet, but every X17 must state which shared markup it skins.

> **Decided by the operator on 2026-09-26 (do not reopen):**
>
> | Question | Decision |
> |---|---|
> | Noun | **„Abzeichen"** — one word in every design, on every label |
> | Holders | **member of a round + the round + the account tier** (cross-round, on the Spielerkarte) |
> | Catalogue | the **★ core set** (about 20) for the first release; the un-starred rows stay in this file as the backlog |
> | Locked entries | **visible, with condition and progress** („Stammgast 24 / 25") |
> | Secret entries | **yes, up to three** (a „?" tile, no condition until earned) |
> | A10 „Strenges Urteil" | **out** — the catalogue rewards play, not vetoes |
> | Account tier | Sessions 25 · 100 · 500, Wins 10 · 50, Runden 2 · 5, Jahre 1 · 2 · 3; visible to **self + friends**, totals only |
> | Friends' feed | **account-tier earnings only** post to the feed; round marks never leave the round |
> | Result moment | **members and round, at most two**, the rest folds into „+N weitere" |
>
> Entry names are working names; the operator may still rename individual entries when the strings are written.

---

## 1. What the feature is

A small set of **earned marks** a person or a round collects by playing. They are **derived** from what the app already records — finished sessions, winners, votes, the shelf — never awarded for settings, logins or visiting daily. There is no shop, no points, no daily streak, no push. Spielwirbel's framing holds: the app is a group's shared memory of its evenings, and an Abzeichen is one more thing that memory can say.

**Three holders**

| Holder | Where the record lives today | Visibility |
|---|---|---|
| **a member of a round** (a seat, e.g. Lea in „Donnerstagsrunde") | member page „Tischkarte", Pokale standings | everyone in the round |
| **the round itself** (the group) | Pokale, hub previews, Chronik | everyone in the round |
| **an account across all its rounds** (decided in) | profile „Spielerkarte", `lib/user-stats.js` aggregates | self + friends, as the profile stats today: totals only, never round names or other people |

Games are **not** a holder: the Spielepass already carries its stamps (#1040) and the Pokale their Plaketten (Meistgespielt · Bestbewertet · Siegesserie · Staubfänger). Don't duplicate those as Abzeichen.

**Shape of one entry**: a **glyph** (Tabler subset, any glyph can be added), a **name** (≤ 18 characters in German, Finnish +30 %), a **one-line condition** („10 Sessions mitgespielt"), an optional **progress** for count entries (7 / 10), the **date and session it was earned at** (derived: the first session that satisfied it), and for a few entries a **tier** (three at most, e.g. 10 · 25 · 50 — one glyph, the tier as a numeral or a ring, never a colour alone).

**States** every design must draw: earned · in progress (with count) · locked-but-visible (condition shown) · **secret** (a „?" tile with no condition until earned, at most three per catalogue) · the **moment of earning** (result screen) · the empty state (a round with no finished session shows nothing but one line, no wall of grey padlocks).

---

## 2. The catalogue (★ = first release; the rest is backlog)

Every entry is computable from `round.sessions` (finished, createdAt, winnerIds, votes 1–5 incl. the veto „gar nicht", guests, teams, tables, direct-pick), `round.games` (createdAt, retired, completed, cover, BGG link, expansions, owners, tags) and `round.members`. Nothing below needs a new stored field. **Marked ★ = my recommended core set (about 20)** so the first release is small enough to be read.

### A. Member of a round (per seat)

| # | Working name | Condition | Notes |
|---|---|---|---|
| A1 ★ | **Erster Sieg** | first session won | the one everybody gets; the earning moment should be the warmest |
| A2 ★ | **Stammgast** 10 · 25 · 50 | sessions played | tiered |
| A3 ★ | **Serienheld** | 3 wins in a row | the Pokale plaque „Siegesserie" shows the *current* run; this is the one-time mark for having done it |
| A4 ★ | **Vielseitig** 3 · 6 · 10 | won with N different games | tiered |
| A5 ★ | **Alles gespielt** | played every game currently on the shelf at least once | re-lockable when a game is added? No — earned stays earned; date it |
| A6 ★ | **Teamgeist** | won as part of a team | needs #575 teams data |
| A7 ★ | **Gastgeber** | own box was the played game 10 times | needs box owners; a real „thanks for bringing it" mark |
| A8 ★ | **Comeback** | won after 10 or more sessions without a win | good story, cheap to compute |
| A9 | **Erste Wahl** | the game you rated 5 won the vote 10 times | „the group agrees with you" |
| A11 ★ | **Entdecker** | first to play a game within 7 days of it being added, 5 times | |
| A12 | **Ganzes Jahr** | a session in each of 12 consecutive months | |
| A13 | **Zwei Tische** | won at a multi-table session | |
| A14 | **Außenseitersieg** | won with the game that scored lowest in that vote | direct-pick sessions excluded |
| A15 ★ | **Hundert** (secret) | 100 sessions | secret tier of A2, or its own |

### B. The round (the group)

| # | Working name | Condition | Notes |
|---|---|---|---|
| B1 ★ | **Gegründet** | first finished session | dated; the round's birthday mark |
| B2 ★ | **Sessions** 10 · 50 · 100 · 250 | finished sessions | tiered, the round's spine |
| B3 ★ | **Regal** 25 · 50 · 100 | games on the shelf (active) | tiered |
| B4 ★ | **Einstimmig** | every voter gave the winning game the same top rating | rare, worth a moment |
| B5 ★ | **Unentschieden** | a tied vote result | |
| B6 ★ | **Große Runde** | a session with 8 or more people at the table | guests count |
| B7 | **Zwei Tische** | first multi-table session | |
| B8 ★ | **Durchgespielt** | first game marked completed | |
| B9 | **Erweitert** | an owned expansion recorded | |
| B10 ★ | **Dauerbrenner** | one game reaches 10 plays | names the game in the condition line |
| B11 | **Aufgeräumt** | Kümmerliste empty with 20+ games (every cover, every result recorded) | rewards care, a round-hygiene mark |
| B12 | **Geteilt** | round shared with a second account (#207) | |
| B13 | **Jahrgang** | a session in every month of a calendar year | the round-level twin of A12 |
| B14 ★ | **Rückblick geteilt** | first period recap shared (#800) | |
| B15 | **Vollständig** (secret) | every shelf game played at least once with 20+ games | |

### C. Account across rounds (DECIDED in — all four)

| # | Working name | Condition |
|---|---|---|
| C1 ★ | **Sessions** 25 · 100 · 500 | sessions played across all rounds |
| C2 ★ | **Siege** 10 · 50 | wins across all rounds |
| C3 ★ | **Runden** 2 · 5 | rounds the account holds a seat in |
| C4 ★ | **Jahre** 1 · 2 · 3 | years since the account was created — the one non-play entry, an anniversary |

Visible on the Spielerkarte to self and friends, totals only (the profile-stats rule). **These four are the only earnings that reach the friends' feed.** No badge for passkeys, designs, invitations or anything under Konto — settings are not play.

**Deliberately absent**: daily/weekly streaks, „log in", „invite 3 friends", anything negative about another person (never „lost 10 in a row"), anything by clock time (the app stores no time-of-day intent), anything tied to money or the BGG rank.

---

## 3. The placements — identical IA in every design (§2 rule: the design changes *how*, never *what is reachable*)

1. **Pokale sub-page** — a new **section „Abzeichen"** below the podium and the four Plaketten: the round's marks first (B), then one row per member (A) in standings order. Phone: one column, member rows collapsible. Desktop 1440: the round's marks as a band, members as a grid. **This is the home of the feature**; everything else is a preview or a moment.
2. **Hub Pokale preview** — one extra line: „3 neue Abzeichen seit Nordlichter" or the round's newest mark as a glyph. Opens the Pokale page.
3. **Member page „Tischkarte" (#1074)** — the member's earned marks as a row inside the card, under the five figures; tap → the Pokale section scrolled to that member. Locked entries are **not** shown here (the card is about who they are, not what they lack).
4. **Result screen — the moment.** After the winner headline and before the table: **at most two** marks earned by this session (any holder), the rest folded into „+3 weitere" that opens the Pokale section. The earning moment is the one place for motion (see §5). Motion degrades to the end state under `prefers-reduced-motion`. Never a modal, never blocks „Noch eine Runde".
5. **Chronik** — one line per earning at the session that produced it („Lea · Erster Sieg"), same row grammar as today's entries. Derived, so it needs no new activity type.
6. **Spielerkarte / profile** — the account-level marks as a row under the totals; friends see them, strangers don't.
7. **Recap card** (share image, optional) — the marks earned in the period as a small row; opt-in per design, not required.

Not placed: the lobby (a round tile stays a round tile), the vote card (full-screen, no chrome, rule 7), the dock (exactly four entries), the top bar.

---

## 4. Vocabulary (the 2026-09-20 rule applies unchanged)

- **The noun is Spielwirbel's** and appears on the section title, the hub preview line, the Chronik row and every label: **one word, the same in all six designs** — **„Abzeichen"** (decided).
- **The form is the design's**: a pin, a pearl, an insignia, a sticker, a printed stamp, a leaf. That is decorative notation — it may shape the glyph tile and the motion, it never becomes a label or a button. No design writes „Deine Perlen" as a heading.
- Entry names are app strings, standard in every design (they get translated into nine locales by us). The condition line likewise.
- No glossary entry needed unless a design renames something — it shouldn't.

---

## 5. Per design — the form I'd start from (proposals; the design decides within its own sheet)

Each X17 sheet: the tile component in all six states at 390 and 1440 · the Pokale section (round band + member rows) · the Tischkarte row · the result moment as a previewable prototype (end state + reduced-motion) · the hub preview line · the Chronik row · empty state · one density case (a member with 14 marks, a name in Finnish) · a contrast table computed once (rule 8).

| Design | Form of a mark | Where it sits in the design's own language | The earning moment (motion, watched at design time) |
|---|---|---|---|
| **Klassisch** | plain chip: glyph disc + name, tone from the member colour | today's `.card` grid under the podium | a toast with the glyph, no animation — we build this ourselves |
| **Der Tisch** | **enamel pin / brass coin** on the felt; earned = brass with the glyph engraved, locked = a shallow felt recess of the same shape | the Pokale's Plaketten column (T13.2) gains a **pin board** beneath; on the Tischkarte the pins sit along the card's lower edge like on a lapel | the pin **drops onto the felt** and settles with a short shadow bounce; sound-free; reduced motion = pin already in place |
| **Ocean** | **pearl** in a half-open Muschel; earned = pearl with a soft highlight, in progress = the shell ajar with a smaller pearl forming, secret = a closed shell | Pokale O13.2: a **string of pearls** per member under the standings; round marks in a shell row under the „Seit Oktober 2025 · 23 Sessions" line; hub preview shows the newest pearl in the Pokale tile | a **bubble rises** from the result table and bursts into the pearl beside the winner headline; the whale (O10.2) must not be upstaged — the pearl arrives after it surfaces |
| **Die Brücke** | **service insignia / rank bar** — a slim rectangular plate with the glyph, tiered by the number of bars, locked = outline plate | the crew roster (B13.2 Mitgliedsseite) carries insignia under the name; Pokale gets a **„Verdienste" panel** with the round's plates in a HUD frame | a **HUD flash** outlines the plate, then it slides into the roster row; reduced motion = plate present |
| **Der Run** | **sticker / patch** with a neon edge on the member's ID card; secret = a redacted sticker | sticker wall on the Pokale page, ID card on the member page | **glitch reveal**: two frames of offset RGB, then still; strictly under 400 ms and never on text |
| **Das Programmheft** | **printed medallion / rubber stamp** in the paper's ink, vermilion only ≥ 24 px (§5 contrast) | a boxed **„Auszeichnungen" column** on the Pokale page in the gazette grid; on the member page a byline row of medallions; the round's marks as a masthead strip | a **stamp press**: scale from 1.15 to 1.0 with a one-frame ink bleed; a big unlock (Sessions 100) may run as a „Sonderausgabe" banner across the result |
| **Forest** | **leaf** or **firefly** — earned = a lit firefly in a jar / a full leaf, in progress = a bud, secret = a dark spot in the jar | a **jar per member** on the Pokale page (the round's marks as leaves on one branch above); on the member page the jar sits beside the avatar | a **firefly lands** in the jar and glows once; reduced motion = glowing already |

Two cautions carried from the reviews: **no text on the mark's motif** (soft ink over a pearl highlight or a brass glare fails §5 — put names on the opaque band beside the mark), and **accent on the marker colour only ≥ 24 px or as a glyph**.

---

## 6. Hard constraints for X17 (in addition to §5 of the main handover)

- Every state distinguishable **without colour**: earned vs locked by fill/outline and the glyph, tiers by a numeral or bar count.
- The mark tile is a **target ≥ 24 × 24**, and a **button** (it opens the condition); the section is keyboard-reachable in reading order.
- The result moment **never delays** the result: it renders after the winner headline, costs no tap, and „Noch eine Runde" is reachable throughout.
- Progress counts and dates use the app's formats (comma decimal, `fmtMonth`).
- The Pokale page must still work with **zero** marks (a young round) and with **60+** (a 12-person round after two years) — draw both.
- Sample data: „Donnerstagsrunde" (Marco · Jonas · Lea · Tim, 12 games, 23 sessions): Lea has Erster Sieg, Stammgast 10, Teamgeist; the round has Gegründet, Sessions 10, Unentschieden; Jonas is at 24 / 25 Stammgast. Plus the 12-person density round and „Familie Berger" with no session.

---

## 7. What we do on our side (not Claude Design)

The catalogue decision and the noun · the pure derivation module (`achievements.js`, computed on demand from sessions like `gameStats` — nothing stored, the „new since" comparison at finish time) · the shared markup in Klassisch (K17) · translations into nine locales · the Chronik row · the FAQ answer · the „Was ist neu" entry · an admin „Funktionsnutzung" figure if one is meaningful (probably none — earning is automatic, so uptake cannot be measured) · the legal check (derived data, no new category; the friends-feed event for an account-tier earning is a new allowlisted `feed_events` kind and gets `keep-legal-docs-current.md` treatment in its slice).

## 8. Decided — nothing open for the first X17 session

All questions this section used to hold are answered in the table at the top. What remains is design work: the six states, the seven placements, the earning moment per design, and the density case. The file is not committed to `docs/design/` yet; it arrives there with the first X17 package.
