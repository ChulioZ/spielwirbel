'use strict';

/*
 * Die Brücke's share card (#1247, public/js/recap-card-bruecke.js).
 *
 * As with the other designs' cards: jsdom has no 2d context and Node has no
 * WebKit, so nothing here can observe a TAINTED canvas. What it pins is the
 * mechanism that keeps the card clean in both engines (no pattern, no icon
 * font, one same-origin image), the export size and B8.4's floor — no text
 * under 24 px EXPORTED, i.e. 14 px on the 600 px drawing — that every string is
 * drawn in an ink measured against its ground, what reaches the card, and the
 * copy of the design's tokens it paints with. The export itself was run in
 * headless Chromium and WebKit (the PR records it).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');
const { token, hex, contrast } = require('./support/theme');
const { designById } = require('../public/js/designs');
const { periodMonths } = require('../public/js/period-recap');

const BRUECKE = designById('bruecke');

/* A recording 2d context on every canvas — recap-card-ocean.test.js's shape,
   plus strokeRect and createRadialGradient for the ground. */
function boot({ design = 'bruecke' } = {}) {
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
      for (const m of ['fillRect', 'strokeRect', 'fill', 'beginPath', 'roundRect', 'arc', 'stroke', 'moveTo',
        'lineTo', 'bezierCurveTo', 'closePath', 'clip', 'save', 'restore', 'translate', 'rotate', 'scale',
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

const YEAR = { kind: 'year', key: '2026' };
const MONTHLY = periodMonths(
  ['2026-01-09T20:00:00', '2026-03-05T20:00:00', '2026-03-19T20:00:00', '2026-07-02T20:00:00', '2025-12-30T20:00:00'],
  YEAR,
);
const PERIOD = {
  heading: 'Donnerstagsrunde', periodLabel: '2026', sessions: 23, gamesPlayed: 14,
  played: ['Nordlichter'], playedSub: '5 Sessions', rated: ['Kartographen'], ratedScore: '4,6',
  shelf: [
    { n: 6, label: 'hinzugefügt', plus: true },
    { n: 0, label: 'aussortiert' },
    { n: 2, label: 'durchgespielt' },
  ],
  monthly: MONTHLY,
};

const spec = (dom, model) => JSON.parse(dom.run(`JSON.stringify(brueckeCardSpec(${JSON.stringify(model)}))`));

test('periodMonths: a year’s twelve local-calendar buckets, nothing for a month', () => {
  assert.equal(MONTHLY.length, 12);
  assert.deepEqual(MONTHLY.map((m) => m.count), [1, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    'the December 2025 session is not 2026’s');
  assert.equal(MONTHLY[2].at, '2026-03-01T00:00:00');
  assert.equal(periodMonths(['2026-03-05T20:00:00'], { kind: 'month', key: '2026-03' }), null);
  assert.equal(periodMonths(null, YEAR).reduce((n, m) => n + m.count, 0), 0);
});

test('the card’s colours are Die Brücke’s own tokens, value for value', () => {
  // The licence for the copy (.claude/rules/shared-constants-across-the-stack.md):
  // retuning a token in bruecke.css goes red here naming both values.
  const dom = loadApp();
  try {
    const tokens = JSON.parse(dom.run('JSON.stringify(BRUECKE_CARD_TOKENS)'));
    const names = Object.keys(tokens);
    assert.ok(names.length >= 7, 'the copy was actually read');
    for (const name of names) {
      assert.deepEqual(hex(tokens[name]), token(name, BRUECKE),
        `${name}: the card paints ${tokens[name]}, the design declares another value`);
    }
  } finally { dom.close(); }
});

test('every ink the card writes text in clears 4.5:1 on its ground, and over a dot', () => {
  const dom = loadApp();
  try {
    const tokens = JSON.parse(dom.run('JSON.stringify(BRUECKE_CARD_TOKENS)'));
    const pairs = JSON.parse(dom.run('JSON.stringify(BRUECKE_CARD_TEXT)'));
    const alpha = dom.run('BRUECKE_CARD_DOT_ALPHA');
    assert.ok(pairs.length >= 9, 'the pairs were actually read');
    // The worst ground: a dot at full strength over the gradient's light stop.
    const dot = hex(tokens['--page-hi']).map((c, i) => c * (1 - alpha) + hex(tokens['--brand'])[i] * alpha);
    for (const { ink, on } of pairs) {
      assert.ok(tokens[ink] && tokens[on], `${ink} on ${on}: both are in the token copy`);
      const ratio = contrast(hex(tokens[ink]), hex(tokens[on]));
      assert.ok(ratio >= 4.5, `${ink} on ${on} is ${ratio.toFixed(2)}:1`);
      const over = contrast(hex(tokens[ink]), dot);
      assert.ok(over >= 4.5, `${ink} over a dot is ${over.toFixed(2)}:1`);
    }
  } finally { dom.close(); }
});

test('spec: the round, the period, four figures, the bars, the most-played game', () => {
  const dom = boot();
  try {
    const s = spec(dom, PERIOD);
    assert.equal(s.title, 'Donnerstagsrunde');
    assert.equal(s.kicker, 'Rückblick 2026');
    assert.deepEqual(s.figures.map((f) => f.value), ['23', '14', 'Kartographen', '+6'],
      'counts without a leading zero, the rated game, then the first shelf figure — four at most');
    assert.equal(s.figures[2].label, 'Bestbewertet · 4,6', 'the score keeps its comma');
    assert.deepEqual(s.figures.map((f) => f.accent), [false, false, true, true]);
    assert.equal(s.bars.length, 12);
    assert.deepEqual(s.bars.map((b) => b.count), [1, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    assert.equal(s.bars[0].month, 'J');
    assert.equal(s.barsLabel, 'Sessions pro Monat');
    assert.deepEqual(s.played, { label: 'Meistgespielt', value: 'Nordlichter · 5 Sessions' });

    // A month period has no chart; a period with nothing rated moves the shelf up.
    const month = spec(dom, { ...PERIOD, monthly: null, rated: [], ratedScore: '' });
    assert.equal(month.bars, null);
    assert.deepEqual(month.figures.map((f) => f.value), ['23', '14', '+6', '2']);
    // A year with no played session draws no empty chart either.
    assert.equal(spec(dom, { ...PERIOD, monthly: periodMonths([], YEAR) }).bars, null);
    assert.equal(spec(dom, { ...PERIOD, played: [] }).played, null);
  } finally { dom.close(); }
});

test('drawing: 1080 square, no pattern, no icon font, no text under 24 px exported, measured inks only', async () => {
  const dom = boot();
  try {
    const inks = JSON.parse(dom.run('JSON.stringify([...new Set(BRUECKE_CARD_TEXT.map((p) => BRUECKE_CARD_TOKENS[p.ink]))])'));
    const scale = dom.run('BRUECKE_CARD_SCALE');
    for (const model of [PERIOD, { ...PERIOD, monthly: null, heading: 'Torstain peliseurue ja ystävät kaikki yhdessä' }]) {
      dom.run('__calls.length = 0; __canvases.length = 0');
      dom.context.__model = model;
      await dom.run('brueckeCardBlob(__model)');
      assert.deepEqual(calls(dom, 'createPattern'), [], 'a pattern taints the canvas in WebKit');
      const fonts = calls(dom, 'font').map((a) => a[0]);
      assert.ok(fonts.length > 5, 'fonts were set');
      assert.ok(fonts.every((f) => !/tabler/i.test(f)), 'the icon font must never reach the canvas');
      for (const f of fonts) {
        const px = Number(/(\d+(?:\.\d+)?)px/.exec(f)[1]);
        assert.ok(px * scale >= 24, `${f} exports at ${(px * scale).toFixed(1)} px, under B8.4’s 24 px floor`);
      }
      const images = calls(dom, 'drawImage').map((a) => a[0].img);
      assert.deepEqual([...new Set(images)], ['/icons/powered-by-bgg.png'], 'only the BGG badge is an image');
      const drawn = texts(dom);
      assert.ok(drawn.length > 10, 'text was drawn');
      for (const { text, fill } of drawn) {
        assert.ok(inks.includes(fill), `„${text}" is drawn in ${fill}, which BRUECKE_CARD_TEXT does not measure`);
      }
      const all = drawn.map((d) => d.text).join('');
      assert.ok(all.includes('SPIELWIRBEL'), 'the card carries the design’s wordmark');
      assert.ok(all.includes('KARTOGRAPHEN'.slice(0, 4)) || all.includes('Kartographen'.slice(0, 4)), 'the figures were drawn');
      const sizes = JSON.parse(dom.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))'));
      assert.deepEqual(sizes, [[1080, 1080]], 'one 1080x1080 canvas');
    }
  } finally { dom.close(); }
});

test('the period share draws Die Brücke’s card only while Die Brücke is worn, and a failure is reported', async () => {
  const bruecke = boot({ design: 'bruecke' });
  try {
    bruecke.context.__model = PERIOD;
    await bruecke.run('recapCardBlob(__model)');
    const sizes = JSON.parse(bruecke.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))'));
    assert.deepEqual(sizes, [[1080, 1080]], 'Die Brücke’s square card was drawn');

    // The export path's catch reports as well as toasts
    // (.claude/rules/caught-client-faults-are-invisible.md).
    bruecke.run('globalThis.__reports = []; globalThis.__toasts = []');
    bruecke.set('reportClientError', (kind) => { bruecke.context.__reports.push(kind); });
    bruecke.set('toast', (msg) => { bruecke.context.__toasts.push(msg); });
    bruecke.run('HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); }');
    await bruecke.run('shareRecapCard({ key: "2026" }, __model)');
    assert.deepEqual([...bruecke.context.__reports], ['recap_export'], 'the failure reaches the operator');
    assert.equal(bruecke.context.__toasts.length, 1, 'and the user still sees the toast');
  } finally { bruecke.close(); }

  const ocean = boot({ design: 'ocean' });
  try {
    ocean.context.__model = PERIOD;
    await ocean.run('recapCardBlob(__model)');
    const sizes = JSON.parse(ocean.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))'));
    assert.deepEqual(sizes, [[1080, 1350]], 'Ocean keeps its own card');
  } finally { ocean.close(); }
});

// The results screen's model (shareResult, views-session.js) — the text
// share's own input. A tie for second: two rows print place 2 (#1628).
const SESSION = {
  roundName: 'Donnerstagsrunde', when: '20.09.2026, 20:00', day: '20.09.2026', cancelled: false,
  playedTitle: 'Nordlichter', winnerNames: ['Jonas'], ending: null, people: [],
  bringers: ['Lea'],
  rows: [
    { title: 'Nordlichter', score: 4.8, count: 5, place: 1 },
    { title: 'Kartographen', score: 4.1, count: 5, place: 2 },
    { title: 'Azul', score: 4.1, count: 5, place: 2 },
    { title: 'Zugvögel', score: 0.5, count: 5, place: 4 },
    { title: 'Unbewertet', score: 0, count: 0, place: null },
  ],
};

// The same evening before the pick, and after it with points (#1726).
const RANKING = {
  ...SESSION, playedTitle: null, winnerNames: [], bringers: [],
  rows: SESSION.rows.map((r) => ({ ...r, dist: [1, 2, 3, 4, 5].map((n) => ({ n, count: r.count ? n % 3 : 0, word: '' })) })),
};
const WITH_POINTS = {
  ...SESSION, finished: true,
  points: [{ name: 'Jonas', text: '42', winner: true }, { name: 'Lea', text: '37' }, { name: 'Automa', text: '30', automa: true }],
};
const SPLIT_MODEL = {
  roundName: 'R', day: '20.09.2026', outcome: 'split',
  tables: [{ title: 'Azul', names: 'Anna, Ben', winnerNames: ['Anna'], points: [{ name: 'Anna', text: '61' }] }],
};
const sessionSpec = (dom, model) => JSON.parse(dom.run(`JSON.stringify(brueckeSessionSpec(${JSON.stringify(model)}))`));

test('session spec (#1628): the screen’s sentence, the played score, who brings it, the ranking with its tie', () => {
  const dom = boot();
  try {
    const s = sessionSpec(dom, SESSION);
    assert.equal(s.kicker, 'Donnerstagsrunde · 20.09.2026', 'the date alone, no time of day');
    assert.equal(s.title, '„Nordlichter“ wurde gespielt. Jonas hat gewonnen!');
    assert.ok(!s.title.includes('\u{1F3C6}'), 'the trophy emoji must not reach the canvas');
    assert.deepEqual(s.plate, { value: '4,8', label: 'Spielwirbel-Score · 5 Wertungen' });
    assert.equal(s.bringers, 'Gehört Lea');
    assert.deepEqual(s.rows, [], 'once a game is played the ranking is dropped (#1726)');
    const r = JSON.parse(dom.run(`JSON.stringify(brueckeSessionSpec(${JSON.stringify(RANKING)}))`));
    assert.deepEqual(r.rows.map((x) => x.place), ['1', '2', '2', '4'], 'a shared place prints twice; unrated rows never');
    assert.equal(r.plate, null, 'no plate before a pick');

    // A cancelled evening names no played game, so it carries no plate and no bringers.
    const cancelled = sessionSpec(dom, { ...SESSION, cancelled: true });
    assert.equal(cancelled.plate, null);
    assert.equal(cancelled.bringers, '');
    assert.equal(cancelled.rows.length, 4, 'its ratings still stand');
  } finally { dom.close(); }
});

test('session drawing: 1080 square, no pattern, nothing under 24 px exported, measured inks only', async () => {
  const dom = boot();
  try {
    const inks = JSON.parse(dom.run('JSON.stringify([...new Set(BRUECKE_CARD_TEXT.map((p) => BRUECKE_CARD_TOKENS[p.ink]))])'));
    const scale = dom.run('BRUECKE_CARD_SCALE');
    const long = { ...SESSION, playedTitle: 'Die Siedler von Catan – Städte und Ritter Jubiläumsausgabe', winnerNames: ['Konstantin', 'Maximiliane', 'Jonas'] };
    // Every stage goes through the floor and the measured inks (#1726): the
    // played card, the ranking with its strips, the points, a split evening.
    for (const model of [SESSION, long, RANKING, WITH_POINTS, SPLIT_MODEL]) {
      dom.run('__calls.length = 0; __canvases.length = 0');
      dom.context.__model = model;
      await dom.run('brueckeCardBlob(__model, "session")');
      assert.deepEqual(calls(dom, 'createPattern'), [], 'a pattern taints the canvas in WebKit');
      for (const f of calls(dom, 'font').map((a) => a[0])) {
        assert.ok(!/tabler/i.test(f), 'the icon font must never reach the canvas');
        const px = Number(/(\d+(?:\.\d+)?)px/.exec(f)[1]);
        assert.ok(px * scale >= 24, `${f} exports at ${(px * scale).toFixed(1)} px, under B8.4’s 24 px floor`);
      }
      assert.deepEqual([...new Set(calls(dom, 'drawImage').map((a) => a[0].img))], ['/icons/powered-by-bgg.png']);
      const drawn = texts(dom);
      for (const { text, fill } of drawn) {
        assert.ok(inks.includes(fill), `„${text}" is drawn in ${fill}, which BRUECKE_CARD_TEXT does not measure`);
      }
      const all = drawn.map((d) => d.text).join('');
      if (model === RANKING) {
        assert.ok(all.includes('Kartographen') && all.includes('Azul'), 'the ranking was drawn');
        continue;
      }
      if (model === WITH_POINTS) assert.ok(all.includes('Automa') && all.includes('37'), 'the points were drawn');
      if (model === SPLIT_MODEL) { assert.ok(all.includes('Azul') && all.includes('Anna hat gewonnen'), 'the tables'); continue; }
      assert.ok(!all.includes('Kartographen'), 'no ranking once a game was played');
      if (model !== long) assert.ok(all.includes('4,8'), 'the played score was drawn');
      assert.ok(all.includes('GEHÖRT'), 'the bringers line was drawn');
      assert.deepEqual(JSON.parse(dom.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))')), [[1080, 1080]]);
    }
  } finally { dom.close(); }
});

test('the results screen shares Die Brücke’s session card — a split evening’s too', async () => {
  const dom = boot();
  try {
    dom.run('globalThis.__shared = []; navigator.canShare = () => true; navigator.share = async (d) => { __shared.push((d.files || []).length); };');
    dom.context.__model = SESSION;
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), true);
    assert.deepEqual(JSON.parse(dom.run('JSON.stringify(__shared)')), [1], 'the card went with the text');
    assert.deepEqual(JSON.parse(dom.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))')), [[1080, 1080]]);

    // A split evening is a card too since #1726.
    dom.run('__canvases.length = 0');
    dom.context.__model = SPLIT_MODEL;
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), true, 'a split parent shares its card');
    assert.deepEqual(JSON.parse(dom.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))')), [[1080, 1080]]);
  } finally { dom.close(); }
});
