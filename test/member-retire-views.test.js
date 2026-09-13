'use strict';

/* What a RETIRED member (#1006) disappears from, and what they must not.
 *
 * The boundary is the whole feature. `sessionPeople()` keeps resolving them —
 * every vote, winner and team reference they hold has to keep answering, or the
 * Spielwirbel-Score of every game they ever rated shifts — while the
 * forward-looking, person-facing surfaces stop offering them. `activeMembers()`
 * is the one filter those surfaces apply, and the point of driving real screens
 * here is that a helper nobody calls looks exactly like a feature that works.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { activeMembers, memberIsActive } = require('../public/js/member-active');
const { sessionPeople } = require('../public/js/session-people');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
dom.set('showSessionLobby', () => {});
dom.set('showResults', () => {});

const GAMES = [
  { id: 'g1', title: 'Duo', minPlayers: 1, maxPlayers: 8, tagIds: [] },
  { id: 'g2', title: 'Trio', minPlayers: 1, maxPlayers: 8, tagIds: [] },
];

let rid = 0;
const roundFixture = (over = {}) => ({
  id: `retire-${++rid}`,
  name: 'Freitagsrunde',
  background: null,
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben', retired: true, retiredAt: '2026-09-01T10:00:00.000Z' },
    { id: 'm3', name: 'Clara' },
  ],
  tags: [],
  sessions: [],
  games: GAMES.map((g) => ({ ...g })),
  ...over,
});

// ------------------------------------------------- the helper, and its limit

test('activeMembers drops a retired seat and keeps the order of the rest', () => {
  const round = roundFixture();
  assert.deepEqual(activeMembers(round).map((m) => m.name), ['Anna', 'Clara']);
  assert.equal(memberIsActive(round.members[1]), false);
  assert.equal(memberIsActive(round.members[0]), true);
  // Defensive shapes a view can legitimately hand it.
  assert.deepEqual(activeMembers(null), []);
  assert.deepEqual(activeMembers({}), []);
});

test('sessionPeople still resolves a retired member — this is the whole invariant', () => {
  /* If it did not, every vote they cast would vanish from `rawGameStats`, and
     every game they ever rated would move. That is the opposite of the point. */
  const round = roundFixture();
  const session = { id: 's1', memberIds: ['m1', 'm2', 'm3'], guests: [] };
  assert.deepEqual(sessionPeople(round, session).map((p) => p.name), ['Anna', 'Ben', 'Clara']);

  // And the back-compat fallback (a session predating the seat picker stores no
  // `memberIds`, meaning "everyone") keeps them too — they WERE everyone then.
  assert.deepEqual(sessionPeople(round, { id: 's2' }).map((p) => p.name), ['Anna', 'Ben', 'Clara']);
});

// ------------------------------------------------------------- the surfaces

test('the session-setup seat ring offers only the members still playing', async () => {
  const round = roundFixture();
  await dom.call('showStartSession', round);
  const seats = [...dom.app.querySelectorAll('.nr-seat[aria-pressed] .nr-seat__name')]
    .map((el) => el.textContent);
  assert.deepEqual(seats, ['Anna', 'Clara'], 'a retired member must not be offered a chair');
});

test('the round hero lists the active seats, and the retired one dimmed behind the „+"', async () => {
  const round = roundFixture();
  dom.set('api', async () => round);
  await dom.call('showRound', round.id);

  const strip = dom.app.querySelector('.hero__members');
  assert.ok(strip, 'the hero renders its member strip');
  const active = [...strip.querySelectorAll('.avatar:not(.avatar--add):not(.avatar--retired)')];
  assert.equal(active.length, 2, 'two people are still playing');
  const retired = [...strip.querySelectorAll('.avatar--retired')];
  assert.equal(retired.length, 1, 'and the retired seat is still REACHABLE — restoring happens on its page');
  assert.match(retired[0].getAttribute('title'), /Ben/);
  // After the "+", so the index-to-member mapping above it cannot pick it up.
  assert.ok(strip.querySelector('.avatar--add').compareDocumentPosition(retired[0])
    & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
});

// ----------------------------------------------------- the retire dialog

const openMember = async (round, mid, over = {}) => {
  dom.set('api', async () => round);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => over.me || null);
  await dom.call('showMember', round.id, mid);
};
const footerBtn = (rx) => [...dom.app.querySelectorAll('.round-footer button')]
  .find((b) => rx.test(b.textContent));
const dialogOpts = () => [...dom.document.querySelectorAll('.confirm-dialog__opt')]
  .map((el) => el.textContent.trim());

test('the dialog asks about solely-owned games ONLY when there are any', async () => {
  // None owned at all. Clara (m3) is still active — m2 is the retired one, whose
  // page offers „Zurückholen" instead.
  const plain = roundFixture();
  await openMember(plain, 'm3');
  footerBtn(/Aussortieren/).click();
  assert.deepEqual(dialogOpts(), [], 'nothing is owned, so nothing to ask about');
  dom.document.querySelector('[data-act="cancel"]').click();

  // One game owned by Clara alone, one shared — only the solely-owned one
  // counts, because a shared box still arrives with its other owner.
  const owned = roundFixture({
    games: [
      { ...GAMES[0], ownerIds: ['m3'] },
      { ...GAMES[1], ownerIds: ['m1', 'm3'] },
    ],
  });
  await openMember(owned, 'm3');
  footerBtn(/Aussortieren/).click();
  const opts = dialogOpts();
  assert.equal(opts.length, 1);
  assert.match(opts[0], /Spiel aussortieren/);
  assert.match(opts[0], /Clara/, 'and names whose box it is');
});

test('the dialog asks about the account link ONLY on your own seat', async () => {
  const mine = roundFixture();
  mine.members[2].userId = 'acct-me';
  await openMember(mine, 'm3', { me: 'acct-me' });
  footerBtn(/Aussortieren/).click();
  assert.equal(dialogOpts().length, 1);
  assert.match(dialogOpts()[0], /Konto/);
  dom.document.querySelector('[data-act="cancel"]').click();

  /* Someone ELSE's linked seat gets no such question, and that is not an
     omission: `PATCH …/members/:mid` refuses to release a seat that is not
     yours, because nulling a grantee's link leaves their grant matching on
     roundId+userId with no chair, invitable to someone else
     (.claude/rules/member-seat-self-claim.md §1). */
  const theirs = roundFixture();
  theirs.members[0].userId = 'acct-anna';
  await openMember(theirs, 'm1', { me: 'acct-me' });
  footerBtn(/Aussortieren/).click();
  assert.deepEqual(dialogOpts(), []);
});

test('a retired member\'s page offers the way back, not a second retirement', async () => {
  const round = roundFixture();
  await openMember(round, 'm2');
  assert.ok(footerBtn(/Zurückholen/), 'restoring is the point of keeping them reachable');
  assert.equal(footerBtn(/Aussortieren/), undefined);
});

test('delete is offered only where nothing is lost — and hidden once there are votes', async () => {
  const clean = roundFixture();
  await openMember(clean, 'm3');
  assert.ok(footerBtn(/Platz löschen/), 'no votes anywhere, so the seat can simply go');

  const voted = roundFixture({
    sessions: [{ id: 's1', memberIds: ['m1', 'm3'], votes: { m3: { g1: { rating: 4 } } },
      winnerIds: [], guests: [], teams: [] }],
  });
  await openMember(voted, 'm3');
  assert.equal(footerBtn(/Platz löschen/), undefined, 'a vote is history — retire, do not delete');
  assert.ok(footerBtn(/Aussortieren/), 'which is what is offered instead');
});
