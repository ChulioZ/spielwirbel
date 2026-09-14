'use strict';

/* „Tisch & Tafel" 4/4 (#1058): the two one-shot moments left on the result
 * screen — the table band unrolling when a game is chosen, and the row lifting as
 * it hands that game over. Both fire in response to the reader's own click, which
 * is why #1122 kept them while removing the stamp's press: a click-response reads
 * as feedback, where an entry animation reads as a page still loading.
 *
 * What is actually testable here is the GATE, and the gate is the whole risk:
 * every one of these must fire for the moment that caused it and for nothing
 * else. A cold load, a Chronik visit, a shared link and — the one that bites —
 * a re-render caused by the screen's own next write must replay none of them.
 *
 * The motion itself is not assertable in jsdom (no layout, no compositor) and is
 * measured in the browser instead; what is pinned below in CSS is the property
 * that makes a missed gate SAFE — every rule declared only under its own hook,
 * never cancelled by one, so a reduced-motion reader can never be parked at a
 * `from` keyframe's `opacity: 0`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');
const { bodyOf, mediaBlocks, rulesOf, CSS, RULES } = require('./support/css');

const ME = 'user-me';

function fixture(over = {}) {
  const session = {
    id: 's1',
    createdAt: '2026-08-02T18:00:00.000Z',
    finishedAt: '2026-08-02T22:10:00.000Z',
    gameIds: ['g1', 'g2'],
    memberIds: ['m1', 'm2'],
    votes: { m1: { g1: { rating: 5 }, g2: { rating: 3 } }, m2: { g1: { rating: 4 }, g2: { rating: 2 } } },
    votedIds: ['m1', 'm2'],
    done: true,
    cancelled: false,
    finished: false,
    winnerIds: [],
    chosenGameId: null,
    events: [],
    ...over,
  };
  const round = {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    members: [{ id: 'm1', name: 'Anna', userId: ME }, { id: 'm2', name: 'Ben' }],
    games: [
      { id: 'g1', title: 'Catan', tagIds: [], minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', tagIds: [], minPlayers: 1, maxPlayers: 8 },
    ],
    sessions: [session],
  };
  round.sessions = [session];
  return { round, session };
}

async function show(t, over = {}, reveal = false) {
  const { round, session } = fixture(over);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, path, body) => {
    if (method === 'POST' && /\/choice$/.test(path)) { session.chosenGameId = body.gameId; return {}; }
    if (method === 'POST' && /\/finish$/.test(path)) {
      const winnerIds = body.winnerIds || [];
      const saved = { ...session, finished: body.finished !== false, winnerIds,
        finishedAt: body.finished === false ? null : '2026-08-02T22:10:00.000Z' };
      if (body.ending && !winnerIds.length) saved.ending = body.ending; else delete saved.ending;
      return saved;
    }
    return round;
  });
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  await dom.call('showResults', round, session, round.games, reveal);
  return dom;
}

const slot = (dom) => dom.app.querySelector('.tisch-slot');
const tisch = (dom) => dom.app.querySelector('.tisch');
const play = (dom, title) => [...dom.app.querySelectorAll('.trow')]
  .find((r) => r.querySelector('.trow__title').textContent.trim() === title)
  .querySelector('.play-btn');
const btn = (dom, rx) => [...dom.app.querySelectorAll('.tisch button')].find((b) => rx.test(b.textContent));

// --------------------------------------------------------------- the gates

test('a cold load carries neither hook', async (t) => {
  // The state that matters: a session already chosen AND already finished, i.e.
  // everything the animations celebrate, arrived at from the Chronik.
  const dom = await show(t, { chosenGameId: 'g1', finished: true, winnerIds: ['m1'] });
  assert.ok(tisch(dom).querySelector('.stamp'), 'the stamp is there — this is the state that would replay');
  assert.equal(slot(dom).hasAttribute('data-unroll'), false, 'nothing was just chosen');
  assert.equal(dom.app.querySelector('.trow.is-lift'), null, 'and no row just handed anything over');
});

test('choosing a game unrolls the band and lifts the row that gave it up', async (t) => {
  const dom = await show(t);
  assert.equal(slot(dom).hasAttribute('data-unroll'), false, 'nothing on the table yet');

  play(dom, 'Catan').click();
  await flush();

  assert.equal(tisch(dom).hidden, false, 'the band is there');
  assert.equal(slot(dom).hasAttribute('data-unroll'), true, 'and it unrolls');
  const lifted = [...dom.app.querySelectorAll('.trow.is-lift')];
  assert.equal(lifted.length, 1, 'exactly one row lifts');
  assert.equal(lifted[0].querySelector('.trow__title').textContent.trim(), 'Catan',
    'and it is the row that handed the game over');
});

test('the lift is a ONE-SHOT — it comes off when the animation ends', async (t) => {
  const dom = await show(t);
  play(dom, 'Catan').click();
  await flush();
  const row = dom.app.querySelector('.trow.is-lift');
  // jsdom has no AnimationEvent constructor, so the event is built by hand —
  // and `animationName` matters: the handler must ignore every OTHER animation
  // that can end on this row (the score-fill race, #1056).
  const ev = new dom.window.Event('animationend');
  ev.animationName = 'trow-fill';
  row.dispatchEvent(ev);
  assert.ok(row.classList.contains('is-lift'), 'another animation ending must not strip the lift');
  const own = new dom.window.Event('animationend');
  own.animationName = 'trow-lift';
  row.dispatchEvent(own);
  assert.equal(dom.app.querySelector('.trow.is-lift'), null,
    'left on, a later re-render would replay it');
});

test('the unroll hook is consumed by its own render, not left behind', async (t) => {
  const dom = await show(t);
  play(dom, 'Catan').click();
  await flush();
  assert.equal(slot(dom).hasAttribute('data-unroll'), true);

  // The screen's own next write. Nothing about it is an arrival.
  btn(dom, /Als gespielt markieren/).click();
  await flush();
  assert.equal(slot(dom).hasAttribute('data-unroll'), false,
    'the band must not unroll a second time on a re-render');
});

test('clearing the choice clears the unroll hook with it', async (t) => {
  const dom = await show(t);
  play(dom, 'Catan').click();
  await flush();
  btn(dom, /Anderes Spiel wählen/).click();
  await flush();
  assert.ok(tisch(dom).hidden);
  assert.equal(slot(dom).hasAttribute('data-unroll'), false);
});

// ------------------------------------------------------- the CSS contract

test('every moment is declared ONLY under its hook, inside the motion gate', () => {
  const motion = mediaBlocks()
    .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
    .flatMap(([, css]) => rulesOf(css));
  const has = (sel) => motion.find(([s]) => s === sel);

  for (const [sel, frames] of [
    ['.tisch-slot[data-unroll]', 'tisch-unroll'],
    ['.tisch-slot[data-unroll] > .tisch', 'tisch-open'],
    ['.trow.is-lift', 'trow-lift'],
  ]) {
    const hit = has(sel);
    assert.ok(hit, `${sel} is not inside a prefers-reduced-motion gate`);
    assert.match(hit[1], new RegExp(`animation:\\s*${frames}`), `${sel} runs the wrong keyframes`);
    // `both`, so a dropped animationend cannot strand the element mid-way.
    assert.match(hit[1], /\bboth\b/, `${sel} does not hold its end state`);
    // Declared only under the hook — never cancelled by it. An override missed
    // on one of two selectors leaves the element at the `from` keyframe, which
    // here means invisible or zero-height.
    assert.equal(RULES.filter(([s2]) => s2 === sel.replace(/\[[^\]]+\]|\.is-lift/, '')
      && /animation:/.test(s2)).length, 0);
  }
});

/* #1122 removed the press from BOTH screens it ran on. Asserted as an absence
 * rather than by simply deleting the old test: the comment that argued for it is
 * gone with it, so a later pass re-adding an entry animation here would meet
 * nothing that objects — and the failure it guards against is the one the
 * operator named, a screen that reads as still loading. One stylesheet-wide
 * check covers both call sites, because the keyframe was shared. */
test('nothing presses in any more — press-in and its hook are gone from the sheet', () => {
  assert.equal([...CSS.matchAll(/@keyframes\s+press-in\b/g)].length, 0,
    'the press-in keyframe is declared again');
  const users = RULES.filter(([, body]) => /animation[-a-z]*:[^;]*press-in/.test(body)).map(([sel]) => sel);
  assert.deepEqual(users, [], 'something still runs the press');
  // The attribute existed only to gate the press, so a selector reading it again
  // means the plumbing came back with it.
  const gated = RULES.map(([sel]) => sel).filter((sel) => /\[data-fresh\]/.test(sel));
  assert.deepEqual(gated, [], 'the data-fresh gate is back in the stylesheet');
});

test('the band rolls its OWN box open, because a 0fr row does not reach zero alone', () => {
  /* Measured in WebKit: with the slot animating alone the track floored at 34px
     — the band's own 2x16 padding and 2x1 border, which sit outside
     `min-height` — so the band appeared a fifth open and then grew. The two
     animations run in step, and the slot's clip is what lets the content inside
     be cut while they do. */
  const motion = mediaBlocks()
    .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
    .flatMap(([, css]) => rulesOf(css));
  const slotRule = motion.find(([sel]) => sel === '.tisch-slot[data-unroll]');
  assert.match(slotRule[1], /overflow:\s*hidden/, 'without the clip the content keeps the row open');
  // The keyframes are read out of the raw sheet: `rulesOf` cannot see an
  // `@keyframes` wrapper (it has braces of its own), so its steps arrive as
  // rules with no way back to the block they belong to.
  const block = /@keyframes\s+tisch-open\s*\{([\s\S]*?\}\s*)\}/.exec(CSS);
  assert.ok(block, 'the band never opens its own box, so the roll starts 34px in');
  assert.match(block[1], /from\s*\{[^}]*padding-block:\s*0/, 'the open must start at zero padding');
  assert.match(block[1], /border-block-width:\s*0/, 'and at zero border — it is part of that 34px too');

  const [a, b] = [slotRule[1], motion.find(([sel]) => sel === '.tisch-slot[data-unroll] > .tisch')[1]]
    .map((body) => /animation:[^;]*?(\d*\.?\d+)s/.exec(body)[1]);
  assert.equal(a, b, `the slot (${a}s) and the band (${b}s) must open in step`);
});

test('the band unrolls through its SLOT, so the margin cannot take space at 0fr', () => {
  const slotRule = bodyOf('.tisch-slot');
  assert.ok(slotRule, '.tisch-slot rule is gone');
  assert.match(slotRule, /display:\s*grid/, 'a 0fr row needs a grid to be a row of');
  assert.match(slotRule, /margin:/, 'the outer margin belongs here — inside, it would still take space at 0fr');
  assert.doesNotMatch(bodyOf('.tisch'), /(^|[;\s])margin:/, 'and must not be on the band as well');
  assert.match(bodyOf('.tisch'), /min-height:\s*0/, 'a grid item refuses to shrink below its content without it');
});
