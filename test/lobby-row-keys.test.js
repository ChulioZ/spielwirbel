'use strict';

/* The voting lobby names each person ONCE (#1574): „Für Clara" sits at the end
   of Clara's own row, in every design, instead of a second list of „Für Anna /
   Für Ben …" under the actions. A count heads the list, and Klassisch explains
   the shared link in a panel beside it.

   The markup half is design-independent (showSessionLobby builds it once), so
   it is asserted for all six designs; the layout half is CSS, which jsdom does
   not apply, so it is pinned as the rules that show the count and the panel. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf, declaredValue, mediaBlocks } = require('./support/css');

const ME = 'user-me';
const roundFixture = () => ({
  id: 'r1',
  name: 'Donnerstagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Anna', userId: ME }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }, { id: 'm4', name: 'Dora' }],
  tags: [],
  sessions: [],
  games: [
    { id: 'g1', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
    { id: 'g2', title: 'Carcassonne', minPlayers: 1, maxPlayers: 8 },
  ],
  activity: [],
});
// Anna (this account) is open, Ben has voted, Clara and Dora are open.
const sessionFixture = () => ({
  id: 's1',
  createdAt: '2026-10-08T18:00:00.000Z',
  gameIds: ['g1', 'g2'],
  memberIds: ['m1', 'm2', 'm3', 'm4'],
  guests: [],
  votes: {},
  votedIds: ['m2'],
  done: false,
  cancelled: false,
  finished: false,
  winnerIds: [],
  chosenGameId: null,
  events: [],
});

const DESIGNS = ['klassisch', 'tisch', 'ocean', 'bruecke', 'programmheft', 'forest'];
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

async function lobby(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => { dom.call('stopLobbyPoll'); dom.close(); });
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  dom.set('toast', () => {});
  dom.set('api', async () => roundFixture());
  dom.run('Math.random = () => 0.5');
  dom.call('applyDesign', design);
  await dom.call('showSessionLobby', roundFixture(), sessionFixture(), false);
  return dom;
}

for (const design of DESIGNS) {
  test(`${design}: each open person's „Für …" key is in their own row, and there is no second list`, async (t) => {
    const dom = await lobby(t, design);
    assert.equal(dom.app.querySelector('.live-vote__hotseat'), null, 'the separate „An diesem Gerät abstimmen" list is gone');
    const rows = [...dom.app.querySelectorAll('.live-person')];
    const byName = Object.fromEntries(rows.map((r) => [text(r.querySelector('.live-person__name')), r]));
    assert.deepEqual(Object.keys(byName), ['Anna', 'Ben', 'Clara', 'Dora']);
    const keyOf = (name) => byName[name].querySelector(':scope > .live-vote__hotseat-btn');
    assert.equal(keyOf('Anna'), null, 'your own open seat is the leading button, not a row key');
    assert.equal(keyOf('Ben'), null, 'Ben has voted');
    assert.match(text(keyOf('Clara')), /Für Clara$/);
    assert.match(text(keyOf('Dora')), /Für Dora$/);
    assert.equal(dom.app.querySelectorAll('.live-vote__hotseat-btn').length, 2, 'no key outside the rows');
  });

  test(`${design}: a row key votes for that row's person, and your own vote stays the lead`, async (t) => {
    const dom = await lobby(t, design);
    const mine = dom.app.querySelector('.live-vote__mine');
    assert.ok(mine, '„Jetzt abstimmen" is still rendered');
    assert.ok(mine.classList.contains('btn--primary'), 'and still the primary action');
    const voted = [];
    dom.set('startVoting', (round, session, games, people) => { voted.push(people.map((p) => p.id)); });
    const dora = [...dom.app.querySelectorAll('.live-person')]
      .find((r) => text(r.querySelector('.live-person__name')) === 'Dora');
    dora.querySelector('.live-vote__hotseat-btn').click();
    assert.deepEqual(JSON.parse(JSON.stringify(voted)), [['m4']]);
  });
}

test('the list carries its count, read from who has voted', async (t) => {
  const dom = await lobby(t, 'klassisch');
  const count = dom.app.querySelector('.live-vote__people > .live-vote__count');
  assert.ok(count, 'the count is rendered inside the list');
  assert.equal(dom.app.querySelector('.live-vote__people').firstElementChild, count, 'and heads it');
  assert.equal(text(count), '1 von 4 gewertet');
});

/* CSS: who SHOWS the count and the panel. The view renders both for every
   design; the designs that compose a count of their own leave this one hidden. */
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const shows = (css, sel) => rulesOf(css).some(([s, body]) => s.trim() === sel && declaredValue(body, 'display') === 'block');
const K = ':root[data-design="klassisch"]';

test('the count is hidden by default and shown by Klassisch, Der Tisch and Ocean', () => {
  const base = read('public/styles.css');
  assert.ok(rulesOf(base).some(([s, body]) => s.split(',').map((x) => x.trim()).includes('.live-vote__count')
    && declaredValue(body, 'display') === 'none'), 'hidden unless a design shows it');
  assert.ok(shows(base, `${K} .live-vote__count`), 'Klassisch shows it');
  assert.ok(shows(read('public/css/designs/tisch.css'), ':root[data-design="tisch"][data-scheme="dark"] .live-vote__count'), 'Der Tisch shows it');
  assert.ok(shows(read('public/css/designs/ocean.css'), ':root[data-design="ocean"]:not([data-scheme="dark"]) .live-vote--ocean .live-vote__count'), 'Ocean shows it');
});

test('Klassisch explains the shared link, beside the list from 860px', () => {
  const base = read('public/styles.css');
  assert.ok(shows(base, `${K} .live-vote__panel-head`), 'the panel’s title and note are shown');
  const wide = mediaBlocks(base).filter(([query]) => /min-width:\s*860px/.test(query)).map(([, body]) => body).join('\n');
  const grid = rulesOf(wide).find(([s]) => s.trim() === `${K} .live-vote:has(.live-vote__panel-head)`);
  assert.ok(grid, 'Klassisch has a two-column lobby from 860px');
  assert.equal(declaredValue(grid[1], 'display'), 'grid');
  const panel = rulesOf(wide).find(([s]) => s.trim() === `${K} .live-vote:has(.live-vote__panel-head) > .live-vote__panel`);
  assert.ok(panel, 'the panel is placed');
  assert.equal(declaredValue(panel[1], 'grid-column'), '2', 'in the second column, beside the list');
});
