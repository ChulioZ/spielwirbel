'use strict';

/* Der Tisch's finished split (#1270, T4.5 desktop / T6.6 phone): one result per
   table — a felt head with the table's label, its people and the result
   screen's standard sentence, over a paper Tafel of THAT table's ranking — and
   Klassisch's spotlight cards left exactly as they are.

   The Tafel is the sharp part. A split holds ONE vote, the parent's, so a
   table's ranking is the parent's draw scored with only the seated people's
   votes (tableFeedback, the builder's own function). The fixture is built so the
   two tables rank the same four games in different orders, and so the game a
   table played is NOT always its top row — which is what the „Tisch 2" tag and
   the appended fourth row exist for. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const MEMBERS = ['Anna', 'Ben', 'Dana', 'Eli', 'Frida', 'Georg'].map((name, i) => ({ id: 'm' + i, name }));
const GAMES = [
  { id: 'g1', title: 'Catan' },
  { id: 'g2', title: 'Azul' },
  { id: 'g3', title: 'Carcassonne' },
  { id: 'g4', title: 'Hanabi' },
];

const all = (ids, byGame) => Object.fromEntries(ids.map((id) => [id, Object.fromEntries(
  Object.entries(byGame).map(([gid, r]) => [gid, { rating: Array.isArray(r) ? r[ids.indexOf(id)] : r }])
)]));
/* Table 1 (m0-m2): Azul 5,0 · Catan 4,0 · Carcassonne 3,0 · Hanabi 1,0.
   Table 2 (m3-m5): Catan 5,0 · Carcassonne 4,0 · Hanabi (4,4,3 → 3,7) · Azul 3,0. */
const VOTES = {
  ...all(['m0', 'm1', 'm2'], { g1: 4, g2: 5, g3: 3, g4: 2 }),
  ...all(['m3', 'm4', 'm5'], { g1: 5, g2: 3, g3: 4, g4: [4, 4, 3] }),
};

const parent = (over = {}) => ({
  id: 'p1',
  createdAt: '2026-08-20T18:00:00.000Z',
  memberIds: MEMBERS.map((m) => m.id),
  gameIds: GAMES.map((g) => g.id),
  votes: VOTES,
  multiTable: true,
  done: true,
  finished: false,
  cancelled: false,
  chosenGameId: null,
  winnerIds: [],
  childSessionIds: ['c1', 'c2'],
  ...over,
});

const child = (id, gameId, memberIds, over = {}) => ({
  id,
  createdAt: '2026-08-20T18:01:00.000Z',
  memberIds,
  gameIds: [gameId],
  votes: {},
  done: true,
  finished: true,
  cancelled: false,
  chosenGameId: gameId,
  parentSessionId: 'p1',
  winnerIds: [],
  ...over,
});

const T1 = child('c1', 'g1', ['m0', 'm1', 'm2'], { winnerIds: ['m0'] });
const T2 = child('c2', 'g2', ['m3', 'm4', 'm5'], { winnerIds: ['m4', 'm5'] });

const round = (sessions) => ({
  id: 7, name: 'Donnerstagsrunde', members: MEMBERS, games: GAMES, sessions, tags: [],
});

async function render(t, design, children, p = parent()) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('roundCan', () => false);
  dom.set('canShareResult', () => true);
  dom.run(`applyDesign('${design}')`);
  await dom.call('showTableBuilder', round([p, ...children]), p);
  return dom;
}

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const rowsOf = (table) => [...table.querySelectorAll('.split-row')].map((r) => ({
  rank: text(r.querySelector('.split-row__rank')),
  title: text(r.querySelector('.split-row__title')),
  pill: text(r.querySelector('.split-row__pill')),
  tag: text(r.querySelector('.split-row__tag')),
  played: r.classList.contains('is-played'),
}));

/* ---------------------------- Klassisch, unchanged --------------------------- */

test('Klassisch keeps its head, banner, share toolbar and one spotlight per table', async (t) => {
  const dom = await render(t, 'klassisch', [T1, T2]);
  const head = dom.app.querySelector('.page-head');
  assert.equal(head.className, 'page-head');
  assert.equal(text(head.querySelector('h1')), 'Die Tische');
  assert.match(text(head.querySelector('.muted')), / · 4 Spiele$/);
  assert.ok(dom.app.querySelector('.chosen-banner.is-set'), 'the „Aufgeteilt auf" banner');
  assert.ok(dom.app.querySelector('.toolbar .btn--ghost'), 'the share toolbar above the cards');
  assert.equal(dom.app.querySelectorAll('.split-tables > a.spotlight--table').length, 2);
  // None of Der Tisch's structure leaks into the default path.
  assert.equal(dom.app.querySelector('.split-table, .split-row, .split-tables__foot, .page-head--tables'), null);
});

/* ------------------------------- Der Tisch -------------------------------- */

test('Der Tisch heads the screen with the session, not with a banner', async (t) => {
  const dom = await render(t, 'tisch', [T1, T2]);
  const head = dom.app.querySelector('.page-head--tables');
  assert.ok(head, 'the Tisch head');
  assert.equal(text(head.querySelector('h1')), '2 Tische, eine Session');
  const sub = text(head.querySelector('.muted'));
  assert.match(sub, /^6 Personen · /);
  assert.match(sub, / · alle Ergebnisse stehen in derselben Chronik$/);
  assert.equal(dom.app.querySelector('.chosen-banner'), null, 'the head says what the banner said');
  assert.equal(dom.app.querySelector('.spotlight--table'), null, 'no Klassisch card under Der Tisch');
});

test('each table gets a felt head: label, people with crowns, the standard sentence, and its link', async (t) => {
  const dom = await render(t, 'tisch', [T1, T2]);
  const tables = [...dom.app.querySelectorAll('.split-tables--tisch > .split-table')];
  assert.equal(tables.length, 2);

  const [a, b] = tables.map((tb) => tb.querySelector('.split-table__head'));
  assert.equal(a.getAttribute('href'), '/round/7/session/c1');
  assert.equal(b.getAttribute('href'), '/round/7/session/c2');
  assert.equal(text(a.querySelector('.split-table__label')), 'Tisch 1');
  assert.equal(text(b.querySelector('.split-table__label')), 'Tisch 2');

  assert.equal(text(a.querySelector('.split-table__sentence')), '„Catan“ wurde gespielt. Anna hat gewonnen!');
  assert.equal(text(b.querySelector('.split-table__sentence')), '„Azul“ wurde gespielt. Frida und Georg haben gewonnen!');
  assert.equal(text(b.querySelector('.split-table__winners')), 'Frida und Georg');

  // Three pieces per table, a crown over exactly the winners.
  const crowned = (head) => [...head.querySelectorAll('.split-table__person')]
    .map((p) => !!p.querySelector('.split-table__crown'));
  assert.deepEqual(crowned(a), [true, false, false]);
  assert.deepEqual(crowned(b), [false, true, true]);
  // The pieces are initials only, so the names ride along for a screen reader.
  assert.equal(a.querySelector('.split-table__people').getAttribute('aria-hidden'), 'true');
  assert.match(text(a.querySelector('.sr-only')), /Anna, Ben, Dana$/);

  // Two tables, two felts: the head carries its own marker.
  assert.notEqual(a.style.getPropertyValue('--marker'), '');
  assert.notEqual(a.style.getPropertyValue('--marker'), b.style.getPropertyValue('--marker'));
});

test('each Tafel ranks the draw by that table\'s own votes', async (t) => {
  const dom = await render(t, 'tisch', [T1, T2]);
  const [a, b] = dom.app.querySelectorAll('.split-table');

  // Table 1 played Catan, but its people rated Azul higher — Azul went to
  // table 2, and the row says so.
  assert.deepEqual(rowsOf(a), [
    { rank: '1', title: 'Azul', pill: '5,0', tag: 'Tisch 2', played: false },
    { rank: '2', title: 'Catan', pill: '4,0', tag: 'Gespielt', played: true },
    { rank: '3', title: 'Carcassonne', pill: '3,0', tag: '', played: false },
  ]);
  // Table 2's played game ranks fourth for its people: it is still on the
  // Tafel, at its real place, after the top three.
  assert.deepEqual(rowsOf(b), [
    { rank: '1', title: 'Catan', pill: '5,0', tag: 'Tisch 1', played: false },
    { rank: '2', title: 'Carcassonne', pill: '4,0', tag: '', played: false },
    { rank: '3', title: 'Hanabi', pill: '3,7', tag: '', played: false },
    { rank: '4', title: 'Azul', pill: '3,0', tag: 'Gespielt', played: true },
  ]);
});

test('an unplayed table keeps its state; a cancelled one has nothing to rank', async (t) => {
  const open = { ...T2, finished: false, winnerIds: [] };
  const dom = await render(t, 'tisch', [{ ...T1, cancelled: true, finished: false, winnerIds: [] }, open]);
  const [a, b] = dom.app.querySelectorAll('.split-table');
  assert.equal(a.classList.contains('is-off'), true);
  assert.equal(b.classList.contains('is-off'), true);
  assert.equal(text(a.querySelector('.split-table__sentence')), 'Session abgebrochen – es wurde nichts gespielt.');
  assert.equal(a.querySelector('.split-table__tafel'), null);
  assert.equal(text(b.querySelector('.split-table__sentence')), '„Azul“ läuft noch.');
  assert.ok(b.querySelector('.split-table__tafel'), 'an open table still shows how its people ranked the draw');
});

test('a split nobody voted on shows no Tafel at all', async (t) => {
  const dom = await render(t, 'tisch', [T1, T2], parent({ votes: {} }));
  assert.equal(dom.app.querySelectorAll('.split-table').length, 2);
  assert.equal(dom.app.querySelector('.split-table__tafel'), null);
});

test('the foot shares every table at once and starts the next session', async (t) => {
  const dom = await render(t, 'tisch', [T1, T2]);
  const shared = [];
  const started = [];
  dom.set('shareResult', (model) => { shared.push(model); });
  dom.set('showStartSession', (r) => { started.push(r.id); });
  const [share, start] = dom.app.querySelectorAll('.split-tables__foot .btn');
  assert.equal(text(share), 'Alle Tische teilen');
  share.click();
  assert.equal(shared.length, 1);
  assert.equal(shared[0].outcome, 'split');
  assert.deepEqual(shared[0].tables.map((tb) => tb.title), ['Catan', 'Azul']);
  // „Noch eine Session" (operator decision 2026-09-24), not the hub's wording.
  assert.equal(text(start), 'Noch eine Session');
  start.click();
  assert.deepEqual(started, [7]);
  // The foot is the last thing before the log/footer, and there is exactly one.
  assert.equal(dom.app.querySelectorAll('.split-tables__foot').length, 1);
});

test('the start action is disabled exactly as the hub disables it', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('roundCan', () => false);
  dom.run("applyDesign('tisch')");
  const r = round([parent(), T1, T2]);
  r.games = GAMES.map((g) => ({ ...g, retired: true }));
  await dom.call('showTableBuilder', r, parent());
  const start = dom.app.querySelector('.split-tables__foot .btn--primary');
  assert.equal(start.disabled, true);
});
