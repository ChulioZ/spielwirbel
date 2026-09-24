'use strict';

/* The Freundeskreis (#1092, rebuilt as three bands by #1136) — „Warten auf dich"
 * · „Deine Freunde" · „Neues", stacked full width, with the feed as a tile grid.
 *
 * Two claims carry most of the assertions:
 *
 *   1. THE ORDER. A request is the one thing on this screen somebody is waiting
 *      on, so it leads whatever the friend count. The four stacked lists this
 *      replaced put the roster above it (the first request sat at y = 1762 for 9
 *      friends and y = 4258 for 28); #1092 fixed that with a state-sorted grid
 *      and #1136 keeps the property with a band.
 *   2. THERE IS NO SPLIT. The dead column #1092 produced — 1601px at every width
 *      from 1280 to 2560 — is a property of splitting two contents whose heights
 *      come from unrelated counts, so the guard is that no container pairs them
 *      side by side, not that some ratio improved.
 *
 * The view is RUN through the jsdom harness, not source-matched
 * (.claude/rules/testing-views-under-jsdom.md): the band conditions, the tile's
 * element kind and the in-place swap are all decisions taken at render time.
 *
 * Named kreis-screen: test/friends.test.js is the route spec and
 * test/feed-*.test.js are the feed's, so none of those names was free
 * (.claude/rules/test-file-names-collide-silently.md). The internal `k-`
 * vocabulary is deliberately left alone (#1136) — only the shipped WORDING
 * retired the metaphor, which test/circle-naming.test.js guards.
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

const bands = () => [...dom.app.querySelectorAll('.k-band')];
const headings = () => bands().map((b) => b.querySelector('.k-band__h').textContent);
const cards = () => [...dom.app.querySelectorAll('.k-card')];
const tiles = () => [...dom.app.querySelectorAll('.k-tile:not(.k-tile--add)')];
const tileNames = () => tiles().map((x) => x.querySelector('.k-tile__name').textContent);

/* -------------------------------- the bands ------------------------------- */

test('three bands, in order: what is waiting, your people, what is new', async () => {
  await open({ friends: [person('dora')], incoming: [person('ada')] }, [event('dora', 'Azul')]);
  assert.deepEqual(headings().map((h) => h.replace(/\s*\d+$/, '')), [
    dom.run("t('friends.waitingTitle')"),
    dom.run("t('friends.rosterTitle')"),
    dom.run("t('friends.newsTitle')"),
  ]);
});

test('the requests band is absent when nothing is pending', async () => {
  // A heading over an empty band is furniture; the roster leads instead.
  await open({ friends: [person('dora')] });
  assert.equal(bands().length, 2);
  assert.match(headings()[0], new RegExp(dom.run("t('friends.rosterTitle')")));
});

test('a request leads the screen however many friends there are', async () => {
  /* The property the stacked lists could not have. 28 is the count the deep-dive
     measured at 6915px of page with the request at y = 4258. */
  const many = Array.from({ length: 28 }, (_, i) => person('f' + String(i).padStart(2, '0')));
  await open({ friends: many, incoming: [person('waiting')] });
  const first = bands()[0];
  assert.match(first.querySelector('.k-band__h').textContent,
    new RegExp(dom.run("t('friends.waitingTitle')")));
  assert.equal(first.querySelector('.k-card .friend-row__name').textContent, 'waiting');
  // …and it is genuinely above the roster in the document, not merely present.
  assert.ok(first.compareDocumentPosition(bands()[1]) & 4);
});

test('incoming leads outgoing inside the band, and each card states its own status', async () => {
  await open({ friends: [], incoming: [person('ada')], outgoing: [person('bob')] });
  const line = (i) => cards()[i].querySelector('.k-card__line').textContent;
  assert.deepEqual(cards().map((c) => c.querySelector('.friend-row__name').textContent), ['ada', 'bob']);
  assert.equal(line(0), dom.run("t('friends.card.wants')"));
  assert.equal(line(1), dom.run("t('friends.card.sent')"));
});

/* The heading the issue did not specify. „Warten auf dich" is a statement about
   INCOMING requests, so an account whose only pending request is one it sent
   must not be told somebody is waiting on it. */
test('a band holding only outgoing requests does not claim somebody is waiting on you', async () => {
  await open({ friends: [], outgoing: [person('bob')] });
  const head = bands()[0].querySelector('.k-band__h').textContent;
  assert.match(head, new RegExp(dom.run("t('friends.sentTitle')")));
  assert.ok(!head.includes(dom.run("t('friends.waitingTitle')")),
    'an outgoing-only band claims somebody is waiting on you');
});

test('the count sits INSIDE the heading, so it is announced with it', async () => {
  // A bare number beside an <h2> is a stray digit with nothing to attach it to.
  await open({ friends: [person('dora'), person('erik')], incoming: [person('ada')] });
  const roster = bands()[1].querySelector('.k-band__h');
  assert.equal(roster.querySelector('.k-band__count').textContent, '2');
  assert.match(roster.textContent, /2$/);
  // The news band has no count: the feed states its own in the expander.
  assert.equal(bands()[2].querySelector('.k-band__count'), null);
});

test('#1093\'s avatar band is gone — it showed the same faces the roster does', async () => {
  await open({ friends: [person('dora')], incoming: [person('ada')] });
  assert.equal(dom.app.querySelector('.c-band'), null, 'the avatar band is still rendered');
  assert.equal(dom.app.querySelector('.c-ring'), null);
});

/* -------------------------------- no split -------------------------------- */

test('nothing pairs the roster and the feed in columns, at any width', async () => {
  /* The dead column is a property of splitting at all: two columns whose heights
     come from two unrelated counts mean one always runs out first, so shifting
     width between them only moves the hole. The guard is therefore structural. */
  await open({ friends: [person('dora')] }, [event('dora', 'Azul')]);
  assert.equal(dom.app.querySelector('.k-split'), null, 'the two-column split is back');
  assert.equal(dom.app.querySelector('.k-feed'), null, 'the narrow feed column is back');
  // Every band is a direct child of the one screen wrapper, i.e. a sibling of
  // the others rather than a cell beside one.
  const screen = dom.app.querySelector('.friends-screen');
  for (const b of bands()) assert.equal(b.parentElement, screen);
});

test('the screen is ONE wrapper, which is what lets it opt out of the reading measure', async () => {
  await open({ friends: [person('dora')] });
  const screen = dom.app.querySelector('.friends-screen');
  assert.ok(screen, 'no wrapper — a screen that "cannot opt out" is usually one missing a wrapper');
  assert.ok(screen.querySelector('.k-tiles'), 'the roster is outside the wrapper');
  // And no back row, which is why the CSS exemption needs only one selector.
  assert.equal(dom.app.querySelector('.back-row'), null);
});

/* ------------------------------ the person tile ---------------------------- */

test('a friend tile is a real link to the profile and carries no action button', async () => {
  /* Its only action was `Entfernen`, which the profile has offered since #558
     together with the report entry point — so this is a duplicate removed, not
     an affordance lost. A real <a>, never a div that re-earns the click in JS
     (.claude/rules/ds-row-is-a-click-target.md). */
  await open({ friends: [person('dora')] });
  const tile = tiles()[0];
  assert.equal(tile.tagName, 'A');
  assert.equal(tile.getAttribute('href'), dom.run("profilePath('dora')"));
  assert.equal(tile.querySelector('button'), null, 'the tile grew a button — inside an <a> that is invalid HTML');
  assert.equal(tile.querySelector('.friend-row__remove'), null);
});

test('an account with no resolvable username is not a dead anchor', async () => {
  await open({ friends: [person(null)] });
  const tile = tiles()[0];
  assert.equal(tile.tagName, 'DIV',
    'an <a> with no usable href is not a link at all — not focusable, no affordance');
  assert.equal(tile.getAttribute('href'), null);
});

test('a username with a slash is encoded into the href, not interpolated raw', async () => {
  await open({ friends: [person('a/b')] });
  const href = tiles()[0].getAttribute('href');
  assert.ok(!href.includes('/a/b'), `the handle was interpolated raw: ${href}`);
  assert.match(href, /a%2Fb/);
});

test('the tile shows their most recent event, else how long you have been friends', async () => {
  await open(
    { friends: [person('dora'), person('erik', { since: '2026-03-04T10:00:00Z' })] },
    [event('dora', 'Wingspan')],
  );
  const line = (i) => tiles()[i].querySelector('.k-tile__line').textContent;
  assert.match(line(0), /Wingspan/, 'the event the feed already carried is not shown');
  assert.match(line(1), /2026/, 'a friend with no event falls back to the friendship\'s own age');
  assert.ok(!/Wingspan/.test(line(1)), 'the wrong friend\'s event leaked onto a tile');
});

/* The relative form (#1080's follow-up). The dates are built off the harness's
   own clock rather than written as literals, because a fixed „2026-09-01" drifts
   out of the 30-day window as the suite ages — the class of undated fixture that
   passes for a year and then reports a bug that is not there. */
const daysAgoIso = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

test('a recent event reads relatively, and an old one falls back to the date', async () => {
  await open(
    { friends: [person('dora'), person('erik')] },
    [event('dora', 'Wingspan', daysAgoIso(1)), event('erik', 'Azul', daysAgoIso(400))],
  );
  const line = (i) => tiles()[i].querySelector('.k-tile__line').textContent;

  // `numeric: 'auto'` is what makes one day „gestern" rather than „vor 1 Tag";
  // asserted against Intl itself, not against a German literal this file would
  // then have to keep in step with nine locales.
  const yesterday = dom.run("new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' }).format(-1, 'day')");
  assert.match(line(0), new RegExp(yesterday), 'a day-old event is not relative');

  // Past the cutoff the absolute date comes back, because „vor 400 Tagen" is a
  // number nobody pictures.
  assert.ok(!new RegExp(yesterday).test(line(1)), 'an ancient event is still relative');
  assert.match(line(1), /\d{4}/, 'and it did not fall back to a year-bearing date');
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

test('a request card keeps its buttons, and only its name half is a link', async () => {
  await open({ friends: [], incoming: [person('ada')] });
  const card = cards()[0];
  assert.equal(card.tagName, 'DIV');
  assert.equal(card.getAttribute('href'), null);
  const link = card.querySelector('a.friend-row__link');
  assert.ok(link, 'the name does not link to the profile');
  assert.equal(link.querySelector('button'), null, 'a <button> inside an <a> is invalid HTML');
  assert.ok(card.querySelector('.friend-req__accept'), 'the request lost its accept button');
  assert.ok(card.querySelector('.friend-req__decline'), 'the request lost its decline button');
});

test('an outgoing request carries no report button; an incoming one does', async () => {
  dom.run('setContactAvailable(true)');
  await open({ friends: [], incoming: [person('ada')], outgoing: [person('bob')] });
  const report = (i) => !!cards()[i].querySelector('.friend-row__report');
  assert.equal(report(0), true, 'an incoming request cannot be reported');
  assert.equal(report(1), false, 'you reached out to them — there is nothing of theirs on screen to report');
  /* The friend's own entry point moved WITH the action it sits beside: the tile
     has no buttons, and `showProfile` carries the report in its „…" menu. */
  await open({ friends: [person('dora')] });
  assert.equal(tiles()[0].querySelector('.friend-row__report'), null);
});

/* ------------------------------- the ＋ tile ------------------------------- */

test('the ＋ tile is LAST in the roster and becomes the username field in place', async () => {
  await open({ friends: [person('dora')] });
  const tile = dom.app.querySelector('.k-tile--add');
  assert.ok(tile, 'no add tile');
  const all = [...dom.app.querySelectorAll('.k-tile')];
  assert.equal(all[all.length - 1], tile, 'the tile is not the last cell');
  assert.equal(dom.app.querySelector('.friends-add'), null, 'the add form is on the page before it is asked for');

  tile.click();
  const form = dom.app.querySelector('form.friends-add');
  assert.ok(form, 'the tile did not become a form');
  assert.equal(dom.app.querySelector('.k-tile--add'), null, 'the tile survived alongside its own form');
  // The <form> is what keeps Enter-to-submit and the submit button's semantics.
  assert.equal(form.tagName, 'FORM');
  assert.ok(form.querySelector('input'), 'no field in the form');
});

test('the tile sends the request and keeps every error toast it had', async () => {
  await open({ friends: [] });
  const toasts = [];
  dom.set('toast', (m) => toasts.push(m));
  dom.set('accountApi', async () => { throw new Error('friend_self'); });

  dom.app.querySelector('.k-tile--add').click();
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
   and a text assertion cannot see whether the class is ever set. The cap itself
   is `.e-feed`'s and is pinned by test/profile-view.test.js. */
test('the feed is the TILE shape, and every event is rendered', async () => {
  const events = Array.from({ length: 18 }, (_, i) => event('dora', 'G' + i));
  await open({ friends: [person('dora')] }, events);
  assert.equal(dom.app.querySelectorAll('.e-grid .e-tile').length, 18,
    'the feed slices in JS — a width read at render time is wrong the moment the window changes');
  assert.equal(dom.app.querySelectorAll('.feed-item').length, 0,
    'the row form is back on this screen — 26 events measure 2261px that way against 463 as tiles');

  const wrap = dom.app.querySelector('.e-feed');
  assert.ok(!wrap.classList.contains('is-open'), 'the grid starts open, so the cap never applies');
  const more = dom.app.querySelector('.e-feed__more');
  assert.ok(more, 'no expander over 18 events');
  assert.match(more.textContent, /18/, 'the expander does not say how many there are');
  more.click();
  assert.ok(wrap.classList.contains('is-open'), 'the expander does not open the grid');
});

test('the feed tile names its AUTHOR here, unlike the profile\'s', async () => {
  // Every event on a profile belongs to the account in its <h1>; here they do not.
  await open({ friends: [person('dora')] }, [event('dora', 'Azul')]);
  assert.equal(dom.app.querySelector('.e-tile .e-tile__name').textContent, 'dora');
});

test('„Alle anzeigen" from the home tile opens the feed already expanded', async () => {
  // The link promises all of them; the phone cap would break that promise.
  const events = Array.from({ length: 18 }, (_, i) => event('dora', 'G' + i));
  await open({ friends: [person('dora')] }, events, { feed: 'all' });
  assert.ok(dom.app.querySelector('.e-feed').classList.contains('is-open'));
});

test('eight events or fewer render no expander at all', async () => {
  await open({ friends: [person('dora')] }, [event('dora', 'Solo')]);
  assert.equal(dom.app.querySelectorAll('.e-tile').length, 1);
  assert.equal(dom.app.querySelector('.e-feed__more'), null);
});

test('an empty feed says so instead of rendering an empty grid', async () => {
  await open({ friends: [person('dora')] }, []);
  assert.equal(dom.app.querySelector('.e-grid'), null);
  assert.equal(dom.app.querySelector('.k-band .empty-note').textContent,
    dom.run("t('friends.feedEmpty')"));
});

/* ------------------------- the home preview is untouched ------------------- */

test('the home dashboard keeps the ROW form — a narrow section is where it is right', async () => {
  /* `renderFeedEvent`'s remaining caller. The tile shape exists because the feed
     has a whole screen's width here; the home tile does not, which is
     `.claude/rules/tiles-vs-lists.md` applied to one component twice. */
  dom.set('accountApi', async () => ({ friendCount: 1, events: [event('dora', 'Azul')] }));
  const section = dom.document.createElement('section');
  dom.document.body.appendChild(section);
  await dom.call('renderHomeFriends', section);
  assert.equal(section.querySelectorAll('.feed-item').length, 1);
  assert.equal(section.querySelector('.e-tile'), null, 'the home preview switched to tiles');
});

/* jsdom applies no external stylesheet, so the tile's one layout claim has to be
   a CSS-text assertion. It is worth one: measured at 1470 with the line on a
   single `white-space: nowrap`, seven of nine tiles read „Wingspan · h…" — the
   game survived and the date, the other half of what the line says, did not. */
test('the tile\'s second line gets TWO lines, so the date is not ellipsised away', () => {
  const { bodyOf } = require('./support/css');
  const decl = bodyOf('.k-tile__line');
  assert.ok(decl, '.k-tile__line is gone — did the tile lose its second line?');
  assert.match(decl, /-webkit-line-clamp:\s*2/,
    'the line is not clamped to two — at 168px one line fits the game title and drops the date');
  assert.match(decl, /(^|[\s;])line-clamp:\s*2/, 'only the prefixed property is declared');
  assert.doesNotMatch(decl, /white-space:\s*nowrap/,
    'nowrap is back, which is the single-line truncation this replaced');
});

test('both roster controls declare a focus ring, not the UA default', () => {
  /* #1136 deleted `a.c-ring__face:focus-visible` with the avatar band, and the
     tile that replaced it is now the roster's ONLY interactive element — so a
     missing rule here would leave the one control on the screen with no brand
     focus treatment, unlike every sibling in the app. Measured in the pane: no
     `:focus-visible` rule matched the tile before this was added. */
  const { CSS, rulesOf } = require('./support/css');
  const rules = rulesOf(CSS).filter(([sel]) => /:focus-visible/.test(sel));
  for (const [needle, what] of [['a.k-tile:focus-visible', 'the person tile'],
    ['.k-tile--add:focus-visible', 'the „＋" tile']]) {
    const hit = rules.find(([sel]) => sel.split(',').some((s) => s.trim() === needle));
    assert.ok(hit, `${what} declares no :focus-visible rule`);
    assert.match(hit[1], /outline:\s*2px solid var\((?:--brand-ring,\s*var\()?--brand\)/,
      `${what}'s focus ring is not the app's brand outline`);
  }
});

test('the roster and the tile names agree on who is a friend', async () => {
  // Requests are cards in another band; only friends are tiles.
  await open({
    friends: [person('dora'), person('erik')],
    incoming: [person('ada')],
    outgoing: [person('bob')],
  });
  assert.deepEqual(tileNames(), ['dora', 'erik']);
  assert.deepEqual(cards().map((c) => c.querySelector('.friend-row__name').textContent), ['ada', 'bob']);
});
