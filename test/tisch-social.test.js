'use strict';

/* Der Tisch composes the social screens as T14.1 / T14.2 draw them (#1272):
 * the Freundeskreis (friends as pills, the add control in the head, the feed as
 * rows with the cover at the right), the own Spielerkarte (the stats switch on
 * the card) and the Posteingang (an icon tile per row type, stacked actions).
 *
 * Each screen is RUN through the jsdom harness under BOTH designs
 * (.claude/rules/testing-views-under-jsdom.md):
 *
 *  - Klassisch must render exactly the DOM it rendered before #1272. `shape()`
 *    reduces a subtree to its tags and classes, and the literals below were
 *    taken from — and checked against — origin/main's views. That is the half a
 *    design branch most easily breaks without anything looking wrong on the
 *    design being built.
 *  - Der Tisch renders the composition, and everything reachable today stays
 *    reachable: every friend is still a link to their profile, the add form is
 *    the same field and the same POST, accept/decline hit the same endpoints,
 *    and the switch saves through the same PATCH /me as Konto's.
 *
 * The contrast half is at the foot, measured through the design's resolved
 * tokens.
 *
 * Named for the design and the slice so it collides with no module basename
 * (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, mediaBlocks, rulesOf, outranks } = require('./support/css');

const { loadApp, flush } = require('./support/dom');
const { contrast, token } = require('./support/theme');
const { designById } = require('../public/js/designs');

const TISCH = designById('tisch');

function boot(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('refreshInboxBadge', () => {});
  dom.set('setInboxDot', () => {});
  dom.set('showHome', () => {});
  dom.set('toast', () => {});
  dom.set('isDemoAccount', () => false);
  dom.set('currentUserId', () => 'u-ada');
  dom.run('setContactAvailable(true)');
  dom.call('applyDesign', design);
  return dom;
}

// A subtree as one line per element: depth, tag and classes. Text and
// attributes are left out on purpose — the claim is about structure.
function shape(root) {
  const out = [];
  const walk = (el, d) => {
    for (const c of el.children) {
      out.push(`${'  '.repeat(d)}${c.tagName.toLowerCase()}${[...c.classList].map((x) => '.' + x).join('')}`);
      walk(c, d + 1);
    }
  };
  walk(root, 0);
  return out.join('\n');
}

/* ------------------------------ fixtures ---------------------------------- */

const person = (username, over = {}) => ({
  friendshipId: 'f-' + username, userId: 'u-' + username, username, avatar: null, ...over,
});
const LISTS = {
  friends: [person('dora', { since: '2025-05-02T10:00:00Z' }), person('ben', { since: '2026-01-10T10:00:00Z' })],
  incoming: [person('timo', { at: '2026-09-20T10:00:00Z' })],
  outgoing: [],
};
const EVENTS = [
  { type: 'session_played', title: 'Azul', coverUrl: 'https://cf.geekdo-images.com/a.jpg', at: '2026-09-20T18:00:00Z', username: 'dora', avatar: null },
  { type: 'game_added', title: 'Wingspan', coverUrl: null, at: '2026-09-18T18:00:00Z', username: 'ben', avatar: null },
];

async function friends(t, design, { lists = LISTS, events = EVENTS, opts } = {}) {
  const dom = boot(t, design);
  const calls = [];
  dom.set('accountApi', async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === '/friends' && method === 'GET') return lists;
    if (path === '/friends/feed') return { friendCount: lists.friends.length, events };
    return {};
  });
  await dom.call('showFriends', opts);
  return { dom, calls };
}

const ITEMS = [
  { id: 'i1', type: 'round_invitation', read: false, createdAt: '2026-09-24T18:02:00Z',
    payload: { invitationId: 'inv1', roundName: 'Familie Berger', inviterUsername: 'mia', memberName: null } },
  { id: 'i2', type: 'friend_request', read: true, createdAt: '2026-09-21T10:00:00Z',
    payload: { friendshipId: 'fr1', requesterUsername: 'timo' } },
  { id: 'i3', type: 'something_else', read: true, createdAt: '2026-09-20T10:00:00Z', payload: {} },
];

async function inbox(t, design) {
  const dom = boot(t, design);
  const calls = [];
  dom.set('accountApi', async (method, path) => {
    calls.push({ method, path });
    if (path === '/inbox') return { items: ITEMS.map((i) => ({ ...i })) };
    return {};
  });
  dom.set('showRound', () => {});
  await dom.call('showInbox');
  return { dom, calls };
}

const SELF = {
  username: 'ada', self: true, avatar: null, createdAt: '2025-05-14T10:00:00Z',
  stats: { sessions: 0, wins: 0, winRate: null, avgGiven: null, rounds: 0, gamesPlayed: 0,
    favorite: [], favAvg: null, bestGames: [], bestScore: null },
  events: [],
};

async function profile(t, design, { me = { statsVisible: true }, body = SELF } = {}) {
  const dom = boot(t, design);
  const calls = [];
  dom.run(`accountUser = ${JSON.stringify(me)}`);
  dom.set('accountApi', async (method, path, b) => {
    calls.push({ method, path, body: b });
    if (method === 'PATCH' && path === '/me') return { ...me, ...b };
    return body;
  });
  await dom.call('showProfile', body.username);
  return { dom, calls };
}

/* ------------------------------- Klassisch -------------------------------- */

const KLASSISCH_FRIENDS = `div.friends-screen
  div.lobby-head
    h1
  section.k-band
    h2.k-band__h
      span.k-band__count
    div.k-grid
      div.k-card.k-card--incoming
        div.k-card__who
          a.ds-row__main.friend-row__main.friend-row__link.nav-link
            span.avatar
            span.friend-row__name
          div.k-card__line.muted
        div.k-card__meta
          button.btn.btn--primary.btn--sm.friend-req__accept
          button.link-btn.friend-req__decline
          button.link-btn.friend-row__report
            i.ti.ti-flag
  section.k-band
    h2.k-band__h
      span.k-band__count
    div.k-tiles
      a.k-tile.nav-link
        span.k-tile__art
        span.avatar
        span.k-tile__body
          span.k-tile__name
          span.k-tile__line.muted
      a.k-tile.nav-link
        span.avatar
        span.k-tile__body
          span.k-tile__name
          span.k-tile__line.muted
      button.k-tile.k-tile--add
        span.k-tile__plus
        span.k-tile__body
          span.k-tile__name
          span.k-tile__line.muted
  section.k-band
    h2.k-band__h
    div.e-feed
      div.e-grid
        div.e-tile
          span.e-tile__img
          span.e-tile__title
          span.e-tile__meta
            span.e-tile__who
              span.avatar
              span.e-tile__name
            span.e-tile__verb
            span.e-tile__date
          button.e-tile__report
            i.ti.ti-flag
        div.e-tile
          span.e-tile__img
            i.ti.ti-cards
          span.e-tile__title
          span.e-tile__meta
            span.e-tile__who
              span.avatar
              span.e-tile__name
            span.e-tile__verb
            span.e-tile__date
          button.e-tile__report
            i.ti.ti-flag`;

test('Klassisch: the Freundeskreis renders the same DOM as before #1272', async (t) => {
  const { dom } = await friends(t, 'klassisch');
  assert.equal(shape(dom.app), KLASSISCH_FRIENDS);
});

test('Klassisch: the „＋" tile still opens the add form in place', async (t) => {
  const { dom } = await friends(t, 'klassisch');
  dom.app.querySelector('.k-tile--add').click();
  const form = dom.app.querySelector('form');
  assert.equal(form.className, 'k-tile k-tile--adding friends-add');
  assert.ok(form.parentElement.classList.contains('k-tiles'), 'the form replaces the tile inside the roster');
  assert.equal(dom.document.activeElement, form.querySelector('#friendHandle'));
});

const KLASSISCH_INBOX = `div.lobby-head
  h1
div.ds-list
  div.ds-row.ds-row--static.inbox-row.inbox-row--unread
    div.ds-row__main
      div.ds-row__date
        span.inbox-row__dot
      div.ds-row__status.muted
    div.ds-row__meta.inbox-invite__actions
      button.btn.btn--primary.inbox-invite__accept
      button.link-btn.inbox-invite__decline
  div.ds-row.ds-row--static.inbox-row
    div.ds-row__main
      div.ds-row__date
    div.ds-row__meta.inbox-invite__actions
      button.btn.btn--primary.inbox-friend__accept
      button.link-btn.inbox-friend__decline
  div.ds-row.ds-row--static.inbox-row
    div.ds-row__main
      div.ds-row__date
      div.ds-row__status.muted
    div.ds-row__meta
      button.link-btn.inbox-row__del
        i.ti.ti-trash`;

test('Klassisch: the Posteingang renders the same DOM as before #1272', async (t) => {
  const { dom } = await inbox(t, 'klassisch');
  assert.equal(shape(dom.app), KLASSISCH_INBOX);
});

test('Klassisch: the own Spielerkarte carries no stats switch', async (t) => {
  const { dom } = await profile(t, 'klassisch');
  assert.equal(dom.app.querySelector('.profile-card__vis'), null);
  assert.equal(dom.app.querySelector('.profile-card input[type="checkbox"]'), null);
});

/* ------------------------- Der Tisch: Freundeskreis ------------------------ */

test('Tisch: friends are pills, each still THE link to that profile', async (t) => {
  const { dom } = await friends(t, 'tisch');
  assert.equal(dom.app.querySelector('.k-tiles'), null, 'no tile grid under Tisch');
  const pills = [...dom.app.querySelectorAll('.k-pills > .k-pill')];
  assert.deepEqual(pills.map((p) => p.getAttribute('href')), ['/u/dora', '/u/ben']);
  assert.ok(pills.every((p) => p.tagName === 'A'));
  // The accessible name leads with the person, then the note — the tile's shape.
  // (the face is aria-hidden, so it is left out of the name as a reader would)
  const named = pills[0].cloneNode(true);
  named.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  assert.deepEqual([...named.children].map((c) => c.textContent), ['dora', 'Befreundet seit Mai 2025']);
  // The note is `since` from the friends payload — nothing that crosses a tenant.
  assert.ok(pills.every((p) => p.querySelector('.k-pill__note')));
  assert.equal(dom.app.querySelector('.k-tile--add'), null, 'the add control moved to the head');
});

test('Tisch: requests still lead, as cards with both actions', async (t) => {
  const { dom } = await friends(t, 'tisch');
  const first = dom.app.querySelector('.friends-screen > .k-band');
  assert.ok(first.querySelector('.k-card--incoming .friend-req__accept'));
  assert.ok(first.querySelector('.k-card--incoming .friend-req__decline'));
});

test('Tisch: the head\'s add button opens the same form once, and it posts the same request', async (t) => {
  const { dom, calls } = await friends(t, 'tisch');
  const btn = dom.app.querySelector('.lobby-head.friends-head > .friends-search');
  assert.ok(btn, 'the add button sits in the head');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  btn.click();
  btn.click();
  const forms = dom.app.querySelectorAll('#friendHandle');
  assert.equal(forms.length, 1, 'a second press re-focuses rather than stacking a form');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  const input = forms[0];
  assert.equal(dom.document.activeElement, input);
  // Placed right after the head, so DOM order is head → form → bands.
  assert.equal(dom.app.querySelector('.friends-head').nextElementSibling, input.form);
  input.value = 'clara';
  input.form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.path, '/friends');
  assert.equal(post.body.username, 'clara');
});

test('Tisch: an empty roster says so instead of an empty pill row', async (t) => {
  const { dom } = await friends(t, 'tisch', { lists: { friends: [], incoming: [], outgoing: [] } });
  assert.equal(dom.app.querySelector('.k-pills'), null);
  assert.ok(dom.app.querySelector('.friends-screen .k-band .empty-note'));
  assert.ok(dom.app.querySelector('.friends-search'), 'and the add button is still there');
});

test('Tisch: the feed is rows — author, sentence, and the cover only where the event carries one', async (t) => {
  const { dom } = await friends(t, 'tisch');
  assert.equal(dom.app.querySelector('.e-grid'), null);
  const rows = [...dom.app.querySelectorAll('.feed-list--rows > .feed-row')];
  assert.equal(rows.length, 2);
  // DOM order = the sheet's left-to-right order: face, body, cover.
  assert.ok(rows[0].firstElementChild.classList.contains('feed-row__face'));
  const cover = rows[0].querySelector('.feed-row__cover');
  assert.ok(cover, 'Azul carries a cover');
  assert.equal(cover.getAttribute('aria-hidden'), 'true');
  assert.match(cover.getAttribute('style'), /cf\.geekdo-images\.com/);
  assert.equal(rows[1].querySelector('.feed-row__cover'), null, 'Wingspan carries none, so no empty box');
  assert.ok(rows.every((r) => r.querySelector('.feed-item__report')), 'the DSA report entry point survives');
});

test('Tisch: „Alle anzeigen" still opens the feed expanded', async (t) => {
  const many = Array.from({ length: 10 }, (_, i) => ({ ...EVENTS[1], title: 'G' + i }));
  const { dom } = await friends(t, 'tisch', { events: many, opts: { feed: 'all' } });
  const wrap = dom.app.querySelector('.e-feed');
  assert.ok(wrap.classList.contains('is-open'));
  assert.ok(wrap.querySelector('.e-feed__more'), 'more than eight rows get the expander');
});

/* ------------------------- Der Tisch: Spielerkarte ------------------------- */

test('Tisch: the own card carries the stats switch, saving through Konto\'s PATCH', async (t) => {
  const { dom, calls } = await profile(t, 'tisch', { me: { statsVisible: true } });
  const vis = dom.app.querySelector('.profile-card > .profile-card__vis');
  assert.ok(vis, 'the switch is on the card');
  assert.equal(vis.querySelector('.profile-card__vis-icon').getAttribute('aria-hidden'), 'true');
  const box = vis.querySelector('input[type="checkbox"]');
  assert.equal(box.checked, true);
  // The label is Konto's own string, so the switch is named what it does.
  assert.match(box.closest('label').textContent, new RegExp(dom.run("t('konto.profile.stats')")));
  box.checked = false;
  box.dispatchEvent(new dom.window.Event('change'));
  await flush();
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.path, '/me');
  assert.deepEqual({ ...patch.body }, { statsVisible: false });
  assert.equal(dom.run('accountUser.statsVisible'), false, 'the cached /me follows, as on Konto');
});

test('Tisch: the switch reflects the stored state and is left out without one', async (t) => {
  const off = await profile(t, 'tisch', { me: { statsVisible: false } });
  assert.equal(off.dom.app.querySelector('.profile-card__vis input').checked, false);
  const none = await profile(t, 'tisch', { me: {} });
  assert.equal(none.dom.app.querySelector('.profile-card__vis'), null);
});

test('Tisch: a friend\'s card carries no switch', async (t) => {
  const friend = { ...SELF, username: 'dora', self: false, friendship: 'friends', friendshipId: 'f1', since: '2025-05-02T10:00:00Z' };
  const { dom } = await profile(t, 'tisch', { body: friend });
  assert.equal(dom.app.querySelector('.profile-card__vis'), null);
});

/* -------------------------- Der Tisch: Posteingang ------------------------- */

test('Tisch: every inbox row leads with a decorative icon tile per type', async (t) => {
  const { dom } = await inbox(t, 'tisch');
  const rows = [...dom.app.querySelectorAll('.inbox-row')];
  const icons = rows.map((r) => r.firstElementChild);
  assert.ok(icons.every((i) => i.classList.contains('inbox-row__icon') && i.getAttribute('aria-hidden') === 'true'));
  assert.deepEqual(icons.map((i) => i.querySelector('.ti').classList[1]), ['ti-user-plus', 'ti-users', 'ti-mail']);
  assert.ok(rows[0].classList.contains('inbox-row--round-invitation'));
  assert.ok(rows[1].classList.contains('inbox-row--friend-request'));
  // The row's own text still names the type in words.
  assert.match(rows[0].querySelector('.ds-row__date').textContent, /Familie Berger/);
});

test('Tisch: the typed rows gain their time; the generic row keeps its one', async (t) => {
  const { dom } = await inbox(t, 'tisch');
  const rows = [...dom.app.querySelectorAll('.inbox-row')];
  assert.ok(rows[0].querySelector('.inbox-row__when'));
  assert.ok(rows[1].querySelector('.inbox-row__when'));
  assert.equal(rows[2].querySelectorAll('.ds-row__status').length, 1);
});

test('Tisch: accept stays above decline, and both hit the same endpoints as today', async (t) => {
  const { dom, calls } = await inbox(t, 'tisch');
  const actions = dom.app.querySelector('.inbox-row--round-invitation .inbox-invite__actions');
  assert.deepEqual([...actions.children].map((b) => b.className.split(' ').pop()),
    ['inbox-invite__accept', 'inbox-invite__decline']);
  dom.app.querySelector('.inbox-friend__decline').click();
  await flush();
  assert.ok(calls.some((c) => c.method === 'POST' && c.path === '/friends/fr1/decline'));
  dom.app.querySelector('.inbox-invite__accept').click();
  await flush();
  assert.ok(calls.some((c) => c.method === 'POST' && c.path === '/invitations/inv1/accept'));
});

test('Tisch: the feed expander is hidden from 1024px, where nothing is collapsed', () => {
  // Der Tisch's `.link-btn { display: inline-flex }` outranks styles.css's hide,
  // so without its own rule „Alle N Aktivitäten" stood under an expanded feed.
  const sheet = fs.readFileSync(path.join(ROOT, 'public/css/designs/tisch.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const hides = mediaBlocks(sheet)
    .filter(([q]) => /min-width:\s*1024px/.test(q))
    .flatMap(([, css]) => rulesOf(css))
    .filter(([sel, body]) => /\.e-feed__more(?![\w-])/.test(sel) && /display:\s*none/.test(body));
  assert.equal(hides.length, 1);
  assert.ok(outranks(hides[0][0], ':root[data-design="tisch"] .link-btn'), 'it must outrank the design\'s .link-btn rule');
});

/* -------------------------------- contrast -------------------------------- */

test('the grounds and inks #1272 paints clear their bars on Der Tisch', () => {
  const pairs = [
    // pills and feed rows: name/note on the walnut plate
    ['--ink', '--surface', 4.5],
    ['--ink-soft', '--surface', 4.5],
    // the stats switch plate: label, intro, eye glyph
    ['--ink', '--control-fill', 4.5],
    ['--ink-soft', '--control-fill', 4.5],
    ['--gold', '--control-fill', 3],
    // the inbox tiles: the brass invitation tile, the raised one for the rest
    ['--gold-ink', '--gold', 3],
  ];
  const failures = [];
  for (const [fg, bg, bar] of pairs) {
    const ratio = contrast(token(fg, TISCH), token(bg, TISCH));
    if (!(ratio >= bar)) failures.push(`${fg} on ${bg} = ${ratio.toFixed(2)}:1 (bar ${bar})`);
  }
  assert.deepEqual(failures, []);
});

// Found in the merge interview (2026-09-24): an UNREAD row is raised to
// --control-fill, which is also the default icon tile's fill — so on exactly
// the rows that matter the tile vanished and the glyph floated bare. T14.2
// draws the tile one level off its row; on a raised row that is --surface.
// Equal specificity to the invitation's gold tile, so it must come first in
// the file or it would repaint the invitation's gold too.
test('an unread inbox row keeps its icon tile visible, and the invitation stays gold', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/tisch.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const H = ':root[data-design="tisch"][data-scheme="dark"] ';
  const unread = css.indexOf(H + '.inbox-row--unread .inbox-row__icon {');
  const invite = css.indexOf(H + '.inbox-row--round-invitation .inbox-row__icon {');
  assert.ok(unread > -1, 'no rule gives an unread row its own tile fill');
  assert.match(css.slice(unread, css.indexOf('}', unread)), /background:\s*var\(--surface\)/);
  assert.ok(invite > unread, 'the gold invitation tile must come after, or the unread rule repaints it');
});
