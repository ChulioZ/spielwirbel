# Prüfung: die vier X17-Blätter „Abzeichen" (2026-09-26)

Geprüft: `tisch/Tisch-T17-Abzeichen.dc.html`, `ocean/Ocean-O17-Abzeichen.dc.html`,
`bruecke/Bruecke-B17-Abzeichen.dc.html`, `programmheft/Programmheft-P17-Abzeichen.dc.html`
gegen `handover-abzeichen-2026-09-26.md` (Entscheidungstabelle), `handover-vokabular-2026-09-20.md`
und die bindenden Regeln der drei früheren Prüfungen. Methode wie in `README.md` „From a design
package to issues": Audit-Skript je Blatt mit Kontrollknoten, zweiter Durchlauf über
button-förmige Boxen, Hex-Abgleich gegen X1, Wörter gegen `public/js/lang/de.js`, Glyphen gegen
`public/fonts/tabler-icons.css`, Sichtprüfung über Headless-Chrome-Renderings.

**Ergebnis: alle vier Blätter sind umsetzbar, ohne zweite Runde.** Ein Blatt wurde nicht
zurückgeschickt; die Befunde unten sind Notizen für die Umsetzung, keine Nacharbeit für
Claude Design.

## Messwerte

| Blatt | Textknoten geprüft | Kontrast-Treffer (echt) | Buttons | Zielgrößen-Treffer | Hex nicht in X1 |
|---|---|---|---|---|---|
| T17 | 9 | 0 — die 12-px-Dock-Beschriftung (4,2:1) ist T1s bekannter Rest, das Wasserzeichen „JO" ist Dekor | 91 | 0 | 5: `#173a29 #6b4a1a #9cc4a8 #b8893b #e2d6bc` |
| O17 | 9 | 0 — die Treffer liegen auf den Storyboard-Rahmen (Verlauf, schlechtester Stop); die Pille „Tim · Comeback" auf dem Wasserverlauf bei der Umsetzung gegen die gemalten Pixel nachmessen | 85 | 0 | 9: `#5d7a8b #b9c6cf #b9d3df #bcd6e2 #c3dbe6 #d5dde3 #dcdaf2 #efeef9 #f1f4f6` |
| B17 | 2 | 0 — Wasserzeichen | 85 | 0 (drei Rundungstreffer 23×24 / 174×24 aus B1s Kopf und Fuß) | 4: `#6b7b96 #6fa8dc #9ccf5a #d07aa0` |
| P17 | 1 | 0 | 85 | 0 | 0 — jeder Wert steht in P1 |

Der Kontrollknoten (grau auf grau, 1,26:1) wurde in jedem Durchlauf gemeldet. Der zweite
Durchlauf über div-gezeichnete Bedienelemente fand nichts; alle vier Blätter zeichnen ihre
Kacheln als `<button>`. Alle 38 verwendeten Glyphen sind im Repo-Subset deklariert — keine
neue Glyphe nötig.

## Befunde (bindend für die Umsetzung)

1. **„Siegwertung" gibt es nicht mehr.** Alle vier Tischkarten (X17.4) und die Hub-Zeilen
   (X17.6) führen die Spalte/Zahl „Siegwertung · +6,5" — geerbt aus X13, aber die Größe ist
   am 2026-09-22 aus der App gefallen (Kommentar in `views-pokale.js`). Nicht wieder einbauen;
   die fünf Zahlen der Tischkarte sind die der App.
2. **„Noch eine Runde" ist eine Paraphrase des Handovers**, nicht der App-String: die
   Ergebnisseite schließt mit `result.done` = „Fertig" (P17 zeichnet „Noch eine Session"
   nach P4). Beim Umsetzen den echten String nehmen (Tisch-Regel 5).
3. **Die Hex-Werte oben gehören in X1**, nicht ins Komponenten-CSS (Tisch-Regel 1): bei Tisch
   und Ocean in den `:root[data-design]`-Block der Design-Datei, bei Brücke in den Token-Slice
   #1237. `test/support/theme.js` kann sie nur dort sehen.
4. **Katalog-Entscheidungen, die alle vier Blätter gleich getroffen haben** und die vom
   Handover abweichen — vom Operator angenommen, gelten als Beschluss:
   - Geheim sind **Comeback · Einstimmig · Unentschieden**; „Hundert" ist **Stammgast 100**
     und nicht geheim (Handover: Hundert als eigenes geheimes Abzeichen).
   - **Stammgast (10 · 25 · 50 · 100) und Sessions der Runde (10 · 50 · 100 · 250) haben
     vier Stufen**, alle anderen höchstens drei.
   - Jonas steht bei **22 / 25** (die Runde hat 23 Sessions, das Handover sagte 24 / 25).
   - Kern = **22 Einträge**: 9 Mitglied, 9 Runde, 4 Konto — exakt die ★-Zeilen.
5. **Ein gemeinsames K17-Markup, in allen vier Blättern gleich benannt:** `.badge` (button,
   `data-state="earned|progress|locked|secret"`, `data-new`) mit `.badge__mark` (`--pct` für den
   Ring), `.badge__tier`, `.badge__name`, `.badge__line` · `.badge-card` · `.badge-section` mit
   `.badge-band--round` und `.badge-member` (Telefon: `<details>`) · `.badge-moment` ·
   `.hub-row--badges` · `.chronik-row--badge` · `.member-card__badges` / `.profile-card__badges`.
   Design-Zusätze: Ocean `::before`/`::after` an `.badge__mark`; Brücke `clip-path` und ein
   `span` je Stufe (`data-on`); Programmheft `.badge-moment--special` plus den String
   `badges.specialEdition` („Sonderausgabe", Kicker der Hinweiskarte — nach Vokabular §2 erlaubt).
6. **Die Bewegung ist pro Design festgelegt und endet ohne Schleife:** Tisch fällt die Nadel
   (400 → 1 040 ms), Ocean steigt die Blase nach dem Wal (800 → 1 580 ms), Brücke blitzt der
   HUD-Rahmen (300 → 980 ms), Programmheft stempelt (400 → 880 ms). Alle vier: ab 0 ms
   bedienbar, höchstens zwei Marken, Reduced Motion = Endzustand ab 0 ms, keine Bewegung auf
   Text. Ocean: die Perle darf den Wal (O10.2) nicht überholen.
7. **Ab sieben Mitgliedern zeigt eine Zeile nur Verdientes**, Offenes steht hinter „N offen"
   (X17.8, alle vier). Die Tischkarte zeigt nie Offenes oder Geheimes.
8. **Finnische Namen in X17.8 sind Längen-Platzhalter**, keine Übersetzung.
9. **P17 setzt auf dem Programmheft-Paket auf, das am selben Tag gelandet ist** (#1384,
   Slices #1371–#1383). Es ist das einzige der vier Blätter, dessen Hex-Werte vollständig
   in X1 stehen; umsetzbar, sobald der Token-Slice #1371 da ist.

## Nicht beanstandet

„Verdienste" (Brücke) und „Auszeichnungen" (Programmheft) wurden von den Blättern selbst als
Rubriktitel verworfen — die Form wird nirgends zum Label. Die Mitgliedsfarbe erscheint nur am
Avatar. Kein Text auf einem Motiv. Zinnober nur ≥ 24 px (Sonderausgabe in Anton ab 26 px,
3,79:1 als große Schrift).
