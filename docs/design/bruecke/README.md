# Übergabepaket „Die Brücke“ — B1 bis B16

Datum: 2026-09-22 · Phase 2, Design 2 von 5 (Reihenfolge O → **B** → P → F → R)
Stand: **nach Runde 3**, alle Funde aus Runde 1 und Runde 2 eingearbeitet.
Erzeugt von Claude Design für die Überführung in GitHub-Issues durch Claude Code.

---

## Stand nach Runde 3

Runde 3 (`vorgaben/bruecke-runde-3-auftrag.md`) war klein und abschließend: **zwei
fehlende Screens** plus die fünf nicht blockierenden Funde aus Runde 2.

**Die zwei fehlenden Screens — vier Blätter, angehängt statt umnummeriert**

Der Fund ist ein Versäumnis der Prüfung, nicht der Umsetzung: geprüft wurden
Abschnittsleiste, Dock, Hub-Blöcke und Wertungskarte — die **Session-Schleife aus
§2** wurde nie Punkt für Punkt abgehakt. Genau die Lehre aus der Ocean-Rückgabe,
angewandt auf den Block, den niemand abgehakt hat.

| Neu | Was |
|---|---|
| **B4.5 Geteilte Wertung** (Desktop 1440) | Die Ansicht, die am Tisch liegt: wer abgestimmt hat, wer offen ist, Teilen-Link, QR-Code (CSS-Platzhalter) und der Weg, an diesem Gerät für jemanden zu werten. |
| **B4.6 Sichtblende** (Desktop 1440) | Die Sichtblende im Ein-Gerät-Modus. Zeigt keine Wertung, keinen Score, kein Spiel der Person davor. |
| **B6.9 Geteilte Wertung** (Telefon 390) | Dasselbe am Telefon, **mit** Dock. |
| **B6.10 Sichtblende** (Telefon 390) | Dasselbe am Telefon, **ohne** Dock und ohne Kopfleiste — die Blende gehört zur Wertungskarte, nicht zur Navigation. |

Die Nummerierung der vorhandenen Screens ist unangetastet: B4.3 bleibt Ergebnis,
B4.4 bleibt Mehrere Tische. Die Wörter sind aus `public/js/lang/de.js`
abgeschrieben (`lobby.*` und `vote.*`), nicht erfunden — „Abstimmung läuft",
„abgestimmt / offen", „Jetzt abstimmen", „An diesem Gerät abstimmen",
„Für {name}", „Weiter zu {name}", „Abstimmung beenden", „Link zum Abstimmen
teilen", „Link kopiert — teile ihn mit der Runde.", „QR-Code", „Scannen und
mitbewerten", „{Name}, du bist dran!", „Die anderen schauen kurz weg.",
„Los geht's ›". Themenwörter sind an diesen Stellen nicht erlaubt; eigen bleiben
nur Kicker („Eingehendes Signal") und Zierlinien.

**Die fünf Funde aus Runde 2 — alle eingearbeitet**

- **R2-1 · B15a.5 Popover** — Label auf „Sortiert: **Bewertung**", Liste auf die
  drei Optionen, die `views-regal.js` hat: **Zufällig · Name · Bewertung**. Der
  Fund aus Runde 1 war an einen Screen gebunden statt ans Paket.
- **R2-2 · B15a.5 Sprachwähler** — Polnisch und Schwedisch raus, **Suomi** und
  **한국어** rein. Jetzt die neun aus `public/js/locales.js`: de en es fr it nl pt fi ko.
- **R2-3 · B16.4** — Vier erfundene Strings auf die echten: FR Kümmerliste
  **„À régler"**, FI **„Avoimet asiat"**, FR-Dock **„Démarrer"**, FI-Dock
  **„Aloitus"**. Messtabelle neu gerechnet (siehe unten).
- **R2-4 · B16.4** — Die Wertungsfrage trägt in beiden Sprachen wieder das
  Substantiv: « …pour ce **jeu** aujourd'hui ? » · „…**tälle pelille** tänään?".
- **R2-5 · B1.1 · B2.3 · B4.1** — Drei führende Nullen, die D7 überlebt hatten:
  „09 Siege" im `mono-micro`-Musterwort und die Schrittleiste „01 Wer spielt mit?"
  auf zwei Blättern. Die Leiste liest jetzt 1 · 2 · 3.

Die zwei freiwilligen Kleinigkeiten sind mitgemacht: FR-Rundenname auf
« Groupe du jeudi » (ohne den Abend, den „Donnerstagsrunde" nicht hat), und die
Beschriftung von `ink-dim` steht auf dem gemessenen **4,4:1** statt 3,3:1 — knapp
unter dem Text-Floor, deshalb bleibt sie auf Gesperrt und leere Rasterzellen
beschränkt.

**Was die Messtabelle in B16.4 jetzt sagt**

| Gemessen | DE | längere Sprache |
|---|---|---|
| Rundenname | 16 | 19 (FI „Torstain peliseurue") |
| Frage der Wertungskarte | 43 | 48 (FI, mit Substantiv) |
| Skalenende links | 10 | 13 |
| Dock-Eintrag längster | 7 | 10 (FR „Historique") |

**Welche Regeln in Runde 3 gegriffen haben**

Von den **neun Regeln der Tisch-Prüfung** (vollständig in B1 abgehakt) waren
vier hier einschlägig: **(4)** Trefferflächen — jeder Personeneintrag, „Für
{name}", „Jetzt abstimmen" und der Weiter-Knopf liegen auf 44 px · **(5)** Wörter
aus der App abschreiben statt paraphrasieren — der ganze `lobby.*`/`vote.*`-Satz,
und R2-1 bis R2-4 · **(7)** Wertungskarte ohne Dock und Kopfleiste — deshalb hat
B6.10 beides nicht · **(9)** eigene Kontrastzahlen prüfen, bevor sie zitiert
werden — daher die Korrektur von `ink-dim`.

Von der **Ocean-Rückgabe** (drei Lehren im Text, plus die Icon-Falle aus A5 —
vier, wenn man sie mitzählt) haben alle vier gegriffen: **(1)** alle neun Regeln
statt vier · **(2)** die IA-Prüfliste Block für Block abhaken — genau das hat die
fehlende Session-Schleife gefunden · **(3)** nach dem Revert den Text lesen —
daher R2-5 · **(A5)** Icons gegen das Repo prüfen, nicht gegen die Paketkopie:
der Auftrag nennt `ti-qrcode` als im Repo-Subset vorhanden, im gebündelten
`tabler-icons.css` dieses Pakets ist er aber nicht deklariert und rendert als
Nichts. Die geteilte Wertung kommt deshalb ohne Glyph-Abhängigkeit aus — ihr
QR-Platzhalter ist CSS (siehe „Icon-Subset").

---

## Stand nach Prüfrunde 1

Die Prüfung von Claude Code (`vorgaben/pruefung-bruecke-runde-1.md`) lautet **„kein Zurück ans Reißbrett"**. Alle Funde aus A, B und C sind eingearbeitet; zwei Entscheidungen (D6, D7) liegen beim Betreiber und sind unten offen markiert.

**Eingearbeitet aus Runde 1**

- **A1** — B1 hakt jetzt **alle neun** Regeln der Tisch-Prüfung ab, nicht vier. Die Auslassung war eine wörtliche Wiederholung von Oceans Fund, mit Oceans Rückgabe im eigenen Vorgabenordner.
- **A2** — Neun Bedienelemente auf ihr eigenes Token gezogen: „Zurück" auf der Wertungskarte **34 → 44 px**, die drei „← Zurück zu meinen Runden" und „Registrieren" auf 24 px, die Kümmerliste-Zeilen auf 24 px, die drei Suchfelder auf die Höhe ihres Rahmens. B1 führt dafür zwei neue Token: `target-field` (44 px, das Feld selbst) und `target-foot` (32 px).
- **A3** — Die acht Hexwerte in B8.1 stehen nicht mehr **auf** der Farbfläche, sondern auf dem Paneel darunter. Das Blatt hielt seine eigene Regel nicht ein.
- **A4** — Die Vertrauenszeile der Landing von `ink-dim` auf `ink-muted`.
- **A5** — `ti-wave-sine` ist **raus** (17 Stellen → `ti-activity`). Der Glyph steht nur in Oceans Kopie des Subsets, nicht im Repo. Siehe „Icon-Subset" unten.
- **B1–B6** — Sechs Wortstellen auf die Strings der App: „Sortiert: **Bewertung**", Abendwort raus, Rundenpuls-Aussage umgedreht (`hub.pulse.coverage`, `hub.pulse.lastDays`), Kümmerliste auf `hub.care.*`, „Platz **dazu**" zweizeilig, „Auszeichnungen" → „Bestmarken".
- **C2** — **B6.3 Spieldetail bekommt sein Dock zurück**, über der Aktionsleiste. Ocean O6.3 und Tisch T6.3 halten es genauso; die anderen vier dockfreien Screens sind bestätigt.
- **C3** — **Neues Blatt B16** mit den vier fehlenden Dichtebelegen. Es hat drei Regeln erzwungen, die vorher nirgends standen: Plätze brechen ab neun Personen aufs Raster und verlieren die Siegzahl · das Regal bekommt ab 30 Spielen einen Buchstabensprung und lädt in Schüben · versale Titel schalten ab 22 Zeichen eine Stufe herunter, statt umzubrechen.

**Vor der Prüfung selbst gefunden und behoben** — fünf Fehler derselben Ursache, alle daher, dass vierzehn Blätter ohne Zwischenprüfung entstanden: 21 fehlende Glyphen (rendern als Nichts, darunter zwei Dock-Symbole) · Telefonrahmen auf feste 844 px mit abgeschnittenem Inhalt · zehn Textstellen unter der eigenen 10-px-Grenze · 33 Querverweise ohne 24-px-Box · die Rückblickkarte gegen die Zeichnung statt gegen den Export bemessen.

**D6 und D7 sind entschieden und eingearbeitet**

- **D6 · Drei Familien bleiben.** Der Betreiber zählt **IBM Plex Sans und Plex Mono als eine Superfamilie** neben der Anzeigeschrift — damit ist §3J erfüllt: Chakra Petch (Anzeige) + IBM Plex (Lauftext und Notation). Es kommen sechs woff2-Dateien ins Repo, Chakra Petch liegt schon dort. Keine Zeichenänderung.
- **D7 · Führende Nullen sind überall gestrichen.** Nicht nur in Sätzen und Etiketten, sondern auch in den Zierzeilen — auf ausdrückliche Entscheidung des Betreibers, weiter als der Vorschlag der Prüfung. Heißt jetzt: „9 Spiele im Pool", „5 Siege", „Mission 24", „Aussortiert 2 · Durchgespielt 1 · Wunschliste 4", Ränge „1 · 2 · 3". Das deckt sich mit dem Beispiel im Vokabular-Addendum („9 Spiele im Pool") und ist als Zahlenformat über neun Sprachen unverfänglich. Durchgezogen über alle fünfzehn Blätter; die Uhrzeit „T+ 00:14:52" bleibt, weil sie eine Zeitangabe ist, keine Zählung.

**Was offen bleibt**

- **Kontraste in der echten App.** B1 und B8 messen gegen die hier gezeichneten Gründe. Führt die App andere Zwischentöne ein, muss neu gemessen werden.

## Inhalt

| Datei | Brief |
|---|---|
| `Bruecke-B1-Komponenten.dc.html` | Bauteile und Tokens — **die einzige Token-Quelle** |
| `Bruecke-B2-Phone-Kern.dc.html` | Telefon 390: Start, Hub, Neue Session, Abstimmung, Ergebnis, Regal |
| `Bruecke-B3-Runde-Desktop.dc.html` | Hub 1440 + Unterseiten Regal, Chronik, Pokale |
| `Bruecke-B4-Session-Desktop.dc.html` | Setup, Abstimmung, Ergebnis, Mehrere Tische, **Geteilte Wertung, Sichtblende** |
| `Bruecke-B5-Konto.dc.html` | Anmelden, Design-Wähler (7 Designs), Auswahl-Sheet, Kontoseite |
| `Bruecke-B6-Phone-Rest.dc.html` | Telefon: Chronik, Pokale, Spieldetail, Spiel hinzufügen, Mitglied, Einstellungen, Nicht im Regal, Empfehlungen, **Geteilte Wertung, Sichtblende** |
| `Bruecke-B7-Leerzustaende.dc.html` | Leere und junge Zustände, beide Breiten |
| `Bruecke-B8-Farben.dc.html` | Personenfarben, Score-Verlauf, Farbfehlsichtigkeit, Rückblickkarte |
| `Bruecke-B9-Vokabular.dc.html` | Vokabular und Glossar, DE + EN |
| `Bruecke-B10-Motion.dc.html` | Vier Bewegungen, jede mit statischem Endbild |
| `Bruecke-B13-Tier2a.dc.html` | Rückblick, Mitgliedsseite, Nicht im Regal, Spieldetail |
| `Bruecke-B14-Tier2b.dc.html` | Profil, Freunde + Feed, Postfach, Was ist neu, Statistik, Rundeneinstellungen mit Markerwähler |
| `Bruecke-B15a-Sheets.dc.html` | Sheets und Popover |
| `Bruecke-B15b-Dialoge.dc.html` | Dialoge, Toasts, „…"-Menü |
| `Bruecke-B16-Dichte.dc.html` | **Nachgereicht zu Runde 1 (C3):** 12 Personen mit Gästen und Teams, Regal mit 42 Spielen, Unentschieden, Französisch und Finnisch |
| `Konzept-E-Die-Bruecke.dc.html` | Das Konzeptblatt, mit angewandtem V0-Revert |
| `support.js` | Laufzeit — **nicht ins Repo übernehmen** |
| `vorgaben/` | Handover, Vokabular-Addendum, Projektregeln, die beiden Prüfungen |

**`public/` liegt diesem Paket nicht mehr bei** (Runde-3-Auftrag §4): die mitgelieferte Kopie war Oceans und ist auseinandergelaufen. Im Repo zeigen die Blätter per `../../../public/` auf das echte Verzeichnis; lokal öffnen sie ohne Icon-Font und ohne BGG-Logo.

---

## Die Tokens in Kürze

Alles Weitere in B1; hier nur, was ein Issue meistens braucht.

```
page          radial-gradient(90% 60% at 50% 0%, #10203a, #070b14 70%)
surface       #0e1626      jedes Paneel, flach
surface-2     #141d30      Sheet, Dialog, Popover
bar           #0b1220      Kopfleiste und Dock
line          #24324a      Kante · hairline #1c2740

ink           #dfe7f5  14,5:1      ink-2  #b8c2d6  10,1:1
ink-muted     #9aa8c0   7,5:1      ink-dim #5d6a82  4,4:1 (nur Nicht-Text)

accent (cyan) #35e0ff  11,4:1      action (amber) #ffb020  9,9:1
ok (grün)     #4ade80  10,4:1      alert (rot)    #ff6b85   6,6:1

Schrift       Chakra Petch 600/700 (Anzeige, versal) · IBM Plex Sans 400/500/600
              IBM Plex Mono 400/500/600 (nur Notation) — alle OFL
Zahlen        ohne führende Null (9 Spiele, Mission 24) · Score mit Komma (4,8)
Textgrößen    Text ab 13 px · Notation ab 11 px · harte Untergrenze 10 px
              (mono-micro, nur für Zähler und Achsen, nie für einen Satz)
Radius        0 — das Design ist rechtwinklig
Ziele         target-min 24 px (jedes Bedienelement, auch ein Textlink)
              target-key 44 px (Wertungskarte inkl. „Zurück", Dock, Plätze)
              target-field 44 px (Eingabefeld selbst) · target-foot 32 px
Rahmenhöhe   Telefon 844 px, Desktop 900 px = sichtbarer Ausschnitt, nicht Screenhöhe.
              Die Blätter zeichnen jeden Screen in voller Länge (B2, B6, B7, B16).
Rückblickkarte in B8.4 ist bei 600×600 gezeichnet und exportiert 1080×1080 (×1,8).
              Dort zählt die exportierte Größe: kleinste gezeichnete Schrift 14 px.
```

---

## Drei Abweichungen — alle in Runde 1 bestätigt

Diese drei Punkte weichen von einer wörtlichen Lesart der Vorgaben ab. Prüfrunde 1 hat alle drei **bestätigt** (D1, D2, D4); sie stehen hier als Begründung für die Issues.

_Der vierte Punkt der Erstfassung — „Crew 4" als Zierzeile — war **keine Abweichung**: §4 des Addendums listet die Zeile wörtlich als erlaubtes Dekor. Gestrichen._

**1 · Aufgehellte Personenfarben.** Die acht globalen Hexwerte liegen auf dem Brücken-Paneel zwischen 2,6:1 und 4,0:1; keiner erreicht 4,5:1, und `#993556` verfehlt mit 2,6:1 auch die 3:1 für Flächen. Die Brücke schlägt eine aufgehellte Reihe mit gleichem Farbton und gleicher Reihenfolge vor (B8, Abschnitt 1) und rechnet beim Zeichnen um; gespeichert bleibt der Originalwert. Das Handover erlaubt „adjusted hexes only where" — hier ist die Begründung die Messung.

**2 · Abschnittslinks statt Brotkrume.** Das Konzeptblatt navigierte über eine Brotkrume („Flotte / Donnerstagsrunde / Regal"). Die IA-Prüfliste verlangt auf jedem Rundenscreen einen dauerhaften Weg zu Hub, Regal, Chronik, Pokale und Einstellungen; eine Brotkrume leistet das nicht. B3 ersetzt sie durch eine Leiste mit den fünf Abschnittslinks unter der Kopfleiste — das Programmheft-Modell, das die Projektregel ausdrücklich zulässt. Die Brotkrume entfällt damit ganz.

**3 · Die Wertungskarte trägt die Gesichter, nicht nur Zahlen.** Das Konzeptblatt zeigte die Schub-Skala als reine Balken mit Ziffern. Da die fünf Tabler-Gesichter global gesetzt sind und der Verlauf bei Deuteranopie zusammenfällt (B8, Abschnitt 2), sitzen die Gesichter in B1, B2 und B4 in den Zellen. Der Balken bleibt als dritte, redundante Information.

---

## Icon-Subset

**58 Glyphen, keiner neu — und keiner mehr aus Oceans Kopie.** Prüfrunde 1 (A5) hat gezeigt, dass das mitgelieferte `public/fonts/tabler-icons.css` **Oceans Kopie** ist: 108 Regeln statt der 106 im Repo, mit `anchor`, `droplet` und `wave-sine` zusätzlich und ohne `qrcode`, das die App heute benutzt. Die Erstfassung hatte `ti-wave-sine` in der Statusleiste jedes Telefonrahmens — im Repo nicht deklariert, also wieder ein Glyph, der als Nichts rendert.

**`ti-wave-sine` ist an allen 17 Stellen durch `ti-activity` ersetzt.** Damit kommt die Brücke ohne die drei Ocean-Extras aus und läuft gegen das Repo-Subset.

```
activity · alert-triangle · archive · arrow-down · arrow-left · arrow-right
arrows-split · bolt · bulb · cards · check · checkbox · chevron-right · dice-5
dots · download · file-text · filter · flag · history · info-circle · layout-grid
link · lock · lock-off · logout · mail · message · minus · palette · pencil
percentage · photo · planet · plus · refresh · rocket · search · settings
share · shield · tags · tool · trash · trophy · unlink · user · user-circle
user-plus · users · world · x
mood-cry · mood-sad · mood-neutral · mood-smile · mood-crazy-happy · mood-empty
```

**Der QR-Code braucht keinen Glyphen.** Der Runde-3-Auftrag nennt `ti-qrcode` als
im Repo-Subset vorhanden — im gebündelten `tabler-icons.css` dieses Pakets ist er
aber nicht deklariert und rendert als Nichts. Statt die Falle aus A5 zu
wiederholen, zeichnen B4.5 und B6.9 den Code als **Platzhalter aus CSS**: helle
Fläche, Modulraster, drei Suchmuster in den Ecken, rechtwinklig wie alles andere.
Die Umsetzung ersetzt ihn durch den echten, generierten Code — `ti-qrcode` ist
für das Design keine Abhängigkeit.

`rocket` trägt „Mission starten", `bolt` die Zündung, `planet` den Pool und die Sonden — die drei Stellen, an denen die Brücke ein eigenes Wort hat, bekommen auch ein eigenes Zeichen.

**Zwei Dinge beim Commit:**

1. Das `public/`-Verzeichnis dieses Pakets **nicht ins Repo übernehmen** — es ist die Vorgängerkopie. Die Blätter zeigen im Repo per `../../../public/` auf das echte Verzeichnis.
2. Die Token-Issue der Brücke braucht **keine** Glyph-Abhängigkeit mehr. Oceans Issue **#1210** deklariert `wave-sine`; die Brücke wartet nicht mehr darauf.

### Zweiundzwanzig Ersetzungen — in Runde 1 mitgeprüft

Der erste Entwurf griff auf 21 Glyphen zurück, die im gebündelten Subset nicht stehen, plus `wave-sine`, das nur in Oceans Kopie steht. Alle 22 sind ersetzt; Prüfrunde 1 hat die drei auffälligen mitgeprüft und nicht beanstandet: **`cards`** fürs Regal, **`planet`** für Pool und Sonden, **`percentage`** als Akku.

| Gewollt | Jetzt | Wo |
|---|---|---|
| `layout-dashboard` | `layout-grid` | Dock „Start", alle Telefonscreens |
| `books` | `cards` | Dock „Regal", Hub-Vorschau |
| `radar-2` | `planet` | Pool und Sonden (B1, B4, B7, B15a, B16) |
| `lock-open` | `lock-off` | entschlüsseln |
| `antenna-bars-5` · `battery-3` | `activity` · `percentage` | Statusleiste der Telefonrahmen |
| `wave-sine` | `activity` | **A5 aus Runde 1** — stand nur in Oceans Kopie |
| `point` | `minus` | Aufzählungszeichen (B14, B15b) |
| `tag` | `tags` | Tag vergeben |
| `bell` | `message` | Benachrichtigungen |
| `edit` | `pencil` | Sieger ändern |
| `shield-lock` | `shield` | Datenschutz |
| `adjustments` | `settings` | Name und Bild |
| `mail-forward` | `user-plus` | Einladen |
| `dice` | `dice-5` | Anderes Spiel eintragen |
| `wifi-off` | `unlink` | Offline-Dialog und -Toast |
| `chart-bar` | `activity` | Statistik |
| `circle-dashed` | `mood-empty` | Kennzeichnung „Leer" in B7 |
| `accessible` | `user-circle` | Hinweis zu reduzierter Bewegung |
| `flag-check` | `flag` | Abschlussnotiz B15b |
| `hand-click` | `info-circle` | Hinweis in B15a |
| `route` | `arrows-split` | Hinweis zur Navigation in B3 |

Die meisten sind unauffällig. Drei sind es nicht und gehören in die Prüfung: **`cards` für das Regal** (ein Kartenstapel statt Bücher — inhaltlich sogar näher an Brettspielen, aber es ist eine Entscheidung), **`planet` für Pool und Sonden** (rund wie das Radar des Konzepts, aber es ist ein Planet) und **`percentage` als Akku** in der Statusleiste. Wird eines davon abgelehnt, ist der saubere Weg, den echten Glyph ins Subset aufzunehmen und den Codepoint aus der cmap dieses woff2 zu lesen.

---

## Was offen bleibt

Runde 2 hat die vierzehn Funde aus Runde 1 nachgemessen bestätigt, Runde 3 die zwei
fehlenden Screens und die fünf Nachzügler geschlossen. Für die Umsetzungs-Issues
bleibt:

1. **Die geteilte Wertung als Produktfrage.** B4.5 und B6.9 setzen: der Link gilt nur für diese Session und läuft mit „Abstimmung beenden" ab; wer kein Telefon dabei hat, wird an diesem Gerät durchgereicht (B4.6, B6.10). Beides ist eine Setzung aus §2, Punkt 2 — kein Detail aus dem Handover.
2. **B16 gegenlesen.** Die drei Regeln, die die Dichtebelege erzwungen haben, standen vorher nirgends: Rasterumbruch der Plätze ab neun Personen, Buchstabensprung und Schübe im Regal ab 30 Spielen, Stufenabfall versaler Titel ab 22 Zeichen. Sie gehören ins Produkt, nicht nur ins Design.
3. **Das Unentschieden als Produktfrage.** B16.3 zeichnet: beide bekommen einen vollen Sieg, keine Bruchzahl, die Serie läuft für beide weiter. Bei gleichem Score wird das ältere Spiel gezogen. Beides ist eine Setzung, keine Vorgabe aus dem Handover.
4. **Die Personenfarben in der echten App gegenprüfen** — B8 misst gegen die hier gezeichneten Gründe, nicht gegen die gerenderte Anwendung.
5. **Die Breite der Querverweise.** Runde 1 merkt an, dass die 24-px-Box nur in der Höhe greift; bei zweizeichigen Zielen („E", „B2") ist sie 13,6–22,3 px breit. Das ist Blattnavigation und wird nie Anwendungscode — bei Übernahme des Musters in die App aber zu beheben.

