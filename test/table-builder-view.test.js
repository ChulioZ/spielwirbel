'use strict';

/* The multi-table builder screen, rendered for real (#796).

   The whole value of the screen is the feedback loop: the group moves someone
   and the two numbers under each table move with them. That is only worth
   trusting if the builder scores a hand-made table exactly the way the
   recommendation was scored, and the only way to see it is to render the screen,
   click, and read the DOM back — a regex over the view's source would assert
   the text and not the behaviour
   (.claude/rules/testing-views-under-jsdom.md).

   Run through `vm` rather than `require`, like every other view spec: requiring
   a DOM view file drags its whole body into the coverage report and takes the
   global figure under the 90% floor
   (.claude/rules/frontend-helper-modules-and-coverage.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { RULES } = require('./support/css');

const GAMES = [
  { id: 'g1', title: 'Catan', minPlayers: 2, maxPlayers: 4 },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4 },
  { id: 'g3', title: 'Splendor', minPlayers: 2, maxPlayers: 4 },
];
const NAMES = ['Anna', 'Ben', 'Dana', 'Eli', 'Frida', 'Georg'];
const MEMBERS = NAMES.map((name, i) => ({ id: 'm' + i, name }));

// Everyone loves g1 and g2; Ben (m1) rates g2 a 1, which is a tier-1 violation
// wherever he ends up seated at it.
const VOTES = {};
MEMBERS.forEach((m) => {
  VOTES[m.id] = { g1: { rating: 4 }, g2: { rating: 4 }, g3: { rating: 4 } };
});
VOTES.m1.g2 = { rating: 1 };

const round = (over = {}) => ({
  id: 7,
  name: 'Donnerstagsrunde',
  members: MEMBERS,
  games: GAMES,
  sessions: [],
  tags: [],
  ...over,
});

const parentSession = (over = {}) => ({
  id: 's1',
  createdAt: '2026-08-20T18:00:00.000Z',
  memberIds: MEMBERS.map((m) => m.id),
  gameIds: ['g1', 'g2', 'g3'],
  votes: VOTES,
  multiTable: true,
  done: true,
  finished: false,
  cancelled: false,
  chosenGameId: null,
  winnerIds: [],
  events: [],
  ...over,
});

// Two tables of three: Anna/Ben/Dana at Catan, the rest at Azul.
const PROPOSALS = [
  {
    tables: [
      { gameId: 'g1', personIds: ['m0', 'm1', 'm2'] },
      { gameId: 'g2', personIds: ['m3', 'm4', 'm5'] },
    ],
  },
  {
    tables: [
      { gameId: 'g1', personIds: ['m0', 'm1', 'm2'] },
      { gameId: 'g2', personIds: ['m3', 'm4', 'm5'] },
      { gameId: 'g3', personIds: [] },
    ],
  },
];

async function builder(t, { proposals = [PROPOSALS[0]], session = parentSession(), rnd = round() } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const calls = [];
  dom.set('api', async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.endsWith('/tables')) return { proposals };
    return {};
  });
  dom.set('toast', () => {});
  dom.set('showRound', () => {});
  dom.set('fetchRoundFresh', async () => rnd);
  dom.set('roundCan', () => true);
  await dom.call('showTableBuilder', rnd, session, GAMES);
  return { dom, calls };
}

const cards = (dom) => [...dom.app.querySelectorAll('.tables-card')];
const seatsOf = (card) => [...card.querySelectorAll('.tables-seat')].map((el) => el.textContent.trim());
const metaOf = (card) => card.querySelector('.tables-card__meta').textContent.replace(/\s+/g, ' ').trim();

test('the builder renders one card per table, with its game and its people', async (t) => {
  const { dom, calls } = await builder(t);
  assert.equal(calls[0].path, '/api/rounds/7/sessions/s1/tables');
  const [a, b] = cards(dom);
  assert.equal(cards(dom).length, 2);
  assert.equal(a.querySelector('select').value, 'g1');
  assert.deepEqual(seatsOf(a), ['Anna', 'Ben', 'Dana']);
  assert.deepEqual(seatsOf(b), ['Eli', 'Frida', 'Georg']);
  // No aggregate score anywhere: a number nobody can reconstruct invites arguing
  // about the formula instead of about the evening.
  assert.equal(dom.app.textContent.includes('Score'), false);
});

test('the two numbers under a table are computed over the SEATED only', async (t) => {
  const { dom } = await builder(t);
  const [a, b] = cards(dom);
  assert.match(metaOf(a), /Ø 4,0/);
  assert.match(metaOf(a), /Niedrigste 4/);
  assert.match(metaOf(b), /Ø 4,0/);
  // Ben's 1 is on g2, and nobody is seated at g2 who gave it — so it does not
  // appear anywhere yet.
  assert.equal(dom.app.querySelector('.tables-notice').textContent.trim(), '');
});

test('moving a party rescores both tables live and names the unhappy seating', async (t) => {
  const { dom } = await builder(t);
  const before = cards(dom);
  // Pick Ben up …
  before[0].querySelectorAll('.tables-seat')[1].click();
  // … and drop him at the second table, which is playing the game he rated 1.
  const held = cards(dom);
  assert.equal(held[0].querySelectorAll('.tables-seat')[1].getAttribute('aria-pressed'), 'true');
  held[1].querySelector('.tables-card__drop').click();

  const [a, b] = cards(dom);
  assert.deepEqual(seatsOf(a), ['Anna', 'Dana']);
  assert.deepEqual(seatsOf(b), ['Eli', 'Frida', 'Georg', 'Ben']);
  // 4+4+4+1 over four people.
  assert.match(metaOf(b), /Ø 3,3/);
  assert.match(metaOf(b), /Niedrigste 1/);
  assert.match(dom.app.querySelector('.tables-notice').textContent, /Ben.*Azul/);
  assert.ok(b.querySelector('.tables-seat.is-hurt'), 'the chip to move is findable without reading the list');
});

test('a table below the floor blocks the confirm and says why', async (t) => {
  const { dom } = await builder(t);
  const confirm = dom.app.querySelector('.toolbar .btn--primary');
  assert.equal(confirm.disabled, false);

  cards(dom)[0].querySelectorAll('.tables-seat')[0].click();
  cards(dom)[1].querySelector('.tables-card__drop').click();

  const [a, b] = cards(dom);
  assert.ok(a.classList.contains('is-invalid'));
  assert.match(a.querySelector('.tables-card__warn').textContent, /Mindestens 3/);
  // Four at a 2-4 game is fine, so only the emptied table is flagged.
  assert.equal(b.classList.contains('is-invalid'), false);
  assert.equal(dom.app.querySelector('.toolbar .btn--primary').disabled, true);
});

test('a game archived since the draw is refused here, not only by the server', async (t) => {
  /* The confirm route drops it through `isActiveGame`, so a builder that still
     offered it would leave the group with a dead button and an untranslated
     `unknown_game` for an explanation. It stays SELECTED (or the control would
     show a title the table does not hold) but is out of every other table's
     picker, and the confirm is blocked. */
  const rnd = round({ games: [{ ...GAMES[0], retired: true }, GAMES[1], GAMES[2]] });
  const { dom } = await builder(t, { rnd });
  const [a, b] = cards(dom);
  assert.ok(a.classList.contains('is-invalid'));
  assert.match(a.querySelector('.tables-card__warn').textContent, /nicht mehr im Regal/);
  assert.equal(dom.app.querySelector('.toolbar .btn--primary').disabled, true);

  assert.deepEqual([...a.querySelectorAll('option')].map((o) => o.value), ['g1', 'g2', 'g3']);
  assert.equal(a.querySelector('select').value, 'g1', 'the table still holds it, so it still shows it');
  assert.deepEqual([...b.querySelectorAll('option')].map((o) => o.value), ['g2', 'g3']);
});

test('picking a game another table holds SWAPS them rather than duplicating a box', async (t) => {
  const { dom } = await builder(t);
  const select = cards(dom)[0].querySelector('select');
  select.value = 'g2';
  select.dispatchEvent(new dom.window.Event('change'));
  const [a, b] = cards(dom);
  assert.equal(a.querySelector('select').value, 'g2');
  assert.equal(b.querySelector('select').value, 'g1', 'two tables cannot play one box at once');
});

test('the table-count control selects among the STORED proposals', async (t) => {
  const { dom, calls } = await builder(t, { proposals: PROPOSALS });
  const chips = [...dom.app.querySelectorAll('.filter-chips .chip')];
  assert.deepEqual(chips.map((c) => c.textContent.trim()), ['2 Tische', '3 Tische']);
  assert.equal(chips[0].classList.contains('is-on'), true, 'the fewest tables is the default');
  chips[1].click();
  assert.equal(cards(dom).length, 3);
  // Selecting a different count must not recompute anything — the whole point of
  // persisting them is that the answer cannot move under the group.
  assert.equal(calls.filter((c) => c.path.endsWith('/tables')).length, 1);
});

test('confirming posts the tables as flat person lists', async (t) => {
  const { dom, calls } = await builder(t);
  dom.app.querySelector('.toolbar .btn--primary').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const split = calls.find((c) => c.path.endsWith('/split'));
  assert.ok(split, 'the confirm reached the split route');
  assert.deepEqual(JSON.parse(JSON.stringify(split.body)), {
    tables: [
      { gameId: 'g1', personIds: ['m0', 'm1', 'm2'] },
      { gameId: 'g2', personIds: ['m3', 'm4', 'm5'] },
    ],
  });
});

test('with no feasible split the screen says so and offers the plain result', async (t) => {
  const { dom } = await builder(t, { proposals: [] });
  assert.equal(cards(dom).length, 0);
  assert.match(dom.app.textContent, /keine zwei Tische/);
  assert.ok(dom.app.querySelector('.toolbar .btn--ghost'), 'the evening is not stranded');
});

test('once confirmed the screen becomes a summary of the tables', async (t) => {
  const children = [
    { id: 'c1', createdAt: 'x', memberIds: ['m0', 'm1', 'm2'], gameIds: ['g1'], votes: {}, chosenGameId: 'g1', done: true, finished: true, parentSessionId: 's1', winnerIds: [], events: [] },
    { id: 'c2', createdAt: 'x', memberIds: ['m3', 'm4', 'm5'], gameIds: ['g2'], votes: {}, chosenGameId: 'g2', done: true, finished: false, parentSessionId: 's1', winnerIds: [], events: [] },
  ];
  const session = parentSession({ childSessionIds: ['c1', 'c2', 'gone'] });
  const rnd = round({ sessions: [session, ...children] });
  const { dom, calls } = await builder(t, { session, rnd });

  assert.equal(calls.length, 0, 'a finished split asks the server for nothing');
  assert.equal(dom.app.querySelector('.page-head h1').textContent, 'Die Tische',
    'nothing is being built any more, so the heading must not still say so');
  assert.match(dom.app.textContent, /Aufgeteilt auf 2 Tische/);
  const list = cards(dom);
  // The third stored id resolves to nothing — a deleted table — and is dropped
  // rather than rendered as a ghost.
  assert.equal(list.length, 2);
  assert.match(list[0].textContent, /Catan/);
  assert.match(list[0].textContent, /Anna, Ben, Dana/);
  assert.equal(list[0].getAttribute('href'), '/round/7/session/c1');
  assert.match(list[1].textContent, /Läuft noch/);
});

/* ---- The trap only a screenshot showed ---- */

test('every cover placeholder the builder draws sits in a POSITIONED box', async (t) => {
  /* `.cover-ph` is `position: absolute; inset: 0`, so without a positioned
     ancestor it escapes to the initial containing block and covers the ENTIRE
     viewport. Found on the browser pass of #796 with the tile at 44x44 and every
     DOM probe healthy — the box really was fine; it was the child that got away,
     and only the screenshot showed it (the lesson in
     .claude/rules/label-rows-lose-to-field-label.md).

     Asserted over the RENDERED tree rather than against a hand-kept list of host
     classes, so a card that grows a second cover is covered without editing
     this. jsdom applies no stylesheet, so the parent's rule is looked up in
     styles.css by hand (.claude/rules/testing-views-under-jsdom.md). */
  const positions = (cls) => RULES
    .filter(([sel]) => sel.split(',').map((x) => x.trim()).includes('.' + cls))
    .some(([, body]) => /position:\s*relative/.test(body));

  const seen = [];
  for (const dom of [await builder(t), await builder(t, {
    session: parentSession({ childSessionIds: ['c1'] }),
    rnd: round({ sessions: [{ id: 'c1', createdAt: 'x', memberIds: ['m0'], gameIds: ['g1'], votes: {}, chosenGameId: 'g1', done: true, finished: true, parentSessionId: 's1', winnerIds: [], events: [] }] }),
  })]) {
    for (const ph of dom.dom.app.querySelectorAll('.cover-ph')) {
      const host = ph.parentElement;
      seen.push(host.className);
      assert.ok(
        [...host.classList].some(positions),
        `.cover-ph inside .${host.className} — no ancestor rule declares position: relative, so it will cover the viewport`
      );
    }
  }
  assert.ok(seen.length >= 2, `expected placeholders on both states, saw ${seen.length}`);
});

test('the average pill is un-absoluted for its inline row', async (t) => {
  /* `.score-pill` is a BADGE over a game tile — `position: absolute; top/right`.
     Used inline it flies to the page's top-right corner and vanishes behind the
     top bar while `textContent` still reads "Ø 4,0", so every DOM probe agrees
     it is fine. Four other inline contexts already carry the same override; this
     is the fifth. jsdom applies no stylesheet, so it is asserted over the sheet
     (.claude/rules/css-text-assertions-strip-comments.md). */
  const { dom } = await builder(t);
  assert.ok(dom.app.querySelector('.tables-card__meta .score-pill'), 'the row really does use the pill');
  const rule = RULES.find(([sel]) => sel === '.tables-card__meta .score-pill');
  assert.ok(rule, 'no rule un-absolutes the pill inside the meta row');
  assert.match(rule[1], /position:\s*static/);
});
