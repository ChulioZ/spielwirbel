'use strict';

/*
 * The games sheet's move/copy mode toggle (#916), driven under jsdom.
 *
 * What needs running rather than grepping: the mode swaps EVERY string the user
 * reads, and a copy that said „verschieben" anywhere would be describing a
 * destructive act it does not perform. A source regex cannot see which element
 * the swap landed on, and cannot see the duplicate flagging at all — that one
 * only exists after a target-round fetch has resolved
 * (.claude/rules/testing-views-under-jsdom.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

const ROUND = {
  id: 'r1',
  name: 'Hier',
  members: [],
  sessions: [],
  games: [{ id: 'g1', title: 'Azul' }, { id: 'g2', title: 'Catan' }],
};

// The target's shelf spells the duplicate differently — the flag matches by the
// same trimmed, case-insensitive rule tags merge by.
const TARGET = { id: 'r2', name: 'Andere', members: [], games: [{ id: 'x', title: '  aZUL ' }] };

async function openSheetOn(t, { target = TARGET } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const posts = [];
  const reads = [];
  dom.set('swrRead', async (key, url, opts) => {
    reads.push({ key, opts: opts && { ...opts } });
    return key === 'rounds'
      ? [{ id: 'r1', name: 'Hier' }, { id: 'r2', name: 'Andere' }]
      : JSON.parse(JSON.stringify(target));
  });
  dom.set('api', async (method, path, body) => { posts.push({ method, path, body }); return { movedGames: 1, copiedGames: 1 }; });
  dom.set('toast', () => {});
  dom.set('showRound', () => {});
  dom.set('confirmDialog', () => Promise.resolve(true));
  await dom.call('showTransferGames', ROUND);
  const sheet = dom.document.querySelector('.sheet');
  const chip = (mode) => sheet.querySelector(`.transfer-modes .chip[data-mode="${mode}"]`);
  return {
    dom,
    sheet,
    posts,
    reads,
    chip,
    // The picker settles asynchronously in copy mode: switching mode kicks off a
    // fetch of the target's shelf, so a spec must let it resolve before reading
    // the flags — otherwise it measures the render before the answer arrived.
    async pick(mode) { chip(mode).click(); await new Promise((r) => setTimeout(r, 0)); },
    rows: () => [...sheet.querySelectorAll('.move-row')],
    text: (sel) => sheet.querySelector(sel).textContent,
  };
}

test('the sheet opens in MOVE mode and posts to /move-to', async (t) => {
  const s = await openSheetOn(t);

  assert.equal(s.chip('move').getAttribute('aria-pressed'), 'true');
  assert.equal(s.chip('copy').getAttribute('aria-pressed'), 'false');
  assert.equal(s.text('#transferTitle'), 'Spiele verschieben');
  assert.equal(s.text('#transferSubmit'), 'Spiele verschieben');
  assert.equal(s.text('#transferPick'), 'Verschieben nach');
  // No duplicate flag is offered in move mode — a move cannot leave two rows of
  // one game anywhere, so the whole notion does not apply.
  assert.equal(s.rows().every((r) => r.querySelector('.move-row__dup').hidden), true);
  assert.equal(s.sheet.querySelector('#transferDupHint').hidden, true);

  s.sheet.querySelector('#moveGo').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.posts.length, 1);
  assert.match(s.posts[0].path, /\/games\/move-to$/);
  assert.deepEqual([...s.posts[0].body.gameIds], ['g1', 'g2']);
});

test('switching to Kopieren swaps every string the user reads', async (t) => {
  const s = await openSheetOn(t);
  await s.pick('copy');

  assert.equal(s.chip('copy').getAttribute('aria-pressed'), 'true');
  assert.equal(s.chip('move').getAttribute('aria-pressed'), 'false');
  assert.equal(s.chip('copy').classList.contains('is-on'), true);
  assert.equal(s.text('#transferTitle'), 'Spiele kopieren');
  assert.equal(s.text('#transferSubmit'), 'Spiele kopieren');
  assert.equal(s.text('#transferPick'), 'Kopieren nach');
  assert.equal(s.sheet.getAttribute('aria-label'), 'Spiele kopieren');
  // The intro promises the source shelf survives — the sentence that makes the
  // two modes different, so it must actually change.
  assert.match(s.text('#transferIntro'), /bleibt/);
  // An arrow on a copy would say the games are leaving.
  assert.equal(s.sheet.querySelector('#moveGo .ti').className, 'ti ti-copy');

  // Nothing OUTSIDE the mode toggle still tells the user this will move them.
  // The toggle itself must keep saying „Verschieben" — it is the way back.
  const body = s.sheet.cloneNode(true);
  body.querySelector('.transfer-modes').remove();
  assert.doesNotMatch(body.textContent, /verschieb/i);
  assert.match(s.chip('move').textContent, /Verschieben/);
});

test('a title the target already has is flagged and unticked, and can be ticked back on', async (t) => {
  const s = await openSheetOn(t);
  await s.pick('copy');

  const [azul, catan] = s.rows();
  assert.equal(azul.querySelector('.move-row__dup').hidden, false, 'Azul is already on the target shelf');
  assert.equal(catan.querySelector('.move-row__dup').hidden, true);
  assert.equal(azul.querySelector('input').checked, false, 'a duplicate is unticked for the user');
  assert.equal(catan.querySelector('input').checked, true);
  assert.equal(s.sheet.querySelector('#transferDupHint').hidden, false);
  // The count follows the auto-untick, or the user confirms a number the sheet
  // is not going to send.
  assert.match(s.text('#moveCount'), /^1 /);

  // Copying it anyway is allowed — the flag is an aid, never a gate.
  azul.querySelector('input').click();
  s.sheet.querySelector('#moveGo').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(s.posts[0].path, /\/games\/copy-to$/);
  assert.deepEqual([...s.posts[0].body.gameIds], ['g1', 'g2']);
});

test('switching back to Verschieben clears the flags and the hint', async (t) => {
  const s = await openSheetOn(t);
  await s.pick('copy');
  assert.equal(s.rows()[0].querySelector('.move-row__dup').hidden, false);

  await s.pick('move');
  // Re-checked AFTER the transition, not only at first render: a flag left
  // standing would tell a move it is about to duplicate something.
  assert.equal(s.rows().every((r) => r.querySelector('.move-row__dup').hidden), true);
  assert.equal(s.sheet.querySelector('#transferDupHint').hidden, true);
  assert.equal(s.text('#transferTitle'), 'Spiele verschieben');
});

/* Both reads this sheet takes happen WITH THE SHEET OPEN, and the sheet lives on
   document.body where swrRead's uiBusy() guard cannot see it — so a background
   revalidation would call currentView() and rebuild the screen underneath the
   user mid-selection. Neither read may carry the default `rerender: true`. */
test('every read taken while the sheet is open suppresses the re-render', async (t) => {
  const s = await openSheetOn(t);
  await s.pick('copy');

  assert.deepEqual(s.reads.map((r) => r.key), ['rounds', 'round:r2']);
  for (const r of s.reads) {
    assert.deepEqual(r.opts, { rerender: false }, `${r.key} would rebuild the screen behind the sheet`);
  }
});

test('a target whose shelf shares no title flags nothing', async (t) => {
  const s = await openSheetOn(t, { target: { id: 'r2', name: 'Andere', members: [], games: [{ id: 'x', title: 'Wingspan' }] } });
  await s.pick('copy');

  // The anti-vacuous half of the flagging spec: the same code path over a
  // different shelf must leave every row ticked, or the assertions above could
  // be satisfied by something that flags unconditionally.
  assert.equal(s.rows().every((r) => r.querySelector('.move-row__dup').hidden), true);
  assert.equal(s.rows().every((r) => r.querySelector('input').checked), true);
  assert.equal(s.sheet.querySelector('#transferDupHint').hidden, true);
});
