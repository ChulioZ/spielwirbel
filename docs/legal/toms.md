# Technische und organisatorische Maßnahmen (Art. 32 DSGVO)

Internal record (German — it addresses a German supervisory authority). Every
item is implemented in this repository or the hosting setup; keep it truthful —
list nothing that is not actually in place.

**Stand:** 2026-11-14

## Verschlüsselung & Transport

- TLS für alle Verbindungen; Terminierung an der Railway-Edge (#156). HSTS
  gesetzt (`helmet`, `lib/app.js`); die kanonische Domain `.app` ist
  HSTS-preloaded.
- Datenbank- und Objektspeicher-Zugriff über die verschlüsselten Kanäle der
  Anbieter (Railway-internes Netz, R2 über HTTPS).

## Zugangskontrolle & Authentifizierung

- Passwörter nur als **Argon2id-Hash**; Verifikations-, Reset- und
  Refresh-Token nur als SHA-256-Hash (`lib/accounts.js`).
- Access-Token: kurzlebige (15 min) signierte JWTs; Refresh-Token rotieren.
- Anti-Enumeration: Registrierung/Passwort-vergessen antworten für bekannte und
  unbekannte Adressen identisch; Login verbrennt konstante Argon2-Arbeit.
- Betreiber-Panel hinter **zwei Faktoren** (#1670): eigenes `ADMIN_PASSWORD`
  (nie gleich dem App-Passwort, domain-separierte Token — `lib/admin.js`) **und**
  ein für den Betreiber registrierter Passkey mit Nutzerverifikation (PIN/
  Biometrie). Das Passwort allein meldet nicht an. Neue Passkeys nur mit einem
  einmaligen `ADMIN_ENROLL_TOKEN` aus der Server-Umgebung, nie aus einer
  laufenden Panel-Sitzung; ohne Passkey bleibt das Panel geschlossen. Die
  Panel-Sitzung ist serverseitig gespeichert (nur als Hash): Auch wer die
  Signier-Secrets der Server-Umgebung kennt, kann keine Sitzung erzeugen, und
  Abmelden oder das Entfernen eines Passkeys beendet sie sofort.
- Uploads sind zugriffsgeschützt (Cookie/Bearer-Gate auf `/uploads`); kein
  öffentlicher Bucket-Zugriff (Read-through-Proxy, #128). Seit #955 prüft
  `lib/upload-access.js` zusätzlich die **Eigentümerschaft** am angefragten
  Objekt (siehe Mandantentrennung).

## Mandantentrennung

- Jede Zeile trägt `tenant_id`; jede Abfrage filtert darauf; zusätzlich
  **Row-Level Security (FORCE)** in PostgreSQL als Backstop (#136,
  `.claude/rules/tenancy-rls.md`). Die Anwendung verbindet sich mit einer
  eigenen Anwendungsrolle statt des Superusers `postgres` (geprüft 2026-10-06),
  sodass FORCE RLS tatsächlich greift — ein Superuser umginge es.
- Betreiber-Lesezugriff für Moderation ist eine separate, **nur-lesende**
  RLS-Policy; Schreibzugriffe bleiben mandantengebunden (#268/#275). Die
  transaktionslokale Umzugs-Policy für das einmalige Übertragen der Alt-Daten
  in ein Konto (#266) wurde nach ihrer Ausführung wieder **entfernt** (#405),
  sodass keine mandantenübergreifende Schreib-Policy mehr besteht.
- Hochgeladene Bilddateien (`/uploads`) unterliegen seit #955 derselben
  Trennung: Ein Objekt wird nur an den besitzenden Mandanten ausgeliefert bzw.
  an ein Konto mit einer Freigabe für die referenzierende Runde
  (`lib/upload-access.js`). Zuvor genügte ein beliebig gültiges Konto, sodass
  ein *bekannter* Schlüssel mandantenübergreifend lesbar war. Session-Fotos
  (#1774) folgen genau dieser Regel (besitzender Mandant oder Freigabe der
  Runde); `test/session-photo.test.js` prüft beide Richtungen, einschließlich
  eines fremden Mandanten, einer widerrufenen Freigabe und des geteilten
  Abstimmungslinks.
  Konto-Profilbilder sind bewusst für jedes angemeldete Konto lesbar
  (Datenschutzerklärung §16).

## Härtung & Missbrauchsabwehr

- Security-Header + strikte CSP (`helmet`); Skripte nur self-hosted.
- Ratenbegrenzung global + strengere Limits für Login/Kontakt/Feedback.
- Eingabevalidierung (zod) auf Mutationsrouten; Honeypot im Kontaktformular.
- Per-Tenant-Quoten (Runden/Spiele/Tags, #139) begrenzen Missbrauch.
- Abhängigkeits-Updates via Dependabot (npm, GitHub Actions, Container-
  Basis-Image); CI (Tests, Lint, CodeQL, gitleaks).
- Lieferkette gepinnt: das Node-Basis-Image auf einen exakten Patch-Stand,
  jede fremde GitHub-Action auf einen Commit-SHA — ein Sicherheits-Update
  der Laufzeit kommt so als geprüfter Pull Request an, statt von einem
  Build-Cache abzuhängen, und ein umgehängtes Tag kann keinen fremden Code
  in die CI einschleusen.

## Datenminimierung & Protokollierung

- Request-Logs enthalten nur Methode/Pfad/Status/Dauer/IP — nie Bodies, Query-
  Strings, Header oder Cookies (`lib/observability.js`).
- Produkt-Ereignisse: nur Ereignisname + Tenant-Id (Allowlist, #261).
- Mail-Log: nur Betreff, nie Empfänger oder Inhalte (`lib/mail.js`, `lib/routes/account.js`; seit #878).

## Verfügbarkeit & Wiederherstellung

- Managed PostgreSQL (Railway) mit **zwei getrennten Sicherungsebenen**, beide
  seit dem 2026-08-04 eingerichtet:
  - **Point-in-Time-Recovery**: fortlaufende WAL-Archivierung; Wiederherstellung
    auf einen beliebigen Zeitpunkt innerhalb des Vorhaltefensters, und zwar in
    eine **neue** Datenbankinstanz (die laufende bleibt unberührt). Das Fenster
    umfasst **bis zu ca. 4 Wochen** (rollierend die letzten 4 wöchentlichen
    Vollsicherungen), ist plattformseitig **nicht konfigurierbar** und beginnt
    mit der Aktivierung am 2026-08-04 — rückwirkend darüber hinaus ist keine
    Wiederherstellung möglich. Am 2026-10-06 reichte der früheste
    Wiederherstellungspunkt bis 2026-09-08 zurück: Das Fenster rollt also
    tatsächlich und hält rund 4 Wochen. Maßgeblich für Löschfristen: `retention.md`.
  - **Tägliche Volume-Sicherungen** mit 6 Tagen Aufbewahrung, dazu manuelle
    Sicherungen auf Anforderung.
- Deployment reproduzierbar aus dem Repo (Dockerfile).
- **Objektspeicher (Cloudflare R2):** **keine** Sicherung und keine Replikation.
  Das ist eine **bewusst getroffene Entscheidung (Betreiber, 2026-11-12, #1743)**
  und kein offener Punkt mehr.
  - *Geprüft:* R2 bietet weder Objekt-Versionierung noch eine Replikation
    zwischen Buckets (beides laut S3-Kompatibilitätstabelle von Cloudflare nicht
    implementiert, Stand 2026-11-12). Eine Bucket-Sperre (Bucket Lock) auf dem
    Haupt-Bucket wurde verworfen: Eine unbefristete Sperre verhindert die
    Löschung nach Art. 17. Eine altersbasierte Sperre lässt die Löschungen der
    App selbst scheitern und hinterlässt Dateien, die die App für gelöscht hält.
    Die einzige tragfähige Variante, wöchentliche gesperrte Kopien in einem
    zweiten Bucket, wurde vorgeschlagen und nicht umgesetzt.
  - *Hingenommenes Risiko:* Ein Fehler im Löschpfad oder ein missbrauchter
    Schlüssel kann hochgeladene Cover, Session-Fotos und Profilbilder **unwiederbringlich**
    löschen. Die zugehörigen Datensätze in der Datenbank sind von den oben
    genannten Sicherungen abgedeckt. Verloren wären nur die Bilddateien, die
    Nutzer erneut hochladen können — ein Session-Foto allerdings nur, solange
    das Original noch auf ihrem Gerät liegt; das ist das Risiko, das #1774 dieser
    Abwägung hinzufügt. Über einen Anbieter verlinkte Cover liegen
    gar nicht in R2.
  - *Folge für Art. 17:* Eine gelöschte Bilddatei ist sofort endgültig weg. Für
    Uploads gibt es keinen Backup-Vorbehalt (`retention.md`).
  - *Neu zu bewerten*, sobald eines davon eintritt: ein erneutes Bekanntwerden
    eines Schlüssels mit Zugriff auf den Bucket (wie am 2026-10-22), ein
    tatsächlicher Verlust von Uploads, oder eine Änderung, durch die Nutzer auf
    die Verfügbarkeit ihrer Uploads einen Anspruch erhalten (etwa ein
    kostenpflichtiges Angebot). Ohne Anlass spätestens beim nächsten
    Legal-Audit (L-015).
- Health-Check (`/healthz`, ohne Datenbankzugriff) + Bereitschafts-Check
  (`/readyz`, prüft die Datenbank und antwortet 503, wenn sie nicht erreichbar
  ist — #462) + externes Uptime-Monitoring, das den Verantwortlichen alarmiert;
  Deploy-Status je Commit.

## Löschkonzept

- Löschungen wirken durchgängig: Spiel-/Runden-/Konto-Löschung entfernt
  abhängige Daten und Cover-Objekte (`.claude/rules/deletion-paths-must-free-cover-objects.md`).
- Betreiber-Werkzeuge für Art.-17-Fälle: Takedown, Kontolöschung mit Export,
  Text-Redaktion mit Nachweis-Log (#268/#273/#275).

## Organisatorisch

- Einzelbetreiber; Zugriff auf Produktionssysteme nur der Verantwortliche.
- Secrets nur in der Hosting-Umgebung, nie im Repo (`.claude/rules/no-reading-env-files.md`,
  gitleaks-CI).
- Agenten-Arbeitsregeln verbieten das Lesen von Produktionsdaten
  (`.claude/rules/no-reading-production-data.md`).
