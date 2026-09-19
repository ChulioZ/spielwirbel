'use strict';

/* Spielwirbel – tenants the operator card's ADOPTION block leaves out (#1174).
 *
 * The „Funktionsnutzung" card answers „benutzt das überhaupt jemand", and on
 * this instance the operator's own rounds dominate every ratio — they are the
 * oldest, the fullest and the most thoroughly exercised, so „62 % der Runden
 * nutzen eigene Tags" can be true while almost nobody else has ever opened the
 * tag editor. Excluding them is the only way the card describes OTHER people's
 * usage, which is the one thing it exists to say.
 *
 * Scoped to the adoption block ON PURPOSE. The counters (`content`), the totals
 * (`rounds`) and the quota peaks (`peaks`) must keep counting every real tenant:
 * they answer „was hält diese Instanz" and „wer stößt an eine Grenze", and an
 * operator who has hidden themselves from those would be blind to their own
 * quota. `lib/public-stats.js` reads `content` too, so an exclusion reaching it
 * would quietly shrink the public landing counters.
 *
 * Read from the environment on EVERY call rather than at require time: the repo
 * modules are required once per process and long before any test sets this, so
 * a cached copy would make the setting untestable and — worse — silently pin
 * whatever the value was at boot if it were ever set through a restart-free
 * path. It is a short split of a short string, called once per panel load.
 */

function excludedTenants() {
  return [...new Set(
    String(process.env.ADMIN_EXCLUDE_TENANTS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )];
}

module.exports = { excludedTenants };
