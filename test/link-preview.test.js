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
const request = require('supertest');
const { app } = require('./helpers');

const OG_IMAGE = path.join(__dirname, '..', 'public', 'icons', 'og-image.png');

/** Reads a `content="…"` value out of the served head by property/name. */
function meta(html, attr, key) {
  const re = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`);
  const m = html.match(re);
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
  assert.doesNotMatch(deep.text, /some-round-id/);
});
