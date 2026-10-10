'use strict';

/* The setup screen's half of #1610: a team card offers „Eigene Plätze" (the
   default) or „Ein Platz", the live pool preview counts SEATS, and the choice
   reaches the server in the payload.

   The preview is pinned against `drawPool()` at the seat count the server will
   compute from the very payload the screen sends — the two copies of the count
   (.claude/rules/session-teams.md §2) are only honest if they agree on a fixture
   holding BOTH kinds of team, since one kind alone cannot tell them apart. */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { drawPool } = require('../lib/draw');
const { sessionSeatCount } = require('../public/js/session-people');
const { loadApp } = require('./support/dom');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
dom.set('showSessionLobby', () => {});
dom.set('showResults', () => {});

// Four people throughout. Each game fits exactly one seat count, so the
// preview names the count it was computed at.
const GAMES = [
  { id: 'g2', title: 'Zwei', minPlayers: 2, maxPlayers: 2 },
  { id: 'g3', title: 'Drei', minPlayers: 3, maxPlayers: 3 },
  { id: 'g4', title: 'Vier', minPlayers: 4, maxPlayers: 4 },
];
let rid = 0;
const roundFixture = () => ({
  id: `teamseats-${++rid}`,
  name: 'Freitagsrunde',
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  tags: [],
  sessions: [],
  games: GAMES.map((g) => ({ ...g })),
});

const plain = (v) => JSON.parse(JSON.stringify(v));
const previewed = () => [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort();
const addGuest = (name) => {
  const box = dom.app.querySelector('.nr-guest-add');
  if (box.hidden) dom.app.querySelector('.nr-seat--add').click();
  box.querySelector('input').value = name;
  box.querySelector('button').click();
};
const formTeam = (...labels) => {
  const pick = (label) => [...dom.app.querySelectorAll('.team-chip')].find((c) => c.textContent === label);
  labels.forEach((l) => pick(l).click());
  dom.app.querySelector('#teamMake').click();
};
const cards = () => [...dom.app.querySelectorAll('.team-card')];
const pressed = (card) =>
  [...card.querySelectorAll('.team-card__opt')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

async function setupWithTwoPairs() {
  const round = roundFixture();
  await dom.call('showStartSession', round);
  addGuest('Kim');
  addGuest('Lea');
  dom.app.querySelector('.setup-addons__chip[data-addon="team"]').click();
  formTeam('Anna', 'Kim (Gast)');
  formTeam('Ben', 'Lea (Gast)');
  return round;
}

test('a new team starts on own seats, and both options are named on the card', async () => {
  await setupWithTwoPairs();
  assert.equal(cards().length, 2);
  cards().forEach((card) => {
    assert.deepEqual([...card.querySelectorAll('.team-card__opt')].map((b) => b.textContent), ['Eigene Plätze', 'Ein Platz']);
    assert.deepEqual(pressed(card), ['Eigene Plätze']);
    assert.equal(card.querySelector('.team-card__mode').getAttribute('role'), 'group');
  });
  // Two own-seat pairs are four players — Tichu's case.
  assert.deepEqual(previewed(), ['Vier']);
});

test('switching ONE pair to a shared seat counts three, exactly as the server will', async () => {
  const round = await setupWithTwoPairs();
  cards()[0].querySelector('.team-card__opt[data-shared="true"]').click();
  assert.deepEqual(pressed(cards()[0]), ['Ein Platz']);
  assert.deepEqual(pressed(cards()[1]), ['Eigene Plätze']);
  // The re-render replaced the button; focus follows to its successor.
  assert.equal(dom.document.activeElement, cards()[0].querySelector('.team-card__opt[data-shared="true"]'));

  assert.deepEqual(previewed(), ['Drei']);

  const sent = [];
  dom.set('api', (method, path, body) => {
    sent.push(body);
    return Promise.resolve({ session: { id: 's1' }, games: round.games });
  });
  dom.app.querySelector('#go').click();
  await new Promise((r) => setImmediate(r));
  const body = plain(sent[0]);
  assert.deepEqual(body.teams.map((tm) => tm.sharedSeat), [true, false]);

  // The server's count of what it is about to store, over this very payload:
  // guests minted in order, teams resolved by position.
  const guests = body.guests.map((name, i) => ({ id: `gx${i}`, name }));
  const teams = body.teams.map((tm, i) => ({
    id: `t${i}`,
    personIds: [...tm.memberIds, ...tm.guestIndices.map((gi) => guests[gi].id)],
    sharedSeat: tm.sharedSeat,
  }));
  const seats = sessionSeatCount(round, { memberIds: body.memberIds, guests, teams });
  assert.equal(seats, 3);
  assert.deepEqual(drawPool(round, { playerCount: seats }).map((g) => g.title), previewed());
});

test('both pairs sharing a seat count two — the pre-#1610 meaning of every team', async () => {
  await setupWithTwoPairs();
  cards()[0].querySelector('.team-card__opt[data-shared="true"]').click();
  cards()[1].querySelector('.team-card__opt[data-shared="true"]').click();
  assert.deepEqual(previewed(), ['Zwei']);
  // And back: own seats again restores the headcount.
  cards()[0].querySelector('.team-card__opt[data-shared="false"]').click();
  assert.deepEqual(previewed(), ['Drei']);
});
