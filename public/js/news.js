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
