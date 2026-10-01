'use strict';

/* The Regal's owner filter (#1433): „which of Anna's games haven't we played in
 * a while?" asked of the shelf, through the one filter panel (#827/#844).
 *
 * The pure halves — the gate, the options, the any-of predicate — are unit-
 * tested in test/owner-picker.test.js. What only a rendered screen can show is
 * whether the CONTROL is wired to them: a section offered on a shelf nobody
 * marked (it could only empty the shelf), an applied chip whose × leaves the
 * grid filtered, or the section leaking onto the session setup screen, whose
 * pool is already owner-aware through the table. */

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { filterPanelKit } = require('./support/filter-panel');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
const { trigger, openPanel, closePanel, appliedChips, triggerLabel } = filterPanelKit(dom);
beforeEach(() => closePanel());

// Mixed on purpose: one game per owner, one with two owners, one with none.
const GAMES = [
  { id: 'g1', title: 'Azul', ownerIds: ['m1'] },
  { id: 'g2', title: 'Catan', ownerIds: ['m2'] },
  { id: 'g3', title: 'Gloomhaven', ownerIds: ['m1', 'm2'] },
  { id: 'g4', title: 'Ohne Besitz' },
];

let rid = 0;
const roundFixture = (over = {}) => ({
  id: `of-${++rid}`,
  name: 'Freitagsrunde',
  // Cleo owns nothing on this shelf, so she is not offered.
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Cleo' }],
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
const ownerSection = () => dom.document.querySelector('.fpanel__group--owners');
// The chip's text also carries the avatar's initials, so read the name alone.
const chipName = (c) => c.lastChild.textContent.trim();
const ownerChip = (name) =>
  [...ownerSection().querySelectorAll('.chip')].find((c) => chipName(c) === name);

test('Regal: the owner section lists the members who own a shelf game', () => {
  regal();
  assert.ok(trigger(), 'a marked shelf alone is enough to offer the panel');
  openPanel();
  const section = ownerSection();
  assert.ok(section, 'the owner section is missing from the Regal panel');
  assert.equal(section.querySelector('.field__label').textContent, 'Besitzer');
  assert.deepEqual([...section.querySelectorAll('.chip')].map(chipName), ['Anna', 'Ben']);
  assert.ok([...section.querySelectorAll('.chip')].every((c) => c.getAttribute('aria-pressed') === 'false'));
});

test('Regal: picking owners filters by ANY of them, and unowned games drop out', () => {
  regal();
  openPanel();
  ownerChip('Anna').click();
  assert.equal(ownerChip('Anna').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(shelved(), ['Azul', 'Gloomhaven']);
  assert.deepEqual(appliedChips(), ['Gehört Anna']);

  ownerChip('Ben').click();
  assert.deepEqual(shelved(), ['Azul', 'Catan', 'Gloomhaven'],
    'a second owner WIDENS — any picked member owning it is enough; the unowned game stays out');
  assert.deepEqual(appliedChips(), ['Gehört Anna', 'Gehört Ben']);
  assert.equal(triggerLabel(), 'Filter (2 aktiv)');

  ownerChip('Anna').click();
  assert.deepEqual(shelved(), ['Catan', 'Gloomhaven'], 'un-picking takes the owner back out');
});

test('Regal: an applied owner chip removes its filter and un-presses the chip', () => {
  regal();
  openPanel();
  ownerChip('Ben').click();
  assert.deepEqual(shelved(), ['Catan', 'Gloomhaven']);

  dom.document.querySelector('.fbar__chips .fchip__x').click();
  assert.deepEqual(appliedChips(), []);
  assert.deepEqual(shelved(), ['Azul', 'Catan', 'Gloomhaven', 'Ohne Besitz']);
  assert.equal(ownerChip('Ben').getAttribute('aria-pressed'), 'false',
    'the open panel follows the chip that just vanished');
});

test('Regal: the owner filter ANDs with the tag filter', () => {
  regal({
    tags: [{ id: 't1', name: 'Kenner' }],
    games: GAMES.map((g) => ({ ...g, tagIds: g.id === 'g3' || g.id === 'g2' ? ['t1'] : [] })),
  });
  const body = openPanel();
  body.querySelector('.fpanel__group .filter-chips .chip').click();
  ownerChip('Anna').click();
  assert.deepEqual(shelved(), ['Gloomhaven']);
  assert.deepEqual(appliedChips(), ['Kenner', 'Gehört Anna'], 'tags first, then owners — the panel order');
  const sections = [...body.querySelectorAll('.fpanel__body > *')].map((el) => el.className);
  assert.deepEqual(sections, ['fpanel__group', 'fpanel__group fpanel__group--owners']);
});

test('Regal: NO owner section when nobody is marked on the shelf', () => {
  regal({
    tags: [{ id: 't1', name: 'Kenner' }],
    games: [{ id: 'x', title: 'Azul', ownerIds: [] }, { id: 'y', title: 'Uno' }],
  });
  openPanel();
  assert.equal(ownerSection(), null, 'a control that could only empty the shelf');
});

test('Regal: an unmarked shelf with no tags and no metadata still gets no panel', () => {
  regal({ games: [{ id: 'x', title: 'Azul' }] });
  assert.equal(trigger(), null);
});

test('Regal: switching rounds resets the owner pick with everything else', () => {
  regal();
  openPanel();
  ownerChip('Anna').click();
  assert.deepEqual(appliedChips(), ['Gehört Anna']);
  closePanel();

  regal();
  assert.deepEqual(appliedChips(), []);
  assert.deepEqual(shelved(), ['Azul', 'Catan', 'Gloomhaven', 'Ohne Besitz']);
});

test('Regal: the owner pick survives a re-render of the same round', () => {
  const r = regal();
  openPanel();
  ownerChip('Ben').click();
  closePanel();

  dom.app.innerHTML = '';
  dom.call('renderRegalTab', r, r.games);
  assert.deepEqual(appliedChips(), ['Gehört Ben']);
  assert.deepEqual(shelved(), ['Catan', 'Gloomhaven']);
});

test('Regal: a picked owner whose last game left the shelf is dropped, not kept as a dead filter', () => {
  const r = regal();
  openPanel();
  ownerChip('Anna').click();
  closePanel();

  const rest = r.games.filter((g) => g.id === 'g2');
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', r, rest);
  assert.deepEqual(appliedChips(), []);
  assert.deepEqual(shelved(), ['Catan']);
});

test('the session setup screen does NOT get the owner section', async () => {
  // Its pool is already owner-aware through the table (#1002); a second owner
  // control there would ask the same question twice.
  await dom.call('showStartSession', roundFixture({
    tags: [{ id: 't1', name: 'Kenner' }],
  }));
  openPanel();
  assert.ok(dom.document.querySelector('.fpanel__group'), 'the tag section is there');
  assert.equal(ownerSection(), null, 'the owner section leaked onto the setup screen');
});

test('Der Tisch: the lifted trigger still opens a panel carrying the owner section', () => {
  dom.run('applyDesign("tisch")');
  try {
    regal();
    assert.ok(dom.app.querySelector('.section-tools .fbar__trigger'), 'the trigger sits in the toolbar');
    openPanel();
    ownerChip('Anna').click();
    assert.deepEqual(shelved(), ['Azul', 'Gloomhaven']);
    assert.equal(dom.app.querySelector('.fbar__count').textContent, '1');
  } finally {
    closePanel();
    dom.run('applyDesign("klassisch")');
  }
});
