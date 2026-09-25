'use strict';

// The optional cache-busting build (issue #141): scripts/build.js mirrors public/
// into dist/, replacing every public/js/** and styles.css with a minified,
// content-hashed copy and rewriting the references in index.html, sw.js and
// login.html. These tests run the real build (esbuild, no network) into a temp
// dir and assert the output is internally consistent: every reference resolves,
// filenames are hashed, the SW cache name is content-derived, and — crucially for
// this shared-global-scope frontend — identifiers are NOT renamed.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build, rewriteRefs, deriveCache } = require('../scripts/build');

const SRC = path.join(__dirname, '..', 'public');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'build-test-'));
const { manifest, cache } = build({ srcDir: SRC, outDir: OUT });
after(() => fs.rmSync(OUT, { recursive: true, force: true }));

const read = (rel) => fs.readFileSync(path.join(OUT, rel), 'utf8');
const HASH = /\.[0-9a-f]{8}\.(js|css)$/;

// Delimited ("…"/'…') asset references to /js/*.js or /styles.css in a file.
function refs(text) {
  return [...text.matchAll(/["'](\/(?:js\/[^"']+\.js|styles[^"']*\.css))["']/g)].map((m) => m[1]);
}

test('hashes and minifies every js + styles.css asset', () => {
  assert.ok(Object.keys(manifest).length >= 15, 'should hash all js + styles.css');
  assert.ok(manifest['/styles.css'], 'styles.css is hashed');
  assert.ok(manifest['/js/core.js'], 'core.js is hashed');
  for (const [orig, hashed] of Object.entries(manifest)) {
    assert.match(hashed, HASH, `${hashed} carries a content hash`);
    assert.ok(fs.existsSync(path.join(OUT, hashed)), `${hashed} is emitted`);
    assert.ok(!fs.existsSync(path.join(OUT, orig)), `un-hashed ${orig} is removed`);
  }
  // Minification really shrank the file.
  const core = fs.statSync(path.join(OUT, manifest['/js/core.js'])).size;
  const srcCore = fs.statSync(path.join(SRC, 'js', 'core.js')).size;
  assert.ok(core < srcCore, 'core.js is smaller after minification');
});

test('index.html references only the hashed assets', () => {
  const dist = read('index.html');
  const srcRefs = refs(fs.readFileSync(path.join(SRC, 'index.html'), 'utf8'));
  assert.ok(srcRefs.includes('/styles.css') && srcRefs.length > 5, 'sanity: source had raw refs');
  for (const orig of srcRefs) {
    assert.ok(!dist.includes(`"${orig}"`), `no un-hashed ${orig} left in index.html`);
    assert.ok(dist.includes(`"${manifest[orig]}"`), `index.html points at ${manifest[orig]}`);
  }
});

test('service worker precaches the hashed shell with a content-derived cache', () => {
  const sw = read('sw.js');
  const block = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, 'SHELL list present');
  const shell = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  // Every precached entry must resolve to a real emitted file (a missed rewrite
  // would leave an un-hashed /js/x.js here that no longer exists in dist).
  for (const url of shell) {
    assert.ok(fs.existsSync(path.join(OUT, url)), `precached ${url} exists in dist`);
  }
  // The hashed assets are referenced by their hashed names; index.html is not
  // hashed (it is the bootstrap document).
  assert.ok(shell.includes(manifest['/js/core.js']), 'SHELL lists hashed core.js');
  assert.ok(shell.includes('/index.html'), 'SHELL keeps /index.html');

  const cacheName = sw.match(/const CACHE = '([^']*)';/)[1];
  assert.equal(cacheName, cache);
  assert.match(cacheName, /^spielwirbel-shell-[0-9a-f]{8}$/);
  assert.notEqual(cacheName, 'spielwirbel-shell-v1', 'cache name is derived, not the source literal');
});

test('login.html reference is rewritten too', () => {
  const dist = read('login.html');
  assert.ok(!dist.includes('"/js/pages/login.js"'), 'no un-hashed login.js');
  assert.ok(dist.includes(`"${manifest['/js/pages/login.js']}"`), 'login.html points at hashed login.js');
});

test('kontakt.html reference is rewritten too', () => {
  const dist = read('kontakt.html');
  assert.ok(!dist.includes('"/js/pages/kontakt.js"'), 'no un-hashed kontakt.js');
  assert.ok(dist.includes(`"${manifest['/js/pages/kontakt.js']}"`), 'kontakt.html points at hashed kontakt.js');
});

test('a vendored library ships byte-for-byte as upstream, only content-hashed (#1180)', () => {
  // Re-minifying an already-minified bundle grew SortableJS 45.5 → 48.5 KB and
  // made the served bytes differ from the release the parity test pins. So
  // js/vendor/** is hashed for cache-busting and otherwise left alone.
  const hashed = manifest['/js/vendor/sortable.min.js'];
  assert.match(hashed, HASH, 'the vendored file is still content-hashed');
  const built = fs.readFileSync(path.join(OUT, hashed));
  const src = fs.readFileSync(path.join(SRC, 'js', 'vendor', 'sortable.min.js'));
  assert.ok(built.equals(src), 'the built copy is byte-identical to the committed one');
});

test('does not rename shared top-level identifiers (no minifyIdentifiers)', () => {
  /* The frontend shares one global scope across files; renaming a top-level name
     would break cross-file references. Spot-check BOTH SIDES of one, not just the
     declaring file: a minifier renaming consistently *within* a file would still
     break the app, and that is exactly the shape a single-file check cannot see.
     #956 is why this is written per file — it moved `applyBackground` out of
     core.js, and the old list had pinned the name to that file by hand. */
  const spot = {
    // `repositionPopover` and `resolveAccent`/`STANDARD_ACCENT` are each listed on
    // BOTH sides — declared in one file, called from another. That pair is the
    // actual invariant; a name checked only where it is declared would survive a
    // minifier that renamed it consistently within its own file.
    '/js/popover.js': ['openPopover', 'repositionPopover'],
    '/js/tag-chips.js': ['matchesTagFilter', 'repositionPopover'],
    '/js/round-theme.js': ['applyBackground', 'avgColor', 'resolveAccent', 'STANDARD_ACCENT'],
    '/js/game-stats.js': ['gameStats', 'roundScoreIndex', 'displayScore'],
    '/js/core.js': ['memberColor', 'resolveAccent', 'STANDARD_ACCENT'],
    '/js/views-home.js': ['applyBackground'],
  };
  for (const [src, names] of Object.entries(spot)) {
    const code = read(manifest[src]);
    for (const name of names) {
      assert.ok(code.includes(name), `global ${name} is preserved in minified ${src}`);
    }
  }
});

test('rewriteRefs replaces only whole, delimited paths (not substrings)', () => {
  const m = { '/js/views-round.js': '/js/views-round.abcd1234.js' };
  const out = rewriteRefs('"/js/views-round.js" and "/js/views-round-settings.js"', m);
  assert.ok(out.includes('"/js/views-round.abcd1234.js"'), 'exact match rewritten');
  assert.ok(out.includes('"/js/views-round-settings.js"'), 'longer path left untouched');
});

test('deriveCache is deterministic and content-derived', () => {
  const a = { '/styles.css': '/styles.aaaaaaaa.css' };
  const b = { '/styles.css': '/styles.bbbbbbbb.css' };
  assert.equal(deriveCache(a), deriveCache(a));
  assert.notEqual(deriveCache(a), deriveCache(b));
  // The source CACHE literal participates too — see the #617 test below for why.
  assert.equal(deriveCache(a, 'v1'), deriveCache(a, 'v1'));
  assert.notEqual(deriveCache(a, 'v1'), deriveCache(a, 'v2'));
});

// The #617 regression. Only js/** + styles.css are hashed, so a change confined
// to a copied-through shell asset (manifest.webmanifest, an icon, a font) leaves
// every hashed filename identical. Without the source CACHE literal in the
// digest the built sw.js then came out BYTE-IDENTICAL to the previous deploy —
// browsers byte-compare sw.js to detect a service-worker update, so none fired
// and the cache-first shell served the stale asset indefinitely. A manual
// `spielwirbel-shell-vN` bump must therefore change the built output.
const TMP_617 = fs.mkdtempSync(path.join(os.tmpdir(), 'build-617-'));
after(() => fs.rmSync(TMP_617, { recursive: true, force: true }));

test('a copied-through asset change plus a CACHE bump changes the built sw.js (#617)', () => {
  const mkSrc = (name, cacheName, manifestBody) => {
    const dir = path.join(TMP_617, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'styles.css'), 'body{color:red}');
    fs.writeFileSync(path.join(dir, 'sw.js'), `const CACHE = '${cacheName}';\n`);
    fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), manifestBody);
    return dir;
  };

  const before = build({
    srcDir: mkSrc('src-before', 'spielwirbel-shell-v1', '{"name":"S"}'),
    outDir: path.join(TMP_617, 'out-before'),
  });
  const afterBump = build({
    srcDir: mkSrc('src-after', 'spielwirbel-shell-v2',
      '{"name":"S","launch_handler":{"client_mode":"navigate-existing"}}'),
    outDir: path.join(TMP_617, 'out-after'),
  });

  // Sanity: this is genuinely the hard case — no hashed filename moved at all,
  // so the digest has nothing but the literal to distinguish the two builds.
  assert.deepEqual(before.manifest, afterBump.manifest, 'no hashed asset changed');
  assert.notEqual(before.cache, afterBump.cache, 'the bump must change the derived cache name');
  assert.notEqual(
    fs.readFileSync(path.join(TMP_617, 'out-before', 'sw.js'), 'utf8'),
    fs.readFileSync(path.join(TMP_617, 'out-after', 'sw.js'), 'utf8'),
    'the built sw.js must differ, or no browser ever detects a service-worker update'
  );
});

/* Per-design override stylesheets (#1184). Three things have to hold together
   and each fails silently on its own — see
   .claude/rules/design-stylesheets-are-shell-assets.md. The stylesheet's href
   is built by design.js at RUNTIME, so unlike every other asset here it is not
   referenced from any REWRITE_FILES document: the only thing that can point at
   the hashed name is the literal in designs.js, which means the css has to be
   hashed BEFORE the js that names it. */
test('hashes public/css/** and rewrites the reference inside designs.js', () => {
  const css = Object.keys(manifest).filter((k) => k.startsWith('/css/'));
  assert.ok(css.length >= 1, 'at least one design stylesheet is hashed');
  for (const orig of css) {
    assert.match(manifest[orig], HASH, `${orig} carries a content hash`);
    assert.ok(!fs.existsSync(path.join(OUT, orig)), `the un-hashed ${orig} is removed`);
  }

  // The whole point of the two-phase order: designs.js must name the HASHED
  // stylesheet. Pointing at the source path would 404 in production only.
  const designs = read(manifest['/js/designs.js']);
  for (const orig of css) {
    assert.ok(!designs.includes(`'${orig}'`) && !designs.includes(`"${orig}"`),
      `designs.js still names the un-hashed ${orig} — the css must be hashed before the js`);
    assert.ok(designs.includes(manifest[orig]),
      `designs.js must point at ${manifest[orig]}`);
  }
});

test('a design stylesheet change moves BOTH its own hash and designs.js\'s', () => {
  /* The subtler half of the same ordering rule. Rewriting js AFTER hashing it
     would leave designs.js's filename derived from its pre-rewrite bytes, so a
     stylesheet change would change the file's CONTENT under an unchanged name —
     and the cache-first shell would keep serving the old pointer. Both hashes
     must move, and so must the derived cache name. */
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'build-css-'));
  after(() => fs.rmSync(TMP, { recursive: true, force: true }));
  const mirror = path.join(TMP, 'public');
  fs.cpSync(SRC, mirror, { recursive: true });

  const sheet = path.join(mirror, 'css', 'designs', 'tisch.css');
  fs.writeFileSync(sheet, fs.readFileSync(sheet, 'utf8') + '\n:root[data-design="tisch"] { --radius-sm: 7px; }\n');

  const out2 = path.join(TMP, 'dist');
  const second = build({ srcDir: mirror, outDir: out2 });

  assert.notEqual(second.manifest['/css/designs/tisch.css'], manifest['/css/designs/tisch.css'],
    'the stylesheet\'s own hash must move');
  assert.notEqual(second.manifest['/js/designs.js'], manifest['/js/designs.js'],
    'designs.js names the stylesheet, so its hash must move with it');
  assert.notEqual(second.cache, cache, 'the derived service-worker cache name must move too');
  assert.ok(fs.readFileSync(path.join(out2, second.manifest['/js/designs.js']), 'utf8')
    .includes(second.manifest['/css/designs/tisch.css']), 'and it must point at the new name');
});
