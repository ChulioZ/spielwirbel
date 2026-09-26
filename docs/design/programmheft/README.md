# Übergabepaket „Das Programmheft" — P1 bis P15b

Datum: 2026-09-25 · Phase 2, Design 3 von 5 (Reihenfolge O → B → **P** → F → R)
Stand: **Runde 1 eingearbeitet (26.09.)**, bereit für Prüfrunde 2.
Erzeugt von Claude Design für die Überführung in GitHub-Issues durch Claude Code.

**Abweichung vom Ablauf:** Auf ausdrücklichen Wunsch des Auftraggebers sind alle vierzehn
Briefs in einer Session entstanden, nicht einer pro Session (§0). Gegen die Ursache der
Brücke-Funde (vierzehn Blätter ohne Zwischenprüfung) gab es diesmal eine Selbstprüfung vor
der Übergabe — siehe unten. Sie ersetzt die Prüfung nicht.

---

## Inhalt

| Datei | Brief |
|---|---|
| `Programmheft-P1-Komponenten.dc.html` | Bauteile und Tokens — **die einzige Token-Quelle**, Kontraste werden beim Rendern gerechnet |
| `Programmheft-P2-Phone-Kern.dc.html` | Telefon 390: Hub, Neue Session, Abstimmung, Ergebnis, Dock |
| `Programmheft-P3-Runde-Desktop.dc.html` | Start, Hub (mit IA-Prüfliste), Regal, Spieldetail, Spiel hinzufügen |
| `Programmheft-P4-Session-Desktop.dc.html` | Neue Session, Abstimmung, Ergebnis, Mehrere Tische, **Geteilte Wertung, Übergabe** (mit Prüfliste Session-Schleife) |
| `Programmheft-P5-Konto.dc.html` | Anmelden/Registrieren/Passkey (Desktop + Telefon), Kontoseite mit Design-Wähler, Auswahl-Sheet (Desktop + Telefon) |
| `Programmheft-P6-Phone-Rest.dc.html` | Telefon: Start, Regal, Spieldetail, Spiel hinzufügen, Geteilte Wertung, Übergabe, Mehrere Tische |
| `Programmheft-P7-Leerzustaende.dc.html` | Leer und jung **plus die vier Dichtebelege** (12 Personen/Gäste/Teams, 42 Spiele, Unentschieden, Finnisch) |
| `Programmheft-P8-Farben.dc.html` | Personenfarben auf allen Flächen, acht Marker, Rampe unter Farbfehlsichtigkeit, Rückblickkarte |
| `Programmheft-P9-Vokabular.dc.html` | Vokabular DE + EN — das Programmheft benennt nichts um, daher kein Glossar |
| `Programmheft-P10-Motion.dc.html` | Vier Rituale, abspielbar, mit Schalter „Reduzierte Bewegung" |
| `Programmheft-P13-Tier2a.dc.html` | Chronik + Rückblick, Pokale, Mitglied (je Desktop + Telefon), Nicht im Regal, Könnte euch gefallen |
| `Programmheft-P14-Tier2b.dc.html` | Rundeneinstellungen mit Markerwähler, Profil, Freunde + Feed, Postfach, Was ist neu, Statistik |
| `Programmheft-P15a-Sheets.dc.html` | 13 Sheets, 3 Popover (Sortierung, Filter, Sprache) |
| `Programmheft-P15b-Dialoge.dc.html` | 9 Dialoge aus `de.js`, Toasts, „…"-Menü |
| `Programmheft-Kopf / -Telefonkopf / -Dock / -Fuss.dc.html` | **Vier Bauteile**, auf jedem Blatt eingebunden — Kopfleiste mit Ressortzeile, Telefonkopf, Dock, Fuß |
| `Konzept-C-Das-Programmheft.dc.html` | Das Konzeptblatt mit V0-Revert |
| `support.js` | Laufzeit — **nicht ins Repo übernehmen** |
| `vorgaben/` | Handover, Vokabular-Addendum, Projektregeln, Tisch-Prüfung, Ocean-Rückgabe, Brücke-Prüfung, Brücke-Runde-3-Auftrag |

Nummerierung wie §9: P1–P10, P13, P14, P15a, P15b. Kein P11/P12 (Face-only). Die Dichtebelege
stehen in **P7** (§3D verlangt sie dort), kein eigenes P16.

`public/` liegt nicht bei. Die Blätter zeigen per `public/fonts/tabler-icons.css` und
`public/icons/powered-by-bgg.png` auf das echte Verzeichnis; im Repo unter
`docs/design/…` entsprechend `../../../public/`.

---

## Die Tokens in Kürze

Alles Weitere in P1; P1 rechnet die Werte beim Rendern mit der WCAG-Formel.

```
page          #fbfaf6   Papier, Grund jeder Seite
raised        #ffffff   Sheet, Popover, Dialog, Eingabefeld (Kante + Schatten, keine Tönung)
box           #141414   der schwarze Kasten — Bauteil, keine Fläche; Papier darauf 17,6:1
masthead      #e8451c   Kopfleiste; TINTE darauf 4,6:1 (Papier wäre 3,8:1)

ink           #141414   17,6:1      ink-2  #2b2925  13,9:1
box-ink-soft  #cfccc5   weiche Schrift im Kasten, 12,1:1 auf box
hatch         #efece4   Schraffur leerer Kacheln, kein Text
ink-soft      #6f6b66    5,1:1      nie auf der Goldzeile (4,3:1)
hair          #b8b4ad    2,0:1      nur gepunktete Zierlinie, nie Text, nie Bedienkante

accent        #e8451c    3,8:1      nur Anton ≥ 24 px, Flächen, Unterstreichung
accent-ink    #b8330f    5,7:1      Zinnober für Text < 24 px
gold          #d9a72a               nur auf Tinte (8,3:1) oder mit Tintenkante; auf Papier 2,1:1
gold-tint     #f6e7b9               Siegerzeile, nur Tinte darauf (15,0:1)
ok #2d6a3e 6,2:1 · warn #8a5a00 5,7:1 · danger #a3241a 7,1:1

Rampe 1→5     #e8451c #b23d1c #7a4a3a #4a3f3a #141414 — fällt in der Luminanz monoton
              Ziffern: Tinte auf Stufe 1 (4,6:1), Papier auf 2–5 (≥ 5,6:1). Veto = Papier + Zinnoberkante + Wort
Marker (8)    Zinnober (Standard) #e8451c · Preußischblau #1f4e8c · Tannengrün #2e6b3f · Ocker #a8761a
              Pflaume #6e3a6b · Graphit #4a4a48 · Petrol #1c6b72 · Fuchsie #9c2f6e

Personen (8)  #c6522c #198663 #726bc7 #a66815 #c34d74 #2f6f9e #54821d #993556 — global, nicht vom Design
Durchschuss   Anton 1,0 · Schlagzeilen mit „ 1,05 · Kicker → Überschrift 12 px
Knöpfe        Anton nur ≥ 24 px (auch Sheet-/Dialog-Aktion); darunter Archivo 700
Schrift       Anton 400 (einzige Schnittstärke, nie fetten, immer ≥ 24 px) · Archivo 400/600/700 — beide OFL
Textgrößen    Text ab 13 px · Etikett 12 px · 11 px nur Achsen · nie darunter
Radius        0
Ziele         target-min 24 · target-foot 32 · target-key 44 · target-field 44 — in Höhe UND Breite
Fokus         3 px Tinte, 3 px Abstand; im Kasten 3 px Zinnober
Rahmen        Telefon 390 × voller Inhalt (844 markiert) · Desktop 1440 × voller Inhalt (900 markiert)
Rückblickkarte 540 × 675 gezeichnet, Export 1080 × 1350 (× 2) — kleinste Schrift 12 → 24 px
Zahlen        ohne führende Null (Nr. 1, 9 Spiele) · Score mit Komma (4,8)
```

---

## Die sechzehn Regeln — alle übernommen, in P1.8 einzeln abgehakt

**Neun aus der Tisch-Prüfung:** (T1) P1 ist die Quelle · (T2) Akzent auf Marker nur ≥ 24 px ·
(T3) kein Text auf einem Cover · (T4) Trefferflächen als Token · (T5) Wörter aus der App
abschreiben · (T6) Glossar nur bei Bedarf · (T7) Wertungskarte Vollbild, Zurück ≥ 44 px ·
(T8) X15 in der Liste · (T9) Kontrastzahlen prüfen, bevor sie zitiert werden.

**Vier aus der Ocean-Rückgabe:** (O1) alle Regeln, nicht vier · (O2) IA-Prüfliste Block für
Block — steht sichtbar neben P3.2 und P4 · (O3) nach dem Revert den Text lesen · (A5) Icons
gegen das Repo.

**Drei aus der Brücke-Prüfung:** (B1) die Zahl in der README ist prüfbar — sechzehn ·
(B2) Icons gegen das Repo, nicht die Vorgängerkopie · (B3) Dichtebelege sind Teil der
Lieferung — P7.7 bis P7.10.

Aus dem methodischen Nachtrag der Brücke-Prüfung: **alle Bedienelemente sind `<a>` oder
`<input>`**, keines ist ein `div` — `audit.js` sieht sie also.

---

## Selbstprüfung vor der Übergabe

Per Skript über alle 18 Dateien:

- **Glyphen:** 67 verschiedene `ti-`Klassen, **alle** im Repo-`tabler-icons.css` (Stand
  25.09.) deklariert — auch `ti-tornado` und `ti-qrcode`. Die Projektkopie
  (Oceans, ohne `qrcode`) ist um genau diese eine Repo-Zeile ergänzt.
- **Schriftgrößen:** keine Angabe unter 11 px.
- **Anton:** jede Überschrift mit `font-weight: 400` (kein Faux-Bold über `h1`/`h2`).
- **Abendwörter:** Wortteil „abend" nur dort, wo er als Sperrwort zitiert wird (P1.8, P3-Kopf,
  P9). In keinem UI-String, keinem Beispieltext.
- **Anführungszeichen:** deutsche „…“ überall; ein Ersetzungslauf hat 11 Blätter korrigiert.

---

## Runde 1 — eingearbeitet (26.09.2026)

Geprüft mit `uploads/pruefung-programmheft-2026-09-26.md` (liegt in `vorgaben/`).

- **S1** Alle acht Personenfarben stehen in P1.1 als eigene Gruppe, „global, nicht vom Design".
- **S2** Ein Token `box-ink-soft` #cfccc5 ersetzt #b9b8b4 und #e7e5df überall; `hatch` #efece4 ist deklariert. Die Plakatfarben aus P5 stehen als Nicht-Token `poster-*` in P1. Kein Hexwert in P2–P15b ohne Deklaration in P1 (per Skript).
- **S3** Jede Anton-Angabe trägt `font-weight: 400` (vorher erbten Ziffern und Team-Namen 700). Keine Anton unter 24 px mehr: P13.7, P14.5 und alle P15a-Aktionen auf 24 px, die Minivorschau in P8.2 ist Archivo 700. Die Knopfregel steht in P1.3.
- **S4** Durchschuss als Token in P1.2: Anton nie unter 1,0, Schlagzeilen mit „ 1,05; Kicker → Überschrift 12 px (P5.4, P5.5). Die Topf-Ziffern stehen auf 1,0.
- **S5 / E2** Ocker bleibt #a8761a; Entscheidung 4 oben berichtigt.
- **W1** Der Offline-Toast ist gestrichen; der P15b-Kopf behauptet nicht mehr „alle Sätze aus de.js".
- **W2** „Noch eine Session →" (`tables.oneMore`) überall.
- **W3 / W4** Neue Wörter sind in **P9.5** gelistet, mit dem nächsten App-Wortlaut; P2 und P4 verweisen darauf.
- **W5 / E1** Schrittleiste entfernt auf P2.2, P4.1 und im Bauteil P1.6.
- **W6** Konzeptblatt: „Heute Abend" und „Besetzungsliste" aus den Unterschriften und dem Kasten entfernt.
- **I1** P15a hat das Sheet **„Gast hinzufügen"** (`startSession.guestAddTitle`, „Name des Gasts", „Hinzufügen", `guestsNote`). Sheet 10 zeigt jetzt, was „Jemand ohne Spiele?" in der App tut (`startSession.addon.shelf` / `shelfOn`). Das macht vierzehn Sheets.
- **I2** P1.4 zeigt alle vier Schnellstarts inkl. „Anspruchsvoll" in DE und FI; die Zeile bricht um, Chips werden nie gekürzt.

Nicht geändert (Beobachtungen): Initialen bleiben Papier, solange ≥ 19 px fett. Die doppelten Skalenenden auf P4.2 bleiben. P15b bleibt bei neun Dialogen.

## Entscheidungen des Auftraggebers (26.09.2026)

1. **Kopfleiste:** bleibt #e8451c mit Tinte (4,6:1).
2. **Pokale:** Seitentitel „Pokale", Podiumsüberschrift „Ruhmeshalle" (`pokale.title`).
3. **Kasten-Kicker:** „Neue Session" statt „Heute Abend".
4. **Ocker-Marker:** abgedunkelt von #c08a1e auf **#a8761a** und dabei geblieben (E2 nach Runde 1). **Tinte** darauf 4,6:1; das Band misst 3,8:1 gegen Papier (Grafik, ≥ 3:1). Gilt in P1, P8, P14, P15a.
5. **Gleichstand beim Score:** keine Design-Setzung. Welches Spiel auf den Tisch kommt, bestimmt die bestehende App-Logik; P7.9 zeigt nur die Darstellung.
6. **Geteilter Sieg:** jeder bekommt einen vollen Sieg, Serien laufen für beide weiter.
7. **Podium:** Platz 2 und 3 Papier mit Tintenkante, kein Silber/Bronze-Token.
8. **Telefon-Dock:** kein Dock auf Neue Session, Abstimmung, Übergabe; das Ergebnis hat eines.
9. **Nicht gefundene Strings:** Claude Code ordnet sie echten Schlüsseln zu; was fehlt, wird als neuer Schlüssel angelegt (DE + EN aus den Blättern, sieben Sprachen nachziehen).
10. **Dichteregeln (P7-Kopf):** **nicht** als Produktregeln übernehmen — nur Zeichenhilfe der Blätter.
11. **Ablauf:** volle Prüfrunde wie bei der Brücke, dann Befunde einarbeiten, dann Übergabe an Claude Code.

## Was offen bleibt

- Prüfrunde 2.
- Kontraste in der echten App — gemessen gegen die hier gezeichneten Gründe.
- Die Bauteile als DC-Kinder (`Programmheft-Kopf` usw.) sind Blattwerkzeug; in der App entspricht ihnen das gemeinsame Markup von Topbar, Rail und Dock mit Programmheft-Overrides.
