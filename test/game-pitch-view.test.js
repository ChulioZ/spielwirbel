'use strict';

/* A game's pitch line on screen (#1837), run through the jsdom harness
 * (.claude/rules/testing-views-under-jsdom.md): the line under the title on all
 * four vote cards (hot-seat and link, Klassisch and composed), the game page's
 * line and its editor, and the add-game sheet's field. The shared check and the
 * route are test/game-pitch.test.js.
 *
 * jsdom applies no stylesheet, so where the line sits on screen is held by the
 * CSS-text sweep at the end: every composed vote-card grid must name a `pitch`
 * area, or the line would be auto-placed after the faces.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, flush, waitFor } = require('./support/dom');
const { setMotion } = require('./support/vote-card');

const PITCH = 'Würfel als Arbeiter, fies, 45 min';
// User-authored text: markup in it must arrive as text, never as elements.
const HOSTILE = 'Fies <b>sehr</b> & gut';

const roundFixture = (games) => ({
  id: 'r1', name: 'Donnerstagsrunde', background: null, tags: [], providers: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games, sessions: [],
});

const GAMES = [
  { id: 'g1', title: 'Kartographen', minPlayers: 2, maxPlayers: 5, minPlaytime: 45, pitch: PITCH, tagIds: [] },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4, tagIds: [] },
];

const sessionFixture = () => ({
  id: 's1', createdAt: '2026-11-17T18:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1', 'm2'],
  guests: [], votes: {}, votedIds: [], done: false, cancelled: false, finished: false,
  winnerIds: [], chosenGameId: null,
});

const ANNA = { id: 'm1', name: 'Anna', guest: false };
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const classesOf = (el) => [...el.children].map((c) => c.className.split(' ')[0]);

async function wizard(t, { design = null, games = GAMES } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  setMotion(dom, true);
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  const round = roundFixture(games);
  dom.set('api', async () => round);
  dom.set('currentUserId', () => null);
  await dom.call('startVoting', round, sessionFixture(), games, [ANNA], {
    skipIntro: true, saveVotes: async () => {}, onSaved: async () => {},
  });
  return dom;
}

const ballot = (games) => ({
  roundName: 'Donnerstagsrunde', demo: false,
  games: games.map(({ id, title, minPlayers, maxPlayers, pitch }) => ({ id, title, minPlayers, maxPlayers, pitch: pitch || null })),
  people: [{ id: 'm1', name: 'Anna', color: null, hasVoted: false, linked: false }],
});

function linkCards(t, design, games = GAMES) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  setMotion(dom, true);
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  const b = ballot(games);
  dom.call('renderVoteLinkCards', 'tok', b, b.people[0]);
  return dom;
}

/* ------------------------------ vote cards ------------------------------ */

test('Klassisch hot-seat card: the pitch sits right under the title', async (t) => {
  const dom = await wizard(t);
  const card = dom.app.querySelector('.vote');
  assert.deepEqual(classesOf(card),
    ['vote-progress', 'vote__who', 'vote__img', 'vote__title', 'vote__pitch', 'vote__secret', 'vote__q', 'rating']);
  assert.equal(text(card.querySelector('.vote__pitch')), PITCH);
});

test('Der Tisch hot-seat card: the pitch sits between title and meta on the paper', async (t) => {
  const dom = await wizard(t, { design: 'tisch' });
  const paper = dom.app.querySelector('.vote__card');
  assert.deepEqual(classesOf(paper), ['vote__img', 'vote__title', 'vote__pitch', 'vote__meta', 'vote__q', 'rating']);
  assert.equal(text(paper.querySelector('.vote__pitch')), PITCH);
});

test('a game without a pitch renders no line at all — not an empty one', async (t) => {
  const dom = await wizard(t, { games: [GAMES[1]] });
  assert.equal(dom.app.querySelector('.vote__pitch'), null);
  const blank = await wizard(t, { design: 'tisch', games: [{ ...GAMES[1], pitch: '   ' }] });
  assert.equal(blank.app.querySelector('.vote__pitch'), null, 'a whitespace pitch is no pitch');
});

test('the link cards show the same line, in Klassisch and composed', (t) => {
  for (const design of [null, 'tisch']) {
    const dom = linkCards(t, design);
    const title = dom.app.querySelector('.vote__title');
    const line = dom.app.querySelector('.vote__pitch');
    assert.ok(line, `${design || 'klassisch'}: no pitch on the link card`);
    assert.equal(title.nextElementSibling, line, `${design || 'klassisch'}: the pitch must follow the title`);
    assert.equal(text(line), PITCH);
  }
  assert.equal(linkCards(t, null, [GAMES[1]]).app.querySelector('.vote__pitch'), null);
});

test('a pitch is rendered as text, never as markup', async (t) => {
  const dom = await wizard(t, { games: [{ ...GAMES[0], pitch: HOSTILE }] });
  const line = dom.app.querySelector('.vote__pitch');
  assert.equal(line.children.length, 0, 'markup in a pitch became an element');
  assert.equal(line.textContent, HOSTILE);
});

/* ------------------------------ game page ------------------------------- */

function bootDetail(t, games = GAMES) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = roundFixture(games.map((g) => ({ ...g })));
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('toast', (msg) => calls.push({ toast: msg }));
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  dom.run('window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });');
  return { dom, calls };
}

const patches = (calls) => calls.filter((c) => c.method === 'PATCH');
const pitchInput = (dom) => dom.document.querySelector('#pitchInput');
const enter = (dom, el) => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
const emptyChip = (dom) => [...dom.app.querySelectorAll('.gd-chips .tag--empty')]
  .find((b) => b.textContent.includes('In einem Satz beschreiben'));

test('the game page shows the pitch under the title, and an invitation without one', async (t) => {
  const { dom } = bootDetail(t);
  await dom.call('showGameDetail', 'r1', 'g1');
  const line = dom.app.querySelector('.gd-head .gd-pitch');
  assert.ok(line, 'a game with a pitch shows it');
  assert.equal(line.tagName, 'BUTTON', 'the line is the way into its editor');
  assert.equal(text(line), PITCH);
  assert.equal(emptyChip(dom), undefined, 'no invitation beside a written pitch');

  // A non-sparse page without one: the empty chip. (A cover makes it non-sparse.)
  const { dom: d2 } = bootDetail(t, [{ ...GAMES[1], image: 'https://cf.geekdo-images.com/x.jpg' }]);
  await d2.call('showGameDetail', 'r1', 'g2');
  assert.equal(d2.app.querySelector('.gd-pitch'), null);
  assert.ok(emptyChip(d2), 'a game without a pitch invites one');
});

test('the editor opens prefilled, sends the trimmed line, and clears with null', async (t) => {
  const { dom, calls } = bootDetail(t);
  await dom.call('showGameDetail', 'r1', 'g1');
  dom.app.querySelector('.gd-pitch').click();
  assert.equal(pitchInput(dom).value, PITCH);
  pitchInput(dom).value = '  Plättchen legen, ruhig, 30 min  ';
  enter(dom, pitchInput(dom));
  await waitFor(() => patches(calls).length);
  assert.equal(patches(calls)[0].body.pitch, 'Plättchen legen, ruhig, 30 min');

  await dom.call('showGameDetail', 'r1', 'g1');
  dom.app.querySelector('.gd-pitch').click();
  const clear = [...dom.document.querySelectorAll('.editor--pitch button, .popover--pitch button')]
    .find((b) => b.textContent.includes('Satz entfernen'));
  assert.ok(clear, 'a written pitch offers the way out');
  clear.click();
  await waitFor(() => patches(calls).length === 2);
  assert.equal(patches(calls)[1].body.pitch, null);
});

test('an over-long line toasts and sends nothing; an unchanged one sends nothing either', async (t) => {
  const { dom, calls } = bootDetail(t);
  await dom.call('showGameDetail', 'r1', 'g1');
  dom.app.querySelector('.gd-pitch').click();
  const max = dom.run('GAME_PITCH_MAX');
  pitchInput(dom).value = 'x'.repeat(max + 1);
  pitchInput(dom).dispatchEvent(new dom.window.Event('input'));
  assert.ok(dom.document.querySelector('.pitch-count').classList.contains('is-over'), 'the counter marks the overflow');
  enter(dom, pitchInput(dom));
  await flush();
  assert.equal(patches(calls).length, 0);
  assert.ok(calls.some((c) => c.toast === dom.run(`t('pitch.tooLong', { max: ${max} })`)));

  pitchInput(dom).value = PITCH;
  enter(dom, pitchInput(dom));
  await flush();
  assert.equal(patches(calls).length, 0, 'applying the same line is not a change');
});

/* ----------------------------- add-game sheet ---------------------------- */

test('the add-game sheet sends a typed pitch, and omits the field when blank', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const posts = [];
  dom.set('api', async (method, url, body) => {
    if (method === 'POST' && url.endsWith('/games')) { posts.push(body); return { id: 'n' + posts.length, title: body.get('title') }; }
    return {};
  });
  dom.set('toast', () => {});
  dom.set('currentUserId', () => 'u1');
  dom.set('showRound', () => {});
  const round = { id: 'r1', name: 'R', games: [], tags: [], members: [{ id: 'm1', name: 'Lea', userId: 'u1' }], sessions: [] };

  await dom.call('showAddGame', round);
  dom.document.getElementById('title').value = 'Kartographen';
  dom.document.getElementById('pitch').value = `  ${PITCH} `;
  dom.document.getElementById('save').click();
  await waitFor(() => posts.length === 1);
  assert.equal(posts[0].get('pitch'), PITCH);

  await dom.call('showAddGame', round);
  dom.document.getElementById('title').value = 'Azul';
  dom.document.getElementById('save').click();
  await waitFor(() => posts.length === 2);
  assert.equal(posts[1].get('pitch'), null, 'a blank pitch keeps the ordinary request unchanged');
});

/* ------------------------- CSS: the grid's pitch area -------------------- */

// Every composed design lays its card out as named grid areas. A template that
// names `title` but no `pitch` would auto-place the line after the faces — no
// error, no failing render spec, since jsdom has no layout.
test('every composed vote-card grid names a pitch area', () => {
  const dir = path.join(__dirname, '..', 'public', 'css', 'designs');
  let checked = 0;
  const missing = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]*\.vote__card[^{}]*)\{([^}]*)\}/g)) {
      const areas = (m[2].match(/grid-template-areas:([^;]*);/) || [])[1];
      if (!areas || !/\btitle\b/.test(areas)) continue;
      checked += 1;
      if (!/\bpitch\b/.test(areas)) missing.push(`${file}: ${m[1].trim()}`);
    }
  }
  assert.ok(checked >= 10, `only ${checked} vote-card grids found — the sweep is not seeing the designs`);
  assert.deepEqual(missing, []);
});
