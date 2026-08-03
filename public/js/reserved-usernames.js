/* Spielwirbel – handles nobody may register, because they would read as the
   service itself rather than as one of its users. Pure and dependency-free, so it
   works both as a shared-scope frontend script (browser global) and as the
   CommonJS module lib/routes/account.js requires — the register form offers the
   check and the route enforces it, so the two must be ONE file
   (.claude/rules/shared-constants-across-the-stack.md).
   Load order: see index.html. */

'use strict';

// A handle is matched in its NORMALISED form: lower-cased and stripped of
// everything the username charset allows besides letters, i.e. '_', '-' and
// digits. So `Ad-Min`, `admin_` and `admin2026` all collapse onto `admin` and are
// refused together — a reserved word with a separator or a year glued on is
// exactly as convincing an impersonation as the bare word is.
//
// The trap that follows: EVERY entry below must itself already be in this form —
// lower-case letters only, and at least the 3 characters registration demands. An
// entry like 'no-reply' or 'Admin' can never equal a normalised handle, so it
// would silently protect nothing while making the list look longer than it is.
// test/reserved-usernames.test.js asserts the shape of every entry for that reason.
const normalizeUsername = (name) => String(name || '').toLowerCase().replace(/[^a-z]/g, '');

// Matched WHOLE, never as a substring. Ordinary words contain these — 'badminton'
// contains "admin", 'Modernista' contains "mod" — and a refusal at registration is
// a dead end the person hitting it cannot debug, so a false positive costs more
// than a near-miss like `admin-gaming` getting through. German and English both,
// since the UI ships both and either would be believed.
//
// 'demo' is deliberately absent: the guest demo (#427) mints its accounts as
// `demo-<8 hex>`, which normalises onto exactly that word whenever the suffix
// happens to be all digits.
const RESERVED_USERNAMES = new Set([
  // The people who run the service.
  'admin', 'admins', 'administrator', 'administrators', 'administratoren',
  'moderator', 'moderators', 'moderatoren', 'moderation', 'mod', 'mods',
  'operator', 'betreiber', 'staff', 'team', 'official', 'offiziell',
  'root', 'superuser', 'sysadmin', 'systemadmin',
  'webmaster', 'hostmaster', 'postmaster',
  // Channels a user would believe when a message appears to come from one.
  'support', 'service', 'helpdesk', 'help', 'hilfe',
  'contact', 'kontakt', 'info', 'news', 'newsletter',
  'security', 'sicherheit', 'abuse', 'missbrauch',
  'legal', 'impressum', 'datenschutz', 'privacy',
  // Handles that read as the machine talking rather than as a person.
  'system', 'server', 'api', 'www', 'bot', 'robot',
  'mail', 'email', 'noreply', 'donotreply',
  'account', 'accounts', 'konto', 'konten',
  'user', 'users', 'nutzer', 'benutzer',
  'guest', 'gast', 'anonymous', 'anonym',
  'null', 'undefined',
]);

// Refused ANYWHERE inside a handle, not only as the whole of it. Only the brand
// qualifies: `spielwirbel-support` and `SpielwirbelTeam` are the most convincing
// impersonations available, and no legitimate handle needs the word — which is
// precisely what cannot be said of any entry in the set above.
const RESERVED_FRAGMENTS = ['spielwirbel'];

// Whether a handle is refused. Shape (charset, length, uniqueness) is somebody
// else's job — this answers only the impersonation question, so a handle that
// normalises to nothing ('12-34') is not reserved, it is merely not a word.
function isReservedUsername(name) {
  const normalized = normalizeUsername(name);
  if (!normalized) return false;
  if (RESERVED_USERNAMES.has(normalized)) return true;
  return RESERVED_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RESERVED_USERNAMES, RESERVED_FRAGMENTS, normalizeUsername, isReservedUsername };
}
