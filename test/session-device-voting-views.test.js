'use strict';

/* Per-device voting (#209), the two screens: the setup toggle that opens a
   session to other devices, and the lobby that replaces the hot-seat wizard
   while it is running.

   Rendered for real through the jsdom harness rather than regex-matched over the
   view source (.claude/rules/testing-views-under-jsdom.md), because what matters
   here is state-dependent: the toggle has to DISABLE itself when nobody could
   use it, and the lobby has to offer a different set of actions depending on who
   is looking at it. A source regex cannot see either. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

const ME = 'user-me';
const FRIEND = 'user-friend';

// Two linked seats and one name-only seat: the mixed round the feature is for.
function roundFixture(over = {}) {
  return {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    members: [
      { id: 'm1', name: 'Anna', userId: ME },
      { id: 'm2', name: 'Ben', userId: FRIEND },
      { id: 'm3', name: 'Chris' },
    ],
    games: [
      { id: 'g1', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
    ],
    sessions: [],
    ...over,
  };
}

function sessionFixture(over = {}) {
  return {
    id: 's1',
    createdAt: '2026-08-02T18:00:00.000Z',
    gameIds: ['g1', 'g2'],
    memberIds: ['m1', 'm2', 'm3'],
    votes: {},
    votedIds: [],
    deviceVoting: true,
    done: false,
    cancelled: false,
    finished: false,
    winnerIds: [],
    chosenGameId: null,
    ...over,
  };
}

/** Render the lobby as `userId` (null = logged out / no linked seat). */
async function lobby(t, { round = roundFixture(), session = sessionFixture(), userId = ME } = {}) {
  const dom = loadApp();
  t.after(() => dom.close());
  // The poll would otherwise reach the harness's rejecting fetch after 5s.
  dom.set('api', async () => round);
  dom.set('isLoggedIn', () => !!userId);
  dom.set('currentUserId', () => userId);
  await dom.call('showSessionLobby', round, session);
  return dom;
}

/** Render the session-setup screen as `userId`. */
async function setup(t, { round = roundFixture(), userId = ME, loggedIn = true } = {}) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => round);
  dom.set('isLoggedIn', () => loggedIn);
  dom.set('currentUserId', () => userId);
  await dom.call('showStartSession', round);
  return dom;
}

const textOf = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);

// ---------------------------------------------------------------- the lobby

test('the lobby lists every participant with their vote state', async (t) => {
  const dom = await lobby(t, { session: sessionFixture({ votedIds: ['m2'] }) });
  const chips = [...dom.app.querySelectorAll('.live-person')];
  assert.equal(chips.length, 3);
  assert.deepEqual(
    chips.map((c) => textOf(c.querySelector('.live-person__name'))),
    ['Anna', 'Ben', 'Chris']
  );
  // Ben has voted, the other two have not — and only Ben's chip is marked.
  assert.deepEqual(
    chips.map((c) => c.classList.contains('is-voted')),
    [false, true, false]
  );
});

// The whole reason the payload is redacted server-side: this screen exists to
// show progress, and it must be able to do that without a single rating on it.
test('the lobby renders who has voted and no vote values at all', async (t) => {
  const session = sessionFixture({ votedIds: ['m1', 'm2'] });
  const dom = await lobby(t, { session });
  const html = dom.app.innerHTML;
  for (const face of ['ti-mood-cry', 'ti-mood-sad', 'ti-mood-neutral', 'ti-mood-smile', 'ti-mood-crazy-happy']) {
    assert.equal(html.includes(face), false, `the lobby must not render a rating control (${face})`);
  }
  assert.equal(dom.app.querySelectorAll('.live-person.is-voted').length, 2);
});

test('your own unused seat leads with a vote button', async (t) => {
  const dom = await lobby(t);
  const mine = dom.app.querySelector('.live-vote__mine');
  assert.ok(mine, 'expected a "vote now" button for my own seat');
  assert.match(textOf(mine), /Jetzt abstimmen/);
});

test('once you have voted the button is gone and the wait is stated', async (t) => {
  const dom = await lobby(t, { session: sessionFixture({ votedIds: ['m1'] }) });
  assert.equal(dom.app.querySelector('.live-vote__mine'), null);
  assert.match(textOf(dom.app.querySelector('.live-vote__done')), /Deine Stimme ist da/);
});

// Holding no seat is normal, not an error: someone can have round access
// without sitting at this session's table.
test('with no linked seat the lobby offers no personal vote button', async (t) => {
  const dom = await lobby(t, { userId: 'user-stranger' });
  assert.equal(dom.app.querySelector('.live-vote__mine'), null);
  assert.equal(dom.app.querySelector('.live-vote__done'), null);
  // …but the hot-seat path is still fully there.
  assert.equal(dom.app.querySelectorAll('.live-vote__hotseat-btn').length, 3);
});

// The mixed evening: name-only members and anyone in the room vote on this
// device. The hot-seat path must never be degraded by per-device voting.
test('every person still open can be voted for on this device', async (t) => {
  const dom = await lobby(t, { session: sessionFixture({ votedIds: ['m2'] }) });
  // Ben has voted; Anna is my own seat and is offered by the button above, so
  // the hot-seat list is exactly the people neither of those covers. Listing my
  // own seat here too would put me on the screen twice for the same action.
  // Each button carries the person's avatar initials before the label, so match
  // the label at the end rather than pinning the whole string.
  const btns = [...dom.app.querySelectorAll('.live-vote__hotseat-btn')];
  assert.equal(btns.length, 1);
  assert.match(textOf(btns[0]), /Für Chris$/);
  assert.ok(dom.app.querySelector('.live-vote__mine'), 'my own seat is offered by the primary button');
});

// The line claims a state, so it must stop being shown once that state passes —
// otherwise "waiting for the others" sits directly above the button that ends
// the voting, with nobody left to wait for.
test('the waiting line disappears once the last vote is in', async (t) => {
  const dom = await lobby(t, { session: sessionFixture({ votedIds: ['m1', 'm2', 'm3'] }) });
  assert.equal(dom.app.querySelector('.live-vote__done'), null);
  assert.equal(dom.app.querySelector('.live-vote__mine'), null);
});

test('nobody left to wait for makes ending the vote the primary action', async (t) => {
  const waiting = await lobby(t, { session: sessionFixture({ votedIds: ['m1'] }) });
  assert.equal(waiting.app.querySelector('.live-vote__close').classList.contains('btn--primary'), false);

  const ready = await lobby(t, { session: sessionFixture({ votedIds: ['m1', 'm2', 'm3'] }) });
  assert.equal(ready.app.querySelector('.live-vote__close').classList.contains('btn--primary'), true);
  assert.equal(ready.app.querySelectorAll('.live-vote__hotseat-btn').length, 0);
});

// Anyone with round access can close, so a dead starting device never strands
// the session — the button is there even for someone holding no seat.
test('the close button is offered to everyone, seat or not', async (t) => {
  const dom = await lobby(t, { userId: 'user-stranger' });
  assert.ok(dom.app.querySelector('.live-vote__close'));
});

// ------------------------------------------------------------ the setup toggle

test('the toggle is enabled and names who could vote remotely', async (t) => {
  const dom = await setup(t);
  const box = dom.app.querySelector('#deviceVoting');
  assert.ok(box, 'expected the per-device toggle to render');
  assert.equal(box.disabled, false);
  // Ben is linked and is not me; Anna is my own seat, Chris is name-only.
  assert.match(textOf(dom.app.querySelector('.device-vote__note')), /Ben/);
  assert.equal(dom.app.querySelector('.device-vote').classList.contains('is-disabled'), false);
});

// The gate: with no OTHER linked seat there is nothing to distribute, because
// the only linked person is already holding this device.
test('the toggle disables itself when nobody else is linked', async (t) => {
  const round = roundFixture({
    members: [{ id: 'm1', name: 'Anna', userId: ME }, { id: 'm2', name: 'Ben' }],
  });
  const dom = await setup(t, { round });
  const box = dom.app.querySelector('#deviceVoting');
  assert.equal(box.disabled, true);
  assert.equal(dom.app.querySelector('.device-vote').classList.contains('is-disabled'), true);
});

// The wording is the scope constraint made testable: the disabled state states
// a fact about this session, never that the round is missing something.
test('the disabled note describes the session, not a deficiency', async (t) => {
  const round = roundFixture({ members: [{ id: 'm1', name: 'Anna', userId: ME }] });
  const dom = await setup(t, { round });
  const note = textOf(dom.app.querySelector('.device-vote__note'));
  assert.match(note, /niemand mit einem Konto verknüpft/);
  for (const word of ['noch', 'registrier', 'Registrier']) {
    assert.equal(note.includes(word), false, `the note must not read as "not yet" / a call to register (${word})`);
  }
});

// A password-only instance has no accounts at all, so the control could never
// become usable there — a permanently dead switch is worse than none.
test('a logged-out (accounts-off) instance renders no toggle at all', async (t) => {
  const dom = await setup(t, { userId: null, loggedIn: false });
  assert.equal(dom.app.querySelector('#deviceVoting'), null);
  assert.equal(dom.app.querySelector('.device-vote'), null);
});

// The one that fails silently: a box left CHECKED while becoming disabled would
// submit deviceVoting for a session in which nobody can vote remotely, opening a
// lobby with no way into it.
test('deselecting the last remote voter unchecks the armed toggle', async (t) => {
  const dom = await setup(t);
  const box = dom.app.querySelector('#deviceVoting');
  box.checked = true;
  assert.equal(box.disabled, false);

  // Take Ben — the only other linked member — out of the session.
  const ben = [...dom.app.querySelectorAll('.nr-seat')].find((s) => s.getAttribute('title') === 'Ben');
  assert.ok(ben, 'expected a seat for Ben');
  ben.click();

  const after = dom.app.querySelector('#deviceVoting');
  assert.equal(after.disabled, true);
  assert.equal(after.checked, false, 'an unusable toggle must not stay armed');
});
