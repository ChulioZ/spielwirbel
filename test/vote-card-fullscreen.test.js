'use strict';

/* The rating step runs FULL-SCREEN (#1185).

   The vote card is the one screen in the app that must hold the device by
   itself: whoever is rating is looking at a secret, the person beside them is
   waiting for the handover, and every control the top bar offers — inbox,
   account, feedback, support, the language picker — is a way out of a flow with
   unsaved votes in it. So `voteScreen()` (core.js) puts a class on <body> and
   CSS hides the chrome.

   Two halves, and they need different instruments. The CLASS is a DOM fact and
   is asserted by running the real wizard in the jsdom harness. What the class
   HIDES is CSS, which jsdom never applies
   (`.claude/rules/testing-views-under-jsdom.md`), so the stylesheet is read as
   text through test/support/css.js.

   The teardown is the part worth guarding hardest. There is exactly ONE setter
   (startVoting's render) and exactly ONE clearer (setContext, which every screen
   calls to name itself), rather than a clear on each of the four ways out —
   finish(), guardLeave(), the popstate finale branch and opts.onSaved. Four
   chances to forget one, and forgetting one leaves the app with no top bar at
   all, on every screen, until a reload. The cases below walk the real paths. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { RULES, bodyOf, declaredValue } = require('./support/css');
const { setMotion } = require('./support/vote-card');

const MEMBER = { id: 'm1', name: 'Anna', color: '#7f77dd' };
const GAMES = [
  { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4 },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4 },
];

const roundFixture = () => ({
  id: 'r1',
  name: 'Freitagsrunde',
  background: null,
  members: [MEMBER],
  games: [],
  sessions: [],
  tags: [],
});

const sessionFixture = () => ({
  id: 's1',
  createdAt: '2026-08-06T18:00:00.000Z',
  gameIds: ['g1', 'g2'],
  memberIds: ['m1'],
  votes: {},
  votedIds: [],
  done: false,
  cancelled: false,
  finished: false,
  winnerIds: [],
  chosenGameId: null,
});

/* `skipIntro` decides which step the wizard opens on, which is the whole
   distinction under test: false opens on the handover screen (chrome ON), true
   opens straight on a rating card (chrome OFF). */
async function wizard(t, { skipIntro }) {
  const dom = loadApp();
  t.after(() => dom.close());
  setMotion(dom, true);
  dom.set('api', async () => roundFixture());
  await dom.call('startVoting', roundFixture(), sessionFixture(), GAMES, [MEMBER], {
    skipIntro,
    saveVotes: async () => {},
    onSaved: async () => {},
  });
  return dom;
}

const immersive = (dom) => dom.document.body.classList.contains('vote-screen');

test('a rating step hides the app chrome', async (t) => {
  const dom = await wizard(t, { skipIntro: true });
  assert.ok(dom.app.querySelector('.vote'), 'the wizard did not open on a rating card');
  assert.ok(immersive(dom), 'the rating step left the top bar up');
});

test('the handover screen KEEPS the chrome', async (t) => {
  // The narrowest case, and the reason the setter is a per-step expression
  // rather than a one-shot call when the wizard starts: „du bist dran, nicht
  // spicken" is a screen you hand a device across, not a secret.
  const dom = await wizard(t, { skipIntro: false });
  assert.ok(dom.app.querySelector('.handover'), 'the wizard did not open on the handover screen');
  assert.equal(immersive(dom), false, 'the handover screen hid the top bar');
});

test('advancing from the handover to the first card turns the chrome off', async (t) => {
  const dom = await wizard(t, { skipIntro: false });
  dom.app.querySelector('#goBtn').click();
  assert.ok(dom.app.querySelector('.vote'), '„Los" did not reach a rating card');
  assert.ok(immersive(dom), 'the first rating card left the top bar up');
});

test('no dock is rendered over a rating card', async (t) => {
  /* Asserted as an ABSENCE rather than implemented as a CSS hide. startVoting
     renders no navigation at all, so `body.vote-screen .dock { display: none }`
     would be a selector that can never match — a guard nobody could ever observe
     failing (.claude/rules/redundant-guards-make-each-other-untestable.md).
     This is what would notice if a future change started rendering one. */
  const dom = await wizard(t, { skipIntro: true });
  assert.equal(dom.app.querySelector('.dock'), null, 'a rating card grew a hub dock');
  assert.equal(dom.app.querySelector('.rail'), null, 'a rating card grew a desktop rail');
});

test('navigating out of the wizard restores the chrome', async (t) => {
  // The real teardown path, through the real screen: showRound calls setContext
  // to name the round in the bar, and that call is the clear. No exit path in
  // startVoting touches the class.
  const dom = await wizard(t, { skipIntro: true });
  assert.ok(immersive(dom), 'precondition: the card is immersive');
  await dom.call('showRound', 'r1', 'start');
  assert.equal(immersive(dom), false, 'leaving the wizard left the app with no top bar');
});

test('re-rendering the card for a language switch keeps the chrome off', async (t) => {
  // `currentView` is `() => render()` here, so the picker re-runs exactly the
  // expression that sets the class. Cheap to assert and it pins that the setter
  // lives inside render() rather than beside the wizard's one-time setup.
  const dom = await wizard(t, { skipIntro: true });
  dom.run('currentView()');
  assert.ok(immersive(dom), 'a language switch mid-vote put the top bar back');
});

// ------------------------------------------------------------------- the CSS

test('body.vote-screen hides the whole top bar', () => {
  const body = bodyOf('body.vote-screen .topbar');
  assert.ok(body, 'no rule hides the top bar on a rating step');
  assert.equal(declaredValue(body, 'display'), 'none');
});

test('the rule hides the WHOLE bar, not the pieces auth-screen hides', () => {
  /* auth-screen hides `.topbar__home`, `#feedbackBtn` and `.topbar__context`
     and deliberately keeps the language picker. A rating card has four words on
     it; a lone picker floating above them is noise, and it is also a control
     that re-renders the card. So the selector must be the bar itself — if this
     is ever relaxed to a list of children, that is a decision, not a tidy-up. */
  const selectors = RULES.map(([sel]) => sel).filter((sel) => sel.includes('vote-screen'));
  assert.deepEqual(selectors, ['body.vote-screen .topbar'],
    'the immersive rating step hides something other than exactly the top bar');
});

test('the card carries a back control of at least 44px', () => {
  /* WCAG 2.5.8 / the issue's own floor: with the bar gone, `.vote__undo` is the
     ONLY way out of the card, so its size stops being a nicety. The value is a
     custom property on `.vote__who` — the row that hosts the button — which both
     the width and the height read, so it is asserted there rather than on the
     button itself. That row also sizes its own `min-height` from it, so shrinking
     the control below 44px cannot be done without this failing. */
  const card = bodyOf('.vote__who');
  assert.ok(card, 'the vote card lost the row that hosts its back control');
  const size = declaredValue(card, '--undo-size');
  assert.ok(size, '.vote__who no longer defines --undo-size');
  assert.ok(parseFloat(size) >= 44, `the only way out of an immersive card is ${size}`);

  const undo = bodyOf('.vote__undo');
  assert.equal(declaredValue(undo, 'width'), 'var(--undo-size)');
  assert.equal(declaredValue(undo, 'height'), 'var(--undo-size)');
});
