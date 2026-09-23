'use strict';

/*
 * Der Tisch's share card (#1199, public/js/recap-card-tisch.js).
 *
 * What a CI run can and cannot see here, stated up front so nobody reads the
 * suite as engine coverage: jsdom has no 2d context and Node has no WebKit, so
 * nothing below can observe a TAINTED canvas. What it pins is the MECHANISM
 * that keeps the card clean in both engines — no pattern, no icon font, one
 * image and it is same-origin — plus the dispatch that keeps Klassisch on its
 * classic card, and the copy of the design's tokens the card paints with. The
 * export itself was run in headless Chromium and a headless WKWebView for all
 * three variants (the PR records it); that is the only instrument for the taint.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');
const { token, hex, declaration } = require('./support/theme');
const { designById } = require('../public/js/designs');

/* A recording 2d context on every canvas, plus the three browser APIs jsdom
   lacks. The badge Image resolves at once — jsdom never fires load or error
   for an image, so without this tischBadge() would wait forever. */
function boot({ design = 'tisch' } = {}) {
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
        canvas, globalAlpha: 1, globalCompositeOperation: 'source-over', textAlign: 'left',
        textBaseline: 'alphabetic', lineWidth: 1, shadowBlur: 0, shadowColor: '', shadowOffsetY: 0,
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
        'closePath', 'clip', 'save', 'restore', 'translate', 'rotate', 'scale', 'fillText', 'drawImage']) {
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

const calls = (dom, m) => JSON.parse(dom.run(`JSON.stringify(__calls.filter((c) => c.m === ${JSON.stringify(m)}).map((c) => c.a.map((x) => (x && x.d) ? { path: x.d.slice(0, 12) } : (x && x._src) ? { img: x._src } : (typeof x === 'object' ? '[obj]' : x))))`));

const SESSION = {
  roundName: 'Donnerstagsrunde', when: '20.09.2026', cancelled: false, playedTitle: 'Nordlichter',
  winnerNames: ['Jonas'], ending: null,
  people: [
    { name: 'Jonas', initials: 'JO', color: '#c6522c', winner: true },
    { name: 'Lea', initials: 'LE', color: '#198663', winner: false },
    { name: 'Gast', initials: 'GA', color: null, winner: false },
  ],
  rows: [
    { title: 'Nordlichter', score: 4.8, count: 5, place: 1 },
    { title: 'Kartographen', score: 4.1, count: 5, place: 2 },
    { title: 'Zugvögel', score: 0.5, count: 5, place: 3 },
    { title: 'Die Insel', score: 3, count: 5, place: 4 },
    { title: 'Unbewertet', score: 0, count: 0, place: null },
  ],
};
const SPLIT = {
  roundName: 'Donnerstagsrunde', when: '20.09.2026', outcome: 'split',
  tables: [{ title: 'Nordlichter', names: 'Jonas, Lea' }, { title: 'Azul', names: 'Ida, Ben' }],
};
const PERIOD = {
  roundName: 'Donnerstagsrunde', periodLabel: 'Sommer 2026', sessions: 14, gamesPlayed: 9,
  played: ['Nordlichter'], playedSub: '5 Sessions', rated: ['Kartographen'], ratedScore: '4,6',
  added: 6, retired: 0, completed: 2,
};

const spec = (dom, kind, model) => JSON.parse(dom.run(`JSON.stringify(tischCardSpec(${JSON.stringify(kind)}, ${JSON.stringify(model)}))`));

test('the card’s colours are Der Tisch’s own tokens, value for value', () => {
  /* The licence for the copy (.claude/rules/shared-constants-across-the-stack.md,
     the TAG_ICONS shape): every value must equal what the contrast suite resolves
     for the design, through the SAME resolver — so retuning a felt or the score
     ramp in tisch.css goes red here naming both values. */
  const dom = loadApp();
  try {
    const tisch = designById('tisch');
    const tokens = JSON.parse(dom.run('JSON.stringify(TISCH_CARD_TOKENS)'));
    const names = Object.keys(tokens);
    assert.ok(names.length >= 25, 'the copy was actually read');
    for (const name of names) {
      assert.deepEqual(hex(tokens[name]), token(name, tisch),
        `${name}: the card paints ${tokens[name]}, the design declares another value`);
    }
    // The one token the resolver cannot evaluate (an rgba), compared as text.
    const norm = (s) => s.replace(/\s+/g, '');
    assert.equal(norm(dom.run('TISCH_CARD_GRAIN')), norm(declaration('--wood-grain', true, tisch)),
      'the no-cover grain is the one tisch.css paints on .cover-ph');
  } finally { dom.close(); }
});

test('session spec: the screen’s own sentence, winners in gold, the Tafel’s rated rows only', () => {
  const dom = boot();
  try {
    const s = spec(dom, 'session', SESSION);
    const sentence = s.headline.map((r) => r.text).join('');
    assert.ok(!sentence.includes('\u{1F3C6}'), 'the trophy emoji must not reach the canvas');
    assert.equal(sentence, '„Nordlichter“ wurde gespielt. Jonas hat gewonnen!');
    assert.deepEqual(s.headline.filter((r) => r.gold).map((r) => r.text), ['Jonas']);
    assert.equal(s.kicker, 'Donnerstagsrunde · 20.09.2026');
    assert.equal(s.feature.big, '4,8', 'the played game’s score, in the reader’s notation');
    assert.match(s.feature.sub, /Spielwirbel-Score · 5 Wertungen/);
    assert.deepEqual(s.rows.map((r) => r.title), ['Nordlichter', 'Kartographen', 'Zugvögel'],
      'at most three rows, unrated ones never');
    assert.deepEqual(s.rows.map((r) => r.stop), ['5', '4', 'veto']);
    assert.deepEqual(s.rows.map((r) => r.gold), [true, false, false]);
    assert.equal(s.people.length, 3);
  } finally { dom.close(); }
});

test('split and period specs carry what their screens share, and nothing new', () => {
  const dom = boot();
  try {
    const split = spec(dom, 'split', SPLIT);
    assert.equal(split.felts, 2, 'one felt per table in the head');
    assert.deepEqual(split.tables.map((tb) => tb.label), ['Tisch 1', 'Tisch 2']);
    assert.equal(split.feature, null);

    const period = spec(dom, 'period', PERIOD);
    assert.equal(period.kicker, 'Donnerstagsrunde');
    assert.equal(period.subline, '14 Sessions');
    assert.deepEqual(period.counters.map((c) => c.n), [9], 'the session count is the head’s, not repeated');
    assert.equal(period.feature.stamp, 'Meistgespielt');
    assert.equal(period.rows.length, 2, 'best rated + the shelf line');
    assert.ok(!/aussortiert/.test(period.rows[1].title), 'a zero shelf figure is dropped, like the classic card');
  } finally { dom.close(); }
});

test('drawing: no pattern, no icon font, and the only image is the same-origin badge', async () => {
  const dom = boot();
  try {
    for (const [kind, model] of [['session', SESSION], ['split', SPLIT], ['period', PERIOD]]) {
      dom.run('__calls.length = 0; __canvases.length = 0');
      dom.context.__model = model;
      await dom.run(`tischCardBlob(${JSON.stringify(kind)}, __model)`);
      assert.deepEqual(calls(dom, 'createPattern'), [], `${kind}: a pattern taints the canvas in WebKit`);
      const fonts = calls(dom, 'font').map((a) => a[0]);
      assert.ok(fonts.length > 5, `${kind}: text was drawn`);
      assert.ok(fonts.every((f) => !/tabler/i.test(f)), `${kind}: the icon font must never reach the canvas`);
      const images = calls(dom, 'drawImage').map((a) => a[0]);
      assert.deepEqual([...new Set(images.map((i) => i.img))], ['/icons/powered-by-bgg.png'],
        `${kind}: nothing but the BGG badge is drawn as an image`);
      if (kind !== 'split') assert.ok(calls(dom, 'fill').some((a) => a[0] && a[0].path), `${kind}: glyphs are Path2D fills`);
      const size = JSON.parse(dom.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))'));
      assert.deepEqual(size, [[1080, 1350]], `${kind}: one 1080x1350 canvas, as T11.1 specifies`);
    }
  } finally { dom.close(); }
});

test('the Chronik’s share draws Der Tisch’s card only while Der Tisch is worn', async () => {
  const tisch = boot({ design: 'tisch' });
  try {
    tisch.context.__model = PERIOD;
    await tisch.run('recapCardBlob(__model)');
    assert.deepEqual(JSON.parse(tisch.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))')), [[1080, 1350]]);
  } finally { tisch.close(); }

  const klassisch = boot({ design: 'klassisch' });
  try {
    assert.equal(klassisch.call('designCard'), null);
    klassisch.context.__model = PERIOD;
    await klassisch.run('recapCardBlob(__model)');
    const sizes = JSON.parse(klassisch.run('JSON.stringify(__canvases.filter((c) => c.width === 1080).map((c) => c.height))'));
    assert.equal(sizes.length, 1, 'the classic card drew');
    assert.notEqual(sizes[0], 1350, 'Klassisch keeps its own content-sized card');
  } finally { klassisch.close(); }
});

test('the results screen’s share: the card with the text, and the text share as the fallback', async () => {
  const dom = boot();
  try {
    dom.run(`
      globalThis.__shared = []; globalThis.__reports = [];
      navigator.canShare = () => true;
      navigator.share = async (data) => { __shared.push({ files: (data.files || []).length, text: data.text }); };
    `);
    dom.set('reportClientError', (kind) => { dom.context.__reports.push(kind); });
    dom.context.__model = SESSION;
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), true);
    assert.deepEqual(JSON.parse(dom.run('JSON.stringify(__shared)')), [{ files: 1, text: 'msg' }]);

    // Dismissing the sheet is DONE, not a failure — no second, text-only sheet.
    dom.run('navigator.share = async () => { const e = new Error("x"); e.name = "AbortError"; throw e; }');
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), true);

    // A browser that refuses the call falls back to the text share.
    dom.run('navigator.share = async () => { throw new Error("NotAllowed"); }');
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), false);

    // A card that fails to render is REPORTED, and the text share still runs.
    dom.run('HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); }');
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), false);
    assert.deepEqual([...dom.context.__reports], ['recap_export']);

    // No file sharing at all (desktop Chrome): straight to the text share.
    dom.run('navigator.canShare = undefined');
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), false);
  } finally { dom.close(); }
});
