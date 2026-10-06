'use strict';

/* Thumbnail-only covers are capped in the hero frames (#1542).

   BGG's signed `fit-in/200x150` variant is the only size we can fetch, and the
   hero/lead frames had grown to draw it at 360–567px — a 1.8–2.8x upscale. The
   render sites flag such a cover `cover--thumb` (isThumbCover), and the shared
   `.cover--thumb::after` rule stops the sharp layer at 1.5x the native box while
   the frame, and each design's composition around it, keeps its size.

   Three halves, each able to fail on its own: the URL test, the class at both
   render sites, and the CSS cap. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isThumbCover } = require('../public/js/cover-size');
const { bodyOf } = require('./support/css');
const { loadApp } = require('./support/dom');

const BGG = 'https://cf.geekdo-images.com/0XODRpReiZBFUffEcqT5-Q__small/img/SNVfF23OQafv3u8xdFolJnMkBoM=/fit-in/200x150/filters:strip_icc()/pic2419375.jpg';

test('isThumbCover flags BGG\'s 200px thumbnail and nothing full-size', () => {
  assert.equal(isThumbCover(BGG), true);
  // Own uploads are re-encoded to COVER_MAX_DIM (1024) — never capped.
  assert.equal(isThumbCover('/uploads/abc.webp'), false);
  // A larger fit-in variant needs no cap at hero size.
  assert.equal(isThumbCover('https://cf.geekdo-images.com/x/img/y=/fit-in/900x600/p.jpg'), false);
  assert.equal(isThumbCover('https://shared.akamai.steamstatic.com/apps/1/capsule_231x87.jpg'), false);
  for (const v of [undefined, null, '', 42]) assert.equal(isThumbCover(v), false, `${v}`);
});

test('the sharp layer of a thumbnail cover stops at 1.5x its native 200 x 150', () => {
  const body = bodyOf('.cover--thumb::after');
  assert.ok(body, '.cover--thumb::after rule not found');
  assert.match(body, /width:\s*min\(100%,\s*300px\)/);
  assert.match(body, /height:\s*min\(100%,\s*225px\)/);
  // Centred inside the frame, so the blurred mat shows evenly around it.
  assert.match(body, /margin:\s*auto/);
  assert.match(body, /inset:\s*0/);
});

test('no design stylesheet re-sizes the capped layer past the cap', () => {
  const dir = path.join(__dirname, '..', 'public/css/designs');
  for (const file of fs.readdirSync(dir)) {
    const css = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, sel, decls] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/cover--thumb::after/.test(sel)) continue;
      assert.doesNotMatch(decls, /(?:^|;)\s*(?:width|height|inset|max-width|max-height)\s*:/,
        `${file}: "${sel.trim()}" overrides the #1542 cap`);
    }
  }
});

test('Das Programmheft lead gives a thumbnail cover the blurred mat and the cap', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/programmheft.css'), 'utf8');
  assert.match(css, /\.ph-lead__cover\.cover--thumb::before[^{]*\{[^}]*filter:\s*blur/);
  assert.match(css, /\.ph-lead__cover\.cover--thumb::after\s*\{[^}]*background-size:\s*contain/);
});

/* ---- the class at the two render sites ---- */

const roundWith = (image) => ({
  id: 1, name: 'Donnerstagsrunde', shared: false,
  games: [{ id: 7, title: 'Catan', tagIds: [], minPlayers: 2, maxPlayers: 4, image, retired: false, completed: false }],
  members: [], sessions: [], activity: [], tags: [], providers: [],
});

async function heroOf(t, image) {
  const dom = loadApp();
  t.after(() => dom.close());
  const round = roundWith(image);
  dom.set('api', async () => round);
  dom.run('window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });');
  await dom.call('showGameDetail', round.id, 7);
  const img = dom.document.querySelector('.gd-img');
  assert.ok(img, 'no .gd-img rendered');
  return img;
}

test('the game hero flags a BGG thumbnail and leaves an upload alone', async (t) => {
  assert.ok((await heroOf(t, BGG)).classList.contains('cover--thumb'));
  assert.ok(!(await heroOf(t, '/uploads/catan.webp')).classList.contains('cover--thumb'));
});

test('the Programmheft lead flags a BGG thumbnail and leaves an upload alone', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const lead = (image) => dom.call('phLead', {
    game: { id: 7, title: 'Catan', image }, winnerNames: [], ending: '', when: 'heute', score: '', pot: 0,
  }).querySelector('.ph-lead__cover');
  assert.ok(lead(BGG).classList.contains('cover--thumb'));
  assert.ok(!lead('/uploads/catan.webp').classList.contains('cover--thumb'));
});

/* The three vote cards (Klassisch, the composed designs, the shared-vote
   page) build their frame as a template string inside nested functions, so
   this one is a source scan. It matches the frame's whole opening tag, so a
   fourth site written without the flag is caught as well as a reverted one. */
test('every vote-card cover frame with an image carries the thumbnail flag', () => {
  const dir = path.join(__dirname, '..', 'public/js');
  const flagged = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const [tag] of src.matchAll(/<div class="vote__img[^>\n]*\$\{imgStyle\}>/g)) {
      assert.match(tag, /isThumbCover\(\w+\.image\) \? ' cover--thumb' : ''/, `${file}: ${tag}`);
      flagged.push(file);
    }
  }
  assert.deepEqual(flagged.sort(), ['views-session.js', 'views-vote-link.js', 'vote-card-composed.js']);
});
