'use strict';

/*
 * Legal pages (issue #134 + #140): the DDG Impressum, the DSGVO privacy policy
 * and the Nutzungsbedingungen (terms of use / DSA content rules),
 * server-rendered so the operator's postal address and contact e-mail come from
 * env at REQUEST time (IMPRESSUM_ADDRESS / IMPRESSUM_EMAIL — see the runtime
 * gate in /api/config, lib/app.js). No placeholder identity ever lives in the
 * repo: while either var is unset the routes 404 and the footer links stay
 * hidden, so a half-configured instance publishes nothing.
 *
 * Content rules (issue #134's completion bar — keep them when editing):
 *  - Every processing purpose described here must be traceable to a real data
 *    flow in this repo. Nothing described that the app does not do; when a
 *    data flow changes, this text changes in the same PR. The 2026-07-21
 *    adversarial pass caught real drift (feedback tenant-id, product events,
 *    provider search, SWR cache) — that bar is what keeps this text honest.
 *  - German is the authoritative text; the English section is a courtesy
 *    translation and says so.
 *  - NO link to the EU ODR platform — it was shut down 2025-07-20 (Reg. (EU)
 *    2024/3228); linking it today is itself misleading (§ 5 UWG risk).
 *  - Cite § 5 DDG (in force 2024-05-14, replacing § 5 TMG) and § 25 TDDDG —
 *    never the old TMG/TTDSG names.
 *
 * The operator's NAME is hardcoded (it is public in LICENSE, #171); only the
 * address and e-mail are env-driven, because they don't exist until the rented
 * service address / mailbox (#307) are in place.
 */

const OPERATOR_NAME = 'Julian Zenker';

// The date shown as "Stand" on each document. One constant PER document, not one
// shared one (#521): the terms revision is what the in-app change notice keys
// off, so a typo fix in the Impressum under a shared constant would re-notify
// every user about terms that did not change — and a banner people learn to
// dismiss unread destroys the only channel Nutzungsbedingungen §11 has.
//
// Bump the one whose content you changed (.claude/rules/keep-legal-docs-current.md).
const IMPRESSUM_REVISION = '2026-07-29';
const PRIVACY_REVISION = '2026-08-05';
const TERMS_REVISION = '2026-07-29';

// The terms revision that was live when `acceptedTermsRevision` was introduced
// (#521). An account without that key registered under this text, so it is up to
// date today and will correctly fall behind on the next terms change.
//
// NEVER replace this with TERMS_REVISION. The fallback would then track the
// current value forever, so accounts predating #521 would be permanently silent
// — the notice would never fire for exactly the users who have been here longest.
// Same footgun family as the `Date.parse(x || 0)` default in
// .claude/rules/mail-sending-endpoints-need-a-per-account-cooldown.md: the wrong
// default gives a plausible answer today and the wrong one later.
const LEGACY_TERMS_REVISION = '2026-07-29';

// The two values the terms-change notice (#521) compares, resolved together so
// no caller re-implements the fallback. A user with no `acceptedTermsRevision`
// registered under the text live at rollout, so they read as up to date today
// and fall behind on the next bump — see LEGACY_TERMS_REVISION above.
//
// It lives here rather than in the route because that keeps the whole decision
// in the one module that owns the constants: a test can load a patched copy of
// this file with TERMS_REVISION moved on and assert the notice actually fires,
// which is impossible while all three revisions hold the same date.
function termsAcceptanceOf(user) {
  return {
    acceptedTermsRevision: (user && user.acceptedTermsRevision) || LEGACY_TERMS_REVISION,
    termsRevision: TERMS_REVISION,
  };
}

// There is deliberately no `termsChangedFor(user)` helper here. The comparison
// belongs to the CLIENT (setupTermsBanner, public/js/account.js) — the server
// never needs the answer, it only supplies the two values — so a server-side
// predicate would be production code with no production caller.

// What changed in each revision of the Nutzungsbedingungen, newest FIRST (#521).
// Rendered as the „Änderungshistorie" section, which is what the change notice
// links to — telling somebody "the terms changed" and handing them 1000 lines of
// unchanged text is not informing them.
//
// It is INFORMATIONAL, never part of the contract: the body is the binding text,
// and the rendered section says so. An ambiguity between a summary and the
// clause it describes would be construed against us (§ 305c Abs. 2 BGB), so a
// summary must never state a rule the body does not.
//
// Empty today because the terms have not changed since the notice mechanism
// shipped — deliberately NOT seeded with a fake "initial version" entry.
// `test/legal.test.js` enforces the invariant that keeps it honest: once
// TERMS_REVISION moves off LEGACY_TERMS_REVISION, this must be non-empty and its
// newest entry must name the current revision. So bumping the constant without
// saying what changed fails the suite.
//
// Keep it trimmed to roughly the last five entries — it sits inside the document
// and must not come to dwarf the terms themselves.
const TERMS_CHANGELOG = [
  // { revision: '2026-08-15',
  //   de: 'Kurz, was sich geändert hat.',
  //   en: 'Briefly what changed.' },
];

// One localized „Änderungshistorie" block, or '' when there is nothing to show.
// Rendering nothing is the right empty state: a heading over an empty list reads
// as a broken page, and the notice cannot fire before the first entry exists.
function renderTermsChangelog(lang) {
  if (!TERMS_CHANGELOG.length) return '';
  const t = lang === 'en'
    ? { head: 'Change history', note: 'This overview is provided for information only and is not part of the contract. The binding text is the version published above.' }
    : { head: 'Änderungshistorie', note: 'Diese Übersicht dient ausschließlich der Information und ist nicht Vertragsbestandteil. Verbindlich ist die jeweils oben veröffentlichte Fassung.' };
  const items = TERMS_CHANGELOG
    .map((e) => `<li><strong>${esc(e.revision)}</strong> — ${esc(lang === 'en' ? e.en : e.de)}</li>`)
    .join('\n');
  // The id is the notice's link target (/nutzungsbedingungen#aenderungen), so it
  // is the same in both languages on purpose — one anchor, whatever the reader's
  // locale, because the client builds that href without knowing the language.
  return `
<h2 id="${lang === 'en' ? 'changes-en' : 'aenderungen'}">${t.head}</h2>
<p class="meta">${t.note}</p>
<ul>
${items}
</ul>`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Both vars must be non-blank for the pages (and the site footer, which also
// requires working mail — lib/app.js) to exist at all.
function impressumAddress() { return (process.env.IMPRESSUM_ADDRESS || '').trim(); }
function impressumEmail() { return (process.env.IMPRESSUM_EMAIL || '').trim(); }
function legalConfigured() { return impressumAddress() !== '' && impressumEmail() !== ''; }

// The address env var may carry real newlines (Railway supports multi-line
// values) or literal "\n" sequences (a plain .env line) — render both as line
// breaks, after escaping.
function renderAddress(raw) {
  return esc(raw).replace(/\\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).join('<br>');
}

// Combine the operator name with the postal address as one `name<br>addr`
// block, WITHOUT doubling the name. A *ladungsfähige Anschrift* served through
// a receiving service (the ZERODOX / anschrift.net "c/o" format, #388) must
// carry the addressee's name, so IMPRESSUM_ADDRESS already leads with it —
// prepending OPERATOR_NAME on top then prints it twice. So: when the address'
// first line already equals OPERATOR_NAME (trimmed, case-insensitive), render
// the address alone; otherwise (a plain street/city value a self-hoster sets)
// prepend the name. Both cases show the name exactly once. Reused by all four
// identity blocks in the Impressum and privacy policy.
function nameAndAddress(raw) {
  const addr = renderAddress(raw);
  const firstLine = String(raw).replace(/\\n/g, '\n').split('\n')
    .map((l) => l.trim()).filter(Boolean)[0] || '';
  const leadsWithName = firstLine.toLowerCase() === OPERATOR_NAME.trim().toLowerCase();
  return leadsWithName ? addr : `${esc(OPERATOR_NAME)}<br>${addr}`;
}

// Shared document shell: a plain, readable, script-free page. Inline styles are
// allowed by the CSP (style-src 'unsafe-inline'); scripts are deliberately
// absent — a legal page must render with nothing but HTML. The English half is
// wrapped in lang="en" so assistive tech switches pronunciation.
function layout(title, deHtml, enHtml) {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} · Spielwirbel</title>
  <link rel="icon" href="/icons/icon-192.png" sizes="192x192" type="image/png" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0 auto;
      max-width: 760px;
      padding: 2.5rem 1.5rem 4rem;
      background: #faf8f5;
      color: #26221c;
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
    }
    h1 { font-size: 1.7rem; margin: 0 0 0.3rem; }
    h2 { font-size: 1.2rem; margin: 2rem 0 0.5rem; }
    p, li { font-size: 0.97rem; }
    a { color: #c2410c; }
    .meta { color: #6b6257; font-size: 0.88rem; margin-bottom: 2rem; }
    .lang-note { background: #f1ede6; border-radius: 10px; padding: 0.7rem 1rem; font-size: 0.9rem; }
    .highlight { border: 1px solid #d9d1c3; border-left: 4px solid #c2410c; border-radius: 8px; padding: 0.7rem 1rem; }
    hr.split { margin: 3rem 0; border: 0; border-top: 2px solid #e4ded4; }
    .foot { margin-top: 3rem; font-size: 0.9rem; color: #6b6257; }
  </style>
</head>
<body>
${deHtml}
<hr class="split" id="en">
<div lang="en">
${enHtml}
</div>
<p class="foot"><a href="/">← Spielwirbel</a> · <a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a> · <a href="/nutzungsbedingungen">Nutzungsbedingungen</a> · <a href="/kontakt.html">Kontakt</a></p>
</body>
</html>`;
}

/* ------------------------------------------------------------------------- *
 * Impressum (§ 5 DDG)
 * ------------------------------------------------------------------------- */

function renderImpressum() {
  const nameAddr = nameAndAddress(impressumAddress());
  const mail = esc(impressumEmail());
  const de = `
<h1>Impressum</h1>
<p class="meta">Stand: ${IMPRESSUM_REVISION} · <a href="#en">English version below</a></p>

<h2>Angaben gemäß § 5 DDG</h2>
<p>${nameAddr}</p>

<h2>Kontakt</h2>
<p>E-Mail: <a href="mailto:${mail}">${mail}</a><br>
Für eine schnelle elektronische Kontaktaufnahme steht außerdem das
<a href="/kontakt.html">Kontaktformular</a> zur Verfügung.</p>

<h2>Hinweise</h2>
<p>Spielwirbel ist ein privat betriebener, unentgeltlicher Dienst. Eine
Umsatzsteuer-Identifikationsnummer besteht nicht; ein Handelsregistereintrag
besteht nicht.</p>
<p>Meldungen zu rechtswidrigen Inhalten (Notice-and-Action) können über das
<a href="/kontakt.html">Kontaktformular</a> oder per E-Mail an die oben genannte
Adresse gerichtet werden.</p>`;

  const en = `
<h1>Legal notice (Impressum)</h1>
<p class="lang-note">Courtesy translation — the German version above is
authoritative.</p>

<h2>Information pursuant to § 5 DDG (German Digital Services Act)</h2>
<p>${nameAddr}</p>

<h2>Contact</h2>
<p>E-mail: <a href="mailto:${mail}">${mail}</a><br>
For fast electronic contact you can also use the
<a href="/kontakt.html">contact form</a>.</p>

<h2>Notes</h2>
<p>Spielwirbel is a privately operated, free service. There is no VAT
identification number and no commercial-register entry.</p>
<p>Reports of allegedly illegal content (notice and action) can be submitted via
the <a href="/kontakt.html">contact form</a> or by e-mail to the address
above.</p>`;

  return layout('Impressum', de, en);
}

/* ------------------------------------------------------------------------- *
 * Datenschutzerklärung (DSGVO) — derived from the app's actual data flows.
 * ------------------------------------------------------------------------- */

function renderDatenschutz() {
  const nameAddr = nameAndAddress(impressumAddress());
  const mail = esc(impressumEmail());
  const de = `
<h1>Datenschutzerklärung</h1>
<p class="meta">Stand: ${PRIVACY_REVISION} · <a href="#en">English version below</a></p>

<h2>1. Verantwortlicher</h2>
<p>${nameAddr}<br>
E-Mail: <a href="mailto:${mail}">${mail}</a></p>
<p>Post an die genannte Anschrift wird durch einen Empfangsdienstleister
entgegengenommen und an den Verantwortlichen weitergeleitet. Ein
Datenschutzbeauftragter ist nicht benannt (keine gesetzliche Pflicht).</p>

<h2>2. Das Wichtigste in Kürze</h2>
<ul>
  <li>Spielwirbel setzt <strong>kein Tracking, keine Analyse-Tools und keine
  Werbung</strong> ein.</li>
  <li>Es werden nur Cookies und lokale Speicherung verwendet, die für den
  Betrieb <strong>unbedingt erforderlich</strong> sind (Anmeldung,
  Spracheinstellung, lokaler Daten-Cache) — deshalb gibt es keinen
  Cookie-Banner (§ 25 Abs. 2 TDDDG).</li>
  <li>Schriftarten und alle Skripte werden <strong>selbst gehostet</strong>;
  beim normalen Aufruf der Seite werden keine Inhalte von Dritten geladen. Die
  eine Ausnahme sind von dir verknüpfte Spiele-Cover externer Anbieter
  (Abschnitt 7).</li>
  <li>Alle Daten werden über <strong>TLS (HTTPS)</strong> übertragen; Anwendung
  und Datenbank laufen in einem <strong>EU-Rechenzentrum</strong>, hochgeladene
  Bilder liegen bei Cloudflare (Abschnitt 6).</li>
</ul>

<h2>3. Hosting, Server-Logs und Datenbank</h2>
<p>Die Anwendung läuft bei <strong>Railway Corp.</strong> (USA) in einer
Rechenzentrums-Region in der EU; dort werden auch die Datenbank (PostgreSQL)
und die Anwendungs-Logs betrieben. Mit Railway besteht ein
Auftragsverarbeitungsvertrag (Art. 28 DSGVO) einschließlich
EU-Standardvertragsklauseln für den Fall eines Zugriffs aus einem Drittland
(Art. 46 Abs. 2 lit. c DSGVO).</p>
<p>Beim Aufruf des Dienstes verarbeitet der Server pro Anfrage technisch:
<strong>IP-Adresse, HTTP-Methode, Pfad, Statuscode und Bearbeitungsdauer</strong>.
Anfrageinhalte (Formulardaten, Suchbegriffe, Cookies) werden bewusst
<strong>nicht</strong> protokolliert. Zusätzlich protokollieren wir
<strong>pseudonyme Nutzungsereignisse</strong> — die Art einer Aktion (z. B.
„Runde angelegt“) zusammen mit der Konto-/Mandanten-Kennung, nie Inhalte — um
die Nutzung des Dienstes in Grundzügen zu verstehen. Bei schweren Fehlern kann,
sofern konfiguriert, eine Benachrichtigung (Zeitpunkt, Pfad, Fehlermeldung —
keine Inhalte, keine IP-Adresse) an einen Messaging-Dienst des Betreibers
gesendet werden. Zweck ist der sichere und stabile Betrieb (Fehlersuche,
Missbrauchs- und Angriffserkennung, Ratenbegrenzung); Rechtsgrundlage ist unser
berechtigtes Interesse an einem sicheren Betrieb (Art. 6 Abs. 1 lit. f DSGVO).
Die Logs unterliegen der automatischen Aufbewahrungsgrenze der
Hosting-Plattform und werden nicht mit anderen Daten zusammengeführt.</p>

<h2>4. Konto und Registrierung</h2>
<p>Wenn du ein Konto anlegst, verarbeiten wir deine
<strong>E-Mail-Adresse</strong>, einen von dir frei gewählten
<strong>Nutzernamen</strong> und ein <strong>Passwort</strong>, das
ausschließlich als moderner Hash (Argon2id) gespeichert wird — im Klartext wird
es zu keinem Zeitpunkt gespeichert. Zur Bestätigung der E-Mail-Adresse und für
das Zurücksetzen des Passworts werden kurzlebige Token erzeugt (ebenfalls nur
gehasht gespeichert) und dir per E-Mail zugesandt. Rechtsgrundlage ist die
Durchführung des Nutzungsverhältnisses (Art. 6 Abs. 1 lit. b DSGVO).</p>
<p>Der <strong>Nutzername</strong> ist das Kennzeichen deines Kontos innerhalb
des Dienstes. Er existiert, damit dein Konto ansprechbar und in einer Meldung
benennbar ist, <em>ohne</em> dass dafür deine E-Mail-Adresse offengelegt werden
muss. Er ist dienstweit eindeutig, wird so gespeichert, wie du ihn schreibst,
und ist derzeit nach der Registrierung nicht selbst änderbar. Du wählst ihn
frei — wenn dir daran liegt, nicht identifizierbar zu sein, wähle einen Namen,
der keine Rückschlüsse auf dich zulässt; deinen echten Namen verlangen wir
nicht. Ist ein Nutzername selbst rechtswidrig (etwa eine Beleidigung oder eine
Identitätsanmaßung), ersetzen wir ihn durch eine neutrale Bezeichnung und
halten den vorherigen Namen als Nachweis im Aktionsprotokoll fest
(Abschnitt 13).</p>
<p>Optional kannst du deinen <strong>BoardGameGeek-Nutzernamen</strong> in
deinem Konto hinterlegen. Er ist freiwillig, wird genau so gespeichert, wie du
ihn einträgst, und dient ausschließlich einem Zweck: auf deine Anforderung hin
deine dort als „im Besitz“ markierte Spielesammlung abzurufen, damit du sie in
ein Regal übernehmen kannst. Der Abruf erfolgt serverseitig durch uns; dein
Browser nimmt dabei keine Verbindung zu BoardGameGeek auf. Wir übermitteln
dabei ausschließlich diesen Nutzernamen. Du kannst die Verknüpfung jederzeit in
deinen Kontoeinstellungen entfernen; danach ist der Name gelöscht.
Rechtsgrundlage ist die Durchführung des Nutzungsverhältnisses (Art. 6 Abs. 1
lit. b DSGVO).</p>
<p>Lädt dich jemand <strong>zu einer Runde ein</strong> oder schickt dir eine
<strong>Freundschaftsanfrage</strong>, benachrichtigen wir dich zusätzlich zum
Postfach in der App per <strong>E-Mail an die Adresse deines Kontos</strong>.
Diese Nachrichten betreffen ausschließlich Anfragen, die eine Entscheidung von
dir verlangen — es gibt weder Werbung noch Newsletter, und über die Aktivität
deiner Freunde schreiben wir dir nicht. Pro Empfänger versenden wir höchstens
eine solche Nachricht je Stunde; treffen in dieser Zeit mehrere Anfragen ein,
fassen wir sie zu einer einzigen Nachricht zusammen, die nur ihre Anzahl nennt.
Beide Arten kannst du in deinen Kontoeinstellungen einzeln abschalten; der Link
dorthin steht in jeder dieser E-Mails. Rechtsgrundlage ist die Durchführung des
Nutzungsverhältnisses (Art. 6 Abs. 1 lit. b DSGVO). Ein zusätzlicher Empfänger
entsteht dadurch nicht — der Versand läuft über denselben Anbieter wie die
Bestätigungs- und Passwort-E-Mails (Abschnitt 9).</p>
<p>Kontodaten werden gespeichert, bis das Konto gelöscht wird. Die Löschung
kannst du <strong>jederzeit selbst in deinen Kontoeinstellungen vornehmen</strong>
(„Konto löschen“) — dafür bestätigst du deinen Nutzernamen und dein Passwort,
und wir zeigen dir vorher an, was genau gelöscht wird. Sie wirkt sofort und
umfasst sämtliche Daten des Kontos einschließlich aller Runden und hochgeladenen
Bilder; eine Wiederherstellung ist danach nicht möglich. Alternativ kannst du
die Löschung weiterhin formlos über die oben genannten Kontaktwege verlangen.
Bestehen bleibt in beiden Fällen nur ein minimaler Nachweis des Löschvorgangs
ohne E-Mail-Adresse (Abschnitt 13).</p>

<p>Der Dienst bietet eine <strong>Demo ohne Registrierung</strong> an. Startest
du sie, legen wir automatisch ein <strong>Wegwerf-Konto</strong> mit
Beispielinhalten an. Dieses Konto hat <strong>keine E-Mail-Adresse und kein
Passwort</strong>: Wir fragen bei der Demo keine personenbezogenen Daten von dir
ab und können dich darüber auch nicht identifizieren. Gespeichert werden nur ein
zufällig erzeugter Kontoname und die Inhalte, die du während der Demo selbst
eingibst. Das Konto wird <strong>nach spätestens 24 Stunden automatisch
vollständig gelöscht</strong>, samt aller darin angelegten Runden und
hochgeladenen Bilder; ein Wiederherstellen ist nicht möglich. Du kannst die Demo
auch jederzeit selbst über „Demo beenden" im Kontomenü sofort löschen.
Registrierst du dich anschließend, entsteht ein neues, leeres Konto — die
Demo-Inhalte werden nicht übernommen. Rechtsgrundlage ist die Durchführung des
vorvertraglichen Nutzungsverhältnisses auf deine Anfrage hin (Art. 6 Abs. 1
lit. b DSGVO).</p>

<p>Damit nicht einzelne Besucher beliebig viele Demo-Konten gleichzeitig
belegen und die Demo dadurch für alle anderen blockieren, speichern wir zu einem
Demo-Konto zusätzlich einen <strong>kryptographischen Hashwert deiner
IP-Adresse</strong> (HMAC-SHA-256 mit einem geheimen Schlüssel). Die IP-Adresse
selbst wird dabei <strong>nicht</strong> gespeichert, und der Hashwert dient
ausschließlich dazu, die Anzahl gleichzeitig offener Demos pro Anschluss zu
begrenzen — er wird nicht zur Wiedererkennung, zur Profilbildung oder zur
Zuordnung mehrerer Besuche verwendet. Er wird mit dem Demo-Konto zusammen
gelöscht, also spätestens nach 24 Stunden. Rechtsgrundlage ist unser
berechtigtes Interesse an einem missbrauchssicheren Betrieb des Angebots
(Art. 6 Abs. 1 lit. f DSGVO).</p>

<p>Zum Fortsetzen einer laufenden Demo legt der Browser zusätzlich eine Kennung
im lokalen Speicher (<em>localStorage</em>) deines Geräts ab — technisch
erforderlich für die von dir angeforderte Funktion und daher ohne Einwilligung
zulässig (§ 25 Abs. 2 Nr. 2 TDDDG); Näheres in Abschnitt 14.</p>

<h2>5. Runden- und Spieldaten</h2>
<p>Der Zweck des Dienstes ist die Verwaltung von Spielrunden. Dazu speichern
wir die eingegebenen Inhalte: <strong>Rundennamen, Spieltitel, Mitgliedsnamen,
Gästenamen, Bewertungen/Stimmen, Schlagworte (Tags), eine Aktivitäten-Chronik
sowie hochgeladene Cover-Bilder</strong>. Mitglieds- und Gästenamen sind frei
wählbar — wer echte Namen dritter Personen einträgt, sollte deren Einverständnis
haben. Ein <strong>Gast</strong> ist eine Person, die nur zu einer einzelnen
Session eingetragen wird: der Name gehört dauerhaft zum Protokoll dieser
Session, die Person wird aber kein Mitglied der Runde.
Rechtsgrundlage ist die Bereitstellung des Dienstes (Art. 6 Abs. 1 lit. b
DSGVO). Diese Daten sind grundsätzlich nur innerhalb deines eigenen Kontos
(Mandanten) sichtbar und bleiben gespeichert, bis sie von dir oder mit dem Konto
gelöscht werden. <strong>Teilst du eine Runde</strong> durch Einladung eines
anderen Kontos (siehe nächster Absatz), kann das eingeladene Konto die Inhalte
genau dieser Runde sehen und bearbeiten.</p>
<p>Wenn du ein anderes Konto zu einer Runde einlädst, speichern wir die
<strong>Einladung</strong> (einladendes und eingeladenes Konto, die betroffene
Runde und der vorgesehene Mitglieds-Platz) sowie – nach Annahme – die
<strong>Zugriffsberechtigung</strong> für diese Runde. Angesprochen wird
ausschließlich über den öffentlichen Nutzernamen; eine E-Mail-Adresse wird dabei
nicht offengelegt. Die Einladung erscheint im Postfach des eingeladenen Kontos
innerhalb des Dienstes. Eine Runde wird dadurch nur den ausdrücklich
eingeladenen Konten zugänglich – es findet keine Veröffentlichung gegenüber der
Allgemeinheit statt. Rechtsgrundlage ist die Bereitstellung des Dienstes
(Art. 6 Abs. 1 lit. b DSGVO).</p>
<p>Läuft in einer Runde eine <strong>Abstimmung über mehrere Geräte</strong>,
kann dafür ein <strong>Abstimmungs-Link</strong> erzeugt und von euch selbst
weitergegeben werden (etwa im Gruppenchat), damit auch Personen
<strong>ohne Konto</strong> vom eigenen Gerät abstimmen können. Gespeichert wird
dazu nur eine zufällige, nicht erratbare Kennung und die Zuordnung zu genau
dieser einen Session. Wer den Link hat, sieht ausschließlich den
<strong>Rundennamen</strong>, die <strong>ausgelosten Spiele</strong> und die
<strong>Namen der Teilnehmenden dieser Session</strong> und kann eine Stimme
abgeben — <strong>keine bereits abgegebenen Bewertungen</strong>, kein Ergebnis
und keine weiteren Runden-, Mitglieds- oder Kontodaten. Wer den Link bekommt,
entscheidet ihr: er wird von uns nirgends veröffentlicht, verlinkt oder für
Suchmaschinen zugänglich gemacht. Mit dem Ende der Abstimmung — ebenso beim
Abbrechen oder Löschen der Session oder der Runde — verliert er seine Gültigkeit
und wird gelöscht. Rechtsgrundlage ist die Bereitstellung des Dienstes
(Art. 6 Abs. 1 lit. b DSGVO).</p>
<p>Konten können sich außerdem <strong>befreunden</strong> (Freundeskreis). Du
sendest dazu eine Anfrage an einen öffentlichen Nutzernamen; wir speichern die
<strong>Freundschaftsbeziehung</strong> (anfragendes und angefragtes Konto sowie
den Status). Nach Annahme sehen befreundete Konten in ihrem
<strong>Freundeskreis-Feed</strong> kurze Hinweise auf Aktivitäten des jeweils
anderen – ausschließlich den <strong>Spieltitel</strong> (und, falls vorhanden,
dessen Cover-Bild), wenn du ein Spiel ins Regal stellst oder eine Session
abschließt. Dabei werden <strong>keine</strong> Mitgliedsnamen, Bewertungen,
Stimmen oder Rundennamen offengelegt, und nur Ereignisse, die nach Beginn der
Freundschaft entstehen. Eine Freundschaft gewährt <strong>keinen</strong>
Zugriff auf Runden. Das Beenden einer Freundschaft ist einseitig und wirkt
sofort in beide Richtungen. Diese Sichtbarkeit besteht nur gegenüber deinen
ausdrücklich bestätigten Freunden – es findet keine Veröffentlichung gegenüber
der Allgemeinheit statt. Rechtsgrundlage ist die Bereitstellung des Dienstes
(Art. 6 Abs. 1 lit. b DSGVO).</p>
<p>Jedes Konto hat innerhalb des Dienstes ein <strong>Profil</strong>, das unter
seinem Nutzernamen erreichbar ist. Angemeldete Konten sehen dort den
<strong>Nutzernamen</strong>, ein daraus automatisch erzeugtes Farbsymbol und den
<strong>Monat der Registrierung</strong> („Mitglied seit“) sowie den Stand einer
etwaigen Freundschaftsanfrage zwischen euch. Der Freundeskreis-Feed des Kontos
ist dort nur sichtbar, wenn ihr befreundet seid, und unterliegt denselben
Einschränkungen wie im vorigen Absatz. Weitere Daten – insbesondere deine
E-Mail-Adresse, Runden, Spiele, Sessions und Bewertungen – werden auf dem Profil
<strong>nicht</strong> angezeigt. Das Profil setzt eine Anmeldung voraus; es ist
für nicht angemeldete Besucher und für Suchmaschinen nicht zugänglich.
Rechtsgrundlage ist die Bereitstellung des Dienstes (Art. 6 Abs. 1 lit. b
DSGVO).</p>

<h2>6. Hochgeladene Bilder</h2>
<p>Selbst hochgeladene Cover-Bilder werden in einem S3-kompatiblen
Objektspeicher bei <strong>Cloudflare, Inc.</strong> (USA) abgelegt und
ausschließlich über unseren Server ausgeliefert (kein öffentlicher
Bucket-Zugriff). Rechtsgrundlage ist die Bereitstellung des Dienstes
(Art. 6 Abs. 1 lit. b DSGVO). Mit Cloudflare besteht ein
Auftragsverarbeitungsvertrag; Cloudflare ist unter dem <strong>EU-US Data
Privacy Framework</strong> zertifiziert (Art. 45 DSGVO), ergänzend gelten
Standardvertragsklauseln.</p>

<h2>7. Spiele-Cover externer Anbieter (Hotlinking)</h2>
<p>Beim Anlegen eines Spiels kannst du ein offizielles Cover eines
Spiele-Anbieters verknüpfen. Solche Cover werden <strong>nicht von uns
kopiert</strong>, sondern von deinem Browser direkt beim jeweiligen Anbieter
geladen. Dabei erhält der Anbieter deine <strong>IP-Adresse</strong> und die
üblichen Browser-Angaben — so, als hättest du dessen Website selbst
aufgerufen. Mögliche Anbieter (abhängig davon, welche Cover in deiner Runde
verknüpft sind):</p>
<ul>
  <li>Sony Interactive Entertainment — <code>image.api.playstation.com</code> / <code>playstation.net</code></li>
  <li>Valve Corporation (Steam) — <code>steamstatic.com</code></li>
  <li>Nintendo — <code>nintendo.com</code></li>
  <li>Microsoft (Xbox) — <code>s-microsoft.com</code></li>
  <li>BoardGameGeek — <code>geekdo-images.com</code></li>
</ul>
<p>Diese Anbieter sitzen teilweise in Drittländern (insbesondere USA und
Japan); auf deren Verarbeitung haben wir keinen Einfluss. Rechtsgrundlage ist
unser berechtigtes Interesse, verknüpfte Cover anzuzeigen, ohne urheberrechtlich
geschützte Bilder selbst zu vervielfältigen (Art. 6 Abs. 1 lit. f DSGVO). Wer
das nicht möchte, kann Spiele ohne Anbieter-Cover anlegen oder eigene Bilder
hochladen.</p>

<h2>8. Suchanfragen an Spiele-Anbieter (Titel-Suche)</h2>
<p>Die Titel-Suche beim Anlegen eines Spiels fragt die Kataloge der oben
genannten Anbieter ab. Diese Anfragen stellt <strong>unser Server</strong> —
übermittelt werden nur der eingegebene Suchbegriff und die im Dienst gewählte
Sprache (für passend lokalisierte Titel und Store-Links), nie deine IP-Adresse
oder andere Daten über dich.</p>

<h2>9. E-Mail-Versand</h2>
<p>System-E-Mails (Bestätigung der E-Mail-Adresse, Passwort-Zurücksetzen,
Benachrichtigung über eine Passwort-Änderung, Kontaktformular-Zustellung,
Hinweise auf Einladungen und Freundschaftsanfragen (Abschnitt 4) sowie
Eingangsbestätigungen und Entscheidungen zu
Meldungen) versenden wir über das Postfach des Betreibers bei der
<strong>Heinlein Hosting GmbH (mailbox.org), Berlin</strong> — also über
denselben deutschen Anbieter, der auch die eingehende Post entgegennimmt
(Abschnitt 10) und mit dem ein Auftragsverarbeitungsvertrag besteht.
Verarbeitet werden dabei Empfänger-Adresse, Betreff und Inhalt der jeweiligen
E-Mail (Art. 6 Abs. 1 lit. b DSGVO). Ein gesonderter Versanddienstleister ist
nicht eingeschaltet.</p>
<p>Diese E-Mails enthalten <strong>keine Zählpixel, keine Öffnungs- oder
Klickmessung und keine umgeschriebenen Links</strong>. Ob und wann du eine
System-E-Mail öffnest, erfahren wir nicht; die Links darin führen direkt zu
dieser Anwendung und nicht über einen Dritten.</p>

<h2>10. Kontaktformular, E-Mail und Post</h2>
<p>Nutzt du das <a href="/kontakt.html">Kontaktformular</a>, verarbeiten wir
deine Angaben (Nachricht sowie – jeweils freiwillig – E-Mail-Adresse, Name und
Betreff), um die Anfrage zu beantworten (Art. 6 Abs. 1 lit. b bzw. f DSGVO). Die
E-Mail-Adresse ist bei jeder Kategorie freiwillig; ohne sie können wir dir
allerdings nicht antworten. Bei einer Meldung
rechtswidriger Inhalte kommen die dafür erforderlichen Angaben hinzu:
Kategorie, gemeldete Adresse (URL), gegebenenfalls der <strong>Nutzername des
gemeldeten Kontos</strong> und deine Richtigkeitserklärung (Art. 16 Abs. 2
DSA). Der gemeldete Nutzername betrifft eine dritte Person; wir verarbeiten ihn
ausschließlich, um die Meldung prüfen und bearbeiten zu können. Die Nachricht wird
uns per E-Mail über mailbox.org zugestellt und im Postfach des Betreibers gespeichert,
solange es für die Bearbeitung erforderlich ist. Dasselbe gilt für direkte
E-Mails an die oben genannte Adresse. Über das Formular eingereichte
Nachrichten und Meldungen speichern wir zusätzlich in unserer Datenbank
(Abschnitt 3), damit Eingang und Bearbeitung von Meldungen nachweisbar bleiben
— es gelten dieselben Fristen wie für das Postfach. Meldungen rechtswidriger
Inhalte (Abschnitt 13) und unsere Antworten darauf bewahren wir zum Nachweis
drei Jahre ab Ende des Jahres der Entscheidung auf. Das Betreiber-Postfach liegt bei
<strong>Heinlein Hosting GmbH (mailbox.org), Berlin</strong> — einem deutschen
Anbieter, mit dem ein Auftragsverarbeitungsvertrag besteht und dessen
Verarbeitung vertraglich ausschließlich in der EU / im EWR erfolgt.</p>
<p>Postalisch erreichst du uns über die im <a href="/impressum">Impressum</a>
genannte ladungsfähige Anschrift. Sie wird von unserem Anschriften-Dienstleister
<strong>ZERODOX (Christian Jahnke), Koblenz</strong> bereitgestellt, der dort
eingehende Post — insbesondere behördliche, gerichtliche und anwaltliche
Schreiben — entgegennimmt, öffnet und für uns digitalisiert. Die in einem
Schreiben enthaltenen Daten (Absender, Inhalt) verarbeitet er dabei als
<strong>eigenständiger Verantwortlicher</strong> nach seiner eigenen
Datenschutzerklärung
(<a href="https://zerodox.de/datenschutz">zerodox.de/datenschutz</a>), nicht
als unser Auftragsverarbeiter. Rechtsgrundlage der Nutzung ist unser
berechtigtes Interesse an einer zustellfähigen Anschrift unter Schutz der
Privatadresse (Art. 6 Abs. 1 lit. f DSGVO). Digitalisierte Schreiben bewahren
wir auf, solange die Bearbeitung es erfordert. Gewöhnliche private Briefpost
nimmt die Anschrift nicht an; sie geht an den Absender zurück — nutze dafür
bitte E-Mail oder das Kontaktformular.</p>

<h2>11. Feedback in der App</h2>
<p>Über den Feedback-Knopf in der App gelangst du zum
<a href="/kontakt.html">Kontaktformular</a> mit vorausgewählter Kategorie
„Feedback“. Gespeichert werden die Nachricht, der App-Bereich, aus dem du sie
gesendet hast, und die Sprache; eine E-Mail-Adresse nur, wenn du sie einträgst,
damit wir dir antworten können. Da das Formular ohne Anmeldung erreichbar ist,
wird deinem Feedback keine Konto- oder Mandanten-Kennung zugeordnet.
Rechtsgrundlage ist unser berechtigtes Interesse, den Dienst zu verbessern
(Art. 6 Abs. 1 lit. f DSGVO). Feedback wird gelöscht, sobald es nicht mehr
benötigt wird.</p>

<h2>12. Unterstützungs-Link (Spenden)</h2>
<p>Sofern ein Unterstützungs-Knopf (Herz-Symbol) angezeigt wird, führt er auf
unsere Spendenseite bei <strong>Ko-fi</strong> (Ko-fi Labs Ltd., London,
Vereinigtes Königreich). Beim bloßen Nutzen der App werden keine Daten an
Ko-fi übertragen — es sind keine Ko-fi-Inhalte eingebettet; erst wenn du den
Link selbst öffnest, verarbeiten Ko-fi und der von dir gewählte
Zahlungsdienstleister (<strong>Stripe</strong> Payments Europe Ltd., Irland,
oder <strong>PayPal</strong> (Europe) S.à r.l. et Cie, S.C.A., Luxemburg)
deine Daten als <strong>eigenständige Verantwortliche</strong> nach ihren
eigenen Datenschutzerklärungen (für das Vereinigte Königreich besteht ein
Angemessenheitsbeschluss der EU-Kommission). Zahlungsdaten erreichen uns nie.
Wenn du spendest, sehen wir in unserem Ko-fi-Konto die Angaben, die du dort
machst (Name bzw. Anzeigename, optional Nachricht und E-Mail-Adresse), und
nutzen sie ausschließlich, um Spenden nachzuvollziehen und uns ggf. zu
bedanken (Art. 6 Abs. 1 lit. f DSGVO). Spenden sind freiwillig und schalten
keine Funktionen frei.</p>

<h2>13. Moderation und Missbrauchsbekämpfung</h2>
<p>Zur Bearbeitung von Meldungen (Notice-and-Action), zur Durchsetzung
rechtlicher Pflichten und zur Missbrauchsbekämpfung kann der Betreiber
gemeldete Inhalte einsehen, entfernen, rechtswidrige Nutzernamen durch eine
neutrale Bezeichnung ersetzen, Konten sperren oder auf Verlangen
löschen. Diese Maßnahmen werden in einem <strong>Aktionsprotokoll</strong>
festgehalten (Zeitpunkt, Maßnahme, betroffenes Konto, bei Text-Entfernungen und
ersetzten Nutzernamen der vorherige Text als Nachweis). Rechtsgrundlagen sind rechtliche Verpflichtungen
(Art. 6 Abs. 1 lit. c DSGVO) und unser berechtigtes Interesse an einem
missbrauchsfreien Dienst (lit. f). Protokoll-Einträge, die personenbezogene
Daten enthalten (z. B. E-Mail-Adressen oder entfernte Texte), werden
<strong>drei Jahre</strong> nach Ende des Jahres, in dem die Maßnahme erfolgte,
gelöscht oder anonymisiert (angelehnt an die regelmäßige Verjährungsfrist,
§§ 195, 199 BGB). Der Nachweis einer Kontolöschung wird ohne E-Mail-Adresse
geführt und bleibt zur Dokumentation der Löschpflicht bestehen
(Art. 17 Abs. 3 lit. b und e DSGVO).</p>

<h2>14. Cookies und lokale Speicherung (§ 25 TDDDG)</h2>
<p>Der Dienst verwendet nur unbedingt erforderliche Speicherung auf deinem
Gerät (§ 25 Abs. 2 Nr. 2 TDDDG), daher ist keine Einwilligung (Cookie-Banner)
erforderlich. Im Einzelnen:</p>
<ul>
  <li><strong>Anmelde-Cookies</strong>: ein Cookie („sa“, httpOnly,
  15 Minuten), damit hochgeladene Cover-Bilder nur für angemeldete Nutzer
  abrufbar sind; selbst gehostete Instanzen mit Gruppen-Passwort verwenden
  stattdessen ein Sitzungs-Cookie („sid“, 30 Tage) — diese Instanz nutzt seit
  Öffnung der Registrierung kein Gruppen-Passwort mehr. Sind beide Verfahren
  zugleich aktiv (Konten hinter dem Gruppen-Passwort), werden beide Cookies
  gesetzt.</li>
  <li><strong>Admin-Cookie</strong>: auf dem Gerät des Betreibers setzt die
  Moderations-Oberfläche nach Anmeldung ein eigenes Cookie („aid“, httpOnly,
  12 Stunden).</li>
  <li><strong>localStorage</strong>: deine Spracheinstellung, deine
  Anmelde-Token (damit du angemeldet bleibst) sowie ein lokaler
  Zwischenspeicher deiner Rundendaten für schnellere Anzeigen — er wird beim
  Ab- und Anmelden geleert. Hast du die Demo gestartet, kommt eine Kennung
  hinzu, mit der du dieselbe Demo später fortsetzen kannst; sie wird beim
  Beenden der Demo gelöscht. Hast du über einen <strong>Abstimmungs-Link</strong>
  abgestimmt (Abschnitt 5), merkt sich dein Gerät zusätzlich, welchen Namen du
  dort ausgewählt hast — damit du deine Stimme bis zum Ende der Abstimmung ändern
  kannst, ohne erneut gefragt zu werden.</li>
  <li><strong>sessionStorage</strong>: ein kurzlebiger technischer Marker, der
  bei abgelaufener Anmeldung eine Weiterleitungsschleife verhindert; er gilt
  nur für den offenen Browser-Tab und wird beim Schließen automatisch
  entfernt.</li>
  <li><strong>Offline-Cache</strong>: die App ist als PWA installierbar; der
  Browser legt dafür die App-Dateien (Code, Schriften, Icons — nie deine Runden-
  oder Bilddaten) im Cache ab.</li>
</ul>
<p>Analyse-, Tracking- oder Werbe-Speicherung findet nicht statt.</p>

<h2>15. Weitergabe von Daten</h2>
<p>Eine Weitergabe personenbezogener Daten erfolgt nur an die in dieser
Erklärung genannten Empfänger (Railway, Cloudflare, Heinlein Hosting,
ZERODOX — jeweils
in dem beschriebenen Umfang) und im Fall der Anbieter-Cover direkt durch deinen
Browser (Abschnitt 7). Ko-fi, Stripe und PayPal erreichen Daten nur, wenn du
den Spenden-Link selbst öffnest (Abschnitt 12). Innerhalb des Dienstes werden
Inhalte anderen Konten nur wie in Abschnitt 5 beschrieben zugänglich (geteilte
Runden und der Freundeskreis-Feed) und stets nur den von dir ausdrücklich
bestätigten Konten. Ein Verkauf oder eine werbliche Nutzung der Daten findet
nicht statt.</p>

<h2>16. Deine Rechte</h2>
<p>Du hast nach der DSGVO das Recht auf <strong>Auskunft</strong> (Art. 15),
<strong>Berichtigung</strong> (Art. 16), <strong>Löschung</strong> (Art. 17),
<strong>Einschränkung der Verarbeitung</strong> (Art. 18) und
<strong>Datenübertragbarkeit</strong> (Art. 20). Wende dich dazu formlos an die
oben genannte E-Mail-Adresse oder das <a href="/kontakt.html">Kontaktformular</a>.</p>
<p class="highlight"><strong>Widerspruchsrecht (Art. 21 DSGVO):</strong> Du
hast das Recht, aus Gründen, die sich aus deiner besonderen Situation ergeben,
jederzeit gegen Verarbeitungen zu widersprechen, die auf Art. 6 Abs. 1 lit. f
DSGVO (berechtigtes Interesse) beruhen.</p>
<p>Außerdem kannst du dich bei einer <strong>Datenschutz-Aufsichtsbehörde
beschweren</strong> (Art. 77 DSGVO), etwa bei der Behörde deines Wohnorts
(eine Übersicht führt der Bundesbeauftragte für den Datenschutz und die
Informationsfreiheit). Die Bereitstellung deiner Daten ist weder gesetzlich
noch vertraglich vorgeschrieben; ohne E-Mail-Adresse kann allerdings kein Konto
angelegt werden. Eine <strong>automatisierte Entscheidungsfindung
einschließlich Profiling</strong> (Art. 22 DSGVO) findet nicht statt.</p>

<h2>17. Änderungen</h2>
<p>Wir passen diese Erklärung an, wenn sich der Dienst oder die Rechtslage
ändert; es gilt die jeweils hier veröffentlichte Fassung.</p>`;

  const en = `
<h1>Privacy policy</h1>
<p class="lang-note">Courtesy translation — the German version above is
authoritative.</p>

<h2>1. Controller</h2>
<p>${nameAddr}<br>
E-mail: <a href="mailto:${mail}">${mail}</a></p>
<p>Mail sent to this address is received by a receiving-service provider and
forwarded to the controller. No data protection officer is designated (not
legally required).</p>

<h2>2. The short version</h2>
<ul>
  <li>Spielwirbel uses <strong>no tracking, no analytics and no ads</strong>.</li>
  <li>Only strictly necessary cookies and local storage are used (login,
  language, a local data cache) — hence no cookie banner (§ 25(2) TDDDG).</li>
  <li>Fonts and scripts are <strong>self-hosted</strong>; a normal visit loads
  nothing from third parties. The one exception are game covers you link from
  external providers (section 7).</li>
  <li>All traffic is encrypted (TLS/HTTPS); the application and database run in
  an <strong>EU data centre</strong>, uploaded images are stored with
  Cloudflare (section 6).</li>
</ul>

<h2>3. Hosting, server logs and database</h2>
<p>The application runs at <strong>Railway Corp.</strong> (USA) in an EU data
region, which also hosts the PostgreSQL database and the application logs. A
data-processing agreement (Art. 28 GDPR) including EU standard contractual
clauses (Art. 46(2)(c) GDPR) is in place.</p>
<p>Each request is technically logged with <strong>IP address, HTTP method,
path, status code and duration</strong> — request contents (form data, search
terms, cookies) are deliberately <strong>not</strong> logged. In addition we
log <strong>pseudonymous usage events</strong> — the kind of action (e.g.
"round created") together with the account/tenant identifier, never content —
to understand how the service is used in broad strokes. On severe errors a
notification (time, path, error message — no content, no IP address) may, if
configured, be sent to a messaging service used by the operator. Purpose:
secure, stable operation (debugging, abuse and attack detection, rate
limiting); legal basis: legitimate interest (Art. 6(1)(f) GDPR). Logs are
subject to the hosting platform's automatic retention limit and are not
combined with other data.</p>

<h2>4. Account and registration</h2>
<p>When you create an account we process your <strong>e-mail address</strong>, a
<strong>username</strong> of your choosing and a <strong>password</strong>,
stored exclusively as a modern hash (Argon2id) — never in plain text.
Short-lived tokens for e-mail verification and password reset are stored hashed
and sent to you by e-mail. Legal basis: performance of the user relationship
(Art. 6(1)(b) GDPR). Account data is kept until the account is deleted. You can
<strong>delete it yourself at any time in your account settings</strong>
("Delete account") — you confirm your username and password, and we show you
beforehand exactly what will be deleted. It takes effect immediately and removes
all of the account's data including all rounds and uploaded images; it cannot be
restored afterwards. Alternatively you can still request deletion informally via
the contact channels above. In either case only a minimal record of the deletion
itself, without your e-mail address, is retained (section 13).</p>
<p>The <strong>username</strong> identifies your account within the service. It
exists so that your account can be addressed, and named in a report,
<em>without</em> disclosing your e-mail address. It is unique across the
service, stored with the capitalisation you chose, and currently cannot be
changed by you after registration. You pick it freely — if being unidentifiable
matters to you, choose one that does not point back to you; we never ask for
your real name. If a username is itself unlawful (an insult, an impersonation),
we replace it with a neutral one and keep the previous name as evidence in the
action log (section 13).</p>
<p>You may optionally store your <strong>BoardGameGeek username</strong> in your
account. It is voluntary, stored exactly as you enter it, and serves a single
purpose: fetching the game collection you have marked as owned there, on your
request, so that you can import it into a shelf. We perform that fetch
server-side — your browser makes no connection to BoardGameGeek — and we
transmit nothing but that username. You can remove the link at any time in your
account settings, which deletes the name. Legal basis: performance of the user
relationship (Art. 6(1)(b) GDPR).</p>
<p>When someone <strong>invites you to a round</strong> or sends you a
<strong>friend request</strong>, we notify you by <strong>e-mail to your
account's address</strong> in addition to the in-app inbox. These messages only
ever concern requests that need a decision from you — there is no advertising, no
newsletter, and we do not write to you about your friends' activity. We send at
most one such message per recipient per hour; if several requests arrive within
that time we combine them into a single message that names only how many there
are. You can switch both kinds off individually in your account settings, and
every one of these e-mails links there. Legal basis: performance of the user
relationship (Art. 6(1)(b) GDPR). No additional recipient is involved — delivery
uses the same provider as the confirmation and password e-mails (section 9).</p>

<p>The service offers a <strong>demo without registration</strong>. Starting it
automatically creates a <strong>throwaway account</strong> with sample content.
That account has <strong>no e-mail address and no password</strong>: the demo
asks you for no personal data and cannot identify you. We store only a randomly
generated account name and whatever you enter yourself during the demo. The
account is <strong>deleted automatically and in full after at most 24
hours</strong>, together with every round created in it and any uploaded images;
it cannot be restored. You can also delete it yourself at any time via "End demo"
in the account menu. If you register afterwards, you get a new, empty account —
demo content is not carried over. Legal basis: performance of pre-contractual
steps taken at your request (Art. 6(1)(b) GDPR).</p>

<p>So that no single visitor can occupy an unlimited number of demo accounts at
once and thereby block the demo for everyone else, a demo account additionally
stores a <strong>cryptographic hash of your IP address</strong> (HMAC-SHA-256
with a secret key). The IP address itself is <strong>not</strong> stored, and the
hash serves only to limit how many demos one connection may hold at the same
time — it is not used to recognise you, to build a profile, or to link several
visits. It is deleted together with the demo account, i.e. after at most 24
hours. Legal basis: our legitimate interest in operating the service free of
abuse (Art. 6(1)(f) GDPR).</p>

<p>To let you resume a running demo, your browser additionally stores an
identifier in your device's local storage (<em>localStorage</em>) — strictly
necessary for the function you requested and therefore permitted without consent
(§ 25(2) no. 2 TDDDG); see section 14 for details.</p>

<h2>5. Round and game data</h2>
<p>The service exists to manage game rounds, so we store what is entered:
<strong>round names, game titles, member names, guest names, ratings/votes,
tags, an activity feed and uploaded cover images</strong>. Member and guest names
are free-form — if you enter real names of other people, make sure they are fine
with it. A <strong>guest</strong> is someone entered for a single session only:
the name stays part of that session's record permanently, but the person does not
become a member of the round.
Legal basis: providing the service (Art. 6(1)(b) GDPR). This data is, as a rule,
visible only within your own account (tenant) and is kept until you delete it or
the account. <strong>If you share a round</strong> by inviting another account
(see next paragraph), the invited account can see and edit the contents of that
one round.</p>
<p>When you invite another account to a round, we store the
<strong>invitation</strong> (the inviting and invited account, the round
concerned and the intended member seat) and — once accepted — the
<strong>access grant</strong> for that round. Accounts are addressed only by
their public username; no e-mail address is disclosed. The invitation appears in
the invited account's in-app inbox. A round is thereby made accessible only to
the accounts you explicitly invite — there is no dissemination to the public.
Legal basis: providing the service (Art. 6(1)(b) GDPR).</p>
<p>When a round is <strong>voting across several devices</strong>, a
<strong>voting link</strong> can be created and passed on by you (in a group
chat, say) so that people <strong>without an account</strong> can vote from their
own device. All that is stored for this is a random, unguessable identifier and
which single session it belongs to. Whoever holds the link sees only the
<strong>round name</strong>, the <strong>drawn games</strong> and the
<strong>names of that session's participants</strong>, and can cast one vote —
<strong>no ratings anyone has already given</strong>, no result, and no other
round, member or account data. You decide who receives the link: we never
publish, link to or expose it to search engines. It stops working and is deleted
when voting ends — and likewise if the session or the round is cancelled or
deleted. Legal basis: providing the service (Art. 6(1)(b) GDPR).</p>
<p>Accounts can also <strong>become friends</strong> (Freundeskreis). You send a
request to a public username; we store the <strong>friendship</strong> (the
requesting and addressed account, and its status). Once accepted, friends see
short activity notes about each other in their <strong>Freundeskreis feed</strong>
— only the <strong>game title</strong> (and its cover image, if any) when you add
a game to a shelf or finish a session. <strong>No</strong> member names, ratings,
votes or round names are disclosed, and only events created after the friendship
was accepted are shown. A friendship grants <strong>no</strong> access to any
round. Ending a friendship is unilateral and takes effect immediately in both
directions. This visibility is limited to your explicitly confirmed friends —
there is no dissemination to the public. Legal basis: providing the service
(Art. 6(1)(b) GDPR).</p>
<p>Every account has a <strong>profile</strong> within the service, reachable
under its username. Signed-in accounts see the <strong>username</strong> there, a
colour symbol derived from it automatically, the <strong>month of
registration</strong> ("Mitglied seit"), and the state of any friend request
between you. That account's Freundeskreis feed is shown there only if you are
friends, under the same restrictions as the previous paragraph. No further data —
in particular your e-mail address, rounds, games, sessions and ratings — is shown
on the profile. The profile requires a sign-in; it is not accessible to
signed-out visitors or to search engines. Legal basis: providing the service
(Art. 6(1)(b) GDPR).</p>

<h2>6. Uploaded images</h2>
<p>Cover images you upload are stored in S3-compatible object storage at
<strong>Cloudflare, Inc.</strong> (USA) and served exclusively through our
server (no public bucket access). Legal basis: providing the service
(Art. 6(1)(b) GDPR). A data-processing agreement is in place; Cloudflare is
certified under the <strong>EU-US Data Privacy Framework</strong> (Art. 45
GDPR), with standard contractual clauses as a fallback.</p>

<h2>7. Game covers from external providers (hotlinking)</h2>
<p>When adding a game you can link an official provider cover. Such covers are
<strong>not copied by us</strong> — your browser loads them directly from the
provider, which therefore receives your <strong>IP address</strong> and the
usual browser headers, as if you had visited their site. Possible providers
(depending on which covers your round links):</p>
<ul>
  <li>Sony Interactive Entertainment — <code>image.api.playstation.com</code> / <code>playstation.net</code></li>
  <li>Valve Corporation (Steam) — <code>steamstatic.com</code></li>
  <li>Nintendo — <code>nintendo.com</code></li>
  <li>Microsoft (Xbox) — <code>s-microsoft.com</code></li>
  <li>BoardGameGeek — <code>geekdo-images.com</code></li>
</ul>
<p>Some of these providers are located in third countries (notably the USA and
Japan); we have no influence on their processing. Legal basis: our legitimate
interest in displaying linked covers without reproducing copyrighted images
ourselves (Art. 6(1)(f) GDPR). If you prefer not to, add games without a
provider cover or upload your own image.</p>

<h2>8. Title search against game providers</h2>
<p>The title search when adding a game queries the catalogues of the providers
above. These requests are made by <strong>our server</strong> — only the typed
search term and the language selected in the app (for localized titles and
store links) are transmitted, never your IP address or any data about you.</p>

<h2>9. E-mail delivery</h2>
<p>System e-mails (address verification, password reset, notification of a
password change, contact-form
delivery, notices about invitations and friend requests (section 4), and
acknowledgements of and decisions on reports) are sent through the
operator's mailbox at <strong>Heinlein Hosting GmbH (mailbox.org),
Berlin</strong> — the same German provider that receives incoming mail
(section 10), under a data-processing agreement. Recipient address, subject and
message content are processed for delivery (Art. 6(1)(b) GDPR). No separate
e-mail delivery provider is involved.</p>
<p>These e-mails contain <strong>no tracking pixels, no open or click
tracking and no rewritten links</strong>. We do not learn whether or when you
open a system e-mail, and the links inside lead directly to this application
rather than through a third party.</p>

<h2>10. Contact form, e-mail and postal mail</h2>
<p>If you use the <a href="/kontakt.html">contact form</a> we process what you
submit (the message and — each optional — e-mail address, name and subject) to
answer your request (Art. 6(1)(b)/(f) GDPR). The e-mail address is optional for
every category; without it, however, we cannot reply. A report of illegal content additionally
carries what such a report requires: the category, the reported address (URL),
where known the <strong>username of the reported account</strong>, and your
statement of accuracy (Art. 16(2) DSA). The reported username concerns a third
person; we process it solely to assess and handle the report. The message is delivered to us by e-mail via
mailbox.org and kept in the operator's mailbox as long as handling requires. The same
applies to direct e-mails. Messages and reports submitted through the form are
additionally stored in our database (section 3) so that the receipt and
handling of reports remain verifiable — the mailbox retention periods apply.
Reports of illegal content (section 13) and our
replies to them are retained as evidence for three years from the end of the
year of the decision. The operator's mailbox is hosted by
<strong>Heinlein Hosting GmbH (mailbox.org), Berlin, Germany</strong> — a German
provider under a data-processing agreement, with processing contractually
confined to the EU/EEA.</p>
<p>By post you can reach us at the serviceable address given in the
<a href="/impressum">legal notice</a>. It is provided by our address service
<strong>ZERODOX (Christian Jahnke), Koblenz, Germany</strong>, which receives,
opens and digitizes mail arriving there for us — in particular letters from
authorities, courts and lawyers. In doing so it processes the data contained in
a letter (sender, content) as an <strong>independent controller</strong> under
its own privacy policy
(<a href="https://zerodox.de/datenschutz">zerodox.de/datenschutz</a>), not as
our processor. Legal basis for using the service is our legitimate interest in
a serviceable address that protects the operator's private address
(Art. 6(1)(f) GDPR). Digitized letters are kept by us as long as handling
requires. Ordinary private letter post is not accepted at that address and is
returned to the sender — please use e-mail or the contact form instead.</p>

<h2>11. In-app feedback</h2>
<p>The feedback button takes you to the <a href="/kontakt.html">contact form</a>
with the “Feedback” category preselected. We store the message, the app area you
sent it from and your language; an e-mail address only if you enter one, so we
can reply. Because the form is reachable without signing in, no account or tenant
identifier is attached to your feedback. Legal basis: legitimate interest in
improving the service (Art. 6(1)(f) GDPR). Feedback is deleted once it is no
longer needed.</p>

<h2>12. Support link (donations)</h2>
<p>Where a support button (heart icon) is shown, it links to our donation page
at <strong>Ko-fi</strong> (Ko-fi Labs Ltd., London, United Kingdom). Merely
using the app transmits nothing to Ko-fi — no Ko-fi content is embedded; only
when you open the link yourself do Ko-fi and the payment provider you choose
there (<strong>Stripe</strong> Payments Europe Ltd., Ireland, or
<strong>PayPal</strong> (Europe) S.à r.l. et Cie, S.C.A., Luxembourg) process
your data as <strong>independent controllers</strong> under their own privacy
policies (the United Kingdom is covered by an EU adequacy decision). Payment
data never reaches us. If you donate, we see in our Ko-fi account the details
you provide there (name or display name, an optional message and e-mail
address) and use them solely to keep track of donations and, where
appropriate, to say thanks (Art. 6(1)(f) GDPR). Donations are voluntary and
unlock nothing.</p>

<h2>13. Moderation and abuse prevention</h2>
<p>To handle reports (notice and action), meet legal obligations and prevent
abuse, the operator can review reported content, remove it, replace an unlawful
username with a neutral one, suspend accounts or
delete them on request. These actions are recorded in an <strong>action
log</strong> (time, action, affected account, and for text removals and replaced
usernames the previous text as evidence). Legal bases: legal obligations (Art. 6(1)(c) GDPR) and our
legitimate interest in an abuse-free service (point (f)). Log entries containing
personal data (e.g. e-mail addresses or removed text) are deleted or anonymized
<strong>three years</strong> after the end of the year in which the action was
taken (aligned with the regular German limitation period, §§ 195, 199 BGB). The
record of an account deletion is kept without the e-mail address and is
retained as evidence of the erasure obligation (Art. 17(3)(b) and (e)
GDPR).</p>

<h2>14. Cookies and local storage (§ 25 TDDDG)</h2>
<p>Only strictly necessary storage on your device is used (§ 25(2) no. 2
TDDDG), so no consent banner is required. In detail:</p>
<ul>
  <li><strong>Login cookies</strong>: a cookie ("sa", httpOnly, 15 minutes) so
  uploaded cover images are only served to logged-in users; self-hosted
  instances using a shared group password use a session cookie ("sid",
  30 days) instead — this instance no longer uses a group password since
  registration opened. When both mechanisms are active at once (accounts
  behind the group password), both cookies are set.</li>
  <li><strong>Admin cookie</strong>: on the operator's device the moderation
  panel sets its own cookie ("aid", httpOnly, 12 hours) after login.</li>
  <li><strong>localStorage</strong>: your language preference, your login
  tokens (so you stay signed in) and a local cache of your round data for
  faster rendering — cleared on login and logout. If you started the demo, an
  additional identifier lets you resume that same demo later; it is deleted when
  you end the demo. If you voted through a <strong>voting link</strong>
  (section 5), your device additionally remembers which name you picked there —
  so you can change your vote until voting ends without being asked again.</li>
  <li><strong>sessionStorage</strong>: a short-lived technical marker that
  prevents a redirect loop when your login has expired; it only applies to the
  open browser tab and is removed automatically when the tab closes.</li>
  <li><strong>Offline cache</strong>: the app is installable as a PWA; the
  browser caches the app files for that (code, fonts, icons — never your round
  data or images).</li>
</ul>
<p>No analytics, tracking or advertising storage takes place.</p>

<h2>15. Data sharing</h2>
<p>Personal data is shared only with the recipients named in this policy
(Railway, Cloudflare, Heinlein Hosting, ZERODOX — each to the
extent described) and, for
provider covers, directly by your browser (section 7). Ko-fi, Stripe and
PayPal receive data only when you open the donation link yourself
(section 12). Within the service, content is made visible to other accounts only
as described in section 5 (shared rounds and the Freundeskreis feed) and always
only to the accounts you have explicitly confirmed. Data is never sold or used
for advertising.</p>

<h2>16. Your rights</h2>
<p>Under the GDPR you have the right of <strong>access</strong> (Art. 15),
<strong>rectification</strong> (Art. 16), <strong>erasure</strong> (Art. 17),
<strong>restriction</strong> (Art. 18) and <strong>data portability</strong>
(Art. 20). Just write to the e-mail address above or use the
<a href="/kontakt.html">contact form</a>.</p>
<p class="highlight"><strong>Right to object (Art. 21 GDPR):</strong> you have
the right to object at any time, on grounds relating to your particular
situation, to processing based on Art. 6(1)(f) GDPR (legitimate interest).</p>
<p>You also have the right to <strong>lodge a complaint with a data-protection
supervisory authority</strong> (Art. 77 GDPR), for instance the authority of
your place of residence (the German Federal Commissioner for Data Protection,
BfDI, maintains an overview). Providing your data is neither legally nor
contractually required; without an e-mail address, however, no account can be
created. <strong>No automated decision-making including profiling</strong>
(Art. 22 GDPR) takes place.</p>

<h2>17. Changes</h2>
<p>We update this policy when the service or the legal situation changes; the
version published here applies.</p>`;

  return layout('Datenschutz', de, en);
}

/* ------------------------------------------------------------------------- *
 * Nutzungsbedingungen (issue #140) — the DSA Art. 14 content-rules document.
 *
 * Deliberately "Nutzungsbedingungen", NOT consumer-contract AGB: #173 decided
 * free + unconditional donations, so there is no consideration, no consumer
 * contract, no AGB obligation and no Widerrufsbelehrung (recorded conclusion
 * on #140). What DOES apply to any hosting service regardless of size are the
 * DSA base duties — contact points (Arts. 11/12), content restrictions stated
 * publicly in clear language (Art. 14), notice-and-action (Art. 16) and
 * statements of reasons (Art. 17) — and this document is where they live.
 * The prohibited-content list is explicit on purpose: each removal's Art. 17
 * statement of reasons points back at a named clause here (see
 * docs/legal/notice-and-action.md), so generic wording would fail exactly
 * when it matters. There is deliberately NO minimum-age clause: the app has
 * no consent-based processing (Art. 8 DSGVO not triggered) and is a hosting
 * service, not a platform (no DSA Art. 28 duty) — see
 * .claude/rules/keep-legal-docs-current.md for the triggers that would
 * change that.
 * ------------------------------------------------------------------------- */

function renderNutzungsbedingungen() {
  const mail = esc(impressumEmail());
  const de = `
<h1>Nutzungsbedingungen</h1>
<p class="meta">Stand: ${TERMS_REVISION} · <a href="#en">English version below</a></p>

<h2>1. Geltungsbereich und Anbieter</h2>
<p>Diese Nutzungsbedingungen gelten für die Nutzung von
<strong>Spielwirbel</strong> (der „Dienst“), betrieben von
${esc(OPERATOR_NAME)} (Anschrift und Kontaktwege im
<a href="/impressum">Impressum</a>). Mit der Registrierung eines Kontos
oder dem Start eines Demo-Kontos akzeptierst du diese Bedingungen. Ein
Demo-Konto entsteht ohne Registrierung und wird automatisch wieder gelöscht;
für seine Nutzung gelten diese Bedingungen ebenso.</p>

<h2>2. Der Dienst</h2>
<p>Spielwirbel hilft Gruppen, ihre Spiele zu verwalten,
„Was-spielen-wir?“-Abstimmungen durchzuführen und Bewertungen festzuhalten.
Der Dienst ist <strong>unentgeltlich</strong>. Freiwillige Spenden sind
möglich, schalten aber keine Funktionen frei und begründen keinen Anspruch auf
Leistungen.</p>

<h2>3. Konto</h2>
<p>Für die Nutzung ist ein Konto erforderlich; für ein reguläres Konto
benötigst du eine gültige E-Mail-Adresse. Ein Demo-Konto (§ 1) entsteht ohne
Registrierung, ohne E-Mail-Adresse und ohne Passwort und wird nach kurzer Zeit
automatisch gelöscht. Halte deine Zugangsdaten geheim; für Aktivitäten über
dein Konto bist du verantwortlich, soweit du sie zu vertreten hast. Du kannst
dein Konto jederzeit selbst in der App löschen oder formlos über die im
Impressum genannten Kontaktwege löschen lassen; ein Demo-Konto kannst du
jederzeit direkt in der App beenden und damit sofort löschen. Dabei werden
sämtliche Daten des Kontos gelöscht (Einzelheiten in der
<a href="/datenschutz">Datenschutzerklärung</a>). Wir können das
Nutzungsverhältnis ordentlich mit einer Frist von mindestens vier Wochen in
Textform kündigen; bis zum Wirksamwerden kannst du einen Export deiner Daten
anfordern.</p>

<h2>4. Deine Inhalte und Rechte</h2>
<p>Inhalte, die du einstellst (Rundennamen, Spieltitel, Mitgliedsnamen,
Bewertungen, Schlagworte, hochgeladene Bilder), bleiben deine. Du räumst uns
das einfache, auf die Dauer der Speicherung beschränkte Recht ein, sie zu
speichern und innerhalb des Dienstes anzuzeigen — nur soweit für den Betrieb
technisch erforderlich. Du darfst nur Inhalte einstellen, an denen du die
erforderlichen Rechte hast, und personenbezogene Daten anderer Personen nur
mit deren Einverständnis.</p>

<h2>5. Verbotene Inhalte und verbotene Nutzung</h2>
<p>Folgende Inhalte dürfen nicht eingestellt werden — auch nicht als Bild,
Name, Schlagwort oder sonstiger Text:</p>
<ul>
  <li>Inhalte, die gegen deutsches Recht oder EU-Recht verstoßen
  (rechtswidrige Inhalte);</li>
  <li>Darstellungen sexuellen Missbrauchs von Kindern sowie jede
  sexualisierende Darstellung Minderjähriger;</li>
  <li>pornografische oder sexuell explizite Inhalte;</li>
  <li>volksverhetzende oder extremistische Inhalte, insbesondere Kennzeichen
  verfassungswidriger Organisationen (§§ 86, 86a StGB) und Volksverhetzung
  (§ 130 StGB);</li>
  <li>gewaltverherrlichende, grausame oder Schock-Inhalte (Gore);</li>
  <li>Beleidigungen, Verleumdungen, Drohungen oder Belästigungen gegenüber
  Personen;</li>
  <li>personenbezogene Daten Dritter ohne deren Einverständnis;</li>
  <li>urheberrechtlich geschützte Werke Dritter ohne Berechtigung —
  insbesondere fremde Cover-Bilder, an denen du keine Rechte hast;</li>
  <li>Schadsoftware, Spam oder Werbung.</li>
</ul>
<p>Untersagt ist außerdem der technische Missbrauch des Dienstes: der Versuch,
Zugriffskontrollen oder die Trennung der Konten (Mandanten) zu umgehen, den
Dienst zu überlasten oder ihn automatisiert massenhaft abzufragen.</p>

<h2>6. Meldung rechtswidriger Inhalte (Notice-and-Action)</h2>
<p>Wer der Ansicht ist, dass im Dienst rechtswidrige Inhalte gespeichert sind,
kann uns das über das <a href="/kontakt.html">Kontaktformular</a> oder per
E-Mail an <a href="mailto:${mail}">${mail}</a> melden. Damit wir eine Meldung
zügig prüfen können, sollte sie enthalten (Art. 16 Abs. 2 der Verordnung (EU)
2022/2065, „DSA“):</p>
<ul>
  <li>eine hinreichend begründete Erläuterung, warum der Inhalt rechtswidrig
  sein soll;</li>
  <li>die genaue Adresse (URL) des Inhalts oder — wo es keine öffentliche URL
  gibt — eine andere eindeutige Bezeichnung (z. B. Konto, Runde,
  Spieltitel);</li>
  <li>nach Möglichkeit Name und E-Mail-Adresse der meldenden Person — die Angabe
  ist freiwillig; ohne sie können wir allerdings weder den Eingang bestätigen
  noch dir unsere Entscheidung mitteilen (bei Inhalten im Zusammenhang mit
  Straftaten des sexuellen Missbrauchs von Kindern verlangen wir ohnehin keine
  Kontaktdaten);</li>
  <li>eine Erklärung, dass die Angaben nach bestem Wissen richtig und
  vollständig sind.</li>
</ul>
<p>Wir bestätigen den Eingang der Meldung (sofern sie Kontaktdaten enthält),
prüfen sie zeitnah, sorgfältig, objektiv und frei von Willkür und teilen der
meldenden Person unsere Entscheidung samt Hinweisen auf mögliche Rechtsbehelfe
mit (Art. 16 Abs. 4–6 DSA). Automatisierte Entscheidungsverfahren setzen wir
dabei nicht ein.</p>

<h2>7. Maßnahmen bei Verstößen</h2>
<p>Bei rechtswidrigen Inhalten oder Verstößen gegen Abschnitt 5 können wir —
verhältnismäßig und unter Berücksichtigung der Umstände des Einzelfalls —
einzelne Inhalte entfernen oder sperren, einen rechtswidrigen Nutzernamen durch
eine neutrale Bezeichnung ersetzen, Funktionen einschränken oder das
Konto vorübergehend sperren oder dauerhaft schließen. Betroffene erhalten eine
<strong>Begründung</strong> (Art. 17 DSA): die getroffene Maßnahme, die
zugrunde gelegten Tatsachen, die Rechtsgrundlage bzw. die verletzte Regel
dieser Bedingungen sowie Hinweise auf Rechtsbehelfe. Gegen eine Maßnahme
kannst du dich formlos über die im Impressum genannten Kontaktwege wenden; der
Rechtsweg bleibt unberührt.</p>

<h2>8. Verfügbarkeit, Änderung und Einstellung des Dienstes</h2>
<p>Der Dienst wird unentgeltlich und ohne Zusicherung einer bestimmten
Verfügbarkeit bereitgestellt; Wartungen und Störungen können zu
Unterbrechungen führen. Wir entwickeln den Dienst fortlaufend weiter und
können Funktionen ändern oder einstellen. Eine Einstellung des Dienstes oder
wesentlicher Teile kündigen wir mit angemessenem Vorlauf an, damit du deine
Daten sichern kannst; einen Export deiner Daten kannst du jederzeit formlos
anfordern.</p>

<h2>9. Haftung</h2>
<p>Wir haften unbeschränkt für Vorsatz und grobe Fahrlässigkeit sowie für
Schäden aus der Verletzung von Leben, Körper oder Gesundheit und nach dem
Produkthaftungsgesetz. Bei einfacher Fahrlässigkeit haften wir nur für die
Verletzung wesentlicher Pflichten, deren Erfüllung die ordnungsgemäße Nutzung
des Dienstes überhaupt erst ermöglicht und auf deren Einhaltung du regelmäßig
vertrauen darfst (Kardinalpflichten), begrenzt auf den vorhersehbaren,
typischerweise eintretenden Schaden. Im Übrigen ist die Haftung
ausgeschlossen.</p>

<h2>10. Kontaktstellen (Art. 11, 12 DSA)</h2>
<p>Zentrale Kontaktstelle für die Behörden der Mitgliedstaaten, die Kommission
und das Gremium für digitale Dienste (Art. 11 DSA) sowie für die Nutzerinnen
und Nutzer des Dienstes (Art. 12 DSA) ist die E-Mail-Adresse
<a href="mailto:${mail}">${mail}</a>; ergänzend steht das
<a href="/kontakt.html">Kontaktformular</a> zur Verfügung. Kommunikation ist
auf Deutsch und Englisch möglich.</p>

<h2>11. Änderungen dieser Bedingungen</h2>
<p>Wir können diese Bedingungen mit Wirkung für die Zukunft anpassen, wenn
rechtliche Änderungen, Änderungen des Dienstes (neue oder eingestellte
Funktionen) oder die Missbrauchsabwehr das erfordern. Über wesentliche
Änderungen informieren wir im Dienst oder per E-Mail (Art. 14 Abs. 2 DSA);
es gilt die jeweils hier veröffentlichte Fassung. Bist du mit einer Änderung
nicht einverstanden, kannst du die Nutzung jederzeit beenden und dein Konto
löschen lassen.</p>

<h2>12. Schlussbestimmungen</h2>
<p>Es gilt deutsches Recht. Zwingende Verbraucherschutzvorschriften des
Staates, in dem du deinen gewöhnlichen Aufenthalt hast, bleiben unberührt.
Sollten einzelne Bestimmungen unwirksam sein, bleibt die Wirksamkeit der
übrigen Bestimmungen unberührt.</p>
${renderTermsChangelog('de')}`;

  const en = `
<h1>Terms of use</h1>
<p class="lang-note">Courtesy translation — the German version above is
authoritative.</p>

<h2>1. Scope and provider</h2>
<p>These terms of use govern the use of <strong>Spielwirbel</strong> (the
"service"), operated by ${esc(OPERATOR_NAME)} (address and contact channels in
the <a href="/impressum">legal notice</a>). By registering an account or
starting a demo account you accept these terms. A demo account is created
without registration and is deleted automatically; these terms apply to its
use just the same.</p>

<h2>2. The service</h2>
<p>Spielwirbel helps groups manage their games, run "what should we play?"
votes and keep track of ratings. The service is <strong>free of
charge</strong>. Voluntary donations are possible but unlock nothing and
create no entitlement to any service.</p>

<h2>3. Account</h2>
<p>Using the service requires an account; a regular account requires a valid
e-mail address. A demo account (§ 1) is created without registration, without
an e-mail address and without a password, and is deleted automatically after a
short time. Keep your credentials secret; you are responsible for activity
under your account to the extent it is attributable to you. You can delete your
account yourself in the app at any time, or have it deleted informally via the
contact channels in the legal notice; a demo account can be ended, and thereby
deleted immediately, at any time. This
deletes all of the account's data (details in the
<a href="/datenschutz">privacy policy</a>). We may terminate the user
relationship ordinarily with at least four weeks' notice in text form; until
the termination takes effect you can request an export of your data.</p>

<h2>4. Your content and rights</h2>
<p>Content you enter (round names, game titles, member names, ratings, tags,
uploaded images) remains yours. You grant us the non-exclusive right, limited
to the duration of storage, to store it and display it within the service —
only as technically required for operation. You may only post content you hold the
necessary rights to, and personal data of other people only with their
consent.</p>

<h2>5. Prohibited content and prohibited use</h2>
<p>The following content must not be posted — including as an image, name,
tag or any other text:</p>
<ul>
  <li>content that violates German or EU law (illegal content);</li>
  <li>depictions of child sexual abuse and any sexualized depiction of
  minors;</li>
  <li>pornographic or sexually explicit content;</li>
  <li>content inciting hatred or extremist content, in particular symbols of
  unconstitutional organizations (§§ 86, 86a German Criminal Code) and
  incitement to hatred (§ 130 German Criminal Code);</li>
  <li>content glorifying violence, cruel or shock content (gore);</li>
  <li>insults, defamation, threats or harassment directed at persons;</li>
  <li>personal data of third parties without their consent;</li>
  <li>copyrighted works of third parties without authorization — in
  particular cover images you hold no rights to;</li>
  <li>malware, spam or advertising.</li>
</ul>
<p>Technical abuse of the service is also prohibited: attempting to
circumvent access controls or the separation of accounts (tenants),
overloading the service, or automated bulk querying.</p>

<h2>6. Reporting illegal content (notice and action)</h2>
<p>Anyone who believes the service stores illegal content can report it via
the <a href="/kontakt.html">contact form</a> or by e-mail to
<a href="mailto:${mail}">${mail}</a>. So we can review a notice quickly, it
should contain (Art. 16(2) of Regulation (EU) 2022/2065, the "DSA"):</p>
<ul>
  <li>a sufficiently substantiated explanation of why the content is
  allegedly illegal;</li>
  <li>the exact address (URL) of the content — or, where there is no public
  URL, another unambiguous identification (e.g. account, round, game
  title);</li>
  <li>where possible the name and e-mail address of the person submitting the
  notice — this is optional; without it we can neither confirm receipt nor notify
  you of our decision (for content connected to child sexual abuse offences we do
  not ask for contact details anyway);</li>
  <li>a statement that the information provided is accurate and complete to
  the best of their knowledge.</li>
</ul>
<p>We confirm receipt of the notice (where it contains contact details),
review it in a timely, diligent, objective and non-arbitrary manner and
notify the submitter of our decision, including information on available
redress (Art. 16(4)–(6) DSA). We do not use automated decision-making for
this.</p>

<h2>7. Measures in case of violations</h2>
<p>For illegal content or violations of section 5 we may — proportionately
and considering the circumstances of the individual case — remove or block
individual content, restrict features, or temporarily suspend or permanently
close the account. Affected users receive a <strong>statement of
reasons</strong> (Art. 17 DSA): the measure taken, the facts relied on, the
legal ground or the clause of these terms that was breached, and information
on redress. You can object to a measure informally via the contact channels
in the legal notice; recourse to the courts remains unaffected.</p>

<h2>8. Availability, changes and discontinuation of the service</h2>
<p>The service is provided free of charge and without any guaranteed
availability; maintenance and outages can cause interruptions. We continually
develop the service and may change or discontinue features. We will announce
a discontinuation of the service or of essential parts with reasonable
advance notice so you can back up your data; you can informally request an
export of your data at any time.</p>

<h2>9. Liability</h2>
<p>We are liable without limitation for intent and gross negligence, for
damage resulting from injury to life, body or health, and under the German
Product Liability Act. For simple negligence we are liable only for the
breach of essential obligations whose fulfilment makes the proper use of the
service possible in the first place and on whose observance you may
regularly rely (cardinal obligations), limited to the foreseeable damage
typical for this type of contract. Any further liability is excluded.</p>

<h2>10. Points of contact (Arts. 11, 12 DSA)</h2>
<p>The single point of contact for Member State authorities, the Commission
and the European Board for Digital Services (Art. 11 DSA) and for recipients
of the service (Art. 12 DSA) is the e-mail address
<a href="mailto:${mail}">${mail}</a>; the
<a href="/kontakt.html">contact form</a> is available in addition.
Communication is possible in German and English.</p>

<h2>11. Changes to these terms</h2>
<p>We may amend these terms with effect for the future where legal changes,
changes to the service (new or discontinued features) or abuse prevention
require it. We will announce significant changes in the service or by e-mail
(Art. 14(2) DSA); the version published here applies. If you do not agree
with a change, you can stop using the service at any time and have your
account deleted.</p>

<h2>12. Final provisions</h2>
<p>German law applies. Mandatory consumer-protection provisions of the state
of your habitual residence remain unaffected. Should individual provisions be
invalid, the validity of the remaining provisions remains unaffected.</p>
${renderTermsChangelog('en')}`;

  return layout('Nutzungsbedingungen', de, en);
}

module.exports = {
  renderImpressum, renderDatenschutz, renderNutzungsbedingungen,
  legalConfigured, renderAddress, nameAndAddress,
  OPERATOR_NAME,
  IMPRESSUM_REVISION, PRIVACY_REVISION, TERMS_REVISION, LEGACY_TERMS_REVISION,
  termsAcceptanceOf, TERMS_CHANGELOG,
};
