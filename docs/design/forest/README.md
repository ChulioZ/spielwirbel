# Übergabepaket „Forest“ — F1 bis F15b plus F17

Datum: 2026-10-01 · Phase 2, Design 4 von 5 (Reihenfolge O → B → P → **F** → R)
Stand: **Erstlieferung**, bereit für Prüfrunde 1.
Erzeugt von Claude Design für die Überführung in GitHub-Issues durch Claude Code.

**Abweichung vom Ablauf:** Der Auftraggeber hat ausdrücklich gewünscht, dass alle Briefs in einer Session entstehen. §0 sieht einen Brief pro Session vor. Vor der Übergabe lief deshalb eine Selbstprüfung per Skript (siehe unten). Sie ersetzt die Prüfung nicht. **F17 (Abzeichen)** ist gleich mitgeliefert, weil das Feature live ist.

---

## Inhalt

| Datei | Brief |
|---|---|
| `Forest-F1-Komponenten.dc.html` | Bauteile und Tokens — **die einzige Token-Quelle**, Kontraste werden beim Rendern gerechnet |
| `Forest-F2-Phone-Kern.dc.html` | Telefon 390: Hub, Neue Session, Abstimmung, Ergebnis, Dock |
| `Forest-F3-Runde-Desktop.dc.html` | Start, Hub (mit IA-Prüfliste), Regal, Spieldetail, Spiel hinzufügen |
| `Forest-F4-Session-Desktop.dc.html` | Neue Session, Abstimmung, Ergebnis, Mehrere Tische, Geteilte Wertung, Übergabe (mit Prüfliste Session-Schleife) |
| `Forest-F5-Konto.dc.html` | Anmelden/Registrieren/Passkey (Desktop + Telefon), Kontoseite mit Design-Wähler, Auswahl-Sheet (Desktop + Telefon) |
| `Forest-F6-Phone-Rest.dc.html` | Telefon: Start, Regal, Spieldetail, Spiel hinzufügen, Geteilte Wertung, Übergabe, Mehrere Tische |
| `Forest-F7-Leerzustaende.dc.html` | Leer und jung (Desktop + Telefon) **plus Dichtebelege** F7.7–F7.10 und ein Rundenname mit 30 Zeichen (F7.2) |
| `Forest-F8-Farben.dc.html` | Personenfarben auf fünf Flächen, acht Marker, Rampe unter Farbfehlsichtigkeit (im Browser simuliert), zwei Rückblickkarten |
| `Forest-F9-Vokabular.dc.html` | Themenstellen DE + EN, Revert-Liste, Sperrwörter, **Glossar**, neue Schlüssel (F9.5) |
| `Forest-F10-Motion.dc.html` | Vier Rituale, abspielbar, Schalter „Reduzierte Bewegung“, Zeittafeln |
| `Forest-F13-Tier2a.dc.html` | Chronik + Rückblick, Pokale, Mitglied (je Desktop + Telefon), Nicht im Regal, Könnte euch gefallen |
| `Forest-F14-Tier2b.dc.html` | Rundeneinstellungen mit Markerwähler, Profil, Freunde + Feed, Postfach, Was ist neu, Statistik |
| `Forest-F15a-Sheets.dc.html` | 14 Sheets (inkl. „Gast hinzufügen“), 3 Popover (Sortierung, Filter, Sprache) |
| `Forest-F15b-Dialoge.dc.html` | 9 Dialoge aus `de.js`, 6 Toasts aus `de.js`, „…“-Menü |
| `Forest-F17-Abzeichen.dc.html` | Abzeichen: sechs Zustände, Pokale Desktop + Telefon, Tischkarte, Ergebnis-Moment (abspielbar), Hub, Chronik, Spielerkarte, Leer + Dichte, Kontrast, Übergabe |
| `Forest-Kopf / -Telefonkopf / -Dock / -Fuss.dc.html` | **Vier Bauteile**, auf jedem Blatt eingebunden |
| `Konzept-G-Forest.dc.html` | Das Konzeptblatt mit V0-Revert (unverändert; Abweichungen in F9.2) |
| `support.js` | Laufzeit — **nicht ins Repo übernehmen** |
| `vorgaben/` | Handover, Vokabular-Addendum, Abzeichen-Handover, Projektregeln, Prüfungen Tisch · Ocean · Brücke · Programmheft, Brücke-Runde-3-Auftrag |

Nummerierung wie §9: F1–F10, F13, F14, F15a, F15b, dazu F17. Kein F11/F12 (Face-only). Die Dichtebelege stehen in F7, ein eigenes F16 gibt es nicht.

`public/` liegt nicht bei. Die Blätter zeigen per `public/fonts/tabler-icons.css` und `public/icons/powered-by-bgg.png` auf das echte Verzeichnis. Im Repo unter `docs/design/…` entspricht das `../../../public/`.

---

## Die Tokens in Kürze

Alles Weitere steht in F1. Dort werden die Werte beim Rendern mit der WCAG-Formel gerechnet.

```
page          #ecf1e4   Lichtung, Grund jeder Seite (Lichtflecken nur aufhellend)
band          #f3f6ec   Wegweiser, Telefonzeile
surface       #f9fbf4   Karte, Kachel, Kopf, Dock
raised        #ffffff   Sheet, Popover, Dialog, Feld
moss          #d6e4c6   Chip, Zweitknopf, Zähler · moss-hover #c9d9b6
dusk          #24331f   Dämmerung: verdeckte Karte, Übergabe, Toast, Abzeichen-Glas

ink           #1b2a18   ink-soft #4b5c45 (6,2:1 auf page)
on-accent     #f4f8ec   dusk-soft #c9d6bd · firefly #fff3a8 (nur auf dusk, 11,8:1)
accent        #356427   Laubgrün, trägt Text in jeder Größe (6,0:1 auf page) · accent-deep #284d1d
gold          #a86d14   Krone, Siegerkante (Grafik) · gold-ink #85570f (Text) · gold-tint #f3e6b0 (Siegerzeile)
ok = accent · warn #8a5300 · danger #a3392b · danger-tint #f8e4df
edge          #6f7f66   Bedienkante ≥ 3:1 auf page und surface
line          #d5ddca   Zierlinie — nie Text, nie Bedienkante
Holz (Motiv)  #5a3d24 #8a6240 #dcbf92 #c9a06f #b8905f · Laub (Motiv) #446b39 #4f7d40 #6b9a55 #7fae66 · hatch #e9f0df

Rampe 1→5     #3d5273 #3b6f6c #9cc38a #c2dc86 #f1e58c — Leuchtdichte steigt stetig · Veto #5b1e3a + Wort
              Ziffer hell auf Veto/1/2, Tinte auf 3–5
Marker (8)    Tanne #356427 (Standard) · Fingerhut #a2569b · Heidelbeere #3e4f8f · Fliegenpilz #b3342a
              Kiefer #7a4a2a · Moorsee #2f6f78 · Ginster #a07a12 · Schlehe #5a3a6e — nie Text darauf
Personen (8)  #c6522c #198663 #726bc7 #a66815 #c34d74 #2f6f9e #54821d #993556 — global, unverändert,
              nur als Ring um einen hellen Kern, Initiale in Tinte
Schrift       Young Serif 400 (einziger Schnitt, nie gefettet, ab 19 px) · Alegreya Sans 400/700/800 — beide OFL
Durchschuss   Display 1,05 · Titel 1,1 · Text 1,45 · Kicker → Überschrift 6 px
Knöpfe        Alegreya Sans 800 (Haupt), 700 (Zweit) — Young Serif nie auf Knöpfen
Textgrößen    Text ab 13 px · Kicker 12 px · 11 px nur Achsen
Radius        Blatt S 14·4·14·4 · Blatt L 22·7·22·7 · Karte 18 · Feld 12 · Sheet 24 oben
Ziele         target-min 24 · target-foot 32 · target-key 44 · target-field 44 — in Höhe UND Breite
Fokus         3 px Tinte, 2 px Abstand; auf dusk 3 px firefly
Nicht-Tokens  Blattgrund #dcdfd4, Platzhalter-Cover (oklch), scrim = Tinte 55 %, Plakatfarben in F5 (in F1 gelistet)
Rahmen        Telefon 390 × voller Inhalt (844 markiert) · Desktop 1440 × voller Inhalt (900 markiert)
Rückblickkarte 540 × 675 gezeichnet, Export 1080 × 1350 (× 2), ohne SVG
```

---

## Die dreiundzwanzig Regeln — alle übernommen, in F1.8 einzeln abgehakt

**Neun aus der Tisch-Prüfung:** T1 F1 ist die Quelle · T2 Akzent auf Marker nur ≥ 24 px · T3 kein Text auf einem Cover · T4 Trefferflächen als Token · T5 Wörter aus der App abschreiben · T6 Glossar nur bei Bedarf · T7 Wertungskarte Vollbild, Zurück ≥ 44 px · T8 X15 in der Liste · T9 Kontrastzahlen prüfen, bevor sie zitiert werden.

**Vier aus der Ocean-Rückgabe:** O1 alle Regeln · O2 IA-Prüfliste Block für Block (F3.2, F4) · O3 nach dem Revert den Text lesen (F9.2) · A5 Icons gegen das Repo.

**Drei aus der Brücke-Prüfung:** B1 die Zahl hier ist prüfbar — dreiundzwanzig · B2 Icons gegen das Repo, nicht die Vorgängerkopie · B3 Dichtebelege sind Teil der Lieferung (F7.7–F7.10).

**Sieben aus der Programmheft-Prüfung** (Runde 1, 26.09.) — jetzt Vorgabe statt Befund:
- P1 Jede Farbe in F1, auch die acht Personenfarben und jeder weiche Ton.
- P2 Die einschnittige Schrift immer mit 400, nie unter ihrer Mindestgröße, nie auf Knöpfen.
- P3 Durchschuss als Token.
- P4 Nur zeigen, was die App hält: kein Offline-Toast.
- P5 App-Wortlaut, neue Wörter markiert, z. B. „Noch eine Session“ (`tables.oneMore`).
- P6 Keine Schrittleiste auf Neue Session.
- P7 Gast-Sheet und alle vier Schnellstarts (inkl. „Anspruchsvoll“, DE + FI).

Alle Bedienelemente sind `<a>` oder `<input>`, keines ist ein `div`.

---

## Selbstprüfung vor der Übergabe

Per Skript über alle 19 Forest-Dateien:

- **Glyphen:** alle verwendeten `ti-`Klassen stehen im `public/fonts/tabler-icons.css` des Projekts (109 Klassen, Stand Repo inkl. `ti-qrcode`). Es gibt keine neuen Glyphen.
- **Hexwerte:** kein Hexwert in F2–F17 oder in den Bauteilen, der nicht in F1 deklariert ist. Ein Laubton (#5f8f4c) wurde dabei gefunden und ersetzt.
- **Schriftgrößen:** keine Angabe unter 11 px. Zwei 10-px-Initialen wurden auf 12 px angehoben. 11 px kommen nur in Achsen vor.
- **Young Serif:** jede Angabe trägt `font-weight: 400` (per Ersetzungslauf erzwungen). Nirgends steht sie unter 19 px. Die Wortmarke auf der Rückblickkarte wurde von 16 auf 19 px gehoben.
- **Abendwörter:** der Wortteil „abend“ kommt nur in F9.3 vor, wo das Sperrwort zitiert wird.
- **Wortlaut:** gegen `public/js/lang/de.js` (Repo `main`, 01.10.) geprüft: `hub.*`, `startSession.*`, `vote.*`, `lobby.*`, `result.*`, `tables.*`, `pokale.*`, `badges.*`. Dabei korrigiert: „Lea wertet“ → „Es bewertet: Lea“ (`vote.who`). Finnisch aus `fi.js`.

---

## Entscheidungen in dieser Lieferung — bitte bestätigen

1. **Hauptknopf im Hub bleibt „Session wirbeln“.** Das Konzept hatte „Laub wirbeln“ in Hub und Setup. Damit trügen zwei verschiedene Aktionen denselben Namen. „Laub wirbeln“ lost jetzt nur auf Neue Session.
2. **Themenstellen nur vier:** Baumstumpf, „Wie viele Blätter fliegen?“ (mit der App-Zeile „3 von 9 Spielen werden gezogen“ darunter), „Laub wirbeln“, aufleuchten. Das Glossar steht in F9.4.
3. **Aus dem Konzept entfernt** (F9.2): „Die Fährte“, „Blatt 2 von 3“, „Noch im Dunkeln“, „Noch eine Runde“, Text und Stempel auf dem Cover, „Heute, 19:12“.
4. **Dämmerung als zweiter Grund.** Glühwürmchen tragen Bedeutung nur auf #24331f. Auf heller Fläche sind sie Schmuck.
5. **Übergabe als Dämmerung:** Der Knopf „Los geht’s ›“ ist ein Glühwürmchen (#fff3a8) mit Tinte. Die Sichtblende zeigt weder Wert noch Spiel.
6. **Marker-Standard Tanne** (= Laubgrün). Das Konzept hatte Fingerhut.
7. **Pokale als Hain:** ein Baum je Person, die Höhe folgt den Siegen. Platz 1 bekommt Gold-Tönung, Platz 2 und 3 stehen auf der Karte mit Tintenkante, ohne Silber und Bronze (wie Entscheidung 7 beim Programmheft).
8. **Kein Tablet-Blatt.** Zwischen 768 und 1024 px trägt die Desktop-Ordnung mit zwei Hub-Spalten.
9. **F17:** Personen-Abzeichen sind Gläser, Runden-Abzeichen Blätter am Ast. Die Stufe steht als Ziffer auf dem Deckel. Jonas steht bei **22 / 25** Stammgast, weil er 22 der 23 Sessions gespielt hat (F13.3). Stammgast und Sessions haben vier Stufen (wie T17/P17). Es gibt keine neuen `badges.*`-Schlüssel. Die FI-Namen kommen aus `fi.js` und sind keine Platzhalter mehr.

## Neue Schlüssel (F9.5)

Nach Entscheidung 9 vom 26.09. ordnet Claude Code jeden Eintrag einem echten Schlüssel zu oder legt ihn neu an. Die Forest-Varianten folgen dem Muster `…Ocean` / `…Bruecke`, das in `de.js` schon besteht: `startSession.potHeadingForest`, `potLabelForest(One)`, `countQuestionForest`, `drawForest`, `vote.revealForest`, `hub.young.emptyTitleForest`, `home.greetingForest(First)`, `home.subbrandForest`, `home.noticeKickerForest`, `result.kickerForest`, `round.markerForest.*`. Dazu kommen die Leersätze für den Start ohne Runde, „Weiter →“, die Faktenzeile, „Ohne BGG eintragen“, „Sammlung lesen“, „Sieger ändern“ (Menü) und zwei Helferzeilen aus dem Addendum, die nicht in `de.js` stehen.

## Für die Umsetzung (nicht an Design)

- Schriften selbst hosten (CSP `font-src 'self'`): Young Serif 400 und Alegreya Sans 400/700/800 als woff2 nach `public/fonts/`, mit OFL-Lizenzdatei. **Young Serif als `font-weight: 400 800` deklarieren**, sonst werden Überschriften künstlich gefettet.
- Helles Design: den Farbblock auf `:root[data-design="forest"]:not([data-scheme="dark"])` gaten.
- Fokusring an Feldern über `:focus-within` am Label.

## Was offen bleibt

- Prüfrunde 1.
- Kontraste in der echten App, gemessen gegen die hier gezeichneten Gründe.
- Die Bauteile als DC-Kinder sind Blattwerkzeug. In der App entspricht ihnen das gemeinsame Markup von Topbar, Rail und Dock mit Forest-Overrides.
- K17-Klassennamen in F17.10 sind wie in T17 vorläufig.
