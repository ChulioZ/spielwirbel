'use strict';

/*
 * The FAQ page (issue #489): GET /faq, server-rendered, DE authoritative + EN
 * courtesy translation in one script-free document.
 *
 * WHY SERVER-RENDERED rather than a standalone public/faq.html like the contact
 * page. Several answers are true of the operator's instance and false of a
 * self-hosted one — whether donations exist, whether accounts are even on,
 * whether there is a privacy policy to point at. A static page can only hide
 * those with JS from /api/config, and neither a crawler nor a JS-off visitor
 * ever runs it, so the untrue sentence still ships in the bytes
 * (.claude/rules/hidden-attribute-vs-display-rule.md is the same failure one
 * level down). Resolving the gates here means the answer an instance cannot
 * honestly give is simply never rendered.
 *
 * The page itself is deliberately NOT gated the way lib/routes/legal.js is: an
 * FAQ carries no legal precondition, so it answers 200 everywhere and just
 * drops what does not apply.
 *
 * Content rules — keep them when editing:
 *  - Every answer must be checkable against this repo. No aspiration, no
 *    roadmap, nothing the code does not do today: "an export is planned" is a
 *    promise that goes stale on its own the moment the plan changes.
 *  - **No links into the issue tracker** (operator decision, 2026-08-02). An
 *    open issue was tried here as a way to say "this is being discussed" without
 *    promising an outcome — the distinction holds, but this is a page for people
 *    deciding whether to sign up, not a development surface, and sending them to
 *    GitHub is the wrong impression. The repository link in the maintenance
 *    answer is deliberately different: there the source being public IS the
 *    answer to the question asked.
 *  - Donations may say what the money and time go INTO; they may not say the
 *    service depends on them, imply anything is withheld without them, or
 *    suggest a donor gets something. The "unlocks nothing" sentence leads that
 *    answer on purpose and must stay ahead of the rest (#173 — donations are
 *    unconditional).
 *  - Never restate a processing description from the privacy policy in
 *    different words; LINK it (.claude/rules/keep-legal-docs-current.md). A
 *    second, drifting copy of a data-protection statement is the failure that
 *    rule exists for, and test/faq.test.js pins the markers.
 *  - German is authoritative; the English half says so, like the legal pages.
 *  - An answer that stops being true is a bug in the same PR that made it
 *    untrue (.claude/rules/keep-readme-current.md lists this page).
 *
 * Nothing here interpolates env or user input — every string is a literal in
 * this file — so unlike lib/legal.js there is no escaping to get wrong.
 */

const legal = require('./legal');
const accounts = require('./accounts');

// The public repository, also offered by the landing page's "source" chip as
// LANDING_REPO_URL (public/js/views-landing.js). The SPA file is a shared-global
// script with no module.exports, so it cannot be required from here the way
// .claude/rules/shared-constants-across-the-stack.md prefers; test/faq.test.js
// asserts the two spellings agree instead — that parity check is the licence
// for this copy, the TAG_ICONS shape.
const REPO_URL = 'https://github.com/ChulioZ/spielwirbel';

function donationsConfigured() { return (process.env.DONATE_URL || '').trim() !== ''; }

/*
 * The questions, in reading order. `gate` (optional) decides whether this
 * instance can answer honestly at all; without one the answer holds everywhere.
 *
 * Note what each gate really stands for:
 *  - `legal.legalConfigured()` — the instance publishes an Impressum and a
 *    privacy policy, so the routes those answers link actually serve something.
 *    Both the "your data" answers hang off it, because both of them work by
 *    pointing at the policy rather than paraphrasing it.
 *  - `accounts.accountsEnabled()` — the account model exists. With accounts off
 *    (a self-hosted, password-only instance) nobody has an account at all, so
 *    the question does not arise rather than having a different answer.
 */
const QUESTIONS = [
  {
    id: 'accounts',
    gate: () => accounts.accountsEnabled(),
    de: {
      q: 'Brauchen alle ein Konto?',
      a: `<p>Nein. Ein Konto braucht nur, wer eine Runde anlegt. Alle anderen
sind <strong>reine Namensplätze</strong> in dieser Runde — ohne E-Mail-Adresse,
ohne Passwort, ohne Registrierung.</p>
<p>Eine Runde kann komplett von einem Gerät laufen: Ihr gebt es beim Abstimmen
herum, statt dass sich alle einzeln anmelden.</p>
<p>Ihr könnt aber auch mischen — pro Person, ohne vorher etwas einzustellen: Wer
ein Konto hat, verknüpft seinen Platz damit und stimmt vom eigenen Gerät ab.</p>
<p>Und ganz ohne Konto geht es auch: Zu jeder laufenden Abstimmung lässt
sich ein <strong>Link</strong> teilen. Wer ihn bekommt, wählt seinen Namen aus
der Teilnehmerliste und bewertet vom eigenen Gerät — ohne Registrierung. Der Link
zeigt nur die ausgelosten Spiele und wer schon abgestimmt hat, nie die Stimmen
selbst, und er gilt nur bis zum Ende dieser Abstimmung.</p>`,
    },
    en: {
      q: 'Does everyone need an account?',
      a: `<p>No. Only the person who sets up a round needs one. Everybody else is
a <strong>name-only seat</strong> in that round — no e-mail address, no
password, no sign-up.</p>
<p>A round can run entirely from one device: you pass it around to vote, rather
than everyone signing in separately.</p>
<p>You can also mix, per person and with nothing to set up beforehand: anyone who
does have an account links their seat to it and votes from their own device.</p>
<p>It also works with no account at all: any running vote can be shared
as a <strong>link</strong>. Whoever receives it picks their name from the
participant list and rates the games on their own device — no sign-up. The link
shows only the drawn games and who has voted so far, never the votes themselves,
and it works only until that vote ends.</p>`,
    },
  },
  {
    id: 'score',
    de: {
      q: 'Warum passt der Score nicht zum Durchschnitt der Bewertungen?',
      a: `<p>Weil er mehr ist als der Durchschnitt. Der
<strong>Spielwirbel-Score</strong> gewichtet jede Stimme, bevor er mittelt: Wenn
jemand ein Spiel <em>gar nicht</em> spielen möchte, zählt das schwerer als eine
gute Bewertung von jemand anderem.</p>
<p>Der Grund ist einfach: Bei zwei Spielen mit demselben Durchschnitt ist das
eine für alle in Ordnung, und beim anderen sitzt eine Person dabei, die nicht
mag. Das sind zwei sehr verschiedene Empfehlungen — der Durchschnitt allein kann
sie nicht auseinanderhalten.</p>
<p>Solange niemand schlechter als „geht so" bewertet hat, weicht der Score aus
diesem Grund nicht ab — und wenn er es tut, steht daneben, was es war, etwa
„1× gar nicht". Den reinen Durchschnitt aller Bewertungen findet ihr weiterhin
unten auf der Seite des Spiels.</p>
<p>Ein zweiter Grund kommt dazu: Ein Spiel mit erst wenigen Bewertungen wird
vorsichtiger eingeschätzt. Sein Score liegt näher an der Mitte der Skala, bis
ein paar Sessions zusammengekommen sind — damit ein Spiel, das an einem einzigen
Abend drei Bestnoten bekommen hat, nicht dauerhaft über allem steht, worüber ihr
euch wirklich eine Meinung gebildet habt. Umgekehrt zählt es deutlich, wenn ihr
ein Spiel immer wieder auf den Tisch legt: Auch ohne Bewertungen bekommt es
dadurch einen Score.</p>
<p>In den Score eines Spiels gehen nur dessen eigene Bewertungen und Partien
ein — nie, wie eure anderen Spiele abgeschnitten haben. Dieselben Stimmen und
Partien ergeben deshalb in jeder Runde dieselbe Zahl.</p>`,
    },
    en: {
      q: 'Why does the score not match the average of the ratings?',
      a: `<p>Because it is more than the average. The <strong>Spielwirbel
score</strong> weighs each vote before averaging: if somebody does
<em>not at all</em> want to play a game, that counts for more than a good rating
from somebody else.</p>
<p>The reason is simple: take two games with the same average. Everybody is fine
with one of them, and at the other there is a person sitting there who would
rather not. Those are two very different recommendations, and the average alone
cannot tell them apart.</p>
<p>As long as nobody rated below „so-so", the score does not diverge for that
reason — and when it does, it says what, right beside it, for example „1× not at
all". The plain average of all ratings is still shown at the bottom of the
game's page.</p>
<p>There is a second reason it can differ: a game with only a few ratings so far
is judged more cautiously. Its score sits closer to the middle of the scale
until a few sessions have added up — so a game that collected three top marks on
one single night does not permanently outrank everything you have really formed
a view on. It works the other way round too: a game you keep putting on the
table earns real credit for it, and gets a score even without ratings.</p>
<p>Only a game's own ratings and plays go into its score — never how your other
games happen to have done. The same votes and plays therefore produce the same
number in every round.</p>`,
    },
  },
  {
    id: 'mail',
    gate: () => accounts.accountsEnabled(),
    de: {
      q: 'Bekomme ich dann ständig E-Mails?',
      a: `<p>Nein. Wir schreiben dir nur, wenn jemand eine Antwort von dir
braucht: bei einer <strong>Einladung zu einer Runde</strong> und bei einer
<strong>Freundschaftsanfrage</strong>. Dazu kommen die üblichen Konto-E-Mails
(Adresse bestätigen, Passwort zurücksetzen).</p>
<p>Es gibt keinen Newsletter und keine Werbung, und darüber, was deine Freunde
gerade spielen, schreiben wir dir nie. Mehr als eine Nachricht pro Stunde
bekommst du nicht — treffen mehrere Anfragen ein, fassen wir sie zusammen. Beide
Arten kannst du in deinem Konto einzeln abschalten.</p>`,
    },
    en: {
      q: 'Will you keep e-mailing me?',
      a: `<p>No. We only write when someone needs an answer from you: a
<strong>round invitation</strong> or a <strong>friend request</strong>. On top of
that there are the usual account e-mails (confirm your address, reset your
password).</p>
<p>There is no newsletter and no advertising, and we never write to you about
what your friends are playing. You will not get more than one message an hour —
if several requests arrive, we combine them. You can switch both kinds off
individually in your account.</p>`,
    },
  },
  {
    id: 'free',
    de: {
      q: 'Ist das wirklich kostenlos? Wo ist der Haken?',
      a: `<p>Es gibt keinen. Es gibt keine kostenpflichtige Stufe, keine
Funktionen hinter einer Bezahlschranke und keine Werbung.</p>
<p>Es sind auch keine Analyse- oder Tracking-Skripte eingebaut und es werden
keine Skripte von Dritten geladen — es gibt schlicht nichts, was hier
weiterverkauft würde.</p>`,
    },
    en: {
      q: 'Is it really free? What is the catch?',
      a: `<p>There isn't one. There is no paid tier, no feature behind a
paywall, and no advertising.</p>
<p>There are no analytics or tracking scripts either, and no third-party
scripts are loaded — there is simply nothing here to resell.</p>`,
    },
  },
  {
    id: 'donations',
    gate: donationsConfigured,
    de: {
      q: 'Wozu dann der Spenden-Button?',
      a: `<p>Spenden sind freiwillig und schalten <strong>nichts</strong> frei —
wer spendet, bekommt keine zusätzlichen Funktionen, und wer nicht spendet,
verliert keine.</p>
<p>Wohin es geht: Server, Datenbank, Domain und Mailversand kosten laufend Geld,
und Betrieb, Wartung und neue Funktionen kosten Zeit. Spielwirbel wird
nebenher entwickelt und aus eigener Tasche bezahlt — eine Spende ist schlicht
ein Danke dafür.</p>
<p>Die App enthält keinen Bezahl-Code und bindet kein fremdes Widget ein: Zur
Spendenplattform wird erst dann überhaupt eine Verbindung aufgebaut, wenn du
den Link anklickst.</p>`,
    },
    en: {
      q: 'So what is the donate button for?',
      a: `<p>Donations are voluntary and unlock <strong>nothing</strong> —
donating gets you no extra features, and not donating costs you none.</p>
<p>Where it goes: servers, the database, the domain and sending mail cost money
every month, and running, maintaining and building Spielwirbel costs time. It is
developed on the side and paid for out of pocket — a donation is simply a thank
you for that.</p>
<p>The app contains no payment code and embeds no third-party widget: nothing
is loaded from (or sent to) the donation platform until you click the link.</p>`,
    },
  },
  {
    id: 'app',
    de: {
      q: 'Gibt es eine App?',
      a: `<p>Jein. Spielwirbel lässt sich über den Browser <strong>zum
Startbildschirm hinzufügen</strong> und verhält sich danach wie eine App:
eigenes Icon, eigenes Fenster, funktioniert auch offline.</p>
<p>Im Bereich <strong>Konto</strong> findest du dafür einen eigenen Abschnitt —
je nach Browser mit einem Installieren-Knopf oder mit den zwei Schritten über
das Teilen-Menü.</p>
<p>Einen Eintrag im App Store oder bei Google Play gibt es nicht.</p>`,
    },
    en: {
      q: 'Is there an app?',
      a: `<p>Yes and no. Spielwirbel can be <strong>added to your home
screen</strong> from the browser and behaves like an app afterwards: its own
icon, its own window, and it works offline.</p>
<p>The <strong>Account</strong> screen has a section for it — either an install
button or the two Share-menu steps, depending on your browser.</p>
<p>There is no App Store or Google Play listing.</p>`,
    },
  },
  {
    id: 'boardgames',
    de: {
      q: 'Geht das nur für Brettspiele?',
      a: `<p>Die Titelsuche ja: Beim Anlegen eines Spiels sucht das Titelfeld bei
<strong>BoardGameGeek</strong> und übernimmt Titel, Cover und Spieleranzahl.</p>
<p>Ins Regal darf aber alles. Von Hand eintragen geht genauso — dann ist völlig
egal, was für ein Spiel es ist, es wird nur nichts automatisch ausgefüllt.</p>`,
    },
    en: {
      q: 'Is it only for board games?',
      a: `<p>The title search is: when you add a game, the title field searches
<strong>BoardGameGeek</strong> and fills in the title, cover art and player
count for you.</p>
<p>The shelf itself takes anything. Typing a game in by hand works just as well —
it can then be whatever you like, it just won't fill itself in.</p>`,
    },
  },
  {
    id: 'export',
    gate: () => legal.legalConfigured(),
    de: {
      q: 'Kommen wir an unsere Daten wieder heran?',
      a: `<p>Ja. Schreib uns über das <a href="/kontakt.html">Kontaktformular</a>,
dann bekommst du deine Daten heraus. Wie das abläuft, steht in der
<a href="/datenschutz">Datenschutzerklärung</a>.</p>
<p>Einen vollständigen Export direkt in der App — ein Klick, eine Datei — gibt es
derzeit nicht. Einzelne gespielte Partien kannst du aber an
<strong>BG Stats</strong> übergeben, wenn du das in deinem Konto einschaltest:
Auf der Ergebnisseite einer beendeten Session erscheint dann ein Link, der die
Partie dorthin überträgt.</p>`,
    },
    en: {
      q: 'Can we get our data back out?',
      a: `<p>Yes. Get in touch through the <a href="/kontakt.html">contact
form</a> and you will get your data. How that works is described in the
<a href="/datenschutz">privacy policy</a>.</p>
<p>There is currently no one-click full export from inside the app itself. You
can, however, send individual plays to <strong>BG Stats</strong> once you switch
that on in your account: a finished session's results screen then shows a link
that hands the play across.</p>`,
    },
  },
  {
    id: 'data',
    gate: () => legal.legalConfigured(),
    de: {
      q: 'Wo liegen unsere Daten?',
      a: `<p>Das hängt davon ab, wer diese Instanz betreibt. Welche Dienstleister
eingesetzt werden und wo gespeichert wird, steht vollständig in der
<a href="/datenschutz">Datenschutzerklärung</a> — wir schreiben es hier
absichtlich nicht in eigenen Worten daneben, damit es nur eine verbindliche
Fassung gibt.</p>`,
    },
    en: {
      q: 'Where is our data stored?',
      a: `<p>That depends on who runs this instance. Which providers are used and
where data is stored is set out in full in the <a href="/datenschutz">privacy
policy</a> — deliberately not restated here in different words, so that there is
only one binding version.</p>`,
    },
  },
  {
    id: 'maintenance',
    de: {
      q: 'Was passiert, wenn ihr aufhört?',
      a: `<p>Der Quellcode ist öffentlich und lesbar:
<a href="${REPO_URL}" rel="noopener">${REPO_URL.replace('https://', '')}</a>.
Er darf für nicht-kommerzielle Zwecke selbst betrieben werden — wer will, kann
Spielwirbel also auf einem eigenen Server weiterlaufen lassen.</p>
<p>Das ist keine Garantie, dass der Dienst ewig läuft. Es ist die Zusage, dass
er nicht mit einer Person verschwindet.</p>`,
    },
    en: {
      q: 'What happens if you stop maintaining this?',
      a: `<p>The source code is public and readable:
<a href="${REPO_URL}" rel="noopener">${REPO_URL.replace('https://', '')}</a>.
It may be self-hosted for noncommercial purposes — so anyone who wants to can
keep Spielwirbel running on their own server.</p>
<p>That is not a promise that the service runs forever. It is a promise that it
does not disappear with one person.</p>`,
    },
  },
];

// The questions this instance can answer honestly, in reading order.
function activeQuestions() {
  return QUESTIONS.filter((q) => !q.gate || q.gate());
}

// One question. The id is suffixed per language because BOTH halves render the
// same question list into one document — without the suffix every id appears
// twice, which is invalid HTML and makes `#faq-app` ambiguous as an anchor. The
// German half keeps the bare id so it stays the stable, linkable one.
function renderSection(q, lang) {
  const { q: question, a: answer } = q[lang];
  const id = lang === 'en' ? `faq-${q.id}-en` : `faq-${q.id}`;
  return `
<section id="${id}" class="qa">
  <h2>${question}</h2>
  ${answer}
</section>`;
}

/* --------------------------------- the page -------------------------------- */

// The legal links in the foot line share the legal gate — those routes 404
// while the identity is unconfigured, so linking them would be a dead end (the
// same all-or-nothing condition the site footer applies via /api/config).
function footLinks(lang) {
  const back = lang === 'en' ? '← Back to Spielwirbel' : '← Zurück zu Spielwirbel';
  if (!legal.legalConfigured()) return `<p class="foot"><a href="/">${back}</a></p>`;
  return `<p class="foot"><a href="/">${back}</a>
· <a href="/impressum">Impressum</a>
· <a href="/datenschutz">Datenschutz</a>
· <a href="/nutzungsbedingungen">Nutzungsbedingungen</a>
· <a href="/kontakt.html">Kontakt</a></p>`;
}

/*
 * The whole document. The CSS is written INLINE in this template rather than
 * built from a `const` above, and that is load-bearing rather than a style
 * choice: test/standalone-page-brand.test.js reads this file as TEXT and pulls
 * the rules out of `<style>…</style>`. Hoist the CSS into a constant and the tag
 * contains an interpolation instead of declarations, so the test's "no palette
 * hex outside the :root copy" assertion scans an empty string and passes
 * vacuously — the exact failure .claude/rules/break-the-code-on-purpose.md is
 * about. Verified by hoisting it on purpose and watching that assertion stay
 * green over a stray hardcoded colour.
 *
 * The design tokens themselves are COPIED from public/styles.css, exactly as
 * public/kontakt.html copies them and for the same reason: linking the real
 * stylesheet would drag the whole SPA sheet — including its `body` and `.card`
 * rules and its per-round :root theme — onto a page that has no round context
 * and must render for a logged-out visitor. That test walks the copy and fails
 * if any value drifts; it is the licence for the duplication
 * (.claude/rules/shared-constants-across-the-stack.md).
 */
function renderFaq() {
  const active = activeQuestions();
  const de = active.map((q) => renderSection(q, 'de')).join('\n');
  const en = active.map((q) => renderSection(q, 'en')).join('\n');

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Häufige Fragen · Spielwirbel</title>
  <meta name="description" content="Antworten auf die häufigsten Fragen zu Spielwirbel: Konten, Kosten, Daten und App-Installation." />
  <link rel="manifest" href="/manifest.webmanifest" />
  <!-- Matches manifest.webmanifest's theme_color, like index.html and
       login.html: every page linking the manifest is a PWA install surface, and
       a differing value tints the app chrome differently depending on which page
       the install started from (#595). -->
  <meta name="theme-color" content="#c2410c" />
  <link rel="icon" href="/icons/icon-192.png" sizes="192x192" type="image/png" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
  <link rel="canonical" href="https://spielwirbel.app/faq" />
  <style>
    :root {
      --page-bg: #f4f1ea;
      --brand: #c2410c;
      --surface: #ffffff;
      --ink: #2b2620;
      --ink-soft: #6b6358;
      --line: color-mix(in oklab, var(--page-bg), #000 7%);
      --sunken: color-mix(in oklab, var(--page-bg), #000 4%);
      --brand-dark: color-mix(in oklab, var(--brand), #000 13%);
      --page-glow: color-mix(in oklab, var(--brand) 7%, transparent);
      --radius-lg: 18px;
      --shadow-2: 0 2px 8px rgba(0, 0, 0, 0.08), 0 8px 24px rgba(0, 0, 0, 0.06);
      --font: "Nunito", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-display: "Baloo 2", "Nunito", -apple-system, BlinkMacSystemFont, sans-serif;
    }
    /* Only the weights this page uses. Same self-hosted files as the SPA — no
       new origin, so the CSP is untouched, and the build copies fonts through
       unhashed so these paths hold in dist/ too. */
    @font-face { font-family: 'Nunito'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/nunito-latin-400-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Nunito'; font-style: normal; font-weight: 600; font-display: swap; src: url('/fonts/nunito-latin-600-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Baloo 2'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/baloo-2-latin-700-normal.woff2') format('woff2'); }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      /* The app's backdrop: a soft accent glow falling from the top over a
         barely-there paper grain (the \`body\` rule in public/styles.css). */
      background-color: var(--page-bg);
      background-image:
        radial-gradient(120% 70% at 50% 0%, var(--page-glow), transparent 70%),
        url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='180'%20height='180'%3E%3Cfilter%20id='g'%20x='0'%20y='0'%20width='100%25'%20height='100%25'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.9'%20numOctaves='2'%20seed='7'%20stitchTiles='stitch'/%3E%3CfeColorMatrix%20type='matrix'%20values='0%200%200%200%200%200%200%200%200%200%200%200%200%200%200%200%200%200%200.06%200'/%3E%3C/filter%3E%3Crect%20width='100%25'%20height='100%25'%20filter='url(%23g)'/%3E%3C/svg%3E");
      background-attachment: fixed;
      color: var(--ink);
      font-family: var(--font);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      padding: 2rem 1.5rem 4rem;
    }
    .card {
      width: 100%;
      max-width: 680px;
      margin: 0 auto;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 2rem 1.75rem;
      box-shadow: var(--shadow-2);
    }
    .brand { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.25rem; }
    .brand img { display: block; width: 32px; height: 32px; border-radius: 9px; }
    .brand span { font-family: var(--font-display); font-weight: 700; font-size: 1.15rem; color: var(--brand); }
    h1 { font-family: var(--font-display); font-size: 1.6rem; font-weight: 700; margin: 0 0 0.4rem; }
    .intro { font-size: 0.92rem; color: var(--ink-soft); margin: 0 0 2rem; }
    .lang-note { background: var(--sunken); border-radius: 12px; padding: 0.7rem 1rem; font-size: 0.9rem; margin: 0 0 2rem; }
    /* One question. The accent rule on the left is the app's own "highlight"
       treatment, so the page reads as the same product. */
    .qa { border-left: 3px solid var(--line); padding-left: 1.1rem; margin: 0 0 1.9rem; }
    .qa h2 { font-family: var(--font-display); font-size: 1.1rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--brand); }
    .qa p { margin: 0 0 0.7rem; font-size: 0.97rem; }
    .qa p:last-child { margin-bottom: 0; }
    a { color: var(--brand-dark); }
    hr.split { margin: 3rem 0; border: 0; border-top: 2px solid var(--line); }
    .foot { margin-top: 2.5rem; text-align: center; font-size: 0.88rem; color: var(--ink-soft); }
    .foot a { color: var(--ink-soft); }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">
      <img src="/icons/icon-192.png" alt="" width="32" height="32" />
      <span>Spielwirbel</span>
    </div>
    <h1>Häufige Fragen</h1>
    <p class="intro">Was Leute vor der Anmeldung am häufigsten wissen wollen —
      und was danach noch aufkommt. <a href="#en">English version below</a></p>
${de}
    <hr class="split" id="en">
    <div lang="en">
      <h1>Frequently asked questions</h1>
      <p class="lang-note">Courtesy translation — the German version above is
        authoritative.</p>
${en}
    </div>
${footLinks('de')}
  </main>
</body>
</html>`;
}

module.exports = { renderFaq, QUESTIONS, activeQuestions, REPO_URL };
