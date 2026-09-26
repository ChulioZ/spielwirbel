# Prüfung „Das Programmheft" (P1–P15b) — Runden 1 und 2

Datum: 2026-09-26 · Runden 1 und 2 · Geprüft gegen `handover-claude-design-2026-09-19.md`,
`handover-vokabular-2026-09-20.md`, `pruefung-tisch-2026-09-20.md`,
`pruefung-ocean-2026-09-20.md`, `pruefung-bruecke-2026-09-22.md` und den Code der App
(Stand `main` vom 26.09., `f17d99e`).

## Runde 2 (26.09.2026) — Ergebnis

Geprüft: `programmheft2.zip`. Fünfzehn Blätter wurden geändert, Kopf, Telefonkopf, Dock
und Fuß sind byte-gleich geblieben. Die README listet jeden Punkt aus Runde 1 mit seiner
Einarbeitung. **Jeder Punkt wurde nachgemessen**, nicht aus der README übernommen.
Dieselben Werkzeuge wie in Runde 1: `audit.js` mit Kontrolle, Trefferflächen,
Hex gegen P1, Icons gegen das Repo, Anton-Regel, überlappende Textboxen und
Sichtprüfung am Bild.

**Urteil: abgenommen, empfohlen mit einer Auflage für die Umsetzung.**
Von den vierzehn Funden aus Runde 1 sind **dreizehn erledigt**. Übrig ist eine
Kleinigkeit im Auswahl-Sheet (R2-1), dazu ein Wortrest auf dem Konzeptblatt (R2-2).

| | Runde 1 | Runde 2 |
|---|---|---|
| Echte Kontrastfehler | 0 | **0** (Kontrolle erneut 3/3) |
| Bedienelemente unter ihrer Trefferfläche | 0 | **0** (dieselben erklärten Werkzeugmeldungen; Wertungskarte, Sichtblende, Dock ≥ 44 px) |
| Hexwerte in P2–P15b ohne Deklaration in P1 | 7 | **0** |
| Glyphen, die im Repo-Subset fehlen | 0 | **0** (67 Klassen) |
| Anton gefettet oder unter 24 px | 13 Stellen | **0** |
| Kollisionen durch Durchschuss | 3 Stellen | **0** (Topf-Ziffer, „, Kicker) |
| Wort- und Inhaltsfunde | 6 | **1** Rest (R2-2) |
| Fehlende Overlays | 1 (Gast) | **0** (P15a Sheet 14) |

**Die Punkte aus Runde 1, nachgemessen**

- **S1** ✓ Alle acht Personenfarben in P1.1, als „global" gekennzeichnet.
- **S2** ✓ `box-ink-soft` `#cfccc5` ersetzt beide Grautöne (12,1:1 auf `#141414`), `hatch`
  ist deklariert, die Plakatfarben stehen als `poster-*` in P1. **Null** Hexwerte außerhalb von P1.
- **S3** ✓ Keine Anton-Stelle mehr auf 700 oder unter 24 px. Die P15a-Aktionen stehen auf
  24 px, die Minivorschau in P8.2 ist Archivo. Die Knopfregel steht in P1.3.
- **S4** ✓ Durchschuss-Tokens in P1.2. Die Topf-Ziffer (P2.2, P4.1, P7.7) steht frei neben
  ihrem Etikett. Das „ in P7.9 berührt die Zeile darunter nicht mehr. Der Kicker im
  Auswahl-Sheet hat 12 px Luft.
- **S5 / E2** ✓ README-Entscheidung 4 berichtigt: Ocker `#a8761a`, **Tinte** darauf 4,6:1.
- **W1** ✓ Der Offline-Toast ist weg, der P15b-Kopf behauptet nicht mehr „alle Sätze aus de.js".
- **W2** ✓ „Noch eine Session" auf P1, P2, P4, P6. Rest auf dem Konzeptblatt, siehe R2-2.
- **W3 / W4** ✓ Neue Wörter sind in P9.5 gelistet, jeweils mit dem nächsten App-Wortlaut.
- **W5 / E1** ✓ Die Schrittleiste ist auf P2.2, P4.1 und im Bauteil P1.6 entfernt. „Losen" kommt nicht mehr vor.
- **W6** ✓ Das Konzeptblatt sagt nicht mehr „Heute Abend"/„Besetzungsliste". „Heute Abend"
  steht nur noch in P1.8 und P9, als zitiertes Sperrwort.
- **I1** ✓ P15a Sheet 14 „Gast hinzufügen", wörtlich aus `de.js`
  (`startSession.guestAddTitle`, „Name des Gasts", `guestsNote`, „Hinzufügen"). Gemessen:
  0 Kontrastfehler, Aktion 24 px Anton.
- **I2** ✓ P1.4 zeigt alle vier Schnellstarts in DE und FI mit Umbruch, ohne Kürzung.

**Was offen bleibt**

| # | Datei · Screen | Befund | Messwert | Vorschlag |
|---|---|---|---|---|
| R2-1 | P5.4 Auswahl-Sheet | Das Wortbild **„DAS PROGRAMMHEFT"** läuft auf dem gewählten Plakat über dessen Rahmen hinaus. Das „T" steht auf bzw. hinter der rechten Kante. | 8 px über den Rahmen | Die Plakate zeichnet in der App der Code (`wordmarkKey`, #1277), nicht das Blatt. **Empfehlung: als Auflage in die Umsetzung**: Das längste Wortbild muss in die Kachel passen (Schriftgröße anpassen oder zweizeilig). Keine Runde 3 nur dafür. |
| R2-2 | Konzeptblatt C | Der Ergebnis-Knopf sagt noch **„Noch eine Runde"**. | — | „Noch eine Session". Das Konzeptblatt ist Referenz, kein Umsetzungsblatt. Bei der Übernahme ins Repo berichtigen. |

**Beobachtungen, keine Funde**

- P1.4: Der letzte Reiter „Regal-Änderungen" bricht zweizeilig um und steht knapp an der
  Rahmenkante. In der App ist das eine Frage der Reiterbreite, nicht des Designs.
- P7-Kopf nennt in der Dichtenotiz noch „Besetzungsliste". Nach Entscheidung 10 ist das
  Zeichenhilfe, kein UI-Text.
- Das Paket enthält unter `vorgaben/` jetzt diese Prüfung. Bei der Übernahme ins Repo
  gehört sie nach `docs/design/`, nicht in den Paketordner (wie bei Tisch, Ocean und Brücke).

**Übernommen (26.09.2026):** Paket in `docs/design/programmheft/` (Pfade auf `../../../public/`, `support.js` unverändert, `vorgaben/` nicht übernommen — die Dateien liegen bereits in `docs/design/`), R2-2 dabei berichtigt. Die Slices sind #1371–#1383 unter Epic #1203; R2-1 ist Auflage in #1376.

---

# Runde 1

**Methode.** Alle vierzehn Blätter plus Konzeptblatt und die vier Bauteile in Chromium
gerendert, mit den echten Schriften (Anton, Archivo) und dem Repo-`public/`.
- Kontrast mit `docs/design/tools/audit.js` pro Textknoten gegen den tatsächlichen Grund.
  Das Programmheft steht auf flachem Papier, ohne seitenhohe Verläufe. Die pixelgenaue
  Zweitmessung (Ocean-Regel) war deshalb nicht nötig.
- Trefferflächen aus dem gerenderten Layout über **1 140 Bedienelemente** (`a`, `input`,
  `button`). Wertungskarte, Sichtblende und Dock wurden zusätzlich getrennt gegen 44 px
  gemessen. Die Heuristik von `audit.js` erkennt dort nur Screens, deren Label
  „Wertung", „Dock" oder „Abstimmung ohne" enthält. P2.3/P4.2 „Abstimmung" fielen sonst
  unter die 24-px-Grenze.
- Zweite Sweep-Runde über `div`/`span` mit Zeiger-Cursor außerhalb eines Links (Brücke-Nachtrag).
- Überlappende Textboxen und Text, der aus seinem gerahmten Kasten läuft, über alle Blätter.
  Jeder Treffer wurde am Bild bestätigt.
- Wortlaut gegen `public/js/lang/de.js` und `fi.js`.
- Hexwerte aus P2–P15b gegen P1.
- Icons gegen `public/fonts/tabler-icons.css` des **Repos**.

**Messgerät kontrolliert.** Auf P3.2, einem sauber messenden Screen, habe ich drei
Textknoten absichtlich eingefärbt. Gemeldet wurden **genau diese drei** (1,65 · 1,98 ·
3,79:1). Auf dem Konzeptblatt, das vor den Regeln entstand, meldet dasselbe Werkzeug 69
Treffer. Die Nullen unten sind also gemessen und keine blinden Stellen.

## Urteil

**Nicht abgenommen, aber nah dran.** Kontrast, Trefferflächen, Icons, Sprachen und IA
sind sauber. Das ist die bisher beste Erstlieferung. Offen sind **vier systemische
Funde**, die alle in P1 oder in der Satzregel für Anton wurzeln, dazu **sechs Wort- und
Inhaltsfunde** und **ein fehlendes Sheet**. Die zwei offenen Entscheidungen hat der
Auftraggeber getroffen (siehe „Entscheidungen des Auftraggebers").

| | Runde 1 |
|---|---|
| Echte Kontrastfehler | **0** (Kontrolle 3/3) |
| Bedienelemente unter ihrer Trefferfläche | **0** (7 Meldungen des Werkzeugs, alle erklärt, siehe unten) |
| Bedienelemente als `div` | **0** |
| Hexwerte in P2–P15b ohne Deklaration in P1 | **7** (4 Personenfarben, 3 Grautöne) |
| Glyphen, die im Repo-Subset fehlen | **0** von 68 |
| Sprachen im Wähler ≠ Repo | **0** (neun, mit fi und ko) |
| Wort- und Inhaltsfunde | **6** |
| Fehlende IA-Blöcke / Screens der Session-Schleife | **0** |
| Fehlende Overlays | **1** (Gast) |
| Fehlende Dichtebelege | **0** (P7.7–P7.10) |

Was richtig ist und so bleiben soll:
- **Alle Bedienelemente sind echte `<a>`/`<input>`**, die Felder stecken in 44/56 px hohen `<label>`s.
- **Wertungskarte vollbildig**, ohne Kopf und Dock, alle Bedienelemente ≥ 44 px (P2.3, P4.2).
- **Die Session-Schleife ist vollständig**: geteilte Wertung (P4.5, P6.5), Sichtblende
  (P4.6, P6.6), mehrere Tische (P4.4, P6.7). Das hatte die Brücke erst in Runde 3.
- **App-Wortlaut fast überall wörtlich**: 31 von 36 geprüften Strings stehen so in `de.js`,
  der finnische Hub (P7.10) sogar vollständig so in `fi.js`.
- **Die Rampe fällt monoton in der Luminanz**, P8.3 belegt sie unter drei
  Farbfehlsichtigkeiten und in Graustufen.
- **Die Rückblickkarte** kommt ohne SVG-Muster aus. Das vermeidet ausdrücklich die
  WebKit-Canvas-Falle aus dem Repo.

---

## Systemische Funde (Quelle P1, wirkt auf mehrere Blätter)

| # | Datei · Screen | Befund | Messwert | Vorschlag |
|---|---|---|---|---|
| S1 | P1.1 → P3, P4, P6, P7, P8, P15a | **Vier der acht globalen Personenfarben fehlen in P1.** P1 führt `#c6522c #198663 #726bc7 #a66815`, die Blätter nutzen alle acht. | fehlen: `#c34d74 #2f6f9e #54821d #993556` | Alle acht in P1.1 als Tokens, mit dem Hinweis „global, nicht vom Design". |
| S2 | P1.1 → P2.1, P3.2, P4, P7, P13.1 | **Weiche Schrift im schwarzen Kasten hat kein Token.** „Schnellstart" und die Kennzahlen-Etiketten im Rückblick nutzen `#b9b8b4` bzw. `#e7e5df`. Die Schraffur der leeren Kachel (P7) nutzt `#efece4`. | `#b9b8b4` auf `#141414` 9,3:1 · `#e7e5df` 14,6:1 · beide bestehen | Ein Token `box-ink-soft` (ein Wert) in P1.1, dazu `#efece4` als Muster-Token oder als `hair`. |
| S3 | P1.2 (Satzregel) → P1.6, P2.2, P4.1, P7.7, P8.2, P13.7, P14.5, P15a | **Die eigene Regel „Anton 400, nie fetten, immer ≥ 24 px" wird gebrochen.** Anton auf 700 erzeugt einen synthetischen Fettschnitt. | 700: P1.6-Ziffern (24 px), P2.2-Schrittziffern (20 px), P4.1 (24 px), P7.7 „Team 1/2" (26 px), P13.7-Zahlen (22 px). Unter 24 px: P2.2 20 px, P13.7/P14.5 22 px, **alle P15a-Hauptknöpfe 22 px**, P8.2 Minivorschau 16 px | Entweder die Regel einhalten (≥ 24 px, 400) oder für Knöpfe ausdrücklich Archivo 700 setzen. P15a sollte das an einer Stelle in P1.3 entscheiden, damit dreizehn Sheets folgen. |
| S4 | P1.2 → P2.2, P5.4, P3.2, P7.9, P8.4 | **Anton mit sehr engem Durchschuss kollidiert.** (a) Die Riesenziffer des Topfs überdeckt ihr eigenes Etikett. (b) Das tiefgestellte deutsche „ ragt in die Zeile darunter. (c) Im Auswahl-Sheet läuft die Kicker-Zeile in die Überschrift. | (a) P2.2: „9" (120 px) über „Spiele im Topf" (16 × 27 px Überdeckung). (b) P7.9 „„SALZWIESEN“" berührt das G von „GESPIELT", ähnlich P3.2/P8.4. (c) P5.4 „Neu in Spielwirbel" × „Wähl dir ein Design." 11 px, P5.5 7 px | Zeilenhöhe für Anton-Überschriften als Token in P1.2 (z. B. 0,92 statt ~0,85), Abstand Kicker → Überschrift als Token. Für „ entweder Anführung außerhalb des Satzspiegels hängen lassen oder die erste Zeile mit mehr Vorlauf. |

**S5 — README und Blätter widersprechen sich beim Ocker-Marker.** Entscheidung 4 der
README sagt „abgedunkelt von #a8761a auf **#a8761a**" (kein Unterschied) und „Papier
darauf 3,81:1". P8.2 setzt auf Ocker dagegen **Tinte, 4,6:1**, alle vier Blätter nutzen
`#a8761a` unverändert. **Die Blätter sind in sich stimmig und bestehen** (Band 3,81:1 ≥ 3:1
als Grafik; Tinte auf Ocker 4,62:1). Vorschlag: den Wert behalten und die README
berichtigen, *oder* tatsächlich abdunkeln. Dann aber alle vier Stellen mit dem neuen
Wert und P8.2 neu gemessen.

---

## Wort- und Inhaltsfunde

| # | Datei · Screen | Befund | Soll |
|---|---|---|---|
| W1 | P15b Toasts | **„Keine Verbindung — Änderungen werden nachgeholt."** verspricht eine Offline-Warteschlange, die die App **nicht hat**. Der Service Worker speichert `/api/` bewusst nie zwischen. Der Satz steht auch nicht in `de.js`, obwohl der Blattkopf sagt „Alle Sätze aus de.js". | Streichen. Oder einen echten Fehlertoast aus `de.js` zeigen. |
| W2 | P2.4 Ergebnis (+ Folgeblätter) | **„Noch eine Runde →"**: „Runde" ist in der App die Gruppe. Die App sagt **„Noch eine Session"** (`tables.oneMore`). | „Noch eine Session →". Hinweis: Die Brücke (B2/B16) hat dieselbe Formulierung durchgelassen. Das behebe ich bei der Umsetzung dort mit. |
| W3 | P2.4, P4.3, P15b Menü · P2.1, P3.2 | **„Sieger ändern"** und **„Ergebnis ansehen →"** stehen nicht in `de.js`. Die App nennt die erste Aktion „Ändern" (`result.change`) im Kontext des Siegers. | Nach Entscheidung 9 zulässig als neue Schlüssel. Bitte im Blatt als „neu" markieren, damit sie nicht als App-Wortlaut gelten. |
| W4 | P2.2, P6 (Gast-Zeile) | **„nur diese Session"** ist nicht in `de.js`. Nächster App-Satz: „Gäste stimmen mit ab, gehören aber nicht zur Runde." (`startSession.guestsNote`). | App-Satz verwenden oder als neu markieren. |
| W5 | P2.2, P4.1 | **Schrittleiste „1 Wer spielt mit? · 2 Losen · 3 Abstimmen"**: neues Bauteil, „Losen" ist kein App-Wort. Die Einrichtung ist in der App **ein** Screen. Losen passiert auf „Loswirbeln", nicht in einem eigenen Schritt. | **Entschieden: streichen** (E1). |
| W6 | Konzeptblatt C | Die Bildunterschriften sagen noch **„Heute Abend"-Kasten** und **„Besetzungsliste"**. Entscheidung 3 hat den Kasten auf „Neue Session" umgestellt, der V0-Revert hat die Unterschriften nicht erreicht. | Unterschriften nachziehen. Das Konzeptblatt ist Teil des Pakets und wird mit übernommen. |

## IA und Screen-Set

Vollständig. Auf allen Desktop-Rundenscreens trägt die Ressortleiste alle fünf Ziele,
das Telefon-Dock genau vier. Der Hub hat alle Blöcke aus Handover §2. Kopfleiste mit
Sprache · Postfach · Konto ist überall vorhanden. Die Blöcke wurden gegen das DOM
abgehakt, nicht gegen den Text.

| # | Datei · Screen | Befund | Vorschlag |
|---|---|---|---|
| I1 | P15a | **Das Gast-Sheet fehlt.** Die T15a-Liste des Handovers nennt es, die Brücke hat es (B15a.3). Alle anderen elf Sheets der Liste sind da, „Jemand ohne Spiele?" kommt dazu. | Ein Sheet „Gast hinzufügen" (App: `startSession.guestAddTitle`, Feld „Name des Gasts", „Hinzufügen"). |
| I2 | P2.1, P3.2, P7.10 | Die App zeigt **bis zu drei von vier** Schnellstarts, abhängig vom Regal (`hub-insights.js` `quickPresets`). Der vierte heißt **„Anspruchsvoll"** (fi „Jotain järeää"). Die Blätter zeigen immer dieselben drei. | Keine Nachlieferung nötig. Bitte in P1.3 bestätigen, dass die Chip-Zeile „Anspruchsvoll" in de und fi aufnimmt (Umbruch oder Breite). |

## Trefferflächen: die sieben Meldungen, und warum keine davon ein Fund ist

- **5 × `<input>` 20–23 px hoch** (P1.4, P3.3, P6.2, P6.4, P7.8, P14.2): Jedes steckt in
  einem `<label>` von 44 bzw. 56 px. Ein Tipp irgendwo in den Rahmen fokussiert das Feld.
  Für die Umsetzung: Der Fokusring gehört dann per `:focus-within` an das Label, weil das
  Feld `outline: none` trägt.
- **5 × Fußlinks auf P4.5** gegen 44 px gemeldet: Die Heuristik hält P4.5 wegen „Wertung"
  im Label für die Wertungskarte. Die Fußzeile ist auf 32 px gebaut, das erfüllt Regel 4.
- Getrennt gemessen, **alles ≥ 44 px**: Zurück und Bedienelemente auf P2.3/P4.2, die
  Sichtblende P4.6/P6.6 und das Dock P2.5.

## Entscheidungen des Auftraggebers (26.09.2026, nach Runde 1)

**E1 — Schrittleiste auf „Neue Session" (W5): streichen.** Die Leiste „1 Wer spielt mit? ·
2 Losen · 3 Abstimmen" entfällt auf P2.2, P4.1 und allen Blättern, die sie zeigen. Die
Seite bleibt, wie die App arbeitet: ein Screen, Losen passiert auf „Loswirbeln".

**E2 — Ocker (S5): Wert bleibt `#a8761a`, die README wird berichtigt.** Entscheidung 4 der
README soll lauten: Ocker bleibt `#a8761a`, **Tinte** darauf 4,6:1, das Band 3,8:1 gegen
Papier (Grafik, ≥ 3:1). Die Blätter P1, P8, P14 und P15a bleiben unverändert.

## Beobachtungen, keine Funde

- **Initialen auf Personenfarben** sind überall Papier `#fbfaf6`, 19–52 px fett, also
  Großtext (3:1). Papier erreicht auf fünf der acht Farben nur **4,33–4,38:1**, Weiß
  4,52–4,58:1. Solange Initialen ≥ 18,66 px fett bleiben, ist das egal. Werden sie
  kleiner, z. B. in einer dichten Liste, muss dort Weiß stehen.
- **P4.2** wiederholt die Skalenenden: „gar nicht"/„unbedingt" stehen in den Karten und
  darunter noch einmal. Harmlos, aber doppelt.
- **P15b** zeigt neun Dialoge (Ocean elf). Die Formen Frage, zerstörend und Eingabe sind
  abgedeckt, also genügt das. Tisch hat die rund 30 nach Form gruppiert.

## Für die Umsetzung (nicht an Design)

- **Schriften selbst hosten.** Die CSP der App erlaubt nur `font-src 'self'`. Anton und
  Archivo kommen als woff2 nach `public/fonts/`, mit OFL-Lizenzdatei. Die Dateien auf die
  `wOF2`-Magie prüfen.
- **Anton als `font-weight: 400 800` deklarieren**
  (`.claude/rules/single-weight-display-faces.md`). Überschriften fragen 700 an, sonst
  wird Anton künstlich gefettet. Das behebt S3 in der App unabhängig vom Blatt.
- Helles Design: Den Farbblock auf `:root[data-design="programmheft"]:not([data-scheme="dark"])`
  gaten (`.claude/rules/light-design-gate-and-shared-design-ids.md`).

## Was Runde 2 prüft

Zuerst S1–S5 und W1–W6 nachmessen (bei W5: Leiste weg, bei S5: README berichtigt), dann I1. Das neue Gast-Sheet läuft durch dieselben
Messungen (Kontrast, Trefferflächen, Hex gegen P1, Icons gegen das Repo). Neue Hexwerte
außerhalb von P1 gelten wieder als Fund.
