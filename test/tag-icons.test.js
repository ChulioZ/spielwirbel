'use strict';

// The curated tag-icon set (#255) lives in two files: lib/tag-icons.js (the
// backend's validation allowlist) and public/js/tag-icons.js (the frontend
// needs it in its shared global scope and can't require the lib one). They must
// not drift — a key the server accepts but the client doesn't know renders as
// the fallback glyph, and one the client offers but the server rejects is a
// 400 the user can trigger by clicking a button we drew for them.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { TAG_ICONS: serverIcons } = require('../lib/tag-icons');
const { TAG_ICONS: clientIcons, tagIconClass } = require('../public/js/tag-icons');

const ROOT = path.join(__dirname, '..');

test('the server and client icon lists are identical', () => {
  assert.deepEqual(clientIcons, serverIcons);
});

test('`tags` is first — it is also the fallback glyph', () => {
  assert.equal(serverIcons[0], 'tags');
});

test('every icon is declared in the bundled tabler-icons.css', () => {
  // A `ti-<key>` class with no rule behind it renders NOTHING — no tofu, no
  // console warning, no failing test anywhere else. See
  // .claude/rules/tabler-icon-codepoints.md.
  const css = fs.readFileSync(path.join(ROOT, 'public/fonts/tabler-icons.css'), 'utf8');
  const declared = new Set([...css.matchAll(/^\.ti-([a-z0-9-]+)::before/gm)].map((m) => m[1]));
  const missing = serverIcons.filter((k) => !declared.has(k));
  assert.deepEqual(missing, [], `undeclared tag icons: ${missing.join(', ')}`);
});

test('tagIconClass maps a known key and falls back for anything else', () => {
  assert.equal(tagIconClass('puzzle'), 'ti-puzzle');
  assert.equal(tagIconClass('tags'), 'ti-tags');
  // Unset (every tag created before #255) and unknown keys both land on the
  // default rather than emitting a class with no CSS rule behind it.
  assert.equal(tagIconClass(null), 'ti-tags');
  assert.equal(tagIconClass(undefined), 'ti-tags');
  assert.equal(tagIconClass('not-a-real-icon'), 'ti-tags');
});

test('every icon key has a picker label in the lang tables', () => {
  // The icon picker labels each swatch with t('tags.icons.<key>'). A key
  // without a label makes t() fall back to the raw key string in the
  // aria-label — no error, no red test anywhere else. en/de parity is already
  // pinned by test/i18n-parity.test.js, so checking en covers de too.
  const vm = require('node:vm');
  const context = { I18N: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'public/js/lang/en.js'), 'utf8'),
    context
  );
  const unlabeled = serverIcons.filter((k) => !context.I18N.en[`tags.icons.${k}`]);
  assert.deepEqual(unlabeled, [], `icons without a tags.icons.* label: ${unlabeled.join(', ')}`);
});
