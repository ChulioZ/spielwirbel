'use strict';

/* "Not English" is not "German" — issue #822.
 *
 * Two surfaces used to pick their language with `x === 'en' ? en : de`, i.e.
 * they treated German as the fallback for everything they did not recognise.
 * That is only correct while the app ships exactly two languages, and it is
 * already wrong for a visitor whose system language is French, Spanish or
 * Italian: they are handed German text they cannot read. The rule both sites
 * follow now is the one `public/js/news.js` states out loud — legal text whose
 * German version is authoritative stays German, but *selecting* which language
 * a reader is shown falls back to English.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const { loadApp } = require('./support/dom');

const ROOT = path.join(__dirname, '..');
const KONTAKT_HTML = fs.readFileSync(path.join(ROOT, 'public', 'kontakt.html'), 'utf8');
const KONTAKT_JS = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pages', 'kontakt.js'), 'utf8');

/* kontakt.js is a page IIFE outside the SPA's shared scope, so it has no entry
   in index.html and `test/support/dom.js` never sees it. Boot it the same way
   that harness does — the real markup in jsdom, the script through `vm` so it
   stays out of the coverage report. */
function loadKontakt({ saved, systemLanguage }) {
  const dom = new JSDOM(KONTAKT_HTML, {
    url: 'https://spielwirbel.app/kontakt.html',
    runScripts: 'outside-only',
  });
  if (saved !== undefined) dom.window.localStorage.setItem('locale', saved);
  Object.defineProperty(dom.window.navigator, 'language', {
    value: systemLanguage,
    configurable: true,
  });
  // Guard the stub itself: jsdom answers 'en-US' by default, so a defineProperty
  // that failed to take would make every "system language is X" case below pass
  // for the wrong reason.
  assert.equal(dom.window.navigator.language, systemLanguage, 'navigator.language stub did not take');

  const ctx = dom.getInternalVMContext();
  // The page probes /api/config on load; the rejection is swallowed by its own
  // .catch(), and a spec that reaches the network is a bug in the spec.
  ctx.fetch = () => Promise.reject(new Error('locale-fallback.test.js: unstubbed fetch'));
  vm.runInContext(KONTAKT_JS, ctx, { filename: 'public/js/pages/kontakt.js' });
  return dom;
}

const shownLang = (dom) => dom.window.document.documentElement.lang;
const heading = (dom) => dom.window.document.getElementById('t-title').textContent;

test('kontakt.html: a saved locale that is neither de nor en shows English, not German', () => {
  const dom = loadKontakt({ saved: 'fr', systemLanguage: 'fr-FR' });
  assert.equal(shownLang(dom), 'en');
  assert.equal(heading(dom), 'Contact');
  dom.window.close();
});

test('kontakt.html: a non-German system language with no saved choice shows English', () => {
  const dom = loadKontakt({ systemLanguage: 'es-ES' });
  assert.equal(shownLang(dom), 'en');
  assert.equal(heading(dom), 'Contact');
  dom.window.close();
});

test('kontakt.html: German stays German — saved choice and system language alike', () => {
  const saved = loadKontakt({ saved: 'de', systemLanguage: 'en-US' });
  assert.equal(shownLang(saved), 'de');
  assert.equal(heading(saved), 'Kontakt');
  saved.window.close();

  const system = loadKontakt({ systemLanguage: 'de-AT' });
  assert.equal(shownLang(system), 'de');
  system.window.close();
});

test('kontakt.html: a saved English choice still wins over a German system language', () => {
  const dom = loadKontakt({ saved: 'en', systemLanguage: 'de-DE' });
  assert.equal(shownLang(dom), 'en');
  dom.window.close();
});

/* The terms-notice link (setupTermsBanner, public/js/account.js). The document
   itself is unchanged: it carries the authoritative German change summary at
   #aenderungen followed by the English one at #changes-en — this is only about
   which of the two a reader is dropped on. */
function bannerHref(locale) {
  const dom = loadApp({ locale: 'de' });
  try {
    dom.set('accountsActive', () => true);
    dom.set('isLoggedIn', () => true);
    dom.run(`accountUser = { termsRevision: '2026-08-22', acceptedTermsRevision: '2026-01-01' };`);
    // The SPA only ships de/en today, so setLocale() would reject 'fr' outright.
    // Assign the lexical binding directly: the point of the fix is that
    // getLocale() answering anything other than 'de' lands on the English
    // summary, whether or not that locale has shipped yet.
    dom.run(`locale = ${JSON.stringify(locale)};`);
    dom.call('setupTermsBanner');
    const bar = dom.document.getElementById('termsBanner');
    // Without this the whole spec is vacuous: an early return leaves the static
    // href from index.html (#aenderungen) in place, which the German case would
    // happily accept.
    assert.equal(bar.hidden, false, 'the terms notice did not render — the assertion below would be vacuous');
    return new URL(dom.document.getElementById('termsBannerLink').href, 'https://spielwirbel.app').hash;
  } finally {
    dom.close();
  }
}

test('the terms notice links to the German summary for German readers', () => {
  assert.equal(bannerHref('de'), '#aenderungen');
});

test('the terms notice links to the English summary for every other locale', () => {
  assert.equal(bannerHref('en'), '#changes-en');
  assert.equal(bannerHref('fr'), '#changes-en');
  assert.equal(bannerHref('es'), '#changes-en');
});
