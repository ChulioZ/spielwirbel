'use strict';

/*
 * Locale resolution for the storefront lookup providers (#505).
 *
 * The four digital storefronts answer in whatever language their URL asks for,
 * so the requesting user's UI locale has to reach them — see lib/routes/lookup.js.
 * That value comes from the REQUEST, and PSSTORE/XBOX interpolate their locale
 * straight into a fetched URL path:
 *
 *   `${BASE}/${locale}/search/${encodeURIComponent(query)}`
 *
 * so letting a request value through unvalidated is a server-side
 * request-forgery primitive (`?lang=../../something` reshapes the URL the
 * server fetches). Hence: a requested locale is never interpolated, only ever
 * used to LOOK UP a value in a closed table — the same allowlist-not-sanitize
 * shape as isAllowedImageUrl in ./index.js. resolveLocale() below can only ever
 * return a value that was already in the table or the caller's own fallback.
 *
 * The tables live in each provider (every storefront spells locales
 * differently); this module owns the lookup rule they share.
 */

// UI locales the app may ask a storefront for. Today the UI itself ships only
// 'en' and 'de' (SUPPORTED_LOCALES in public/js/locales.js); the rest are here
// so the storefront half is already correct when more UI locales land (#504).
// Deliberately a superset and NOT derived from that list: it answers "is this a
// language we recognise at all", which is what lets a not-yet-shipped locale
// fall back to English instead of to the deployment's German.
//
// Its only job is to distinguish "a locale we recognise that THIS storefront
// cannot serve" (fall back to English — a French user is better served by
// English than by the deployment's German) from "a value we do not recognise at
// all" (fall back to the deployment default, i.e. the provider's env var).
const KNOWN_LOCALES = new Set(['de', 'en', 'fr', 'es', 'it', 'nl', 'pt']);

// Map a requested UI locale onto one provider's own spelling of it.
//
// `table` is a Map (deliberately not a plain object: a request-supplied key like
// '__proto__' or 'constructor' cannot reach anything through a Map).
// `fallback` is the deployment default — the provider's env var.
function resolveLocale(table, requested, fallback) {
  const ui = String(requested == null ? '' : requested).trim().toLowerCase();
  if (table.has(ui)) return table.get(ui);
  if (KNOWN_LOCALES.has(ui) && table.has('en')) return table.get('en');
  return fallback;
}

module.exports = { KNOWN_LOCALES, resolveLocale };
