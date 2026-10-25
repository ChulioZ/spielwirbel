'use strict';

// The link-preview card per language (#1727): `?lang=<code>` serves the shell
// with its og/twitter/description tags in that language and its own image, and
// the SPA opens in that language without saving it. Everything is looped over
// the imported locale set, never a hand-picked case.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const request = require('supertest');
const { app } = require('./helpers');
const { SUPPORTED_LOCALES } = require('../public/js/locales');
const { loadTable, ogImagePath, createShellLocalizer } = require('../lib/link-preview');

const PUBLIC = path.join(__dirname, '..', 'public');
const INDEX = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const OTHERS = SUPPORTED_LOCALES.filter((c) => c !== 'de');

function meta(html, attr, key) {
  const m = html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`));
  return m && m[1];
}

// The served attribute value, unescaped back to the table's text.
function plain(v) {
  return v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

test('the locale set has languages beyond the shell\'s own, or every loop here is vacuous', () => {
  assert.ok(OTHERS.length >= 2);
});

test('?lang=<code> serves that language\'s card, for every shipped locale', async () => {
  for (const code of OTHERS) {
    const t = loadTable(code);
    const res = await request(app).get(`/?lang=${code}`);
    assert.equal(res.status, 200, code);
    assert.match(res.headers['content-type'], /text\/html/, code);
    const html = res.text;
    for (const [attr, key] of [['property', 'og:title'], ['name', 'twitter:title']]) {
      assert.equal(plain(meta(html, attr, key)), `Spielwirbel – ${t['landing.hero.title']}`, `${code} ${key}`);
    }
    for (const [attr, key] of [['property', 'og:description'], ['name', 'twitter:description'], ['name', 'description']]) {
      assert.equal(plain(meta(html, attr, key)), t['landing.hero.sub'], `${code} ${key}`);
    }
    assert.match(meta(html, 'property', 'og:locale'), /^[a-z]{2}_[A-Z]{2}$/, code);
    assert.ok(meta(html, 'property', 'og:locale').startsWith(`${code}_`), code);
    assert.equal(meta(html, 'property', 'og:url'), `https://spielwirbel.app/?lang=${code}`);
    const image = meta(html, 'property', 'og:image');
    assert.equal(image, `https://spielwirbel.app${ogImagePath(code)}`, code);
    assert.ok(image.endsWith(`og-image-${code}.png`), `${code} must have its own card, not the German one`);
    assert.equal(meta(html, 'name', 'twitter:image'), image, code);
    assert.ok(plain(meta(html, 'property', 'og:image:alt')).includes(t['auth.promise.claim']), code);
    // The SEO surface is not this change: same canonical, same <title>.
    assert.match(html, /<link rel="canonical" href="https:\/\/spielwirbel\.app\/" \/>/, code);
    assert.equal(html.match(/<title>[^<]*<\/title>/)[0], INDEX.match(/<title>[^<]*<\/title>/)[0], code);
  }
});

test('every locale\'s card exists, is 1200x630 and light, and may be embedded elsewhere', async () => {
  for (const code of SUPPORTED_LOCALES) {
    const rel = ogImagePath(code);
    const buf = fs.readFileSync(path.join(PUBLIC, rel));
    assert.equal(buf.readUInt32BE(16), 1200, `${rel} width`);
    assert.equal(buf.readUInt32BE(20), 630, `${rel} height`);
    assert.ok(buf.length < 300 * 1024, `${rel} is ${Math.round(buf.length / 1024)} KB, keep it under 300 KB`);
    const res = await request(app).get(rel);
    assert.equal(res.status, 200, rel);
    assert.match(res.headers['content-type'], /image\/png/, rel);
    assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin', rel);
  }
  // The anti-vacuous half: the opt-out did not widen to the icons.
  const icon = await request(app).get('/icons/tisch/icon-512.png');
  assert.equal(icon.headers['cross-origin-resource-policy'], 'same-origin');
});

test('German, no lang and unknown values serve the file byte for byte, reflecting nothing', async () => {
  for (const q of ['', '?lang=de', '?lang=xx', '?lang=%3Cscript%3E', '?lang=fr&lang=en', '?lang=__proto__']) {
    const res = await request(app).get(`/${q}`);
    assert.equal(res.status, 200, q);
    assert.equal(res.text, INDEX, `${q || '/'} must be the static shell`);
    assert.doesNotMatch(res.text, /<script>|xx_|__proto__/, q);
  }
});

test('a deep link with ?lang= still carries no path id', async () => {
  const res = await request(app).get('/round/some-round-id/regal?lang=fr');
  assert.equal(res.status, 200);
  assert.equal(plain(meta(res.text, 'property', 'og:title')), `Spielwirbel – ${loadTable('fr')['landing.hero.title']}`);
  assert.doesNotMatch(res.text, /some-round-id/);
});

test('the static German alt text repeats the German keys it stands for', () => {
  // The German card is the file itself, so its strings are copies — this is
  // their licence, as link-preview.test.js is for the hero copy.
  const de = loadTable('de');
  const alt = meta(INDEX, 'property', 'og:image:alt');
  assert.ok(alt.includes(de['auth.promise.claim']), 'alt must carry the claim');
  assert.ok(alt.includes(de['linkPreview.imageAlt']), 'alt must carry linkPreview.imageAlt');
});

test('the localized shell keeps a BUILT index.html\'s hashed asset refs', () => {
  const { build } = require('../scripts/build');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-build-'));
  try {
    build({ outDir: out });
    const built = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const refs = built.match(/<script src="[^"]+"/g);
    assert.ok(refs.some((r) => /\.[0-9a-f]{8}\.js"/.test(r)), 'the build hashed nothing — the check would be vacuous');
    const fr = createShellLocalizer(out)('fr');
    assert.deepEqual(fr.match(/<script src="[^"]+"/g), refs);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

/* ------------------------------- the SPA half ------------------------------ */

function bootI18n({ search = '', saved = null, language = 'de' }) {
  const writes = [];
  const context = {
    localStorage: { getItem: () => saved, setItem: (k, v) => writes.push([k, v]) },
    document: { documentElement: {}, title: '' },
    navigator: { language },
    location: { search },
    URLSearchParams,
    Intl,
  };
  vm.createContext(context);
  const js = path.join(PUBLIC, 'js');
  for (const file of ['locales.js', 'i18n.js', ...SUPPORTED_LOCALES.map((l) => `lang/${l}.js`)]) {
    vm.runInContext(fs.readFileSync(path.join(js, file), 'utf8'), context, { filename: file });
  }
  context.initLocale();
  return { locale: context.getLocale(), writes };
}

test('?lang= opens the app in that language over the system language', () => {
  for (const code of OTHERS) {
    assert.equal(bootI18n({ search: `?lang=${code}`, language: 'de' }).locale, code);
  }
});

test('a saved choice beats ?lang=, and ?lang= is never saved', () => {
  assert.equal(bootI18n({ search: '?lang=fr', saved: 'it' }).locale, 'it');
  const { writes } = bootI18n({ search: '?lang=fr' });
  assert.deepEqual(writes, [], '?lang= must not write localStorage');
});

test('an unknown ?lang= falls through to the system language', () => {
  assert.equal(bootI18n({ search: '?lang=xx', language: 'nl' }).locale, 'nl');
});
