# Prüfauftrag: Spielwirbel-Design „Ocean" (O1–O15b)

## Worum es geht

Spielwirbel ist eine bestehende Web-App für Spielegruppen: eine **Runde** führt ein **Regal** mit
Brettspielen, lost per **Session** aus, was heute in Frage kommt, jede Person wertet geheim 1–5,
danach schreiben **Chronik** und **Pokale** sich selbst. Die App bekommt sieben wählbare Designs
(Klassisch, Der Tisch, Das Programmheft, Die Brücke, Der Run, Forest, Ocean).

Das erste Design — **„Der Tisch"** — ist in zwei Prüfrunden abgenommen. Dieses Bündel ist das
**zweite vollständig durchgezeichnete Design: „Ocean"** — hell, weit, Wasser. Die Substantive bleiben
Spielwirbels (Runde, Regal, Pokale); Ocean bringt Material, Ritual und fünf Themenwörter mit, von
denen die Muschel als Gefäß das sichtbarste ist.

**Dies ist kein Implementierungsauftrag.** Gesucht ist eine **Prüfung** der Entwürfe gegen die
mitgelieferten Vorgaben. Danach geht es mit dem nächsten Design weiter (Reihenfolge: Ocean → Brücke
→ Programmheft → Forest → Run).

## Was Ocean vom Tisch unterscheidet — und was nicht

**Gleich geblieben ist die Informationsarchitektur.** Dieselben Screens, dieselben Wege, dieselben
Blöcke im Hub. Was sich ändert, sind Material, Typografie, Ritual und **Vokabular**.

## Stand: Runde 1 der Prüfung eingearbeitet

Die Prüfung (`pruefung-ocean-runde-1.md`, liegt unter `vorgaben/`) hat neun Punkte gemeldet.
**Alle neun sind eingearbeitet:**

1. **Rundenpuls** ist jetzt ein eigener Hub-Block auf Desktop und Telefon, mit allen drei Zeilen
   inklusive „3 von 12 Spielen waren noch nie dran". Die Chronik-Vorschau zeigt wieder die letzten
   Sessions statt der Monatsbalken.
2. **Trefferflächen** sind als Token in O1 geführt (44 · 40 · 32 · 24) und in allen Blättern
   nachgezogen: Fußlinks 32 px, Brotkrumen, Textlinks und Toast-Aktionen 24 px.
3. **Satzbau nach dem Revert** — die rund 15 Genusfehler und Tautologien sind korrigiert
   („die Session beginnt von vorn", „aus einer Session werden zwei", „Die Pokale zählen beide").
4. **Diese README** ist mitrevertiert (sie stand noch auf dem alten Vokabular).
5. **Wasserverlauf und Sand** sind als benannte Tokens in O1, mit Kontrastzahlen je Stufe.
6. **O5.2** — der unterste Verlaufsstopp liegt jetzt bei `#cfe3ec`, dort trägt der Akzent 5,0:1.
   Die Regel steht am Akzent-Token: *trägt Text nur bis zu der Stufe, gegen die er gemessen ist.*
7. **O8.1** setzt die Farbnamen in Tinte, die Farbe trägt ein Punkt daneben.
8. **Die Rückblickkarte im Querformat** hat dasselbe deckende Band wie das Hochformat.
9. **`ti-shell` existiert in diesem Font nicht** — Ocean trägt jetzt `ti-wave-sine`
   (Codepoint `\ecd4`, dazu `ti-droplet` `\ea97` und `ti-anchor` `\eb76`, aus der cmap dieser
   woff2 gelesen und im Subset deklariert).

Die vier Rückfragen sind unten unter „Bestätigte Entscheidungen" beantwortet.

---

## Vokabular-Revert vom 20.09.2026

Die erste Fassung dieses Bündels war **nicht konform**. Ocean wurde auf dem Konzeptblatt
`Konzept-H-Ocean.dc.html` aufgebaut, und das entstand laut Vokabular-Addendum §4 **unter der
zurückgezogenen Regel** („full in-world vocabulary"). 19 Substantive und Navigationswörter waren
umbenannt — genau das, was §1 verbietet.

**Alle 14 Dateien haben den Revert-Durchgang bekommen.** Jede trägt oben im Kopf die vollständige
Liste der geänderten Wörter, `Ocean-O9-Vokabular.dc.html` zeigt sie mit Begründung je Regel.

Zurückgenommen: Bucht → **Runde** · Küste (als Navigationswort) → **Start** · Riff → **Regal** ·
Gezeiten → **Chronik** · Perlenkette → **Pokale** · Tauchgang → **Session** · Perle und
„hat die Perle" → **Sieg / „hat gewonnen"** (auch als Bild gestrichen: die eine runde Zierform heißt und ist jetzt überall die **Blase**, die Pokale zeigen Balken statt einer Kette) · Boje → **Mitglied** ·
Jenseits des Riffs → **Nicht im Regal** · Strandgut → **Aussortiert** · Gehoben → **Durchgespielt** ·
Am Horizont → **Wunschliste** · Flaschenpost → **Könnte euch gefallen** · Werft → **Kümmerliste** ·
Echolot → **Ergebnis** · Tauchkarte → **Wertungskarte** · Mehrere Boote → **Mehrere Tische** ·
„Wer taucht mit?" → **„Wer spielt mit?"**

Eigen bleiben nur die fünf von §2 gedeckten Stellen: **Muschel** (Gefäßwort), **„Wie viele holen wir
hoch?"** (Anzahlfrage), **Abtauchen** (beide Hauptknöpfe), **auftauchen** (Aufdeckverb),
**in der Tiefe** (Dekor für Verdecktes). Das Glossar schrumpft damit von einer eigenen Seite plus
vier Einführungskarten auf **einen Absatz** in der Hilfe.

**Konsequenz für die übrigen Designs:** Das Konzeptblatt eines Designs ist keine Vokabularquelle.
Die Revert-Listen in §4 des Addendums laufen künftig **vor** dem ersten Brief.

| | Der Tisch | Ocean |
|---|---|---|
| Grundton | dunkel (`#3b2a12` Nussbaum) | **hell** (`#e4f1f5` Wasser) |
| Flächen | heller als die Seite | heller als die Seite (bleibt so) |
| Schrift | Bricolage Grotesque + Manrope | **Comfortaa 700 + Figtree** (beide OFL) |
| Akzent | Gold `#f0cf86` — trägt Text erst ab 24 px | **`#0e6690` — trägt Text (5,9:1)** |
| Kritische Farbe | Gold auf Filz | **die acht Personenfarben auf heller Fläche** |
| Umbenennungen | **keine** | **5** (nach dem Revert; vorher 19) — ein Glossarabsatz statt einer Seite |
| Hauptaktion | „Session wirbeln" | „Abtauchen" (§2-gedeckt) |
| Nav Desktop | Programmheft-Abschnittslinks | **Reling links, 104 px, fünf Ziele** |
| Nav Telefon | Dock, vier Ziele | Dock, vier Ziele (unverändert) |

**Die vier Regeln aus der Tisch-Prüfung sind hier von Brief 1 an angewandt, nicht nachträglich:**

1. **Akzent- und Personenfarbe tragen keinen Text unter 24 px.** In Ocean betrifft das die acht
   Personenfarben — sechs von acht liegen bei 4,3:1 auf `#f7fbfc`. Sie sind Ring, Füllung,
   Tidenlinie und Balken; ein Name erscheint farbig nur bei 26 px und dann in der abgedunkelten
   Variante (O8.1). Der Akzent `#0e6690` selbst trägt Text und ist gemessen.
2. **Kein Text auf einem Cover.** Titel und Meta stehen unter dem Bild auf deckendem Weiß. Das
   Konzeptblatt (`Konzept-H-Ocean.dc.html`, liegt zum Vergleich bei) tat das noch anders — ab O3
   ist es korrigiert.
3. **O1 ist die einzige Token-Quelle.** O8 misst nur und erfindet keine Farbe.
4. **Wörter aus der App abschreiben, nicht paraphrasieren.** „1× gar nicht", „Sortiert: Bewertung",
   die drei Schnellstart-Presets, „N weitere fehlen, weil …" stehen wörtlich so da.

Außerdem übernommen: **fester 4:3-Coverkasten** (die App speichert kein Seitenverhältnis),
**Icon pro Design** (Ocean: `ti-wave-sine` — `ti-shell` gibt es in dieser woff2 nicht; Klassisch
behält den weißen Würfel), und **X15 als eigener
Brief** — die Overlay-Sammlung, die beim Tisch erst aus der Prüfung entstand.

## Was die Dateien sind

15 HTML-Dateien: 14 Briefe plus das Konzeptblatt zum Vergleich. Es sind **Design-Referenzen**, keine
Produktionskomponenten: inline gestyltes HTML, das im Browser direkt öffnet. Jede Datei zeigt mehrere
Screens oder Tafeln nebeneinander und trägt unten einen Kasten „Was OX von hier mitnimmt".

- Öffnen: Datei direkt im Browser öffnen (kein Build, kein Server nötig).
- `support.js` ist die Laufzeit — **nicht prüfen, nicht bewerten, nicht Teil des Designs.** Ebenso
  die `{{ … }}`-Platzhalter und `<sc-for>`/`<sc-if>`-Tags: Autorenformat, nicht Zielarchitektur.
- Zwei externe Abhängigkeiten: Google Fonts (Comfortaa, Figtree) über `<link>`, und die lokale
  Tabler-Icon-Schrift unter `public/fonts/`. Ohne Netz fehlen die Schriften, das Layout bleibt.
- Die Cover sind **Platzhalter** (CSS-Verläufe, in O3/O6 bewusst ungleich: hoch, quer, unruhig,
  fehlend). Echte Schachtelbilder kommen zur Laufzeit von BoardGameGeek.

## Die Dateien

| Datei | Inhalt |
|---|---|
| `Ocean-O1-Komponenten.dc.html` | Tokens (Flächen, Schrift, Akzent, Zustände, Personenfarben, Wasser-Ornament), Typoskala, alle Bauteile in fünf Zuständen, Echolot, Bojen, Cover, Blasen-Gesichter, Score-Rampe, Leerzustand, Skelett, Fuß |
| `Ocean-O2-Phone-Kern.dc.html` | Telefon 390: Hub mit Rundenpuls, Neue Session, Wertungskarte (Vollbild), Ergebnis, Dock ausgezeichnet |
| `Ocean-O3-Runde-Desktop.dc.html` | Desktop 1440: Lobby, Hub mit Rundenpuls, Regal mit ungleichen Covern, Spieldetail, Spiel suchen |
| `Ocean-O4-Session-Desktop.dc.html` | Desktop 1440: Neue Session, Wertungskarte, Sichtblende beim Weiterreichen, Ergebnis mit Wal, mehrere Tische |
| `Ocean-O5-Konto.dc.html` | Anmelden/Registrieren/Passkey, Designwahl mit sieben Postkarten (Desktop + Telefon), Designwahl in den Einstellungen |
| `Ocean-O6-Phone-Rest.dc.html` | Telefon 390: Lobby, Regal, Spieldetail, Spiel suchen, Sichtblende, mehrere Tische — plus Tablet 834 |
| `Ocean-O7-Leerzustaende.dc.html` | Acht Leerzustände, erste Runde, junge Runde, Beispielrunde, drei Fehlerzustände |
| `Ocean-O8-Farben.dc.html` | Personenfarben auf jeder Fläche gemessen, Score-Rampe an jedem Ort, Veto-Zeile, Rückblickkarte in drei Formaten |
| `Ocean-O9-Vokabular.dc.html` | **Der Revert-Durchgang:** 17 zurückgenommene Begriffe mit Regelbezug, die 5 erlaubten Themenwörter, der geschrumpfte Glossarabsatz, 14 Standardsätze DE + EN mit Herkunft, Tonfall |
| `Ocean-O10-Motion.dc.html` | Zehn Bewegungen, jede mit statischem Endbild daneben; Zeiten, Kurven, Verbotsliste |
| `Ocean-O13-Tier2a.dc.html` | Chronik + Jahresrückblick, Pokale, Nicht im Regal, Könnte euch gefallen, Seite einer Person, Chronik am Telefon |
| `Ocean-O14-Tier2b.dc.html` | Rundeneinstellungen mit Markerwahl, Leute + Strom, Posteingang, „Was ist neu", Mein Konto, Statistiken |
| `Ocean-O15a-Sheets.dc.html` | Die 18 Overlays als Sheet und Popover, die drei Unterschiede, drei Fehlerzustände im Sheet |
| `Ocean-O15b-Dialoge.dc.html` | 11 Dialoge (19 Aktionen passieren sofort mit „Rückgängig"), fünf Toast-Typen, „…"-Menü in vier Auftritten |
| `Konzept-H-Ocean.dc.html` | **Nur zum Vergleich:** das ursprüngliche Konzeptblatt (O0). Es zeigt Text auf Covern und das alte, nicht konforme Vokabular — beides ist in O1–O15b behoben. |

Fidelity: **hifi.** Farben, Schriftgrößen, Abstände und Zustände sind final gemeint.

## Vorgaben, gegen die geprüft werden soll

Alle unter `vorgaben/`:

1. `handover-claude-design-2026-09-19.md` — das Pflichtenheft. Relevant: **§2** (gemeinsame
   Informationsarchitektur), **§3** (was jedes Design liefern muss), **§4b** (Anforderungen an die
   beiden hellen Konzepte Ocean und Forest), **§5** (Zugänglichkeit und Handwerk), **§8** (Briefe),
   **§9** (Phase-2-Beschluss: Reihenfolge, X15 überall, Prüfung nach jedem Design).
2. `handover-vokabular-2026-09-20.md` — die Vokabularregel. Die 19 Umbenennungen sind zurückgenommen;
   geblieben sind fünf von §2 gedeckte Themenwörter (Muschel · „Wie viele holen wir hoch?“ ·
   Abtauchen · auftauchen · in der Tiefe). Runde 1 der Prüfung hat alle fünf als gedeckt bestätigt.
3. `projektregeln-CLAUDE.md` — die stehenden Regeln (IA-Prüfliste, Handwerksregeln, die acht
   Mitgliedsfarben, das Verbot von Tageszeitwörtern für eine Session).
4. `tisch-pruefung-runde-1.md` — die erste Tisch-Prüfung, **nur als Referenz**: die dort gefundenen
   Fehlerklassen sollten in Ocean gar nicht erst auftreten.

## Woran ich am meisten interessiert bin

In dieser Reihenfolge:

1. **Kontrast, nachgerechnet statt geglaubt.** Ocean ist hell — die Fehlerklasse ist damit die
   umgekehrte zum Tisch: nicht helle Schrift auf dunklem Grund, sondern **gesättigte Farbe auf
   fast-weißer Fläche**. Die Zahlen in O1 und O8 sind von Hand gerechnet; bitte nachrechnen,
   besonders: die acht Personenfarben (angegeben 4,3 / 5,1 / 6,6:1), der Akzent `#0e6690` auf
   `#f7fbfc` (5,9:1) und auf `#e4f1f5` (5,4:1), die Sekundärtinte `#3f5a6b` (6,9:1), und die
   Score-Rampe mit ihren **fest zugeordneten** Textfarben (Stufe 3 `#6a9fd0` mit `#10283a`: 5,4:1
   ist der engste Fall).
2. **Ist der Revert vollständig?** Automatisch geprüft ist er (keine Treffer mehr auf Bucht,
   Riff, Gezeiten, Perle, Tauchgang, Boje, Strandgut, Horizont, Flaschenpost, Werft, Echolot, Boot,
   Gehoben). Offen ist das Inhaltliche: Sind die fünf verbliebenen Themenwörter von §2 wirklich
   gedeckt, und ist jedes davon **ohne Glossar** verständlich (§3)? Besonders „in der Tiefe" — es
   steht als Dekor auf der Wertungskarte, nicht auf einem Bedienelement.
3. **IA-Treue.** Prüfliste in `projektregeln-CLAUDE.md`: Screen-Set unverändert, Hub trägt alle
   genannten Blöcke (Leute, eine Hauptaktion mit drei Schnellfiltern, zuletzt gespielt, „Wie wär's
   mit" mit 3 + Begründung, Rundenpuls, Kümmerliste, Vorschauen auf Riff/Perlenkette/Gezeiten, vier
   Off-Regal-Einstiege, Einstellungen), **jeder Desktop-Screen erreicht alle fünf Ziele über die
   Reling**, Telefon-Dock genau vier. Bewusste Ausnahme wie beim Tisch: die **Tauchkarte** läuft auf
   beiden Breiten als Vollbild ohne Dock und Kopfleiste.
4. **Innere Widersprüche.** O1 ist die Quelle. Taucht in O2–O15 ein Farbwert, ein Radius oder ein
   Abstand auf, den O1 nicht kennt? Weicht eine Score-Pille von der Rampe ab? Nennt ein Blatt eine
   Zahl anders als ein anderes?
5. **Text im Layout.** Lange Wörter: „Kartographen des Nordens", „Nutzungsbedingungen",
   „Könnte euch gefallen", „Rundeneinstellungen". Halten die Spalten bei +30 % Sprachlänge? Die
   Reling-Labels sind mit 11,5 px am engsten.
6. **Trefferflächen.** Regel 4 der Tisch-Prüfung ist jetzt als Token in O1 geführt: 44 px Knöpfe ·
   40 px Symbol/Chip/Eingabe · **32 px Fußlinks** · **24 px Textlinks, Brotkrumen, Toast-Aktionen**.
   Alle acht Blätter sind nachgezogen — bitte nachmessen.

## Was nicht geprüft werden muss

- `support.js`, `{{ … }}`, `<sc-for>`, `<helmet>` — Autorenformat.
- Die Wahl der Metapher, der Schriften und der Farbwelt. Die ist abgenommen (O0).
- Umsetzbarkeit in einem Framework.
- Die Platzhalter-Cover.
- **O11 (Markenassets) und O12 (öffentliche Flächen) fehlen mit Absicht** — die sind face-only und
  gibt es nur beim Tisch. Die Rückblickkarte ist stattdessen in O8.

## Bekannt offen

- **Der engste Kontrastfall** ist Score-Stufe 3 (`#6a9fd0` mit `#10283a`, 5,4:1). Der Akzent auf der
  untersten Verlaufsstufe ist seit Runde 1 der Prüfung auf `#cfe3ec` abgefangen und trägt 5,0:1.
- **Die sechs Personenfarben bei 4,3:1** sind der bewusste Kompromiss: die acht Farben sind global
  vorgegeben und dürfen nicht geändert werden, also tragen sie in Ocean keinen kleinen Text. Wenn
  die Prüfung das anders sieht, ist die Alternative eine abgedunkelte Zweitreihe für alle acht
  (O8.1 zeigt drei davon) — das wäre eine Änderung am globalen Farbsatz und braucht eine Ansage.
- **Die Dialogtexte in O15b** sind zu etwa einem Drittel wörtlich aus der App, der Rest ist
  formuliert, weil Ocean andere Substantive hat. Derselbe offene Punkt wie beim Tisch.
- **Icons:** nur das Tabler-Subset unter `public/fonts/tabler-icons.css`. Beim Bauen fielen
  **25 Glyphen auf, die im Subset fehlen** (u. a. `ti-shell`, `ti-language`, `ti-eye`, `ti-tag`,
  `ti-circle`, `ti-inbox`, `ti-bell`, `ti-abc`, `ti-cloud-off`). Sie sind **nicht** ergänzt
  worden — Codepoints müssen aus der cmap dieser woff2 gelesen werden, sonst rendert ein
  plausibles falsches Icon. Stattdessen sind alle 25 durch vorhandene ersetzt: Sprache → `ti-world`,
  Ocean-Zeichen → `ti-planet`, Klassisch → `ti-dice-3`, Tisch → `ti-chess`, Programmheft →
  `ti-file-text`, Brücke → `ti-rocket`, Tag → `ti-tags`, Perle → `ti-medal`, Muschel →
  `ti-dice-5`, Posteingang → `ti-mail` usw. Eine automatische Gegenprobe über alle 14 Dateien
  meldet jetzt **keine fehlende Glyphe mehr**. Wenn ein Ersatz inhaltlich danebenliegt, bitte melden —
  dann wird der richtige Codepoint nachgetragen.
- Das **„Powered by BGG"-Badge** ist Lizenzpflicht und darf nicht umgestaltet werden.

## Wie das Ergebnis am besten zurückkommt

Eine Liste pro Fund mit **Datei · Screen-Label · was falsch ist · gemessener Wert · Vorschlag**.
Die Screens tragen `data-screen-label`-Attribute (z. B. `O4.3 Geteilte Wertung`) — die als Adresse
nutzen. Systemische Funde (ein Token, das in vielen Dateien falsch verwendet wird) bitte als **einen**
Punkt mit der Quelle in O1 melden, nicht als 14 Einzelfunde.


---

## Bestätigte Entscheidungen (Rückfragen aus Runde 1)

1. **„Abtauchen" auf beiden Hauptknöpfen — bestätigt.** Der Einwand stimmt: Ocean ist das einzige
   Design, dessen Hub-Knopf die Sache nicht benennt. Getragen wird das von der gezeichneten Muschel
   darunter und vom Seitentitel „Neue Session"; §3 ist damit erfüllt. Bleibt so.
2. **„in der Tiefe" — kein Handlungsbedarf,** wie geprüft.
3. **Die sechs Personenfarben bei 4,3:1 — bleiben.** Die abgedunkelte Zweitreihe ist für Ocean nicht
   nötig; O8.1 zeigt sie weiter als Muster für den einen Fall „wer ist gerade dran" (26 px).
4. **„Blase" bekommt Bauteilnamen.** In O1 heißt die Form jetzt durchgehend *Blase*, und die
   Verwendungen sind einzeln benannt: **Knopfkern** (Primärknopf in der Muschel) · **Wertungsblase**
   (die fünf Gesichter) · **Score-Blase** (am Cover) · **Anzahlblase** (Regler „Wie viele holen wir
   hoch?") · **Zierblase** (aufsteigend) · **Bildmarke** (Spiel ohne Cover). Ein Issue kann damit
   genau eine davon adressieren.

## Was in dieser Runde nicht geändert wurde

- Die **13 Plakatfarben** der anderen Designs in O5.3/O5.4 bleiben als Nicht-Tokens stehen; sie
  gehören in deren X1 und sind im Blatt als fremd markiert.
- „1 Session ohne Ergebnis" heißt jetzt „ohne **eingetragenes** Ergebnis" — der einzige
  Abschriftfehler aus der Prüfung.
