# Prüfung „Die Brücke" (B1–B16) — Ergebnis

Datum: 2026-09-22 · Zwei Runden · Geprüft gegen `handover-claude-design-2026-09-19.md`,
`handover-vokabular-2026-09-20.md`, `projektregeln-CLAUDE.md`,
`pruefung-tisch-2026-09-20.md`, `pruefung-ocean-2026-09-20.md` und den Code der App.

Methode: alle 15 Blätter in Chromium gerendert. Kontrast **pixelgenau** — alle
Glyphen auf `color: transparent`, ein Vollbild je Blatt, und für jeden der
**2 749 Textknoten** der tatsächliche Grund in seiner eigenen Box (Modalwert =
der Grund, 10. Perzentil als Gegenprobe). Trefferflächen aus dem gerenderten
Layout, über **1 336 knopfförmige Kästen**. Wortlaut gegen `public/js/lang/de.js`,
`fr.js` und `fi.js`, Screen-Set und Erreichbarkeit gegen die Vorgaben, Farbwerte
von B2–B16 gegen B1, Icons gegen die cmap und die Klassenliste des **Repos**.

**Messgerät kontrolliert, beide Runden.** Auf einem sauber messenden Blatt drei
Textknoten absichtlich eingefärbt; gemeldet wurden **genau diese drei**
(Runde 1: B3, 1,20/1,56/1,83:1 · Runde 2: B16, 1,24/1,26/1,83:1). Die Nullen
sind gemessen, nicht blind.

## Urteil

**Abgenommen.** Runde 1 meldete fünf systemische, sechs Wort- und drei
IA-Funde; Runde 2 hat **alle vierzehn nachgemessen bestätigt**. Die Brücke geht
in die Umsetzung. Fünf kleine Funde aus Runde 2 sind nicht blockierend und
werden in den Issues getragen.

| | Runde 1 | Runde 2 |
|---|---|---|
| Echte Kontrastfehler (ohne die WCAG-freien Deaktiviert-Zustände) | 8 | **0** |
| Bedienelemente unter ihrer Trefferfläche | 9 | **0** |
| Hexwerte in B2–B16 ohne Deklaration in B1 | 0 | **0** |
| Glyphen, die im Repo-Subset fehlen | 1 (`ti-wave-sine`) | **0** |
| Wort- und Inhaltsfunde | 6 | **0** von sechs offen |
| Fehlende IA-Blöcke | 0 | **0** |
| Fehlende Dichtebelege | 4 | **0** |

Was die Brücke von Anfang an richtig hatte und was so wiederholt werden soll:
die **Token-Disziplin** — **null** undeklarierte Hexwerte in Runde 1, gegen 81
bei Tisch und 36 bei Ocean, und das neue Blatt B16 hat **keinen einzigen** neuen
Wert eingeführt; die **IA-Treue** (die Abschnittsleiste trägt auf allen 17
Desktop-Rundenscreens alle fünf Ziele, einschließlich der vier Session-Screens);
die **Abschriften der Helferzeilen**; **kein Text auf einem Cover**; und eine
README, die ihre eigenen fünf Funde vorab benennt.

---

## Runde 1 — die vierzehn Punkte, und was aus ihnen wurde

| # | Fund (Runde 1) | Runde 2, nachgemessen |
|---|---|---|
| **A1** | **B1 benannte vier der neun Regeln der Tisch-Prüfung.** Wörtliche Wiederholung von Oceans Fund — mit Oceans Rückgabe im eigenen Vorgabenordner, die in Zeile 233 „alle neun, nicht vier" verlangt. | **Behoben.** B1 führt „ALLE NEUN REGELN DER TISCH-PRÜFUNG — AB BRIEF 1, KEINE AUSGELASSEN" und listet sie einzeln und inhaltlich korrekt (1)–(9). |
| **A2** | **Neun Bedienelemente unter dem Token, das B1 selbst setzt** — schwerster Fall die Wertungskarte: „Zurück" **66×34** gegen die bindende Tisch-C1-Regel ≥ 44, während die Blattunterschrift „Ziele 44 px" behauptete. Dazu 3× „← Zurück zu meinen Runden" 15 px, „Registrieren" 18 px, Kümmerliste-Zeile 20 px, drei Suchfelder 19–21 px, Wortzeichen 22 px. | **Behoben, 9 von 9.** „Zurück" jetzt **66×44** (alle vier Telefon-Rückwege), Suchfeld **302×46**. B1 führt dafür zwei neue Token, `target-field` (44) und `target-foot` (32). Der Gesamtdurchlauf über 1 336 Formen meldet **kein** App-Bedienelement mehr unter seiner Fläche. |
| **A3** | **B8.1 brach die Regel, die es aufstellt** — die acht Hexwerte standen bei 10 px als Tinte **auf** der Farbfläche, sieben davon unter 4,5:1 (3,64–4,34). Ocean-Fund 7, ein Blatt weiter. | **Behoben.** Die Werte stehen auf dem Paneel unter der Fläche. B8 meldet **0** Kontrastfehler (vorher 7). |
| **A4** | **ink-dim als Fließtext** — die Vertrauenszeile der Landing bei 10 px, **3,61:1**, gegen B1s eigenes „nur Nicht-Text". | **Behoben.** Auf `ink-muted`. B7 meldet nur noch den deaktivierten Knopf, der nach WCAG ausgenommen ist. |
| **A5** | **`ti-wave-sine` steht nicht im Repo-Subset.** Das Paket prüfte gegen **Oceans Kopie** von `tabler-icons.css` (108 Regeln, mit `anchor`/`droplet`/`wave-sine`, ohne `qrcode`, das die App in `views-session-live.js:329` benutzt); das Repo hat 106. Der Glyph saß in der Statusleiste jedes Telefonrahmens und hätte als Nichts gerendert. | **Behoben.** An allen 17 Stellen durch `ti-activity` ersetzt. Nachgemessen: **alle 58 verwendeten Glyphen sind im Repo-Subset deklariert**; keine Abhängigkeit von Oceans #1210 mehr. |
| **B1** | **„Sortiert: Score"** (B3.2) — wörtliche Wiederholung von Tisch-Fund B11; die App sagt `games.sort.rating` = „Bewertung". | **Behoben an der benannten Stelle** (B3.2 und B16.2). **Eine weitere blieb** — siehe R2-1; die Prüfung hatte den Fund an einen Screen gebunden statt an das Paket. |
| **B2** | **Abendwort** „…die eure **Kurzabende** füllt" (B6.8). Nachgemessen: die deutsche Regel in `test/session-naming.test.js` ist ein nacktes `/abend/i` ohne Ausnahmen — der Satz hätte die Suite rot gemacht. | **Behoben.** Kein `/abend/i`-Treffer mehr außerhalb von B9, wo die Regel dokumentiert wird. |
| **B3** | **Rundenpuls umgedreht** — „10 von 12 Spielen schon dran" gegen `hub.pulse.coverage` („noch nie dran"), dazu „Zuletzt gespielt vor 5 Tagen" gegen `hub.pulse.lastDays`. | **Behoben.** „**2** von 12 Spielen waren **noch nie** dran." und „Vor 5 Tagen gespielt" — samt korrigierter Arithmetik. |
| **B4** | **Kümmerliste paraphrasiert**, mit einer Namensliste, für die der String keinen Platz hat. | **Behoben.** „2 Spiele ohne Bild" + „1 Session ohne eingetragenes Ergebnis" wörtlich nach `hub.care.*`, die Namen auf einer zweiten Zeile im Format von `hub.care.winnerRow` („{game} · {when}"). |
| **B5** | **„Platz"** statt **„Platz dazu"** am Telefon — Tisch-Fund B5. | **Behoben.** „Platz dazu", zweizeilig umbrechend statt gekürzt — genau die Form, die T1 verlangt. |
| **B6** | „Pokale — Siege, Serien, **Auszeichnungen**" (Revert-Wort in der Blattunterschrift). | **Behoben.** „Bestmarken". Die zwei verbliebenen „Auszeichnungen" stehen in B1s Revert-Notiz und B9s Verbotsspalte — dort gehören sie hin. |
| **C1** | IA vollständig — kein Fund. | **Unverändert vollständig**, inklusive B16. |
| **C2** | **Spieldetail ohne Dock**, obwohl Ocean O6.3 und Tisch T6.3 beide eines tragen. Die anderen vier dockfreien Screens hatten Präzedenz. | **Behoben.** B6.3 trägt sein Dock (4/4) über der Aktionsleiste; die vier bestätigten bleiben dockfrei. |
| **C3** | **Alle vier Dichtebelege aus §6 fehlten** — 12-Personen-Runde, 40+-Regal, Unentschieden, lange Sprache. Für ein Design in versaler, gesperrter Anzeigeschrift die riskanteste offene Frage. | **Behoben, neues Blatt B16.** 12 Personen (10 Mitglieder, 2 Gäste, 2 Teams, 2 sitzen aus), Regal mit 42 Spielen, Unentschieden mit zwei Siegern, Französisch und Finnisch. Es hat drei Produktregeln erzwungen, die vorher nirgends standen — Rasterumbruch ab neun Plätzen, Buchstabensprung ab 30 Spielen, Stufenabfall versaler Titel ab 22 Zeichen. **B16 führt keinen einzigen neuen Hexwert ein.** |

### Entscheidungen aus Runde 1 — bestätigt

**D1 Aufgehellte Personenfarben**, **D2 Abschnittslinks statt Brotkrume**,
**D4 Gesichter auf der Wertungskarte**: bestätigt und begründet (siehe
Runde-1-Prüfung). **D3 „Mission 024 · Crew 4"** war **keine Abweichung** — §4
des Addendums listet die Zeile wörtlich als erlaubtes Dekor; nachgemessen steht
„Crew" ausschließlich dort. **D5 Dock-Regel** angenommen mit der einen Ausnahme
aus C2.

**D6 (drei Schriftfamilien)** und **D7 (führende Nullen)** hat der Betreiber
entschieden: Plex Sans und Plex Mono zählen als eine Superfamilie neben der
Anzeigeschrift (§3J erfüllt, sechs neue woff2 ins Repo — Chakra Petch liegt
schon dort), und die führenden Nullen fallen **überall**, auch in den
Zierzeilen. Beides ist eingearbeitet; die Uhrzeit „T+ 00:14:52" bleibt als
Zeitangabe.

---

## Offen, nicht blockierend — in den Issues getragen

Nichts davon hält die Umsetzung auf; jede Zeile gehört in die betroffene
Implementierungs-Issue, damit niemand sie aus den Blättern neu herleiten muss.

| # | Wo | Was | Getragen von |
|---|---|---|---|
| **R2-1** | **B15a.5 Popover** | **„Sortiert: Score ▾" steht noch, und die Optionsliste ist erfunden.** Die App hat genau drei Sortierungen (`views-regal.js:85–87`: **Zufällig · Name · Bewertung**); das Popover bietet „Score absteigend · Score aufsteigend · Zuletzt gespielt · Name A–Z · Dauer". B3.2 und B16.2 sind korrekt. **Der Fund aus Runde 1 war an einen Screen gebunden statt ans Paket — das ist ein Fehler der Prüfung, nicht der Umsetzung.** | Overlay-Issue: Label auf „Bewertung", Optionsliste auf die drei der App. |
| **R2-2** | **B15a.5 Sprachwähler** | **Die neun Locales sind die falschen neun.** Gezeichnet: DE EN FR ES IT NL **PL** PT **SV**. Die App (`public/js/locales.js`): en de es fr it nl pt **fi** **ko**. Polnisch und Schwedisch stehen dort, wo Finnisch und Koreanisch hingehören — und dasselbe Paket beweist in B16.4 Finnisch. Weil es genau neun Einträge sind, sieht die Liste auf den ersten Blick richtig aus. | Overlay-Issue: die Liste aus `locales.js` ableiten, nie abtippen (`.claude/rules/locale-set-is-data.md`). |
| **R2-3** | **B16.4** | **Vier Strings sind erfunden, und das Blatt misst an ihnen.** Die Zeilen sind exakt abgeschrieben (`hub.care.cover`, `hub.care.winnerOne` in beiden Sprachen ✓), aber die **Blocktitel** und der **erste Dock-Eintrag** nicht: FR „Liste des tâches" statt `hub.care.title` = **„À régler"**, FI „Huolehdittavaa" statt **„Avoimet asiat"**; FR „Accueil" statt `hub.tab.start` = **„Démarrer"**, FI „Etusivu" statt **„Aloitus"**. In beiden Sprachen trifft es genau das erste Element jeder Gruppe. Die Dock-Messung hält trotzdem (längster FR-Eintrag ist „Historique" = 10), aber „Liste des tâches" ist doppelt so lang wie der echte Titel. | Token-/Hub-Issue: die vier Strings ersetzen und die Zeile „Rundenname 16 → 20" neu rechnen. |
| **R2-4** | **B16.4** | **Die Wertungsfrage verliert in FR und FI das Spiel.** „Combien de propulsion aujourd'hui ?" und „Kuinka paljon työntövoimaa tänään?" — das Deutsche trägt es korrekt („…gibst du diesem **Spiel** heute?"), und §4 des Addendums hat dieses Substantiv ausdrücklich eingesetzt („dieser Einheit" → „diesem Spiel"). §2 verlangt, dass die Wertungswörter in **jeder** Sprache mitwandern. | Live-Vote-Issue: « …pour ce **jeu** aujourd'hui ? » bzw. „…**tälle pelille** tänään?". |
| **R2-5** | **B1.1 · B2.3 · B4.1** | **Drei führende Nullen haben D7 überlebt.** „09 SIEGE" im `mono-micro`-Musterwort, und die Schrittleiste der Session „**01** WER SPIELT MIT? ▸ 2 POOL ▸ 3 ZÜNDUNG" auf zwei Blättern — Schritt 1 behielt seine Null, Schritte 2 und 3 verloren sie, die Leiste liest sich als 01 · 2 · 3. | Token-Issue und Session-Issue. |

### Beobachtungen, keine Funde

- **B16.4s französischer Rundenname „Groupe du jeudi soir"** fügt einen Abend
  hinzu, den „Donnerstagsrunde" nicht hat. Er **verletzt den Test nicht** —
  `test/session-naming.test.js` nimmt Rundennamen ausdrücklich aus, weil eine
  Runde eine Gruppe ist und keine Session. Er bläht aber die Zeile
  „Rundenname 16 → 20" auf; die Stufenabfall-Regel trägt ohnehin der Spieltitel
  („Les aurores boréales du Nord", 28 Zeichen). Vorschlag: « Groupe du jeudi ».
- **Das Regal in B16.2 enthält ein Spiel „Abendrot".** Musterdaten werden nie
  zu Übersetzungswerten, also ohne Wirkung auf den Test — nur zu wissen, falls
  jemand die Liste in einen Seed kopiert.
- **B1s Vokabelnotiz sagt noch „B1–B15b"**, das Paket ist jetzt B1–B16.
- **Die Paket-README enthält die Ersetzungstabelle doppelt** — nach der ersten
  folgt ein verwaister `---|---|---|` und die alte Fassung, die `wave-sine` noch
  als Statusleisten-Glyph führt. Bei der Übernahme berichtigt, statt das Paket
  ein drittes Mal zurückzugeben (wie bei Ocean).
- **B1.1s Beschriftung „3,3:1"** liegt bei **4,39:1** (Tinte auf der
  ink-dim-Fläche), 0,11 unter dem Floor. Das Blatt beschriftet damit den
  Nicht-Text-Token mit seiner eigenen Zahl. In Runde 1 nicht benannt, deshalb
  mitgelaufen; entweder heben oder bewusst stehen lassen.

---

## Drei Produktfragen, die B16 aufgeworfen hat

Sie sind Setzungen des Designs, keine Vorgabe aus dem Handover, und gehören vor
der Umsetzung entschieden:

1. **Unentschieden** (B16.3): beide bekommen einen **vollen** Sieg, keine
   Bruchzahl, die Serie läuft für beide weiter; bei gleichem Score wird das
   **ältere** Spiel gezogen.
2. **Teams** (B16.1): ein Team zählt als **ein** Sieger, jeder bewertet
   trotzdem einzeln; Gäste dürfen in Teams sitzen und mitgewinnen.
3. **Die drei Dichteregeln** (B16): Rasterumbruch der Plätze ab **neun**
   Personen (die Siegzahl verschwindet dabei), Buchstabensprung und Nachladen
   in Schüben im Regal ab **30** Spielen, Stufenabfall versaler Titel ab **22**
   Zeichen. Sie gehören ins Produkt, nicht nur ins Design.

---

## Was für die verbleibenden drei Designs gilt

Zusätzlich zu den neun Regeln der Tisch-Prüfung und den vier der Ocean-Prüfung:

1. **Einen Wortfund ans Paket binden, nicht an den Screen.** R2-1 blieb stehen,
   weil die Runde-1-Prüfung „Sortiert: Score" unter „B3.2 Regal" notiert hatte.
   Ein Wort, das an einer Stelle falsch ist, ist an jeder Stelle falsch — der
   Fund nennt das Wort und die Zahl der Vorkommen, nicht einen Screen.
2. **Icons und Locales gegen das Repo prüfen, nie gegen das Vorgängerpaket.**
   Die Brücke erbte Oceans `tabler-icons.css` (108 statt 106 Regeln) und hätte
   einen Glyph als Nichts gerendert; ihr Sprachwähler führt Polnisch und
   Schwedisch, die es nie gab. Beides sind Listen, die im Repo als Daten
   liegen (`public/fonts/tabler-icons.css`, `public/js/locales.js`).
3. **Ein Dichtebeleg misst nur, was er abschreibt.** B16 ist gute Arbeit und
   leitet drei echte Regeln ab — aber vier seiner Strings sind erfunden, und
   einer davon ist doppelt so lang wie der echte. Wer Überlauf beweist, holt
   die Wörter aus `lang/<locale>.js`; sonst misst der Beleg sich selbst.
4. **Der Dichtebeleg gehört in die Lieferung, nicht in die Nachreichung.** §6
   nennt vier Fälle; sie sind das Einzige, was zeigt, ob das Raster unter echten
   Daten hält, und sie erzwingen Produktregeln, die sonst niemandem auffallen.

## Methodischer Nachtrag — gehört in `docs/design/README.md` Schritt 2

- **`audit.js` sieht nur `button`/`a[href]`/`input`.** Die Brücke zeichnet ihre
  Bedienelemente als `div` und hat **null** `<button>` (Tisch T1: 36, Ocean O1:
  24) — mit dem Blattwerkzeug allein wäre die Trefferflächen-Prüfung vakuum-
  sauber gewesen. Ein zweiter Durchgang über knopfförmige Kästen ist Pflicht.
- **Der Modalwert nimmt bei Rahmenelementen den Rahmen.** Zwei Meldungen
  (B2.5 „Gespielt", B2.4 „Spiel 2 von 3") standen bei mode 1,00/1,52 mit einem
  Anteil von 0,11/0,16 und p10 von 10,66/7,46 — Text in einer Box, die fast
  ganz aus ihrem eigenen farbigen Rahmen besteht. Faustregel: **Anteil unter
  ~0,3 und p10 besteht → am Markup nachsehen, nicht melden.**
- **Ein reiner Textabgleich übersieht Icon-Einstiege.** Der Einstellungs-
  Einstieg am Telefon-Hub ist `ti-settings` in der Kopfleiste; ein Wortabgleich
  meldet ihn als fehlenden IA-Block. Die IA-Prüfliste braucht den DOM.
