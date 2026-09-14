'use strict';

/* The Freundeskreis avatar band (#1093) — „Der Kreis" made visible.
 *
 * Two things here are easy to get wrong and invisible on screen, so they carry
 * most of the assertions:
 *
 *   1. THE ACCESSIBLE NAME. `friendAvatar()` is `aria-hidden="true"` on purpose
 *      — everywhere else it is used the account's name sits beside it in text.
 *      In the band there is no name beside it, so a bare reuse would render a
 *      row of links with NO accessible name at all, and nothing about the
 *      rendered page would look wrong.
 *   2. THE ORDER. Pending requests lead, matching the grid below. The band's
 *      whole claim is that the screen's state reads in one line before any card
 *      does, and a band that buried the request would be decoration.
 *
 * Run through the jsdom harness rather than source-matched: the order, the cap
 * and the labels are all render-time decisions
 * (.claude/rules/testing-views-under-jsdom.md).
 *
 * Named kreis-band: test/kreis-screen.test.js is #1092's grid spec and
 * test/friends.test.js is the route spec
 * (.claude/rules/test-file-names-collide-silently.md).
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

async function open(lists) {
  dom.set('accountApi', async (method, path) => (
    path === '/friends'
      ? { friends: [], incoming: [], outgoing: [], ...lists }
      : { events: [] }
  ));
  await dom.call('showFriends');
}

const band = () => dom.app.querySelector('.c-band');
const faces = () => [...dom.app.querySelectorAll('.c-ring__face')];
const bandText = () => dom.app.querySelector('.c-band__text').textContent;

/* --------------------------------- shape ---------------------------------- */

test('the band renders above the grid, with pending requests leading', async () => {
  await open({ friends: [person('dora'), person('erik')], incoming: [person('ada')] });

  const b = band();
  assert.ok(b, 'no band rendered at all');
  const grid = dom.app.querySelector('.k-split');
  assert.equal(b.compareDocumentPosition(grid) & 4 /* DOCUMENT_POSITION_FOLLOWING */, 4,
    'the band must sit above the grid');

  assert.deepEqual(faces().map((f) => f.getAttribute('aria-label')),
    ['ada · möchte dich hinzufügen', 'dora · Profil ansehen', 'erik · Profil ansehen'],
    'the pending account leads, and every face is named');
  assert.ok(faces()[0].classList.contains('avatar--wait'), 'and wears the waiting ring');
  assert.ok(!faces()[1].classList.contains('avatar--wait'), 'which a plain friend does not');
});

test('an outgoing request is NOT in the band', async () => {
  /* You are not waiting on yourself, and the band's second half counts what
     waits on YOU. An outgoing request in the ring would inflate both. */
  await open({ friends: [person('dora')], outgoing: [person('bob')] });
  assert.deepEqual(faces().map((f) => f.getAttribute('aria-label')), ['dora · Profil ansehen']);
});

test('no band at all when the circle is empty', async () => {
  // A band with no faces is not a picture, and the grid's own empty state speaks.
  await open({ friends: [], incoming: [], outgoing: [] });
  assert.equal(band(), null);
});

test('one pending request and no friends still earns a band', async () => {
  await open({ friends: [], incoming: [person('ada')] });
  assert.ok(band(), 'the one thing somebody is waiting on must be visible');
  assert.equal(faces().length, 1);
});

/* -------------------------------- the count ------------------------------- */

test('the count line states the circle, and the waiting half only when there is one', async () => {
  await open({ friends: [person('dora'), person('erik')] });
  assert.equal(bandText(), '2 im Kreis');

  await open({ friends: [person('dora'), person('erik')], incoming: [person('ada'), person('ben')] });
  assert.equal(bandText(), '2 im Kreis · 2 warten auf dich');
});

test('the waiting half is singular for one request', async () => {
  // „wartet", not „warten" — tn() through the locale's own plural rules.
  await open({ friends: [person('dora')], incoming: [person('ada')] });
  assert.equal(bandText(), '1 im Kreis · 1 wartet auf dich');
});

test('the count is the FRIEND count, not the number of faces shown', async () => {
  /* The two diverge past the cap, and the line is what carries the real number —
     which is also why the „+N" chip can stay decorative. */
  const many = Array.from({ length: 28 }, (_, i) => person('f' + String(i).padStart(2, '0')));
  await open({ friends: many });
  assert.equal(bandText(), '28 im Kreis');
});

/* --------------------------------- the cap -------------------------------- */

test('the ring caps its faces and hands the rest to a decorative +N chip', async () => {
  const many = Array.from({ length: 28 }, (_, i) => person('f' + String(i).padStart(2, '0')));
  await open({ friends: many, incoming: [person('ada')] });

  assert.equal(faces().length, 12, 'the ring shows at most BAND_MAX faces');
  assert.equal(faces()[0].getAttribute('aria-label'), 'ada · möchte dich hinzufügen',
    'and the pending one is never the face that gets cut');

  const more = dom.app.querySelector('.c-more');
  assert.ok(more, 'no overflow chip');
  assert.equal(more.textContent, '+17', '29 people, 12 shown');
  assert.equal(more.getAttribute('aria-hidden'), 'true',
    'the chip is decoration — the count line already states the number');
});

test('no chip when everybody fits', async () => {
  await open({ friends: [person('dora'), person('erik')] });
  assert.equal(dom.app.querySelector('.c-more'), null);
});

/* ------------------------------ accessibility ----------------------------- */

test('every band face is a real link to that profile, and none is aria-hidden', async () => {
  await open({ friends: [person('dora')], incoming: [person('ada')] });

  for (const f of faces()) {
    assert.equal(f.tagName, 'A', `${f.getAttribute('aria-label')} is not a link`);
    assert.equal(f.getAttribute('aria-hidden'), null,
      'the decorative aria-hidden from friendAvatar() must not come along — '
      + 'it would leave a row of links with no accessible name');
    assert.ok(f.getAttribute('aria-label'), 'a band face with no accessible name');
  }
  assert.equal(faces()[0].getAttribute('href'), '/u/ada');
  assert.equal(faces()[1].getAttribute('href'), '/u/dora');
  /* Wired through navLink(), which is what adds `.nav-link` — the class that
     strips the UA underline and link colour an <a> arrives with. Without it the
     initials render underlined and blue-ish, which is what a hand-built anchor
     here looks like (seen in the prototype). Asserted rather than eyeballed
     because it is a class, not a pixel. */
  assert.ok(faces()[0].classList.contains('nav-link'), 'the face is not a wired nav link');
});

test('an account with no resolvable username is not a link', async () => {
  /* Mid-erasure edge, and the same decision `friendRowMain` took: an <a> with no
     usable href is not a link at all — not focusable, no affordance. */
  await open({ friends: [person(null)] });
  const f = faces()[0];
  assert.equal(f.tagName, 'SPAN');
  assert.equal(f.getAttribute('href'), null);
});

test('a username with a slash is encoded into the href, not interpolated raw', async () => {
  await open({ friends: [person('a/b')] });
  assert.equal(faces()[0].getAttribute('href'), '/u/a%2Fb');
});
