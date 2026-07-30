'use strict';

/*
 * The locale layer itself (#504): the shared table in public/js/locales.js and
 * the two things i18n.js derives from it — plural category and date formatting.
 *
 * The point of these specs is that the layer is locale-count-agnostic: nothing
 * here may pass because the app happens to ship exactly German and English.
 * Hence the "a locale registered at runtime" tests, which do precisely what a
 * translation issue (#534-#538) does — add a row to the table and a lang file —
 * and assert the engine picks it up with no further code change.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const locales = require('../public/js/locales');

// The real i18n.js over the real locales.js, in a sandbox with the few browser
// globals it touches. Returns the context so a test can drive setLocale/tn/fmt*.
function loadI18n() {
  const dir = path.join(__dirname, '..', 'public', 'js');
  const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');
  const context = {
    I18N: {},
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: {} },
    navigator: { language: 'en' },
    Intl,
  };
  vm.createContext(context);
  vm.runInContext(read('locales.js'), context);
  vm.runInContext(read('i18n.js'), context);
  vm.runInContext(read('lang/en.js'), context);
  vm.runInContext(read('lang/de.js'), context);
  return context;
}

/* ------------------------------- the table -------------------------------- */

test('every supported locale has a native label and a BCP-47 tag', () => {
  for (const code of locales.SUPPORTED_LOCALES) {
    assert.ok(locales.LOCALE_LABELS[code], `no LOCALE_LABELS entry for '${code}'`);
    assert.ok(locales.LOCALE_TAGS[code], `no LOCALE_TAGS entry for '${code}'`);
    // A tag Intl cannot parse throws a RangeError at render time, not here.
    assert.doesNotThrow(() => new Intl.PluralRules(locales.LOCALE_TAGS[code]), `unusable tag for '${code}'`);
  }
});

test('locale codes are two letters, so detectLocale() can match them', () => {
  // detectLocale() compares against navigator.language.slice(0, 2), so a
  // region-tagged code like 'pt-BR' would never be auto-detected.
  for (const code of locales.SUPPORTED_LOCALES) {
    assert.match(code, /^[a-z]{2}$/, `locale code '${code}' is not a bare two-letter code`);
  }
});

test('localeTag falls back to English rather than handing Intl an unknown code', () => {
  assert.equal(locales.localeTag('en'), 'en-US');
  assert.equal(locales.localeTag('de'), 'de-DE');
  assert.equal(locales.localeTag('zz'), 'en-US');
  assert.equal(locales.localeTag(undefined), 'en-US');
});

/* ------------------------------ plural rules ------------------------------ */

test('German and English plurals are unchanged by the Intl.PluralRules switch', () => {
  const ctx = loadI18n();
  for (const loc of ['de', 'en']) {
    ctx.setLocale(loc);
    // The pre-#504 rule was `n === 1`; these are the cases the app renders.
    assert.equal(ctx.tn(1, 'players.one', 'players.single'), ctx.t('players.one', { n: 1 }), `${loc}: 1`);
    assert.equal(ctx.tn(0, 'players.one', 'players.single'), ctx.t('players.single', { n: 0 }), `${loc}: 0`);
    assert.equal(ctx.tn(2, 'players.one', 'players.single'), ctx.t('players.single', { n: 2 }), `${loc}: 2`);
  }
});

test('a locale registered at runtime gets its own plural rule — 0 is singular in French', () => {
  const ctx = loadI18n();

  // Exactly what adding a translation does: one row in the table plus a lang
  // file. Both are mutated in place — the `const` bindings hold an array and
  // two plain objects, which is what makes a locale a data change.
  vm.runInContext(`
    LOCALES.push({ code: 'fr', label: 'Français', tag: 'fr-FR' });
    SUPPORTED_LOCALES.push('fr');
    LOCALE_LABELS.fr = 'Français';
    LOCALE_TAGS.fr = 'fr-FR';
    I18N.fr = { 'players.one': '{n} joueur', 'players.single': '{n} joueurs' };
  `, ctx);

  ctx.setLocale('fr');
  // French (and Portuguese) put 0 in the SINGULAR. The rule this replaced —
  // `n === 1` — renders "0 joueurs" here, which is the regression this pins.
  assert.equal(ctx.tn(0, 'players.one', 'players.single'), '0 joueur');
  assert.equal(ctx.tn(1, 'players.one', 'players.single'), '1 joueur');
  assert.equal(ctx.tn(2, 'players.one', 'players.single'), '2 joueurs');
});

/* ------------------------------- tab title -------------------------------- */

// i18n.js declares its own `const I18N`, a LEXICAL binding that never lands on
// the context object — so the `I18N: {}` handed to the sandbox stays empty and
// the lang tables are only reachable from inside.
const tabTitle = (ctx, loc) => vm.runInContext(`I18N['${loc}']['app.tabTitle']`, ctx);

test('initLocale writes the tab title from the active locale (#566)', () => {
  const ctx = loadI18n();
  // The sandbox document starts with no title at all, so a missing write leaves
  // this undefined rather than passing against a stale value.
  assert.equal(ctx.document.title, undefined, 'precondition: nothing has written a title yet');

  ctx.initLocale();
  // navigator.language is 'en' and localStorage is empty, so detectLocale() -> en.
  assert.equal(ctx.document.title, tabTitle(ctx, 'en'));
});

test('switching the locale updates the tab title in both directions (#566)', () => {
  const ctx = loadI18n();

  // Asserted against the dictionaries rather than against literals: the copy is
  // free to tune, the coupling to the active locale is not. The inequality is
  // what stops a `document.title = 'Spielwirbel'` constant from passing both.
  assert.notEqual(tabTitle(ctx, 'de'), tabTitle(ctx, 'en'),
    'the two tab titles must differ, or this test proves nothing');

  ctx.setLocale('de');
  assert.equal(ctx.document.title, tabTitle(ctx, 'de'));
  ctx.setLocale('en');
  assert.equal(ctx.document.title, tabTitle(ctx, 'en'));
  ctx.setLocale('de');
  assert.equal(ctx.document.title, tabTitle(ctx, 'de'), 'switching back must move it back');
});

test('a locale registered at runtime gets its own tab title (#566)', () => {
  const ctx = loadI18n();
  vm.runInContext(`
    SUPPORTED_LOCALES.push('fr');
    LOCALE_TAGS.fr = 'fr-FR';
    I18N.fr = { 'app.tabTitle': 'Spielwirbel – On joue à quoi ce soir ?' };
  `, ctx);

  ctx.setLocale('fr');
  // Would read the English (t()'s fallback) if the title were picked with a
  // de/en ternary rather than through t().
  assert.equal(ctx.document.title, 'Spielwirbel – On joue à quoi ce soir ?');
});

/* ---------------------------- date formatting ----------------------------- */

test('dates and months render in the active locale, not an en-US fallback', () => {
  const ctx = loadI18n();
  const iso = '2026-07-29T14:05:00Z';

  ctx.setLocale('de');
  const deMonth = ctx.fmtMonth(iso);
  ctx.setLocale('en');
  const enMonth = ctx.fmtMonth(iso);

  assert.match(deMonth, /Juli/, `German month label was "${deMonth}"`);
  assert.match(enMonth, /July/, `English month label was "${enMonth}"`);
  assert.notEqual(ctx.fmtDateTime(iso), null);
});

test('a locale registered at runtime formats dates with its own tag', () => {
  const ctx = loadI18n();
  vm.runInContext(`
    SUPPORTED_LOCALES.push('fr');
    LOCALE_TAGS.fr = 'fr-FR';
    I18N.fr = {};
  `, ctx);

  ctx.setLocale('fr');
  // Would read "July 2026" if fmtMonth still picked its tag with a de/en ternary.
  assert.match(ctx.fmtMonth('2026-07-29T14:05:00Z'), /juillet/);
});
