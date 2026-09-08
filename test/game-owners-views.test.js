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
  const chips = chipLabels(dom.document.querySelector('#app h1'), '.tag--custom');
  assert.ok(chips.includes('Gehört Anna, Ben'), `owners named; saw ${JSON.stringify(chips)}`);

  const bare = round();
  const empty = await screen(t, 'showGameDetail', bare, [bare.id, 7]);
  const emptyChips = chipLabels(empty.document.querySelector('#app h1'), '.tag--custom.tag--empty');
  assert.ok(emptyChips.includes('Besitzer eintragen'), `way in offered; saw ${JSON.stringify(emptyChips)}`);
});

test('a wish shows no owner row on the detail page', async (t) => {
  const wish = round({ games: [game({ wish: true, ownerIds: [ANNA.id] })] });
  const dom = await screen(t, 'showGameDetail', wish, [wish.id, 7]);
  const chips = chipLabels(dom.document.querySelector('#app h1'), '.tag--custom');
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
