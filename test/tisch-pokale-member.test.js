'use strict';

/* Der Tisch composes the lower halves of the Pokale and member screens (#1276,
 * T13.2 and T13.4).
 *
 *   - Pokale: the award plaques move into a column BESIDE the stage. The
 *     markup gains one wrapper, `.pokale-split`, holding the stage (podium +
 *     summary line) and then the plaques — so the plaques follow the podium in
 *     the DOM, which is what a phone shows and what a screen reader reads.
 *   - Member page: an attendance line under the name, and the owned boxes as a
 *     „Gehört <Name>" panel INSIDE the card, beside the two game tiles.
 *
 * Under Klassisch none of that exists, and the first test of each pair pins the
 * Klassisch structure as it was before this change, so a Tisch branch that
 * leaks is red. jsdom applies no stylesheet, so WHERE the column sits (1280px
 * and up) is tisch.css's business; the last test pins that rule as text.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');

const RID = 'r1';
const MEMBERS = [
  { id: 'm1', name: 'Jonas' },
  { id: 'm2', name: 'Lea' },
  { id: 'm3', name: 'Mia' },
];

let seq = 0;
const night = (winnerIds, memberIds, chosen = 'g1') => ({
  id: `s${++seq}`,
  createdAt: `2026-07-${String(seq).padStart(2, '0')}T12:00:00.000Z`,
  gameIds: ['g1', 'g2'],
  memberIds,
  guests: [],
  votes: Object.fromEntries(memberIds.map((m) => [m, { g1: { rating: 4 }, g2: { rating: 2 } }])),
  votedIds: [],
  finished: true,
  cancelled: false,
  done: true,
  winnerIds,
  chosenGameId: chosen,
  events: [],
});

const roundWith = ({ sessions, games } = {}) => ({
  id: RID,
  name: 'Donnerstagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: MEMBERS,
  games: games || [
    { id: 'g1', title: 'Catan', tagIds: [], ownerIds: ['m1'] },
    { id: 'g2', title: 'Azul', tagIds: [], ownerIds: ['m1', 'm2'] },
    { id: 'g3', title: 'Codenames', tagIds: [], ownerIds: ['m2'] },
  ],
  sessions: sessions || [
    night(['m1'], ['m1', 'm2', 'm3']),
    night(['m2'], ['m1', 'm2', 'm3']),
    night(['m1'], ['m2', 'm3']),
  ],
});

function boot(t, design, round) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (new RegExp(`^/api/rounds/${RID}$`).test(url)) return round;
    return {};
  });
  return dom;
}

// Four members with 3/2/1/0 wins, so the fourth stands below the podium on the
// summary line — the stage then holds both of its parts.
const pokaleRound = () => {
  const all = ['m1', 'm2', 'm3', 'm4'];
  const r = roundWith({
    sessions: [['m1'], ['m1'], ['m1'], ['m2'], ['m2'], ['m3']].map((w) => night(w, all)),
  });
  r.members = [...MEMBERS, { id: 'm4', name: 'Ole' }];
  return r;
};

// The first section's direct children, as class lists — the shape a leak
// would change.
const shapeOf = (el) => [...el.children].map((c) => c.className);

// --- Pokale -----------------------------------------------------------------

test('Klassisch: the Pokale section keeps its single column — no split wrapper', (t) => {
  const dom = boot(t, 'klassisch', pokaleRound());
  dom.call('renderPokaleTab', pokaleRound());
  const sec = dom.app.querySelector('.section');
  assert.deepEqual(shapeOf(sec), ['section-head', 'podium', 'muted podium__rest', 'pokale-cards'],
    'the Klassisch Pokale section changed shape');
  assert.equal(dom.app.querySelector('.pokale-split'), null, 'a Tisch wrapper leaked into Klassisch');
});

test('Der Tisch: the plaques sit in the split, AFTER the stage that holds the podium', (t) => {
  const dom = boot(t, 'tisch', pokaleRound());
  dom.call('renderPokaleTab', pokaleRound());
  const sec = dom.app.querySelector('.section');
  assert.deepEqual(shapeOf(sec), ['section-head', 'pokale-split'],
    'the stage and the plaques are not wrapped in one split');
  const split = sec.querySelector('.pokale-split');
  assert.deepEqual(shapeOf(split), ['pokale-split__stage', 'pokale-cards'],
    'the plaques must follow the stage — DOM order is the reading order');
  assert.deepEqual(shapeOf(split.firstElementChild), ['podium', 'muted podium__rest'],
    'the podium and its summary line belong to the stage');
  assert.ok(split.querySelectorAll('.pokale-cards > .pokale-card').length >= 1, 'no plaque rendered');
  // Everything reachable today is still reachable: the Rückblick follows.
  assert.ok(dom.app.querySelector('.section.recap'), 'the Rückblick section went missing');
});

test('Der Tisch: a round with no award yet renders the stage alone in the split', (t) => {
  // One game, played once, no ratings, no streak: no plaque qualifies.
  const round = roundWith({
    games: [{ id: 'g1', title: 'Catan', tagIds: [] }],
    sessions: [{ ...night(['m1'], ['m1', 'm2']), chosenGameId: null, votes: {} }],
  });
  const dom = boot(t, 'tisch', round);
  dom.call('renderPokaleTab', round);
  const split = dom.app.querySelector('.pokale-split');
  assert.ok(split, 'the split is missing');
  assert.deepEqual(shapeOf(split), ['pokale-split__stage'], 'an empty plaque column was rendered');
});

// --- Member page ------------------------------------------------------------

test('Klassisch: the member card and the owned section after it are unchanged', async (t) => {
  const round = roundWith();
  const dom = boot(t, 'klassisch', round);
  await dom.call('showMember', RID, 'm1');
  const card = dom.app.querySelector('.member-card');
  assert.deepEqual(shapeOf(card),
    // #1388 added the earned Abzeichen row under the figures, on purpose.
    ['member-card__mark', 'member-card__id', 'member-card__figures', 'member-card__badges', 'pokale-cards member-card__games', 'member-card__table'],
    'the Klassisch card changed shape');
  assert.deepEqual(shapeOf(card.querySelector('.member-card__who')), ['', 'member-card__state'],
    'something was added under the Klassisch name');
  assert.equal(dom.app.querySelector('.member-card__attendance'), null, 'the attendance line leaked');
  assert.equal(dom.app.querySelector('.member-owned'), null, 'the Tisch owned panel leaked');
  const grid = card.nextElementSibling && card.nextElementSibling.querySelector('.member-games');
  assert.ok(grid, 'the owned-games section no longer follows the card');
  assert.equal(grid.querySelectorAll('.pool-tile').length, 2);
});

test('Der Tisch: the attendance line counts this member\'s finished sessions of the round\'s', async (t) => {
  const round = roundWith();
  const dom = boot(t, 'tisch', round);
  await dom.call('showMember', RID, 'm1');
  const line = dom.app.querySelector('.member-card__who .member-card__attendance');
  assert.ok(line, 'no attendance line under the name');
  assert.equal(line.textContent, '2 von 3 Sessions dabei');
  assert.equal(line.previousElementSibling.tagName, 'H1', 'the line must follow the name');
});

test('Der Tisch: the attendance line takes its plural from the TOTAL', async (t) => {
  const round = roundWith({ sessions: [night(['m1'], ['m1', 'm2'])] });
  const dom = boot(t, 'tisch', round);
  await dom.call('showMember', RID, 'm1');
  assert.equal(dom.app.querySelector('.member-card__attendance').textContent, '1 von 1 Session dabei');
});

test('Der Tisch: „Gehört <Name>" is a panel inside the card, before the two game tiles', async (t) => {
  const round = roundWith();
  const dom = boot(t, 'tisch', round);
  await dom.call('showMember', RID, 'm1');
  const card = dom.app.querySelector('.member-card');
  const lower = card.querySelector(':scope > .member-card__lower');
  assert.ok(lower, 'no lower row inside the card');
  assert.deepEqual(shapeOf(lower), ['member-owned', 'pokale-cards member-card__games'],
    'the owned panel must come first, then the two tiles — kept, not replaced');
  assert.equal(card.querySelector(':scope > .member-card__games'), null, 'the tiles are still a direct child');
  assert.equal(dom.app.querySelector('.member-games'), null, 'the Klassisch owned section rendered too');

  const panel = lower.querySelector('.member-owned');
  assert.equal(panel.querySelector('h2').textContent, '2 Spiele von Jonas');
  const rows = [...panel.querySelectorAll('a.member-owned__row')];
  // Alphabetical, like the Klassisch section: Azul, Catan.
  assert.deepEqual(rows.map((r) => r.querySelector('.member-owned__name').textContent), ['Azul', 'Catan']);
  rows.forEach((r) => {
    assert.ok(r.getAttribute('href'), 'an owned row is not a link');
    assert.ok(r.querySelector('.score-pill'), 'an owned row carries no score pill');
    assert.ok(r.querySelector('.member-owned__cover'), 'an owned row carries no cover');
  });
  // Rated 4 by everyone, so Catan has a real score and Azul (rated 2) too.
  assert.ok(rows.every((r) => !r.querySelector('.score-pill--none')), 'a rated game shows no score');
});

test('Der Tisch: no owned box and no finished session — neither piece renders', async (t) => {
  const round = roundWith({ sessions: [], games: [{ id: 'g1', title: 'Catan', tagIds: [] }] });
  const dom = boot(t, 'tisch', round);
  await dom.call('showMember', RID, 'm1');
  assert.equal(dom.app.querySelector('.member-card__attendance'), null, '„0 von 0" rendered');
  assert.equal(dom.app.querySelector('.member-card__lower'), null, 'an empty owned panel rendered');
  assert.ok(dom.app.querySelector('.member-card > .member-card__games'), 'the tiles lost their place');
});

// --- The stylesheet ---------------------------------------------------------

test('tisch.css sets the plaque column beside the stage only from 1280px, and reorders nothing', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/tisch.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const block = css.match(/@media \(min-width: 1280px\) \{\s*:root\[data-design="tisch"\]\[data-scheme="dark"\] \.pokale-split \{[\s\S]*?\n\}/);
  assert.ok(block, 'no 1280px block lays out .pokale-split');
  assert.match(block[0], /\.pokale-split \{[^}]*display: flex/);
  assert.match(block[0], /\.pokale-split > \.pokale-cards \{[^}]*flex: 0 0 340px/);
  // DOM order = visual order (WCAG 2.4.3): nothing in the split may reorder.
  const splitRules = [...css.matchAll(/([^{}]*\.pokale-split[^{}]*)\{([^{}]*)\}/g)];
  assert.ok(splitRules.length >= 3, 'the split rules were not found');
  splitRules.forEach(([, sel, body]) => {
    assert.doesNotMatch(body, /\border\s*:|flex-direction:\s*row-reverse|grid-(row|column)\s*:/, `${sel.trim()} reorders`);
  });
});
