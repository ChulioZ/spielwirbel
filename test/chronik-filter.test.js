'use strict';

/* The Chronik tab's filter chips survive in-app navigation (#793).

   The chips used to live in a local `let filter = 'all'` inside
   renderChronikTab, with `is-on` hard-coded on the "Alles" chip — so every
   return to the tab (a session card and „Zurück", a hub-tab switch, a language
   switch, all of which re-run the whole render) silently dropped the choice.
   Filtering to Sessions and opening three of them meant re-applying the filter
   three times.

   The state now sits next to `regalFilters` in core.js, scoped to one round by
   `chronikFilterRid` — the same shape renderRegalTab already uses for search,
   sort and tags. These specs drive the real view through the jsdom harness
   (`.claude/rules/testing-views-under-jsdom.md`), because what regressed here is
   behaviour across two renders, which no assertion over the view's source can
   see. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const round = (id) => ({
  id,
  name: `Runde ${id}`,
  members: [{ id: 1, name: 'Anna' }],
  games: [{ id: 10, title: 'Azul' }],
  sessions: [
    { id: 100 + id, done: true, finished: true, createdAt: '2026-08-10T18:00:00.000Z', gameIds: [10], winnerIds: [1] },
    { id: 200 + id, done: true, finished: true, createdAt: '2026-07-04T18:00:00.000Z', gameIds: [10], winnerIds: [1] },
  ],
});

const ACTIVITIES = [
  { id: 'a1', type: 'game_added', at: '2026-08-12T09:00:00.000Z', gameId: 10, title: 'Azul' },
  { id: 'a2', type: 'game_retired', at: '2026-08-11T09:00:00.000Z', gameId: 10, title: 'Azul' },
];

// Render the tab from scratch, the way showRound() does on every visit.
function render(dom, r) {
  dom.app.innerHTML = '';
  dom.call('renderChronikTab', r, ACTIVITIES);
  const chips = [...dom.app.querySelectorAll('.filter-chips [data-f]')];
  return {
    chips,
    on: chips.filter((c) => c.classList.contains('is-on')).map((c) => c.dataset.f),
    sessions: dom.app.querySelectorAll('.timeline .session-card').length,
    changes: dom.app.querySelectorAll('.timeline .tl-act').length,
  };
}

const boot = (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  return dom;
};

test('the Sessions filter survives leaving and returning to the tab', (t) => {
  const dom = boot(t);
  const r = round(1);

  const first = render(dom, r);
  assert.deepEqual(first.on, ['all'], 'a fresh round starts on Alles');
  assert.equal(first.sessions, 2);
  assert.equal(first.changes, 2);

  first.chips.find((c) => c.dataset.f === 'sessions').click();
  assert.equal(dom.app.querySelectorAll('.timeline .tl-act').length, 0, 'the click itself narrows the timeline');

  // Leaving and coming back re-runs the whole render — this is what dropped it.
  const back = render(dom, r);
  assert.deepEqual(back.on, ['sessions'], 'the Sessions chip is still the marked one');
  assert.equal(back.sessions, 2, 'session cards are still shown');
  assert.equal(back.changes, 0, 'shelf changes are still filtered out');
});

test('the Regal-Änderungen filter survives the same way', (t) => {
  const dom = boot(t);
  const r = round(1);

  render(dom, r).chips.find((c) => c.dataset.f === 'changes').click();

  const back = render(dom, r);
  assert.deepEqual(back.on, ['changes']);
  assert.equal(back.changes, 2);
  assert.equal(back.sessions, 0);
});

test('exactly one chip is marked on arrival, and it is the one the timeline shows', (t) => {
  const dom = boot(t);
  const r = round(1);

  render(dom, r).chips.find((c) => c.dataset.f === 'sessions').click();
  const back = render(dom, r);

  assert.equal(back.on.length, 1, 'never two lit chips, never none');
  assert.equal(back.on[0], 'sessions');
  assert.equal(back.changes, 0);
});

test('the filter does not leak into a different round', (t) => {
  const dom = boot(t);

  render(dom, round(1)).chips.find((c) => c.dataset.f === 'sessions').click();

  const other = render(dom, round(2));
  assert.deepEqual(other.on, ['all'], "a different round's Chronik starts at Alles");
  assert.equal(other.changes, 2, 'and shows shelf changes again');

  // ...and coming back to the first round does NOT resurrect its old choice:
  // the state is one slot scoped to the round last rendered, not a per-round map.
  const backToFirst = render(dom, round(1));
  assert.deepEqual(backToFirst.on, ['all']);
});

test('an unknown stored filter falls back to Alles rather than lighting no chip', (t) => {
  const dom = boot(t);
  const r = round(1);

  render(dom, r); // claims the round, so the reset guard does not fire
  dom.run('chronikFilter = "gone-since-a-redesign";');

  const back = render(dom, r);
  assert.deepEqual(back.on, ['all'], 'falls back to Alles');
  assert.equal(back.sessions, 2, 'and the timeline is unfiltered, never empty');
  assert.equal(back.changes, 2);
});
