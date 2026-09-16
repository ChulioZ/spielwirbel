'use strict';

/* The friend tile's cover wash (#1094, moved onto the tile by #1136).
 *
 * The wash is the friend's most recently played cover bled into the tile's right
 * side, so every tile carries a colour taken from what that person actually
 * plays. Two claims are worth pinning and neither is visible in a screenshot:
 *
 *   1. WHICH ENTRIES GET ONE. Friends with a recent event, and nothing else. A
 *      request card's lifted brand edge (#1092) is the one loud thing on the
 *      screen and must not compete with art; a friend with no activity stays
 *      plain, because that is a difference the roster should SHOW.
 *   2. THAT THE WASH AND THE LINE NAME THE SAME GAME. Both derive from the same
 *      `lastEventOf()` lookup, so a tile can never show one game's art over
 *      another game's name.
 *
 * Claim 1 got STRUCTURAL in #1136, and the tests say so rather than pretending
 * otherwise: requests and friends are now two different renderers, so a request
 * card has no art branch to get wrong. What is asserted is therefore that the
 * two renderers stayed apart — with the friend as the control, since "no art
 * anywhere" would satisfy the request half on its own.
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

const tileFor = (name) => [...dom.app.querySelectorAll('.k-tile')]
  .find((x) => (x.querySelector('.k-tile__name') || {}).textContent === name);
const artOf = (name) => tileFor(name).querySelector('.k-tile__art');

/* ------------------------- which tiles carry art -------------------------- */

test('a friend with a recent event wears that cover as a wash', async () => {
  await open({ friends: [person('ada')] }, [event('ada', 'Catan')]);
  const art = artOf('ada');
  assert.ok(art, 'no wash on a friend with a recent event');
  assert.match(art.getAttribute('style'), /background-image:url\('[^']*abc\.webp[^']*'\)/);
});

test('a friend with no recent event stays plain', async () => {
  // A difference the roster should show, not hide.
  await open({ friends: [person('ada'), person('bo')] }, [event('bo', 'Azul')]);
  assert.equal(artOf('ada'), null, 'a friend with no activity must stay plain');
  assert.ok(artOf('bo'), 'the one with activity keeps its wash');
});

test('an event with no cover renders no wash', async () => {
  await open({ friends: [person('ada')] }, [event('ada', 'Catan', null)]);
  assert.equal(artOf('ada'), null);
});

test('the „＋" tile carries no art', async () => {
  await open({ friends: [person('ada')] }, [event('ada', 'Catan')]);
  const add = dom.app.querySelector('.k-tile--add');
  assert.ok(add, 'the add tile is gone');
  assert.equal(add.querySelector('.k-tile__art'), null);
});

/* --------------------- the wash agrees with the line ---------------------- */

test('the wash and the second line name the SAME game', async () => {
  /* Both go through `lastEventOf()`. If they ever diverged the tile would show
     one game's art over another game's name, which no test of either alone can
     see. Two events for one account, newest first as the feed returns them. */
  await open({ friends: [person('ada')] }, [
    event('ada', 'Catan', '/uploads/catan.webp'),
    event('ada', 'Azul', '/uploads/azul.webp'),
  ]);
  assert.match(tileFor('ada').querySelector('.k-tile__line').textContent, /^Catan · /);
  assert.match(artOf('ada').getAttribute('style'), /catan\.webp/);
});

/* ------------------------------- the layer -------------------------------- */

test('the art is the tile\'s FIRST child, so content paints over it', async () => {
  await open({ friends: [person('ada')] }, [event('ada', 'Catan')]);
  assert.equal(tileFor('ada').firstElementChild.className, 'k-tile__art');
});

test('the cover goes through coverUrl() at THUMB size', async () => {
  /* Asserted as a CALL, not as an output, and that is not fussiness:
     `COVER_RESIZERS` has been EMPTY since #981, so `coverUrl()` is an identity
     function for every input today. Comparing the rendered url to
     `coverUrl(x, COVER_THUMB)` therefore compares x to x and passes against the
     full asset just as happily — measured, by swapping the call out and watching
     this file stay green.

     The call still matters: the roster can hold 28 of these, and the next
     provider that serves more than one size adds a row to that list and fixes
     the whole corpus at render time (.claude/rules/provider-cover-sizing.md).
     Stubbing is the only way to see it from here. */
  const real = dom.run('coverUrl');
  const thumb = dom.run('COVER_THUMB');
  // The stub MARKS its result, so the assertion is tied to this tile's own
  // background-image. Merely recording the calls is not enough: the feed band
  // renders the same events and makes the identical coverUrl(..., COVER_THUMB)
  // call, so a call-log assertion passes on the FEED's call while the tile uses
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

/* ------------------------ requests stay unwashed -------------------------- */

test('a request card carries no art, even when the feed HAS an event for it', async () => {
  /* The feed can legitimately hold an event for someone who is only a REQUEST —
     the lookup is by username, not by state — so this is a real guard rather
     than a tautology. Since #1136 it is structural: a request goes through
     `renderPersonCard`, which has no art branch at all.

     The FRIEND is the control and is what stops the assertion being vacuous: an
     implementation that simply stopped rendering art would satisfy the first
     two lines and fail the third. */
  await open(
    { incoming: [person('ada')], outgoing: [person('bo')], friends: [person('cy')] },
    [event('ada', 'Catan'), event('bo', 'Azul'), event('cy', 'Splendor')],
  );
  const cardFor = (name) => [...dom.app.querySelectorAll('.k-card')]
    .find((c) => (c.querySelector('.friend-row__name') || {}).textContent === name);
  assert.equal(cardFor('ada').querySelector('[class*="__art"]'), null, 'an incoming request was washed');
  assert.equal(cardFor('bo').querySelector('[class*="__art"]'), null, 'and so was an outgoing one');
  assert.ok(artOf('cy'), 'the control: the friend beside them IS washed, so the check above is not vacuous');
});

test('the two renderers stayed apart — a friend is never rendered as a card', async () => {
  /* The whole reason the request branch cannot regress: `renderPersonCard` is
     reached only for the two request states. A friend routed through it would
     bring back the 121px card, the duplicate `Entfernen` and the art branch in
     one step. */
  await open({ friends: [person('ada')] }, [event('ada', 'Catan')]);
  assert.equal(dom.app.querySelector('.k-card'), null, 'a friend rendered as a request card');
  assert.equal(dom.run('renderPersonCard').length, 2,
    'renderPersonCard took an `events` argument again — only a friend tile is washed');
});
