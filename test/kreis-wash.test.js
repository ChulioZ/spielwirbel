'use strict';

/* The friend card's cover wash (#1094) — slice 3 of 4 of „Der Kreis".
 *
 * The wash is the friend's most recently played cover bled into the card's right
 * side, so every card carries a colour taken from what that person actually
 * plays. Two claims are worth pinning and neither is visible in a screenshot:
 *
 *   1. WHICH CARDS GET ONE. Friends with a recent event, and nothing else. A
 *      request card's lifted brand edge (#1092) is the one loud thing in the
 *      grid and must not compete with art; a friend with no activity stays
 *      plain, because that is a difference the grid should SHOW.
 *   2. THAT THE WASH AND THE LINE NAME THE SAME GAME. Both derive from the same
 *      `lastEventOf()` lookup, so a card can never show one game's art over
 *      another game's name.
 *
 * The contrast ceiling lives in test/a11y-contrast.test.js, which re-derives it
 * from the declared `opacity` rather than restating a number.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('accountsActive', () => true);
dom.set('isLoggedIn', () => true);
dom.set('refreshInboxBadge', () => {});
dom.set('showHome', () => {});

const person = (username, over = {}) => ({
  username, avatar: null, friendshipId: 'f-' + username, ...over,
});
const event = (username, title, coverUrl = '/uploads/abc.webp') => ({
  type: 'game_played', username, title, at: '2026-09-01T18:00:00Z', coverUrl, avatar: null,
});

async function open(lists, events = []) {
  dom.set('accountApi', async (method, path) => (
    path === '/friends'
      ? { friends: [], incoming: [], outgoing: [], ...lists }
      : { events }
  ));
  await dom.call('showFriends');
}

const cardFor = (name) => [...dom.app.querySelectorAll('.k-card')]
  .find((c) => (c.querySelector('.friend-row__name') || {}).textContent === name);
const artOf = (name) => cardFor(name).querySelector('.k-card__art');

/* ------------------------- which cards carry art -------------------------- */

test('a friend with a recent event wears that cover as a wash', async () => {
  await open({ friends: [person('ada')] }, [event('ada', 'Catan')]);
  const art = artOf('ada');
  assert.ok(art, 'no wash on a friend with a recent event');
  assert.match(art.getAttribute('style'), /background-image:url\('[^']*abc\.webp[^']*'\)/);
});

test('a friend with no recent event stays plain', async () => {
  // A difference the grid should show, not hide.
  await open({ friends: [person('ada'), person('bo')] }, [event('bo', 'Azul')]);
  assert.equal(artOf('ada'), null, 'a friend with no activity must stay plain');
  assert.ok(artOf('bo'), 'the one with activity keeps its wash');
});

test('an event with no cover renders no wash', async () => {
  await open({ friends: [person('ada')] }, [event('ada', 'Catan', null)]);
  assert.equal(artOf('ada'), null);
});

test('incoming and outgoing request cards never carry art', async () => {
  /* Their lifted brand edge is the one loud thing in the grid (#1092). Note the
     feed can legitimately hold an event for someone who is only a REQUEST — the
     lookup is by username, not by state — so this is a real guard, not a
     tautology. */
  await open(
    { incoming: [person('ada')], outgoing: [person('bo')], friends: [person('cy')] },
    [event('ada', 'Catan'), event('bo', 'Azul'), event('cy', 'Splendor')],
  );
  assert.equal(artOf('ada'), null, 'an incoming request must stay plain');
  assert.equal(artOf('bo'), null, 'and so must an outgoing one');
  assert.ok(artOf('cy'), 'while the friend beside them is washed');
});

test('the „＋" tile carries no art', async () => {
  await open({ friends: [person('ada')] }, [event('ada', 'Catan')]);
  const add = dom.app.querySelector('.k-card--add');
  assert.ok(add, 'the add tile is gone');
  assert.equal(add.querySelector('.k-card__art'), null);
});

/* --------------------- the wash agrees with the line ---------------------- */

test('the wash and the second line name the SAME game', async () => {
  /* Both go through `lastEventOf()`. If they ever diverged the card would show
     one game's art over another game's name, which no test of either alone can
     see. Two events for one account, newest first as the feed returns them. */
  await open({ friends: [person('ada')] }, [
    event('ada', 'Catan', '/uploads/catan.webp'),
    event('ada', 'Azul', '/uploads/azul.webp'),
  ]);
  assert.match(cardFor('ada').querySelector('.k-card__line').textContent, /^Catan · /);
  assert.match(artOf('ada').getAttribute('style'), /catan\.webp/);
});

/* ------------------------------- the layer -------------------------------- */

test('the art is the card\'s FIRST child, so content paints over it', async () => {
  await open({ friends: [person('ada')] }, [event('ada', 'Catan')]);
  assert.equal(cardFor('ada').firstElementChild.className, 'k-card__art');
});

test('the cover goes through coverUrl() at THUMB size', async () => {
  /* Asserted as a CALL, not as an output, and that is not fussiness:
     `COVER_RESIZERS` has been EMPTY since #981, so `coverUrl()` is an identity
     function for every input today. Comparing the rendered url to
     `coverUrl(x, COVER_THUMB)` therefore compares x to x and passes against the
     full asset just as happily — measured, by swapping the call out and watching
     this file stay green.

     The call still matters: the grid can hold 28 of these, and the next provider
     that serves more than one size adds a row to that list and fixes the whole
     corpus at render time (.claude/rules/provider-cover-sizing.md). Stubbing is
     the only way to see it from here. */
  const real = dom.run('coverUrl');
  const thumb = dom.run('COVER_THUMB');
  // The stub MARKS its result, so the assertion is tied to this card's own
  // background-image. Merely recording the calls is not enough: the feed column
  // renders the same events and makes the identical coverUrl(..., COVER_THUMB)
  // call, so a call-log assertion passes on the FEED's call while the card uses
  // the raw asset — measured, green against exactly that break.
  dom.set('coverUrl', (image, width) => `${image}#via-coverUrl-${width}`);
  try {
    await open({ friends: [person('ada')] }, [event('ada', 'Catan')]);
    assert.match(artOf('ada').getAttribute('style'),
      new RegExp(`abc\\.webp#via-coverUrl-${thumb}`),
      'the wash did not build its url through coverUrl(cover, COVER_THUMB)');
  } finally {
    dom.set('coverUrl', real);
  }
});

test('a request card gets no art even when the feed HAS an event for it', async () => {
  /* `renderPersonCard` is called directly here, because `showFriends` passes no
     `events` argument for incoming/outgoing at all — so through the screen the
     state guard is unreachable and a test that goes via `showFriends` is
     vacuous for this claim (measured: deleting the guard left it green).

     The guard is still the thing that must hold: it is one caller change away
     from mattering, and a washed request card would put art under the lifted
     brand edge that is the grid's one loud thing. */
  const evs = [event('ada', 'Catan')];
  for (const state of ['incoming', 'outgoing']) {
    const card = dom.run('renderPersonCard')(person('ada'), state, evs);
    assert.equal(card.querySelector('.k-card__art'), null,
      `a ${state} card was washed`);
  }
  const friend = dom.run('renderPersonCard')(person('ada'), 'friend', evs);
  assert.ok(friend.querySelector('.k-card__art'),
    'the control: the same person as a FRIEND is washed, so the check above is not vacuous');
});
