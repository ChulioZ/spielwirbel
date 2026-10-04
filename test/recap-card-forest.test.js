'use strict';

/*
 * Forest's share card (#1475, F8.4, public/js/recap-card-forest.js).
 *
 * As with the other designs' cards: jsdom has no 2d context and Node has no
 * WebKit, so nothing here can observe a TAINTED canvas. What it pins is the
 * mechanism that keeps the card clean in both engines (no pattern, no SVG, no
 * icon font, one same-origin image), the exported size, the type floors (12px
 * drawn = 24px exported; Young Serif never under 19px), that no text lands on
 * the image, that every string is drawn in an ink measured against what it
 * stands on, that fireflies appear only on the dusk and one per session, the
 * copy of the design's tokens the card paints with, and the facts it states.
 * The export itself was run in headless Chromium (the PR records it).
 */

process.env.TZ = 'Europe/Berlin';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');
const { token, hex, contrast } = require('./support/theme');
const { designById } = require('../public/js/designs');

const FOREST = designById('forest');
const FIREFLY = '#fff3a8';

// A recording 2d context on every canvas — recap-card-programmheft.test.js's
// shape, plus the ellipse/rect/shadow surface this card uses.
function boot({ design = 'forest', locale = 'de' } = {}) {
  const dom = loadApp({ locale });
  dom.run(`
    globalThis.__calls = [];
    globalThis.__canvases = [];
    const rec = (canvas, m) => (...a) => { __calls.push({ m, a, canvas }); };
    HTMLCanvasElement.prototype.getContext = function () {
      const canvas = this;
      if (!__canvases.includes(canvas)) __canvases.push(canvas);
      const grad = () => ({ addColorStop: () => {} });
      const ctx = {
        canvas, globalAlpha: 1, textAlign: 'left', textBaseline: 'alphabetic', lineWidth: 1,
        shadowColor: 'transparent', shadowBlur: 0, shadowOffsetY: 0,
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
      for (const m of ['fillRect', 'strokeRect', 'fill', 'beginPath', 'roundRect', 'rect', 'ellipse', 'arc', 'stroke', 'moveTo',
        'lineTo', 'closePath', 'clip', 'save', 'restore', 'translate', 'rotate', 'scale', 'fillText', 'drawImage']) {
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

const allCalls = (dom) => JSON.parse(dom.run('JSON.stringify(__calls.map((c) => [c.m, c.a.map((x) => (x && x._src) ? { img: x._src } : (typeof x === \'object\' ? \'[obj]\' : x))]))'));
const calls = (dom, m) => allCalls(dom).filter(([name]) => name === m).map(([, args]) => args);

// Every fillText with the fillStyle and font in force when it ran, and whether
// a translate was in force (save/restore depth tracked from the translate on).
function texts(dom) {
  let fill = null;
  let font = null;
  let depth = 0;
  let movedAt = null;
  const out = [];
  for (const [m, a] of allCalls(dom)) {
    if (m === 'fillStyle') fill = a[0];
    if (m === 'font') font = a[0];
    if (m === 'save') depth += 1;
    if (m === 'restore') { if (movedAt === depth) movedAt = null; depth -= 1; }
    if (m === 'translate' && movedAt === null) movedAt = depth;
    if (m === 'fillText') out.push({ text: String(a[0]), x: a[1], y: a[2], fill, font, moved: movedAt !== null });
  }
  return out;
}

const SESSION = {
  roundName: 'Donnerstagsrunde', when: '14.09.2026, 21:47', day: '14.09.2026',
  dayLong: '14. September 2026', factLine: 'Session Nr. 23 · 9. Sieg für Jonas · Nordlichter zum 4. Mal',
  cancelled: false, playedTitle: 'Nordlichter', winnerNames: ['Jonas'], ending: 'won',
  people: [{ name: 'Jonas', initials: 'JO', color: '#c6522c', winner: true }, { name: 'Lea', initials: 'LE', color: '#198663', winner: false }],
  rows: [
    { title: 'Nordlichter', score: 4.8, count: 5, place: 1 },
    { title: 'Kartographen des Nordens', score: 3.8, count: 5, place: 2 },
    { title: 'Rost & Regen', score: 1.6, count: 4, place: 3 },
    { title: 'Codenames', score: 2.1, count: 4, place: 4 },
  ],
};
const PERIOD = {
  heading: 'Donnerstagsrunde', periodLabel: 'Sommer 2026', sessions: 8, gamesPlayed: 6,
  played: ['Nordlichter'], playedSub: '5 Sessions', rated: ['Kartographen'], ratedScore: '4,6',
  shelf: [{ n: 6, label: 'hinzugefügt', plus: true }, { n: 0, label: 'aussortiert' }, { n: 2, label: 'durchgespielt' }],
};

const spec = (dom, kind, model) => JSON.parse(dom.run(`JSON.stringify(forestCardSpec(${JSON.stringify(kind)}, ${JSON.stringify(model)}))`));
const sceneH = (dom) => JSON.parse(dom.run('JSON.stringify(FOREST_CARD_SCENE_H)'));

test('the card’s colours are Forest’s own tokens, value for value', () => {
  // The licence for the copy (.claude/rules/shared-constants-across-the-stack.md):
  // retuning a token in forest.css goes red here naming both values.
  const dom = loadApp();
  try {
    const tokens = JSON.parse(dom.run('JSON.stringify(FOREST_CARD_TOKENS)'));
    const names = Object.keys(tokens);
    assert.ok(names.length >= 25, 'the copy was actually read');
    for (const name of names) {
      assert.deepEqual(hex(tokens[name]), token(name, FOREST),
        `${name}: the card paints ${tokens[name]}, the design declares another value`);
    }
  } finally { dom.close(); }
});

test('every ink clears 4.5:1 on what it is written on', () => {
  const dom = loadApp();
  try {
    const tokens = JSON.parse(dom.run('JSON.stringify(FOREST_CARD_TOKENS)'));
    const pairs = JSON.parse(dom.run('JSON.stringify(FOREST_CARD_TEXT)'));
    assert.ok(pairs.length >= 10, 'the pairs were actually read');
    for (const { ink, on } of pairs) {
      assert.ok(tokens[ink] && tokens[on], `${ink} on ${on}: both are in the token copy`);
      const ratio = contrast(hex(tokens[ink]), hex(tokens[on]));
      assert.ok(ratio >= 4.5, `${ink} on ${on} is ${ratio.toFixed(2)}:1`);
    }
    // Every pill the card can draw is a measured pair — the ramp's ink flips
    // at stop 3, exactly as forest.css's .score-pill does.
    for (const stop of ['veto', '1', '2', '3', '4', '5']) {
      const pill = JSON.parse(dom.run(`JSON.stringify(forestPill(${JSON.stringify(stop)}))`));
      assert.ok(pairs.some((p) => p.ink === pill.ink && p.on === pill.fill), `stop ${stop}: ${pill.ink} on ${pill.fill} is measured`);
    }
  } finally { dom.close(); }
});

test('result spec: round · long date, the played sentence, the winner apart with the score, three rows, the fact line', () => {
  const dom = boot();
  try {
    const s = spec(dom, 'session', SESSION);
    assert.equal(s.kicker, 'Donnerstagsrunde · 14. September 2026');
    assert.deepEqual(s.headline.map((r) => r.text), ['„Nordlichter“ wurde gespielt.']);
    assert.deepEqual(s.winner, { text: 'Jonas hat gewonnen', score: '4,8', stop: '5' });
    assert.equal(s.cover, true);
    assert.deepEqual(s.rows.map((r) => [r.place, r.title, r.score, r.stop]),
      [['1', 'Nordlichter', '4,8', '5'], ['2', 'Kartographen des Nordens', '3,8', '4'], ['3', 'Rost & Regen', '1,6', '2']]);
    assert.equal(s.factLine, SESSION.factLine, 'the screen’s own fact line, never a re-derivation');
    assert.ok(!JSON.stringify(s).includes('21:47'), 'no time of day');
  } finally { dom.close(); }
});

test('result spec: a tie, a loss, a cancelled night and another design’s model', () => {
  const dom = boot();
  try {
    const tie = spec(dom, 'session', { ...SESSION, winnerNames: ['Jonas', 'Lea'] });
    assert.equal(tie.winner.text, 'Jonas und Lea haben gewonnen');

    const lost = spec(dom, 'session', { ...SESSION, winnerNames: [], ending: 'lost' });
    assert.equal(lost.winner, null, 'no winner line without a winner');
    assert.ok(lost.headline[0].text.includes('und hat gewonnen'), 'the results screen’s own sentence for a loss');
    assert.ok(!lost.headline[0].text.includes('🏆'));

    const off = spec(dom, 'session', { ...SESSION, cancelled: true });
    assert.equal(off.cover, false);
    assert.equal(off.winner, null);

    const bare = spec(dom, 'session', { ...SESSION, dayLong: undefined, factLine: undefined });
    assert.equal(bare.kicker, 'Donnerstagsrunde · 14.09.2026', 'the short date when no long one was added');
    assert.equal(bare.factLine, '', 'and no fact line is invented');
  } finally { dom.close(); }
});

test('result spec: a split session names its tables, with no winner and no scores', () => {
  const dom = boot();
  try {
    const s = spec(dom, 'session', { roundName: 'R', day: 'd', outcome: 'split',
      tables: [{ title: 'Nordlichter', names: 'Jonas, Lea' }, { title: 'Azul', names: 'Ida' }] });
    assert.equal(s.cover, false);
    assert.equal(s.winner, null);
    assert.deepEqual(s.rows.map((r) => r.title), ['Nordlichter', 'Azul']);
    assert.ok(!JSON.stringify(s).includes('Jonas'), 'a split names its tables, not their people');
  } finally { dom.close(); }
});

test('period spec: one firefly per session (capped), the counts as tiles, a zero shelf figure dropped', () => {
  const dom = boot();
  try {
    const s = spec(dom, 'period', PERIOD);
    assert.equal(s.kicker, 'Donnerstagsrunde · Rückblick');
    assert.equal(s.title, 'Sommer 2026');
    assert.equal(s.flies, 8);
    assert.deepEqual(s.facts.map((f) => f.v), ['8', '6', '+6', '2']);
    assert.deepEqual(s.lines.map((l) => [l.title, l.sub]), [['Nordlichter', '5 Sessions'], ['Kartographen', '4,6']]);
    const max = JSON.parse(dom.run('FOREST_CARD_FLIES_MAX'));
    const year = spec(dom, 'period', { ...PERIOD, sessions: 140 });
    assert.equal(year.flies, max, 'a long year does not turn the dusk into snow');
    assert.equal(year.facts[0].v, '140', 'the exact count stands in the facts');
  } finally { dom.close(); }
});

test('drawing: 1080×1350, no pattern, no icon font, one image, floors, measured inks, no text on the image', async () => {
  const dom = boot();
  try {
    const pairs = JSON.parse(dom.run('JSON.stringify(FOREST_CARD_TEXT)'));
    const tokens = JSON.parse(dom.run('JSON.stringify(FOREST_CARD_TOKENS)'));
    const inks = new Set(pairs.map((p) => tokens[p.ink]));
    const heights = sceneH(dom);
    for (const [kind, model] of [['session', SESSION], ['period', PERIOD],
      ['session', { ...SESSION, winnerNames: ['Jonas', 'Lea', 'Ida'] }],
      ['session', { roundName: 'R', day: 'd', outcome: 'split', tables: [{ title: 'Azul' }] }]]) {
      dom.run('__calls.length = 0; __canvases.length = 0');
      dom.context.__model = model;
      await dom.run(`forestCardBlob(${JSON.stringify(kind)}, __model)`);
      assert.deepEqual(calls(dom, 'createPattern'), [], `${kind}: a pattern taints the canvas in WebKit`);
      const fonts = calls(dom, 'font').map((a) => a[0]);
      assert.ok(fonts.every((f) => !/tabler/i.test(f)), `${kind}: the icon font must never reach the canvas`);
      for (const f of fonts) {
        const px = Number(/(\d+)px/.exec(f)[1]);
        assert.ok(px >= 12, `${kind}: ${f} is under 12px (24px exported)`);
        if (/Young Serif/.test(f)) assert.ok(px >= 19, `${kind}: ${f} sets Young Serif under F1's 19px floor`);
      }
      const images = calls(dom, 'drawImage').map((a) => a[0].img);
      assert.deepEqual([...new Set(images)], ['/icons/powered-by-bgg.png'], `${kind}: only the BGG badge is an image`);
      const drawn = texts(dom);
      assert.ok(drawn.length > 5, `${kind}: text was drawn`);
      const floor = heights[kind];
      for (const d of drawn) {
        assert.ok(inks.has(d.fill), `${kind}: „${d.text}" is drawn in ${d.fill}, which FOREST_CARD_TEXT does not measure`);
        assert.ok(!d.moved && d.y > floor, `${kind}: „${d.text}" at y=${d.y} stands on the image (it ends at ${floor})`);
      }
      // The rank digits are Alegreya Sans 800, never Young Serif (review U3).
      // They stand at the left padding; the kicker's tracked date does not.
      const ranks = drawn.filter((x) => x.x === 30 && /^[1-3]$/.test(x.text));
      if (kind === 'session') assert.ok(ranks.length >= 1, `${kind}: the ranks were found`);
      for (const d of ranks) {
        assert.match(d.font, /^800 15px "Alegreya Sans"/, `${kind}: rank ${d.text} is set in ${d.font}`);
      }
      const all = drawn.map((d) => d.text).join('|');
      assert.ok(all.includes('spielwirbel.app') && all.includes('Spielwirbel'), `${kind}: the wordmark foot`);
      assert.ok(!/21:47/.test(all), `${kind}: no time of day`);
      const sizes = JSON.parse(dom.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))'));
      assert.deepEqual(sizes, [[1080, 1350]], `${kind}: one 1080x1350 canvas`);
      const flies = calls(dom, 'fillStyle').filter((a) => a[0] === FIREFLY).length;
      assert.equal(flies, kind === 'period' ? model.sessions : 0, `${kind}: fireflies only on the dusk, one per session`);
    }
  } finally { dom.close(); }
});

test('the Chronik’s share draws this card only while Forest is worn', async () => {
  const forest = boot();
  try {
    forest.context.__model = PERIOD;
    await forest.run('recapCardBlob(__model)');
    assert.ok(texts(forest).some((d) => d.text === 'Sommer 2026' && /Young Serif/.test(d.font)), 'this card’s title was drawn');
    assert.deepEqual(JSON.parse(forest.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))')), [[1080, 1350]]);
  } finally { forest.close(); }

  const classic = boot({ design: 'klassisch' });
  try {
    classic.context.__model = PERIOD;
    await classic.run('recapCardBlob(__model)');
    assert.ok(!texts(classic).some((d) => /Young Serif/.test(d.font || '')), 'Klassisch keeps its own card');
    assert.equal(calls(classic, 'fillStyle').filter((a) => a[0] === FIREFLY).length, 0);
  } finally { classic.close(); }
});

test('the results screen’s share: this card while worn, a failure reported, the text share after', async () => {
  const dom = boot();
  try {
    dom.run(`
      globalThis.__reports = [];
      navigator.canShare = () => true;
      navigator.share = async () => {};
    `);
    dom.set('reportClientError', (kind) => { dom.context.__reports.push(kind); });
    dom.context.__model = SESSION;
    dom.run('__canvases.length = 0');
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), true);
    assert.deepEqual(JSON.parse(dom.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))')), [[1080, 1350]]);
    assert.ok(texts(dom).some((d) => d.text === 'Jonas hat gewonnen' && d.fill === '#85570f'), 'the winner in gold-deep — this card');

    dom.run('HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); }');
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), false, 'the text share still runs');
    assert.deepEqual([...dom.context.__reports], ['recap_export'], 'and the failure reaches the operator');
  } finally { dom.close(); }
});

// The results screen adds the edition only while Forest is worn — Klassisch's
// share model is exactly what it was.
const RESULT_ROUND = {
  id: 'r1', name: 'Donnerstagsrunde', background: null, tags: [], providers: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: [{ id: 'g1', title: 'Catan', tagIds: [] }],
  sessions: [{
    id: 's1', createdAt: '2026-09-20T20:00:00.000Z', gameIds: ['g1'], memberIds: ['m1', 'm2'],
    votes: { m1: { g1: { rating: 4 } }, m2: { g1: { rating: 5 } } }, votedIds: ['m1', 'm2'],
    finished: true, cancelled: false, done: true, winnerIds: ['m1'], chosenGameId: 'g1', events: [],
  }],
};

async function sharedModel(design) {
  const dom = boot({ design });
  try {
    dom.set('api', async (method, url) => (/\/activities$/.test(url) ? [] : RESULT_ROUND));
    dom.set('accountsActive', () => false);
    dom.set('isLoggedIn', () => false);
    dom.run('navigator.share = async () => {}');
    const shared = [];
    dom.set('shareResult', (model) => { shared.push({ ...model }); });
    await dom.call('showResults', RESULT_ROUND, RESULT_ROUND.sessions[0], RESULT_ROUND.games, false);
    const btn = [...dom.app.querySelectorAll('button')].find((b) => b.querySelector('.ti-share'));
    assert.ok(btn, `${design}: the share button is rendered`);
    btn.click();
    assert.equal(shared.length, 1);
    return shared[0];
  } finally { dom.close(); }
}

test('the results screen adds the long date and its fact line under Forest, and nowhere else', async () => {
  const forest = await sharedModel('forest');
  assert.equal(forest.dayLong, '20. September 2026');
  assert.equal(forest.factLine, 'Session Nr. 1 · 1. Sieg für Anna · Catan zum 1. Mal', 'the line the screen shows');

  const classic = await sharedModel('klassisch');
  assert.deepEqual(Object.keys(classic).sort(),
    ['cancelled', 'day', 'ending', 'people', 'playedTitle', 'roundName', 'rows', 'when', 'winnerNames'],
    'Klassisch’s share model is exactly what it was');
});
