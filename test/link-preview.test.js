'use strict';

// Link previews (issue #430): what a messenger/social scraper renders when the
// app's URL is shared. Scrapers do not run JS, so the whole card has to be in
// the served HTML of the SPA shell — and its image has to be a real, publicly
// servable file. Both failure modes are silent (a bare URL, or a card with a
// blank image), which is why they are pinned here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const request = require('supertest');
const { app } = require('./helpers');

const OG_IMAGE = path.join(__dirname, '..', 'public', 'icons', 'og-image.png');

/** Loads a lang table the way i18n-parity does — they are browser scripts. */
function loadLocale(name) {
  const file = path.join(__dirname, '..', 'public', 'js', 'lang', `${name}.js`);
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.I18N[name];
}

/** Reads a `content="…"` value out of the served head by property/name. */
function meta(html, attr, key) {
  const re = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`);
  const m = html.match(re);
  return m && m[1];
}

/** Reads the served document's <title> text. */
function title(html) {
  const m = html.match(/<title>([^<]*)<\/title>/);
  return m && m[1];
}

test('the shell serves the preview card a scraper reads', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.ok(meta(res.text, 'name', 'description'), 'needs a description meta');
  assert.ok(meta(res.text, 'property', 'og:title'), 'needs og:title');
  assert.ok(meta(res.text, 'property', 'og:description'), 'needs og:description');
  assert.ok(meta(res.text, 'property', 'og:image'), 'needs og:image');
  assert.equal(meta(res.text, 'property', 'og:type'), 'website');
  assert.equal(meta(res.text, 'name', 'twitter:card'), 'summary_large_image');
});

test('og:url and og:image are absolute https URLs', async () => {
  const res = await request(app).get('/');
  // WhatsApp and friends do not reliably resolve a root-relative og:image, and
  // an http:// URL would be blocked as mixed content off the live origin.
  for (const key of ['og:url', 'og:image']) {
    assert.match(meta(res.text, 'property', key), /^https:\/\/[^/]+\//, `${key} must be absolute https`);
  }
  assert.equal(meta(res.text, 'name', 'twitter:image'), meta(res.text, 'property', 'og:image'));
});

test('the preview image is actually served, as a PNG', async () => {
  const html = (await request(app).get('/')).text;
  const url = meta(html, 'property', 'og:image');
  const res = await request(app).get(new URL(url).pathname);
  assert.equal(res.status, 200, 'the og:image path must resolve — a 404 renders a blank card');
  assert.match(res.headers['content-type'], /image\/png/);
});

test('the preview image may be rendered from another origin', async () => {
  // helmet's default Cross-Origin-Resource-Policy: same-origin makes a browser
  // refuse to paint this image on a foreign origin, which is where a preview
  // card lives by definition. Shipped that way once (#430) and every
  // client-side preview renderer showed a broken image.
  const res = await request(app).get('/icons/og-image.png');
  assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
});

test('the opt-out does not leak to the other static assets', async () => {
  // Only the preview card is meant to be embeddable elsewhere.
  const res = await request(app).get('/icons/icon-512.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin');
});

test('the declared image dimensions match the committed file', () => {
  // PNG IHDR: 8-byte signature + 4 length + 4 type, then width/height as BE32.
  const buf = fs.readFileSync(OG_IMAGE);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  assert.equal(width, 1200);
  assert.equal(height, 630);
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.equal(meta(html, 'property', 'og:image:width'), String(width));
  assert.equal(meta(html, 'property', 'og:image:height'), String(height));
  // WhatsApp is the pickiest consumer and skips images that are too large.
  assert.ok(buf.length < 300 * 1024, `og-image.png is ${Math.round(buf.length / 1024)} KB, keep it under 300 KB`);
});

test('the static card copy still matches the German hero copy it duplicates', async () => {
  // #437: the hero pitch lives in FIVE places — landing.hero.{title,sub} in
  // de.js, and four hand-copied strings in index.html. The copies cannot be
  // shared away (a scraper runs no JS and has no locale, see
  // .claude/rules/link-preview-card.md §1), so this parity check is the licence
  // for them: retune the positioning in de.js alone and the card keeps selling
  // the old pitch, with nothing else going red.
  const de = loadLocale('de');
  const html = (await request(app).get('/')).text;

  for (const [attr, key] of [['name', 'description'], ['property', 'og:description'], ['name', 'twitter:description']]) {
    assert.equal(meta(html, attr, key), de['landing.hero.sub'], `${key} must repeat landing.hero.sub verbatim`);
  }
  for (const [attr, key] of [['property', 'og:title'], ['name', 'twitter:title']]) {
    assert.ok(
      meta(html, attr, key).includes(de['landing.hero.title']),
      `${key} must carry landing.hero.title — it is the same pitch`,
    );
  }
});

test('the shell title is descriptive enough to be a SERP headline (#436)', async () => {
  // The <title> is the one string a search result headline is built from, and
  // it is also the tab and bookmark label. It shipped as the bare brand word
  // "Spielwirbel" (11 chars), which told a first-time visitor nothing and
  // wasted most of the SERP width.
  const text = title((await request(app).get('/')).text);
  assert.ok(text, 'the shell needs a <title>');
  assert.ok(
    text.length >= 40,
    `<title> is ${text.length} chars — too short for a SERP headline, aim at 50–60`,
  );
  // Brand first, so a truncated tab label still reads "Spielwirbel…".
  assert.match(text, /^Spielwirbel/, '<title> must keep the brand as its prefix');
});

test('a deep link previews as the generic card, never as round data', async () => {
  // The SPA fallback serves this same document for every route, so a shared
  // /round/… URL must not carry anything tenant-specific in its meta tags.
  const home = await request(app).get('/');
  const deep = await request(app).get('/round/some-round-id/regal');
  assert.equal(deep.status, 200);
  assert.equal(
    meta(deep.text, 'property', 'og:title'),
    meta(home.text, 'property', 'og:title'),
  );
  // Same for the <title> (#436): it is the browser-history and bookmark label
  // as well as the SERP headline, so a per-route title would leak round names
  // into a shared screenshot just as an og:title would leak them to a scraper.
  assert.equal(title(deep.text), title(home.text));
  assert.doesNotMatch(deep.text, /some-round-id/);
});
