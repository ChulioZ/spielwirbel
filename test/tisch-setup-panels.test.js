'use strict';

/* Der Tisch's session setup as the sheet's two panels (#1267 — T4.1 at 1440,
 * T2.3 at 390), with the round rail kept on the screen.
 *
 * The view is RUN through the jsdom harness under BOTH designs
 * (.claude/rules/testing-views-under-jsdom.md):
 *
 *  - Klassisch must render exactly what it rendered before #1267. The first
 *    test pins a structural fingerprint of the whole screen — every element's
 *    tag, id, class and ARIA state in document order — taken from origin/main
 *    before this change. A design branch that leaks into the default path
 *    changes it, whatever it changes.
 *  - Der Tisch renders the two panels, the rail, the step line, the seat state
 *    lines and the draw summary — and keeps every control reachable.
 *
 * jsdom applies no stylesheet, so nothing here proves the panels sit side by
 * side; that was measured in the browser (see the PR). What it proves is the
 * structure and reading order the layout rests on.
 *
 * Named for the design and the slice, colliding with no module basename
 * (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { loadApp, flush } = require('./support/dom');
const { contrast, token, rgb } = require('./support/theme');
const { designById } = require('../public/js/designs');

const TISCH = designById('tisch');

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }];
// Ranges wide enough that the player count decides nothing; one box owned by
// Clara so the owners line has something to say once she is unseated.
const GAMES = [
  { id: 'g1', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
  { id: 'g2', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
  { id: 'g3', title: 'Dixit', minPlayers: 1, maxPlayers: 8, ownerIds: ['m3'] },
  { id: 'g4', title: 'Just One', minPlayers: 1, maxPlayers: 8 },
];
const roundFixture = () => ({
  id: 'r1',
  name: 'Freitagsrunde',
  members: MEMBERS.map((m) => ({ ...m })),
  tags: [],
  sessions: [],
  games: GAMES.map((g) => ({ ...g })),
});

async function setup(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => false);
  dom.set('showSessionLobby', () => {});
  dom.set('toast', () => {});
  dom.call('applyDesign', design);
  await dom.call('showStartSession', roundFixture());
  await flush();
  return dom;
}

const q = (dom, sel) => dom.app.querySelector(sel);
const qa = (dom, sel) => [...dom.app.querySelectorAll(sel)];
const seat = (dom, name) => qa(dom, '.nr-seat').find((s) => s.textContent.includes(name));

// Every element in #app, in document order: what a design branch would have to
// change to change the screen. Inline styles and text are left out on purpose —
// the seat ring's `left/top` are arithmetic, and copy is i18n's business.
const fingerprint = (dom) => [...dom.app.querySelectorAll('*')].map((el) => [
  el.tagName,
  el.id,
  el.getAttribute('class') || '',
  ['role', 'aria-labelledby', 'aria-label', 'aria-pressed', 'aria-expanded', 'aria-live', 'hidden', 'for']
    .map((a) => (el.hasAttribute(a) ? `${a}=${el.getAttribute(a)}` : '')).join(','),
].join('|')).join('\n');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/* ------------------------------- Klassisch -------------------------------- */

test('Klassisch renders exactly the setup it rendered before #1267', async (t) => {
  const dom = await setup(t, 'klassisch');
  // Taken from origin/main (6b42bc1) with this very fixture, before any #1267
  // edit. If this moves, the Klassisch screen moved — find out why before
  // updating it.
  assert.equal(sha(fingerprint(dom)), 'b164e497d444db90');

  // …and the parts #1267 touches, spelled out so a failure names them.
  assert.deepEqual([...dom.app.children].map((c) => c.className), ['page-head', 'setup-grid setup-grid--session']);
  assert.equal(q(dom, '.rail'), null, 'Klassisch has no rail on the setup screen');
  assert.equal(q(dom, '#seatsLabel').tagName, 'DIV');
  assert.equal(q(dom, '#poolTitle').tagName, 'H2');
  assert.equal(qa(dom, '.nr-seat__state').length, 0, 'the state lines are Der Tisch\'s only');
  assert.equal(seat(dom, 'Anna').getAttribute('aria-label'), null);
  const bar = q(dom, '.setup-bar');
  assert.deepEqual([...bar.children].map((c) => c.id || c.className), ['setup-bar__count', 'barSummary', 'go']);
  assert.equal(q(dom, '#barSummary').textContent, '3 spielen mit · 4 Spiele im Topf');
});

/* -------------------------------- Der Tisch -------------------------------- */

test('Der Tisch keeps the rail on the setup screen, with no section marked current', async (t) => {
  const dom = await setup(t, 'tisch');
  const rail = dom.app.firstElementChild;
  assert.ok(rail.matches('aside.rail'), 'the rail is not the column\'s first child');
  // The setup belongs to no section, so every row is a live link — and there is
  // no second <h1>: the page's own heading stays the only one.
  assert.equal(rail.querySelectorAll('[aria-current]').length, 0);
  assert.equal(rail.querySelectorAll('.is-active').length, 0);
  assert.equal(dom.app.querySelectorAll('h1').length, 1);
});

test('Der Tisch lays the setup out as two headed panels in reading order', async (t) => {
  const dom = await setup(t, 'tisch');
  const [seats, pot] = qa(dom, '.tisch-setup__panel');
  assert.ok(seats && pot, 'expected two panels');

  // „Wer spielt mit?" heads the seats and still labels the seat group.
  const seatsTitle = seats.querySelector('h2#seatsLabel');
  assert.equal(seatsTitle.textContent, 'Wer spielt mit?');
  assert.equal(q(dom, '.nr-seats').getAttribute('aria-labelledby'), 'seatsLabel');
  assert.equal(seats.querySelector('.tisch-setup__sub').textContent, 'Platz antippen = mitspielen');
  assert.ok(seats.querySelector('.setup-addons'), 'the three exception chips left the seats panel');

  // „Der Topf" is a section headed by its own <h2>, with the count beside it
  // and every pool piece inside, in the order they stood.
  assert.equal(pot.tagName, 'SECTION');
  assert.equal(pot.getAttribute('aria-labelledby'), 'potHeading');
  assert.equal(pot.querySelector('#potHeading').textContent, 'Der Topf');
  assert.equal(pot.querySelector('.tisch-setup__head #poolTitle').textContent.replace(/\s+/g, ' ').trim(), '4 Spiele im Topf');
  assert.deepEqual(
    [...pot.children].map((c) => c.id || c.className),
    ['tisch-setup__head', 'setup-filterbar', 'setup-panel', 'poolReset', 'muted pool-owners-note'],
  );
  assert.equal(pot.querySelectorAll('h2').length, 1, 'the count must not be a second heading in the pot');

  // DOM order = visual order: seats, pot, then the bar — and in the bar the
  // summary FOLLOWS the button, which is where T2.3 prints it.
  const order = [seats, pot, q(dom, '.setup-bar')];
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1].compareDocumentPosition(order[i]) & 4, 'the panels are out of reading order');
  }
  assert.deepEqual([...q(dom, '.setup-bar').children].map((c) => c.id || c.className), ['setup-bar__count', 'go', 'barSummary']);

  // The date line heads the page — the date alone. The sheet's „Schritt 1 von 3"
  // counter was dropped (operator, 2026-09-24): no later screen continues it,
  // and the vote card's own „Spiel 2 von 3" would read as its step 2.
  assert.match(q(dom, '.page-head .tisch-setup__step').textContent, /^\S+, \d\d\.\d\d\.$/);
});

test('each seat states its state in words, and its accessible name carries it', async (t) => {
  const dom = await setup(t, 'tisch');
  const anna = seat(dom, 'Anna');
  assert.equal(anna.querySelector('.nr-seat__state').textContent, 'spielt mit');
  assert.equal(anna.getAttribute('aria-label'), 'Anna, spielt mit');
  assert.ok(anna.querySelector('.nr-seat__tick'), 'a seated person carries the tick');

  anna.click();
  const out = seat(dom, 'Anna');
  assert.equal(out.getAttribute('aria-pressed'), 'false');
  assert.equal(out.querySelector('.nr-seat__state').textContent, 'heute nicht dabei');
  assert.equal(out.getAttribute('aria-label'), 'Anna, heute nicht dabei');
  assert.equal(out.querySelector('.nr-seat__tick'), null);
  // The guest seat is not a person with a state.
  assert.equal(q(dom, '.nr-seat--add .nr-seat__state'), null);
});

test('the summary says how many of the pot get drawn, and follows the count and the seats', async (t) => {
  const dom = await setup(t, 'tisch');
  const summary = () => q(dom, '#barSummary').textContent;
  assert.equal(summary(), '3 spielen mit · 3 von 4 Spielen werden gezogen');

  q(dom, '.stepper__btn[data-d="1"]').click();
  assert.equal(summary(), '3 spielen mit · 4 von 4 Spielen werden gezogen');
  // Past the pot the number clamps: the draw cannot take games that are not in it.
  q(dom, '.stepper__btn[data-d="1"]').click();
  assert.equal(summary(), '3 spielen mit · 4 von 4 Spielen werden gezogen');

  // Typing moves it too.
  const input = q(dom, '#count');
  input.value = '1';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(summary(), '3 spielen mit · 1 von 4 Spielen wird gezogen');

  // Clara owns Dixit: unseating her shrinks the pot and says why.
  seat(dom, 'Clara').click();
  assert.equal(summary(), '2 spielen mit · 1 von 3 Spielen wird gezogen');
  assert.match(q(dom, '.tisch-pot .pool-owners-note').textContent, /^1 weiteres Spiel fehlt/);
});

test('under the rail, a re-render re-reads the round instead of redrawing a stale one', async (t) => {
  const dom = await setup(t, 'tisch');
  let fetched = 0;
  dom.set('fetchRoundFresh', async () => { fetched++; return { ...roundFixture(), name: 'Umbenannt' }; });
  await dom.run('currentView()');
  await flush();
  assert.equal(fetched, 1, 'the rail\'s rename/„+" would redraw the setup from the stale snapshot');
  assert.equal(q(dom, '.rail__name').textContent.trim(), 'Umbenannt');
});

test('every control Klassisch offers on the setup is still in Der Tisch\'s DOM', async (t) => {
  const dom = await setup(t, 'klassisch');
  // Ids ending in a counter (`seatGuestAdd3`, `addonBody2`) are minted per
  // render, so a second render in the same document numbers them afresh.
  const ids = qa(dom, '[id]').map((el) => el.id).filter((id) => !/\d$/.test(id)).sort();
  assert.ok(ids.length >= 8, `only ${ids.length} ids to compare — did the Klassisch render run?`);
  const buttons = qa(dom, 'button').length;
  dom.call('applyDesign', 'tisch');
  await dom.call('showStartSession', roundFixture());
  await flush();
  const tischIds = new Set(qa(dom, '[id]').map((el) => el.id));
  for (const id of ids) assert.ok(tischIds.has(id), `#${id} is gone under Der Tisch`);
  // The rail adds buttons (rename, „+"); none of the setup's may be lost.
  assert.ok(qa(dom, '.setup-grid button').length >= buttons, 'a setup control went missing under Der Tisch');
});

/* -------------------------------- contrast -------------------------------- */

test('the seat state line, the tick and the quiet heading text clear their floors on Der Tisch', () => {
  // The in-seat's --control-fill and the out-seat's (transparent → panel)
  // --surface are the two grounds a state line and a name can sit on; the step
  // line sits on the page itself.
  const pairs = [
    ['--ink-soft', '--control-fill', 4.5],
    ['--ink-soft', '--surface', 4.5],
    ['--ink', '--control-fill', 4.5],
    ['--ink', '--surface', 4.5],
    ['--gold', '--control-fill', 3],
  ];
  for (const [ink, ground, floor] of pairs) {
    const ratio = contrast(token(ink, TISCH), token(ground, TISCH));
    assert.ok(ratio >= floor, `${ink} on ${ground} measures ${ratio.toFixed(2)}:1 (floor ${floor})`);
  }
  const onPage = contrast(token('--ink-soft', TISCH), rgb(TISCH.page));
  assert.ok(onPage >= 4.5, `the step line measures ${onPage.toFixed(2)}:1 on the page (floor 4.5)`);
});
