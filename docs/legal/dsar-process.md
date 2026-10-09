# Prozess für Betroffenenanfragen (Art. 15–21 DSGVO)

Internal record (German). Requests arrive via the published e-mail address or
the contact form; answer within **one month** (Art. 12 Abs. 3).

**Stand:** 2026-10-09

## Eingang & Identitätsprüfung

- Kanäle: `IMPRESSUM_EMAIL`-Postfach, Kontaktformular (→ dasselbe Postfach),
  Briefpost über den Anschriften-Dienstleister.
- Identität wirtschaftlich prüfen: Anfragen zu einem Konto nur beantworten,
  wenn sie von der **registrierten Konto-E-Mail** kommen (oder die Person die
  Kontrolle darüber nachweist). Keine Ausweiskopien anfordern.
- Anfragen zu Daten, die ein *anderer* Nutzer eingetragen hat (z. B. ein
  Mitgliedsname in einer fremden Runde): Fall dokumentieren; ggf. über das
  Moderations-Panel prüfen/redigieren (#275) statt Daten Dritter offenzulegen.

## Auskunft & Export (Art. 15, 20)

- Betreiber-Panel → Konto suchen → **Export** (#273): liefert die gespeicherten
  Konto- und Rundendaten als maschinenlesbare Datei. Zusammen mit den Angaben
  der Datenschutzerklärung (Zwecke, Empfänger, Fristen) als Antwort senden.
- Das **Konto** steht darin seit 2026-10-04 **Feld für Feld vollständig**
  (`lib/account-export.js`): neben Adresse, Nutzername, Profilbild und
  Sperrstatus auch der BoardGameGeek-Nutzername, die Passkeys (Bezeichnung,
  Anlage- und letzter Nutzungszeitpunkt, Übertragungswege, Kennung und
  öffentlicher Schlüssel), beide Benachrichtigungs-Schalter samt Zeitpunkt der
  letzten Benachrichtigung, die Sichtbarkeit der Spielbilanz, der
  BG-Stats-Schalter, Design und Design-Auswahl, die bestätigte Fassung der
  Nutzungsbedingungen, der „Was ist neu"-Stand und eine ausstehende
  E-Mail-Änderung **samt der neuen Adresse**. Bis dahin lief der Export über die
  Projektion der Kontoliste und ließ rund ein Dutzend dieser Felder weg.
  Bewusst **nicht** enthalten ist Anmeldematerial: Passwort-Hash, die gehashten
  Bestätigungs-/Reset-Token, der Token-Hash der E-Mail-Änderung und die
  Sitzungen (Refresh-Token). `test/account-export-fields.test.js` verlangt für
  jedes gespeicherte Kontofeld entweder den Export oder einen benannten Grund
  für das Weglassen — ein neues Feld kann also nicht still herausfallen.
- Der Export enthält neben Konto und Runden auch die kontobezogenen Daten in den
  globalen Speichern (#397): **Freundschaften, Freundeskreis-Feed-Ereignisse,
  Postfach (Inbox), Einladungen, Runden-Freigaben (Grants) und — seit #680 —
  Preisalarme** — genau die
  Kategorien, die die Kontolöschung (Art. 17) ebenfalls entfernt. Auskunft und
  Löschung decken damit dieselben Datensätze ab — mit **einer bewussten
  Ausnahme**: die **Abstimmungslinks** (#652, VVT Zeile 19) werden bei der
  Kontolöschung mit entfernt, aber **nicht exportiert**. Ein Link-Datensatz
  enthält keine personenbezogenen Daten (nur die zufällige Kennung und die
  Session-Zuordnung), und er ist eine *lebende Berechtigung*: in einen Export
  geschrieben wäre er ein funktionierender Stimmzettel in einer Datei, die
  weitergereicht werden kann (`exportAccountData` in `lib/repo/json.js` bzw.
  `postgres.js` begründet das im Code). Auf eine Anfrage, die ausdrücklich nach
  den Links fragt, genügt die Auskunft über ihre Anzahl und Ablaufzeit.
  Dasselbe gilt aus demselben Grund für die **Einladungslinks** einer Runde
  (#1515, VVT Zeile 13): gelöscht mit dem Konto, nicht exportiert — ein
  exportierter Link wäre eine funktionierende Einladung in die Runden des Kontos.
- Feedback ist kontounabhängig gespeichert; nur bei angegebener E-Mail
  zuordenbar — dann mit exportieren.
- **Was der Export NICHT abdeckt — von Hand durchsuchen.** Drei Bestände auf
  Betreiberseite können Daten über die anfragende Person enthalten, tragen aber
  keine Konto-Id und sind deshalb nicht Teil des Exports:
  - **Gespeicherte Meldungen** (`contact_notices`, Panel-Karte „Meldungen",
    CSV-Export): nach der E-Mail-Adresse (als meldende Person) und nach dem
    Nutzernamen (als gemeldetes Konto) suchen.
  - **Moderations-Log** (`moderation_log`, Panel-Karte „Protokoll", Filter nach
    Mandant bzw. CSV-Export): Einträge zur Tenant-Id des Kontos, zur Konto-Id
    oder zur E-Mail-Adresse.
  - **Das Postfach** (`IMPRESSUM_EMAIL`/`CONTACT_TO`, auch der Ordner
    `Meldungen`): Korrespondenz von und über die Person.

  Fundstellen in Kopie oder Zusammenfassung beifügen — **mit einer
  Einschränkung**: ist die anfragende Person die **gemeldete**, werden Name und
  E-Mail-Adresse der **meldenden** Person nicht herausgegeben (Art. 15 Abs. 4
  DSGVO, Rechte Dritter; dieselbe Zusage wie im Bescheid-Muster in
  `notice-and-action.md`: „die Identität meldender Personen geben wir nicht
  weiter"). Mitzuteilen ist dann, *dass* eine Meldung vorlag, wann und mit
  welchem Inhalt, soweit er die Person betrifft.

## Berichtigung (Art. 16)

- Nutzer können fast alles selbst ändern (Namen, Titel, Tags, Bilder). Sonst
  gezielt über das Moderations-Panel oder auf Wunsch des Nutzers im Konto.
- **Die E-Mail-Adresse seit #1076 ebenfalls selbst** (Konto → „E-Mail-Adresse
  ändern“). Sie war die eine Ausnahme, weil sie zugleich Anmeldename und einziger
  Wiederherstellungsweg ist. Bestätigt wird über einen Link an die NEUE Adresse,
  die alte bleibt bis dahin aktiv — ein Tippfehler sperrt also niemanden aus. Ein
  operatorseitiges Werkzeug dafür gibt es weiterhin nicht: wer den Zugriff auf
  sein Postfach verloren hat, kommt über die Export-/Lösch-Wege im Panel.

## Löschung (Art. 17)

- Selbstbedienung: Spiele/Runden löschen wirkt durchgängig (inkl. Cover).
- **Ganzes Konto, durch die betroffene Person selbst (#419):** Kontoeinstellungen
  (`/konto`) → **„Konto löschen"**. Erfordert Nutzername + Passwort und zeigt
  vorher die tatsächlichen Zahlen (Runden, Spiele, Sessions, Bilder sowie die
  Zahl der Konten, die den Zugriff auf geteilte Runden verlieren). Wirkt sofort
  und vollständig — dieselbe Kaskade wie unten, nur ohne Betreiber. **Das ist
  seit #419 der Regelweg;** eine per Kontaktformular eingehende
  Löschungsaufforderung darf darauf verwiesen werden, muss aber weiterhin
  beantwortet und auf Wunsch betreiberseitig ausgeführt werden (Art. 12 Abs. 2
  DSGVO — die Ausübung darf nicht an eine bestimmte Form gebunden werden).
- Ganzes Konto, betreiberseitig: Betreiber-Panel → **Löschung** (#273; erfordert
  Bestätigung der Konto-E-Mail, exportiert vorher auf Wunsch). Bleibt für
  assistierte Fälle, DSA-Anlässe und Konten ohne Zugriff auf die eigene
  Anmeldung. Entfernt Konto, Runden, Bilder und macht Tokens ungültig.
- Das Moderations-Log behält in beiden Fällen nur den Nachweis ohne
  Personendaten — betreiberseitig als `user_erased`, per Selbstbedienung als
  `account_deleted` (beide dauerhaft, siehe `retention.md`).
- Einzelne Inhalte auf Zuruf: Takedown/Redaktion über das Panel (#268/#275).

## Einschränkung & Widerspruch (Art. 18, 21)

- Einzelfall dokumentieren; praktikable Umsetzung hier: Konto sperren
  (Suspend) statt löschen, bis der Fall geklärt ist.

## Beschwerderecht

- In jeder Antwort auf das Beschwerderecht bei einer Aufsichtsbehörde
  (Art. 77) hinweisen — steht auch in der Datenschutzerklärung.
