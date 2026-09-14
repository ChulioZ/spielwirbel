'use strict';

/* The pot (#1017) — the eligible-game preview on the session setup screen, and
 * what „Loswirbeln" does with it.
 *
 * Its own spec rather than more of test/content-width.test.js: that file is about
 * WIDTHS — which presentation is on at which breakpoint — and everything here is
 * about what the pot is made of. The two hide/show assertions it already owns
 * (`.setup-panel` defaults to hidden, `.pool-hint` is hidden from 860) still live
 * there and are deliberately not restated.
 *
 * #1122 removed the whirl the draw used to run, so the assertions that pinned its
 * two halves to each other are gone and what is pinned instead is the ABSENCE of
 * any delay: the draw must cost the POST and nothing on top of it. That failure
 * is silent in the only direction that matters — a re-added hold still opens the
 * lobby in the end, it just makes „Loswirbeln" feel slow again, which is the
 * complaint the removal answered.
 *
 * The timing half follows .claude/rules/mock-timers-jump-the-clock-before-firing.md:
 * it asks WHETHER a wait was armed rather than reading a timestamp from inside a
 * callback. Node's `mock.timers` cannot reach this code — the view calls jsdom's
 * `window.setTimeout`, not Node's — so the window's own timer is replaced with a
 * recorder, the same seam .claude/rules/jsdom-popstate-needs-a-real-timer.md uses.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');
const { CSS, RULES, bodyOf, rulesOf, mediaBlocks } = require('./support/css');

// Every rule inside any @media block whose query matches — the same flattening
// helper test/content-width.test.js keeps locally.
const rulesUnder = (re) => mediaBlocks()
  .filter(([query]) => re.test(query))
  .flatMap(([, css]) => rulesOf(css));

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }];
const GAMES = Array.from({ length: 9 }, (_, i) => ({
  id: `g${i + 1}`,
  title: `Spiel ${i + 1}`,
  minPlayers: 1,
  maxPlayers: 8,
}));

let rid = 0;
const roundFixture = (games = GAMES) => ({
  id: `pot-${++rid}`,
  name: 'Freitagsrunde',
  members: MEMBERS.map((m) => ({ ...m })),
  tags: [],
  sessions: [],
  games: games.map((g) => ({ ...g })),
});

const tiles = () => [...dom.app.querySelectorAll('.setup-panel__body .pool-tile')];
const shelf = () => [...dom.app.querySelectorAll('.pool-shelf .pool-thumb')];
/* ------------------------------- the pile ------------------------------- */

test('both presentations render the WHOLE pot, not a subset', async () => {
  await dom.call('showStartSession', roundFixture());

  assert.equal(tiles().length, GAMES.length, 'the stack does not render the whole pot');
  assert.equal(shelf().length, GAMES.length,
    'the shelf renders a subset — below 860px it is the ONLY presentation, so a capped one hides games');
});

/* ------------------------------ „Loswirbeln" ----------------------------- */

/* Replace jsdom's window timer with a recorder and hand back the runner. Node's
   t.mock.timers patches the TEST realm's globals; the view runs inside the vm
   context, where a bare `setTimeout` is `window.setTimeout`.

   It is still here after #1122 removed the whirl, and that is the point: the
   assertion has flipped from "a wait of exactly WHIRL_MS was armed" to "NO wait
   was armed at all", which is the acceptance criterion the operator asked for —
   the draw must cost the request and nothing on top of it. Without the recorder
   a re-added delay is invisible from a test, because the lobby still opens in
   the end. */
const captureTimers = () => {
  const armed = [];
  const real = dom.window.setTimeout;
  dom.window.setTimeout = (fn, ms) => { armed.push({ fn, ms }); return armed.length; };
  return {
    armed,
    restore: () => { dom.window.setTimeout = real; },
    fire: () => armed.splice(0).forEach((t2) => t2.fn()),
  };
};

test('the lobby opens as soon as the POST returns, and not a moment later', async (t) => {
  let opened = null;
  let finish;
  dom.set('showSessionLobby', (round, session) => { opened = session; });
  // Held in flight deliberately: a request that resolves immediately cannot tell
  // "opens when the response lands" from "opens after a delay that happens to be
  // short", so the slow response is the one that discriminates.
  dom.set('api', () => new Promise((resolve) => { finish = () => resolve({ session: { id: 's1' } }); }));
  const timers = captureTimers();
  t.after(timers.restore);

  await dom.call('showStartSession', roundFixture());
  dom.app.querySelector('#go').click();
  await flush();
  assert.equal(opened, null, 'the lobby opened before the draw had returned');

  finish();
  await flush();
  assert.equal(opened && opened.id, 's1', 'the lobby did not open when the request returned');
  assert.equal(timers.armed.length, 0,
    `the draw armed a wait of ${timers.armed.map((x) => x.ms).join(', ')}ms on top of the request`);
});

test('a failed draw toasts and leaves the setup screen usable', async (t) => {
  const toasts = [];
  dom.set('showSessionLobby', () => { throw new Error('the lobby must not open on a failed draw'); });
  dom.set('toast', (m) => toasts.push(m));
  let failDraw;
  let sent = 0;
  dom.set('api', () => new Promise((resolve, reject) => { sent += 1; failDraw = reject; }));
  const timers = captureTimers();
  t.after(timers.restore);

  await dom.call('showStartSession', roundFixture());
  dom.app.querySelector('#go').click();
  await flush();
  failDraw(new Error('Nope'));
  await flush();

  assert.deepEqual([...toasts], ['Nope']);
  assert.ok(dom.app.querySelector('.setup-grid--session'), 'the setup screen was torn down by a failure');
  assert.equal(timers.armed.length, 0, 'a failed draw armed a wait');
  // The whole point of the toast is that the reader can try again, which the
  // in-flight guard would prevent if the failure path did not release it. The
  // retry is asserted as a SENT request rather than as a second toast: this
  // second promise is never settled, so a toast would never arrive either way.
  dom.app.querySelector('#go').click();
  await flush();
  assert.equal(sent, 2, 'the in-flight guard was never released, so the screen is dead after one failure');
});

test('a guard that toasts never sends a draw', async (t) => {
  const toasts = [];
  dom.set('toast', (m) => toasts.push(m));
  dom.set('api', async () => { throw new Error('the draw must not be sent from an empty pot'); });
  const timers = captureTimers();
  t.after(timers.restore);

  // Nothing seats two people, so the pot is empty and the draw is refused before
  // it starts. (The other guard — nobody at the table — cannot be reached from
  // the ring: it refuses to un-seat the last member.)
  await dom.call('showStartSession', roundFixture([
    { id: 'g1', title: 'Nur zu fünft', minPlayers: 5, maxPlayers: 8 },
  ]));
  assert.equal(tiles().length, 0, 'the pot is not empty, so the guard below is not the one being exercised');

  dom.app.querySelector('#go').click();
  await flush();

  assert.equal(toasts[toasts.length - 1], dom.run("t('startSession.toast.noGames')"),
    'the empty-pot guard did not refuse the draw');
  assert.equal(timers.armed.length, 0, 'a refused draw armed a wait');
});

test('a second press while the draw is in flight does not send a second one', async (t) => {
  let sent = 0;
  let finish;
  dom.set('showSessionLobby', () => {});
  // Held in flight on purpose: #1122 removed the whirl that used to make this
  // window ~1s long, so the request itself is now the whole of it — which is
  // exactly why the guard stays rather than going with the animation.
  dom.set('api', () => {
    sent += 1;
    return new Promise((resolve) => { finish = () => resolve({ session: { id: 's3' } }); });
  });
  const timers = captureTimers();
  t.after(timers.restore);

  await dom.call('showStartSession', roundFixture());
  const go = dom.app.querySelector('#go');
  go.click();
  await flush();
  go.click();
  await flush();

  assert.equal(sent, 1,
    'the request is still in flight and the button is not disabled, so a second press books a second session');
  finish();
  await flush();
});

/* ------------------------ the two files agreeing ------------------------- */

/* #1122 removed the turn. Asserted as an absence for the same reason as the
 * press (`test/result-motion.test.js`): „Loswirbeln" is the app's own verb and a
 * turn is the obvious thing to give it, so without this nothing would object to
 * one coming back — and this one did not merely look like a wait, it WAS one. */
test('the pot does not turn — pot-whirl and the head start are gone from the sheet', () => {
  assert.equal([...CSS.matchAll(/@keyframes\s+pot-whirl\b/g)].length, 0,
    'the pot-whirl keyframe is declared again');
  const users = RULES.filter(([, body]) => /animation[-a-z]*:[^;]*pot-whirl/.test(body)).map(([sel]) => sel);
  assert.deepEqual(users, [], 'something still turns the pot');
  // `--wd` was the per-cover head start, written inline by the view. Nothing else
  // ever read it, so a rule consuming it means the stagger came back too.
  const staggered = RULES.filter(([, body]) => /var\(--wd/.test(body)).map(([sel]) => sel);
  assert.deepEqual(staggered, [], 'a per-cover head start is being read again');
});

test('the pot lifts a cover under the pointer, and only inside the panel', () => {
  /* `.pool-tile` is also the member page's game grid, which is a catalogue and
     wants no hover of its own — an unscoped rule reaches it silently. */
  const hover = RULES.find(([sel, body]) =>
    /\.pool-tile:hover/.test(sel) && /transform:\s*scale/.test(body));
  assert.ok(hover, 'nothing lifts a cover under the pointer');
  assert.match(hover[0], /\.setup-panel__body/,
    `"${hover && hover[0]}" lifts every .pool-tile, including the member page's game grid`);
});

test('the phone hides the pot caption from the EYE, not from the reader', () => {
  /* On a phone the caption is pure repetition — the action bar states the whole
     phrase — and it is the widest thing competing with the covers for the bar's
     one row: it cost 81px of 362, leaving two covers visible instead of three.
     `display: none` is the obvious way to reclaim that and is silently worse:
     it leaves a screen reader a bare „8" sitting in the filter bar. */
  const phone = rulesUnder(/max-width:\s*(639|640)px/);
  const hidden = phone.filter(([sel]) => /\.pool-count__label/.test(sel));
  assert.equal(hidden.length, 1,
    'the pot caption is not taken off the phone row, so the shelf keeps competing with it for width');

  const [sel, body] = hidden[0];
  assert.ok(!/display:\s*none/.test(body),
    `"${sel}" removes the caption from the accessibility tree, leaving the numeral announced as a bare number`);
  assert.match(body, /clip-path|clip:/,
    `"${sel}" does not clip the caption, so whatever hides it is not the visually-hidden pattern`);
  assert.match(body, /position:\s*absolute/,
    `"${sel}" leaves the caption in flow, so it still claims the width it was taken off the row to release`);
});

test('the pot shelf scrolls rather than clipping the games it cannot fit', () => {
  const body = bodyOf('.pool-shelf');
  assert.ok(body, 'no .pool-shelf rule');
  assert.match(body, /overflow-x:\s*auto/, 'the shelf does not scroll, so a long pot is simply cut off on a phone');
  assert.match(body, /scroll-snap-type:\s*x\s/, 'the shelf does not snap');
  assert.match(body, /min-width:\s*0/,
    'without a 0 min-width the shelf sizes to its content and pushes the page into horizontal scroll');
});
