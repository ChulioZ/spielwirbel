'use strict';

/* Der Kreis (#1092) — the Freundeskreis as one state-sorted grid beside a feed
 * column.
 *
 * The assertion that matters is the ORDER, because it is the whole point: a
 * request is the one thing on this screen somebody is waiting on, and the four
 * stacked lists it replaced put the roster above it, so the first request sat at
 * y = 1762 for 9 friends and y = 4258 for 28. In a state-sorted grid it is the
 * first card whatever the friend count — a property no amount of CSS could give
 * the old shape.
 *
 * The view is RUN through the jsdom harness, not source-matched
 * (.claude/rules/testing-views-under-jsdom.md): the sort, the collapse and the
 * tile's in-place swap are all decisions taken at render time.
 *
 * Named kreis-screen: test/friends.test.js is the route spec and
 * test/feed-*.test.js are the feed's, so none of those names was free
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
const event = (username, title, at = '2026-09-01T18:00:00Z') => ({
  type: 'game_added', username, title, at, coverUrl: null, avatar: null,
});

async function open(lists, events = [], opts) {
  dom.set('accountApi', async (method, path) => (
    path === '/friends'
      ? { friends: [], incoming: [], outgoing: [], ...lists }
      : { events }
  ));
  await dom.call('showFriends', opts);
}

const cards = () => [...dom.app.querySelectorAll('.k-card')];
const names = () => cards().map((c) => {
  const n = c.querySelector('.friend-row__name');
  return n ? n.textContent : c.querySelector('.k-card__name')?.textContent;
});

/* ------------------------------- the order -------------------------------- */

test('the grid is sorted by STATE: incoming, then outgoing, then friends', async () => {
  await open({
    friends: [person('dora'), person('erik')],
    incoming: [person('ada')],
    outgoing: [person('bob')],
  });
  assert.deepEqual(names().slice(0, 4), ['ada', 'bob', 'dora', 'erik']);
});

test('an incoming request is the FIRST card however many friends there are', async () => {
  /* The property the stacked lists could not have. 28 is the count the
     deep-dive measured at 6915px of page with the request at y = 4258. */
  const many = Array.from({ length: 28 }, (_, i) => person('f' + String(i).padStart(2, '0')));
  await open({ friends: many, incoming: [person('waiting')] });
  assert.equal(names()[0], 'waiting');
  assert.equal(cards()[0].className.includes('k-card--incoming'), true);
});

test('the three headings are gone, so each card states its own status', async () => {
  await open({ friends: [person('dora')], incoming: [person('ada')], outgoing: [person('bob')] });
  const headings = [...dom.app.querySelectorAll('h2')].map((x) => x.textContent);
  for (const key of ['friends.incoming', 'friends.outgoing', 'friends.listTitle']) {
    // The keys are deleted, so t() renders the key itself — which is the tell.
    assert.ok(!headings.includes(key), `${key} is still rendered`);
  }
  const line = (i) => cards()[i].querySelector('.k-card__line').textContent;
  assert.equal(line(0), dom.run("t('friends.card.wants')"));
  assert.equal(line(1), dom.run("t('friends.card.sent')"));
});

/* -------------------------- the card's second line ------------------------- */

test('a friend card shows their most recent event, else how long you have been friends', async () => {
  await open(
    { friends: [person('dora'), person('erik', { since: '2026-03-04T10:00:00Z' })] },
    [event('dora', 'Wingspan')],
  );
  const line = (i) => cards()[i].querySelector('.k-card__line').textContent;
  assert.match(line(0), /Wingspan/, 'the event the feed already carried is not shown');
  assert.match(line(1), /2026/, 'a friend with no event falls back to the friendship\'s own age');
  assert.ok(!/Wingspan/.test(line(1)), 'the wrong friend\'s event leaked onto a card');
});

test('neither line needs a request the view does not already make', async () => {
  // `since` has been in the /friends payload since #325 and nothing rendered it;
  // the events come from the feed the screen fetches anyway. Two calls, as before.
  const calls = [];
  dom.set('accountApi', async (method, path) => {
    calls.push(path);
    return path === '/friends'
      ? { friends: [person('dora', { since: '2026-03-04T10:00:00Z' })], incoming: [], outgoing: [] }
      : { events: [] };
  });
  await dom.call('showFriends');
  assert.deepEqual(calls.sort(), ['/friends', '/friends/feed']);
});

/* ------------------------------- the ＋ tile ------------------------------- */

test('the ＋ tile is LAST and becomes the username field in place', async () => {
  await open({ friends: [person('dora')] });
  const tile = dom.app.querySelector('.k-card--add');
  assert.ok(tile, 'no add tile');
  assert.equal(cards()[cards().length - 1], tile, 'the tile is not the last cell');
  assert.equal(dom.app.querySelector('.friends-add'), null, 'the add form is on the page before it is asked for');

  tile.click();
  const form = dom.app.querySelector('form.friends-add');
  assert.ok(form, 'the tile did not become a form');
  assert.equal(dom.app.querySelector('.k-card--add'), null, 'the tile survived alongside its own form');
  // The <form> is what keeps Enter-to-submit and the submit button's semantics.
  assert.equal(form.tagName, 'FORM');
  assert.ok(form.querySelector('input'), 'no field in the form');
});

test('the tile sends the request and keeps every error toast it had', async () => {
  await open({ friends: [] });
  const toasts = [];
  dom.set('toast', (m) => toasts.push(m));
  dom.set('accountApi', async () => { throw new Error('friend_self'); });

  dom.app.querySelector('.k-card--add').click();
  const form = dom.app.querySelector('form.friends-add');
  form.querySelector('input').value = 'me';
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(toasts.length, 1);
  assert.equal(toasts[0], dom.run("friendSendError('friend_self')"),
    'the error mapping changed — the toast is no longer the one friendSendError gives');
});

/* -------------------------------- the feed -------------------------------- */

/* The collapse is CSS, so the DOM half asserts the MECHANISM (every event
   rendered, the expander present, `is-open` flipping) and the CSS half asserts
   the cap. Neither alone establishes it: jsdom applies no external stylesheet,
   and a text assertion cannot see whether the class is ever set. */
test('every event is rendered, and the expander opens the column', async () => {
  const events = Array.from({ length: 18 }, (_, i) => event('dora', 'G' + i));
  await open({ friends: [person('dora')] }, events);
  assert.equal(dom.app.querySelectorAll('.k-feed .feed-item').length, 18,
    'the feed slices in JS — a width read at render time is wrong the moment the window changes');

  const col = dom.app.querySelector('.k-feed');
  assert.ok(!col.classList.contains('is-open'), 'the column starts open, so the cap never applies');
  const more = dom.app.querySelector('.k-feed__more');
  assert.ok(more, 'no expander over 18 events');
  assert.match(more.textContent, /18/, 'the expander does not say how many there are');
  more.click();
  assert.ok(col.classList.contains('is-open'), 'the expander does not open the column');
});

test('the phone cap is CSS, keyed on .is-open, and lifted in the column', () => {
  const { CSS, mediaBlocks, rulesOf } = require('./support/css');
  const below = mediaBlocks(CSS).filter(([q]) => /max-width:\s*1023px/.test(q))
    .flatMap(([, css]) => rulesOf(css));
  const cap = below.find(([sel]) => /\.k-feed/.test(sel) && /nth-child/.test(sel));
  assert.ok(cap, 'nothing caps the stacked feed, so it is a screenful of the home tile\'s own content');
  assert.match(cap[0], /:not\(\.is-open\)/, 'the cap is not lifted by the expander');
  assert.match(cap[1], /display:\s*none/);

  // …and the expander itself is gone where the column shows everything.
  const above = mediaBlocks(CSS).filter(([q]) => /min-width:\s*1024px/.test(q))
    .flatMap(([, css]) => rulesOf(css));
  assert.ok(above.some(([sel, body]) => /\.k-feed__more/.test(sel) && /display:\s*none/.test(body)),
    'the expander still shows in the column, where there is nothing left to expand');
});

test('„Alle anzeigen" from the home tile opens the feed already expanded', async () => {
  // The link promises all of them; the stacked cap would break that promise.
  const events = Array.from({ length: 18 }, (_, i) => event('dora', 'G' + i));
  await open({ friends: [person('dora')] }, events, { feed: 'all' });
  assert.ok(dom.app.querySelector('.k-feed').classList.contains('is-open'));
});

test('six events or fewer render no expander at all', async () => {
  await open({ friends: [person('dora')] }, [event('dora', 'Solo')]);
  assert.equal(dom.app.querySelectorAll('.k-feed .feed-item').length, 1);
  assert.equal(dom.app.querySelector('.k-feed__more'), null);
});

/* --------------------------- structure and links --------------------------- */

test('the screen is ONE wrapper, which is what lets it opt out of the reading measure', async () => {
  await open({ friends: [person('dora')] });
  const screen = dom.app.querySelector('.friends-screen');
  assert.ok(screen, 'no wrapper — a screen that "cannot opt out" is usually one missing a wrapper');
  assert.ok(screen.querySelector('.k-grid'), 'the grid is outside the wrapper');
  assert.ok(screen.querySelector('.k-feed'), 'the feed column is outside the wrapper');
  // And no back row, which is why the CSS exemption needs only one selector.
  assert.equal(dom.app.querySelector('.back-row'), null);
});

test('only the avatar+name half is a link, and the card promises no click', async () => {
  await open({ friends: [person('dora')] });
  const card = cards()[0];
  assert.equal(card.tagName, 'DIV');
  assert.equal(card.getAttribute('href'), null);
  const link = card.querySelector('a.friend-row__link');
  assert.ok(link, 'the name does not link to the profile');
  assert.equal(link.querySelector('button'), null, 'a <button> inside an <a> is invalid HTML');
  assert.ok(card.querySelector('.k-card__meta button'), 'the card lost its action');
});

test('an account with no resolvable username renders a span, not a dead anchor', async () => {
  await open({ friends: [person(null)] });
  assert.equal(cards()[0].querySelector('a.friend-row__link'), null,
    'an <a> with no usable href is not a link at all — not focusable, no affordance');
});

test('an outgoing request carries no report button; the other two do', async () => {
  dom.run("setContactAvailable(true)");
  await open({ friends: [person('dora')], incoming: [person('ada')], outgoing: [person('bob')] });
  const report = (i) => !!cards()[i].querySelector('.friend-row__report');
  assert.equal(report(0), true, 'an incoming request cannot be reported');
  assert.equal(report(1), false, 'you reached out to them — there is nothing of theirs on screen to report');
  assert.equal(report(2), true, 'a friend cannot be reported');
});
