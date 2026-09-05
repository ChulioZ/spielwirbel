'use strict';

/* The vote card keeps focus across its own re-render (#667).

   Rating a game replaces the whole card (`app.innerHTML = ''`), so without the
   restoration this file guards, a keyboard voter is dropped back on <body> and
   has to Tab through the card again — once per game, per person, on the app's
   central action. Nothing else can see it: the rebuilt DOM is correct, the
   aria-pressed state is right, and no other test goes red.

   `document.activeElement` is exactly the observable a regex over the view
   source cannot reach, so this runs the real view through the jsdom harness
   (`.claude/rules/testing-views-under-jsdom.md`). jsdom is also the RIGHT place
   for it: the Claude Code Browser pane's `document.hasFocus()` is permanently
   false and it dispatches no blur at all
   (`.claude/rules/blur-events-never-fire-in-the-preview-pane.md`), while jsdom
   tracks activeElement properly. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

const MEMBER = { id: 'm1', name: 'Anna', color: '#7f77dd' };
const GUEST = { id: 'g-1', name: 'Lea', guest: true };

function roundFixture() {
  return {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    members: [MEMBER],
    games: [],
    sessions: [],
  };
}

const GAMES = [
  { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4 },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4 },
];

function sessionFixture() {
  return {
    id: 's1',
    createdAt: '2026-08-06T18:00:00.000Z',
    gameIds: ['g1', 'g2'],
    memberIds: ['m1'],
    votes: {},
    votedIds: [],
    done: false,
    cancelled: false,
    finished: false,
    winnerIds: [],
    chosenGameId: null,
  };
}

/** Render the wizard straight onto the first vote card, as `person`. */
async function voteCard(t, person = MEMBER) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => roundFixture());
  await dom.call('startVoting', roundFixture(), sessionFixture(), GAMES, [person], {
    skipIntro: true,
    saveVotes: async () => {},
    onSaved: async () => {},
  });
  return dom;
}

const moods = (dom) => [...dom.app.querySelectorAll('.rating .mood')];
const active = (dom) => dom.document.activeElement;

// ------------------------------------------------------- the re-render path

test('rating a game leaves focus on that rating in the rebuilt card', async (t) => {
  const dom = await voteCard(t);
  const before = moods(dom);
  // Five tiles, one per rating (#909 removed the sixth, #797's trash zero).
  assert.equal(before.length, 5, 'expected the five mood faces and nothing else');

  before[3].click(); // rating 4

  const after = moods(dom);
  assert.notEqual(after[3], before[3], 'the card should have been rebuilt, not patched');
  assert.equal(active(dom), after[3], 'focus fell off the rating that was just activated');
  // The restored control is the SELECTED one — i.e. focus tracks the choice,
  // not a fixed position in the row.
  assert.equal(after[3].getAttribute('aria-pressed'), 'true');
});

test('re-rating moves focus to the newly chosen face', async (t) => {
  const dom = await voteCard(t);
  moods(dom)[3].click();
  moods(dom)[0].click(); // change of mind: rating 1

  const after = moods(dom);
  assert.equal(active(dom), after[0]);
  assert.equal(after[0].getAttribute('aria-pressed'), 'true');
  assert.equal(after[3].getAttribute('aria-pressed'), 'false');
});

/* The scale is the same five tiles for everybody since #909, which is what
   removed the guest/member branch from this card entirely. Between #797 and
   then a member saw a sixth, leading trash tile — and before #797 that was a
   separate `.sortBtn` below the row with its own `{ kind: 'sort' }` focus
   branch. Both are gone; asserting their absence is what stops either coming
   back unnoticed. */
test('a member and a guest get the identical five-tile scale', async (t) => {
  const member = await voteCard(t);
  assert.equal(moods(member).length, 5);
  assert.equal(member.app.querySelector('.sortBtn'), null, 'no separate retire control');
  assert.equal(member.app.querySelector('.mood--retire'), null, 'no trash tile');
  const memberLabels = moods(member).map((b) => b.getAttribute('aria-label'));

  const guest = await voteCard(t, GUEST);
  assert.equal(guest.app.querySelector('.mood--retire'), null);
  assert.deepEqual(moods(guest).map((b) => b.getAttribute('aria-label')), memberLabels,
    'a guest card must be indistinguishable from a member one');
});

test('a guest card restores rating focus like a member one', async (t) => {
  const dom = await voteCard(t, GUEST);
  const tiles = moods(dom);
  tiles[2].click();
  assert.equal(active(dom), moods(dom)[2]);
});

test('re-picking clears the previous face rather than adding to it', async (t) => {
  const dom = await voteCard(t);
  moods(dom)[0].click();
  moods(dom)[2].click(); // rating 3

  const after = moods(dom);
  assert.equal(after[0].getAttribute('aria-pressed'), 'false', 'the 1 stayed pressed');
  assert.equal(after[2].getAttribute('aria-pressed'), 'true');
  assert.equal(active(dom), after[2]);
});

// ------------------------------------------------- arriving on a fresh step

/* The other half of the feature, and the half that would be a regression if it
   broke: only the two in-place handlers may move focus. A step arriving through
   go() or a Back must leave it alone, or every forward navigation yanks the
   user into the middle of the card. */

test('advancing to the next game does not pull focus into the rating row', async (t) => {
  const dom = await voteCard(t);
  moods(dom)[4].click(); // focus is now on a rating…
  dom.app.querySelector('#nextBtn').click(); // …and we leave for game 2

  assert.equal(dom.app.querySelector('.vote__title').textContent, 'Azul', 'expected the second game');
  assert.ok(
    !moods(dom).includes(active(dom)),
    'arriving on a fresh card must not focus a rating'
  );
  assert.equal(active(dom), dom.document.body);
});

test('going Back to the previous game does not pull focus into the rating row', async (t) => {
  const dom = await voteCard(t);
  moods(dom)[4].click();
  dom.app.querySelector('#nextBtn').click();

  // jsdom queues the traversal, so a bare tick is not enough — wait on the real
  // popstate (the router's own listener is registered first, at load time) and
  // then let its handler finish on the next macrotask.
  await new Promise((resolve) => {
    dom.window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true });
    dom.window.history.back();
  });

  assert.equal(dom.app.querySelector('.vote__title').textContent, 'Catan', 'expected to be back on game 1');
  assert.ok(
    !moods(dom).includes(active(dom)),
    'a Back must not focus a rating'
  );
});

// A language switch re-runs the current step through `currentView` — the third
// caller of render(), and the one most easily forgotten, because it is neither
// a tap nor a navigation.
test('switching the language does not pull focus into the rating row', async (t) => {
  const dom = await voteCard(t);
  moods(dom)[4].click();

  dom.run('setLocale("en"); currentView();');

  assert.equal(dom.app.querySelector('.vote__q').textContent.trim(), 'How much would you like to play this?');
  assert.ok(
    !moods(dom).includes(active(dom)),
    'a language switch must not focus a rating'
  );
});
