# Prüfung „Forest" (F1–F15b, F17) — Runde 1

Datum: 2026-10-01 · Runde 1 · Geprüft: `forest.zip` (Erstlieferung, 15 Blätter, die vier
Bauteile und das Konzeptblatt G) gegen `handover-claude-design-2026-09-19.md`,
`handover-vokabular-2026-09-20.md`, `handover-abzeichen-2026-09-26.md`, die Prüfungen von
Tisch, Ocean, Brücke, Programmheft und Abzeichen und den Code der App (Stand `main` vom
01.10., `5a17926`).

## Urteil

**Abgenommen in Runde 1, keine Rückgabe an Claude Design.** Die Messungen sind sauber, die IA
und die Session-Schleife sind vollständig, und der Wortlaut kommt fast überall wörtlich aus
`de.js`. Die Funde unten sind klein und werden **bei der Umsetzung erledigt**, wie bei den
X17-Blättern. Der Auftraggeber hat alle neun Entscheidungen der README bestätigt und das
Plakat hell entschieden (siehe unten).

| | Runde 1 |
|---|---|
| Echte Kontrastfehler | **0** (Kontrolle 3/3 auf F3.2) |
| Bedienelemente unter ihrer Trefferfläche | **0** echte (Meldungen erklärt, siehe unten) |
| Bedienelemente als `div` | **0** (zweiter Durchlauf über `cursor: pointer` außerhalb von Links: leer) |
| Hexwerte in F2–F17 und den Bauteilen ohne Deklaration in F1 | **0** (76 Werte in F1) |
| Glyphen, die im Repo-Subset fehlen | **0** von 71 (Repo deklariert 113) |
| Sprachen im Wähler ≠ Repo | **0** (neun, mit fi und ko) |
| Young Serif gefettet | **0** · unter 19 px: 1 Stelle (U3) |
| Fehlende IA-Blöcke / Screens der Session-Schleife | **0** (geteilte Wertung F4.5/F6.5, Sichtblende F4.6/F6.6, Tische F4.4/F6.7) |
| Fehlende Overlays | **0** (14 Sheets inkl. Gast, 3 Popover, 9 Dialoge, 6 Toasts, Menü) |
| Fehlende Dichtebelege | **0** (F7.7–F7.10, 30-Zeichen-Name in F7.2) |

**Methode.** Jedes Blatt über einen statischen Server mit dem Repo-`public/` gerendert.
`tools/audit.js` pro Blatt, dazu ein zweiter Durchlauf über Text-Überlappungen, Text, der aus
seinem gerahmten Kasten läuft, Young-Serif-Satz und Schriftgrößen. Wertungskarte, Sichtblende
und Dock wurden getrennt gegen 44 px gemessen. Alle Blätter sind mit Headless Chrome in voller
Größe gerendert und am Bild geprüft. Wortlaut gegen `de.js`/`fi.js` per Schlüsselsuche.

## Für die Umsetzung (an die Slices, nicht an Design)

| # | Datei · Screen | Befund | Erledigung |
|---|---|---|---|
| U1 | F2.3, F4.2, F8.3 | Gesicht 3 heißt **„kann ich"**. Die App sagt **„wäre okay"** (`vote.scale3`). Der F9.5-Satz „alles andere steht so in de.js" stimmt deshalb nicht ganz. | App-String nehmen. |
| U2 | F13.5, F13.6, F17.4 Tischkarte | **„Moorgeister" läuft aus der fünften Zahlenkachel** (Lieblingsspiel in Young Serif): 66 px am Desktop, 33/34 px am Telefon und auf der Tischkarte. Mit „Kartographen des Nordens" wäre es noch schlimmer. | Spielname in Alegreya Sans, umbrechend. Die Kachel wächst in der Höhe. |
| U3 | F8.4 Rückblickkarte | Die Platzziffern 1–3 stehen in Young Serif bei **15 px**. Das bricht die eigene Regel (≥ 19 px). | Die Karte zeichnet der Canvas-Code. Ziffern dort in Alegreya Sans 800. |
| U4 | Telefonkopf, F3.2, F6.1, F6.7, F13.3/4 | Initialen auf **11 px** (Konto-„M", Mitgliedsringe). Die README sagt: „11 px nur in Achsen". Der Kontrast besteht. | 12 px als Untergrenze für Initialen. |
| U5 | F13.5 Mitglied (Desktop) | Als einziger Rundenscreen **ohne Wegweiser** (nur Brotkrume). F1.7 verlangt ihn auf jedem Rundenscreen. | Gemeinsames Markup, kommt in der App ohnehin mit. |
| U6 | F13.3 Pokale | Rubrik **„Auszeichnungen"** über den vier Plaketten. Das Addendum nennt das Wort als Revert, und das Programmheft hat es als Rubriktitel verworfen (Abzeichen-Prüfung, „Nicht beanstandet"). | Ohne Rubriktitel, wie in der App. |
| U7 | F4.2 Abstimmung (Desktop) | **„Zum Spiel"** ist 32 px hoch, auf der Wertungskarte gilt 44 px (Regel T7). | Auf 44 px setzen. |
| U8 | F4.5, F6.5 | **QR-Code inline** im Panel. Wie bei Tisch, Ocean und Brücke gilt: Der QR-Code bleibt hinter seinem Knopf, weil `POST …/vote-link/qr` das Token erst erzeugt. | Knopf an die Stelle des Codes, Panel sonst wie gezeichnet. |
| U9 | Alle Fußzeilen | „FAQ" ist 23 px breit (Token `target-foot 32` „in Höhe UND Breite"). Wegen der Abstandsausnahme besteht 2.5.8 trotzdem. | `min-width` am Fußlink. |
| U10 | F10.4 | Die Kopfzeile sagt „≈ 3 s", die Zeittafel läuft bis 5 000 ms. | Zeittafel gilt. Die Glühwürmchen enden nach zwei Aufstiegen und laufen nicht in Schleife. |
| U11 | F14.3, F13.5, F3.4 | Paraphrasen: „Freunde" (App: „Freundeskreis"), „Quote" / „Ø Wertung" (App: „Siegquote", „Ø vergebene Wertung"), die Score-Erklärung in F3.4, „Zurück zum Regal", „Verknüpft mit BoardGameGeek". Die Dialogtitel in F15b stehen so nicht in `de.js`. | Überall die App-Strings. Die Blätter zeigen nur die Form. |
| U12 | Konzeptblatt G | Noch der alte Wortstand: „Noch eine Runde", „Die Fährte", „Blatt 2 von 3", „Laub wirbeln" im Hub, „Heute, 19:12". F9.2 listet das alles als entfernt. | „Noch eine Runde" ist bei der Übernahme auf „Noch eine Session" berichtigt (wie Programmheft R2-2). Den Rest lässt das Blatt stehen: Es ist Referenz, F9.2 gilt. |
| U13 | F5.3/F5.4 | Das Wortbild „Das Programmheft" läuft auf dem Plakat 11 px über den Rahmen. | Schon Auflage in #1376. Die Plakate zeichnet der Code. |

## Entscheidungen des Auftraggebers (01.10.2026)

**Alle neun Entscheidungen der Paket-README sind bestätigt** (hier E1–E9 nach ihrer Nummer
dort): E1 Hub-Knopf bleibt „Session wirbeln", „Laub wirbeln" nur auf Neue Session · E2/E3 vier
Themenstellen, die Konzeptwörter aus F9.2 bleiben draußen · E4 Dämmerung `#24331f` als zweiter
Grund, Glühwürmchen tragen nur dort Bedeutung · E5 Übergabe als Dämmerung ohne Wert und Spiel ·
E6 Standardmarker Tanne · E7 Pokale als Hain, Platz 2/3 ohne Silber und Bronze · E8 kein
Tablet-Blatt · E9 Abzeichen nach dem X17-Beschluss.

**Plakat im Design-Wähler: hell.** F5.3/F5.4 zeichnen Forest dunkel (Dämmerung). Das wird nicht
übernommen, weil Forest ein helles Design ist und neben dem grünen Tisch-Plakat als solches
erkennbar sein muss. Die Registry-Zeile bekommt
`poster: { ground: ['#ecf1e4', '#d6e4c6'], ink: '#356427', sub: '#1b2a18' }`
(Akzent 6,1 / 5,3:1, Tinte 13,1 / 11,3:1 auf den beiden Stopps). Claude Design muss dafür nichts
neu zeichnen, die Plakate zeichnet der Code.

## Beobachtungen, keine Funde

- Text-Überlappungen von 2–5 px über alle Blätter sind Zeilenboxen beim Durchschuss 1,05/1,1,
  keine Tinte. Die 17–18-px-Treffer liegen in den Prüflisten- und Glossartabellen der Blätter.
- Die eine Kontrastmeldung (F15b, 4,35:1) ist das Schlüssel-Etikett `startSession.toast.noGames`
  im Fehlertoast, also Blattbeschriftung. Der Toasttext selbst hat 6,1:1.
- Personenringe auf der Dämmerung liegen unter 3:1 (1,9–2,9). F8.1 begründet das: Dort trägt
  der helle Kern die Grenze (12,8:1), der Ring ist Schmuck.
- Die Rampe steigt in der Leuchtdichte monoton (Veto 0,03 → 5 0,77). Veto und Stufe 1 liegen
  dicht beieinander (0,03/0,08). Wort und Gesicht tragen den Unterschied.
- `vorgaben/` gehört bei der Übernahme nicht in den Paketordner. Die Dateien liegen schon in
  `docs/design/`.

**Übernommen (01.10.2026):** Paket in `docs/design/forest/` (Pfade auf `../../../public/`,
`support.js` unverändert und byte-gleich mit dem der anderen Pakete, `vorgaben/` nicht übernommen,
U12 dabei berichtigt). Die Slices sind #1465–#1476 unter Epic #1206, das Abzeichen-Skin ist #1477
(Teil von #1386), Go-live ist #1478. Die Punkte U1–U13 stehen in den Slices, die sie betreffen.
