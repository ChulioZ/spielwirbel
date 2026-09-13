'use strict';

/* The three screens that render game ownership (#971), run for real under jsdom
 * (.claude/rules/testing-views-under-jsdom.md): the add-game sheet's picker and
 * its preselection, the detail page's owner chip, and the setup screen's
 * "hidden because their owners are away" note.
 *
 * Named for what it covers rather than after a module, because `game-owners` is
 * also a lib/ basename (.claude/rules/test-file-names-collide-silently.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { bodyOf } = require('./support/css');

const ANNA = { id: 'm1', name: 'Anna', color: '#c2410c', userId: 'u-anna' };
const BEN = { id: 'm2', name: 'Ben', color: '#1d9e75' };

// Games carry a cover, a range and a tag on purpose: showGameDetail suppresses
// the dashed chips on a "sparse" game and renders the onboarding panel instead.
const game = (over) => ({
  id: 7, title: 'Catan', tagIds: [3], minPlayers: 2, maxPlayers: 4,
  image: '/uploads/catan.jpg', retired: false, completed: false, ...over,
});

const round = (over = {}) => ({
  id: 1, name: 'Donnerstagsrunde', shared: false,
  games: [game()], members: [ANNA, BEN], sessions: [], activity: [],
  tags: [{ id: 3, name: 'Strategie', icon: 'chess' }], providers: [], ...over,
});

async function screen(t, view, data, args, extra = '') {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => data);
  dom.run('window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });');
  if (extra) dom.run(extra);
  await dom.call(view, ...args);
  return dom;
}

// A chip's textContent starts with the avatar's initials, so read the LAST text
// node — the name — rather than the whole chip.
const chipLabels = (root, sel) => [...root.querySelectorAll(sel)]
  .map((c) => (c.lastChild && c.lastChild.textContent ? c.lastChild.textContent : c.textContent).trim());

/* ------------------------------ the add sheet ------------------------------ */

test('the add-game sheet offers one owner chip per member', async (t) => {
  const dom = await screen(t, 'showAddGame', round(), [round()]);
  const field = dom.document.querySelector('#ownerField');
  assert.ok(field, 'the owner field is rendered for a shelf add');
  assert.deepEqual(chipLabels(field, '.chip'), ['Anna', 'Ben']);
});

test('a WISH add offers no owner picker at all', async (t) => {
  const dom = await screen(t, 'showAddGame', round(), [round(), { wish: true }]);
  assert.equal(dom.document.querySelector('#ownerField'), null,
    'the round does not own a wish, so there is nobody to record');
});

// The preselection rule is what makes the picker bearable; without it a shelf
// gets the same chip ticked a hundred times by hand.
test('the picker preselects the stored preset, else the adder\'s own seat', async (t) => {
  const on = (dom) => chipLabels(dom.document, '#ownerField .chip.is-on');

  const own = await screen(t, 'showAddGame', round(), [round()],
    "currentUserId = () => 'u-anna';");
  assert.deepEqual(on(own), ['Anna'], 'no preset yet -> the caller\'s own seat');

  const preset = round({ members: [{ ...ANNA, ownerPreset: [BEN.id] }, BEN] });
  const stored = await screen(t, 'showAddGame', preset, [preset],
    "currentUserId = () => 'u-anna';");
  assert.deepEqual(on(stored), ['Ben'], 'a stored preset wins over the own seat');

  // "I took myself off the list" is a real stored value, not a missing one.
  const emptied = round({ members: [{ ...ANNA, ownerPreset: [] }, BEN] });
  const none = await screen(t, 'showAddGame', emptied, [emptied],
    "currentUserId = () => 'u-anna';");
  assert.deepEqual(on(none), [], 'an EMPTY preset stays empty rather than re-defaulting');

  // No account, or a grantee with no seat: nothing to guess at.
  const anon = await screen(t, 'showAddGame', round(), [round()], 'currentUserId = () => null;');
  assert.deepEqual(on(anon), []);
});

/* ----------------------------- the detail page ----------------------------- */

test('the detail page names the owners, and offers an empty chip otherwise', async (t) => {
  const owned = round({ games: [game({ ownerIds: [ANNA.id, BEN.id] })] });
  const dom = await screen(t, 'showGameDetail', owned, [owned.id, 7]);
  const chips = chipLabels(dom.document.querySelector('#app .gd-chips'), '.tag--custom');
  assert.ok(chips.includes('Gehört Anna, Ben'), `owners named; saw ${JSON.stringify(chips)}`);

  const bare = round();
  const empty = await screen(t, 'showGameDetail', bare, [bare.id, 7]);
  const emptyChips = chipLabels(empty.document.querySelector('#app .gd-chips'), '.tag--custom.tag--empty');
  assert.ok(emptyChips.includes('Besitzer eintragen'), `way in offered; saw ${JSON.stringify(emptyChips)}`);
});

test('a wish shows no owner row on the detail page', async (t) => {
  const wish = round({ games: [game({ wish: true, ownerIds: [ANNA.id] })] });
  const dom = await screen(t, 'showGameDetail', wish, [wish.id, 7]);
  const chips = chipLabels(dom.document.querySelector('#app .gd-chips'), '.tag--custom');
  /* Anti-vacuous, and it earns its place: the chips moved out of the <h1> into
     `.gd-chips` in #1039, and an absence assertion pointed at the old selector
     would have compared two empty lists and passed for every game. */
  assert.ok(chips.length > 0, 'the chip row rendered no chips at all — the selector has stopped matching');
  assert.ok(!chips.some((c) => c.startsWith('Gehört')), `saw ${JSON.stringify(chips)}`);
});

/* ---------------------------- the setup screen ----------------------------- */

// A shelf that silently shrinks when somebody cannot come reads as games having
// gone missing, so the count has to be said out loud.
test('the setup screen counts the games hidden by absent owners', async (t) => {
  // minPlayers 1 on purpose: with only Anna left at the table a 2+ game would
  // drop out on the RANGE clause instead, so the count under test would be 0 for
  // a reason that has nothing to do with owners.
  const data = round({
    games: [
      game({ id: 7, title: 'Catan', minPlayers: 1 }),
      game({ id: 8, title: 'Bens Spiel', minPlayers: 1, ownerIds: [BEN.id] }),
      game({ id: 9, title: 'Bens Zweites', minPlayers: 1, ownerIds: [BEN.id] }),
    ],
  });
  // showStartSession takes the round OBJECT, not an id.
  const dom = await screen(t, 'showStartSession', data, [data]);
  const note = () => dom.document.querySelector('.pool-owners-note').textContent.trim();

  // Everyone joins by default, so Ben is here and nothing is hidden.
  assert.equal(note(), '', 'nothing hidden while every owner is at the table');

  // Drop Ben from the seats; both of his games leave the pool.
  const seats = [...dom.document.querySelectorAll('.nr-seat')];
  const bensSeat = seats.find((s) => s.textContent.includes('Ben'));
  assert.ok(bensSeat, `Ben's seat is on screen; saw ${seats.map((s) => s.textContent.trim())}`);
  bensSeat.click();
  assert.equal(note(), '2 weitere Spiele fehlen, weil ihre Besitzer nicht mitspielen.');
  // …and they really did leave the pool, rather than the note merely appearing.
  assert.equal(dom.document.querySelector('#poolTitle').textContent, '1 Spiel im Topf');
});

/* ---------------------------- the results screen --------------------------- */

// „Gehört Anna" — who has to bring the box. Said only when it is NEWS: a game
// everyone at the table owns needs no line.
async function results(t, data, session) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => data);
  dom.run('window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });');
  const games = data.games.filter((g) => session.gameIds.includes(g.id));
  await dom.call('showFinale', data, session, games);
  // showFinale opens on the sealed stage; the rows only exist after the reveal.
  dom.document.querySelector('.stage__reveal').click();
  await new Promise((r) => setTimeout(r, 50));
  return dom;
}

const SESSION = {
  id: 's1', gameIds: [7], memberIds: ['m1', 'm2'], chosenGameId: 7,
  votes: {}, finished: false, createdAt: '2026-09-08T18:00:00.000Z',
};

test('the results screen names who brings the box, and says nothing when everyone owns it', async (t) => {
  const notes = (dom) => [...dom.document.querySelectorAll('.row-finish__note')].map((n) => n.textContent.trim());

  // Anna owns it, You do not -> the line is worth printing.
  const hers = round({ games: [game({ ownerIds: ['m1'] })] });
  assert.deepEqual(notes(await results(t, hers, SESSION)), ['Gehört Anna']);

  // Everyone at the table owns it -> nothing to say.
  const both = round({ games: [game({ ownerIds: ['m1', 'm2'] })] });
  assert.deepEqual(notes(await results(t, both, SESSION)), []);

  // Nobody recorded -> nothing to say either.
  assert.deepEqual(notes(await results(t, round(), SESSION)), []);
});

// The line is about who has to BRING it, so an owner who stayed home is noise.
test('the line names only the owners actually at the table (#971)', async (t) => {
  const clara = { id: 'm3', name: 'Clara' };
  const data = round({ members: [ANNA, BEN, clara], games: [game({ ownerIds: ['m1', 'm3'] })] });
  const dom = await results(t, data, { ...SESSION, memberIds: ['m1', 'm2'] });
  assert.deepEqual([...dom.document.querySelectorAll('.row-finish__note')].map((n) => n.textContent.trim()),
    ['Gehört Anna'], 'Clara owns it too but is not here, so naming her helps nobody');
});

// A direct pick is not filtered by ownership, so it can legitimately land on a
// game nobody present owns — which is exactly when the line matters most.
test('with no owner at the table the line names every owner (#971)', async (t) => {
  const clara = { id: 'm3', name: 'Clara' };
  const data = round({ members: [ANNA, BEN, clara], games: [game({ ownerIds: ['m3'] })] });
  const dom = await results(t, data, { ...SESSION, memberIds: ['m1', 'm2'] });
  assert.deepEqual([...dom.document.querySelectorAll('.row-finish__note')].map((n) => n.textContent.trim()),
    ['Gehört Clara']);
});

/* ----------------------------- the member page ----------------------------- */

/* „3 Spiele von Anna" (#973) — the fourth reader of `game.ownerIds`, and the
 * only one that asks the question from the PERSON's side rather than the
 * table's. Its whole content is a filter, so the interesting cases are the ones
 * that must NOT appear: the shelf archives, and the wish list. */

async function ownedSection(t, data, mid) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/\/shares$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return data;
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  await dom.call('showMember', data.id, mid);
  const grid = dom.app.querySelector('.member-games');
  return {
    dom,
    grid,
    // The section's own <h2>, not the stats one — scoped through the grid's
    // parent so the rail's headings can never answer instead
    // (.claude/rules/testing-views-under-jsdom.md).
    title: grid ? grid.parentElement.querySelector('h2').textContent : null,
    titles: grid ? [...grid.querySelectorAll('.pool-tile__name')].map((n) => n.textContent) : [],
  };
}

test('the member page lists the shelf games that member owns, titled and linked', async (t) => {
  const data = round({
    games: [
      game({ id: 7, title: 'Catan', ownerIds: [ANNA.id] }),
      game({ id: 8, title: 'Azul', ownerIds: [ANNA.id, BEN.id] }),
      game({ id: 9, title: 'Brass', ownerIds: [BEN.id] }),
    ],
  });
  const { grid, title, titles } = await ownedSection(t, data, ANNA.id);

  // Sorted by title, like the Regal — not in shelf order.
  assert.deepEqual(titles, ['Azul', 'Catan'], 'a game Ben alone owns is not Anna\'s');
  assert.equal(title, '2 Spiele von Anna');

  const tile = grid.querySelector('.pool-tile');
  assert.ok(tile.classList.contains('game-link'), 'each tile must be a real game link');
  assert.match(tile.getAttribute('href') || '', /\/8$/, 'and it points at that game');
});

test('the section is hidden entirely for a member who owns nothing', async (t) => {
  /* Most rounds will never record owners, and an empty „Spiele von …" heading on
     every member page would advertise a feature the round does not use — the
     same call the detail page's expansions section makes on a sparse page. */
  const { grid } = await ownedSection(t, round({ games: [game({ id: 7 })] }), ANNA.id);
  assert.equal(grid, null, 'no owners recorded -> no section at all');

  const others = round({ games: [game({ id: 7, ownerIds: [BEN.id] })] });
  assert.equal((await ownedSection(t, others, ANNA.id)).grid, null,
    'somebody else\'s game does not give Anna an empty section either');
});

test('the singular inflects — one game is not „1 Spiele"', async (t) => {
  const data = round({ games: [game({ id: 7, title: 'Catan', ownerIds: [ANNA.id] })] });
  assert.equal((await ownedSection(t, data, ANNA.id)).title, '1 Spiel von Anna');
});

test('an off-shelf game the member owns is never listed', async (t) => {
  /* `isActiveGame`, the draw pool's own predicate — a retired or completed game
     is off the shelf and a wish is nobody's, so none of the three answers "which
     boxes are Anna's?" (.claude/rules/active-games-filter-sites.md). The fixture
     carries one of each so a filter that is missing AND one that is narrowed to
     a single state both go red. */
  const data = round({
    games: [
      game({ id: 7, title: 'Catan', ownerIds: [ANNA.id], retired: true }),
      game({ id: 8, title: 'Azul', ownerIds: [ANNA.id], completed: true }),
      game({ id: 9, title: 'Brass', ownerIds: [ANNA.id], wish: true }),
      game({ id: 10, title: 'Dune', ownerIds: [ANNA.id] }),
    ],
  });
  const { title, titles } = await ownedSection(t, data, ANNA.id);
  assert.deepEqual(titles, ['Dune']);
  assert.equal(title, '1 Spiel von Anna', 'and the count follows the list rather than the shelf');
});

/* The ranking itself (#1008). A VOTING session has `chosenGameId: null` until
 * somebody taps „Spielen", and renderFinish() returns immediately without one —
 * so at the exact moment the group is deciding, the one screen listing every
 * candidate said nothing at all about who has to bring which box. */

const ranking = (dom) => [...dom.document.querySelectorAll('.trow')].map((row) => {
  const owners = row.querySelector('.trow__owners');
  // `hidden` is how the line stands down on the chosen row, so an element that
  // is present but hidden must read as absent here.
  return [row.querySelector('.trow__title').textContent.trim(),
    owners && !owners.hidden ? owners.textContent.trim() : null];
});

const VOTING = { ...SESSION, gameIds: [7, 8, 9], chosenGameId: null };

const threeGames = (over = {}) => round({
  games: [
    game({ id: 7, title: 'Catan', ownerIds: ['m1'] }),
    game({ id: 8, title: 'Azul', ownerIds: ['m1', 'm2'] }),
    game({ id: 9, title: 'Brass' }),
  ],
  ...over,
});

test('every ranking row names its box-bringer, with no game chosen yet (#1008)', async (t) => {
  const dom = await results(t, threeGames(), VOTING);
  assert.deepEqual(ranking(dom).sort(), [
    ['Azul', null],   // both seats own it — not news
    ['Brass', null],  // nobody recorded — nothing to say
    ['Catan', 'Gehört Anna'],
  ].sort());
});

test('the ranking line is suppressed on the row that IS the chosen game (#1008)', async (t) => {
  /* The chosen row opens its finish panel, which states the same fact with more
     context — printing it twice inside one card is the thing to avoid. */
  const dom = await results(t, threeGames(), { ...VOTING, chosenGameId: 7 });
  const catan = ranking(dom).find(([title]) => title.includes('Catan'));
  assert.equal(catan[1], null, 'the row line stands down for the finish panel');
  assert.deepEqual([...dom.document.querySelectorAll('.row-finish__note')].map((n) => n.textContent.trim()),
    ['Gehört Anna'], 'and the panel still carries it (#971)');
});

test('the owners note costs no layout while it is empty (#1015)', () => {
  /* It is an announced live region, so it must stay in the tree with an empty
     text rather than being removed or `hidden` — a region revealed with its text
     already in place is never announced
     (.claude/rules/accessibility-contrast-and-modals.md §4). That only works if
     the empty node is free, and it was not: with no rule of its own a bare <p>
     kept the UA's 1em margins, so the normal evening — where nobody is away and
     the line says nothing — paid 36px on the screen #1015 exists to shorten.

     A CSS-text assertion because jsdom applies no external stylesheet, which is
     the one layer that can hold this. */
  const empty = bodyOf('.pool-owners-note:empty');
  assert.ok(empty, 'no `.pool-owners-note:empty` rule — the empty status line is back to costing a <p>\'s margins');
  assert.match(empty, /margin:\s*0/);
});
