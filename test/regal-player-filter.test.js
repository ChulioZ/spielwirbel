'use strict';

/* The Regal's player-count filter (#1667): „what plays solo?" / „what do we have
 * for six?" asked of the shelf, through the one filter panel (#827/#844).
 *
 * The predicate is unit-tested in test/player-filter.test.js. What only a
 * rendered screen can show is whether the CONTROL is wired to it: a section on
 * a shelf that declares no player counts (it could never narrow anything), an
 * applied chip whose × leaves the grid filtered, a badge that misses it, or the
 * section leaking onto the session setup screen, which takes its count from
 * the people seated. */

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { filterPanelKit } = require('./support/filter-panel');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
const { trigger, openPanel, closePanel, appliedChips, triggerLabel } = filterPanelKit(dom);
beforeEach(() => closePanel());

const GAMES = [
  { id: 'g1', title: 'Arche Nova', minPlayers: 1, maxPlayers: 4 },
  { id: 'g2', title: 'Catan', minPlayers: 3, maxPlayers: 4,
    expansions: [{ id: 'e1', title: 'Seefahrer 5–6', minPlayers: 5, maxPlayers: 6 }] },
  { id: 'g3', title: 'Codenames', minPlayers: 2, maxPlayers: 8 },
  { id: 'g4', title: 'Handgeschrieben' },
];

let rid = 0;
const roundFixture = (over = {}) => ({
  id: `pf-${++rid}`,
  name: 'Freitagsrunde',
  members: [{ id: 'm1', name: 'Anna' }],
  tags: [],
  sessions: [],
  games: GAMES.map((g) => ({ ...g })),
  ...over,
});

const regal = (over) => {
  dom.app.innerHTML = '';
  const r = roundFixture(over);
  dom.call('renderRegalTab', r, r.games);
  return r;
};
const shelved = () =>
  [...dom.app.querySelectorAll('.game-card__title')].map((el) => el.textContent).sort();
const section = () => dom.document.querySelector('.fpanel__group--players');
const chips = () => [...section().querySelectorAll('.chip')];
const chip = (label) => chips().find((c) => c.textContent.trim() === label);
const pressed = () => chips().filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.textContent.trim());

test('Regal: the Personen section offers 1 … 8+ and nothing is pressed', () => {
  regal();
  assert.ok(trigger(), 'a shelf with player counts alone is enough to offer the panel');
  openPanel();
  assert.ok(section(), 'the Personen section is missing from the Regal panel');
  assert.equal(section().querySelector('.field__label').textContent, 'Personen');
  assert.deepEqual(chips().map((c) => c.textContent.trim()), ['1', '2', '3', '4', '5', '6', '7', '8+']);
  assert.deepEqual(pressed(), []);
  assert.equal(section().querySelector('[role="group"]').getAttribute('aria-labelledby'),
    section().querySelector('.field__label').id, 'the chip row is named by its label');
});

test('Regal: picking a count filters by the draw rule — expansions widen, unknown stays in', () => {
  regal();
  openPanel();
  chip('1').click();
  assert.deepEqual(pressed(), ['1']);
  assert.deepEqual(shelved(), ['Arche Nova', 'Handgeschrieben']);
  assert.deepEqual(appliedChips(), ['Solo']);

  chip('6').click();
  assert.deepEqual(pressed(), ['6'], 'one count, not a range: a second pick replaces the first');
  assert.deepEqual(shelved(), ['Catan', 'Codenames', 'Handgeschrieben'],
    'Catan seats six only through its owned 5–6 extension');
  assert.deepEqual(appliedChips(), ['6 Personen']);

  chip('8+').click();
  assert.deepEqual(shelved(), ['Codenames', 'Handgeschrieben']);
  assert.deepEqual(appliedChips(), ['ab 8 Personen']);
  assert.equal(triggerLabel(), 'Filter (1 aktiv)', 'the count joins the trigger\'s badge');

  chip('8+').click();
  assert.deepEqual(pressed(), [], 'tapping the pressed count clears it');
  assert.equal(shelved().length, 4);
});

test('Regal: the applied chip removes the count and un-presses the chip', () => {
  regal();
  openPanel();
  chip('4').click();
  assert.deepEqual(shelved(), ['Arche Nova', 'Catan', 'Codenames', 'Handgeschrieben']);
  chip('5').click();
  assert.deepEqual(shelved(), ['Catan', 'Codenames', 'Handgeschrieben']);

  dom.document.querySelector('.fbar__chips .fchip__x').click();
  assert.deepEqual(appliedChips(), []);
  assert.equal(shelved().length, 4);
  assert.deepEqual(pressed(), [], 'the open panel follows the chip that just vanished');
});

test('Regal: the count sits after owners and before the BGG facts, and ANDs with tags', () => {
  regal({
    tags: [{ id: 't1', name: 'Kenner' }],
    games: GAMES.map((g) => ({
      ...g,
      tagIds: g.id === 'g1' || g.id === 'g3' ? ['t1'] : [],
      ownerIds: g.id === 'g1' ? ['m1'] : undefined,
      weight: 2.5,
    })),
  });
  const body = openPanel();
  const sections = [...body.querySelectorAll('.fpanel__body > *')].map((el) => el.className);
  assert.deepEqual(sections, ['fpanel__group', 'fpanel__group fpanel__group--owners',
    'fpanel__group fpanel__group--players', 'mfilter']);
  body.querySelector('.fpanel__group .filter-chips .chip').click();
  chip('5').click();
  assert.deepEqual(shelved(), ['Codenames'], 'Kenner AND seats five');
  assert.deepEqual(appliedChips(), ['Kenner', '5 Personen'], 'tags first, then the count');
});

test('Regal: NO Personen section when no game declares a player count', () => {
  regal({
    tags: [{ id: 't1', name: 'Kenner' }],
    games: [{ id: 'x', title: 'Azul' }, { id: 'y', title: 'Uno' }],
  });
  openPanel();
  assert.equal(section(), null, 'a control that could never narrow the shelf');
});

test('Regal: switching rounds resets the count with everything else', () => {
  regal();
  openPanel();
  chip('1').click();
  closePanel();
  regal();
  assert.deepEqual(appliedChips(), []);
  assert.equal(shelved().length, 4);
});

test('Regal: the count survives a re-render of the same round', () => {
  const r = regal();
  openPanel();
  chip('1').click();
  closePanel();
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', r, r.games);
  assert.deepEqual(appliedChips(), ['Solo']);
  assert.deepEqual(shelved(), ['Arche Nova', 'Handgeschrieben']);
});

test('Regal: a count left over on a shelf that no longer declares any hides nothing', () => {
  const r = regal({ games: [...GAMES, { id: 'g5', title: 'Uno' }].map((g) => ({ ...g })) });
  openPanel();
  chip('1').click();
  closePanel();
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', r, r.games.filter((g) => g.id === 'g4' || g.id === 'g5'));
  assert.deepEqual(appliedChips(), [], 'no chip for a section that is not offered');
  assert.deepEqual(shelved(), ['Handgeschrieben', 'Uno'], 'every game passes: none declares a count');
});

test('the session setup screen does NOT get the Personen section', async () => {
  // Its count comes from the people seated (#1667 out of scope).
  await dom.call('showStartSession', roundFixture({ tags: [{ id: 't1', name: 'Kenner' }] }));
  openPanel();
  assert.ok(dom.document.querySelector('.fpanel__group'), 'the tag section is there');
  assert.equal(section(), null, 'the Personen section leaked onto the setup screen');
});

test('Der Tisch: the lifted trigger opens a panel carrying the Personen section', () => {
  dom.run('applyDesign("tisch")');
  try {
    regal();
    openPanel();
    chip('1').click();
    assert.deepEqual(shelved(), ['Arche Nova', 'Handgeschrieben']);
    assert.equal(dom.app.querySelector('.fbar__count').textContent, '1');
  } finally {
    closePanel();
    dom.run('applyDesign("klassisch")');
  }
});
