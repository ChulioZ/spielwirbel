'use strict';

/*
 * Every shipped language file must stay in key parity (see CLAUDE.md). They are
 * plain browser scripts that register into a global I18N, so we load them in a
 * tiny vm sandbox that provides that global, then diff the key sets.
 *
 * The locale set is DERIVED from public/js/locales.js rather than hardcoded, so
 * a language added there is checked with nobody remembering this file exists —
 * and a locale listed with no lang/<code>.js file fails loudly here instead of
 * as a blank UI. English is the reference key set: t() falls back to I18N.en,
 * so a key missing from en is missing everywhere.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { SUPPORTED_LOCALES } = require('../public/js/locales');

function loadLocale(name) {
  const file = path.join(__dirname, '..', 'public', 'js', 'lang', `${name}.js`);
  assert.ok(fs.existsSync(file), `locales.js lists '${name}' but public/js/lang/${name}.js does not exist`);
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  const dict = context.I18N[name];
  assert.ok(dict, `public/js/lang/${name}.js does not register I18N['${name}']`);
  return dict;
}

test('every supported locale exposes the exact same set of keys as en', () => {
  assert.ok(SUPPORTED_LOCALES.includes('en'), 'en is the fallback locale and must be supported');
  const en = Object.keys(loadLocale('en')).sort();

  for (const name of SUPPORTED_LOCALES.filter((l) => l !== 'en')) {
    const keys = Object.keys(loadLocale(name)).sort();

    const missing = en.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !en.includes(k));

    assert.deepEqual(missing, [], `keys present in en but missing in ${name}: ${missing.join(', ')}`);
    assert.deepEqual(extra, [], `keys present in ${name} but missing in en: ${extra.join(', ')}`);
  }
});

/* The {placeholders} t() substitutes are part of a key's contract, and a
 * translation that drops or misspells one fails in silence: t() only replaces
 * the names it is handed, so the string renders with a literal "{n}" in it —
 * no error, no failed request, just a broken-looking sentence in one language.
 * Key parity cannot see it, because the key is present and non-empty. */
test('every translation substitutes the same placeholders as en', () => {
  const placeholders = (value) =>
    [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  const en = loadLocale('en');
  for (const name of SUPPORTED_LOCALES.filter((l) => l !== 'en')) {
    const dict = loadLocale(name);
    for (const [key, value] of Object.entries(en)) {
      assert.deepEqual(
        placeholders(dict[key]), placeholders(value),
        `${name}: ${key} substitutes different placeholders than en — `
        + `"${dict[key]}" vs "${value}"`
      );
    }
  }
});

test('no translation value is left empty', () => {
  for (const name of SUPPORTED_LOCALES) {
    const dict = loadLocale(name);
    for (const [key, value] of Object.entries(dict)) {
      assert.ok(String(value).trim().length > 0, `${name}: empty value for ${key}`);
    }
  }
});
