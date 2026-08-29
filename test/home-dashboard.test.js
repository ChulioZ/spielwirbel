'use strict';

/* The home screen is a dashboard (#842).

   Before this, showHome() appended a full-shell round grid and then two narrow
   blocks that BOTH removed themselves when empty — so from 1280px up the page
   narrowed to a centred 900px column after a four-across grid, and an account
   with no friends got the grid and then a hole. The section it would have needed
   in order to find anyone was the one that had disappeared.

   What is pinned here is the behaviour of the four zones, which is invisible
   from a passing render: a zone that silently stops being appended, a resume
   ticket pointing at the wrong session, a news tile that marks itself seen (and
   so shows once and never again), and the width cap that fails by rendering
   FEWER columns rather than by erroring.

   Views are run for real under jsdom (.claude/rules/testing-views-under-jsdom.md);
   CSS is parsed out of styles.css, because jsdom applies no external stylesheet
   (.claude/rules/css-text-assertions-strip-comments.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RULES, bodyOf, mediaBlocks, whole } = require('./support/css');
const { loadApp } = require('./support/dom');

/** The shape listRoundSummaries returns (lib/repo/json.js), with open sessions. */
const roundOf = (over = {}) => ({
  id: 'r1',
  name: 'Donnerstagsrunde',
  members: [],
  memberCount: 0,
  gameCount: 3,
  sessionCount: 1,
  playedCount: 1,
  background: null,
  lastPlayed: null,
  openSessions: [],
  ...over,
});

/** The home screen over a given round list, rendered for real. */
const marked = [];

async function home(t, rounds, opts = {}) {
  marked.length = 0;
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => rounds);
  dom.set('accountsActive', () => opts.accounts !== false);
  dom.set('isLoggedIn', () => opts.loggedIn !== false);
  dom.set('hasUnseenNews', () => !!opts.unseenNews);
  // Opening /neu is the ONLY acknowledgement; a tile that marks it seen from
  // home shows once and is then gone unread (views-news.js's header).
  dom.set('markNewsSeen', async () => { marked.push(1); });
  // The two async tiles: stub the network rather than the helpers, so the real
  // mount code decides whether to render or remove itself.
  dom.set('accountApi', async () => opts.feed || { friendCount: 0, events: [] });
  dom.set('fetch', async () => ({ ok: false, json: async () => null }));
  await dom.call('showHome');
  await new Promise((r) => setTimeout(r, 0));
  return dom;
}

/* --------------------------------- zone 2 --------------------------------- */

test('a session still collecting votes shows a resume ticket that opens that session', async (t) => {
  const { document } = await home(t, [roundOf({
    openSessions: [{
      id: 's7', stage: 'voting', at: '2026-05-01T10:00:00.000Z', gameTitle: null, image: null,
    }],
  })]);

  const zone = document.querySelector('.home-resume');
  assert.ok(zone, 'no resume zone for a round with a session still running');
  const ticket = zone.querySelector('a.ticket');
  assert.ok(ticket, 'the resume zone rendered no ticket');
  /* ONE path for both stages — the router resolves the destination by session
     state, so home cannot disagree with it. A real <a href>, so Cmd-click works
     (.claude/rules/in-app-nav-links.md). */
  assert.equal(ticket.getAttribute('href'), '/round/r1/session/s7');
  assert.ok(ticket.classList.contains('nav-link'), 'the resume ticket is not wired through navLink()');
  // The round name is what tells you WHICH round, across all of them.
  assert.match(ticket.textContent, /Donnerstagsrunde/);

  /* Null title and cover BY CONSTRUCTION: the draw stays secret until everyone
     has rated. A ticket that named the game here would leak the draw to whoever
     opens home — the exact reason the round hub's own ticket shows neither. */
  assert.equal(ticket.querySelector('.ticket__img').getAttribute('style'), null,
    'the voting ticket carries a cover image — the draw is supposed to be secret');
});

test('a session whose vote closed shows a ticket naming the chosen game', async (t) => {
  const { document } = await home(t, [roundOf({
    openSessions: [{
      id: 's9', stage: 'results', at: '2026-05-03T10:00:00.000Z',
      gameTitle: 'Catan', image: '/uploads/c.jpg',
    }],
  })]);

  const ticket = document.querySelector('.home-resume a.ticket');
  assert.ok(ticket, 'no resume ticket for a session awaiting its result');
  assert.equal(ticket.getAttribute('href'), '/round/r1/session/s9');
  assert.match(ticket.textContent, /Catan/, 'the results ticket does not name the chosen game');
  assert.match(ticket.querySelector('.ticket__img').getAttribute('style') || '', /uploads\/c\.jpg/,
    'the results ticket renders no cover art');
});

test('the resume zone is absent entirely when nothing is running', async (t) => {
  /* The control that makes the two specs above non-vacuous: every assertion up
     there is satisfied by a showHome that renders a zone unconditionally. */
  const { document } = await home(t, [roundOf()]);
  assert.equal(document.querySelector('.home-resume'), null,
    'an empty resume zone is rendered when no session is running');
  assert.ok(document.querySelector('.lobby-list'), 'the round grid went missing with it');
});

test('the resume heading sits OUTSIDE the ticket grid, so auto-fit can collapse', async (t) => {
  /* The one the CSS text assertion could not catch, found by measuring at
     1440px. `grid-column: 1 / -1` on a heading INSIDE the grid occupies every
     track, so no track is ever empty and `auto-fit` collapses nothing — two
     tickets sat in three 457px tracks with a hole beside them, and one ticket
     would have been stranded ~340px against the left edge.

     The stylesheet still said `auto-fit`, and the spec that asserts it still
     passed. Only the DOM shape distinguishes the two, so that is what is
     pinned: the grid holds tickets and nothing else. */
  const { document } = await home(t, [roundOf({
    openSessions: [{ id: 's1', stage: 'voting', at: '2026-05-01T10:00:00.000Z', gameTitle: null, image: null }],
  })]);

  const list = document.querySelector('.home-resume__list');
  assert.ok(list, 'the resume tickets are not in their own grid');
  const stray = [...list.children].filter((n) => !n.classList.contains('ticket'));
  assert.deepEqual(stray.map((n) => n.className), [],
    'a non-ticket child is inside the resume grid — if it spans the tracks, auto-fit collapses nothing');

  const head = document.querySelector('.home-resume__head');
  assert.ok(head, 'the resume zone lost its heading');
  assert.equal(head.closest('.home-resume__list'), null, 'the heading is inside the ticket grid again');
});

test('resume tickets interleave rounds newest-first and are capped', async (t) => {
  /* The cap is a screen budget, separate from the repo's per-round payload cap:
     a member of eight rounds could otherwise push the round grid below the fold.
     The sort is what makes the cap keep the RIGHT three — the per-round arrays
     arrive newest-first individually, so without it the cap would keep whichever
     round happened to come first. */
  const mk = (id, at) => ({ id, stage: 'voting', at, gameTitle: null, image: null });
  const { document } = await home(t, [
    roundOf({ id: 'a', name: 'A', openSessions: [mk('a1', '2026-05-01T10:00:00.000Z'), mk('a2', '2026-05-06T10:00:00.000Z')] }),
    roundOf({ id: 'b', name: 'B', openSessions: [mk('b1', '2026-05-09T10:00:00.000Z'), mk('b2', '2026-05-07T10:00:00.000Z')] }),
  ]);

  const hrefs = [...document.querySelectorAll('.home-resume a.ticket')].map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, ['/round/b/session/b1', '/round/b/session/b2', '/round/a/session/a2']);
});

test('the resume zone sits ABOVE the round grid in the DOM, so it does at every width', async (t) => {
  /* DOM order is the phone order AND the tab order — the zones are real DOM
     groups and nothing may reorder them with CSS `order`. A session people are
     mid-way through is the most actionable thing on the screen. */
  const { document, app } = await home(t, [roundOf({
    openSessions: [{ id: 's1', stage: 'voting', at: '2026-05-01T10:00:00.000Z', gameTitle: null, image: null }],
  })]);
  const order = [...app.children].map((n) => n.className.split(' ')[0]);
  assert.deepEqual(order, ['lobby-head', 'home-resume', 'lobby-list', 'home-dash'],
    `home zones are in the wrong DOM order: ${order.join(' -> ')}`);
  assert.ok(document);
});

/* --------------------------------- zone 4 --------------------------------- */

test('with zero friends the Freundeskreis tile invites instead of removing itself', async (t) => {
  const { document } = await home(t, [roundOf()], { feed: { friendCount: 0, events: [] } });

  const section = document.querySelector('#homeFriends');
  assert.ok(section, 'the Freundeskreis section removed itself on an account with no friends');
  const invite = section.querySelector('a.friends-invite');
  assert.ok(invite, 'no invite card in the empty Freundeskreis tile');
  assert.equal(invite.getAttribute('href'), '/freunde');
  assert.ok(invite.classList.contains('nav-link'), 'the invite card is not wired through navLink()');
});

test('with friends but no events the tile keeps its existing empty note', async (t) => {
  const { document } = await home(t, [roundOf()], { feed: { friendCount: 2, events: [] } });
  const section = document.querySelector('#homeFriends');
  assert.ok(section);
  assert.ok(section.querySelector('.empty-note'), 'the friends-but-no-events note went missing');
  assert.equal(section.querySelector('.friends-invite'), null,
    'an account WITH friends is shown the find-friends invite');
});

test('the Freundeskreis tile still removes itself outside accounts mode', async (t) => {
  /* "This instance has no friends feature" is a different answer from "you have
     nobody yet", and only the second one gets an empty state. */
  const { document } = await home(t, [roundOf()], { accounts: false, loggedIn: false });
  assert.equal(document.querySelector('#homeFriends'), null);
  assert.equal(document.querySelector('.friends-invite'), null);
});

test('the news tile appears only while there is unseen news, and never marks it seen', async (t) => {
  const dom = await home(t, [roundOf()], { unseenNews: true });
  const tile = dom.document.querySelector('a.home-news');
  assert.ok(tile, 'no news tile while there is unseen news');
  assert.equal(tile.getAttribute('href'), '/neu');
  // It names the newest entry rather than being a generic "something is new".
  const newest = dom.get('NEWS')[0];
  assert.match(tile.textContent, new RegExp(newest.de.title.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  /* The two properties the Nutzungsbedingungen §11 reasoning actually protects.
     A dismiss control would train the dismiss GESTURE, and marking it seen from
     home would burn the entry without anyone having read it — either one turns
     the terms notice into a strip people clear unread (views-news.js's header). */
  assert.equal(tile.querySelector('button'), null, 'the news tile carries a dismiss control');
  assert.equal(marked.length, 0,
    'the home tile called markNewsSeen() — the entry is burnt before anyone has read it');
});

test('no news tile once the news has been seen', async (t) => {
  const { document } = await home(t, [roundOf()], { unseenNews: false });
  assert.equal(document.querySelector('.home-news'), null,
    'the news tile renders after /neu has been opened');
});

test('the dashboard region is coherent with every tile absent', async (t) => {
  /* The all-absent case: no friends section (not in accounts mode), no stats
     (the payload 404s), no news. The grid must then be EMPTY rather than
     holding stray containers, so `.home-dash:empty` can collapse it. */
  const { document } = await home(t, [roundOf()], { accounts: false, loggedIn: false });
  const dash = document.querySelector('.home-dash');
  assert.ok(dash, 'the dashboard container went missing');
  assert.equal(dash.children.length, 0,
    `the empty dashboard still holds ${dash.children.length} node(s), so :empty cannot collapse it`);
});

test('the first-run screen keeps its .lobby-cta and grows no grid', async (t) => {
  // #358's empty state must survive the rebuild: no rounds, no resume zone, and
  // the centred CTA rather than a one-card grid.
  const { document } = await home(t, [], { accounts: false, loggedIn: false });
  assert.ok(document.querySelector('.lobby-cta'), 'the first-run CTA was lost');
  assert.equal(document.querySelector('.lobby-list'), null);
  assert.equal(document.querySelector('.home-resume'), null);
});

/* ----------------------------------- CSS ----------------------------------- */

test('the new zones are exempt from the --w-read cap, and only alongside the round grid', () => {
  /* The whole point of #842: from 1280px `.app` is --w-shell (1800px) and every
     direct child is capped at --w-read (900px). The two blocks that used to
     trail the round grid were never exempted, so the page narrowed to a centred
     half-width column below the fold.

     This fails SILENTLY when wrong — a zone renders fewer columns, which reads
     as "the shell is too narrow" rather than as a lost rule. */
  const wide = mediaBlocks().filter(([q]) => /min-width:\s*1280px/.test(q));
  assert.ok(wide.length, 'no min-width: 1280px block found');

  const exemptions = RULES.filter(([sel]) => /max-width:\s*none/.test(bodyOf(sel) || ''));
  const covers = (cls) => exemptions.some(([sel]) => whole(cls).test(sel));
  for (const cls of ['.home-resume', '.home-dash']) {
    assert.ok(covers(cls), `${cls} is not exempt from --w-read — it will render at 900px under a full-shell grid`);
  }
  // Not vacuous: the pre-existing exemption must still be there, so a wholesale
  // deletion fails here rather than making the two above trivially true.
  assert.ok(covers('.lobby-list'), 'the lobby grid lost its width exemption');

  /* Conditioned on the round grid for the same reason `.lobby-head` is: with no
     rounds the screen is the centred first-run CTA (#358), and a full-shell
     dashboard under it recreates that misalignment one screen over. */
  const [sel] = exemptions.find(([s]) => whole('.home-dash').test(s));
  assert.match(sel, /:has\(\.lobby-list\)/,
    'the dashboard exemption is unconditional — it will stretch under the centred first-run CTA');
});

test('both zone grids use auto-fit, so a lone tile is not stranded on the left', () => {
  /* `auto-fill` keeps empty tracks, so ONE ticket or ONE tile packs ~340px wide
     against the left edge of an 1800px shell — the exact defect #358 fixed on
     the empty lobby, which is why it is worth pinning rather than assuming. */
  for (const cls of ['.home-resume__list', '.home-dash']) {
    const body = bodyOf(cls);
    assert.ok(body, `${cls} rule not found`);
    assert.match(body, /grid-template-columns:\s*repeat\(auto-fit,/,
      `${cls} uses auto-fill — a single item will pack left instead of filling the row`);
  }
});

test('an empty dashboard grid collapses instead of leaving its margin behind', () => {
  const body = bodyOf('.home-dash:empty');
  assert.ok(body, '.home-dash:empty rule not found — an all-absent dashboard leaves a gap');
  assert.match(body, /display:\s*none/);
});
