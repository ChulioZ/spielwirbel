# Aufbewahrungs- und Löschkonzept (Art. 5 Abs. 1 lit. e DSGVO)

Internal record (German). Konsolidiert die Löschfristen aus `vvt.md` und legt
den Prüf-Rhythmus fest; die veröffentlichte Datenschutzerklärung
(`lib/legal.js`) nennt dieselben Fristen. **Beide zusammen ändern** — eine
Frist, die hier steht, aber nicht gelebt oder nicht veröffentlicht wird, ist
schlimmer als keine.

**Stand:** 2026-07-24

## Grundsatz

Gespeichert wird nur, was eine aktive Funktion des Dienstes trägt oder einem
Nachweis dient; die Löschung ist der Normalfall (Konto-/Runden-Löschung wirkt
sofort und vollständig, `eraseAccount`/`deleteRound` räumen auch die
Bild-Objekte ab — `.claude/rules/deletion-paths-must-free-cover-objects.md`).

## Fristen

| Datenbestand | Frist | Mechanismus |
|---|---|---|
| Runden-/Spiel-/Mitgliedsdaten, Cover | bis Löschung durch Nutzer bzw. Kontolöschung | Nutzeraktion / `eraseAccount` (#273) |
| Konten | bis Kontolöschung (formlose Anfrage) | `eraseAccount` (#273) |
| **Gast-Demo-Konten (#427)** samt Runden und hochgeladenen Bildern | **24 h** ab Erstellung (`DEMO_TTL_HOURS`) | **automatisch**: Hintergrundjob `purgeExpiredDemos` (`lib/scheduler.js`), ruft `eraseAccount` — der einzige Bestand mit vollautomatischer Löschfrist |
| Einladungen (Runden-Freigaben, #207) | bis Annahme/Ablehnung bzw. Widerruf | Nutzeraktion / `eraseAccount` |
| Freigaben (`round_grants`, #207) | bis Widerruf/Verlassen bzw. Konto- oder Rundenlöschung | Nutzeraktion / `eraseAccount` |
| Freundschaften + Freundeskreis-Feed (#325) | bis Entfreunden bzw. Kontolöschung; Feed je Konto auf 50 Einträge begrenzt (älteste werden verdrängt) | Nutzeraktion / automatisch / `eraseAccount` |
| Postfach-Benachrichtigungen (Inbox, #207) | je Konto auf 100 Einträge begrenzt (älteste werden verdrängt); Kontolöschung räumt vollständig | automatisch / `eraseAccount` |
| Server-Request-Logs, Produkt-Ereignisse | Logrotation der Plattform (Railway) | automatisch |
| In-App-Feedback | nach Bearbeitung löschen | Panel-Löschung im Admin-Panel (#389, seit 2026-07-24) |
| Kontakt-/Support-Korrespondenz (Postfach) | bis Abschluss der Bearbeitung, danach löschen — spätestens bei der Jahresprüfung | manuell (Postfach) |
| Transaktions-E-Mails (Versandprotokolle bei mailbox.org) | Aufbewahrungsfenster des Anbieters; keine eigene Speicherung | automatisch (mailbox.org) |
| Briefpost an die Empfangsanschrift (weitergeleitet) | nach Bearbeitung vernichten — spätestens bei der Jahresprüfung | manuell |
| DSA-Meldungen + Bescheide (Postfach-Ordner `Meldungen`) | **3 Jahre** ab Jahresende der Entscheidung (wie Moderations-Log) | manuell, Jahresprüfung |
| Gespeicherte Kontakt-Meldungen (Datenbank `contact_notices`, #272) | wie Postfach: Allgemeine Anfragen nach Bearbeitung, DSA-Meldungen **3 Jahre** ab Jahresende der Entscheidung | manuell (DB), Jahresprüfung |
| **Moderations-Log-Einträge mit personenbezogenen Daten** (E-Mail-Adressen, redigierte Texte als `previous`-Nachweis) | **3 Jahre ab Ende des Jahres der Maßnahme** | Jahresprüfung (unten) |
| Löschnachweise (`eraseAccount`-Einträge — ohne E-Mail-Adresse by design): Aktionen **`user_erased`** (betreiberseitig, #273) **und `account_deleted`** (Selbstbedienung, #419) | dauerhaft (Art. 17 Abs. 3 lit. b/e DSGVO) | — |
| Backups | Backup-Zyklus der Plattform (Railway Managed Postgres) | automatisch |

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
