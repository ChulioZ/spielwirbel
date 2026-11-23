'use strict';

/* Der Tisch COMPOSES the round hub (#1262 desktop, #1263 phone) — T2.1, T2.2
 * and T3.2 as the sheets draw them: the seats captioned with a name, a win
 * count and a crown; hero, CTA and the one chip row gathered on one band; and a
 * rail reduced to identity plus five links. (The Rundenpuls tiles, the preview
 * row and the „Nicht im Regal" tiles left the Start tab in #1853.)
 *
 * Every one of those is a markup branch on designIs('tisch'), so the spec runs
 * the real showRound twice — once under Klassisch, asserting the structure it
 * has always had, and once under Der Tisch, asserting the new one. The CSS half
 * (which widths show which presentation) is jsdom-invisible
 * (.claude/rules/testing-views-under-jsdom.md) and is pinned as text at the end.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

const game = (id, extra = {}) => ({
  id, title: 'Spiel ' + id, minPlayers: 2, maxPlayers: 4,
  createdAt: '2026-01-0' + (id % 9 + 1) + 'T10:00:00.000Z', ...extra,
});
const play = (id, gid, when, winnerIds) => ({
  id, createdAt: when, done: true, finished: true,
  gameIds: [gid], chosenGameId: gid, winnerIds, memberIds: ['m1', 'm2', 'm3'],
  votes: { m1: { [gid]: { rating: 5 } }, m2: { [gid]: { rating: 4 } } },
});

/* Anna wins twice and leads alone, Ben once, Cem never — so one seat is
   crowned, two are badged and one carries neither. Eight games on the shelf
   (the Regal preview needs more than its six-cover strip), one in each
   off-shelf list, and three evenings inside the last twelve months (the
   Rundenpuls needs two). */
const busyRound = () => ({
  id: 'r1',
  name: 'Freitagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Cem' }],
  games: [
    // Half the shelf fits an hour, so the „Unter 60 Min" preset has something to narrow.
    ...Array.from({ length: 8 }, (_, i) => game(10 + i, { minPlaytime: 30, maxPlaytime: i % 2 ? 45 : 120 })),
    game(30, { retired: true }),
    game(31, { completed: true }),
    game(32, { wish: true }),
  ],
  sessions: [
    play(900, 10, ago(40), ['m1']),
    play(901, 11, ago(20), ['m1']),
    play(902, 12, ago(5), ['m2']),
  ],
  tags: [],
});

async function hub(t, design, round = busyRound()) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async (method, url) => (/recommendations/.test(url) ? { recommendations: [] } : round));
  await dom.call('showRound', round.id, 'start');
  return dom;
}

// Children of #app that belong to the Start tab, not to the rail or the dock.
const pane = (dom) => [...dom.app.children].filter((el) => !el.matches('.rail, .dock'));

// ------------------------------------------------------------- Klassisch

test('Klassisch keeps its hub shape: no band, rail-owned CTA and its one chip row, no preview, no list group (#1853)', async (t) => {
  const dom = await hub(t, null);
  const kids = pane(dom);
  assert.equal(dom.app.querySelector('.hub-stage'), null, 'Klassisch grew the Tisch band');
  // The hero, the CTA and the chip row are direct children of #app, in that
  // order, and the two controls are rail-owned — the rail carries their copies.
  const hero = kids.find((el) => el.matches('.hero'));
  const cta = kids.find((el) => el.matches('.hub-cta'));
  const presets = kids.find((el) => el.matches('.hub-presets'));
  assert.ok(hero && cta && presets, 'hero, CTA or presets left #app');
  assert.ok(kids.indexOf(hero) < kids.indexOf(cta) && kids.indexOf(cta) < kids.indexOf(presets));
  assert.ok(cta.classList.contains('rail-owned') && presets.classList.contains('rail-owned'),
    'the Klassisch CTA/presets stopped being rail-owned — they would show twice beside the rail');

  assert.equal(dom.app.querySelectorAll('.seat__cap, .seat__wins, .seat__crown').length, 0,
    'Klassisch seats grew captions');
  assert.equal(dom.app.querySelector('.hero__members .avatar').title, 'Anna');
  assert.equal(dom.app.querySelector('.pulse-bars, .pulse-tiles, .hub-preview, .hub-offshelf'), null,
    'a pulse, a preview or „Weitere Listen" is back on the Start tab');

  const rail = dom.app.querySelector('.rail');
  assert.ok(rail.querySelector('.rail__cta'), 'the Klassisch rail lost its CTA');
  assert.ok(rail.querySelector('.hub-presets > .hub-preset--direct:first-child'), 'the Klassisch rail lost its chip row');
  assert.equal(rail.querySelectorAll('.rail__item').length, 5,
    'the Klassisch rail is Start, the three sections and Einstellungen — no list group (#1853)');
  assert.equal(rail.querySelector('.rail__chips, .rail__offshelf, .rail__play'), null);
});

// ------------------------------------------------------------- Der Tisch

test('Der Tisch gathers hero, CTA and presets on one band, in phone order, rail-owned on none of the controls', async (t) => {
  const dom = await hub(t, 'tisch');
  const stage = dom.app.querySelector('.hub-stage');
  assert.ok(stage, 'no band under Der Tisch');
  assert.ok(pane(dom).includes(stage), 'the band must be a direct child of #app, where the cap lift names it');
  const kids = [...stage.children];
  assert.deepEqual(kids.map((el) => (el.classList[0] === 'btn' ? 'hub-cta' : el.classList[0])),
    ['hero', 'hub-say', 'hub-cta', 'hub-presets'],
    'the band is hero → the sentence (#1854) → CTA → the one chip row (#1853), the phone reading order');
  assert.ok(!stage.querySelector('.hub-cta').classList.contains('rail-owned'),
    'the CTA is still rail-owned — it would vanish at 1280 with no rail copy to replace it');
  assert.ok(!stage.querySelector('.hub-presets').classList.contains('rail-owned'));
  // The hero keeps its heading: the band carries no second <h1> at any width.
  assert.equal(stage.querySelectorAll('h1').length, 1);
});

test('Der Tisch captions every seat, badges the wins and crowns the leader from the standings', async (t) => {
  const dom = await hub(t, 'tisch');
  const seats = [...dom.app.querySelectorAll('.hero__members > a.avatar')];
  assert.deepEqual(seats.map((s) => s.querySelector('.seat__cap').textContent), ['Anna', 'Ben', 'Cem']);
  assert.deepEqual(seats.map((s) => (s.querySelector('.seat__wins') || {}).textContent || null), ['2', '1', null],
    'win badges disagree with the Pokale — or a zero was badged');
  assert.deepEqual(seats.map((s) => !!s.querySelector('.seat__crown')), [true, false, false],
    'only the leader wears the crown');
  assert.equal(seats[0].title, 'Anna · 2 Siege', 'the count must reach the seat title, not only the aria-hidden badge');
  assert.ok(seats.every((s) => [...s.querySelectorAll('.seat__wins, .seat__crown')]
    .every((el) => el.getAttribute('aria-hidden') === 'true')));
  const add = dom.app.querySelector('.hero__members > .avatar--add');
  assert.equal(add.querySelector('.seat__cap').textContent, dom.run("t('hub.seat.add')"));
});

test('Der Tisch reduces the rail to identity and the five links', async (t) => {
  const dom = await hub(t, 'tisch');
  const rail = dom.app.querySelector('.rail');
  assert.equal(rail.querySelector('.rail__cta'), null, 'the rail still carries a second CTA');
  assert.equal(rail.querySelector('.hub-presets'), null, 'the rail still carries a second preset row');
  assert.deepEqual([...rail.querySelectorAll('.rail__item')].map((el) => el.getAttribute('href').split('/').pop()),
    ['r1', 'regal', 'chronik', 'pokale', 'settings']);
  assert.ok(rail.querySelector('h1.rail__name'), 'the Start tab lost its one heading');
});

test('the Regal reaches the off-shelf lists through its strip in Klassisch and Der Tisch alike (#1500)', async (t) => {
  for (const design of [null, 'tisch']) {
    const round = busyRound();
    const dom = loadApp({ locale: 'de' });
    t.after(() => dom.close());
    if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
    dom.set('api', async () => round);
    await dom.call('showRound', round.id, 'regal');
    const nav = dom.app.querySelector('nav.offshelf-seg');
    assert.ok(nav, `no scope strip on the Regal (${design || 'klassisch'})`);
    // Never rail-owned: it is the Regal's only way onto the lists at any width.
    assert.equal(nav.classList.contains('rail-owned'), false);
    assert.equal(nav.querySelector('[aria-current="page"]').dataset.sub, 'regal');
  }
});

// ------------------------------------------------------------- the CSS half

const SHEET = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const DESKTOP = (() => {
  const at = SHEET.indexOf('@media (min-width: 1280px) {\n  :root[data-design="tisch"] .app > .hub-stage');
  assert.ok(at !== -1, 'the hub desktop block moved — re-point this spec');
  return SHEET.slice(at, SHEET.indexOf('\n}\n', at));
})();

test('from 1280 the band is the felt, the cap is lifted for the hub blocks, and the grid is three wide', () => {
  const rules = rulesOf(DESKTOP.replace(/@media[^{]+\{/, ''));
  const body = (needle) => rules.filter(([s]) => s.includes(needle)).map(([, b]) => b).join('\n');
  for (const sel of ['.hub-stage', '.hub-cards', '.ticket']) {
    assert.ok(rules.some(([s, b]) => s.includes(`.app > ${sel}`) && /max-width:\s*none/.test(b)),
      `${sel} keeps the reading-measure cap at 1280`);
  }
  assert.match(body('.hub-stage'), /var\(--marker,\s*var\(--felt\)\)/, 'the band is not the felt');
  assert.match(SHEET, /@media \(min-width: 1280px\) \{\s*:root\[data-design="tisch"\] \.hub-cards \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/,
    'the desktop grid is not three wide');
});

/* #1496: the row grid stretches each slot to its row, and the card fills its
   slot — otherwise a short card beside a tall one left a hole under it that
   the next row's card then sat below. The selector is a top-level rule, so it
   applies at every width the grid has more than one track. */
test('a hub card fills its slot, so a short card beside a tall one leaves no hole (#1496)', () => {
  const rules = rulesOf(SHEET.replace(/\/\*[\s\S]*?\*\//g, ''));
  const slot = rules.find(([s]) => s.trim() === ':root[data-design="tisch"] .hub-cards > .card-slot');
  assert.ok(slot, 'no rule for the Tisch card slot');
  assert.match(slot[1], /display:\s*flex/);
  assert.match(slot[1], /flex-direction:\s*column/);
  const card = rules.find(([s]) => s.trim() === ':root[data-design="tisch"] .hub-cards > .card-slot > :only-child');
  assert.ok(card, 'the card does not fill its slot');
  assert.match(card[1], /flex:\s*1\b/);
});
