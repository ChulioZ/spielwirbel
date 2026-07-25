# Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO)

Internal record — kept in German because it addresses a German supervisory
authority. Companion to the published privacy policy (`lib/legal.js`, #134);
update both together when a data flow changes.

**Verantwortlicher:** Julian Zenker (Anschrift: die als `IMPRESSUM_ADDRESS`
konfigurierte Empfangsanschrift; E-Mail: `IMPRESSUM_EMAIL`). Kein Vertreter,
kein Datenschutzbeauftragter (nicht benannt; keine Pflicht nach § 38 BDSG —
keine 20 Personen, kein besonderes Risiko).

**Stand:** 2026-07-25

| # | Verarbeitung | Kategorien betroffener Personen | Datenkategorien | Zweck | Rechtsgrundlage | Empfänger / Auftragsverarbeiter | Drittland | Löschfrist |
|---|---|---|---|---|---|---|---|---|
| 1 | Server-Request-Logs | Alle Besucher | IP, Methode, Pfad, Status, Dauer | Sicherer Betrieb, Missbrauchserkennung, Ratenbegrenzung | Art. 6 (1) f | Railway Corp. (Hosting, AVV + SCC) | USA (EU-Region; SCC) | kurzfristig (Plattform-Logrotation) |
| 2 | Konten (Registrierung/Login) | Registrierte Nutzer | E-Mail, frei gewählter dienstweit eindeutiger Nutzername (#320), Passwort-Hash (Argon2id), gehashte Verifikations-/Reset-/Refresh-Token, Sperrstatus | Kontoverwaltung, Authentifizierung | Art. 6 (1) b | Railway (DB) | USA (EU-Region; SCC) | bis Kontolöschung |
| 3 | Runden-/Spieldaten | Nutzer + von ihnen eingetragene Mitglieder | Rundennamen, Spieltitel, Mitgliedsnamen, Stimmen/Bewertungen, Tags, Aktivitäten | Kernfunktion des Dienstes | Art. 6 (1) b | Railway (DB) | USA (EU-Region; SCC) | bis Löschung durch Nutzer / Kontolöschung |
| 4 | Hochgeladene Cover-Bilder | Nutzer | Bilddateien | Kernfunktion | Art. 6 (1) b | Cloudflare, Inc. (R2, AVV; DPF-zertifiziert) | USA (DPF/SCC) | bis Löschung des Spiels/Kontos |
| 5 | Transaktions-E-Mails | Registrierte Nutzer, Kontaktformular-Nutzer | Empfänger-Adresse, Betreff, Inhalt | Verifikation, Passwort-Reset, Kontakt-Zustellung | Art. 6 (1) b | Scaleway SAS, Paris (AVV; Server in Frankreich) | nein (EU) | Versandprotokolle des Anbieters |
| 6 | Kontaktformular / E-Mail-Kontakt | Absender **und ggf. gemeldete Dritte** | Nachricht, optional E-Mail/Name/Betreff (E-Mail seit #321 bei jeder Kategorie freiwillig); bei Meldungen Kategorie, gemeldete URL, optional Nutzername des gemeldeten Kontos (#320), Richtigkeitserklärung (#272) | Bearbeitung von Anfragen; DSA Notice-and-Action (Eingangs-Nachweis, Art. 16) | Art. 6 (1) b/f | Scaleway (Zustellung + Eingangs-/Entscheidungs-Mails), Betreiber-Postfach bei Heinlein Hosting GmbH (mailbox.org, AVV), Railway (DB — gespeicherte Meldungen, #272) | USA (EU-Region; SCC) für die DB-Kopie, sonst nein (DE/EU) | bis Abschluss der Bearbeitung; DSA-Meldungen 3 Jahre (`retention.md`) — gilt für Postfach und DB-Kopie |
| 7 | In-App-Feedback (über das Kontaktformular, #321) | Nutzer (anonym, E-Mail optional) | Nachricht, optional E-Mail, App-Bereich, Sprache (keine Tenant-Id — Formular ist ohne Anmeldung erreichbar) | Produktverbesserung | Art. 6 (1) f | Railway (DB) | USA (EU-Region; SCC) | nach Bearbeitung gelöscht |
| 8 | Produkt-Ereignisse (Logs) | Nutzer (nur Tenant-Id) | Ereignisname + Tenant-Id, keine Inhalte | Nutzungsüberblick ohne Analytics | Art. 6 (1) f | Railway (Logs) | USA (EU-Region; SCC) | wie Zeile 1 |
| 9 | Anbieter-Cover (Hotlinking) | Besucher, deren Runde Cover verknüpft hat | IP + Browser-Header (durch den Browser des Besuchers) | Anzeige verknüpfter Cover ohne eigene Vervielfältigung | Art. 6 (1) f | Sony, Valve, Nintendo, Microsoft, BoardGameGeek (eigene Verantwortliche, keine AV) | USA/Japan | keine Speicherung bei uns |
| 10 | Moderation/Betreiber-Panel | Nutzer im Einzelfall | Konto-/Inhaltsdaten des Einzelfalls, Moderations-Log (Löschnachweise ohne E-Mail-Adresse; bei ersetzten Nutzernamen der vorherige Name als Nachweis, #320) | Missbrauchsbekämpfung, Art.-17-Nachweis | Art. 6 (1) c/f | Railway (DB) | USA (EU-Region; SCC) | Log-Einträge mit Personendaten: 3 Jahre ab Jahresende (`retention.md`); Löschnachweise (ohne E-Mail) dauerhaft; Inhalte gem. Maßnahme |
| 11 | Post an die Empfangsanschrift | Absender von Briefpost | Absenderdaten, Briefinhalt | Erreichbarkeit unter ladungsfähiger Anschrift (Impressum, förmliche Zustellungen) | Art. 6 (1) c/f | ZERODOX — Christian Jahnke, Koblenz (Entgegennahme, Öffnung, Digitalisierung; **eigenständiger Verantwortlicher**, keine AV — siehe Hinweise; gewöhnliche private Briefpost wird nicht angenommen und geht an den Absender zurück) | nein (DE) | Scans bei uns: bis Abschluss der Bearbeitung; Originale beim Dienstleister 4 Wochen, dann Vernichtung (dessen AGB § 6 (5)) |
| 12 | Spenden (Unterstützungs-Link, #173) | Spender | Im Ko-fi-Dashboard einsehbar: Name/Anzeigename, optional Nachricht und E-Mail-Adresse; Zahlungsdaten verbleiben bei Ko-fi/Stripe/PayPal und erreichen uns nie | Nachvollziehen von Spenden, ggf. Dank | Art. 6 (1) f | Ko-fi Labs Ltd. (London, UK), Stripe Payments Europe Ltd. (Irland), PayPal (Europe) S.à r.l. et Cie, S.C.A. (Luxemburg) — **eigenständige Verantwortliche**, keine AV (siehe Hinweise); die App überträgt selbst nichts (reiner Klick-Link) | UK (Angemessenheitsbeschluss) | Dashboard-Daten beim Anbieter gem. dessen Regime; eigene Aufzeichnungen: solange steuerlich erforderlich |
| 13 | Runden-Freigaben (Einladungen + Zugriffsrechte, #207) | Einladendes + eingeladenes Konto | Einladung (einladendes/eingeladenes Konto, betroffene Runde, vorgesehener Mitglieds-Platz, Status), nach Annahme die Zugriffsberechtigung; Zustellung als Postfach-Eintrag (Nutzername des Einladenden). Angesprochen wird nur über den öffentlichen Nutzernamen (#320), keine E-Mail-Offenlegung | Geteilte Runden: mehrere Konten an einer Runde zusammenarbeiten lassen | Art. 6 (1) b | Railway (DB). Die Runde wird **ausschließlich den eingeladenen Konten** zugänglich (keine Veröffentlichung gegenüber der Allgemeinheit) | USA (EU-Region; SCC) | Einladung bis Annahme/Ablehnung; Zugriffsrecht bis Widerruf oder Löschung der Runde/des Kontos |
| 14 | Freundschaften + Freundeskreis-Feed (#325) | Anfragendes + angefragtes/befreundetes Konto | Freundschaftsbeziehung (beide Konten + Status); Feed-Ereignisse (nur **Spieltitel** + optionales Cover, zugeordnet zum handelnden Konto) — **keine** Mitgliedsnamen, Bewertungen, Stimmen oder Rundennamen. Angesprochen wird nur über den öffentlichen Nutzernamen (#320). Eine Freundschaft gibt **keinen** Zugriff auf Runden | Sozialer Freundeskreis: Freunde sehen *dass* (nicht *was in* einer Runde) gespielt wird | Art. 6 (1) b | Railway (DB). Feed-Ereignisse sind **ausschließlich den ausdrücklich bestätigten Freunden** zugänglich (keine Veröffentlichung gegenüber der Allgemeinheit), und nur ab Beginn der Freundschaft | USA (EU-Region; SCC) | Freundschaft/Feed bis Beenden der Freundschaft bzw. Kontolöschung; Feed pro Konto gekappt (älteste werden verdrängt) |

**Hinweise**

- **Kein Tracking im E-Mail-Versand (#440).** Der Versanddienstleister setzt
  keine Zählpixel, misst keine Öffnungen oder Klicks und schreibt keine Links
  um. Der bis 2026-07-25 eingesetzte Anbieter (Brevo) tat dies bauartbedingt
  und ohne Abschaltmöglichkeit; die Verarbeitung entfällt mit dem Wechsel
  ersatzlos und ist daher in Zeile 5 nicht mehr zu führen.

- Auftragsverarbeitungsverträge — **drei wirksam, eines (Scaleway) in Klärung**
  (Stand 2026-07-25, #219/#440): Railway (railway.com/legal/dpa, inkl. SCC; per Self-Service-DocuSign
  **gezeichnet 2026-07-24**), Cloudflare (Customer DPA; EU-US Data Privacy
  Framework — kraft Einbeziehung in die Self-Serve Subscription Agreement
  wirksam), Scaleway SAS (Data Processing Agreement, veröffentlicht unter
  scaleway.com/en/contracts/ als eigenes Dokument neben den General Terms of
  Services — Versand seit #440, zuvor Brevo/Sendinblue; **Wirksamwerden noch zu
  bestätigen**: zu prüfen ist, ob das DPA kraft Einbeziehung in die akzeptierten
  Nutzungsbedingungen gilt oder aktiv zu zeichnen ist. Bis zur Klärung nicht als
  aktiv gezeichnet zählen),
  Heinlein Hosting GmbH / mailbox.org (Betreiber-Postfach; **AVV
  abgeschlossen 2026-07-21**, Verarbeitung vertraglich ausschließlich EU/EWR,
  Subunternehmer nur deutsche Rechenzentrums-Infrastruktur — #307). Zwei sind
  aktiv gezeichnet (Railway, Heinlein), zwei kraft Einbeziehung in die
  akzeptierten Vertragswerke wirksam (Cloudflare); Scaleway siehe oben. Die eigenen
  Nachweiskopien (AVV/SCC, Subunternehmer-Listen, TOMs, Zertifikate, bei
  Cloudflare der DPF-Nachweis) liegen beim Verantwortlichen.
- Der Anschriften-Dienstleister **ZERODOX (Christian Jahnke), Koblenz**
  schließt bewusst **keinen AVV**: Er ordnet sich für die Postbearbeitung
  schriftlich (E-Mail vom 2026-07-21, beim Betreiber dokumentiert) als
  **eigenständiger Verantwortlicher** ein — vergleichbar einem
  Postdienstleister, mit eigenen Rechtsgrundlagen (Art. 6 DSGVO), eigenem
  Aufbewahrungs- und Löschregime und eigener Datenschutzerklärung
  (zerodox.de/datenschutz); für seine eigenen Dienstleister setzt er seinerseits
  AVV nach Art. 28 ein. Die Einordnung ist vertretbar, aber nicht unumstritten
  (die DSK zählt Dokumenten-Scannen zu den typischen AV-Beispielen); das
  Einordnungsrisiko liegt primär beim Dienstleister. ZERODOX wird deshalb als
  **Empfänger** (eigenständiger Verantwortlicher) geführt, nicht als
  Auftragsverarbeiter.
- Die Spenden-Plattformen (Zeile 12: Ko-fi, Stripe, PayPal) sind — wie die
  Cover-Anbieter in Zeile 9 — **eigenständige Verantwortliche**, keine
  Auftragsverarbeiter: Die App bettet nichts ein und überträgt nichts; der
  Besucher öffnet den Spenden-Link selbst, und die Spende kommt als Vertrag
  zwischen Spender und Plattform bzw. Zahlungsdienstleister zustande. Ein AVV
  ist daher weder nötig noch von diesen Anbietern erhältlich.
- Es findet **kein** Tracking, keine Analyse, keine Werbung und kein Verkauf
  von Daten statt; es gibt keine automatisierte Einzelentscheidung (Art. 22).
- Löschfristen und Prüf-Rhythmus im Detail: `retention.md`; das
  Notice-and-Action-Verfahren (DSA Art. 16/17) samt Begründungs-Vorlagen:
  `notice-and-action.md` (beide #140).
- Eine Datenschutz-Folgenabschätzung (Art. 35) ist nicht erforderlich: keine
  umfangreiche Verarbeitung besonderer Kategorien, kein systematisches
  Monitoring; Umfang und Risiko sind gering.
