'use strict';

/* The results screen's footer (#614): „Kein Spiel gefällt – Session abbrechen"
   and „Session löschen" together, below the games and the session log.

   What is being guarded is PLACEMENT, so the screen is rendered for real through
   the jsdom harness and the assertions compare document positions
   (.claude/rules/testing-views-under-jsdom.md). A regex over the view source
   could see that `.cancel-area` exists, which was never in doubt — it existed in
   the wrong place, directly under the chosen-game banner and above the first
   `.result-row`, giving a destructive action more prominence than the scores it
   interrupted.

   Note there is no back row at the bottom to anchor against any more: #623/#624
   moved that control to the top of every screen, so the footer is simply the
   last block. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');
const { bodyOf } = require('./support/css');

const ME = 'user-me';

function roundFixture(over = {}) {
  return {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    members: [
      { id: 'm1', name: 'Anna', userId: ME },
      { id: 'm2', name: 'Ben' },
    ],
    games: [
      { id: 'g1', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
    ],
    sessions: [],
    ...over,
  };
}

// Two games with votes, nothing chosen and nothing finished — the only state in
// which the cancel control is offered at all. `events` is not incidental: the
// footer has to land after the session log too, and with no events
// `renderSessionLog` returns null and that half of the assertion goes vacuous.
function sessionFixture(over = {}) {
  return {
    id: 's1',
    createdAt: '2026-08-02T18:00:00.000Z',
    gameIds: ['g1', 'g2'],
    memberIds: ['m1', 'm2'],
    events: [
      { at: '2026-08-02T18:00:00.000Z', type: 'started', actor: 'm1' },
      { at: '2026-08-02T18:05:00.000Z', type: 'voted', actor: 'm1', personId: 'm1' },
    ],
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
    ...over,
  };
}

async function results(t, over = {}) {
  const round = roundFixture();
  const session = sessionFixture(over);
  round.sessions = [session];
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => round);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  await dom.call('showResults', round, session);
  return dom;
}

/* Both controls are looked up across the WHOLE screen, deliberately not scoped
   to `.result-footer`. Scoping them there makes every assertion below collapse
   into "the selector missed" the moment the control moves — which is exactly the
   regression under test, so the red would stop discriminating placement from a
   typo (.claude/rules/break-the-code-on-purpose.md, habit 2). Verified: with the
   append put back above the rows, these lookups still find the control and the
   placement assertions are what fail. */
const cancelBtn = (dom) => dom.app.querySelector('.cancel-area button');
const deleteBtn = (dom) =>
  [...dom.app.querySelectorAll('button')].find((b) => /Session löschen/.test(b.textContent));

/** Does `a` come before `b` in document order? */
function precedes(dom, a, b) {
  return !!(a.compareDocumentPosition(b) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
}

test('the cancel control renders after the last game row and after the log', async (t) => {
  const dom = await results(t);

  const btn = cancelBtn(dom);
  assert.ok(btn, 'expected the cancel control in the footer');

  const rows = [...dom.app.querySelectorAll('.result-row')];
  assert.equal(rows.length, 2, 'fixture should render both games');
  assert.equal(
    precedes(dom, rows[rows.length - 1], btn), true,
    'the cancel control must come after the last .result-row, not above the first',
  );

  const log = dom.app.querySelector('.session-log');
  assert.ok(log, 'fixture should render a session log to sit above the footer');
  assert.equal(precedes(dom, log, btn), true, 'and after the session log');
  assert.ok(btn.closest('.result-footer'), 'it belongs to the shared footer row');
});

// The whole point of the move: the most-read part of the screen is the run from
// the banner into the standings, and nothing may interrupt it.
test('nothing renders between the chosen-game banner and the first game row', async (t) => {
  const dom = await results(t);

  const banner = dom.app.querySelector('.chosen-banner');
  assert.ok(banner, 'expected the chosen-game banner');
  assert.equal(
    banner.nextElementSibling,
    dom.app.querySelector('.result-row'),
    'the first .result-row must follow the banner directly',
  );
});

test('cancel is a link-btn with its icon and label, not a ghost button', async (t) => {
  const dom = await results(t);
  const btn = cancelBtn(dom);

  assert.equal(btn.classList.contains('link-btn'), true);
  assert.equal(btn.classList.contains('btn'), false, 'must not still be a full-weight button');
  assert.equal(btn.classList.contains('btn--ghost'), false);
  assert.ok(btn.querySelector('i.ti-x'), 'expected the ti-x icon to survive the restyle');
  assert.match(btn.textContent, /Kein Spiel gefällt/);
});

// Cancel sits beside delete, and before it: the reversible action ahead of the
// permanent one.
test('cancel and delete share one footer row, cancel first', async (t) => {
  const dom = await results(t);

  const cancel = cancelBtn(dom);
  const del = deleteBtn(dom);
  assert.ok(del, 'expected the delete-session link in the same footer');

  /* SAME row, asserted by identity — `precedes` alone is satisfied by the old
     layout too (cancel sat above the game rows, which are above delete), so an
     order-only assertion here stays green against the very regression this file
     guards. Found by breaking the code, not by reading it. */
  const row = cancel.closest('.result-footer');
  assert.ok(row, 'cancel must live in the footer row');
  assert.equal(del.closest('.result-footer'), row, 'delete must be in that same row');
  assert.equal(precedes(dom, cancel, del), true, 'cancel should come before delete');
});

test('the undo control replaces it in the same footer spot once cancelled', async (t) => {
  const dom = await results(t, { cancelled: true });

  const btn = cancelBtn(dom);
  assert.ok(btn, 'expected the undo control in the footer');
  assert.match(btn.textContent, /rückgängig/i);
  assert.equal(btn.classList.contains('link-btn'), true);
  assert.equal(btn.classList.contains('btn--ghost'), false);
  assert.equal(precedes(dom, btn, deleteBtn(dom)), true);
});

// Choosing a game or finishing removes the control — the footer must then hold
// the delete link alone rather than a half-empty row.
for (const [label, over] of [
  ['a game is chosen', { chosenGameId: 'g1' }],
  ['the session is finished', { finished: true, chosenGameId: 'g1' }],
]) {
  test(`no cancel control once ${label}, and the footer keeps only delete`, async (t) => {
    const dom = await results(t, over);

    assert.equal(cancelBtn(dom), null, 'the cancel control must be gone');
    const wrap = dom.app.querySelector('.result-footer .cancel-area');
    assert.ok(wrap, 'the wrapper itself stays (renderCancel writes into it)');
    assert.equal(wrap.children.length, 0, 'and it must be empty, so :empty can hide it');
    assert.ok(deleteBtn(dom), 'delete stays');
  });
}

/* jsdom applies no external stylesheet, so the assertion above can only prove
   the wrapper is EMPTY — that empty means invisible is a CSS fact, and it is the
   one keeping a stray gap out of the footer's flex row. Hence a text assertion
   over the real rule (.claude/rules/css-text-assertions-strip-comments.md). */
test('an empty cancel area is taken out of the footer flow entirely', () => {
  const body = bodyOf('.cancel-area:empty');
  assert.ok(body, 'expected a .cancel-area:empty rule in styles.css');
  assert.match(body, /display:\s*none/);
  assert.match(bodyOf('.result-footer') || '', /display:\s*flex/);
});
