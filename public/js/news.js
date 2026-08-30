/* Spielwirbel – the „Was ist neu" entry list (issue #741).

   The content behind the /neu screen and the unseen dot on the account button.
   A CODE CONSTANT rather than an operator-authored table on purpose: an entry
   stored in the database would announce features a self-hoster's deployed
   version does not have, while a constant ships WITH the release it describes.
   So an older instance simply shows the list that shipped with it — no version
   negotiation, no "coming soon" entries.

   Kept dependency-free with the module.exports guard: lib/routes/account.js
   requires this file so the server, not the client, decides which revision a
   "seen" stamp records (.claude/rules/shared-constants-across-the-stack.md).

   Modelled on TERMS_CHANGELOG (lib/legal.js), which already solved this exact
   shape: newest first, BOTH languages inline in the entry rather than i18n keys
   — one entry is then one edit, and test/i18n-parity.test.js never has to care —
   and trimmed to roughly the last ten.

   THE BAR FOR ADDING AN ENTRY IS HIGH, and it is stated in
   .claude/rules/keep-readme-current.md: a genuinely new user-facing CAPABILITY,
   nothing else. Every entry spends attention the Nutzungsbedingungen §11 terms
   notice also needs, so this list is a budget, not a log. */

'use strict';

// Deliberately NOT seeded with past releases (same call TERMS_CHANGELOG made):
// seeding would dot every existing account about features most of them joined
// AFTER, which is the exact unearned interruption this design exists to avoid.
const NEWS = [
  /*
   * Clears the bar: an account could not be recognised by anything but two
   * letters, so a picture is something a person could not do at all before —
   * the level of passkeys (#418) or the BGG import (#481).
   *
   * The EXIF line is deliberately in the body rather than left to the privacy
   * policy. It is the one thing about this feature a reader might otherwise
   * worry about, and it is a promise we keep — a phone photo's coordinates are
   * never stored (lib/avatar.js).
   */
  {
    revision: '2026-08-30',
    de: {
      title: 'Profilbild für dein Konto',
      body: 'Du kannst deinem Konto jetzt im Kontobereich ein Bild geben. Es '
        + 'erscheint überall dort, wo dein Konto ohnehin auftaucht: auf deiner '
        + 'Profilseite, im Freundeskreis und auf deinem Sitzplatz in einer Runde. '
        + 'Ohne Bild bleibt alles wie bisher bei den Initialen. Die Metadaten der '
        + 'Bilddatei — auch der GPS-Ort von Handyfotos — entfernen wir beim '
        + 'Hochladen, und du kannst das Bild jederzeit wieder löschen.',
    },
    en: {
      title: 'A profile picture for your account',
      body: 'You can now give your account a picture from the Konto screen. It '
        + 'shows up wherever your account already does: your profile page, the '
        + 'Freundeskreis, and your seat in a round. Without one, everything stays '
        + 'as it was with your initials. We strip the image file\'s metadata on '
        + 'upload — including the GPS location phone photos carry — and you can '
        + 'remove the picture again at any time.',
    },
  },
  /*
   * Clears the capability bar: the app could only ever answer "all time", so
   * „unser Juli" and „unser 2026" were questions it had no way to ask — and the
   * shareable image is a thing the group could not produce at all.
   * Says what the reader can do and where; that it is derived on demand and
   * drawn client-side is the repo's business, not theirs.
   *
   * The LOCATION was corrected by #851 (Pokale -> Chronik) without bumping the
   * revision: the entry was a day old and the capability did not change, so
   * re-lighting the dot would spend attention the terms notice needs.
   */
  {
    revision: '2026-08-29',
    de: {
      title: 'Rückblick auf einen Monat oder ein Jahr',
      body: 'In der Chronik könnt ihr jetzt einen einzelnen Monat oder ein ganzes '
        + 'Jahr auswählen: wie viele Sessions es waren, welche Spiele auf dem Tisch '
        + 'lagen, was am häufigsten gespielt und am besten bewertet wurde, und was in '
        + 'der Zeit ins Regal kam oder es verlassen hat. „Teilen" macht daraus ein '
        + 'Bild für den Gruppenchat.',
    },
    en: {
      title: 'Look back on a month or a year',
      body: 'In the Chronik you can now pick a single month or a whole year: how '
        + 'many sessions there were, which games made it to the table, what you played '
        + 'most and rated best, and what joined or left the shelf in that time. '
        + '"Share" turns it into an image for the group chat.',
    },
  },
  /*
   * The bulk-REMOVE counterpart of the BGG collection import, which is the
   * capability test this clears: the shelf could be filled in one action and
   * emptied only one game (and two steps) at a time. Says what the reader can
   * do and where; the endpoint, the co-owner gate and the retire-first
   * semantics are all the repo's business, not theirs.
   */
  {
    revision: '2026-08-28',
    de: {
      title: 'Regal in einem Rutsch aufräumen',
      body: 'Im Regal gibt es jetzt „Auswählen": Spiele antippen, Suche und Filter '
        + 'dabei ganz normal weiterbenutzen — „Alle auswählen" nimmt genau das, was '
        + 'gerade zu sehen ist. Die Auswahl könnt ihr in einem Schritt aussortieren '
        + 'oder endgültig löschen. Auf „Aussortiert", „Durchgespielt" und der '
        + 'Wunschliste geht dasselbe zum Löschen.',
    },
    en: {
      title: 'Tidy the whole shelf at once',
      body: 'The Regal now has a "Select" mode: tap the games you mean while the '
        + 'search and filters keep working — "Select all" takes exactly what is on '
        + 'screen. Retire the selection, or delete it for good, in one step. The '
        + 'retired, completed and wishlist screens offer the same for deleting.',
    },
  },
  /*
   * A genuinely new capability — a group that could not use the session flow at
   * all can now use it — which is the bar .claude/rules/keep-readme-current.md
   * sets. Says what the reader can DO, deliberately not how the split is chosen:
   * the objective is the interesting half for the repo and the wrong half here.
   */
  {
    revision: '2026-08-21',
    de: {
      title: 'Mehrere Tische an einem Abend',
      body: 'Zu viele für ein Spiel? Setzt beim Auslosen einen Haken bei „Mehrere '
        + 'Tische". Es wird einmal gemeinsam abgestimmt, danach schlägt euch die App '
        + 'fertige Aufteilungen auf zwei, drei oder mehr Tische vor — mit Spiel und '
        + 'Sitzordnung. Ihr könnt alles noch von Hand umstellen und seht dabei sofort, '
        + 'wie zufrieden jeder Tisch ist.',
    },
    en: {
      title: 'Several tables in one evening',
      body: 'Too many of you for one game? Tick "Multiple tables" when you draw. '
        + 'Everyone votes once together, and the app then proposes ready-made splits '
        + 'across two, three or more tables — game and seating included. You can move '
        + 'anyone by hand and see straight away how happy each table is.',
    },
  },
  /*
   * Deliberately says what the reader can DO and where, not how it works. The
   * mechanism (a local BGG corpus, weighted arithmetic, no AI) is the interesting
   * half for the repo and the wrong half here — and naming the scoring would
   * promise a precision a heuristic should not claim.
   */
  {
    revision: '2026-08-14',
    de: {
      title: 'Das könnte euch auch gefallen',
      body: 'Im Regal einer Runde steht jetzt unten „Könnte euch gefallen": Spiele, '
        + 'die ihr noch nicht habt, ausgewählt nach eurem eigenen Regal und euren '
        + 'Wertungen. Jeder Vorschlag sagt dazu, warum er dabei ist — und ein Tipp '
        + 'setzt ihn auf die Wunschliste.',
    },
    en: {
      title: 'You might also like',
      body: 'A round\'s shelf now has a "You might also like" link at the bottom: '
        + 'games you do not own yet, picked from your own shelf and your own '
        + 'ratings. Every suggestion says why it is there — and one tap puts it on '
        + 'your wish list.',
    },
  },
  /*
   * Deliberately GENERAL about what is on the page. Each figure appears only
   * once it clears its own minimum, so which of them a reader actually sees
   * depends on how big the instance is that day — naming them ("see the most
   * played game of the year!") would promise cards that may not be there.
   */
  {
    revision: '2026-08-13',
    de: {
      title: 'Entdecken',
      body: 'Unter „Entdecken" steht jetzt, was auf Spielwirbel insgesamt los ist: '
        + 'wie viel hier zusammengekommen ist und welche Spiele gerade besonders '
        + 'oft im Regal stehen, gespielt oder gut bewertet werden. Du findest die '
        + 'Seite in diesem Menü.',
    },
    en: {
      title: 'Discover',
      body: 'A new "Discover" page shows what is going on across Spielwirbel as a '
        + 'whole: how much has come together here, and which games are currently '
        + 'on especially many shelves, played especially often, or rated '
        + 'especially well. You will find it in this menu.',
    },
  },
  // { revision: '2026-08-20',
  //   de: { title: 'Kurzer Titel', body: 'Was man jetzt tun kann.' },
  //   en: { title: 'Short title', body: 'What you can do now.' } },
];

// The newest entry's revision, or null while the list is empty. Null is what
// makes "no dot, ever" the empty-list behaviour without a second flag.
function newsRevision() { return NEWS.length ? NEWS[0].revision : null; }

// The reader's own language, falling back to English and then German rather
// than straight to German like TERMS_CHANGELOG does. That document is legal
// text where the German version is authoritative; this is product copy, so for
// a locale nobody has translated an entry into (#534–#538 queue five more),
// English is the more useful fallback.
function newsText(entry, lang) {
  return entry[lang] || entry.en || entry.de;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NEWS, newsRevision, newsText };
}
