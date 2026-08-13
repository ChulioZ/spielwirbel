'use strict';

/* One back control, at the top of the content, on every screen that persistent
   chrome does not reach (#623).

   The rule this pins: **persistent chrome defines the main pages.** The brand
   mark reaches `/`, the inbox button `/inbox`, the account menu `/freunde` and
   `/konto`, and the dock/rail the four round sections — those get no back
   control. Everything else gets exactly one, first in the content column, at
   every width.

   Why it needs a test at all: before this, nine sub-screens ended with a
   centred button that CSS hid from 1280px up, so on a desktop there was no
   in-app way back from a game detail at all, and `/u/:username` and
   `/round/new` had none at any width. Nothing was red — a missing back control
   renders as a screen that merely looks finished.

   Rendered through the jsdom harness rather than matched over the view source
   (`.claude/rules/testing-views-under-jsdom.md`): the position of the control
   relative to the rail, the dock and the page head is the whole point, and a
   regex over `app.appendChild(backRow(…))` cannot see it. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RULES, whole } = require('./support/css');
const { loadApp } = require('./support/dom');

const RID = 'r1';
const ME = 'user-me';

/* The round every screen below is rendered against. One fixture covers all of
   them because each screen reads a different slice: an active game for the
   Regal and the game detail, one retired, one completed and one wished-for game
   so all three off-shelf screens have a row rather than their empty state, a
   finished session for the results and the Chronik. */
function roundFixture(over = {}) {
  return {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [{ id: 't1', name: 'Kennerspiel' }],
    members: [
      { id: 'm1', name: 'Anna', userId: ME, color: '#7f77dd' },
      { id: 'm2', name: 'Ben' },
    ],
    games: [
      { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: [] },
      { id: 'g2', title: 'Azul', retired: true, retiredAt: '2026-07-01T10:00:00.000Z', tagIds: [] },
      { id: 'g3', title: 'Cascadia', completed: true, completedAt: '2026-07-02T10:00:00.000Z', tagIds: [] },
      { id: 'g4', title: 'Ark Nova', wish: true, wishAt: '2026-07-03T10:00:00.000Z', tagIds: [] },
    ],
    sessions: [SESSION],
    ...over,
  };
}

const SESSION = {
  id: 's1',
  createdAt: '2026-08-02T18:00:00.000Z',
  gameIds: ['g1'],
  memberIds: ['m1', 'm2'],
  votes: { m1: { g1: { rating: 4, retire: false } }, m2: { g1: { rating: 5, retire: false } } },
  votedIds: ['m1', 'm2'],
  deviceVoting: false,
  done: true,
  finished: false,
  cancelled: false,
  winnerIds: ['g1'],
  chosenGameId: null,
  events: [],
};

/* A round-list row is the shape `listRoundSummaries` returns, not an invented
   object (`.claude/rules/testing-views-under-jsdom.md`). */
const SUMMARY = {
  id: RID, name: 'Freitagsrunde', members: [], memberCount: 2,
  gameCount: 1, sessionCount: 1, playedCount: 1, background: null, lastPlayed: null,
};

/** A booted app with the network answered from the fixture above. */
function bootApp(t, { loggedIn = true, profile = null } = {}) {
  const dom = loadApp();
  t.after(() => dom.close());
  const round = roundFixture();
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [SUMMARY];
    return {};
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => loggedIn);
  dom.set('currentUserId', () => ME);
  dom.set('accountApi', async (method, url) => {
    if (/^\/profile\//.test(url)) {
      return profile || { username: 'ada', createdAt: '2026-01-01T00:00:00.000Z', friendship: 'none' };
    }
    if (url === '/inbox') return { items: [] };
    if (url === '/friends/feed') return { events: [] };
    if (url === '/friends') return { incoming: [], outgoing: [], friends: [] };
    if (url === '/me') return { username: 'ada', email: 'a@example.com', createdAt: '2026-01-01T00:00:00.000Z' };
    return {};
  });
  return { dom, round };
}

/* The rail and the dock are PREPENDED into `.app` by renderSubScreenTabs, so
   "first in the content column" means first among everything else. Reading it
   this way rather than as `app.firstChild` is what lets one assertion cover
   both the round sub-screens (which render navigation) and `/round/new` and
   `/u/:username` (which do not). */
function contentChildren(app) {
  return [...app.children].filter((el) => !el.classList.contains('rail') && !el.classList.contains('dock'));
}

const firstContentChild = (app) => contentChildren(app)[0];

/* Proof that a screen actually rendered, for the loops below whose real
   assertion is about ABSENCE. Every screen here puts exactly one <h1> in its
   content column, and the rail carries one of its own — hence the content-only
   scope: on a round sub-screen the rail's heading would otherwise stand in for
   a body that rendered nothing at all. */
function assertRendered(app, name) {
  const content = contentChildren(app);
  assert.ok(content.length, `the ${name} screen rendered no content at all — check the fixture`);
  assert.ok(
    content.some((el) => el.matches('h1') || el.querySelector('h1')),
    `the ${name} screen's content column carries no heading, so it did not really render`,
  );
}

/** Every screen that must offer exactly one way back, and how to render it. */
const NON_MAIN = [
  ['design', (dom) => dom.call('showBackground', RID)],
  ['tags', (dom) => dom.call('showTags', RID)],
  ['game detail', (dom) => dom.call('showGameDetail', RID, 'g1')],
  ['member', (dom) => dom.call('showMember', RID, 'm1')],
  ['round settings', (dom) => dom.call('showRoundSettings', RID)],
  ['retired archive', (dom) => dom.call('showRetired', RID)],
  ['completed archive', (dom) => dom.call('showCompleted', RID)],
  ['wish list', (dom) => dom.call('showWishlist', RID)],
  ['session results', (dom, round) => dom.call('showResults', round, SESSION)],
  ['profile', (dom) => dom.call('showProfile', 'ada')],
  ['new round', (dom) => dom.call('showNewRound')],
];

/** Every screen persistent chrome reaches, which must therefore offer none. */
const MAIN = [
  ['home', (dom) => dom.call('showHome')],
  ['round start', (dom) => dom.call('showRound', RID, 'start')],
  ['regal', (dom) => dom.call('showRound', RID, 'regal')],
  ['chronik', (dom) => dom.call('showRound', RID, 'chronik')],
  ['pokale', (dom) => dom.call('showRound', RID, 'pokale')],
  ['inbox', (dom) => dom.call('showInbox')],
  ['freundeskreis', (dom) => dom.call('showFriends')],
  ['konto', (dom) => dom.call('showAccount')],
  // Reached from the account menu, like /freunde and /konto (#741).
  ['was ist neu', (dom) => dom.call('showNews')],
];

for (const [name, render] of NON_MAIN) {
  test(`the ${name} screen renders one back control, first in the content column`, async (t) => {
    const { dom, round } = bootApp(t);
    await render(dom, round);

    const rows = dom.app.querySelectorAll('.back-row');
    assert.equal(rows.length, 1, `the ${name} screen renders ${rows.length} back controls, expected exactly 1`);

    assertRendered(dom.app, name);
    const first = firstContentChild(dom.app);
    assert.ok(
      first.classList.contains('back-row'),
      `the ${name} screen's first content element is .${[...first.classList].join('.')}, `
      + 'so the way back is not where the user arrives',
    );

    // A history action, not a destination — so a real <button>, which is
    // focusable and Enter/Space-activated for free
    // (`.claude/rules/native-button-vs-focusable-span.md`).
    const btn = rows[0].querySelector('button');
    assert.ok(btn, `the ${name} screen's back control is not a <button>`);
    assert.ok(btn.textContent.trim(), `the ${name} screen's back control has no accessible name`);
  });
}

for (const [name, render] of MAIN) {
  test(`the ${name} screen renders no back control — chrome reaches it`, async (t) => {
    const { dom } = bootApp(t);
    await render(dom);
    /* An absence check is vacuously true on a screen that rendered NOTHING — a
       stub gap or a swallowed rejection would pass this loop while the app is
       broken. So prove the screen is really there first, exactly as the
       NON_MAIN loop does. */
    assertRendered(dom.app, name);
    /* The control that keeps the block above from being satisfied by a
       `backRow()` sprayed onto every screen: a main page's way "up" is the
       persistent chrome, and a second affordance there is noise. */
    assert.equal(dom.app.querySelectorAll('.back-row').length, 0,
      `the ${name} screen renders a back control although persistent chrome reaches it`);
  });
}

test('no rule hides the back control at any width', () => {
  /* The ≥1280px hide this replaces (`.app .back-row { display: none }`) is the
     defect, not a feature to re-scope: the rail is "up" — HUB_TAB_OF maps each
     sub-screen to exactly ONE owning section — while this control is "back",
     wherever you came from. Opening a game from Pokale and clicking Regal is a
     different, usually wrong destination.

     Asserted over the WHOLE sheet, media blocks included, because the parser
     sees through @media wrappers — so a hide reintroduced inside any breakpoint
     is caught here. */
  const hidden = RULES.filter(([sel, body]) => whole('.back-row').test(sel) && /display:\s*none/.test(body));
  assert.deepEqual(hidden.map(([sel]) => sel), [],
    'these rules hide the back control, leaving those screens with no in-app way back');
});
