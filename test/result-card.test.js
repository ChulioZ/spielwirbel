'use strict';

/*
 * The session result as an image (#1628): Klassisch's card
 * (public/js/result-card.js), the „Gehört …" bringers line every design's
 * card draws, and the results screen handing both to shareResultCard.
 *
 * Like the other card specs, nothing here can see a TAINTED canvas — jsdom has
 * no 2d context and Node has no WebKit. What it pins is the mechanism (no
 * pattern, no icon font, one same-origin image), the content (the screen's
 * ranking, ties and all), and the dispatch. The export itself was run in
 * headless Chromium and a WKWebView; the PR records it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

// A recording 2d context on every canvas, with the drawing surface every
// design's card uses, plus Path2D and the badge Image jsdom lacks.
function boot({ design = 'klassisch' } = {}) {
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
      for (const m of ['fillRect', 'strokeRect', 'fill', 'beginPath', 'roundRect', 'rect', 'ellipse', 'arc',
        'arcTo', 'stroke', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'closePath', 'clip',
        'save', 'restore', 'translate', 'rotate', 'scale', 'setLineDash', 'fillText', 'drawImage']) {
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

// Serialized once, filtered here — no test value is spliced into page code.
const allCalls = (dom) => JSON.parse(dom.run('JSON.stringify(__calls.map((c) => [c.m, c.a.map((x) => (x && x.d) ? { path: x.d.slice(0, 12) } : (x && x._src) ? { img: x._src } : (typeof x === \'object\' ? \'[obj]\' : x))]))'));
const calls = (dom, m) => allCalls(dom).filter(([name]) => name === m).map(([, args]) => args);
// Joined with no separator: Die Brücke draws tracked capitals letter by letter.
const drawnText = (dom) => calls(dom, 'fillText').map((a) => String(a[0])).join('');
// The card canvases only — recapColor() probes a colour on a throwaway one.
const sizes = (dom) => JSON.parse(dom.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))'))
  .filter(([w]) => w === 1080 || w === 1200);

// The model shareResult builds (views-session.js). A tie for second, a game
// nobody rated, and a box only Lea can bring.
const SESSION = {
  roundName: 'Donnerstagsrunde', when: '20.09.2026, 20:00', day: '20.09.2026', cancelled: false,
  playedTitle: 'Nordlichter', winnerNames: ['Jonas'], ending: null,
  bringers: ['Lea'],
  people: [
    { name: 'Jonas', initials: 'JO', color: '#c6522c', winner: true },
    { name: 'Lea', initials: 'LE', color: '#198663', winner: false },
  ],
  rows: [
    { title: 'Nordlichter', score: 4.8, count: 5, place: 1 },
    { title: 'Kartographen', score: 4.1, count: 5, place: 2 },
    { title: 'Azul', score: 4.1, count: 5, place: 2 },
    { title: 'Zugvögel', score: 0.5, count: 5, place: 4 },
    { title: 'Unbewertet', score: 0, count: 0, place: null },
  ],
};

// The same evening before a game was picked (#1726): the ranking stage, every
// rated row carrying its distribution as counts per vote-card value.
const dist = (...c) => c.map((count, i) => ({ n: i + 1, count, word: `w${i + 1}` }));
const RANKING = {
  ...SESSION, playedTitle: null, winnerNames: [], bringers: [],
  people: SESSION.people.map((p) => ({ ...p, winner: false })),
  rows: SESSION.rows.map((r, i) => ({ ...r, dist: r.count ? dist(i, 0, 1, 2, 2 - i) : dist(0, 0, 0, 0, 0) })),
};
// The finished evening with its points (#1630, #1726): a team, the automa.
const POINTS = [
  { name: 'Jonas', members: ['Jonas'], text: '42', winner: true, automa: false },
  { name: 'Lea und Mia', members: ['Lea', 'Mia'], text: '37', winner: false, automa: false },
  { name: 'Automa', text: '30', winner: false, automa: true },
];

const spec = (dom, model) => JSON.parse(dom.run(`JSON.stringify(resultCardSpec(${JSON.stringify(model)}))`));

test('Klassisch spec: the screen’s sentence, the played game with who brings it, the ranking with its tie', () => {
  const dom = boot();
  try {
    const s = spec(dom, SESSION);
    assert.equal(s.kicker, 'Donnerstagsrunde · 20.09.2026', 'the date, not the time of day');
    assert.equal(s.sentence, '„Nordlichter“ wurde gespielt. Jonas hat gewonnen!');
    assert.ok(!s.sentence.includes('\u{1F3C6}'), 'the trophy emoji must not reach the canvas');
    assert.equal(s.played.title, 'Nordlichter');
    assert.equal(s.played.score, '4,8', 'the score in the reader’s notation, as the screen prints it');
    assert.equal(s.played.sub, 'Spielwirbel-Score · 5 Wertungen');
    assert.equal(s.played.bringers, 'Gehört Lea');
    assert.deepEqual(s.rows, [], 'once a game is played the ranking is dropped (#1726)');

    const r = spec(dom, RANKING);
    assert.equal(r.played, null);
    assert.deepEqual(r.rows.map((x) => [x.place, x.title]),
      [['1', 'Nordlichter'], ['2', 'Kartographen'], ['2', 'Azul'], ['4', 'Zugvögel']],
      'one shared place, an extra row — and an unrated game never');
    assert.deepEqual(r.rows[1].dist.map((d) => d.count), [1, 0, 1, 2, 1], 'each row carries its distribution');

    const many = spec(dom, { ...RANKING, rows: Array.from({ length: 12 }, (_, i) => ({ title: `G${i}`, score: 3, count: 2, place: i + 1 })) });
    assert.equal(many.rows.length, 8, 'a picture for a chat stops at eight rows');

    const cancelled = spec(dom, { ...SESSION, cancelled: true });
    assert.equal(cancelled.played, null, 'a cancelled evening names no played game');
    assert.equal(cancelled.sentence, 'Session abgebrochen – es wurde nichts gespielt.');
    assert.equal(cancelled.rows.length, 4, 'its ratings still stand');
  } finally { dom.close(); }
});

test('Klassisch drawing: no pattern, no icon font, the badge alone as an image, every line inside the card', async () => {
  const dom = boot();
  try {
    const W = dom.run('RESULT_CARD_W');
    const long = {
      ...SESSION,
      roundName: 'Donnerstagsspielerunde der Freundinnen und Freunde aus der Nachbarschaft',
      playedTitle: 'Die Siedler von Catan – Städte und Ritter Jubiläumsausgabe mit allen Erweiterungen',
      winnerNames: ['Konstantin', 'Maximiliane', 'Jonas-Friedrich'],
      bringers: ['Konstantin', 'Maximiliane', 'Jonas-Friedrich', 'Bartholomäus'],
    };
    long.rows = [{ ...SESSION.rows[0], title: long.playedTitle }, ...SESSION.rows.slice(1)];
    for (const model of [SESSION, long]) {
      dom.run('__calls.length = 0; __canvases.length = 0');
      dom.context.__model = model;
      await dom.run('resultCardBlob(__model)');
      assert.deepEqual(calls(dom, 'createPattern'), [], 'a pattern taints the canvas in WebKit');
      assert.ok(calls(dom, 'font').every((a) => !/tabler/i.test(a[0])), 'the icon font must never reach the canvas');
      assert.deepEqual([...new Set(calls(dom, 'drawImage').map((a) => a[0].img))], ['/icons/powered-by-bgg.png']);
      // The recording context measures 7px a character, so a line that is not
      // fitted runs past the card's edge here exactly as it would on screen.
      for (const [text, x] of calls(dom, 'fillText')) {
        assert.ok(x + String(text).length * 7 <= W - 16, `„${text}" overflows the card (${x} + ${String(text).length * 7})`);
      }
      const text = drawnText(dom);
      assert.match(text, /Gehört /, 'the bringers line was drawn');
      assert.doesNotMatch(text, /Kartographen|Azul/, 'no ranking once a game was played');
      assert.equal(sizes(dom).length, 1, 'one card, at a 2x backing store');
    }

    dom.run('__calls.length = 0');
    dom.context.__model = RANKING;
    await dom.run('resultCardBlob(__model)');
    assert.match(drawnText(dom), /Kartographen/);
    assert.match(drawnText(dom), /Azul/);

    // The height follows the content: a ranking of one is a shorter card.
    dom.run('__canvases.length = 0');
    dom.context.__model = RANKING;
    await dom.run('resultCardBlob(__model)');
    dom.context.__model = { ...RANKING, rows: RANKING.rows.slice(0, 1) };
    await dom.run('resultCardBlob(__model)');
    const [[, tall], [, short]] = sizes(dom);
    assert.ok(short < tall, `fewer rows, a shorter card (${short} vs ${tall})`);
  } finally { dom.close(); }
});

test('the results screen’s share under Klassisch: the card with the text, a split as a card too, a failure reported', async () => {
  const dom = boot();
  try {
    assert.equal(dom.call('designCard'), null, 'Klassisch has no card of its own');
    dom.run(`
      globalThis.__shared = []; globalThis.__reports = [];
      navigator.canShare = () => true;
      navigator.share = async (data) => { __shared.push({ files: (data.files || []).length, text: data.text }); };
    `);
    dom.set('reportClientError', (kind) => { dom.context.__reports.push(kind); });
    dom.context.__model = SESSION;
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), true);
    assert.deepEqual(JSON.parse(dom.run('JSON.stringify(__shared)')), [{ files: 1, text: 'msg' }]);
    assert.equal(sizes(dom).length, 1, 'Klassisch’s card was drawn');

    // A split evening is a card too since #1726: its tables and their results.
    dom.run('__canvases.length = 0; __calls.length = 0');
    dom.context.__model = { roundName: 'R', outcome: 'split', tables: [{ title: 'Azul', names: 'A, B', winnerNames: ['A'] }] };
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), true, 'a split parent shares its card');
    assert.equal(sizes(dom).length, 1);
    assert.match(drawnText(dom), /Azul/);
    assert.match(drawnText(dom), /A hat gewonnen/, 'with that table\'s result');

    dom.run('HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); }');
    dom.context.__model = SESSION;
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), false, 'a failed card falls back to the text');
    assert.deepEqual([...dom.context.__reports], ['recap_export'], 'and the failure reaches the operator');
  } finally { dom.close(); }
});

test('„Teilen" under Klassisch goes through the card, not straight to the text share', async () => {
  // shareResult used to ask for a card only when the design had one, so
  // Klassisch never reached shareResultCard at all.
  const dom = boot();
  try {
    dom.run(`
      globalThis.__shared = [];
      navigator.canShare = () => true;
      navigator.share = async (data) => { __shared.push((data.files || []).length); };
    `);
    dom.context.__model = SESSION;
    await dom.run('shareResult(__model)');
    assert.deepEqual(JSON.parse(dom.run('JSON.stringify(__shared)')), [1], 'one share, carrying the card');
  } finally { dom.close(); }
});

// The four designs whose cards predate #1628 carry the line too. Each is
// checked on its own drawing: the spec field alone would pass with the
// drawing never reading it.
const DESIGN_CARDS = [
  ['tisch', 'tischCardBlob(__model.outcome === "split" ? "split" : "session", __model)'],
  ['ocean', 'oceanCardBlob("session", __model)'],
  ['ocean', 'oceanCardBlob("landscape", __model)'],
  ['programmheft', 'programmheftCardBlob("session", __model)'],
  ['forest', 'forestCardBlob("session", __model)'],
  ['bruecke', 'brueckeCardBlob(__model, "session")'],
];

test('every design’s session card draws who brings the box — and none draws it when nobody needs telling', async () => {
  for (const [design, call] of DESIGN_CARDS) {
    const dom = boot({ design });
    try {
      dom.context.__model = SESSION;
      await dom.run(call);
      assert.match(drawnText(dom), /Gehört Lea|GEHÖRT LEA/, `${design} (${call}): the bringers line`);

      dom.run('__calls.length = 0');
      dom.context.__model = { ...SESSION, bringers: [] };
      await dom.run(call);
      assert.doesNotMatch(drawnText(dom), /Gehört|GEHÖRT/, `${design}: no empty „Gehört" line`);
    } finally { dom.close(); }
  }
});

// ---- the share follows the stage (#1726), in every design ------------------

const ALL_CARDS = [['klassisch', 'resultCardBlob(__model)'], ...DESIGN_CARDS];

// The distribution strip is the only roundRect drawn in a design's ramp right
// after a row's title, so it is read as the fills that follow the title's text.
async function drawn(design, call, model) {
  const dom = boot({ design });
  try {
    dom.context.__model = model;
    await dom.run(call);
    return { text: drawnText(dom), all: allCalls(dom) };
  } finally { dom.close(); }
}

test('every design: before a pick, the ranking with each game’s distribution strip', async () => {
  for (const [design, call] of ALL_CARDS) {
    const { text, all } = await drawn(design, call, RANKING);
    assert.match(text, /Kartographen/, `${design} (${call}): the ranking`);
    // Kartographen's distribution has four live values: four strip segments
    // follow its title before the next row's text.
    const at = all.findIndex(([m, a]) => m === 'fillText' && /Kartographen/.test(String(a[0])));
    const next = all.findIndex(([m], i) => i > at && (m === 'fillText' || m === 'fillRect'));
    const segs = all.slice(at, next).filter(([m]) => m === 'roundRect').length;
    assert.equal(segs, 4, `${design} (${call}): one segment per vote value anyone gave`);
  }
});

test('every design: once a game is played, no ranking — only the game and its points', async () => {
  for (const [design, call] of ALL_CARDS) {
    const { text } = await drawn(design, call, { ...SESSION, finished: true, points: POINTS });
    assert.match(text, /Nordlichter/i, `${design} (${call}): the played game`);
    assert.doesNotMatch(text, /Kartographen|Azul|Zugvögel/, `${design} (${call}): the ranking is dropped`);
    for (const want of ['Jonas', 'Lea und Mia', '37', 'Automa', '30']) {
      assert.ok(text.includes(want), `${design} (${call}): the points name ${want}`);
    }
    // Without points there is no empty points block.
    const bare = await drawn(design, call, { ...SESSION, finished: true, points: [] });
    assert.doesNotMatch(bare.text, /Punkte/, `${design}: no empty points heading`);
  }
});

test('every design: a game chosen but not played yet is named alone, without „wurde gespielt"', async () => {
  for (const [design, call] of ALL_CARDS) {
    const { text } = await drawn(design, call, { ...SESSION, finished: false, winnerNames: [], bringers: [] });
    assert.match(text, /Nordlichter/i, `${design} (${call})`);
    assert.doesNotMatch(text, /wurde gespielt|Kartographen/i, `${design} (${call})`);
  }
});

test('every design: a split evening shows each table’s game and that table’s result', async () => {
  const model = {
    roundName: 'Donnerstagsrunde', when: 'heute', day: '20.09.2026', outcome: 'split',
    tables: [
      { title: 'Azul', names: 'Anna, Ben', winnerNames: ['Anna'], points: [{ name: 'Anna', text: '61' }] },
      { title: 'Catan', names: 'Clara, Dana', winnerNames: [], ending: 'noWinner', points: [] },
    ],
  };
  for (const [design, call] of ALL_CARDS) {
    const { text } = await drawn(design, call, model);
    for (const want of ['Azul', 'Catan', 'Anna hat gewonnen', '61', 'Gespielt – ohne Sieger']) {
      assert.ok(text.includes(want) || text.includes(want.toLocaleUpperCase()), `${design} (${call}): ${want}`);
    }
  }
});

test('drawSharePoints keeps the automa in the soft ink and crowns only a winner', () => {
  const dom = boot();
  try {
    dom.context.__pts = POINTS;
    dom.run(`(() => {
      const ctx = document.createElement('canvas').getContext('2d');
      __calls.length = 0;
      drawSharePoints(ctx, __pts, { x: 0, y: 0, w: 400, rowH: 30, size: 15, font: (w, s) => w + ' ' + s + 'px x', ink: 'INK', soft: 'SOFT', accent: 'ACC' });
    })()`);
    const all = allCalls(dom);
    const inkOf = (name) => {
      const i = all.findIndex(([m, a]) => m === 'fillText' && a[0] === name);
      return all.slice(0, i).filter(([m]) => m === 'fillStyle').pop()[1][0];
    };
    assert.equal(inkOf('Jonas'), 'ACC');
    assert.equal(inkOf('Lea und Mia'), 'INK');
    assert.equal(inkOf('Automa'), 'SOFT');
    assert.equal(calls(dom, 'fill').length, 1, 'one crown, for the one winner');
  } finally { dom.close(); }
});

// The results screen computes the bringers with the same rule its own
// „Gehört …" line uses (boxBringers), so the card cannot name anyone else.
const RESULT_ROUND = {
  id: 'r1', name: 'Donnerstagsrunde', marker: 0,
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: [{ id: 'g1', title: 'Catan', tagIds: [], ownerIds: ['m2'] }, { id: 'g2', title: 'Azul', tagIds: [] }],
  sessions: [{
    id: 's1', createdAt: '2026-09-20T20:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1', 'm2'],
    votes: { m1: { g1: { rating: 4 }, g2: { rating: 3 } }, m2: { g1: { rating: 5 }, g2: { rating: 3 } } },
    votedIds: ['m1', 'm2'], finished: true, cancelled: false, done: true, winnerIds: ['m1'],
    chosenGameId: 'g1', events: [],
  }],
};

async function sharedModel(round) {
  const dom = boot();
  try {
    dom.set('api', async (method, url) => (/\/activities$/.test(url) ? [] : round));
    dom.set('accountsActive', () => false);
    dom.set('isLoggedIn', () => false);
    dom.run('navigator.share = async () => {}');
    const shared = [];
    dom.set('shareResult', (model) => { shared.push({ ...model }); });
    await dom.call('showResults', round, round.sessions[0], round.games, false);
    const btn = [...dom.app.querySelectorAll('button')].find((b) => b.querySelector('.ti-share'));
    assert.ok(btn, 'the share button is rendered');
    btn.click();
    return shared[0];
  } finally { dom.close(); }
}

test('the results screen hands the cards the played game’s bringers', async () => {
  const names = async (round) => JSON.parse(JSON.stringify((await sharedModel(round)).bringers));
  assert.deepEqual(await names(RESULT_ROUND), ['Ben']);
  const everyone = structuredClone(RESULT_ROUND);
  everyone.games[0].ownerIds = ['m1', 'm2'];
  assert.deepEqual(await names(everyone), [], 'everyone owns it: nobody needs telling');
  const cancelled = structuredClone(RESULT_ROUND);
  Object.assign(cancelled.sessions[0], { cancelled: true, finished: false });
  assert.deepEqual(await names(cancelled), [], 'a cancelled evening brings nothing');
});

test('the results screen hands the share its stage, each row’s distribution and the points (#1726)', async () => {
  const scored = structuredClone(RESULT_ROUND);
  Object.assign(scored.sessions[0], { scores: { m1: 12, m2: 9 }, automa: { name: 'Automa', points: 7 } });
  const model = JSON.parse(JSON.stringify(await sharedModel(scored)));
  assert.equal(model.finished, true);
  // The tally the Tafel draws: Catan got a 4 and a 5, Azul two 3s.
  const counts = (title) => model.rows.find((r) => r.title === title).dist.map((d) => [d.n, d.count]);
  assert.deepEqual(counts('Catan'), [[1, 0], [2, 0], [3, 0], [4, 1], [5, 1]]);
  assert.deepEqual(counts('Azul'), [[1, 0], [2, 0], [3, 2], [4, 0], [5, 0]]);
  assert.ok(model.rows[0].dist.every((d) => typeof d.word === 'string' && d.word), 'each value carries its word');
  assert.deepEqual(model.points.map((p) => [p.name, p.text, p.winner, p.automa]),
    [['Anna', '12', true, false], ['Ben', '9', false, false], ['Automa', '7', false, true]]);
  // Nothing in the model says who gave which rating.
  assert.ok(!/"rating"|"votes"/.test(JSON.stringify(model)));

  // Before a pick: no points, and the session is not finished.
  const open = structuredClone(RESULT_ROUND);
  Object.assign(open.sessions[0], { finished: false, done: false, chosenGameId: null, winnerIds: [] });
  const early = await sharedModel(open);
  assert.equal(early.finished, false);
  assert.deepEqual(JSON.parse(JSON.stringify(early.points)), []);
});

test('a split evening’s share carries each table’s result, from the tables’ own sessions (#1726)', async () => {
  const parent = {
    id: 'p1', createdAt: '2026-09-20T18:00:00.000Z', memberIds: ['m1', 'm2', 'm3'], gameIds: ['g1', 'g2'],
    votes: {}, multiTable: true, done: true, finished: false, cancelled: false, chosenGameId: null,
    winnerIds: [], childSessionIds: ['c1', 'c2'], events: [],
  };
  const child = (id, gid, ids, extra) => ({
    id, createdAt: '2026-09-20T18:01:00.000Z', memberIds: ids, gameIds: [gid], votes: {}, done: true,
    finished: true, cancelled: false, chosenGameId: gid, parentSessionId: 'p1', events: [], ...extra,
  });
  const round = {
    ...RESULT_ROUND,
    members: [...RESULT_ROUND.members, { id: 'm3', name: 'Clara' }],
    sessions: [parent,
      child('c1', 'g1', ['m1', 'm2'], { winnerIds: ['m1'], scores: { m1: 12, m2: 9 } }),
      child('c2', 'g2', ['m3'], { winnerIds: [], ending: 'lost' })],
  };
  for (const design of ['klassisch', 'tisch']) {
    const dom = boot({ design });
    try {
      dom.set('api', async (method, url) => (/\/activities$/.test(url) ? [] : round));
      dom.set('accountsActive', () => false);
      dom.set('isLoggedIn', () => false);
      dom.set('roundCan', () => false);
      dom.run('navigator.share = async () => {}');
      const shared = [];
      dom.set('shareResult', (model) => { shared.push(JSON.parse(JSON.stringify(model))); });
      await dom.call('showTableBuilder', round, parent);
      const btn = [...dom.app.querySelectorAll('button')].find((b) => b.querySelector('.ti-share'));
      assert.ok(btn, `${design}: the share button is rendered`);
      btn.click();
      const [t1, t2] = shared[0].tables;
      assert.deepEqual([t1.title, t1.winnerNames, t1.points.map((p) => [p.name, p.text, p.winner])],
        ['Catan', ['Anna'], [['Anna', '12', true], ['Ben', '9', false]]], design);
      assert.deepEqual([t2.title, t2.winnerNames, t2.ending, t2.points], ['Azul', [], 'lost', []], design);
    } finally { dom.close(); }
  }
});
