# Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO)

Internal record — kept in German because it addresses a German supervisory
authority. Companion to the published privacy policy (`lib/legal.js`, #134);
update both together when a data flow changes.

**Verantwortlicher:** Julian Zenker (Anschrift: die als `IMPRESSUM_ADDRESS`
konfigurierte Empfangsanschrift; E-Mail: `IMPRESSUM_EMAIL`). Kein Vertreter,
kein Datenschutzbeauftragter (nicht benannt; keine Pflicht nach § 38 BDSG —
keine 20 Personen, kein besonderes Risiko).

**Stand:** 2026-08-07

| # | Verarbeitung | Kategorien betroffener Personen | Datenkategorien | Zweck | Rechtsgrundlage | Empfänger / Auftragsverarbeiter | Drittland | Löschfrist |
|---|---|---|---|---|---|---|---|---|
| 1 | Server-Request-Logs | Alle Besucher | IP, Methode, Pfad, Status, Dauer | Sicherer Betrieb, Missbrauchserkennung, Ratenbegrenzung | Art. 6 (1) f | Railway Corp. (Hosting, AVV + SCC) | USA (EU-Region; SCC) | kurzfristig (Plattform-Logrotation) |
| 2 | Konten (Registrierung/Login) | Registrierte Nutzer | E-Mail, frei gewählter dienstweit eindeutiger Nutzername (#320), Registrierungszeitpunkt, Passwort-Hash (Argon2id), gehashte Verifikations-/Reset-/Refresh-Token, **Passkeys** (#418: je Passkey Anmeldedaten-Kennung, öffentlicher Schlüssel, Signaturzähler, gemeldete Übertragungswege, selbst vergebene Bezeichnung, Anlage- und letzter Nutzungszeitpunkt — **keine biometrischen Daten**: der private Schlüssel und Fingerabdruck/Gesicht verbleiben auf dem Gerät bzw. im Passwortmanager), Sperrstatus, zuletzt bestätigte Fassung der Nutzungsbedingungen (#521/#591 — bei der Registrierung gesetzt, beim Bestätigen des Änderungshinweises fortgeschrieben) | Kontoverwaltung, Authentifizierung | Art. 6 (1) b | Railway (DB). Seit #558 sind **Nutzername und Registrierungsmonat** zusätzlich anderen **angemeldeten** Konten auf dem Kontoprofil (`/u/:username`) sichtbar — E-Mail-Adresse, Runden-/Spieldaten und Sperrstatus **nicht**; kein Zugriff für nicht angemeldete Besucher oder Suchmaschinen | USA (EU-Region; SCC) | bis Kontolöschung — seit #419 vom Nutzer selbst in den Kontoeinstellungen auslösbar (sofortige Kaskade), alternativ betreiberseitig (#273); es bleibt nur der Löschnachweis nach Zeile 10 |
| 3 | Runden-/Spieldaten | Nutzer + von ihnen eingetragene Mitglieder | Rundennamen, Spieltitel, Namen der zu einem Spiel eingetragenen Erweiterungen (#653), Mitgliedsnamen, Gästenamen (nur zu einer Session eingetragene Personen, #458), Stimmen/Bewertungen, Tags, Aktivitäten | Kernfunktion des Dienstes | Art. 6 (1) b | Railway (DB) | USA (EU-Region; SCC) | bis Löschung durch Nutzer / Kontolöschung |
| 4 | Hochgeladene Cover-Bilder | Nutzer | Bilddateien | Kernfunktion | Art. 6 (1) b | Cloudflare, Inc. (R2, AVV; DPF-zertifiziert) | USA (DPF/SCC) | bis Löschung des Spiels/Kontos |
| 5 | Transaktions-E-Mails | Registrierte Nutzer, Kontaktformular-Nutzer | Empfänger-Adresse, Betreff, Inhalt | Verifikation, Passwort-Reset, Kontakt-Zustellung, Hinweise auf Postfach-Einträge (Zeile 18) | Art. 6 (1) b | Heinlein Hosting GmbH (mailbox.org), Berlin (AVV, s. Zeile 6) — **kein gesonderter Versanddienstleister** | nein (DE) | Versandprotokolle des Anbieters |
| 6 | Kontaktformular / E-Mail-Kontakt | Absender **und ggf. gemeldete Dritte** | Nachricht, optional E-Mail/Name/Betreff (E-Mail seit #321 bei jeder Kategorie freiwillig); bei Meldungen Kategorie, gemeldete URL, optional Nutzername des gemeldeten Kontos (#320), Richtigkeitserklärung (#272) | Bearbeitung von Anfragen; DSA Notice-and-Action (Eingangs-Nachweis, Art. 16) | Art. 6 (1) b/f | Betreiber-Postfach bei Heinlein Hosting GmbH (mailbox.org, AVV) — Ein- **und** Ausgang, inkl. Eingangs-/Entscheidungs-Mails, Railway (DB — gespeicherte Meldungen, #272) | USA (EU-Region; SCC) für die DB-Kopie, sonst nein (DE/EU) | bis Abschluss der Bearbeitung; DSA-Meldungen 3 Jahre (`retention.md`) — gilt für Postfach und DB-Kopie |
| 7 | In-App-Feedback (über das Kontaktformular, #321) | Nutzer (anonym, E-Mail optional) | Nachricht, optional E-Mail, App-Bereich, Sprache (keine Tenant-Id — Formular ist ohne Anmeldung erreichbar) | Produktverbesserung | Art. 6 (1) f | Railway (DB) | USA (EU-Region; SCC) | nach Bearbeitung gelöscht |
| 8 | Produkt-Ereignisse (Logs) | Nutzer (nur Tenant-Id) | Ereignisname + Tenant-Id, keine Inhalte | Nutzungsüberblick ohne Analytics | Art. 6 (1) f | Railway (Logs) | USA (EU-Region; SCC) | wie Zeile 1 |
| 9 | Anbieter-Cover (Hotlinking) | Besucher, deren Runde Cover verknüpft hat | IP + Browser-Header (durch den Browser des Besuchers) | Anzeige verknüpfter Cover ohne eigene Vervielfältigung | Art. 6 (1) f | Sony, Valve, Nintendo, Microsoft, BoardGameGeek (eigene Verantwortliche, keine AV). **Seit #744 lassen sich Cover nur noch über BoardGameGeek NEU verknüpfen**; die vier übrigen bleiben Empfänger, weil früher verknüpfte Cover unverändert von dort geladen werden — die Empfängerliste schrumpft dadurch nicht | USA/Japan | keine Speicherung bei uns |
| 10 | Moderation/Betreiber-Panel | Nutzer im Einzelfall | Konto-/Inhaltsdaten des Einzelfalls, Moderations-Log (Löschnachweise ohne E-Mail-Adresse; bei ersetzten Nutzernamen der vorherige Name als Nachweis, #320) | Missbrauchsbekämpfung, Art.-17-Nachweis | Art. 6 (1) c/f | Railway (DB) | USA (EU-Region; SCC) | Log-Einträge mit Personendaten: 3 Jahre ab Jahresende (`retention.md`); Löschnachweise (ohne E-Mail) dauerhaft; Inhalte gem. Maßnahme |
| 11 | Post an die Empfangsanschrift | Absender von Briefpost | Absenderdaten, Briefinhalt | Erreichbarkeit unter ladungsfähiger Anschrift (Impressum, förmliche Zustellungen) | Art. 6 (1) c/f | ZERODOX — Christian Jahnke, Koblenz (Entgegennahme, Öffnung, Digitalisierung; **eigenständiger Verantwortlicher**, keine AV — siehe Hinweise; gewöhnliche private Briefpost wird nicht angenommen und geht an den Absender zurück) | nein (DE) | Scans bei uns: bis Abschluss der Bearbeitung; Originale beim Dienstleister 4 Wochen, dann Vernichtung (dessen AGB § 6 (5)) |
| 12 | Spenden (Unterstützungs-Link, #173) | Spender | Im Ko-fi-Dashboard einsehbar: Name/Anzeigename, optional Nachricht und E-Mail-Adresse; Zahlungsdaten verbleiben bei Ko-fi/Stripe/PayPal und erreichen uns nie | Nachvollziehen von Spenden, ggf. Dank | Art. 6 (1) f | Ko-fi Labs Ltd. (London, UK), Stripe Payments Europe Ltd. (Irland), PayPal (Europe) S.à r.l. et Cie, S.C.A. (Luxemburg) — **eigenständige Verantwortliche**, keine AV (siehe Hinweise); die App überträgt selbst nichts (reiner Klick-Link) | UK (Angemessenheitsbeschluss) | Dashboard-Daten beim Anbieter gem. dessen Regime; eigene Aufzeichnungen: solange steuerlich erforderlich |
| 13 | Runden-Freigaben (Einladungen + Zugriffsrechte, #207) | Einladendes + eingeladenes Konto | Einladung (einladendes/eingeladenes Konto, betroffene Runde, vorgesehener Mitglieds-Platz, Status), nach Annahme die Zugriffsberechtigung; Zustellung als Postfach-Eintrag (Nutzername des Einladenden). Angesprochen wird nur über den öffentlichen Nutzernamen (#320), keine E-Mail-Offenlegung | Geteilte Runden: mehrere Konten an einer Runde zusammenarbeiten lassen | Art. 6 (1) b | Railway (DB). Die Runde wird **ausschließlich den eingeladenen Konten** zugänglich (keine Veröffentlichung gegenüber der Allgemeinheit) | USA (EU-Region; SCC) | Einladung bis Annahme/Ablehnung; Zugriffsrecht bis Widerruf oder Löschung der Runde/des Kontos |
| 14 | Freundschaften + Freundeskreis-Feed (#325) | Anfragendes + angefragtes/befreundetes Konto | Freundschaftsbeziehung (beide Konten + Status); Feed-Ereignisse (nur **Spieltitel** + optionales Cover, zugeordnet zum handelnden Konto) — **keine** Mitgliedsnamen, Bewertungen, Stimmen oder Rundennamen. Angesprochen wird nur über den öffentlichen Nutzernamen (#320). Eine Freundschaft gibt **keinen** Zugriff auf Runden | Sozialer Freundeskreis: Freunde sehen *dass* (nicht *was in* einer Runde) gespielt wird | Art. 6 (1) b | Railway (DB). Feed-Ereignisse sind **ausschließlich den ausdrücklich bestätigten Freunden** zugänglich (keine Veröffentlichung gegenüber der Allgemeinheit), und nur ab Beginn der Freundschaft | USA (EU-Region; SCC) | Freundschaft/Feed bis Beenden der Freundschaft bzw. Kontolöschung; Feed pro Konto gekappt (älteste werden verdrängt) |
| 15 | Verknüpfter BoardGameGeek-Nutzername (#481) | Registriertes Konto | Der vom Nutzer selbst eingetragene BGG-Nutzername (freiwillig, jederzeit im Konto löschbar). **Keine** BGG-Zugangsdaten, kein OAuth-Token — ein Nutzername genügt für den Abruf | Auf Anforderung des Nutzers dessen dort als „im Besitz“ markierte Sammlung abrufen, um sie in ein Regal zu übernehmen | Art. 6 (1) b | Railway (DB) für die Speicherung; **BoardGameGeek (Geekdo, LLC)** als Empfänger beim Abruf — bereits Empfänger aus Zeile 9 (Cover-Hotlinking) bzw. der Titelsuche. Der Abruf erfolgt **serverseitig**; der Browser des Nutzers nimmt keine Verbindung auf, es wird ausschließlich der Nutzername übermittelt | USA (EU-Region; SCC) für die DB; USA für den Abruf bei BGG | bis der Nutzer die Verknüpfung entfernt oder das Konto gelöscht wird |
| 16 | Gast-Demo ohne Registrierung (#427) | Besucher ohne Konto | Automatisch erzeugtes Wegwerf-Konto: zufälliger Kontoname + synthetische, nicht zustellbare Platzhalter-Adresse (`…@demo.invalid`), **keine** E-Mail-Adresse, **kein** Passwort, keine Identitätsdaten. Dazu die vom Besucher während der Demo selbst eingegebenen Inhalte (wie Zeile 3) | Den Dienst vor der Registrierung ausprobierbar machen | Art. 6 (1) b (vorvertraglich, auf Anfrage der betroffenen Person) | Railway (DB); keine zusätzlichen Empfänger | USA (EU-Region; SCC) | **automatische vollständige Löschung nach spätestens 24 h** (`DEMO_TTL_HOURS`) durch einen Hintergrundjob, einschließlich aller Runden und hochgeladenen Bilder; keine Übernahme in ein späteres Konto; zusätzlich jederzeit sofortige Selbstlöschung über „Demo beenden" (#502) |
| 17 | Missbrauchsbegrenzung der Gast-Demo (#502) | Besucher ohne Konto | **Gehashte IP-Adresse** des Demo-Starts (HMAC-SHA-256 mit `SESSION_SECRET`); die IP-Adresse selbst wird **nicht** gespeichert. Keine Wiedererkennung, keine Profilbildung, keine Verknüpfung mehrerer Besuche — der Wert dient ausschließlich als Zähler „wie viele Demos hält dieser Anschluss gerade" | Verhindern, dass einzelne Besucher den Demo-Pool belegen und die Demo dadurch für alle anderen unbenutzbar machen | Art. 6 (1) f (berechtigtes Interesse an missbrauchssicherem Betrieb) | Railway (DB); keine zusätzlichen Empfänger | USA (EU-Region; SCC) | Löschung **gemeinsam mit dem Demo-Konto**, also spätestens nach 24 h — kein eigener Aufbewahrungslauf, kein separater Reaper |
| 18 | Benachrichtigungs-E-Mails zu Postfach-Einträgen (#618) | Registrierte Nutzer | Zwei Ein/Aus-Schalter am Konto (Runden-Einladung, Freundschaftsanfrage) und der Zeitpunkt der letzten Benachrichtigung (für die Begrenzung auf eine Nachricht je Stunde). Die E-Mail selbst nennt nur die Art der Anfrage und den **öffentlichen Nutzernamen** des Absenders — **keinen Rundennamen**, keine Mitgliedsnamen, keine Inhalte | Zustellung von Anfragen, die eine Entscheidung des Empfängers verlangen (Einladung in eine Runde #207, Freundschaftsanfrage #325), an jemanden, der die App gerade nicht geöffnet hat | Art. 6 (1) b (transaktional, kein Newsletter und keine Werbung i. S. d. § 7 UWG — die Nachricht betrifft eine Anfrage, die der Empfänger beantworten muss; die typgenaue Abschaltbarkeit ist Teil dessen) | Heinlein Hosting GmbH (mailbox.org), Berlin — **kein zusätzlicher Empfänger**, identisch mit Zeile 5 | nein (DE) | Schalter und Zeitstempel bis Kontolöschung; keine gesonderte Protokollierung der Versendungen über die Zeile-5-Versandprotokolle hinaus |
| 19 | Abstimmungs-Link ohne Konto (#652) | Teilnehmende einer Session (Mitglieder + Gäste), Empfänger des Links (ohne Konto) | Gespeichert wird ausschließlich eine **zufällige, nicht erratbare Kennung** (192 Bit) und ihre Zuordnung zu genau einer Session (Mandant, Runde, Session) — **keine** Daten über den Link-Empfänger, kein Konto, keine IP, keine Wiedererkennung. Über den Link **offengelegt** werden Rundenname, ausgeloste Spieltitel und die **Namen der Teilnehmenden dieser Session**; **nicht** offengelegt werden abgegebene Bewertungen, das Ergebnis sowie alle weiteren Runden-, Mitglieds- und Kontodaten | Abstimmung über mehrere Geräte auch für Personen ohne Konto — die Registrierungspflicht war die praktische Hürde der Geräte-Abstimmung (#209/#612) | Art. 6 (1) b | Railway (DB). Empfänger sind die von der Runde **selbst ausgewählten** Personen, an die sie den Link weitergibt; der Link wird von uns nicht veröffentlicht, nicht verlinkt und nicht für Suchmaschinen zugänglich gemacht (keine Veröffentlichung gegenüber der Allgemeinheit) | USA (EU-Region; SCC) | mit dem Ende der Abstimmung bzw. beim Abbrechen/Löschen der Session oder der Runde; ebenso bei Kontolöschung (`eraseAccount`) — **und spätestens 30 Tage nach dem Erzeugen** (`VOTE_LINK_TTL_DAYS`, Höchstfrist per Sweep), da eine nie geschlossene Session keinen der ereignisgesteuerten Löschpfade erreicht |
| 20 | Übergabe einer Partie an BG Stats (#485) | Teilnehmende einer beendeten Session (Mitglieder + Gäste) | Bei uns gespeichert wird ausschließlich **ein Ein/Aus-Schalter am Konto** (standardmäßig aus). Übermittelt wird — erst beim Antippen des Links, **direkt vom Gerät des Nutzers** — der Spieltitel, Abschlusszeitpunkt, eine Session-Kennung sowie die **Namen der Teilnehmenden** und die Angabe, wer gewonnen hat; **keine** Bewertungen, Punkte, Rundennamen oder Kontodaten | Die Spielhistorie der Runde in das Werkzeug übernehmen können, in dem die Gruppe ihre Partien ohnehin führt (Interoperabilität, Datenhoheit) | Art. 6 (1) f (berechtigtes Interesse an Zusammenarbeit mit anderen Werkzeugen); der Schalter selbst Art. 6 (1) b | Anbieter von **BG Stats** (bgstatsapp.com) — **eigenständiger Verantwortlicher**, keine AV (siehe Hinweise); die App bettet nichts ein und überträgt selbst nichts (reiner Klick-Link). Hat der Nutzer dort sein BoardGameGeek-Konto verbunden, kann BG Stats die Partie zusätzlich dorthin übertragen | unbekannt — die Übermittlung erfolgt durch den Nutzer selbst von seinem Gerät aus; wir sind insoweit nicht Exporteur | Schalter bis Kontolöschung; über die übermittelte Partie entscheidet der Nutzer in BG Stats nach dessen Regime |
| 21 | Preisabruf für ein Spiel auf der Wunschliste (#679) | — (keine betroffenen Personen) | **Keine personenbezogenen Daten.** Übermittelt werden ausschließlich die Kennung des Spiels beim Anbieter (BGG-Id), Zielland, Währung und die im Dienst gewählte Sprache. Die Antwort liegt für höchstens eine Stunde im Arbeitsspeicher-Cache des Prozesses; seit #688 wird zusätzlich **der zuletzt abgerufene Preis** in der Datenbank abgelegt (Tabelle `last_prices`, je Spiel/Zielland/Währung/Ausgabe genau eine Zeile, bei jedem erfolgreichen Abruf überschrieben), damit bei einem Ausfall des Anbieters weiter ein — als alt gekennzeichneter — Preis angezeigt werden kann. Die Zeile enthält **die Kennung des Spiels und den Preis, sonst nichts**: keine Nutzer-, Konto-, Runden- oder Mandanten-Kennung, kein Personenbezug, keine Preishistorie | Den aktuellen Preis eines Spiels anzeigen, das die Runde noch nicht besitzt | — (mangels Personenbezug keine Rechtsgrundlage erforderlich; die Anzeige selbst ist Teil der Vertragserfüllung, Art. 6 (1) b) | **BoardGamePrices / Brettspielpreise.de** — **kein Empfänger i. S. d. Art. 4 Nr. 9**, da nichts Personenbezogenes übermittelt wird; folglich auch keine AV und kein AVV. (Die zweite Preisquelle, Valve/Steam, entfiel mit #744.) Der Abruf erfolgt **serverseitig**; der Browser des Nutzers nimmt keine Verbindung auf | entfällt (keine Übermittlung personenbezogener Daten) | entfällt (keine personenbezogenen Daten gespeichert; die Preiszeile selbst wird nach 7 Tagen automatisch gelöscht, `retention.md`) |

**Hinweise**

- **Zeile 21 ist bewusst als Nicht-Verarbeitung dokumentiert (#679).** Ein
  Preisabruf überträgt nur die Kennung eines Spiels, also kein personenbezogenes
  Datum — die Zeile gehört streng genommen nicht in ein Art.-30-Verzeichnis. Sie
  steht hier, damit die Prüfung nicht bei jeder Änderung an der Funktion erneut
  geführt werden muss, und damit auffällt, falls sich das ändert: **sobald ein
  Preisabruf etwas über den Nutzer mitschickt** (eine Postleitzahl für die
  Versandkosten, eine Kennung zur Wiedererkennung, ein Affiliate-Parameter, der
  den Klick zuordenbar macht), wird daraus eine echte Verarbeitung mit Empfänger,
  Rechtsgrundlage und Drittlandfrage — und Abschnitt 8 der
  Datenschutzerklärung wird unrichtig. Affiliate-Verknüpfungen sind aus genau
  diesem Grund (und aus § 5a Abs. 4 UWG) dauerhaft ausgeschlossen.
- **#688 hat daran nichts geändert, obwohl jetzt gespeichert wird.** Die
  Einordnung als Nicht-Verarbeitung hängt am **Inhalt** der Zeile, nicht daran,
  ob überhaupt etwas abgelegt wird: gespeichert werden die Kennung eines
  öffentlich vertriebenen Spiels und dessen Preis. Der Schlüssel ist bewusst der
  Cache-Schlüssel der Preisquelle (Anbieter, Spiel-Id, Zielland, Währung,
  Ausgabe) und enthält **keine** Nutzer-, Konto-, Runden- oder
  Mandanten-Kennung; die Tabelle ist global und ohne `tenant_id`, weil ein Preis
  eine öffentliche Tatsache über ein Spiel ist. Damit lässt sich aus der Zeile
  weder ablesen, **wer** den Preis abgerufen hat, noch **wessen** Wunschliste
  das Spiel steht. **Sobald das nicht mehr stimmt** — etwa wenn der Schlüssel
  eine Konto- oder Mandanten-Kennung aufnähme, oder wenn Preisverläufe je Nutzer
  entstünden — ist die Einordnung neu zu treffen.
- **Kein Tracking im E-Mail-Versand (#440).** System-E-Mails enthalten keine
  Zählpixel, keine Öffnungs- oder Klickmessung und keine umgeschriebenen Links.
  Der Versand läuft seit 2026-07-25 über das Betreiber-Postfach (SMTP) statt
  über einen Transaktions-Dienstleister; ein Postfach-Anbieter kann solche
  Messungen gar nicht einfügen — es gibt keine abschaltbare Funktion. Der zuvor
  eingesetzte Anbieter (Brevo) maß bauartbedingt und ohne Abschaltmöglichkeit;
  diese Verarbeitung entfällt ersatzlos.
- **Zeile 5 hat keinen eigenen Auftragsverarbeiter mehr (#440).** Der frühere
  Versanddienstleister ist entfallen; Ein- und Ausgang laufen über denselben
  Anbieter wie Zeile 6. Wird künftig wieder ein Transaktions-Dienstleister
  eingesetzt, ist er hier **und** in Abschnitt 9 der Datenschutzerklärung
  aufzunehmen.

- Auftragsverarbeitungsverträge — **alle drei wirksam** (Stand 2026-07-25,
  #219/#440): Railway (railway.com/legal/dpa, inkl. SCC; per Self-Service-DocuSign
  **gezeichnet 2026-07-24**), Cloudflare (Customer DPA; EU-US Data Privacy
  Framework — kraft Einbeziehung in die Self-Serve Subscription Agreement
  wirksam),
  Heinlein Hosting GmbH / mailbox.org (Betreiber-Postfach **und seit #440 auch
  der Versand**; **AVV
  abgeschlossen 2026-07-21**, Verarbeitung vertraglich ausschließlich EU/EWR,
  Subunternehmer nur deutsche Rechenzentrums-Infrastruktur — #307). Zwei sind
  aktiv gezeichnet (Railway, Heinlein), eines kraft Einbeziehung in die
  akzeptierten Vertragswerke wirksam (Cloudflare). Die eigenen
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
- **BG Stats** (Zeile 20) ist aus demselben Grund **eigenständiger
  Verantwortlicher**: Die App bettet nichts ein und überträgt nichts; der Nutzer
  aktiviert den Link erst selbst am Konto und tippt ihn dann selbst an, sodass
  die Übermittlung von seinem Gerät ausgeht. Ein AVV ist weder nötig noch von
  diesem Anbieter erhältlich. Weil die Übermittlung Namen **Dritter** (Gäste,
  andere Mitglieder) enthält, weisen Datenschutzerklärung und Kontoeinstellung
  ausdrücklich darauf hin.
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
