/* Spielwirbel – internationalization (i18n).
   Loads immediately after js/locales.js (whose globals it reads) and before all
   other scripts. Translations live in js/lang/<locale>.js,
   each registering into the global I18N object (one "properties file" per
   language). The active locale follows the system language by default and can
   be overridden via the picker in the top bar (stored in localStorage). */

const I18N = {};

// SUPPORTED_LOCALES / LOCALE_LABELS / LOCALE_TAGS / localeTag come from
// js/locales.js, which loads first — it is shared with the backend
// (lib/routes/contact.js requires it), so it cannot live here.

let locale = 'en';

// Pick the active locale: saved choice -> system language -> English.
function detectLocale() {
  const saved = localStorage.getItem('locale');
  if (saved && SUPPORTED_LOCALES.includes(saved)) return saved;
  const sys = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return SUPPORTED_LOCALES.includes(sys) ? sys : 'en';
}

// The tab title is written from the active locale (#566), never from the static
// <title> in index.html — that one stays German on purpose, because crawlers and
// link-preview scrapers run no JS and have no locale (see
// .claude/rules/link-preview-card.md). Writing it here is invisible to them by
// construction, so it closes the visitor-facing gap without touching the crawler
// surface. Safe to call t() at this point: initLocale/setLocale both run long
// after the lang tables have registered into I18N.
function applyTabTitle() {
  document.title = t('app.tabTitle');
}

function initLocale() {
  locale = detectLocale();
  document.documentElement.lang = locale;
  applyTabTitle();
}

function getLocale() {
  return locale;
}

function setLocale(loc) {
  if (!SUPPORTED_LOCALES.includes(loc)) return;
  locale = loc;
  localStorage.setItem('locale', loc);
  document.documentElement.lang = loc;
  applyTabTitle();
}

// Translate a key; falls back to English, then to the key itself. Replaces
// {placeholders} from params.
function t(key, params) {
  const dict = I18N[locale] || {};
  let s = key in dict ? dict[key] : I18N.en && key in I18N.en ? I18N.en[key] : key;
  if (params) {
    for (const k in params) s = s.split('{' + k + '}').join(params[k]);
  }
  return s;
}

// One Intl.PluralRules per locale — constructing one is not cheap and tn() runs
// on every card render.
const pluralRules = {};

// Which CLDR plural category `n` falls into for the active locale.
//
// The naive `n === 1` this replaced is right for German and English and wrong
// elsewhere: French and Portuguese put 0 in the SINGULAR ("0 jeu", "0 jogo"),
// so a hardcoded comparison mis-renders every zero state in those languages
// with nothing to notice — the string is still grammatical German logic applied
// to French words.
//
// Intl.PluralRules has existed in every browser this app supports; the guard is
// for a stray non-Intl environment (and for Node's vm sandbox in the tests),
// where falling back to the old rule is exactly right for de/en.
function pluralCategory(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || typeof Intl === 'undefined' || !Intl.PluralRules) {
    return num === 1 ? 'one' : 'other';
  }
  if (!pluralRules[locale]) pluralRules[locale] = new Intl.PluralRules(localeTag(locale));
  return pluralRules[locale].select(num);
}

// Plural helper: choose the "one" or "other" key based on n.
//
// Deliberately two-way. Languages with `few`/`many` categories (Polish, Czech,
// Russian) cannot be expressed by a one/other key pair and are out of scope for
// that reason — they need more keys, not a smarter helper here.
function tn(n, keyOne, keyOther, params) {
  return t(pluralCategory(n) === 'one' ? keyOne : keyOther, Object.assign({ n }, params || {}));
}

// Locale-aware date/time formatting (uses the matching BCP-47 tag).
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString(localeTag(locale), { dateStyle: 'medium', timeStyle: 'short' });
}

// Date only, for stamps where the time of day carries no information — the
// passkey list's added/last-used dates (#418). Deliberately not fmtDateTime:
// "added on 7 Aug 2026, 15:04" invites the reader to compare minutes that mean
// nothing to them.
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(localeTag(locale), { dateStyle: 'medium' });
}

// Month + year, for timeline group labels ("Juli 2026").
function fmtMonth(iso) {
  return new Date(iso).toLocaleString(localeTag(locale), { month: 'long', year: 'numeric' });
}

// Money, in the reader's locale and the upstream's own currency (#679).
//
// The currency comes from the price source, never from the locale: a German
// reader looking at a British shop must see "49,89 £", not a number silently
// relabelled as euros. An unknown or missing code would make
// Intl.NumberFormat throw a RangeError and take the whole screen down over a
// price label — the same reasoning localeTag() applies to an unknown locale — so
// it degrades to the bare number instead.
function fmtMoney(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  try {
    return n.toLocaleString(localeTag(locale), { style: 'currency', currency });
  } catch {
    return n.toFixed(2);
  }
}

// A rating average, always to one decimal in the reader's own notation — "4,6"
// in German, "4.6" in English (#850). Pinned to one digit so a whole number
// still reads as a rating ("4,0 von 5") rather than as a count.
//
// Every Ø the app prints goes through here. `toFixed(1)` is locale-independent
// BY DEFINITION and always emits a dot, so it is never the right call for a
// number a reader looks at — but it stays correct for the three places that
// build a machine string rather than a label (ranking.js's tie key, the detail
// ring's stroke-dasharray, an animation-delay), and those must not be routed
// here.
function fmtAvg(n) {
  // Stricter than fmtMoney's `Number(amount)` on purpose: `Number(null)` is 0,
  // so a coercing guard turns a missing rating into a confident-looking "0,0" —
  // a wrong number on the screen, where the callers all render "–" for absent.
  // Only a real finite number is a rating.
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat(localeTag(locale), {
      minimumFractionDigits: 1, maximumFractionDigits: 1,
    }).format(n);
  } catch {
    // Same reasoning as fmtMoney: a RangeError here would take a whole screen
    // down over a label, so degrade to the bare number.
    return n.toFixed(1);
  }
}

// A number that is only meaningful with its sign — the Siegwertung (#895),
// where „+2,0" says "above chance" and the bare „2,0" would read as a count.
// Rounds to the PRINTED precision before deciding the sign, so a member at
// −0,04 reads „0,0" rather than the nonsense „−0,0"; the `|| 0` is what folds
// negative zero away, since -0 is falsy while (-0).toFixed(1) is "-0.0".
// Negatives keep whatever minus glyph the locale uses, via fmtAvg.
function fmtSigned(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const rounded = Number(n.toFixed(1)) || 0;
  return (rounded > 0 ? '+' : '') + fmtAvg(rounded);
}

// Thousands separators for the active locale, so a counter reads as a number
// rather than as a serial. Falls back to the raw digits where Intl is
// unavailable.
function fmtCount(n) {
  try {
    return new Intl.NumberFormat(localeTag(locale)).format(n);
  } catch {
    return String(n);
  }
}
