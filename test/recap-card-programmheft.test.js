'use strict';

/*
 * Das Programmheft's share card (#1381, P8.4, public/js/recap-card-programmheft.js).
 *
 * As with Der Tisch's and Ocean's cards: jsdom has no 2d context and Node has no
 * WebKit, so nothing here can observe a TAINTED canvas. What it pins is the
 * mechanism that keeps the card clean in both engines (no pattern, no SVG, no
 * icon font, one same-origin image), the exported size, P1's vermilion rule (a
 * display ink only in Anton from 24px), that every string is drawn in an ink
 * measured against paper, the copy of the design's tokens the card paints
 * with, and the facts the card states — the streak among them, which comes
 * from the Pokale's own rule (session-tally.js). The export itself was run in
 * headless Chromium (the PR records it).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');
const { token, hex, contrast } = require('./support/theme');
const { designById } = require('../public/js/designs');

const HEFT = designById('programmheft');

// A recording 2d context on every canvas — recap-card-ocean.test.js's shape.
function boot({ design = 'programmheft', locale = 'de' } = {}) {
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
      for (const m of ['fillRect', 'strokeRect', 'fill', 'beginPath', 'roundRect', 'bezierCurveTo', 'arc', 'stroke', 'moveTo', 'lineTo',
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

const allCalls = (dom) => JSON.parse(dom.run('JSON.stringify(__calls.map((c) => [c.m, c.a.map((x) => (x && x._src) ? { img: x._src } : (typeof x === \'object\' ? \'[obj]\' : x))]))'));
const calls = (dom, m) => allCalls(dom).filter(([name]) => name === m).map(([, args]) => args);

// Every fillText with the fillStyle and font in force when it ran.
function texts(dom) {
  let fill = null;
  let font = null;
  const out = [];
  for (const [m, a] of allCalls(dom)) {
    if (m === 'fillStyle') fill = a[0];
    if (m === 'font') font = a[0];
    if (m === 'fillText') out.push({ text: String(a[0]), fill, font });
  }
  return out;
}

const SESSION = {
  roundName: 'Donnerstagsrunde', when: '20.09.2026, 21:47', day: '20.09.2026',
  dayLong: '20. September 2026', sessionNo: 23, streak: 2,
  cancelled: false, playedTitle: 'Nordlichter', winnerNames: ['Jonas'], ending: 'won',
  people: [
    { name: 'Jonas', initials: 'JO', color: '#c6522c', winner: true },
    { name: 'Lea', initials: 'LE', color: '#198663', winner: false },
    { name: 'Ida', initials: 'ID', color: '#1f4e8c', winner: false },
    { name: 'Mia (Gast)', initials: 'MI', color: null, winner: false },
  ],
  rows: [
    { title: 'Nordlichter', score: 4.8, count: 5, place: 1 },
    { title: 'Kartographen', score: 4.1, count: 5, place: 2 },
    { title: 'Azul', score: 3.2, count: 4, place: 3 },
    { title: 'Codenames', score: 2.1, count: 4, place: 4 },
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

const spec = (dom, kind, model) => JSON.parse(dom.run(`JSON.stringify(programmheftCardSpec(${JSON.stringify(kind)}, ${JSON.stringify(model)}))`));
const facts = (s) => s.facts.map((f) => `${f.k}=${f.v}`);

test('the card’s colours are Das Programmheft’s own tokens, value for value', () => {
  // The licence for the copy (.claude/rules/shared-constants-across-the-stack.md):
  // retuning a token in programmheft.css goes red here naming both values.
  const dom = loadApp();
  try {
    const tokens = JSON.parse(dom.run('JSON.stringify(PROGRAMMHEFT_CARD_TOKENS)'));
    const names = Object.keys(tokens);
    assert.ok(names.length >= 12, 'the copy was actually read');
    for (const name of names) {
      assert.deepEqual(hex(tokens[name]), token(name, HEFT),
        `${name}: the card paints ${tokens[name]}, the design declares another value`);
    }
  } finally { dom.close(); }
});

test('every ink clears 4.5:1 on what it is written on — a DISPLAY ink 3:1, and only it', () => {
  const dom = loadApp();
  try {
    const tokens = JSON.parse(dom.run('JSON.stringify(PROGRAMMHEFT_CARD_TOKENS)'));
    const pairs = JSON.parse(dom.run('JSON.stringify(PROGRAMMHEFT_CARD_TEXT)'));
    assert.ok(pairs.length >= 10, 'the pairs were actually read');
    for (const { ink, on, display } of pairs) {
      assert.ok(tokens[ink] && tokens[on], `${ink} on ${on}: both are in the token copy`);
      const ratio = contrast(hex(tokens[ink]), hex(tokens[on]));
      assert.ok(ratio >= (display ? 3 : 4.5), `${ink} on ${on} is ${ratio.toFixed(2)}:1`);
      // A pair flagged display that already clears AA would hide a real
      // display-only ink behind a needless restriction — and vice versa.
      if (display) assert.ok(ratio < 4.5, `${ink} on ${on} clears AA; it need not be display-only`);
    }
  } finally { dom.close(); }
});

test('session spec: masthead number, long date, winner in vermilion, three facts, three rows', () => {
  const dom = boot();
  try {
    const s = spec(dom, 'session', SESSION);
    assert.equal(s.masthead, 'Session Nr. 23');
    assert.equal(s.date, '20. September 2026', 'the long date, never `when` with its time of day');
    assert.equal(s.cover, true);
    assert.deepEqual(s.headline.filter((r) => r.hot).map((r) => r.text), ['Jonas']);
    assert.deepEqual(facts(s), ['Score=4,8', 'Serie=2 in Folge', 'Dabei=4']);
    assert.deepEqual(s.rows.map((r) => [r.place, r.title, r.win]),
      [['1', 'Nordlichter', true], ['2', 'Kartographen', false], ['3', 'Azul', false]],
      'three rows, the played game marked');
    assert.ok(!JSON.stringify(s).includes('21:47'));
  } finally { dom.close(); }
});

test('session spec: a tie says so instead of a streak; no streak falls back to the rating count', () => {
  const dom = boot();
  try {
    const tie = spec(dom, 'session', { ...SESSION, winnerNames: ['Jonas', 'Lea'] });
    assert.deepEqual(facts(tie), ['Score=4,8', 'Geteilt=2 Sieger', 'Dabei=4'], 'a tie outranks a streak');
    assert.deepEqual(tie.headline.filter((r) => r.hot).map((r) => r.text), ['Jonas und Lea']);

    const plain = spec(dom, 'session', { ...SESSION, streak: null });
    assert.deepEqual(facts(plain), ['Score=4,8', 'Wertungen=5', 'Dabei=4']);

    const lost = spec(dom, 'session', { ...SESSION, winnerNames: [], ending: 'lost', streak: null });
    assert.deepEqual(lost.headline.filter((r) => r.hot), [], 'no name, nothing in vermilion');
    assert.ok(lost.headline.map((r) => r.text).join('').includes('und hat gewonnen'), 'the results screen’s own sentence for a loss');

    const noNumber = spec(dom, 'session', { ...SESSION, sessionNo: undefined, dayLong: undefined });
    assert.equal(noNumber.masthead, '', 'another design’s model carries no number, and none is invented');
    assert.equal(noNumber.date, '20.09.2026');
  } finally { dom.close(); }
});

test('session spec: a split session names its tables and states no facts', () => {
  const dom = boot();
  try {
    const s = spec(dom, 'session', { roundName: 'R', day: 'd', outcome: 'split',
      tables: [{ title: 'Nordlichter', names: 'Jonas, Lea' }, { title: 'Azul', names: 'Ida' }] });
    assert.equal(s.cover, false);
    assert.deepEqual(s.facts, []);
    assert.deepEqual(s.rows.map((r) => r.title), ['Nordlichter', 'Azul']);
    assert.ok(!JSON.stringify(s).includes('Jonas'), 'a split names its tables, not their people');
  } finally { dom.close(); }
});

test('period spec: the numbers as facts, a zero shelf figure dropped, the named rows', () => {
  const dom = boot();
  try {
    const s = spec(dom, 'period', PERIOD);
    assert.equal(s.round, 'Donnerstagsrunde');
    assert.deepEqual(s.headline.map((r) => r.text), ['2026']);
    assert.deepEqual(s.facts.map((f) => f.v), ['23', '14', '+6', '2']);
    assert.deepEqual(s.rows.map((r) => r.title), ['Nordlichter', 'Kartographen']);
    assert.equal(s.rows[1].score, '4,6');
  } finally { dom.close(); }
});

test('drawing: 1080×1350, no pattern, no icon font, one image, ≥12px, measured inks, vermilion only as display', async () => {
  const dom = boot();
  try {
    const pairs = JSON.parse(dom.run('JSON.stringify(PROGRAMMHEFT_CARD_TEXT)'));
    const tokens = JSON.parse(dom.run('JSON.stringify(PROGRAMMHEFT_CARD_TOKENS)'));
    const inks = new Set(pairs.map((p) => tokens[p.ink]));
    // An ink that ONLY appears in display pairs is display-only.
    const displayOnly = new Set(pairs.filter((p) => p.display).map((p) => tokens[p.ink])
      .filter((ink) => !pairs.some((p) => !p.display && tokens[p.ink] === ink)));
    assert.ok(displayOnly.has('#e8451c'), 'the vermilion is display-only');
    for (const [kind, model] of [['session', SESSION], ['period', PERIOD],
      ['session', { ...SESSION, winnerNames: ['Jonas', 'Lea', 'Ida'] }]]) {
      dom.run('__calls.length = 0; __canvases.length = 0');
      dom.context.__model = model;
      await dom.run(`programmheftCardBlob(${JSON.stringify(kind)}, __model)`);
      assert.deepEqual(calls(dom, 'createPattern'), [], `${kind}: a pattern taints the canvas in WebKit`);
      const fonts = calls(dom, 'font').map((a) => a[0]);
      assert.ok(fonts.every((f) => !/tabler/i.test(f)), `${kind}: the icon font must never reach the canvas`);
      for (const f of fonts) {
        assert.ok(Number(/(\d+)px/.exec(f)[1]) >= 12, `${kind}: ${f} is under 12px (24px exported)`);
      }
      const images = calls(dom, 'drawImage').map((a) => a[0].img);
      assert.deepEqual([...new Set(images)], ['/icons/powered-by-bgg.png'], `${kind}: only the BGG badge is an image`);
      const drawn = texts(dom);
      assert.ok(drawn.length > 10, `${kind}: text was drawn`);
      for (const { text, fill, font } of drawn) {
        assert.ok(inks.has(fill), `${kind}: „${text}" is drawn in ${fill}, which PROGRAMMHEFT_CARD_TEXT does not measure`);
        if (displayOnly.has(fill)) {
          assert.ok(/Anton/.test(font) && Number(/(\d+)px/.exec(font)[1]) >= 24,
            `${kind}: „${text}" is ${fill} in ${font} — P1 allows it only in Anton from 24px`);
        }
      }
      const all = drawn.map((d) => d.text).join('');
      assert.ok(all.includes('spielwirbel.app'), `${kind}: the card says where it came from`);
      assert.ok(all.includes('SPIELWIRBEL'), `${kind}: the masthead`);
      assert.ok(!/21:47/.test(all), `${kind}: no time of day`);
      const sizes = JSON.parse(dom.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))'));
      assert.deepEqual(sizes, [[1080, 1350]], `${kind}: one 1080x1350 canvas`);
    }
  } finally { dom.close(); }
});

test('the edition: long date, the session’s number, and the Pokale’s streak once the round is old enough', () => {
  const dom = boot();
  try {
    const at = (d) => `2026-09-${d}T20:00:00.000Z`;
    const played = (id, d, winnerIds) => ({ id, createdAt: at(d), finished: true, chosenGameId: 'g1', winnerIds, memberIds: ['a', 'b'] });
    const round = {
      id: 'r1', members: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      sessions: [played('s1', 10, ['b']), played('s2', 12, ['a']), played('s3', 14, ['a']),
        { id: 's4', createdAt: at(20), finished: false, memberIds: ['a', 'b'] }],
    };
    dom.context.__round = round;
    const ed = (sid, winners) => JSON.parse(dom.run(
      `JSON.stringify(programmheftEdition(__round, __round.sessions.find((s) => s.id === ${JSON.stringify(sid)}), ${JSON.stringify(winners)}))`));

    const now = ed('s4', ['a']);
    assert.equal(now.sessionNo, 4, 'the session being finished counts itself');
    assert.equal(now.streak, 3, 'its own win extends the streak it is shared with');
    assert.equal(now.dayLong, '20. September 2026');
    assert.equal(ed('s4', ['b']).streak, null, 'a different winner starts no streak worth printing');
    assert.equal(ed('s4', ['a', 'b']).streak, null, 'a shared win is no streak');
    // A solo night neither extends nor breaks a streak (the Pokale's rule), so
    // the card must not print the run it skipped over as this night's.
    round.sessions[3].memberIds = ['a'];
    assert.equal(ed('s4', ['a']).streak, null, 'a solo night carries no streak of its own');
    round.sessions[3].memberIds = ['a', 'b'];
    assert.equal(ed('s3', ['a']).streak, 2, 'an older session is read as of ITS night, not today');
    assert.equal(ed('s3', ['a']).sessionNo, 3);

    // Two played nights: the Pokale holds its series back, and so does the card.
    round.sessions = round.sessions.filter((s) => s.id !== 's1');
    assert.equal(ed('s3', ['a']).streak, null, 'a young round prints no series');
  } finally { dom.close(); }
});

test('the Chronik’s share draws this card only while Das Programmheft is worn', async () => {
  const heft = boot();
  try {
    heft.context.__model = PERIOD;
    await heft.run('recapCardBlob(__model)');
    // The round's name in the head row's Anton capitals is this card's alone.
    assert.ok(texts(heft).some((d) => d.text === 'DONNERSTAGSRUNDE'), 'this card’s head row was drawn');
    assert.deepEqual(JSON.parse(heft.run('JSON.stringify(__canvases.map((c) => [c.width, c.height]))')), [[1080, 1350]]);
  } finally { heft.close(); }

  const ocean = boot({ design: 'ocean' });
  try {
    ocean.context.__model = PERIOD;
    await ocean.run('recapCardBlob(__model)');
    assert.ok(!texts(ocean).some((d) => d.text === 'spielwirbel.app' && d.fill === '#141414'), 'Ocean keeps its own card');
  } finally { ocean.close(); }
});

test('the results screen’s share: the card while worn, failures reported, the text share after', async () => {
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
    assert.ok(texts(dom).some((d) => d.text === 'DONNERSTAGSRUNDE'), 'this card, not another design’s');

    dom.run('HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); }');
    assert.equal(await dom.run('shareResultCard(__model, "msg")'), false, 'the text share still runs');
    assert.deepEqual([...dom.context.__reports], ['recap_export'], 'and the failure reaches the operator');
  } finally { dom.close(); }
});

// The results screen builds the edition only while the design is worn —
// Klassisch's share model is exactly what it was.
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

test('the results screen adds the edition under Das Programmheft and nowhere else', async () => {
  const heft = await sharedModel('programmheft');
  assert.equal(heft.sessionNo, 1);
  assert.equal(heft.dayLong, '20. September 2026');
  assert.equal(heft.streak, null, 'one night is no series');

  const classic = await sharedModel('klassisch');
  for (const key of ['sessionNo', 'dayLong', 'streak']) {
    assert.ok(!(key in classic), `Klassisch's model carries no ${key}`);
  }
});
