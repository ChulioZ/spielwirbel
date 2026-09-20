# Prüfung „Ocean" (O1–O15b) — Ergebnis

Datum: 2026-09-20 · Zwei Runden · Geprüft gegen `handover-claude-design-2026-09-19.md`,
`handover-vokabular-2026-09-20.md`, `projektregeln-CLAUDE.md`,
`pruefung-tisch-2026-09-20.md` und den Code der App.

Methode: alle 14 Blätter in Chromium gerendert. Kontrast **pixelgenau**: alle
Glyphen auf `color: transparent`, ein Vollbild je Blatt, und für jeden der 2 683
Textknoten der tatsächliche Grund in seiner eigenen Box ausgewertet
(Modalwert = der Grund, auf dem der Text steht; 10. Perzentil als Gegenprobe für
echte Verläufe). Trefferflächen aus dem gerenderten Layout. Wortlaut gegen
`public/js/lang/de.js`, Screen-Set und Erreichbarkeit gegen die Vorgaben,
Farbwerte von O2–O15 gegen O1, Icon-Codepoints gegen die cmap der gebündelten
`tabler-icons.woff2`.

## Urteil

**Abgenommen.** Runde 1 meldete neun Punkte; Runde 2 hat alle neun nachgemessen
bestätigt. Ocean geht in die Umsetzung.

| | Runde 1 | Runde 2 |
|---|---|---|
| Echte Kontrastfehler (ohne die WCAG-freien Deaktiviert-Zustände) | 3 | **0** |
| Bedienelemente unter ihrer Trefferfläche | 25 Formen | **3 Einzelfälle** |
| Grammatikschäden aus dem Revert | 14 | **0** |
| Hexwerte in O2–O15 ohne Deklaration in O1 | 36 | **10** (+ 13 zulässige Fremdfarben) |
| Fehlende Hub-Blöcke | 1 (Rundenpuls) | **0** |

Was Ocean von Anfang an richtig hatte und was so wiederholt werden soll: die
**IA-Treue** (die Reling trägt auf jedem Desktop-Rundenscreen alle fünf Ziele,
das Dock genau vier, die Wertungskarte als Vollbild ohne Dock und Kopfleiste mit
keinem Bedienelement unter 44 px), die **Abschriften aus der App**, das
**Vokabular-Urteil**, und **kein Text auf einem Cover**.

---

## Runde 1 — die neun Punkte, und was aus ihnen wurde

| # | Fund (Runde 1) | Runde 2, nachgemessen |
|---|---|---|
| 1 | **Rundenpuls fehlte im ganzen Bündel** — sein Inhalt war in die Chronik-Vorschau gefaltet und trug deren Titel. Zugleich ein IA-Fund und eine nach §1 verbotene Umbenennung. | **Behoben.** Eigener Block auf O3.2 und O2.1, mit allen drei Zeilen inkl. „3 von 12 Spielen waren noch nie dran". Die Chronik-Vorschau zeigt wieder die letzten Sessions. |
| 2 | **Trefferflächen-Regel der Tisch-Prüfung nicht übernommen** — Fußlinks 15–18 px, Brotkrumen 18–22 px, Textlinks 16–17 px. | **Behoben.** Als Token in O1 (44 · 40 · 32 · 24) und nachgezogen: Fußlinks **32 px** an 11 Stellen, Textlinks **24 px**. Rest siehe „Offen, nicht blockierend". |
| 3 | **~15 Genusfehler und Tautologien** aus der Wortersetzung, teils in UI-Strings. | **Behoben, 14 von 14** („die Session beginnt von vorn", „aus einer Session werden zwei", „Die Pokale zählen beide", „Gefäß = Muschel", „mit der Blase in der Mitte"). |
| 4 | **Die Paket-README war selbst nicht revertiert.** | **Weitgehend behoben** (Dateitabelle, §5, §6). Vier Reststellen sind bei der Übernahme ins Repo korrigiert — siehe unten. |
| 5 | **36 Hexwerte ohne Deklaration in O1**, darunter alle 16 Stufen des Wasserverlaufs. | **Weitgehend behoben.** O1 wuchs von 59 auf 72 Werte; Wasserverlauf und Sandtöne sind drin, mit Kontrastzahlen je Stufe. 10 echte Lücken bleiben. |
| 6 | **O5.2 — der einzige echte Kontrastfehler in einem Bedienelement**: Akzent auf der untersten Verlaufsstufe, 4,03 / 4,13:1. | **Behoben.** Unterster Stopp jetzt `#cfe3ec`; beide Links bestehen. Die Regel steht am Akzent-Token. |
| 7 | **O8.1 brach die Regel, die es aufstellt** — sechs Farbnamen in ihrer eigenen Farbe bei 15 px (4,34–4,39:1). | **Behoben.** Namen in Tinte `#10283a`, die Farbe trägt ein Punkt daneben. |
| 8 | **Rückblickkarte im Querformat ohne deckendes Band** — „spielwirbel.app" 2,66:1, auf dem Link-Vorschaubild. | **Behoben.** Textspalte auf deckendem Band wie im Hochformat. |
| 9 | **`ti-shell` existiert in dieser woff2 nicht** (cmap-Prüfung über 5 093 Glyphen). | **Behoben.** Ocean trägt `ti-wave-sine`; `\ecd4`, `\ea97` (droplet), `\eb76` (anchor) gegen die cmap geprüft und im Subset deklariert. |

### Vokabular — das Urteil aus Runde 1, unverändert gültig

**Ocean geht nicht zu weit.** Alle fünf Themenwörter sind von §2 gedeckt:
**Muschel** (Gefäßwort), **„Wie viele holen wir hoch?"** (Anzahlfrage),
**Abtauchen** (beide Hauptknöpfe — der Seitentitel bleibt „Neue Session"),
**auftauchen** (Aufdeckverb), **„in der Tiefe"** (Dekor; steht auf O4.2 als
Abschnittsüberschrift mit eigenem Erklärsatz, nicht auf einem Bedienelement).
**„Küste"** überlebt nur in der Begrüßungszeile und der Zierzeile neben der
Wortmarke — genau die zwei von §2 freigegebenen Stellen; die Fragezeile bleibt
„Welche Runde spielt heute?". Kein Abendwort in keinem Blatt.

---

## Offen, nicht blockierend — in den Issues getragen

Nichts davon hält die Umsetzung auf; jede Zeile ist in der betroffenen
Implementierungs-Issue notiert, damit niemand sie aus den Blättern neu herleiten
muss.

| # | Wo | Was | Getragen von |
|---|---|---|---|
| R1 | O1 als Quelle | **10 Hexwerte ohne Deklaration**: `#1f4f72` `#7fb4d3` `#9ec2d4` `#1a4360` `#dbe9ef` `#f4faf7` (Tiefenwasser), `#f0dcd8` (weiche Gefahrfläche) und **`#4a4396` `#8a3418` `#6f440a`** — die abgedunkelten Personenfarben, die O8.1 als „zwei Stufen dunkler" beschreibt und O2/O4 tatsächlich benutzen. **Nur 3 der 8 sind angegeben.** | Token-Issue: alle zehn deklarieren, die abgedunkelte Reihe für **alle acht** Farben ableiten (Floor 3:1, weil sie nur ab 26 px erscheint). |
| R2 | O1.4, O3.3, O6.4 | Zwei Suchfelder rendern **20 px / 23,5 px** hoch gegen das eigene 40-px-Eingabe-Token. | Token-Issue: das Token gilt, nicht der Mock. |
| R3 | O4.5 | Brotkrume „Familie Berger" **22 px** — beim Nachziehen übersehen. | Session-Issue: 24 px wie überall. |
| R4 | — | Die 13 Plakatfarben fremder Designs in O5.3/O5.4 sind **kein Fund** (Tisch A8: „Plakatfarben fremder Designs gehören deren X1"), sollten aber als Nicht-Token gelesen werden. | Konto-Issue. |

### Bei der Übernahme ins Repo korrigiert

Vier Aussagen hätten eine umsetzende Session in die Irre geführt und sind in
`docs/design/ocean/` berichtigt, statt das Paket ein drittes Mal zurückzugeben:

- die README nannte im Einleitungssatz noch „Buchten statt Runden, ein Riff
  statt eines Regals, Perlen statt Pokale" — das revertierte Vokabular;
- sie führte weiter `ti-shell` als Ocean-Zeichen, gegen ihren eigenen Punkt 9;
- ihr Prüfauftrag bat noch um Bewertung „der 19 Umbenennungen";
- „Bekannt offen" nannte noch die Akzentzahl von **vor** der Korrektur aus Punkt 6.

Dazu zwei Stellen in den Blättern: **O7.3**s Bildunterschrift sagte „der Sieg ist
trotzdem der Mittelpunkt" (ein Revert-Überlebender — die Mitte ist die Muschel),
und **O1.10** schrieb „Fußlinks sind 24 px hoch", während das Token derselben
Datei 32 px sagt und alle Blätter 32 px rendern.

---

## Entscheidungen, die Claude Design getroffen hat — bestätigt

| # | Entscheidung | Stand |
|---|---|---|
| D1 | **„Abtauchen" auf beiden Hauptknöpfen.** | Bestätigt. §2-konform, §3 erfüllt (die Muschel ist gezeichnet, der Knopf sitzt an der Primärstelle). Ocean ist damit das einzige Design, dessen Hub-Knopf die Sache nicht benennt — bewusst so. |
| D2 | **„in der Tiefe" als Abschnittsüberschrift.** | Bestätigt, gedeckt. |
| D3 | **Die sechs Personenfarben bei 4,3:1 bleiben**, sie tragen dafür keinen Text unter 24 px. | Bestätigt. Die acht Farben sind global und wandern nicht. Die abgedunkelte Zweitreihe ist nur für „wer ist gerade dran" und bleibt innerhalb Ocean. |
| D4 | **„Blase" trägt fünf Bedeutungen** (Primärknopf, Wertungsgesichter, Score-Pille, Anzahl-Regler, Zierblasen). | Kein Fehler, aber in einem Issue nicht adressierbar — die Implementierungs-Issues benennen die Bauteile einzeln (`.ocean-bubble--action`, `--face`, `--score`). |

---

## Was für die verbleibenden vier Designs gilt

Zusätzlich zu den neun Regeln der Tisch-Prüfung:

1. **Alle neun Regeln der Tisch-Prüfung abhaken, nicht vier.** Ocean hatte vier
   übernommen; durchgefallen ist die fünfte (Trefferflächen). Die Zahl der
   übernommenen Regeln steht in der README — sie ist prüfbar.
2. **Die IA-Prüfliste Block für Block abhaken.** Der Rundenpuls war nicht
   vergessen, er war in einem Nachbarblock aufgegangen. Das sieht man nur beim
   Abhaken gegen die Liste, nicht beim Draufschauen auf den Screen.
3. **Nach einem Vokabular-Revert den Text lesen, nicht nur ersetzen.** Eine
   Wortersetzung erzeugt zuverlässig falsche Genera und Tautologien — und sie
   trifft zuerst die README, die niemand als Teil des Designs liest.
4. **Das Prüfwerkzeug passt nicht zu jedem Design.**
   `docs/design/tools/audit.js` nimmt bei Verläufen die schlechteste Stufe. Für
   Tischs flache Filzflächen war das richtig; auf Oceans seitenhohen Verläufen
   meldete es **31 Kontrastfehler, von denen 28 keine waren**. Die Gegenprobe
   steht in `docs/design/README.md` Schritt 2.
