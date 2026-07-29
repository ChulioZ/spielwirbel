/* Spielwirbel – the set of UI locales the app ships.
   Its own file so it can be the SINGLE source of truth: the frontend loads it as
   a shared-scope script (before i18n.js, which reads these globals) and
   routes/contact.js requires it as a CommonJS module to validate the feedback
   metadata. That allowlist used to be a hand-copied ['de', 'en'] — the exact
   shape .claude/rules/shared-constants-across-the-stack.md exists to prevent,
   and one that silently drops the `locale` of feedback submitted from any locale
   nobody remembered to add there (i.e. the field needed to route a "this wording
   is wrong" report to the right language).
   Dependency-free and tiny by design
   (.claude/rules/frontend-helper-modules-and-coverage.md). */

'use strict';

// One row per shipped locale — code, the name in its OWN language, and the
// BCP-47 tag `Intl` needs (dates, months, plural rules).
//
// Adding a language is ONE entry here plus its public/js/lang/<code>.js file
// (and the matching <script> tag + sw.js SHELL entry + CACHE bump). Deriving the
// three lookup shapes below from this table rather than declaring them side by
// side is deliberate: parallel maps are how a locale ends up with a label and no
// tag, which degrades to en-US dates with no error anywhere.
//
// `code` is what detectLocale() matches, and it is matched two characters wide
// (navigator.language.slice(0, 2)) — so a region-tagged code like 'pt-BR' would
// never be auto-detected. Keep codes two letters.
const LOCALES = [
  { code: 'en', label: 'English', tag: 'en-US' },
  { code: 'de', label: 'Deutsch', tag: 'de-DE' },
];

// Order is the picker's order (public/js/core.js setupLangPicker).
const SUPPORTED_LOCALES = LOCALES.map((l) => l.code);
const LOCALE_LABELS = Object.fromEntries(LOCALES.map((l) => [l.code, l.label]));
const LOCALE_TAGS = Object.fromEntries(LOCALES.map((l) => [l.code, l.tag]));

// The BCP-47 tag for a locale, for any Intl constructor. Falls back to the
// English tag rather than to the raw code: an unknown code reaching Intl throws
// a RangeError, which would take a whole screen down over a date.
function localeTag(loc) {
  return LOCALE_TAGS[loc] || LOCALE_TAGS.en;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LOCALES, SUPPORTED_LOCALES, LOCALE_LABELS, LOCALE_TAGS, localeTag };
}
