# Aufbewahrungs- und Löschkonzept (Art. 5 Abs. 1 lit. e DSGVO)

Internal record (German). Konsolidiert die Löschfristen aus `vvt.md` und legt
den Prüf-Rhythmus fest; die veröffentlichte Datenschutzerklärung
(`lib/legal.js`) nennt dieselben Fristen. **Beide zusammen ändern** — eine
Frist, die hier steht, aber nicht gelebt oder nicht veröffentlicht wird, ist
schlimmer als keine.

**Stand:** 2026-08-07

## Grundsatz

Gespeichert wird nur, was eine aktive Funktion des Dienstes trägt oder einem
Nachweis dient; die Löschung ist der Normalfall (Konto-/Runden-Löschung wirkt
sofort und vollständig, `eraseAccount`/`deleteRound` räumen auch die
Bild-Objekte ab — `.claude/rules/deletion-paths-must-free-cover-objects.md`).

## Fristen

| Datenbestand | Frist | Mechanismus |
|---|---|---|
| Runden-/Spiel-/Mitgliedsdaten, Cover | bis Löschung durch Nutzer bzw. Kontolöschung | Nutzeraktion / `eraseAccount` (#273) |
| Konten — **mit allen am Konto hängenden Feldern**: Anmeldedaten samt zuletzt bestätigter Fassung der Nutzungsbedingungen (`vvt.md` Zeile 2), verknüpfter BoardGameGeek-Nutzername (Zeile 15), Benachrichtigungs-Schalter und Zeitpunkt der letzten Benachrichtigung (Zeile 18) | bis Kontolöschung — seit #419 vom Nutzer selbst in den Kontoeinstellungen auslösbar, alternativ betreiberseitig auf formlose Anfrage | `eraseAccount` (#273/#419) |
| **Gast-Demo-Konten (#427)** samt Runden, hochgeladenen Bildern und der gehashten IP-Adresse des Demo-Starts (#502, `vvt.md` Zeile 17 — kein eigener Aufbewahrungslauf) | **24 h** ab Erstellung (`DEMO_TTL_HOURS`) | **automatisch**: Hintergrundjob `purgeExpiredDemos` (`lib/scheduler.js`), ruft `eraseAccount` — der einzige Bestand mit vollautomatischer Löschfrist |
| Einladungen (Runden-Freigaben, #207) | bis Annahme/Ablehnung bzw. Widerruf | Nutzeraktion / `eraseAccount` |
| Freigaben (`round_grants`, #207) | bis Widerruf/Verlassen bzw. Konto- oder Rundenlöschung | Nutzeraktion / `eraseAccount` |
| Freundschaften + Freundeskreis-Feed (#325) | bis Entfreunden bzw. Kontolöschung; Feed je Konto auf 50 Einträge begrenzt (älteste werden verdrängt) | Nutzeraktion / automatisch / `eraseAccount` |
| Postfach-Benachrichtigungen (Inbox, #207) | je Konto auf 100 Einträge begrenzt (älteste werden verdrängt); Kontolöschung räumt vollständig | automatisch / `eraseAccount` |
| Abstimmungs-Links ohne Konto (#652) | mit dem Ende der Abstimmung, beim Abbrechen/Löschen der Session oder der Runde, bei Kontolöschung — **und in jedem Fall spätestens 30 Tage nach dem Erzeugen** (`VOTE_LINK_TTL_DAYS`). Die Höchstfrist ist nicht nur Aufräumen: eine Session, die nie geschlossen wird, erreicht keinen der ereignisgesteuerten Pfade, und ohne sie bliebe der Link unbegrenzt gültig. Er wird zum selben Stichtag **unbrauchbar** (Prüfung in der Route), unabhängig davon, wann der Sweep die Zeile löscht | automatisch (Route + `deleteRound`/`eraseAccount` + 15-Minuten-Sweep in `lib/scheduler.js`) |
| Zuletzt abgerufene Preise (`last_prices`, #688 — **keine personenbezogenen Daten**, `vvt.md` Zeile 21: Spiel-Kennung + Preis, ohne Nutzer-/Konto-/Mandanten-Bezug) | **7 Tage** ab Abruf (`PRICES_FALLBACK_MAX_AGE_DAYS`). Die Frist ist keine Datenschutz-, sondern eine **Richtigkeits**-Frist: älter darf der Preis nicht angezeigt werden, weil er sonst irreführend wäre (§ 5a UWG). Die Anzeige endet zum selben Stichtag über die Alterprüfung in `lib/prices/index.js`, unabhängig davon, wann der Sweep die Zeile löscht | automatisch (15-Minuten-Sweep in `lib/scheduler.js`) |
| Server-Request-Logs, Produkt-Ereignisse | Logrotation der Plattform (Railway) | automatisch |
| In-App-Feedback | nach Bearbeitung löschen | Panel-Löschung im Admin-Panel (#389, seit 2026-07-24) |
| Kontakt-/Support-Korrespondenz (Postfach) | bis Abschluss der Bearbeitung, danach löschen — spätestens bei der Jahresprüfung | manuell (Postfach) |
| Transaktions-E-Mails (Versandprotokolle bei mailbox.org) | Aufbewahrungsfenster des Anbieters; keine eigene Speicherung | automatisch (mailbox.org) |
| Briefpost an die Empfangsanschrift (weitergeleitet) | nach Bearbeitung vernichten — spätestens bei der Jahresprüfung | manuell |
| Spenden (`vvt.md` Zeile 12) | Dashboard-Daten bei Ko-fi/Stripe/PayPal nach deren Regime — die App speichert selbst nichts; eigene Aufzeichnungen: solange steuerlich erforderlich | beim Anbieter / manuell |
| DSA-Meldungen + Bescheide (Postfach-Ordner `Meldungen`) | **3 Jahre** ab Jahresende der Entscheidung (wie Moderations-Log) | manuell, Jahresprüfung |
| Gespeicherte Kontakt-Meldungen (Datenbank `contact_notices`, #272) | wie Postfach: Allgemeine Anfragen nach Bearbeitung, DSA-Meldungen **3 Jahre** ab Jahresende der Entscheidung | manuell (DB), Jahresprüfung |
| **Moderations-Log-Einträge mit personenbezogenen Daten** (E-Mail-Adressen, redigierte Texte als `previous`-Nachweis) | **3 Jahre ab Ende des Jahres der Maßnahme** | Jahresprüfung (unten) |
| Löschnachweise (`eraseAccount`-Einträge — ohne E-Mail-Adresse by design): Aktionen **`user_erased`** (betreiberseitig, #273) **und `account_deleted`** (Selbstbedienung, #419) | dauerhaft (Art. 17 Abs. 3 lit. b/e DSGVO) | — |
| **Backups** (Railway Managed Postgres, eingerichtet 2026-08-04) | **Volume-Sicherungen: 6 Tage** (täglicher Lauf); **Point-in-Time-Recovery: Vorhaltefenster des WAL-Archivs — noch zu bestätigen**, siehe „Offen" unten | automatisch |

**Backups und Art. 17 (Löschung).** Eine Löschung wirkt im Live-Bestand sofort
und vollständig. In den Sicherungen bleiben die Daten dagegen bis zum Ablauf des
jeweiligen Aufbewahrungsfensters erhalten (oben: 6 Tage für die
Volume-Sicherungen, das PITR-Fenster für das WAL-Archiv). Das ist der anerkannte
**Backup-Vorbehalt**: Sicherungen werden nicht gezielt durchsucht, um einzelne
Datensätze zu entfernen — sie laufen aus. Eine Wiederherstellung erfolgt nur als
Ganzes und nur im Katastrophenfall; wird eine Sicherung eingespielt, **sind
zwischenzeitlich ausgeführte Löschungen erneut auszuführen**.

Diese Fenster sind bewusst **interne Betriebsgrößen** und stehen nicht in der
veröffentlichten Datenschutzerklärung (Betreiber-Entscheidung 2026-08-04): die
Erklärung sagt zu, *dass* eine Löschung endgültig ist und vom Betreiber nicht
rückgängig gemacht wird — was zutrifft, denn PITR stellt in eine **neue**
Instanz wieder her und ist kein Werkzeug, um einzelne gelöschte Datensätze
zurückzuholen. Der Satz „beide zusammen ändern" oben bezieht sich auf die
veröffentlichten **Löschfristen je Datenbestand**, nicht auf die
Backup-Mechanik. Wird die Backup-Mechanik künftig doch veröffentlicht, gilt die
Kopplung wieder (dann mit `PRIVACY_REVISION`-Bump, siehe
`.claude/rules/keep-legal-docs-current.md`).

**Offen (Stand 2026-08-04):** Die Länge des PITR-Fensters ist noch **nicht
bestätigt** — Railway dokumentiert sie nicht, und das Archiv lief zum Zeitpunkt
der Einrichtung erst wenige Minuten. Sobald der linke Rand des
Wiederherstellungsfensters im Railway-Dashboard stabil ist: hier in der Tabelle
und in `toms.md` eintragen und diesen Absatz entfernen. **Bis dahin keine Zahl
schätzen** — eine erfundene Frist in einem Rechenschaftsdokument ist schlimmer
als eine offen als offen markierte.

**Warum 3 Jahre:** die regelmäßige Verjährungsfrist (§ 195 BGB) beginnt mit
dem Schluss des Jahres, in dem der Anspruch entstand (§ 199 Abs. 1 BGB) —
solange kann der Betreiber eine Maßnahme belegen müssen (Entscheidung #140,
Betreiber-Interview 2026-07-21; die Entscheidung, auf die #275 §6 verwiesen
hat).

**Bewusst akzeptiertes Restrisiko:** § 199 Abs. 1 BGB knüpft den Fristbeginn
zusätzlich an die Kenntnis des Gläubigers; ohne Kenntnis gelten die längeren
Grenzen des § 199 Abs. 3 BGB (bis 10 Jahre). Die 3-Jahres-Löschung kann also
Nachweise vernichten, die für spät bekannt gewordene Ansprüche noch nützlich
wären. Das ist als datenschutzfreundlicher Kompromiss entschieden
(Speicherbegrenzung, Art. 5 Abs. 1 lit. e DSGVO) — bei der Jahresprüfung
nicht stillschweigend auf 10 Jahre „korrigieren".

## Jahresprüfung (jeweils Januar)

1. Moderations-Log im Panel nach Datum filtern (`/admin.html`, #275): Einträge
   mit Maßnahme-Datum vor dem 1. Januar vor drei Jahren (Beispiel: Prüfung
   Januar 2030 → Einträge bis 31.12.2026) exportieren (CSV, falls ein
   Aufbewahrungsgrund im Einzelfall fortbesteht — z. B. laufender Streit —
   sonst nicht) und anschließend löschen bzw. die personenbezogenen Felder
   anonymisieren. **Löschnachweise bleiben — und das sind ZWEI Aktionen:**
   `user_erased` (betreiberseitige Löschung, #273) und `account_deleted`
   (Selbstbedienung über die Kontoeinstellungen, #419). Beide sind
   Art.-17-Nachweise; die zweite Aktion ist seit #419 der Regelfall, weil die
   meisten Löschungen ohne den Betreiber ablaufen. Ein Purge, der nur auf
   `user_erased` ausnimmt (so der Vorschlag in #311), löscht also genau die
   Nachweise, um die es überwiegend geht.
   *Tooling-Hinweis:* ein Lösch-/Anonymisier-Endpunkt für alte Log-Einträge
   existiert noch nicht (#275 §6 lieferte Filter/Export); bis dahin per
   direktem DB-Zugriff löschen und den Vorgang im Log der Prüfung vermerken.
2. Postfach: Ordner `Meldungen` nach demselben Stichtag aufräumen; erledigte
   Support-Korrespondenz löschen. Ebenso die **gespeicherten Meldungen** der
   `contact_notices`-Tabelle (Panel-Karte „Meldungen“, #272) nach demselben
   Stichtag im Panel löschen (#389; eine **entschiedene** Meldung verlangt
   `?force=1` — genau der Fall der Jahresprüfung, siehe
   `.claude/rules/admin-moderation-surface.md`).
3. Bearbeitete Feedback-Einträge löschen (Panel-Löschung im Admin-Panel,
   #389).
4. Prüfung mit Datum in diesem Dokument unter „Durchgeführte Prüfungen"
   vermerken.

## Durchgeführte Prüfungen

- *(noch keine — erste Prüfung: Januar 2027)*
