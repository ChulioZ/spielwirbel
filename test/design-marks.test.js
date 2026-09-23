'use strict';

/*
 * Per-design brand marks (#1199): the app icons, favicon, apple-touch icon and
 * link-preview image each design declares in its registry row, the manifest
 * route that serves them, and the head links design.js re-points.
 *
 * Every assertion here guards a failure that is silent everywhere else:
 *
 *  - A mark that is missing or the wrong size installs as a blank or blurry
 *    home-screen icon. No request fails loudly — the browser just picks
 *    something else, or nothing.
 *  - The face's registry row drifting from the files production serves today
 *    would change the Klassisch icon for every visitor with no diff in any
 *    image. So the Klassisch row is pinned to manifest.webmanifest and
 *    index.html, and the bare manifest URL to the static file's exact bytes.
 *  - index.html's static head is the only thing a scraper (og:image) and a
 *    pre-script install ever see. It is pinned to the FACE's marks, so the
 *    flip (#1202) cannot move FACE_DESIGN without moving the head in the same
 *    change — the test goes red on the one-line edit that would forget it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const { app } = require('./helpers');
const { loadApp } = require('./support/dom');
const {
  DESIGN_REGISTRY, FACE_DESIGN, designById, designMarks, manifestHref,
} = require('../public/js/designs');
const { manifestFor, manifestDesign } = require('../lib/web-manifest');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const MANIFEST_FILE = fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8');
const MANIFEST = JSON.parse(MANIFEST_FILE);
const INDEX = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

// A PNG's own dimensions, out of its IHDR chunk — the declared `sizes` is a
// promise to the browser, so it is checked against the pixels, not trusted.
function pngSize(rel) {
  const buf = fs.readFileSync(path.join(PUBLIC, rel.replace(/^\//, '')));
  assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${rel} is a PNG`);
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

// Every file a design's marks name, with the size it has to be.
function markFiles(design) {
  const m = design.marks;
  return [
    ...m.icons.map((i) => [i.src, i.sizes]),
    [m.favicon.href, m.favicon.sizes],
    [m.appleTouch, '180x180'],
    [m.og, '1200x630'],
  ];
}

const headAttr = (re) => {
  const m = INDEX.match(re);
  assert.ok(m, `index.html declares ${re}`);
  return m[1];
};

test('every design declares marks, and every mark exists at the size it claims', () => {
  let checked = 0;
  for (const design of DESIGN_REGISTRY) {
    assert.ok(design.marks, `${design.id} declares its marks`);
    assert.ok(design.marks.icons.some((i) => /(^| )any( |$)/.test(i.purpose)),
      `${design.id} has an icon for purpose "any"`);
    assert.ok(design.marks.icons.some((i) => /maskable/.test(i.purpose)),
      `${design.id} has a maskable icon — Android crops a non-maskable one into a white disc`);
    for (const [src, sizes] of markFiles(design)) {
      assert.equal(pngSize(src), sizes, `${design.id}: ${src} must be ${sizes}`);
      checked++;
    }
  }
  assert.ok(checked >= 11, 'both designs’ marks were actually walked');
});

test('every mark is served, and only the link-preview images opt out of CORP', async () => {
  for (const design of DESIGN_REGISTRY) {
    for (const [src] of markFiles(design)) {
      const res = await request(app).get(src);
      assert.equal(res.status, 200, `${src} is served`);
      assert.match(res.headers['content-type'], /^image\/png/, `${src} is a PNG`);
      const corp = res.headers['cross-origin-resource-policy'];
      if (src === design.marks.og) {
        assert.equal(corp, 'cross-origin', `${src} must render in client-side preview widgets`);
      } else {
        assert.equal(corp, 'same-origin', `${src} is only ever loaded by our own origin`);
      }
    }
  }
});

test('Klassisch’s marks are exactly what production serves today', () => {
  const klassisch = designById('klassisch');
  assert.deepEqual(klassisch.marks.icons, MANIFEST.icons,
    'the Klassisch row must equal manifest.webmanifest’s icons — the face’s icon may not move');
  assert.equal(klassisch.page, undefined, 'Klassisch declares no page, so its manifest is the file itself');
});

test('index.html’s static head carries the FACE’s marks (the flip must move both)', () => {
  const face = designMarks(FACE_DESIGN);
  assert.equal(headAttr(/<link rel="icon" href="([^"]+)"/), face.favicon.href);
  assert.equal(headAttr(/<link rel="apple-touch-icon" href="([^"]+)"/), face.appleTouch);
  assert.equal(headAttr(/<link rel="manifest" href="([^"]+)"/), manifestHref(FACE_DESIGN));
  assert.equal(headAttr(/<meta property="og:image" content="([^"]+)"/), 'https://spielwirbel.app' + face.og);
  assert.equal(headAttr(/<meta name="twitter:image" content="([^"]+)"/), 'https://spielwirbel.app' + face.og);
});

test('manifestHref: the face gets the bare path, any other design names itself', () => {
  assert.equal(manifestHref(FACE_DESIGN), '/manifest.webmanifest');
  assert.equal(manifestHref('no-such-design'), '/manifest.webmanifest');
  const other = DESIGN_REGISTRY.find((d) => d.id !== FACE_DESIGN);
  assert.equal(manifestHref(other.id), `/manifest.webmanifest?design=${other.id}`);
});

test('the bare manifest URL serves the FACE’s manifest — today the static file, byte for byte', async () => {
  const res = await request(app).get('/manifest.webmanifest');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /manifest\+json|json/);
  if (!designById(FACE_DESIGN).page) {
    assert.equal(res.text, MANIFEST_FILE, 'a colourless face (Klassisch) is served as the unchanged file');
  } else {
    assert.deepEqual(JSON.parse(res.text).icons, designMarks(FACE_DESIGN).icons, 'the face’s own icons');
  }
});

test('?design=tisch outside production serves Der Tisch’s icons and colours', async () => {
  const tisch = designById('tisch');
  const res = await request(app).get('/manifest.webmanifest?design=tisch');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^application\/manifest\+json/);
  const body = JSON.parse(res.text);
  assert.deepEqual(body.icons, tisch.marks.icons);
  assert.equal(body.theme_color, tisch.accent, 'theme_color follows the accent, like <meta name="theme-color">');
  assert.equal(body.background_color, tisch.page, 'the splash screen paints the design’s page');
  // Everything else is the file's: name, scope, start_url, display, the
  // launch handler. A design changes the dress, never what the app IS.
  for (const key of Object.keys(MANIFEST)) {
    if (['icons', 'theme_color', 'background_color'].includes(key)) continue;
    assert.deepEqual(body[key], MANIFEST[key], `${key} is the file’s own`);
  }
});

test('in production an unreleased design is refused — the face answers instead', async (t) => {
  // Whichever design is still behind the gate; once none is, there is nothing
  // left for this route to leak and the spec says so rather than passing blind.
  const gated = DESIGN_REGISTRY.find((d) => !d.enabled && d.page);
  if (!gated) { t.skip('every registered design is enabled'); return; }
  const was = process.env.NODE_ENV;
  t.after(() => { process.env.NODE_ENV = was; });
  process.env.NODE_ENV = 'production';
  const res = await request(app).get(`/manifest.webmanifest?design=${gated.id}`);
  assert.equal(res.status, 200);
  const face = (await request(app).get('/manifest.webmanifest')).text;
  assert.equal(res.text, face, 'a gated design must not leak its icons through the manifest');
  assert.ok(!res.text.includes(gated.marks.icons[0].src), 'none of its icon paths appear');
});

test('an unknown or malformed ?design= falls back to the face, never reflects', async () => {
  const face = (await request(app).get('/manifest.webmanifest')).text;
  for (const q of ['?design=nope', '?design=%3Cscript%3E', '?design[]=tisch', '?design=']) {
    const res = await request(app).get('/manifest.webmanifest' + q);
    assert.equal(res.status, 200, q);
    assert.equal(res.text, face, `${q} must serve the face`);
    assert.doesNotMatch(res.text, /<script|nope/, `${q} must not be reflected`);
  }
});

test('manifestDesign/manifestFor: the pure halves the route composes', () => {
  assert.equal(manifestDesign('tisch', { production: false }).id, 'tisch');
  assert.equal(manifestDesign('tisch', { production: true }).id, FACE_DESIGN);
  assert.equal(manifestDesign(undefined, { production: false }).id, FACE_DESIGN);
  assert.equal(manifestFor(MANIFEST, designById('klassisch')), null, 'Klassisch falls through to the file');
  const derived = manifestFor(MANIFEST, designById('tisch'));
  derived.icons[0].src = 'mutated';
  assert.notEqual(designById('tisch').marks.icons[0].src, 'mutated', 'the registry must not be handed out by reference');
});

test('wearing a design re-points the head’s manifest, favicon and apple-touch icon', () => {
  const dom = loadApp();
  try {
    const href = (sel) => dom.run(`document.querySelector('${sel}').getAttribute('href')`);
    const before = {
      manifest: href('link[rel="manifest"]'),
      icon: href('link[rel="icon"]'),
      apple: href('link[rel="apple-touch-icon"]'),
    };
    dom.call('applyDesign', 'tisch');
    const tisch = designById('tisch').marks;
    assert.equal(href('link[rel="manifest"]'), '/manifest.webmanifest?design=tisch');
    assert.equal(href('link[rel="icon"]'), tisch.favicon.href);
    assert.equal(dom.run('document.querySelector(\'link[rel="icon"]\').getAttribute(\'sizes\')'), tisch.favicon.sizes);
    assert.equal(href('link[rel="apple-touch-icon"]'), tisch.appleTouch);
    // …and back: the face's head is restored exactly, not left on Der Tisch.
    dom.call('applyDesign', FACE_DESIGN);
    assert.deepEqual({
      manifest: href('link[rel="manifest"]'),
      icon: href('link[rel="icon"]'),
      apple: href('link[rel="apple-touch-icon"]'),
    }, before);
  } finally {
    dom.close();
  }
});
