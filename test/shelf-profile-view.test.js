'use strict';

/* The Regal-Steckbrief's three surfaces (#1173, views-shelf-profile.js and
   shelf-profile-card.js) — RENDERED through the jsdom harness, never
   `require`d (.claude/rules/testing-views-under-jsdom.md).

   What this cannot see, said up front: jsdom has no 2d context and Node has no
   WebKit, so nothing here can observe a TAINTED canvas. The share half pins the
   MECHANISM that keeps the image clean in both engines — no pattern, one image
   and it is the same-origin BGG badge — plus the report on failure, the same
   way test/recap-card-tisch.test.js does for the recap card. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush } = require('./support/dom');

// A linked game: provider data, a 2–4 range, a medium hour.
const game = (id, over = {}) => ({
  id, title: 'Spiel ' + id, minPlayers: 2, maxPlayers: 4, maxPlaytime: 60, weight: 2.4,
  categories: ['Card Game'], mechanics: ['Hand Management', 'Set Collection'], image: null, ...over,
});

// Nine linked games: nothing seats five or six, nothing runs past an hour, so
// the gaps are known in advance.
const linkedRound = (over = {}) => ({
  id: 3,
  name: 'Freitagsrunde',
  members: [{ id: 1, name: 'Anna' }, { id: 2, name: 'Ben' }],
  // Designers (#1505): five uncredited games and four by one person, so the
  // sentinel would lead the list if any surface forgot to drop it.
  games: Array.from({ length: 9 }, (_, i) => game(10 + i, { designers: i < 5 ? ['(Uncredited)'] : ['Uwe Rosenberg'] })),
  // One evening that rated every game, so each has a shelf score: since #1556
  // the name lists rank by score, and an unscored shelf lists no name at all.
  // The uncredited games are rated HIGHER, so a surface that forgot the
  // sentinel filter would lead with it.
  sessions: [{
    id: 's1', createdAt: '2026-09-01T20:00:00.000Z', finished: true, done: true,
    gameIds: Array.from({ length: 9 }, (_, i) => 10 + i),
    memberIds: [1, 2],
    votes: Object.fromEntries([1, 2].map((m) => [m,
      Object.fromEntries(Array.from({ length: 9 }, (_, i) => [10 + i, { rating: i < 5 ? 5 : 4 }]))])),
  }],
  tags: [],
  ...over,
});

const noRecos = () => async () => ({ recommendations: [] });
const card = (dom) => dom.app.querySelector('.hub-card--shelf');

test('the Start card is absent below the threshold of games with provider data', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', noRecos());
  // Nine games with a hand-typed range and nothing else — not "linked".
  const r = linkedRound({ games: Array.from({ length: 9 }, (_, i) => ({ id: 10 + i, title: 'F' + i, minPlayers: 2, maxPlayers: 4 })) });
  dom.call('renderStartTab', r, r.games);
  assert.equal(card(dom), null, 'a shelf with no provider data grew a Steckbrief');

  dom.app.innerHTML = '';
  const thin = linkedRound({ games: Array.from({ length: 7 }, (_, i) => game(10 + i)) });
  dom.call('renderStartTab', thin, thin.games);
  assert.equal(card(dom), null, 'seven linked games is under the floor');
});

test('Klassisch: the card shows the seat bands as bars, the strongest gaps, and links to the screen', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', noRecos());
  const r = linkedRound();
  dom.call('renderStartTab', r, r.games);
  const c = card(dom);
  assert.ok(c, 'nine linked games must render the card');
  assert.equal(c.querySelector('.hub-card__title').textContent.trim(), 'Regal-Steckbrief');
  const bars = [...c.querySelectorAll('.shelf-bar')];
  assert.deepEqual(bars.map((b) => b.querySelector('.shelf-bar__label').textContent), ['für 2', 'für 3', 'für 4', 'für 5', 'für 6+']);
  assert.deepEqual(bars.map((b) => b.querySelector('.shelf-bar__n').textContent), ['9', '9', '9', '0', '0']);
  assert.deepEqual(bars.map((b) => b.classList.contains('shelf-bar--gap')), [false, false, false, true, true]);
  assert.equal(c.querySelectorAll('.shelf-tile').length, 0, 'Klassisch draws bars, not tiles');
  // Seven empty bands exist (5, 6+, three time bands, two weight bands); the card
  // names three and leaves the rest to the screen.
  const gaps = [...c.querySelectorAll('.shelf-gap')].map((g) => g.textContent.trim());
  assert.deepEqual(gaps, ['Für 5 Personen: kein Spiel', 'Für 6+ Personen: kein Spiel', 'Bis 30 Min.: kein Spiel']);
  const link = c.querySelector('a.hub-row');
  assert.equal(link.getAttribute('href'), '/round/3/shelf-profile');
});

test('Der Tisch: the seat bands are the Rundenpuls’s stat tiles, gaps marked', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', noRecos());
  dom.call('applyDesign', 'tisch');
  const r = linkedRound();
  dom.call('renderStartTab', r, r.games);
  const c = card(dom);
  assert.ok(c);
  const tiles = [...c.querySelectorAll('.pulse-tiles.shelf-tiles > .pulse-tile')];
  assert.equal(tiles.length, 5);
  assert.deepEqual(tiles.map((x) => x.querySelector('.pulse-tile__n').textContent), ['9', '9', '9', '0', '0']);
  assert.deepEqual(tiles.map((x) => x.classList.contains('shelf-tile--gap')), [false, false, false, true, true]);
  assert.equal(c.querySelectorAll('.shelf-bar').length, 0);
});

// The screen, rendered through its real route to the round.
async function screen(t, round, { design } = {}) {
  const dom = loadApp();
  t.after(() => dom.close());
  if (design) dom.call('applyDesign', design);
  dom.set('api', async () => round);
  dom.set('toast', () => {});
  await dom.call('showShelfProfile', round.id);
  return dom;
}

test('the screen: every dimension, the full gap list, the leading mechanics, and „Teilen"', async (t) => {
  const dom = await screen(t, linkedRound());
  assert.equal(dom.app.querySelector('.page-head h1').textContent, 'Regal-Steckbrief');
  const panels = [...dom.app.querySelectorAll('.shelf-profile > .shelf-panel')];
  assert.deepEqual(panels.map((p) => p.querySelector('.hub-card__title').textContent.trim()),
    ['Personen', 'Spieldauer', 'Komplexität', 'Lücken', 'Mechaniken', 'Kategorien', 'Autor:innen']);
  const designers = [...panels[6].querySelectorAll('.shelf-top__row')];
  assert.deepEqual(designers.map((r) => r.querySelector('.shelf-top__name').textContent), ['Uwe Rosenberg'],
    'the sentinel is never a designer');
  // Each row carries the mean SHELF score as the shelf's own pill, clamped for
  // display, and the number of scored games behind it (#1556).
  const uweScore = dom.run('fmtAvg(displayScore(gameStats(' + JSON.stringify(linkedRound()) + ', 15).score))');
  assert.equal(designers[0].querySelector('.shelf-top__val .score-pill').textContent, uweScore);
  assert.equal(designers[0].querySelector('.shelf-top__n').textContent, 'aus 4 Spielen');
  assert.ok(panels[6].querySelector('.hub-card__title [data-info-topic="score"]'), 'the ⓘ says what the order is');
  assert.equal(panels[6].querySelector('.shelf-card__sub').textContent, 'Nach Spielwirbel-Score');
  // The share image carries the same value the screen shows.
  const items = JSON.parse(dom.run(`(() => { const r = ${JSON.stringify(linkedRound())};
    const a = r.games.filter(isActiveGame);
    const p = shelfProfile(a, shelfProfileDeps(roundScoreIndex(r, a).byGame));
    return JSON.stringify(shelfShareModel(r, p).lists.map((l) => l.items)); })()`));
  assert.deepEqual(items[2], [`Uwe Rosenberg · ${uweScore}`]);
  // 5, 6+, ≤30, 61–120, >120, light, heavy — all of them, not the card's three.
  // Five, not seven: weight bands draw as bars but list no gap (#1173 review).
  assert.equal(dom.app.querySelectorAll('.shelf-panel .shelf-gap').length, 5);
  const mech = [...dom.app.querySelectorAll('.shelf-top__name')].map((n) => n.textContent);
  assert.deepEqual(mech.slice(0, 2), ['Hand Management', 'Set Collection'], 'BGG names shown verbatim');
  assert.ok(dom.app.querySelector('.shelf-head__share'), 'jsdom anchors support `download`, so the share is offered');
  // A Regal sub-screen: the back control first, as every non-main screen.
  assert.ok(dom.app.querySelector('.back-row'));
  assert.equal(dom.window.location.pathname, '/round/3/shelf-profile');
});

test('the router resolves the path, and a thinned-out shelf says what it takes instead of empty panels', async (t) => {
  const dom = await screen(t, linkedRound({ games: [game(1), game(2)] }));
  assert.equal(dom.app.querySelectorAll('.shelf-panel').length, 0);
  assert.match(dom.app.querySelector('.empty__text').textContent, /mindestens 8 Spiele/);
  assert.equal(dom.app.querySelector('.shelf-head__share'), null);
  // Not merely "a function": an unknown sub-path resolves to the hub, so ask which.
  assert.match(dom.run("String(resolveRoute('/round/3/shelf-profile'))"), /showShelfProfile/);
  assert.equal(dom.run("clientErrorPathShape('/round/3/shelf-profile')"), '/round/:rid/shelf-profile',
    'the error reporter must know the new route, or its faults fold to /other');
});

/* A recording 2d context on every canvas, and an Image that loads at once —
   jsdom fires neither load nor error for an image, so without it the badge
   would never resolve. The shape test/recap-card-tisch.test.js uses. */
function recordCanvas(dom) {
  dom.run(`
    globalThis.__calls = [];
    const grad = () => ({ addColorStop: () => {} });
    HTMLCanvasElement.prototype.getContext = function () {
      const ctx = {
        textAlign: 'left', _font: '', fillStyle: '#000',
        get font() { return this._font; }, set font(v) { this._font = v; },
        measureText: (s) => ({ width: String(s).length * 7 }),
        createLinearGradient: grad, createRadialGradient: grad,
      };
      for (const m of ['fillRect', 'fill', 'beginPath', 'roundRect', 'scale', 'fillText', 'drawImage', 'createPattern', 'save', 'restore']) {
        ctx[m] = (...a) => { __calls.push([m, m === 'drawImage' ? a[0].src : a[0]]); };
      }
      return ctx;
    };
    HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob(['png'], { type: 'image/png' })); };
    globalThis.Image = class { set src(v) { this._src = v; this.naturalWidth = 900; this.naturalHeight = 264; setTimeout(() => this.onload && this.onload()); } get src() { return this._src; } };
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => {};
  `);
}

for (const design of [null, 'tisch']) {
  test(`share (${design || 'Klassisch'}): the image draws no pattern, only the same-origin badge, and is delivered`, async (t) => {
    const dom = await screen(t, linkedRound(), { design });
    recordCanvas(dom);
    const toasts = [];
    dom.set('toast', (m) => toasts.push(m));
    dom.app.querySelector('.shelf-head__share').click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
    await flush();
    const calls = JSON.parse(dom.run('JSON.stringify(__calls)'));
    assert.equal(calls.filter(([m]) => m === 'createPattern').length, 0, 'a pattern is what WebKit taints on');
    assert.deepEqual(calls.filter(([m]) => m === 'drawImage').map(([, src]) => src), ['/icons/powered-by-bgg.png']);
    const text = calls.filter(([m]) => m === 'fillText').map(([, s]) => s);
    assert.ok(text.includes('Freitagsrunde'), 'the round is named on the image');
    assert.ok(text.includes('Für 6+ Personen: kein Spiel'), 'the gaps travel with the image');
    // The designers travel too (#1505), in a panel of their own below the two
    // other lists — a third column would cut most names to an ellipsis. Since
    // #1556 a name carries its score („3,8"), never the old count („4").
    assert.ok(text.includes('Autor:innen') && text.some((s) => /^Uwe Rosenberg · \d+,\d$/.test(s)), 'the designers are on the image');
    assert.ok(!text.some((s) => /Uncredited/.test(s)), 'the sentinel reached the image');
    assert.deepEqual(toasts, ['Bild gespeichert.'], 'no file sharing in jsdom, so the image is saved');
  });
}

test('a failed export is REPORTED as its own kind, and the user still gets the toast', async (t) => {
  const dom = await screen(t, linkedRound());
  recordCanvas(dom);
  dom.run('HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); }');
  const reports = [];
  const toasts = [];
  dom.set('reportClientError', (kind) => reports.push(kind));
  dom.set('toast', (m) => toasts.push(m));
  dom.app.querySelector('.shelf-head__share').click();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(reports, ['shelf_profile_export']);
  assert.deepEqual(toasts, ['Das Bild konnte nicht erstellt werden.']);
  assert.ok(dom.run("CLIENT_ERROR_KINDS.includes('shelf_profile_export')"),
    'the kind must be in the list the route validates against, or the report 400s');
});

test('the image lays its lists out at most TWO to a panel, so a third gets a row of its own (#1505)', async (t) => {
  const dom = await screen(t, linkedRound());
  const list = (title) => ({ title, items: ['Worker Placement with Dice Workers · 3'] });
  const sizes = (n) => JSON.parse(dom.run(
    `JSON.stringify(shelfListPanels({ lists: ${JSON.stringify(Array.from({ length: n }, (_, i) => list('L' + i)))} }).map((p) => p.length))`));
  assert.deepEqual(sizes(2), [2]);
  assert.deepEqual(sizes(3), [2, 1], 'three lists must not squeeze into three ~150px columns');
  assert.deepEqual(sizes(0), []);
  // And the measuring pass counts the second panel, or it would be drawn
  // over the gaps block below it.
  const h = (n) => dom.run(`shelfListsH({ lists: ${JSON.stringify(Array.from({ length: n }, (_, i) => list('L' + i)))} })`);
  assert.ok(h(3) > h(2), 'the second panel adds height');
});
