'use strict';

/* The pot (#1017) — the eligible-game preview on the session setup screen, and
 * the whirl that runs when „Loswirbeln" is pressed.
 *
 * Its own spec rather than more of test/content-width.test.js: that file is about
 * WIDTHS — which presentation is on at which breakpoint — and everything here is
 * about what the pot is made of. The two hide/show assertions it already owns
 * (`.setup-panel` defaults to hidden, `.pool-hint` is hidden from 860) still live
 * there and are deliberately not restated.
 *
 * Three things below fail silently and are the reason each assertion exists:
 *
 *   - the tilt is written INLINE from a table in views-session.js and consumed by
 *     a `transform` in styles.css. Either half alone renders a perfectly tidy
 *     grid, so a dropped `--r` is invisible from the other file.
 *   - the whirl's length lives in BOTH files — 0.9s in the keyframe, 900 in the
 *     handler that waits for it. They are one decision; drifted, the lobby opens
 *     mid-turn or after a dead pause, with nothing red anywhere
 *     (.claude/rules/shared-constants-across-the-stack.md, one boundary over).
 *   - a pile that reshuffles on every re-render looks like a rendering bug rather
 *     than like a missing `% table.length`, so the tilt is pinned as DETERMINISTIC
 *     across renders, not merely as present.
 *
 * The timing half follows .claude/rules/mock-timers-jump-the-clock-before-firing.md:
 * it asks whether the lobby opened BEFORE and AFTER the boundary, and never reads a
 * timestamp from inside a callback. Node's `mock.timers` cannot reach this code —
 * the view calls jsdom's `window.setTimeout`, not Node's — so the window's own
 * timer is replaced with a recorder, the same seam
 * .claude/rules/jsdom-popstate-needs-a-real-timer.md uses.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { RULES, bodyOf, rulesOf, mediaBlocks } = require('./support/css');

// Every rule inside any @media block whose query matches — the same flattening
// helper test/content-width.test.js keeps locally.
const rulesUnder = (re) => mediaBlocks()
  .filter(([query]) => re.test(query))
  .flatMap(([, css]) => rulesOf(css));

const ROOT = path.join(__dirname, '..');
const VIEW_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', 'views-session.js'), 'utf8');

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
const varsOf = (el) => (el.getAttribute('style') || '')
  .split(';')
  .filter((d) => d.trim().startsWith('--'))
  .map((d) => d.trim())
  .join(';');

/* ------------------------------- the pile ------------------------------- */

test('every cover in both presentations carries a tilt, from one table', async () => {
  await dom.call('showStartSession', roundFixture());

  const stack = tiles();
  const row = shelf();
  assert.equal(stack.length, GAMES.length, 'the stack does not render the whole pot');
  assert.equal(row.length, GAMES.length,
    'the shelf renders a subset — below 860px it is the ONLY presentation, so a capped one hides games');

  // Same index, same tilt: the two presentations are one pot seen twice, and a
  // second table would let them disagree about which cover leans which way.
  stack.forEach((tile, i) => {
    assert.ok(varsOf(tile), `stack tile ${i} carries no custom properties, so the transform has nothing to read`);
    assert.equal(varsOf(row[i]), varsOf(tile),
      `shelf cover ${i} is tilted differently from stack tile ${i}`);
  });
});

test('the tilt stays inside the stated range, and repeats rather than growing', async () => {
  await dom.call('showStartSession', roundFixture());

  tiles().forEach((tile, i) => {
    const style = tile.getAttribute('style') || '';
    const r = Number((style.match(/--r:\s*(-?[\d.]+)deg/) || [])[1]);
    const dy = Number((style.match(/--dy:\s*(-?[\d.]+)px/) || [])[1]);
    assert.ok(Number.isFinite(r) && Math.abs(r) <= 8, `tile ${i} leans ${r}deg, outside the -8…8 the pile is drawn for`);
    assert.ok(Number.isFinite(dy) && Math.abs(dy) <= 5, `tile ${i} is offset ${dy}px, outside the -5…5 the pile is drawn for`);
  });
});

test('the pile does not reshuffle when the pool is re-rendered', async () => {
  const round = roundFixture();
  await dom.call('showStartSession', round);
  const before = tiles().map(varsOf);
  // Anti-vacuous: with no tilt at all, every render is `['', '', …]` and the
  // equality below is satisfied by a pot that carries nothing.
  assert.ok(before.length && before.every(Boolean), 'no tile carries a tilt, so equality proves nothing');

  // Any control that narrows the pot re-runs updateHint(); the stepper is the
  // cheapest one that does not also change which games are in it.
  dom.app.querySelector('.setup-addons__chip').click();
  await dom.call('showStartSession', round);
  const after = tiles().map(varsOf);

  assert.deepEqual(after, before,
    'the tilt is not a function of the index alone, so reading the pot reshuffles it');
});

/* ------------------------------- the whirl ------------------------------- */

/* Replace jsdom's window timer with a recorder and hand back the runner. Node's
   t.mock.timers patches the TEST realm's globals; the view runs inside the vm
   context, where a bare `setTimeout` is `window.setTimeout`. */
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

const reducedMotion = (reduce) => {
  dom.window.matchMedia = (q) => ({ matches: reduce && /prefers-reduced-motion:\s*reduce/.test(q) });
};

test('the lobby waits for the whirl, and the pot is marked while it turns', async (t) => {
  let opened = null;
  dom.set('showSessionLobby', (round, session) => { opened = session; });
  dom.set('api', async () => ({ session: { id: 's1' } }));
  reducedMotion(false);
  const timers = captureTimers();
  t.after(timers.restore);

  await dom.call('showStartSession', roundFixture());
  dom.app.querySelector('#go').click();
  await flush();

  const grid = dom.app.querySelector('.setup-grid--session');
  assert.ok(grid.classList.contains('is-whirl'), 'nothing marks the pot while it turns, so no animation can be selected');
  assert.equal(opened, null, 'the lobby opened before the whirl had a chance to run');

  const whirl = timers.armed.find((x) => x.ms === 900);
  assert.ok(whirl, `no 900ms wait was armed (armed: ${timers.armed.map((x) => x.ms).join(', ') || 'none'})`);

  timers.fire();
  await flush();
  assert.equal(opened && opened.id, 's1', 'the lobby never opened once the whirl was over');
});

test('reduced motion opens the lobby as soon as the request returns', async (t) => {
  let opened = null;
  dom.set('showSessionLobby', (round, session) => { opened = session; });
  dom.set('api', async () => ({ session: { id: 's2' } }));
  reducedMotion(true);
  const timers = captureTimers();
  t.after(timers.restore);

  await dom.call('showStartSession', roundFixture());
  dom.app.querySelector('#go').click();
  await flush();

  assert.equal(timers.armed.length, 0, 'a wait was armed although the reader asked for no motion');
  assert.equal(opened && opened.id, 's2', 'the lobby did not open when the request returned');
  assert.ok(!dom.app.querySelector('.setup-grid--session').classList.contains('is-whirl'),
    'the pot is marked for an animation the reader asked not to see');
});

test('a failed draw clears the whirl instead of leaving the pot spinning', async (t) => {
  const toasts = [];
  dom.set('showSessionLobby', () => { throw new Error('the lobby must not open on a failed draw'); });
  dom.set('toast', (m) => toasts.push(m));
  // Held open deliberately: a request that rejects synchronously is caught inside
  // the same microtask chain as the click, so there is no moment at which the pot
  // is marked and the anti-vacuous check below could never pass.
  let failDraw;
  dom.set('api', () => new Promise((resolve, reject) => { failDraw = reject; }));
  reducedMotion(false);
  const timers = captureTimers();
  t.after(timers.restore);

  await dom.call('showStartSession', roundFixture());
  dom.app.querySelector('#go').click();
  await flush();
  // Anti-vacuous: the "cleared" assertion below is satisfied by a class that was
  // never added, which is exactly the state before this feature existed.
  assert.ok(dom.app.querySelector('.setup-grid--session').classList.contains('is-whirl'),
    'the pot was never marked, so there is nothing for the failure path to clear');
  failDraw(new Error('Nope'));
  timers.fire();
  await flush();

  const grid = dom.app.querySelector('.setup-grid--session');
  assert.ok(grid && !grid.classList.contains('is-whirl'),
    'the pot keeps its whirl class after a failed draw, so it spins once and then sits marked forever');
  assert.deepEqual([...toasts], ['Nope']);
});

test('a guard that toasts never starts the whirl', async (t) => {
  const toasts = [];
  dom.set('toast', (m) => toasts.push(m));
  dom.set('api', async () => { throw new Error('the draw must not be sent from an empty pot'); });
  reducedMotion(false);
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
  assert.equal(timers.armed.length, 0, 'the pot whirls for a draw that was refused before it started');
  assert.ok(!dom.app.querySelector('.setup-grid--session').classList.contains('is-whirl'));
});

test('a second press during the whirl does not send a second draw', async (t) => {
  let sent = 0;
  let finish;
  dom.set('showSessionLobby', () => {});
  // Held in flight on purpose: the guard covers the flight, and the whirl is what
  // made that flight long enough to press through.
  dom.set('api', () => {
    sent += 1;
    return new Promise((resolve) => { finish = () => resolve({ session: { id: 's3' } }); });
  });
  reducedMotion(false);
  const timers = captureTimers();
  t.after(timers.restore);

  await dom.call('showStartSession', roundFixture());
  const go = dom.app.querySelector('#go');
  go.click();
  await flush();
  go.click();
  await flush();

  assert.equal(sent, 1,
    'the 0.9s the whirl holds the screen open is 0.9s in which a second press books a second session');
  finish();
  timers.fire();
  await flush();
});

/* ------------------------ the two files agreeing ------------------------- */

test('the whirl lasts exactly as long in the stylesheet as the handler waits', () => {
  const ms = Number((VIEW_SRC.match(/const WHIRL_MS = (\d+);/) || [])[1]);
  assert.ok(ms, 'views-session.js declares no WHIRL_MS for the stylesheet to be held to');

  const motion = rulesUnder(/prefers-reduced-motion:\s*no-preference/);
  const whirls = motion.filter(([, body]) => /animation:[^;]*pot-whirl/.test(body));
  assert.ok(whirls.length >= 2,
    'the covers and the button icon are not both animated inside a no-preference query');

  whirls.forEach(([sel, body]) => {
    const secs = Number(body.match(/animation:[^;]*?([\d.]+)s/)[1]);
    assert.equal(secs * 1000, ms,
      `"${sel}" turns for ${secs}s while the handler holds the lobby back for ${ms}ms`);
  });
});

test('the stylesheet reads the tilt the view writes', () => {
  const tile = RULES.find(([sel, body]) =>
    /\.pool-tile\b/.test(sel) && /transform:\s*rotate\(var\(--r\)\)/.test(body));
  assert.ok(tile, 'nothing consumes --r, so the inline tilt table renders a perfectly tidy grid');
  assert.match(tile[0], /\.setup-panel__body/,
    `"${tile && tile[0]}" tilts every .pool-tile, including the member page's game grid`);

  const thumb = bodyOf('.pool-thumb');
  assert.match(thumb, /transform:\s*rotate\(var\(--r\)\)/,
    'the shelf covers are not tilted, so the phone presentation is a plain row');
});

test('the pot shelf scrolls rather than clipping the games it cannot fit', () => {
  const body = bodyOf('.pool-shelf');
  assert.ok(body, 'no .pool-shelf rule');
  assert.match(body, /overflow-x:\s*auto/, 'the shelf does not scroll, so a long pot is simply cut off on a phone');
  assert.match(body, /scroll-snap-type:\s*x\s/, 'the shelf does not snap');
  assert.match(body, /min-width:\s*0/,
    'without a 0 min-width the shelf sizes to its content and pushes the page into horizontal scroll');
});
