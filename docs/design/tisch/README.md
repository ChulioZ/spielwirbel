# Prüfauftrag, zweite Runde: Spielwirbel-Design „Der Tisch" (T1–T15b)

## Worum es geht

Spielwirbel ist eine bestehende Web-App für Spielegruppen: eine **Runde** führt ein **Regal** mit
Brettspielen, lost per **Session** aus, was heute in Frage kommt, jede Person wertet geheim 1–5,
danach schreiben **Chronik** und **Pokale** sich selbst. Die App bekommt sieben wählbare Designs
(Klassisch, Der Tisch, Das Programmheft, Die Brücke, Der Run, Forest, Ocean). Dieses Bündel enthält
das **erste vollständig durchgezeichnete Design: „Der Tisch"** — Spielecafé-Metapher, Nussbaum,
grüner Filz, Messing.

**Dies ist kein Implementierungsauftrag.** Gesucht ist eine **Prüfung** der Entwürfe gegen die
mitgelieferten Vorgaben, bevor die anderen sechs Designs nach demselben Muster gebaut werden.
Fehler, die hier drinstecken, würden sich sonst sechsmal wiederholen.

## Was sich seit der ersten Prüfung geändert hat

Die erste Runde liegt als `../pruefung-tisch-2026-09-20.md` bei. **Alle Funde sind eingearbeitet**,
dazu zwei Nachzügler, die beim Nachmessen im Farbblatt selbst auffielen. Für diese Runde
interessiert vor allem: *Ist es wirklich behoben, und hat die Korrektur nichts Neues gebrochen?*

Eingearbeitet (Kurzfassung):

- **A1 Gold auf Filz** → Regel in T1: Gold ist Display- und Glyphenfarbe, als Schrift auf Filz erst
  ab 24 px. Dock-Labels, „Platz dazu", Kicker, Datumszeilen, Tischbeschriftungen und die Fußlinks der
  Abstimmungsseite stehen jetzt in Papier `#f6ecd8`. T8 misst am **hellen Verlaufsende**; der
  Widerspruch T2 (6,1:1) ↔ T8 (4,2:1) ist weg.
- **A2** Tinte auf der Goldzeile der Tafel → `#4a3423`. **A3** inaktive Schnellfilter auf Filz →
  Fläche `#3f6a48`. **A4** `#8d5a36` → `#7a4a28`. **A5** Sockelbeschriftung → `#2f2109`.
  **A6** kein Text mehr auf einem Cover (Metazeile auf deckendem Band). **A7** Textlinks tragen
  4 px Polsterung, Toast-Aktionen 24 px. **A9** Screenshot 2 hat wieder Filz hinter der Karte.
- **A8 T1 ist die Quelle** → Filz- und Marker-Tokens stehen jetzt in T1 (T8 misst nur),
  Platzhalter-Cover sind ausdrücklich als Nicht-Tokens markiert.
- **B1–B11** Wörter aus der App: „1× gar nicht" statt des umgekehrten „kein Veto", die drei
  Schnellstart-Presets, „Sortiert: Bewertung", echte Kümmerliste-Einträge, „Nicht im Regal" als
  Gruppentitel, keine Abendwörter, „Quellcode offen" gestrichen, erfundene Schalter und das
  Wertungsprofil zurückgezogen. **B8:** der Tisch benennt **nichts** um — T9 und T12 behaupteten das
  Gegenteil und sagen es jetzt richtig.
- **C3** Vom Regal führt ein Weg zu „Nicht im Regal".
- **D-Entscheidungen des Auftraggebers:** Icon **pro Design** (Klassisch behält den weißen Würfel —
  kein stiller Markenwechsel); **fester Coverkasten** statt ungleicher Höhen, weil die App kein
  Seitenverhältnis speichert; erfundene Inhalte auf App-Inhalte zurückgezogen; **T15 vor Phase 2**.
- **Neu: T15a und T15b** (siehe Tabelle) — die Overlay-Sammlung, die in Runde 1 als Lücke benannt war.

## Was die Dateien sind

16 HTML-Dateien, eine pro Brief (T1–T14, T15a, T15b). Es sind **Design-Referenzen**, keine Produktionskomponenten:
inline gestyltes HTML, das im Browser direkt öffnet. Jede Datei zeigt mehrere Screens oder Tafeln
nebeneinander auf einer Fläche und trägt unten einen Kasten „Was TX entscheidet" mit den
Design-Entscheidungen in Worten.

- Öffnen: Datei direkt im Browser öffnen (kein Build, kein Server nötig).
- `support.js` ist die Laufzeit, die diese Dateien rendern lässt — **nicht prüfen, nicht bewerten,
  nicht Teil des Designs.** Ebenso die `{{ … }}`-Platzhalter und `<sc-for>`/`<sc-if>`-Tags: das ist
  das Autorenformat, nicht die Zielarchitektur.
- Zwei externe Abhängigkeiten: Google Fonts (Bricolage Grotesque, Manrope) über `<link>`, und die
  lokale Tabler-Icon-Schrift unter `public/fonts/`. Ohne Netz fehlen die Schriften, das Layout bleibt.
- Die Cover der Brettspiele sind **typografische Platzhalter** (CSS-Verläufe mit Titel). Echte
  Schachtelbilder kommen zur Laufzeit von BoardGameGeek. Das ist Absicht und kein Mangel.

## Die Dateien

| Datei | Inhalt |
|---|---|
| `Tisch-T1-Komponenten.dc.html` | Tokens (Flächen, Schrift, Akzent, Semantik, Radien, Abstände, Schatten), Typoskala, alle Bauteile in fünf Zuständen (Ruhe · Hover · Fokus · Deaktiviert · Lädt), Tafel, Avatare, Cover, Gesichter, Score-Pillen, Leerzustand, Skelett, Fuß |
| `Tisch-T2-Phone-Kern.dc.html` | Telefon 390: Rundenhub (zwei Scrollstände), Neue Session, Wertungskarte, Ergebnis, Dock in 2× |
| `Tisch-T3-Runde-Desktop.dc.html` | Desktop 1440: Lobby, Rundenhub, Regal, Spielepass, Spiel-Suche |
| `Tisch-T4-Session-Desktop.dc.html` | Desktop 1440: Session-Setup, Wertungskarte, Live-Abstimmung, Ergebnis, mehrere Tische |
| `Tisch-T5-Konto.dc.html` | Anmelden/Registrieren/Passkey, Konto mit Design-Wahl, Auswahlkarte mit sieben Plakaten, Telefonfassung |
| `Tisch-T6-Phone-Rest.dc.html` | Telefon 390: Lobby, Regal, Spielepass, Spiel-Suche, Live-Abstimmung, mehrere Tische |
| `Tisch-T7-Leerzustaende.dc.html` | Leere und junge Zustände + Dichtefälle (42 Spiele, 12 Plätze, langer Name, finnische Labels) |
| `Tisch-T8-Farben.dc.html` | Acht Markerfilze, endgültige Score-Rampe, Mitgliedsfarben auf jeder Fläche — **die Kontrastzahlen rechnet das Blatt beim Rendern selbst** |
| `Tisch-T9-Vokabular.dc.html` | Vokabular DE + EN, Glossar, Verbotsliste |
| `Tisch-T10-Motion.dc.html` | Fünf Rituale als Prototyp, jedes mit statischem Endzustand daneben |
| `Tisch-T11-Karte-Marke.dc.html` | Rückblickkarte (1080 × 1350), App-Icons, Favicon, OG-Bild, drei Landing-Kompositionen |
| `Tisch-T12-Oeffentlich.dc.html` | Landing, Recht/FAQ/Glossar, Kontakt, Absichtsseite, Abstimmungsseite ohne Konto |
| `Tisch-T13-Tier2a.dc.html` | Chronik + Zeitraum-Rückblick, Pokale, Mitgliedsseite, drei Off-Regal-Listen, Empfehlungen |
| `Tisch-T14-Tier2b.dc.html` | Spielerkarte, Freunde + Feed, Posteingang, „Was ist neu", öffentliche Statistik, Rundeneinstellungen mit Filz-Auswahl |
| `Tisch-T15a-Sheets.dc.html` | Die 18 Overlays als Sheet (Telefon) und Popover (Desktop), plus die Regel, was sich zwischen beiden Auftritten ändert |
| `Tisch-T15b-Dialoge.dc.html` | Bestätigungsdialoge (11 bleiben, der Rest wird „Rückgängig"), Toasts, „…"-Menü in vier Auftritten, Fehlerzustände der Sheets |

Fidelity: **hifi.** Farben, Schriftgrößen, Abstände und Zustände sind final gemeint.

## Vorgaben, gegen die geprüft werden soll

Alle drei liegen unter `../` (one level up):

1. `handover-claude-design-2026-09-19.md` — das Pflichtenheft. Relevant sind besonders
   **§2** (die gemeinsame Informationsarchitektur), **§3** (was jedes Design liefern muss),
   **§4** (Tisch-spezifische offene Punkte), **§5** (harte Zugänglichkeits- und Handwerksregeln)
   und **§8** (die Brief-Liste T1–T14).
2. `handover-vokabular-2026-09-20.md` — die Vokabularregel: **Substantive und Navigation sind
   Spielwirbels, das Thema trägt nur Ritual und Dekor.** §1 listet, was nie umbenannt werden darf,
   §2 die vier Stellen, an denen ein Design eigene Wörter haben darf.
3. `projektregeln-CLAUDE.md` — die Kurzfassung der stehenden Regeln (IA-Prüfliste, Handwerksregeln,
   die acht Mitgliedsfarben, das Verbot von Abendwörtern für eine Session).

## Woran ich am meisten interessiert bin

In dieser Reihenfolge:

1. **Kontrast, nachgerechnet statt geglaubt.** Jede Textfarbe gegen ihren tatsächlichen Grund,
   4,5:1 für Text, 3:1 ab 24 px / 18,66 px fett und für bedeutungstragende Grafik. Die weiche Tinte
   ist über dem **dichtesten Pixel des Motivs dahinter** zu messen, nicht über der glatten Fläche —
   Filzverläufe und der Messingstreifen sind die kritischen Stellen. Zwei systemische Fehler dieser
   Art sind schon gefunden und behoben worden (Tinte auf Gold; Tertiärstufe auf gehobener Fläche);
   ich rechne mit weiteren.
2. **Trefferflächen.** ≥ 24 px überall, ≥ 44 px auf Wertungskarte und Dock.
3. **IA-Treue.** Die Prüfliste in `projektregeln-CLAUDE.md` ist bindend: Screen-Set unverändert,
   Hub trägt die genannten Blöcke, **jeder Desktop-Runden-Screen erreicht Start · Regal · Chronik ·
   Pokale · Einstellungen**, Telefon-Dock genau vier Einträge, Kopfleiste mit Sprache · Posteingang ·
   Konto auf jedem Screen. Eine bewusste Ausnahme existiert und ist benannt: die **Wertungskarte**
   läuft auf beiden Breiten als Vollbild ohne Dock und ohne Kopfleiste, damit niemand mitliest.
   Stimmt diese Begründung, oder ist es ein Loch?
4. **Vokabular.** Ist irgendwo ein Substantiv, ein Navigationswort, eine Personenbezeichnung oder
   eine sekundäre Aktion in die Tisch-Welt gerutscht? Erlaubt sind genau vier Themenwörter
   (`Der Topf`, `Session wirbeln`, `Loswirbeln`, `aufdecken`) plus die Skalenenden
   `gar nicht / unbedingt` und dekorative Zeilen wie „Spielecafé · deine Tische".
5. **Innere Widersprüche.** T1 ist die Quelle; T2–T14 sollen sie nicht unterlaufen. Also: taucht ein
   Farbwert, eine Radius- oder Abstandsgröße auf, die T1 nicht kennt? Weicht eine Score-Pille von der
   Rampe in T8 ab? Nennt ein Blatt eine Zahl, die ein anderes anders nennt?
6. **Text im Layout.** Lange Namen, 12 Personen, 40+ Spiele, +30 % Sprachlänge (Finnisch,
   Französisch) — T7 behandelt diese Fälle bewusst. Halten die übrigen Blätter sie auch, oder brechen
   dort Zeilen um, überlappen Elemente, wird abgeschnitten?

## Was nicht geprüft werden muss

- `support.js`, die `{{ … }}`-Platzhalter, `<sc-for>`, `<dc-import>`, `<helmet>` — Autorenformat.
- Die Wahl der Metapher, der Schriften und der Farbwelt. Die ist abgenommen.
- Umsetzbarkeit in einem Framework. Es geht um die Entwürfe, nicht um Architektur.
- Die Platzhalter-Cover (siehe oben).

## Bekannt offen

- **Engster Kontrastfall:** Ockerfilz trägt Papierschrift mit 4,56:1 — bestanden, aber ohne Reserve.
  Wer ihn nachtönt, muss die Zahl neu rechnen.
- Die Overlay-Sammlung ist jetzt gezeichnet (T15a/T15b); **was dort fehlt**, ist der Abgleich der
  ~30 Dialogtexte mit den echten Strings der App — ich habe sie nur dort wörtlich übernommen, wo ich
  sie im Code gefunden habe (`games.retireConfirm`, `bulk.confirmDeletePlain`,
  `roundSettings.deleteIntro`, `roundSettings.leaveIntro`). Der Rest ist formuliert, nicht zitiert.
- **Icons:** verwendet wird nur das Tabler-Subset unter `public/fonts/tabler-icons.css`.
  Wenn ein Blatt eine Glyphe nutzt, die dort nicht definiert ist, rendert sie als Nichts — bitte
  mitprüfen. (Drei solche Fälle wurden gefunden und ersetzt.)
- Das **„Powered by BGG"-Badge** ist eine Lizenzpflicht und **darf nicht umgestaltet werden**: es ist
  überall das Originallogo `public/icons/powered-by-bgg.png` bei 132 px. Die Designs dürfen ihm nur
  einen hellen Träger geben.

## Wie das Ergebnis am besten zurückkommt

Wie beim ersten Mal: eine Liste pro Fund mit **Datei · Screen-Label · was falsch ist · gemessener
Wert · Vorschlag** — und diesmal bitte zusätzlich eine kurze Aussage, ob die Funde aus Runde 1
wirklich geschlossen sind (A1–A9, B1–B11, C3).
Die Screens tragen `data-screen-label`-Attribute (z. B. `T4.3 Live-Abstimmung`) — die als Adresse
nutzen, dann finde ich die Stelle sofort wieder. Systemische Funde (ein Token, das in vielen Dateien
falsch verwendet wird) bitte als **einen** Punkt mit der Quelle in T1 melden, nicht als 14 Einzelfunde.
