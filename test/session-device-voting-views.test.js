'use strict';

/* The voting lobby (#209, made universal in #655) — the screen every session
   lands on after the draw.

   Rendered for real through the jsdom harness rather than regex-matched over the
   view source (.claude/rules/testing-views-under-jsdom.md), because what matters
   here is state-dependent: the lobby offers a different set of actions depending
   on who is looking at it and on whether this device just handed a vote on. A
   source regex cannot see either.

   The setup toggle this file used to cover as well went away with #655. */

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
    done: false,
    cancelled: false,
    finished: false,
    winnerIds: [],
    chosenGameId: null,
    ...over,
  };
}

/** Render the lobby as `userId` (null = logged out / no linked seat). */
async function lobby(t, { round = roundFixture(), session = sessionFixture(), userId = ME, handedOn = false } = {}) {
  const dom = loadApp();
  t.after(() => dom.close());
  // The poll would otherwise reach the harness's rejecting fetch after 5s.
  dom.set('api', async () => round);
  dom.set('isLoggedIn', () => !!userId);
  dom.set('currentUserId', () => userId);
  await dom.call('showSessionLobby', round, session, handedOn);
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

// ------------------------------------------------------------ the activity log

const LOG_EVENTS = [
  { at: '2026-08-02T18:00:00.000Z', type: 'started', actor: 'm1' },
  { at: '2026-08-02T18:05:00.000Z', type: 'voted', actor: 'm1', personId: 'm1' },
  { at: '2026-08-02T18:07:00.000Z', type: 'voted', actor: 'm1', personId: 'm3' },
  { at: '2026-08-02T18:09:00.000Z', type: 'voted', actor: 'm2', personId: 'm2' },
];

test('the lobby shows what has happened so far', async (t) => {
  const dom = await lobby(t, { session: sessionFixture({ events: LOG_EVENTS, votedIds: ['m1', 'm2', 'm3'] }) });
  const rows = [...dom.app.querySelectorAll('.session-log__row .session-log__what')].map(textOf);
  // Newest first: on a running session the latest line is the one being waited
  // for, so it must not be at the bottom of a list that grows all evening.
  assert.deepEqual(rows, [
    // Ben's came from Ben's own account…
    'Ben hat abgestimmt',
    // …while Anna submitted Chris's column.
    'Anna hat für Chris abgestimmt',
    'Anna hat abgestimmt',
    'Anna hat die Session gestartet',
  ]);
});

// It is a record, not a live surface — the timestamps are what let someone
// reconstruct the evening, so each row must carry one.
test('every log row carries a timestamp', async (t) => {
  const dom = await lobby(t, { session: sessionFixture({ events: LOG_EVENTS }) });
  const stamps = [...dom.app.querySelectorAll('.session-log__when')].map(textOf);
  assert.equal(stamps.length, LOG_EVENTS.length);
  assert.equal(stamps.every((s) => s && s.length > 4), true, stamps.join(' | '));
});

// A session drawn before this shipped has no `events` key at all; the section
// must be absent rather than an empty heading with nothing under it.
test('a session with no log renders no log section', async (t) => {
  const dom = await lobby(t, { session: sessionFixture() });
  assert.equal(dom.app.querySelector('.session-log'), null);
});

// The operator asked for it on the results screen too, and specifically before
// the destructive action rather than after it.
test('the results screen carries the same log, above the delete link', async (t) => {
  const round = roundFixture();
  const session = sessionFixture({
    events: LOG_EVENTS, done: true, votes: { m1: { g1: { rating: 5, retire: false } } },
  });
  round.sessions = [session];
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => round);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  await dom.call('showResults', round, session);

  const log = dom.app.querySelector('.session-log');
  assert.ok(log, 'expected the log on the results screen');
  assert.equal(log.querySelectorAll('.session-log__row').length, 4);

  // Placement: the log must precede the delete affordance in document order.
  const del = [...dom.app.querySelectorAll('.link-btn')].find((b) => /löschen/i.test(b.textContent));
  assert.ok(del, 'expected the delete-session link');
  assert.equal(
    log.compareDocumentPosition(del) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    'the log should come before the delete link, not after it',
  );
});

/* The setup toggle's own block used to live here — five specs over an "enabled /
   disabled / armed" state machine. #655 deleted the control: every session opens
   this lobby, so there is no mode left to choose before the draw and nothing to
   enable. What replaced them is the hand-on spec in the lobby block above, which
   covers the behaviour the toggle used to gate. */

/* ------------------------------------------------- the hand-on (#655)

   #655 deleted the guided multi-person wizard, so without this a five-person
   table would pay one tap per voter PLUS the effort of noticing who is left.
   After a vote lands on this device the lobby leads with the next person still
   open, which puts the tap count back to roughly one per person — the one real
   UX cost of unifying the flows, paid down.

   It is deliberately conditional on having just handed a vote on: arriving cold,
   or watching someone else's vote land, is not a hand-over and must not push a
   name at you. */

test('after a vote on this device the lobby leads with the next person still open', async (t) => {
  // Anna (my own seat) has voted; Ben and Chris have not.
  const dom = await lobby(t, {
    session: sessionFixture({ votedIds: ['m1'] }),
    handedOn: true,
  });
  const lead = dom.app.querySelector('.live-vote__mine');
  assert.ok(lead, 'expected a leading action');
  assert.match(textOf(lead), /Ben/, 'the next person still open should lead');

  // …and they are not ALSO listed below, which would put the same action on the
  // screen twice under two labels.
  const others = [...dom.app.querySelectorAll('.live-vote__hotseat-btn')].map(textOf);
  assert.deepEqual(others.map((x) => /Ben/.test(x)), [false], 'Ben must not be listed twice');
  assert.match(others[0], /Chris/);
});

test('arriving at the lobby cold pushes nobody', async (t) => {
  // The identical state, minus the hand-over. Anna's seat is used, so there is
  // no personal vote button either — the screen must simply offer the list.
  const dom = await lobby(t, { session: sessionFixture({ votedIds: ['m1'] }) });
  assert.equal(dom.app.querySelector('.live-vote__mine'), null, 'nothing should lead');
  const others = [...dom.app.querySelectorAll('.live-vote__hotseat-btn')].map(textOf);
  assert.equal(others.length, 2, 'both open people stay in the plain list');
  assert.match(others[0], /Ben/);
  assert.match(others[1], /Chris/);
});

test('with nobody left the hand-on falls through to ending the vote', async (t) => {
  const dom = await lobby(t, {
    session: sessionFixture({ votedIds: ['m1', 'm2', 'm3'] }),
    handedOn: true,
  });
  assert.equal(dom.app.querySelector('.live-vote__mine'), null, 'there is nobody to hand on to');
  assert.equal(dom.app.querySelectorAll('.live-vote__hotseat-btn').length, 0);
  // The close button is already the primary action in this state, so the
  // hand-on needs no special empty case of its own.
  const close = dom.app.querySelector('.live-vote__close');
  assert.ok(close);
  assert.ok(close.classList.contains('btn--primary'), 'ending the vote should lead');
});

test('the hand-on never offers your own unused seat to yourself', async (t) => {
  // Ben voted from his phone; my own seat (Anna) is still open. The leading
  // action must be my own "vote now", not a hand-over to myself.
  const dom = await lobby(t, {
    session: sessionFixture({ votedIds: ['m2'] }),
    handedOn: true,
  });
  const lead = dom.app.querySelector('.live-vote__mine');
  assert.ok(lead);
  assert.match(textOf(lead), /Jetzt abstimmen|Vote now/, 'my own seat leads, not a hand-on');
  assert.equal(/Anna/.test(textOf(lead)), false);
});
