'use strict';

/*
 * Every standalone or server-rendered page head carries the FACE's marks, and
 * the root icon paths browsers request on their own answer with them (#1703).
 *
 * test/design-marks.test.js pins index.html's head to FACE_DESIGN. The other
 * heads were never in its field of view, so after the flip (#1202) /faq and
 * /guide kept Klassisch's orange apple-touch icon, /admin its orange favicon,
 * the legal pages declared no apple-touch icon at all — and /favicon.ico and
 * /apple-touch-icon.png fell through to the SPA shell and came back as HTML.
 * None of that fails a request: iOS just installs the wrong picture, or a
 * screenshot.
 *
 * The page list has a per-page floor (every page must yield its favicon link),
 * so a head whose markup stops matching the pattern goes red instead of
 * silently contributing nothing (.claude/rules/source-scanning-guards-enumerate-shapes.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const { app } = require('./helpers');
const { FACE_DESIGN, designMarks } = require('../public/js/designs');
const { SUPPORTED_LOCALES } = require('../public/js/locales');
const { GUIDE_PATHS } = require('../lib/guide');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const FACE = designMarks(FACE_DESIGN);

const IDENTITY = {
  IMPRESSUM_ADDRESS: 'Musterweg 1\\n12345 Musterstadt',
  IMPRESSUM_EMAIL: 'kontakt@example.test',
};

// Every <link rel="icon"> / <link rel="apple-touch-icon"> href in a document.
function iconLinks(html) {
  const out = { icon: [], apple: [] };
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    const rel = (tag.match(/\brel="([^"]+)"/) || [])[1];
    const href = (tag.match(/\bhref="([^"]+)"/) || [])[1];
    if (rel === 'icon') out.icon.push(href);
    if (rel === 'apple-touch-icon') out.apple.push(href);
  }
  return out;
}

function assertFaceHead(name, html, { apple = true } = {}) {
  const links = iconLinks(html);
  assert.ok(links.icon.length >= 1, `${name} declares a favicon`);
  for (const href of links.icon) assert.equal(href, FACE.favicon.href, `${name}: favicon must be the face's`);
  if (apple) assert.ok(links.apple.length >= 1, `${name} declares an apple-touch icon`);
  for (const href of links.apple) assert.equal(href, FACE.appleTouch, `${name}: apple-touch icon must be the face's`);
}

for (const file of ['index.html', 'login.html', 'kontakt.html', 'admin.html']) {
  test(`${file}’s static head carries the face’s marks`, () => {
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    // The operator panel gets the face's favicon only: no apple-touch icon,
    // no manifest — it is never meant to be installed.
    assertFaceHead(file, html, { apple: file !== 'admin.html' });
  });
}

test('/faq in every locale carries the face’s marks', async () => {
  for (const code of SUPPORTED_LOCALES) {
    const res = await request(app).get(`/faq?lang=${code}`);
    assert.equal(res.status, 200, code);
    assertFaceHead(`/faq?lang=${code}`, res.text);
  }
});

test('every guide page carries the face’s marks', async () => {
  assert.ok(GUIDE_PATHS.size >= SUPPORTED_LOCALES.length, 'one guide page per locale was walked');
  for (const p of GUIDE_PATHS.keys()) {
    const res = await request(app).get(p);
    assert.equal(res.status, 200, p);
    assertFaceHead(p, res.text);
  }
});

test('the legal pages carry the face’s marks', async (t) => {
  Object.assign(process.env, IDENTITY);
  t.after(() => { for (const k of Object.keys(IDENTITY)) delete process.env[k]; });
  for (const p of ['/impressum', '/datenschutz', '/nutzungsbedingungen']) {
    const res = await request(app).get(p);
    assert.equal(res.status, 200, p);
    assertFaceHead(p, res.text);
  }
});

// The server-rendered heads interpolate from the registry, so the next flip
// moves them with FACE_DESIGN instead of leaving a literal behind.
test('no server-rendered head names a design’s icon folder literally', () => {
  for (const file of ['lib/faq.js', 'lib/guide.js', 'lib/legal.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    // assert.ok rather than doesNotMatch, which dumps the whole file on a red.
    assert.ok(!/href="\/icons\//.test(src), `${file} must derive its icon hrefs from designMarks(FACE_DESIGN)`);
  }
});

const ROOT_ICONS = [
  ['/favicon.ico', FACE.favicon.href],
  ['/apple-touch-icon.png', FACE.appleTouch],
  ['/apple-touch-icon-precomposed.png', FACE.appleTouch],
];

async function assertRootIcons(mode) {
  for (const [p, src] of ROOT_ICONS) {
    const res = await request(app).get(p).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(res.status, 200, `${mode}: ${p}`);
    assert.match(res.headers['content-type'], /^image\/png/, `${mode}: ${p} is a PNG, not the SPA shell`);
    assert.ok(res.body.equals(fs.readFileSync(path.join(PUBLIC, src.slice(1)))), `${mode}: ${p} serves ${src}`);
    assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin', `${mode}: ${p} keeps CORP`);
  }
}

test('the root icon paths serve the face’s marks, not the SPA shell', async () => {
  await assertRootIcons('open');
});

test('the root icon paths are served before the shared-password gate', async (t) => {
  process.env.AUTH_PASSWORD = 'test-password';
  t.after(() => { delete process.env.AUTH_PASSWORD; });
  await assertRootIcons('password-gated, no session');
});

test('the root icon paths are served in accounts mode without a token', async (t) => {
  process.env.ACCOUNTS_ENABLED = 'true';
  process.env.SESSION_SECRET = 'test-session-secret';
  t.after(() => { delete process.env.ACCOUNTS_ENABLED; delete process.env.SESSION_SECRET; });
  await assertRootIcons('accounts mode');
});
