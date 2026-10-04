# Prozess bei Datenschutzverletzungen (Art. 33/34 DSGVO)

Internal record (German). Kept deliberately short — it must be executable under
stress by one person.

**Stand:** 2026-10-04

## 1. Erkennen & Eindämmen (sofort)

- Auffälligkeit ernst nehmen: unerwartete Logs, fremde Moderations-Aktionen,
  Hinweise per Kontaktformular/E-Mail, Anbieter-Benachrichtigung.
- Sofortmaßnahmen je nach Fall: betroffene Secrets rotieren, verdächtige Konten
  sperren (Admin-Panel), notfalls `ACCOUNTS_ENABLED` abschalten oder den Dienst
  pausieren (Railway). Die Secrets (alle in den Railway-Variablen des
  App-Dienstes, sofern nicht anders genannt):
  - `SESSION_SECRET` — signiert die kurzlebigen Konto-Zugangstoken. Laufende
    Sitzungen **überleben** die Rotation, weil die Refresh-Token nicht davon
    abhängen (gespeichert als SHA-256-Hash); wer gestohlene Sitzungen beenden
    muss, sperrt die betroffenen Konten im Admin-Panel.
  - `ADMIN_PASSWORD` **und `ADMIN_SESSION_SECRET`, falls gesetzt** — das
    Betreiber-Cookie wird mit `ADMIN_SESSION_SECRET || SESSION_SECRET ||
    ADMIN_PASSWORD` signiert (`lib/admin.js`). Ist `ADMIN_SESSION_SECRET`
    gesetzt, macht das Rotieren der beiden anderen ein gestohlenes, bis zu
    12 Stunden gültiges Betreiber-Cookie **nicht** ungültig — dann dieses
    mitrotieren.
  - `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — Zugang zum Objektspeicher
    (Cloudflare R2) mit **allen hochgeladenen Bildern**, auch Profilbildern,
    die häufig Personen zeigen. Neuen Schlüssel im Cloudflare-Dashboard
    anlegen, eintragen, den alten widerrufen.
  - `SMTP_PASS` — Versandzugang des Betreiber-Postfachs (mailbox.org).
  - `BGG_API_TOKEN` — der lizenzierte BoardGameGeek-Zugang; kein Personenbezug,
    aber missbrauchsfähig unter unserem Namen.
  - DB-Zugang (`DATABASE_URL`) — Zugangsdaten über den Postgres-Dienst in
    Railway neu erzeugen.
- Nichts vorschnell löschen — Logs und Zustand für die Bewertung sichern
  (Railway-Logs exportieren, Zeitpunkte notieren).

## 2. Bewerten & Dokumentieren (innerhalb von Stunden)

- Was ist passiert, welche Daten, welche Personen, wie viele, seit wann?
- **Jede** Verletzung intern dokumentieren (Datum, Hergang, Umfang, Maßnahmen)
  — Pflicht nach Art. 33 Abs. 5, auch wenn keine Meldung nötig ist. Ablage:
  privates Betreiber-Dokument (nicht im Repo — kann Personendaten enthalten).

## 3. Melden (Frist: 72 Stunden ab Kenntnis)

- **Aufsichtsbehörde** (Art. 33): melden, außer die Verletzung führt
  voraussichtlich **nicht** zu einem Risiko für Betroffene. Zuständig ist die
  Landesdatenschutzbehörde des Wohnsitz-Bundeslands des Betreibers; die meisten
  bieten Online-Meldeformulare.
- **Betroffene** (Art. 34): direkt benachrichtigen, wenn voraussichtlich ein
  **hohes** Risiko besteht (z. B. Passwort-Hashes + E-Mails abgeflossen) — per
  E-Mail an die Konto-Adressen, klar und konkret (was, welche Folgen, was wir
  getan haben, was Betroffene tun sollten, Kontakt).
- Faustregeln für diesen Dienst: abgeflossene E-Mail-Adressen/Passwort-Hashes →
  melden + benachrichtigen (Passwörter sind Argon2id-gehasht — trotzdem
  Passwort-Reset erzwingen); reine Verfügbarkeitsstörung ohne Datenabfluss →
  dokumentieren, i. d. R. keine Meldung.

## 4. Nacharbeiten

- Ursache beheben (Fix wie üblich über PR/CI), Rotation abschließen,
  Dokumentation vervollständigen, ggf. VVT/TOMs (`docs/legal/`) und die
  Datenschutzerklärung anpassen.
