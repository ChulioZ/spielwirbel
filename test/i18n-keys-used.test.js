'use strict';

/*
 * Every literal i18n key the frontend hands to t()/tn() must exist in lang/en.js.
 *
 * i18n-parity.test.js cannot see this: it compares the locale files with EACH
 * OTHER, so a key missing from all nine is still in parity — and t() then
 * renders the raw key. That is how 'marker.toast.set' shipped (#1359).
 *
 * The scan walks each call's argument list with a paren/brace depth counter
 * rather than a regex, so it sees every call shape (.claude/rules/
 * source-scanning-guards-enumerate-shapes.md): a key directly after the paren,
 * a key inside a ternary (`t(one ? 'a.b' : 'a.c')`), both keys of
 * `tn(n, 'a.one', 'a.other')`, and calls spread over several lines. Literals
 * inside the params object or a nested call are ignored (not keys), and so is
 * a literal ending in '.', which is a dynamic prefix (`'hub.tab.' + id`).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'public', 'js');

function loadEn() {
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(path.join(JS_DIR, 'lang', 'en.js'), 'utf8'), context);
  return context.I18N.en;
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'lang') out.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const KEY = /^[a-zA-Z][\w-]*(\.[\w-]+)+$/;

// The literal keys of every t(/tn( call in `src`, at the call's own level.
function keysUsed(src) {
  const found = [];
  const call = /(?<![.\w$])tn?\(/g;
  while (call.exec(src)) {
    let depth = 1;
    let braces = 0;
    let i = call.lastIndex;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "'" || c === '"' || c === '`') {
        let j = i + 1;
        while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
        const lit = src.slice(i + 1, j);
        if (c !== '`' && depth === 1 && braces === 0 && KEY.test(lit)) found.push(lit);
        i = j + 1;
        continue;
      }
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === '{') braces++;
      else if (c === '}') braces--;
      i++;
    }
  }
  return found;
}

test('the scanner sees every call shape (self-test)', () => {
  assert.deepEqual(keysUsed("t('a.b')"), ['a.b']);
  assert.deepEqual(keysUsed("x = t(n === 1 ? 'a.one' : 'a.many', { n })"), ['a.one', 'a.many']);
  assert.deepEqual(keysUsed("tn(list.length,\n  'a.one',\n  'a.other')"), ['a.one', 'a.other']);
  assert.deepEqual(keysUsed("t('hub.tab.' + id)"), [], 'a dynamic prefix is not a key');
  assert.deepEqual(keysUsed("t('a.b', { icon: 'x.y', n: fmt('c.d') })"), ['a.b'], 'params and nested calls are not keys');
  assert.deepEqual(keysUsed("obj.t('a.b'); alert('a.b')"), [], 'only the global t/tn');
});

test('every literal key passed to t()/tn() exists in lang/en.js', () => {
  const en = loadEn();
  const missing = [];
  let matched = 0;
  for (const file of sourceFiles(JS_DIR)) {
    for (const key of keysUsed(fs.readFileSync(file, 'utf8'))) {
      matched++;
      if (!(key in en)) missing.push(`${key} (${path.relative(JS_DIR, file)})`);
    }
  }
  // Counts keys actually MATCHED, so a scanner that stops matching fails here.
  assert.ok(matched > 1000, `only ${matched} keys matched — the scanner is broken`);
  assert.deepEqual(missing, [], `keys used in code but missing from lang/en.js:\n  ${missing.join('\n  ')}`);
});
