'use strict';

/* The accept whirl (#1095) — slice 4 of 4 of „Der Kreis".
 *
 * The whole risk here is the SECOND render. `showFriends` is what `currentView`
 * re-runs on a locale switch, and it is also what a decline, an unfriend and the
 * next accept call. A mark that survives any of those replays the animation on a
 * render that has nothing to do with accepting anybody — which is worse than no
 * animation, because it stops reading as an event and starts reading as noise.
 *
 * So the assertions are mostly about the whirl being ABSENT: on the second
 * render, on every card but one, and on every other action. The one positive
 * case is the control that keeps the rest from being vacuous.
 *
 * The animation itself is CSS and is not asserted here beyond the class — the
 * keyframe and its reduced-motion gating are text, checked in
 * test/motion-*.test.js style by the css support helper below.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');
const { mediaBlocks, rulesOf, CSS } = require('./support/css');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('accountsActive', () => true);
dom.set('isLoggedIn', () => true);
dom.set('refreshInboxBadge', () => {});
dom.set('showHome', () => {});
dom.set('toast', () => {});

const person = (username, over = {}) => ({
  username, avatar: null, friendshipId: 'f-' + username, ...over,
});

// The server state the stub answers from, so an accept can actually move a
// person from `incoming` into `friends` the way the real endpoint does.
let state;
let posts;
function serve(initial) {
  state = initial;
  posts = [];
  dom.set('accountApi', async (method, path) => {
    if (method === 'POST' || method === 'DELETE') {
      posts.push(path);
      const m = /^\/friends\/f-([^/]+)/.exec(path);
      if (m && /accept$/.test(path)) {
        state.incoming = state.incoming.filter((p) => p.username !== m[1]);
        state.friends = state.friends.concat([person(m[1])]);
      }
      return {};
    }
    return path === '/friends'
      ? { friends: [], incoming: [], outgoing: [], ...state }
      : { events: [] };
  });
}

const cardFor = (name) => [...dom.app.querySelectorAll('.k-card')]
  .find((c) => (c.querySelector('.friend-row__name') || {}).textContent === name);
const whirling = () => [...dom.app.querySelectorAll('.k-card--whirl')]
  .map((c) => (c.querySelector('.friend-row__name') || {}).textContent);

const settle = () => new Promise((r) => setImmediate(r));

async function accept(name) {
  cardFor(name).querySelector('.friend-req__accept').click();
  await settle();
  await settle();
}

/* ------------------------------ the one moment ---------------------------- */

test('accepting whirls exactly ONE card — the newly accepted friend', async () => {
  serve({ friends: [person('dora'), person('erik')], incoming: [person('ada')] });
  await dom.call('showFriends');
  assert.deepEqual(whirling(), [], 'nothing whirls on a plain render');

  await accept('ada');
  assert.deepEqual(whirling(), ['ada'], 'the accepted friend, and nobody else');
  assert.ok(cardFor('ada').className.includes('k-card--friend'),
    'and it has rejoined the roster as an ordinary friend card');
});

test('the toast and the inbox badge still fire, and the accept still POSTs', async () => {
  const toasts = [];
  const badges = [];
  dom.set('toast', (m) => toasts.push(m));
  dom.set('refreshInboxBadge', () => badges.push(1));
  serve({ friends: [], incoming: [person('ada')] });
  await dom.call('showFriends');
  await accept('ada');

  assert.deepEqual(posts, ['/friends/f-ada/accept']);
  assert.equal(toasts.length, 1, 'the accepted toast still fires exactly once');
  assert.equal(badges.length, 1, 'and refreshInboxBadge() with it');
  dom.set('toast', () => {});
  dom.set('refreshInboxBadge', () => {});
});

/* --------------------------- the mark must not stick ---------------------- */

test('the whirl does NOT survive the next render', async () => {
  serve({ friends: [person('dora')], incoming: [person('ada')] });
  await dom.call('showFriends');
  await accept('ada');
  assert.deepEqual(whirling(), ['ada'], 'the control: it whirled once');

  await dom.call('showFriends');
  assert.deepEqual(whirling(), [], 'a plain re-render must not replay it');
});

test('a locale switch does not replay the whirl', async () => {
  /* `currentView` is the callback the language picker re-runs, and it is set
     from the same opts the accept passed in — so this is the exact path the
     mark would leak through. */
  serve({ friends: [], incoming: [person('ada')] });
  await dom.call('showFriends');
  await accept('ada');
  assert.deepEqual(whirling(), ['ada'], 'the control');

  await dom.run('currentView')();
  await settle();
  assert.deepEqual(whirling(), [], 'the language picker must not replay it');
});

test('declining someone else does not whirl anybody', async () => {
  serve({ friends: [person('dora')], incoming: [person('ada'), person('ben')] });
  await dom.call('showFriends');
  cardFor('ben').querySelector('.friend-req__decline').click();
  await settle();
  await settle();
  assert.deepEqual(whirling(), [], 'declining is not a celebration');
});

test('a second accept whirls only the second person', async () => {
  serve({ friends: [], incoming: [person('ada'), person('ben')] });
  await dom.call('showFriends');
  await accept('ada');
  assert.deepEqual(whirling(), ['ada']);
  await accept('ben');
  assert.deepEqual(whirling(), ['ben'], 'the first one must have stopped whirling');
});

/* --------------------------------- the CSS -------------------------------- */

test('the whirl is GATED on no-preference, never cancelled by a reduce override', () => {
  /* The house form (styles.css explains why): the `from` keyframe is
     `opacity: 0`, so an override missed on one selector would leave the card
     INVISIBLE rather than merely unanimated. The issue proposed the override
     shape; this asserts it was not used. */
  const gated = mediaBlocks()
    .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
    .some(([, css]) => rulesOf(css).some(([sel]) => /\.k-card--whirl\b/.test(sel)));
  assert.ok(gated, '.k-card--whirl is not inside a prefers-reduced-motion: no-preference block');

  const cancelled = mediaBlocks()
    .filter(([q]) => /prefers-reduced-motion:\s*reduce/.test(q))
    .some(([, css]) => rulesOf(css).some(([sel]) => /\.k-card--whirl\b/.test(sel)));
  assert.equal(cancelled, false,
    'the whirl is cancelled by a reduce override — use the no-preference gate instead');

  /* And declared NOWHERE else, which would animate under reduced motion whatever
     the gate says. `rulesOf` deliberately sees THROUGH @media wrappers, so a
     whole-sheet lookup finds the gated rule and always "passes" — count instead,
     and require every occurrence to be one of the gated ones. */
  const whirlRules = (css) => rulesOf(css).filter(([sel]) => /\.k-card--whirl\b/.test(sel)).length;
  const inGate = mediaBlocks()
    .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
    .reduce((n, [, css]) => n + whirlRules(css), 0);
  assert.equal(whirlRules(CSS), inGate,
    '.k-card--whirl is declared outside the no-preference gate, so it animates under reduced motion');
});

test('the whirl settles on the rest state, so a dropped animationend cannot strand a card', () => {
  const kf = /@keyframes\s+whirl-in\s*\{([\s\S]*?)\n\s*\}/.exec(
    require('fs').readFileSync(require('path').join(__dirname, '..', 'public/styles.css'), 'utf8'));
  assert.ok(kf, 'the whirl-in keyframe is gone');
  assert.match(kf[1], /to\s*\{[^}]*transform:\s*none[^}]*opacity:\s*1/,
    'the `to` keyframe must BE the rest state');
});
