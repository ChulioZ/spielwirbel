'use strict';

/* The PWA install nudge (issue #616): the app has been installable since #142
   but nothing anywhere suggested installing it, and with #143/#144 closed
   won't-do the PWA *is* the mobile story.
 *
 * Three layers, tested three ways:
 *
 *  - the decision helpers are pure and are required straight into Node, which
 *    is why they live in their own small file rather than being exported from a
 *    view (.claude/rules/frontend-helper-modules-and-coverage.md);
 *  - the dismissal flag is exercised through jsdom, NOT through a Node require:
 *    Node has no `localStorage`, so `installOfferDismissed()` there returns
 *    false through its own catch and an assertion on the default would be
 *    vacuously green whichever way round the flag was written;
 *  - both placements are RENDERED and asserted on the produced nodes
 *    (.claude/rules/testing-views-under-jsdom.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, translator } = require('./support/dom');
const {
  installStateFrom,
  isIosDevice,
  INSTALL_DISMISSED_KEY,
} = require('../public/js/install-prompt');

// Real user-agent shapes. The Macintosh one is not decoration: iPadOS 13+ sends
// exactly that string, so the ONLY thing separating an iPad from a Mac is the
// touch-point count — and getting it wrong shows Share-sheet steps to a desktop
// user who has no Share sheet.
const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};

const env = (over) => ({ installed: false, canPrompt: false, userAgent: '', maxTouchPoints: 0, ...over });

// =================== The pure decision helpers ===================

test('a browser that offered a beforeinstallprompt event gets the real button', () => {
  assert.equal(installStateFrom(env({ canPrompt: true, userAgent: UA.android })), 'prompt');
});

test('iOS gets the Share-sheet steps, because no programmatic prompt exists there', () => {
  assert.equal(installStateFrom(env({ userAgent: UA.iphone })), 'ios');
});

test('iPadOS is an iOS device despite its desktop UA — a real Mac is not', () => {
  assert.equal(isIosDevice(env({ userAgent: UA.mac, maxTouchPoints: 5 })), true);
  assert.equal(isIosDevice(env({ userAgent: UA.mac, maxTouchPoints: 0 })), false);
  // …and the whole decision follows it, so a desktop Safari user is never told
  // to tap a Share button it does not have.
  assert.equal(installStateFrom(env({ userAgent: UA.mac, maxTouchPoints: 5 })), 'ios');
  assert.equal(installStateFrom(env({ userAgent: UA.mac, maxTouchPoints: 0 })), 'none');
});

test('an already-installed app offers nothing, on either platform', () => {
  assert.equal(installStateFrom(env({ installed: true, canPrompt: true, userAgent: UA.android })), 'installed');
  assert.equal(installStateFrom(env({ installed: true, userAgent: UA.iphone })), 'installed');
});

test('a desktop browser that never offered a prompt gets nothing', () => {
  assert.equal(installStateFrom(env({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0' })), 'none');
});

// =================== The dismissal flag ===================

/* MUST NOT call the setter: the flag's DEFAULT is what decides whether the
   offer is ever shown at all, and a test that establishes the state it then
   asserts is blind to a wrong-way-round default
   (.claude/rules/break-the-code-on-purpose.md). Written the other way round,
   `installOfferDismissed()` returns true on a device that has never seen the
   offer and the whole feature is dark. */
test('the offer is NOT dismissed on a device that has never seen it', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  assert.equal(dom.run('installOfferDismissed()'), false);
});

test('dismissing it writes a flag that survives a fresh render', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.run('dismissInstallOffer()');
  assert.equal(dom.run('installOfferDismissed()'), true);
  assert.equal(dom.window.localStorage.getItem(INSTALL_DISMISSED_KEY), '1');
});

// =================== Placement 1: the Konto screen ===================

const ME = { id: 'u1', email: 'anna@example.com', username: 'anna', demo: false };

async function konto(t, { state = 'prompt', me = ME } = {}) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('accountApi', async () => me);
  dom.set('installState', () => state);
  await dom.call('showAccount');
  return dom;
}

test('the Konto screen offers a working install button where a prompt exists', async (t) => {
  const dom = await konto(t, { state: 'prompt' });
  const t_ = translator('de');
  const section = dom.app.querySelector('.install-section');
  assert.ok(section, 'no install section rendered');
  assert.ok(dom.app.textContent.includes(t_('install.title')));
  const btn = section.querySelector('.install-cta');
  assert.ok(btn, 'no install button');

  let ran = 0;
  dom.set('runInstallPrompt', async () => { ran++; return 'accepted'; });
  btn.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ran, 1, 'the button did not drive the stashed prompt');
});

test('iOS gets the Share-sheet steps and NO button, since none could work', async (t) => {
  const dom = await konto(t, { state: 'ios' });
  const section = dom.app.querySelector('.install-section');
  assert.ok(section, 'no install section rendered');
  assert.equal(section.querySelector('.install-cta'), null, 'iOS was offered a button that cannot work');
  assert.ok(section.textContent.includes(translator('de')('install.ios.steps')));
});

test('an installed app renders no section at all — not even an empty heading', async (t) => {
  for (const state of ['installed', 'none']) {
    const dom = await konto(t, { state });
    assert.equal(dom.app.querySelector('.install-section'), null, `state ${state} rendered a section`);
    assert.ok(!dom.app.textContent.includes(translator('de')('install.title')), `state ${state} rendered the heading`);
  }
});

/* A guest demo (#427/#502) self-erases on a TTL, so an icon on the home screen
   would point at an account that is about to stop existing — the same reasoning
   that already keeps the password form and the notification switches off this
   screen for a demo. */
test('a demo account is never nudged to install', async (t) => {
  const dom = await konto(t, { state: 'prompt', me: { ...ME, demo: true } });
  assert.equal(dom.app.querySelector('.install-section'), null);
});

// =================== Placement 2: one offer after a finished session ===================

function roundFixture() {
  return {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
    games: [
      { id: 'g1', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
    ],
    sessions: [],
  };
}

function sessionFixture() {
  return {
    id: 's1',
    createdAt: '2026-08-02T18:00:00.000Z',
    gameIds: ['g1', 'g2'],
    memberIds: ['m1', 'm2'],
    events: [],
    votes: {
      m1: { g1: { rating: 5, retire: false }, g2: { rating: 3, retire: false } },
      m2: { g1: { rating: 4, retire: false }, g2: { rating: 2, retire: false } },
    },
    votedIds: ['m1', 'm2'],
    done: true,
    cancelled: false,
    finished: false,
    winnerIds: [],
    chosenGameId: null,
  };
}

async function results(t, { reveal = true, state = 'prompt', demo = false, dismissed = false } = {}) {
  const round = roundFixture();
  const session = sessionFixture();
  round.sessions = [session];
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => round);
  dom.set('isLoggedIn', () => true);
  dom.set('isDemoAccount', () => demo);
  dom.set('installState', () => state);
  if (dismissed) dom.run('dismissInstallOffer()');
  await dom.call('showResults', round, session, null, reveal);
  return dom;
}

test('finishing a session offers the install once, below the results', async (t) => {
  const dom = await results(t, { reveal: true });
  const card = dom.app.querySelector('.install-offer');
  assert.ok(card, 'no install offer after a finished session');
  assert.ok(card.textContent.includes(translator('de')('install.offer.title')));

  // Below the games, and above the footer: „Session abbrechen"/„löschen" must
  // stay the last thing on the screen (#614), so a promo may not follow them.
  const FOLLOWING = dom.window.Node.DOCUMENT_POSITION_FOLLOWING;
  const firstRow = dom.app.querySelector('.result-row');
  const footer = dom.app.querySelector('.result-footer');
  assert.ok(firstRow.compareDocumentPosition(card) & FOLLOWING, 'the offer interrupts the results');
  assert.ok(card.compareDocumentPosition(footer) & FOLLOWING, 'the offer landed after the destructive footer');
});

/* `reveal` is passed only by the three "the session just closed here" callers
   (the finale's reveal button and the two lobby paths); showResultsById, the
   Chronik rows and the Start tickets all leave it undefined — which is what
   keeps the offer from reappearing every time an old evening is looked up. */
test('revisiting an old result never offers anything', async (t) => {
  const dom = await results(t, { reveal: false });
  assert.equal(dom.app.querySelector('.install-offer'), null);
});

test('dismissing the offer stops it coming back on that device', async (t) => {
  const dom = await results(t, { reveal: true });
  const card = dom.app.querySelector('.install-offer');
  card.querySelector('.install-offer__dismiss').click();
  assert.equal(dom.app.querySelector('.install-offer'), null, 'the card stayed on screen');
  assert.equal(dom.run('installOfferDismissed()'), true, 'nothing was remembered');
});

test('an already-dismissed device is not offered again', async (t) => {
  const dom = await results(t, { reveal: true, dismissed: true });
  assert.equal(dom.app.querySelector('.install-offer'), null);
});

test('acting on the offer also stops it coming back', async (t) => {
  const dom = await results(t, { reveal: true });
  dom.set('runInstallPrompt', async () => 'accepted');
  dom.app.querySelector('.install-offer .install-cta').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(dom.run('installOfferDismissed()'), true);
});

test('a demo account is offered nothing after a session either', async (t) => {
  const dom = await results(t, { reveal: true, demo: true });
  assert.equal(dom.app.querySelector('.install-offer'), null);
});

test('an installed app is offered nothing after a session', async (t) => {
  const dom = await results(t, { reveal: true, state: 'installed' });
  assert.equal(dom.app.querySelector('.install-offer'), null);
});
