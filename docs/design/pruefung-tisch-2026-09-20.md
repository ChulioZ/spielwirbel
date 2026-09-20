# Prüfung „Der Tisch" (T1–T14) — Ergebnis

Datum: 2026-09-20 · Geprüft gegen `handover-claude-design-2026-09-19.md`, `handover-vokabular-2026-09-20.md`, `projektregeln-CLAUDE.md` und den Code der App.
Methode: alle 14 Blätter im Browser gerendert; jeder Textknoten gegen seinen tatsächlichen Grund gerechnet (Verläufe: jede Stufe, der schlechteste Wert zählt), jedes Bedienelement vermessen; Wortlaut, Screen-Set und Erreichbarkeit gegen die Vorgaben; Farbwerte von T2–T14 gegen T1.

## Urteil

**Damit lässt sich arbeiten — als Vorlage für die fünf weiteren Designs, nach den Korrekturen unter A und B.** IA, Screen-Set, die Telefonantwort (Bühne oben, Dock als Tischkante), die leeren Zustände und die Vokabulardisziplin sind richtig und sollen so wiederholt werden. Was zu ändern ist, sitzt fast vollständig in **T1 und T8** (Tokens) und in einer Handvoll Wörtern; die Screens selbst bleiben.

Zusammengefasst: **9 systemische Funde** (A), **11 Wort- und Inhaltsfunde** (B), **3 Punkte zur IA** (C), **4 Entscheidungen zur Bestätigung** (D).

---

## A · Systemisch — Quelle in T1/T8, wirkt in vielen Blättern

| # | Datei · Screen | Was falsch ist | Gemessen | Vorschlag |
|---|---|---|---|---|
| A1 | **T1.1 / T8.1** (Quelle) · T2.1, T2.2, T2.5, T6.2–6.6, T7.3–7.6, T13.5 (Dock-Labels), T3.2 + T7.7 („Platz dazu"), T4.4 (Kicker), T4.5 + T6.6 („Tisch 1 · Wohnzimmer"), T5.2/5.4 (Badge „Der Tisch", Rechtslinks), T11.1 (Datumszeile), T12.5 (Fußlinks), T13.1 („Rückblick"), T14.1 („9 Siege") | **Gold #f0cf86 als Fließtext auf Tannenfilz.** Am hellen Ende des Filzverlaufs (#2f6b4d) trägt Gold nur 4,2:1. **T8.1 druckt diese 4,2:1 selbst** — T2.6 behauptet 6,1:1 „am Labelband"; die beiden Blätter widersprechen sich, und das Dock nutzt Gold bei 12 px. | 4,20:1 bei 11–13 px (Floor 4,5) | Regel in T1: **Gold ist Display- und Glyphenfarbe, nie Textfarbe unter 24 px auf Filz.** Text < 24 px auf Filz steht in Papier #f6ecd8 (5,4:1 am hellen Ende). Alternativ den hellen Filzstopp auf ≈ #2a6146 senken — dann bitte die Zahl in T8 neu rechnen. Dieselbe Regel für alle weiteren Designs: *Akzent auf Markerfarbe nur ab 24 px.* |
| A2 | **T1.7 Tafel** (Quelle) · T2.5, T4.4, T4.5 (3×), T11.1 | **Weiche Tinte #6b5a45 auf der Goldzeile #f0cf86** („Gehört Lea", „Gespielt", „Gehört Mia"). Die README nennt „Tinte auf Gold" als behoben — für die Nebenzeile stimmt das nicht. | 4,40:1 bei 11–12 px | Auf Gold nur eine Tinte: #4a3423 (7,7:1). |
| A3 | **T1.5 Chips** (Quelle) · T3.2, T7.7 | Aktive Schnellfilter-Chips auf Filz: Papier auf #4e7b56. | 4,17:1 bei 13–14 px | Chipfläche auf ≈ #3f6a48 dunkeln, oder aktiv = Messing mit dunkler Schrift wie der Primärknopf (so steht es in T1.5 für „aktiv" bereits). |
| A4 | **T1.6 Overlays** (Quelle, Sprachchip „de") · T6.4 („steht schon im Regal") | Tertiärtinte #8d5a36 auf gehobener Papierfläche #e7dcc4 — laut README behoben, hier noch vorhanden. | 4,23:1 bei 11 px | #7a4a28 oder dunkler. |
| A5 | **T13.2 Pokale** | Sockelbeschriftung #6b4a10 auf Goldsockel #d9a951 und Silbersockel #b9b3a4 („Siege · führt", „Siege"). | 3,73:1 und 3,85:1 bei 11 px | Dunkle Tinte #2f2109 auf allen drei Sockeln. |
| A6 | **T6.3 Spielepass** · T11.3 | Metazeile #e2c496 direkt auf dem Cover-Verlauf („2–4 · 60 min · Gehört Lea"); auf einem echten BGG-Cover ist das unmessbar. T11.3: „Fünf Gesichter…" auf Filz. | 4,24:1 · 3,77:1 | Metazeile auf ein deckendes Band (Filz oder Nussbaum) unter/über dem Bild, nie auf das Bild. Regel für alle Designs: **kein Text auf einem Cover.** |
| A7 | **T1.10 Fuß + T1.6 Toast** (Quelle) · T3.1, T5.1, T5.4, T6.1, T7.1, T12.1, T12.2, T12.5 | Textlinks unter 24 px Höhe: Fußzeilen-Links 17–19 px, Toast-Aktionen „Rückgängig"/„Erneut" 18 px, „Passwort vergessen?", „Demo-Runde ansehen", „Ganzes Glossar öffnen", Landing-Navigation „So läuft es · FAQ · Glossar". | 17–19 px (Floor 24) | In T1: Textlink = min-height 24 px über Padding; Fußzeile 32 px Zeilenhöhe. Ein Token, alle Blätter. |
| A8 | **T1 als Quelle** · T2–T14 | **81 Hexwerte in T2–T14, die T1 nicht kennt.** Darunter die Filze (#1c4531, #2f6b4d, #cfe6d6 — stehen in T2/T8), die acht Markerfilze, die Placeholder-Cover-Palette und die Plakatfarben der anderen Designs. T1 sagt „Quelle für T2–T14" und ist es nicht. | 81 Werte | Filz-Tokens und die acht Markerfilze nach T1 (T8 behält die Messungen). Placeholder-Cover als **Nicht-Token** kennzeichnen (grau, „Cover"-Marke), damit sie niemand implementiert. Plakatfarben fremder Designs gehören deren T1. |
| A9 | **T11.3 Screenshots**, Screenshot 2 | Papierschrift auf Papiergrund — die Telefonrahmen-Fläche fehlt. | 1,05:1 | Komposition reparieren (Filz hinter der Wertungskarte). |

Nicht bemängelt, weil per WCAG ausgenommen: die **deaktivierten** Zustände (T1.3 alle „Deaktiviert", T6.5 „Ergebnis zeigen" gesperrt, 2,1–3,5:1). Die Begründung am Knopf trägt die Information — richtig so.

---

## B · Wörter und Inhalte

| # | Datei · Screen | Was falsch ist | Vorschlag |
|---|---|---|---|
| B1 | **T4.4 Ergebnis, T2.5, T9** | Pille **„1× kein Veto"** an dem Spiel, das die 1 („gar nicht") bekommen hat. Das ist die Umkehrung: die 1 *ist* das Veto. | „1× gar nicht" — der Standardstring der App (`score.reasonVetoOne`). In T9 den Satz korrigieren. |
| B2 | **T2.1, T3.2, T7.7** | Schnellfilter „4 Spieler · unter 60 min · Kurz". Die App hat genau drei Presets: **„Unter 60 Min · Leichte Kost · Familientauglich"** (`hub.preset.*`, #923). „Kurz" doppelt „unter 60 min", „4 Spieler" ist kein Preset. | Die drei App-Presets wörtlich. Gilt für alle Designs. |
| B3 | **T3.2, T2.2** | Abzweigungen: „Nicht im Regal 7" **neben** „Aussortiert 2 · Durchgespielt 3 · Wunschliste 2". „Nicht im Regal" ist die Gruppe der drei, keine vierte Liste — und 7 ≠ 2+3+2. | „Nicht im Regal" als Gruppentitel, darunter die drei Listen + „Könnte euch gefallen" (so macht es T13.3 richtig). |
| B4 | **T2.2** | „Einstellungen · Design · Tags · Einladen" — Design liegt seit T5 im Konto, die Runde hat den Filz (T14.5). | „Einstellungen · Filz · Tags · Einladen". |
| B5 | **T2.3 vs. T4.1** | Zusatzchips „Gäste · Teams · Tische" (Telefon) gegen „Jemand ohne Spiele? · Teams · Mehrere Tische" (Desktop). Sekundäraktionen sind Standardwörter (§1). | Standardlabels auch am Telefon, umbrechend statt gekürzt (T1 sagt das selbst). |
| B6 | **T7.1, T7.2, T5.3** | „Noch kein **Tisch** aufgestellt." · „Du allein am **Tisch**" · „Wähl dir ein **Aussehen**." — Runde ist Runde (§1); das Konto nennt es „Design". | „Noch keine Runde gegründet." · „Nur du · 3 Spiele · noch keine Session" · „Wähl dir ein Design." |
| B7 | **T4.5, T12.4, T7.4/7.5** | Abendwörter: „Zwei Tische, **ein Abend**" · „Die Frage, an der jeder **Spieleabend** hängt" (landet als String in neun Sprachen — der Test schlägt an) · Rundenname „Bergers Spieleabend" (erlaubt, aber ein schlechtes Beispiel). | „Zwei Tische, eine Session" · „…an der jeder Spieletreff hängt" · „Bergers Spieletreff". |
| B8 | **T9, T12.2 Glossar** | Das Glossar erklärt „Der Topf, Session wirbeln, Loswirbeln, aufdecken" als Tisch-Wörter — das **sind die Standardwörter**. Der Tisch benennt nichts um. T9s Kopf „4 themengetragene Wörter" ist ein Kategorienfehler, den die anderen Designs kopieren würden. | Glossarabschnitt nur für Designs mit eigenen Wörtern; für den Tisch entfällt er (oder ein Satz: „Der Tisch benennt nichts um."). |
| B9 | **T12.1 Landing** | Vertrauenszeile „Quellcode offen". Die Marketingregel des Betreibers vermeidet „open source" als öffentliches Argument. | Zeile streichen; „Kein Tracking · EU-Hosting" und „Mitspielen ohne Konto möglich" bleiben. |
| B10 | **T2.2/T3.2 Kümmerliste, T13.4, T1.4** | Erfundene Inhalte, die als Spezifikation gelesen würden: Kümmerliste „Tom hat 4 Sessions verpasst", „Wunschliste seit 3 Monaten still" (die App kennt: Spiele ohne Cover, fehlende Ergebnisse, fehlende Spielerzahl) · T13.4 „Wie Jonas wertet … 0,4 über dem Rundenschnitt" (gibt es nicht) · T1.4 Schalter „Geheime Abstimmung", „Ergebnisse sofort zeigen", „Auch Spiele ohne Besitzer im Topf" (gibt es nicht). Außerdem „1–99 Spieler" als Musterdatum. | Entfernen oder sichtbar als *Beispiel* markieren; Muster „2–4". Das Wertungsprofil (T13.4) ist ein Feature-Vorschlag, kein Design — separat einreichen. |
| B11 | **T3.3** | „Sortiert: Score" — die App sagt „Sortiert: Bewertung". | Wörtlich übernehmen. |

---

## C · IA

| # | Befund |
|---|---|
| C1 | **Die Wertungskarte als Vollbild ohne Dock und Kopfleiste ist richtig** — kein Loch. Sie hat den Zurück-Pfeil, die Fortschrittspunkte und das „Geheim"-Signal; auf der Live-Abstimmung und dem Ergebnis ist die Leiste wieder da. Bedingung: der Zurück-Pfeil ≥ 44 px. **Diese Ausnahme wird Regel für alle Designs** (auch für `/vote/<token>`, T12.5). |
| C2 | Alles andere hält: Screen-Set Stufe 1 und 2 vollständig, alle Hub-Blöcke inklusive der drei Vorschauen, die Schiene mit fünf Einträgen auf jedem Runden-Screen, Dock genau vier, Kopfleiste Sprache · Posteingang · Konto überall außer auf der Wertungskarte. Dichte (12 Plätze als Chips, 42 Spiele, Finnisch umbrechend) hält. |
| C3 | **Lücke:** Vom Regal (T3.3, T6.2) führt kein Weg zu „Nicht im Regal" — nur vom Hub und aus dem Spielepass. Ein Eintrag in der Regal-Werkzeugzeile oder am Fuß der Bretter. |

**Overlays (offen laut README):** ja, ein eigenes Blatt. 18 Sheets und ~30 Dialoge sind das, womit Leute den halben Abend arbeiten (Platzwahl, Filter, Teams, Gäste, Tische, Spiel bearbeiten, Mitglied bearbeiten, Einladen, Übertragen). Als **T15** in zwei Sessions (T15a Sheets/Popover, T15b Dialoge · Toasts · „…"-Menü) — **vor** Phase 2, damit die anderen Designs es als X15 mitbekommen.

---

## D · Entscheidungen, die Claude Design getroffen hat — bitte bestätigen

| # | Entscheidung | Einschätzung |
|---|---|---|
| D1 | **App-Icon designunabhängig** (Filz + Goldwirbel für alle sieben Designs; nur OG-Bild und Screenshots zeigen das gewählte Design). | Technisch richtig (das Manifest ist statisch). Es ersetzt aber das heutige Icon (weißer Würfel auf Orange) — das ist ein Markenwechsel, nicht nur ein Tisch-Detail. |
| D2 | **Cover „in eigener Höhe"** auf den Brettern. | Gute Idee, aber die App speichert kein Seitenverhältnis; Cover kommen in festen Kästen von BGG. Entweder das Verhältnis beim Import speichern (Implementierungsaufwand) oder die Bretter mit fester Kastenhöhe zeichnen. Das ist eine Spezifikationslücke für die Umsetzung, kein Designfehler. |
| D3 | **Die drei Off-Regal-Listen auf einem Screen mit Segmenten** (T13.3). | Passt zur IA, solange jedes Segment seine eigene Adresse behält (die App routet `/aussortiert`, `/durchgespielt`, `/wunschliste` getrennt). |
| D4 | **Auswahlkarte: Klassisch zuerst, „Wie bisher".** | Richtig; so bleiben. |

---

## Was für die anderen fünf Designs anders laufen soll (in den Handover übernommen)

1. **T1 ist die Quelle — wirklich.** Markerfarben und alle Flächen-Tokens in T1; T8 misst nur. Placeholder-Cover sind Nicht-Token.
2. **Akzent auf Markerfarbe nur ab 24 px oder als Glyphe.** Text auf der Markerfläche steht in Papier/Tinte.
3. **Kein Text auf einem Cover.** Metazeilen auf ein deckendes Band.
4. **Textlinks 24 px, Fuß 32 px, Toast-Aktionen 24 px** — als Token in T1, nicht als Einzelfund.
5. **Wörter aus der App abschreiben, nicht paraphrasieren:** die drei Presets, „1× gar nicht", „Sortiert: Bewertung", die Kümmerliste-Einträge, „Einstellungen · <Marker> · Tags · Einladen". Erfundene Inhalte sichtbar als Beispiel markieren.
6. **Glossar nur, wenn es etwas zu erklären gibt.**
7. **Wertungskarte = Vollbild ohne Dock/Kopfleiste, Zurück ≥ 44 px** — die Regel, nicht die Ausnahme.
8. **X15 Overlays** gehört in jede Brief-Liste.
9. **Eigene Kontrastzahlen prüfen, bevor sie zitiert werden:** T2 (6,1:1) und T8 (4,2:1) nennen für dasselbe Paar verschiedene Werte. Ein Blatt rechnet, die anderen zitieren es.
