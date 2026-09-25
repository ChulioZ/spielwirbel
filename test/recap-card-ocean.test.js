'use strict';

/*
 * Ocean's share card (#1220, public/js/recap-card-ocean.js).
 *
 * As with Der Tisch's card: jsdom has no 2d context and Node has no WebKit, so
 * nothing here can observe a TAINTED canvas. What it pins is the mechanism that
 * keeps the card clean in both engines (no pattern, no icon font, one
 * same-origin image), the three formats' sizes, the privacy commitment O8.3
 * states (first names only, no time of day, nobody who did not win), that every
 * string is drawn in an ink measured against the opaque band, and the copy of
 * the design's tokens the card paints with. The export itself was run in
 * headless Chromium and a headless WKWebView (the PR records it).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');
const { token, hex, contrast } = require('./support/theme');
const { designById } = require('../public/js/designs');

const OCEAN = designById('ocean');

/* A recording 2d context on every canvas — the shape recap-card-tisch.test.js
   uses, plus bezierCurveTo for the whale. */
function boot({ design = 'ocean' } = {}) {
  const dom = loadApp();
  dom.run(`
    globalThis.__calls = [];
    globalThis.__canvases = [];
    globalThis.Path2D = class { constructor(d) { this.d = d; } };
    const rec = (canvas, m) => (...a) => { __calls.push({ m, a, canvas }); };
    HTMLCanvasElement.prototype.getContext = function () {
      const canvas = this;
      if (!__canvases.includes(canvas)) __canvases.push(canvas);
      const grad = () => ({ addColorStop: () => {} });
      const ctx = {
        canvas, globalAlpha: 1, textAlign: 'left', textBaseline: 'alphabetic', lineWidth: 1,
        shadowBlur: 0, shadowColor: '', shadowOffsetY: 0,
        _font: '10px sans-serif',
        get font() { return this._font; },
        set font(v) { this._font = v; __calls.push({ m: 'font', a: [v], canvas }); },
        _fill: '#000',
        get fillStyle() { return this._fill; },
        set fillStyle(v) { this._fill = v; __calls.push({ m: 'fillStyle', a: [v], canvas }); },
        strokeStyle: '#000',
        measureText: (s) => ({ width: String(s).length * 7 }),
        createLinearGradient: grad, createRadialGradient: grad,
        createPattern: rec(canvas, 'createPattern'),
      };
      for (const m of ['fillRect', 'fill', 'beginPath', 'roundRect', 'arc', 'stroke', 'moveTo', 'lineTo',
        'bezierCurveTo', 'closePath', 'clip', 'save', 'restore', 'translate', 'rotate', 'scale',
        'fillText', 'drawImage']) {
        ctx[m] = rec(canvas, m);
      }
      return ctx;
    };
    HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob(['png'], { type: 'image/png' })); };
    globalThis.Image = class { set src(v) { this._src = v; this.naturalWidth = 900; this.naturalHeight = 264; setTimeout(() => this.onload && this.onload()); } get src() { return this._src; } };
  `);
  dom.call('applyDesign', design);
  return dom;
}

// Every call, serialized once page-side; filtering happens here, so no test
// value is ever spliced into code the page evaluates.
const allCalls = (dom) => JSON.parse(dom.run('JSON.stringify(__calls.map((c) => [c.m, c.a.map((x) => (x && x.d) ? { path: x.d.slice(0, 12) } : (x && x._src) ? { img: x._src } : (typeof x === \'object\' ? \'[obj]\' : x))]))'));
const calls = (dom, m) => allCalls(dom).filter(([name]) => name === m).map(([, args]) => args);

// Every fillText with the fillStyle in force when it ran.
function texts(dom) {
  let fill = null;
  const out = [];
  for (const [m, a] of allCalls(dom)) {
    if (m === 'fillStyle') fill = a[0];
    if (m === 'fillText') out.push({ text: String(a[0]), fill });
  }
  return out;
}

const SESSION = {
  roundName: 'Donnerstagsrunde', when: '20.09.2026, 21:47', day: '20.09.2026',
  cancelled: false, playedTitle: 'Nordlichter', winnerNames: ['Jonas Albrecht'], ending: null,
  people: [
    { name: 'Jonas Albrecht', initials: 'JA', color: '#c6522c', winner: true },
    { name: 'Lea Brandt', initials: 'LB', color: '#198663', winner: false },
    { name: 'Mia (Gast)', initials: 'MI', color: null, winner: false },
  ],
  rows: [
    { title: 'Nordlichter', score: 4.8, count: 5, place: 1 },
    { title: 'Kartographen', score: 4.1, count: 5, place: 2 },
  ],
};
const PERIOD = {
  heading: 'Donnerstagsrunde', periodLabel: '2026', sessions: 23, gamesPlayed: 14,
  played: ['Nordlichter'], playedSub: '5 Sessions', rated: ['Kartographen'], ratedScore: '4,6',
  shelf: [
    { n: 6, label: 'hinzugefügt', plus: true },
    { n: 0, label: 'aussortiert' },
    { n: 2, label: 'durchgespielt' },
  ],
};

const spec = (dom, kind, model) => JSON.parse(dom.run(`JSON.stringify(oceanCardSpec(${JSON.stringify(kind)}, ${JSON.stringify(model)}))`));

test('the card’s colours are Ocean’s own tokens, value for value', () => {
  // The licence for the copy (.claude/rules/shared-constants-across-the-stack.md):
  // retuning a token in ocean.css goes red here naming both values.
  const dom = loadApp();
  try {
    const tokens = JSON.parse(dom.run('JSON.stringify(OCEAN_CARD_TOKENS)'));
    const names = Object.keys(tokens);
    assert.ok(names.length >= 20, 'the copy was actually read');
    for (const name of names) {
      assert.deepEqual(hex(tokens[name]), token(name, OCEAN),
        `${name}: the card paints ${tokens[name]}, the design declares another value`);
    }
  } finally { dom.close(); }
});

test('every ink the card writes text in clears 4.5:1 on what it is written on', () => {
  const dom = loadApp();
  try {
    const tokens = JSON.parse(dom.run('JSON.stringify(OCEAN_CARD_TOKENS)'));
    const pairs = JSON.parse(dom.run('JSON.stringify(OCEAN_CARD_TEXT)'));
    assert.ok(pairs.length >= 9, 'the pairs were actually read');
    for (const { ink, on } of pairs) {
      assert.ok(tokens[ink] && tokens[on], `${ink} on ${on}: both are in the token copy`);
      const ratio = contrast(hex(tokens[ink]), hex(tokens[on]));
      assert.ok(ratio >= 4.5, `${ink} on ${on} is ${ratio.toFixed(2)}:1`);
    }
  } finally { dom.close(); }
});

test('session spec: first names only, the date without the time, nobody who did not win', () => {
  const dom = boot();
  try {
    const s = spec(dom, 'session', SESSION);
    assert.equal(s.kicker, '20.09.2026', 'the day, never `when` with its time of day');
    assert.deepEqual(s.winners.map((w) => [w.first, w.initials]), [['Jonas', 'JO']],
      'a first name, and initials from it — the model’s own carry the surname’s letter');
    assert.equal(s.winText, 'Jonas hat gewonnen');
    assert.deepEqual(s.score, { text: '4,8', stop: '5' }, 'the group’s score, never a person’s rating');
    const dump = JSON.stringify(s);
    for (const leak of ['Albrecht', 'Lea', 'Brandt', 'Mia', '21:47']) {
      assert.ok(!dump.includes(leak), `${leak} must not reach the card`);
    }
    const land = spec(dom, 'landscape', SESSION);
    assert.equal(land.sentence, '„Nordlichter“ wurde gespielt.');

    const lost = spec(dom, 'session', { ...SESSION, winnerNames: [], people: [], ending: 'lost' });
    assert.equal(lost.winText, 'Verloren – das Spiel hat gewonnen');
    const split = spec(dom, 'session', { roundName: 'R', day: 'd', outcome: 'split',
      tables: [{ title: 'Nordlichter', names: 'Jonas Albrecht, Lea' }, { title: 'Azul', names: 'Ida' }] });
    assert.equal(split.winText, 'Nordlichter · Azul', 'a split names its tables, not their people');
    assert.ok(!JSON.stringify(split).includes('Albrecht'));
  } finally { dom.close(); }
});

test('period spec: the numbers, then the named rows, a zero shelf figure dropped', () => {
  const dom = boot();
  try {
    const s = spec(dom, 'period', PERIOD);
    assert.equal(s.pill, 'Donnerstagsrunde');
    assert.equal(s.title, '2026');
    assert.deepEqual(s.stats.map((x) => x.n), ['23', '14', '+6', '2']);
    assert.deepEqual(s.named.map((r) => r.value), ['Nordlichter', 'Kartographen']);
    assert.equal(s.named[1].sub, '4,6');
  } finally { dom.close(); }
});

test('drawing: three sizes, no pattern, no icon font, one same-origin image, measured inks only', async () => {
  const dom = boot();
  try {
    const inks = JSON.parse(dom.run('JSON.stringify([...new Set(OCEAN_CARD_TEXT.map((p) => OCEAN_CARD_TOKENS[p.ink]))])'));
    for (const [kind, model, size] of [
      ['session', SESSION, [1080, 1350]],
      ['landscape', SESSION, [1200, 630]],
      ['period', PERIOD, [1080, 1350]],
    ]) {
      dom.run('__calls.length = 0; __canvases.length = 0');
      dom.context.__model = model;
      await dom.run(`oceanCardBlob(${JSON.stringify(kind)}, __model)`);
      assert.deepEqual(calls(dom, 'createPattern'), [], `${kind}: a pattern taints the canvas in WebKit`);
      const fonts = calls(dom, 'font').map((a) => a[0]);
      assert.ok(fonts.every((f) => !/tabler/i.test(f)), `${kind}: the icon font must never reach the canvas`);
      const images = calls(dom, 'drawImage').map((a) => a[0].img);
      assert.deepEqual([...new Set(images)], ['/icons/powered-by-bgg.png'], `${kind}: only the BGG badge is an image`);
      assert.ok(calls(dom, 'fill').some((a) => a[0] && a[0].path), `${kind}: the whirl is a Path2D fill`);
      const drawn = texts(dom);
      assert.ok(drawn.length > 4, `${kind}: text was drawn`);
      for (const { text, fill } of drawn) {
        assert.ok(inks.includes(fill), `${kind}: „${text}" is drawn in ${fill}, which OCEAN_CARD_TEXT does not measure`);
      }
      const all = drawn.map((d) => d.text).join('');
      assert.ok(all.includes('spielwirbel.app'.split('').join('')) || all.includes('spielwirbel.app'),
        `${kind}: the card says where it came from`);
      assert.ok(!/Albrecht|21:47/.test(all), `${kind}: no surname, no time of day`);
      const sizes = JSON.parse(dom.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))'));
      assert.deepEqual(sizes, [size], `${kind}: one ${size.join('x')} canvas`);
    }
  } finally { dom.close(); }
});

test('the Chronik’s share draws Ocean’s period card only while Ocean is worn', async () => {
  const ocean = boot({ design: 'ocean' });
  try {
    ocean.context.__model = PERIOD;
    await ocean.run('recapCardBlob(__model)');
    const drawn = texts(ocean).map((d) => d.text);
    assert.ok(drawn.includes('+6'), 'Ocean’s number rows were drawn');
  } finally { ocean.close(); }

  const tisch = boot({ design: 'tisch' });
  try {
    tisch.context.__model = PERIOD;
    await tisch.run('recapCardBlob(__model)');
    assert.ok(!texts(tisch).some((d) => d.text === '+6'), 'Der Tisch keeps its own card');
  } finally { tisch.close(); }
});

test('the results screen’s share: portrait on a phone, landscape on a wide screen, failures reported', async () => {
  const dom = boot();
  try {
    dom.run(`
      globalThis.__shared = []; globalThis.__reports = [];
      navigator.canShare = () => true;
      navigator.share = async (data) => { __shared.push((data.files || []).length); };
      globalThis.__wide = false;
      window.matchMedia = () => ({ matches: __wide });
    `);
    dom.set('reportClientError', (kind) => { dom.context.__reports.push(kind); });
    dom.context.__model = SESSION;
    const size = () => JSON.parse(dom.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))'));

    dom.run('__canvases.length = 0');
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), true);
    assert.deepEqual(size(), [[1080, 1350]], 'a phone shares the portrait card');

    dom.run('__canvases.length = 0; __wide = true');
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), true);
    assert.deepEqual(size(), [[1200, 630]], 'a wide landscape screen shares the 1.91:1 card');

    dom.run('HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); }');
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), false, 'the text share still runs');
    assert.deepEqual([...dom.context.__reports], ['recap_export'], 'and the failure reaches the operator');
  } finally { dom.close(); }
});
