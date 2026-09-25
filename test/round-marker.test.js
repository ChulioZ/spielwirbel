'use strict';

/* A round's colour marker (#1187): the design-neutral index that replaced the
   per-round design, the render-time mapping from a retired design onto it, the
   route that stores it, and the picker that sets it.

   Since the flip (#1202) the retired designs — palettes and worlds — exist
   only as the `background` a round stored back then, and the marker it maps
   to is the whole of what they still decide. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const { loadApp } = require('./support/dom');
const {
  MARKER_COUNT, LEGACY_MARKER_INDEX, LEGACY_PAGE_DESIGN, legacyDesignId, markerIndexFromId, isMarkerIndex,
  resolveMarker,
} = require('../public/js/round-marker');
const { DESIGN_REGISTRY, designMarkers, markerOf, markerInk, DEFAULT_MARKER_INK } = require('../public/js/designs');

const HEX = /^#[0-9a-f]{6}$/;
const flush = () => new Promise((r) => setImmediate(r));

// ---- the registry --------------------------------------------------------

test('every design declares exactly eight markers, each a colour, a deep stop and a label', () => {
  assert.ok(DESIGN_REGISTRY.length >= 2, 'two designs are needed for "design-neutral" to mean anything');
  for (const d of DESIGN_REGISTRY) {
    const markers = designMarkers(d.id);
    assert.equal(markers.length, MARKER_COUNT,
      `${d.id} declares ${markers.length} markers — a round already holding index 7 would render undefined`);
    const keys = markers.map((m) => m.key);
    assert.equal(new Set(keys).size, keys.length, `${d.id}: marker keys must be unique`);
    for (const m of markers) {
      assert.match(m.color, HEX, `${d.id}/${m.key}: colour must be a lower-case 6-digit hex`);
      assert.match(m.deep, HEX, `${d.id}/${m.key}: deep stop must be a lower-case 6-digit hex`);
      assert.notEqual(m.deep, m.color, `${d.id}/${m.key}: the deep stop must differ, or the gradient is flat`);
      assert.equal(typeof m.labelKey, 'string');
      assert.ok(m.labelKey.length > 0, `${d.id}/${m.key}: a marker is named in the picker`);
    }
  }
});

/* Klassisch's eight ARE the eight retired light palettes' accents, after #145's
   contrast correction, in the palettes' own order — which is what makes a
   round that wore Salbei before the flip (#1202) still read as the same sage
   under Klassisch. The palettes' source was deleted with the flip, so the
   values are pinned here as the historical record they now are: moving one
   re-colours every legacy round that maps onto it. */
test('Klassisch’s markers are the eight retired light palettes’ accents, in order', () => {
  assert.deepEqual(designMarkers('klassisch').map((m) => [m.key, m.color]), [
    ['standard', '#c2410c'], ['blaugrau', '#3a67b1'], ['salbei', '#397a4b'], ['rose', '#b23a72'],
    ['lavendel', '#6d55c4'], ['sand', '#91641a'], ['schiefer', '#33688f'], ['pfirsich', '#b34d2e'],
  ]);
  // Obsidian was the dark palette and is deliberately NOT one of the eight.
  assert.equal(designMarkers('klassisch').some((m) => m.key === 'obsidian'), false);
});

/* The ink is per DESIGN and does not flip with the scheme — see markerInk() in
   designs.js, and the sweep in test/a11y-contrast.test.js that measures it
   against all sixteen stops of every design. */
test('a design\u2019s marker ink defaults to white and may be stated', () => {
  assert.equal(markerInk('klassisch'), DEFAULT_MARKER_INK);
  assert.equal(markerInk('tisch'), '#f6ecd8', 'the package\u2019s paper, not pure white');
  assert.equal(markerInk('not-a-design'), DEFAULT_MARKER_INK);
});

test('markerOf falls back to the design’s first marker rather than to undefined', () => {
  assert.equal(markerOf('klassisch', 0).key, 'standard');
  assert.equal(markerOf('klassisch', 99).key, 'standard');
  assert.equal(markerOf('tisch', 0).key, 'tannenfilz', 'Tannenfilz is the package’s default felt');
  assert.equal(markerOf('not-a-design', 0), null);
});

// ---- assignment and resolution -------------------------------------------

test('markerIndexFromId is in range, stable, and does not collapse onto one colour', () => {
  const ids = Array.from({ length: 400 }, (_, i) => `r${i}x`);
  const seen = new Set();
  for (const id of ids) {
    const n = markerIndexFromId(id);
    assert.ok(isMarkerIndex(n), `${id} produced ${n}`);
    assert.equal(markerIndexFromId(id), n, 'the same id must always give the same marker');
    seen.add(n);
  }
  assert.equal(seen.size, MARKER_COUNT, 'all eight markers must be reachable from real ids');
});

test('a stored marker wins over everything, and only a valid one counts', () => {
  const bg = { type: 'theme', id: 'salbei' };
  assert.equal(resolveMarker({ id: 'r1', marker: 5, background: bg }), 5);
  // Anything that is not an integer 0-7 falls through to the legacy lookup, so a
  // hand-edited data file cannot put an unrenderable index on a round.
  for (const bad of [8, -1, 1.5, '3', null, undefined, NaN]) {
    assert.equal(resolveMarker({ id: 'r1', marker: bad, background: bg }), 2,
      `marker ${String(bad)} must not be accepted`);
  }
});

/* All sixteen registry ids pinned one by one, plus the two shapes that name no
   design at all. Enumerated rather than derived: the world half of this table is
   a judgement about hue (#1187), and a test that re-derived it from the same
   table would assert nothing. */
test('every retired design resolves to its pinned marker index', () => {
  const expected = {
    standard: 0, blaugrau: 1, salbei: 2, rose: 3,
    lavendel: 4, sand: 5, schiefer: 6, pfirsich: 7,
    obsidian: 4, forest: 2, ocean: 1, scifi: 6,
    chess: 0, horror: 2, dinos: 2, burg: 7,
  };
  assert.equal(Object.keys(expected).length, 16, 'nine palettes and seven worlds were ever shipped');
  for (const [id, index] of Object.entries(expected)) {
    assert.equal(resolveMarker({ id: 'whatever', background: { type: 'theme', id } }), index,
      `${id} resolves to the wrong marker`);
  }
  assert.deepEqual(LEGACY_MARKER_INDEX, expected, 'the shipped table and the pinned one must agree');
});

/* A round saved before designs had ids (pre-#903) stored only a page hex, and
   the resolver has to recognise it WITHOUT the deleted palette registry. Only
   the eight light palettes existed then, so only their pages map. */
test('a pre-#903 round (page hex, no id) maps through its palette', () => {
  const pages = {
    '#f4f1ea': 0, '#eef2f7': 1, '#eaf1ea': 2, '#f6ecf1': 3,
    '#efedf8': 4, '#f6efe2': 5, '#e9eef3': 6, '#f8ede6': 7,
  };
  assert.deepEqual(Object.fromEntries(Object.entries(LEGACY_PAGE_DESIGN)
    .map(([page, id]) => [page, LEGACY_MARKER_INDEX[id]])), pages);
  for (const [page, index] of Object.entries(pages)) {
    assert.equal(resolveMarker({ id: 'x', background: { type: 'theme', page, accent: '#000000' } }), index, page);
    assert.equal(resolveMarker({ id: 'x', background: { type: 'theme', page: page.toUpperCase(), accent: '#000' } }),
      index, `${page} upper-cased`);
  }
  // A world's page without an id was never a world: Forest's page hashes.
  assert.equal(legacyDesignId({ type: 'theme', page: '#ecf1e4', accent: '#356427' }), null);
  // An id wins over the page — a Forest round carries Forest's own page.
  assert.equal(legacyDesignId({ type: 'theme', id: 'forest', page: '#ecf1e4' }), 'forest');
});

test('a round with no design, a collage or an unknown id falls back to its id’s marker', () => {
  const id = 'abc123';
  const hashed = markerIndexFromId(id);
  for (const background of [null, { type: 'none' }, { type: 'collage', image: 'x' },
    { type: 'color', color: '#fff' }, { type: 'theme', id: 'not-a-design' }]) {
    assert.equal(resolveMarker({ id, background }), hashed, `${JSON.stringify(background)} should hash`);
  }
});

// ---- the route -----------------------------------------------------------

test('PATCH marker stores 0-7 and shows up on the round and the home summary', async () => {
  const round = await createRound(request);
  for (const index of [0, 3, MARKER_COUNT - 1]) {
    const res = await request(app).patch(`/api/rounds/${round.id}/marker`).send({ index });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { marker: index });
    const read = await request(app).get(`/api/rounds/${round.id}`);
    assert.equal(read.body.marker, index);
    const list = await request(app).get('/api/rounds');
    assert.equal(list.body.find((r) => r.id === round.id).marker, index);
  }
});

test('a new round is created WITH a marker, derived from its own id', async () => {
  const round = await createRound(request);
  assert.equal(round.marker, markerIndexFromId(round.id),
    'createRound stamps the marker so a later hash change cannot re-colour the round');
});

test('PATCH marker refuses anything that is not an index, and 404s an unknown round', async () => {
  const round = await createRound(request);
  for (const body of [{ index: MARKER_COUNT }, { index: -1 }, { index: '3' }, { index: 1.5 },
    { index: null }, {}, { marker: 2 }]) {
    const res = await request(app).patch(`/api/rounds/${round.id}/marker`).send(body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} was accepted`);
  }
  // Unchanged by the refusals above.
  const read = await request(app).get(`/api/rounds/${round.id}`);
  assert.equal(read.body.marker, markerIndexFromId(round.id));

  const missing = await request(app).patch('/api/rounds/nope/marker').send({ index: 2 });
  assert.equal(missing.status, 404);
});

test('PATCH marker no longer accepts the retired design body (#1202)', async () => {
  // The transitional arm that mapped `{ type: 'theme', id }` onto a marker went
  // with the flip: nothing in the app sends it, and an index is the one shape.
  const round = await createRound(request);
  const res = await request(app)
    .patch(`/api/rounds/${round.id}/marker`)
    .send({ type: 'theme', id: 'burg', page: '#171310', accent: '#e8825a' });
  assert.equal(res.status, 400);
});

// ---- the frontend --------------------------------------------------------

function roundFixture(extra) {
  return {
    id: 'r1', name: 'Waldläufer', background: null, marker: 2,
    games: [], members: [], sessions: [], tags: [],
    gameCount: 0, sessionCount: 0, playedCount: 0, lastPlayed: null, ...extra,
  };
}

function open(t, extra) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const sent = [];
  let round = roundFixture(extra);
  dom.set('api', async (method, url, body) => {
    if (method === 'PATCH') { sent.push({ url, body }); round = { ...round, marker: body.index }; return { marker: body.index }; }
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [round];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  dom.set('toast', () => {});
  return { dom, sent };
}

test('the marker screen shows the active design’s eight swatches, with the round’s one pressed', async (t) => {
  const { dom } = open(t);
  await dom.call('showMarker', 'r1');
  const cards = [...dom.app.querySelectorAll('.marker-card')];
  assert.equal(cards.length, MARKER_COUNT);
  const markers = designMarkers('klassisch');
  cards.forEach((c, i) => {
    assert.match(c.getAttribute('style'), new RegExp(`--marker:${markers[i].color}`));
    assert.match(c.getAttribute('style'), new RegExp(`--marker-deep:${markers[i].deep}`));
    assert.match(c.getAttribute('style'), new RegExp(`--marker-ink:${markerInk('klassisch')}`));
    assert.equal(c.querySelector('.marker-card__name').textContent, dom.run(`t('${markers[i].labelKey}')`));
    assert.equal(c.getAttribute('aria-pressed'), String(i === 2));
  });
  // No world posters and no palette cards: choosing a design is over (#1187).
  assert.equal(dom.app.querySelectorAll('.theme-card').length, 0);
});

test('picking a swatch PATCHes the index and re-renders with it pressed', async (t) => {
  const { dom, sent } = open(t);
  await dom.call('showMarker', 'r1');
  dom.app.querySelectorAll('.marker-card')[5].click();
  await flush();
  // Spread out of the vm realm before comparing — an object the VIEW built
  // carries that realm's prototype (.claude/rules/testing-views-under-jsdom.md).
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/rounds/r1/marker');
  assert.deepEqual({ ...sent[0].body }, { index: 5 });
  const pressed = [...dom.app.querySelectorAll('.marker-card')]
    .findIndex((c) => c.getAttribute('aria-pressed') === 'true');
  assert.equal(pressed, 5, 'the redraw must read the new marker, not the stale cached round');
});

/* #1197's acceptance criterion: „picking updates the lobby tile without
   reload". The lobby reads its OWN SWR key, which is fresh for 5s after the
   first visit — so the sequence that matters is lobby -> pick -> lobby within
   that window, where the list is served from cache with no revalidation. */
test('a pick reaches the lobby tile at once, not after the list goes stale', async (t) => {
  const { dom } = open(t);
  await dom.call('showHome');
  const tile = () => dom.document.querySelector('.round-card:not(.round-card--new)');
  assert.match(tile().getAttribute('style'), new RegExp(`--marker:${designMarkers('klassisch')[2].color}`));
  await dom.call('showMarker', 'r1');
  dom.app.querySelectorAll('.marker-card')[5].click();
  await flush();
  await dom.call('showHome');
  assert.match(tile().getAttribute('style'), new RegExp(`--marker:${designMarkers('klassisch')[5].color}`),
    'the lobby must draw the felt just picked, not the cached list’s');
});

test('the marker reaches the document root inside a round and is cleared outside it', async (t) => {
  const { dom } = open(t);
  const root = dom.document.documentElement;
  await dom.call('showMarker', 'r1');
  assert.equal(root.style.getPropertyValue('--marker'), designMarkers('klassisch')[2].color);
  assert.equal(root.hasAttribute('data-marked'), true, 'the CSS hook the four surfaces key off');
  await dom.call('showHome');
  assert.equal(root.style.getPropertyValue('--marker'), '');
  assert.equal(root.hasAttribute('data-marked'), false, 'leaving a round must not leak its colour');
});

/* The flip's acceptance criterion (#1202): a round that wore a world shows its
   MAPPED marker, in both designs — no world hook, no world accent, no world
   emblem. Forest maps to index 2: Salbei under Klassisch, Burgunderfilz under
   Der Tisch. */
for (const design of ['klassisch', 'tisch']) {
  test(`a round that wore Forest shows its mapped marker under ${design}`, async (t) => {
    const dom = loadApp({ locale: 'de', design });
    t.after(() => dom.close());
    dom.set('api', async () => [
      roundFixture({ id: 'a', marker: null, background: { type: 'theme', id: 'forest', page: '#ecf1e4', accent: '#356427' } }),
    ]);
    dom.set('accountsActive', () => false);
    dom.set('isLoggedIn', () => false);
    await dom.call('showHome');
    const tile = dom.document.querySelector('.round-card:not(.round-card--new)');
    const want = designMarkers(design)[LEGACY_MARKER_INDEX.forest];
    assert.match(tile.getAttribute('style'), new RegExp(`--marker:${want.color}`));
    assert.equal(tile.hasAttribute('data-world'), false, 'no world hook survives the flip');
    assert.equal(/--brand/.test(tile.getAttribute('style')), false, 'the world accent is not written');
    assert.equal(tile.querySelector('.round-card__emblem').style.background, 'var(--marker)');
    assert.ok(tile.querySelector('.round-card__emblem .ti-tornado'), 'the app glyph, not a world icon');
    assert.equal(dom.document.documentElement.dataset.world, undefined);
  });
}

test('a legacy palette round’s emblem colour is UNCHANGED under Klassisch', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // No stored marker: the round predates them, so the legacy lookup decides.
  dom.set('api', async () => [roundFixture({
    id: 'a', marker: null,
    background: { type: 'theme', id: 'salbei', page: '#eaf1ea', accent: '#397a4b' },
  })]);
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  await dom.call('showHome');
  const card = dom.document.querySelector('.round-card:not(.round-card--new)');
  // The whole point of taking Klassisch's markers from the palette ACCENTS: the
  // colour the tile paints is the one Salbei painted before the flip.
  assert.match(card.getAttribute('style'), /--marker:#397a4b/);
});
