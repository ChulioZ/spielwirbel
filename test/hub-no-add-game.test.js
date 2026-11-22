'use strict';

/* The hub carries no „Spiel hinzufügen" once a round has games (#1498), in
 * every design: the Regal owns adding (#1427, #1278, #1239), and the hub's copy
 * sat at the very end of the page where nobody found it. A 0-game round keeps
 * its add action on the empty table — that is the young round's one next step.
 *
 * Each design is rendered through the real view. Since #1853 the quick-actions
 * row is gone too, so the spec also pins the one way into Einstellungen that
 * replaced it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const DESIGNS = [null, 'tisch', 'ocean', 'bruecke', 'programmheft', 'forest'];
const label = (d) => d || 'klassisch';

const game = (id) => ({ id, title: 'Spiel ' + id, minPlayers: 2, maxPlayers: 4, createdAt: '2026-01-0' + (id % 9 + 1) + 'T10:00:00.000Z' });
const round = (games) => ({
  id: 'r1',
  name: 'Sonntagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Lea' }, { id: 'm2', name: 'Jo' }],
  games: Array.from({ length: games }, (_, i) => game(10 + i)),
  sessions: [],
  tags: [],
});

async function hub(t, design, r) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('accountsActive', () => true);
  dom.set('api', async (method, url) => (/recommendations/.test(url) ? { recommendations: [] } : r));
  await dom.call('showRound', r.id, 'start');
  return dom;
}

// Every control in the pane, i.e. not the rail or the dock — the rail's own
// entries are navigation and are not what this issue is about.
const addControls = (dom) => [...dom.app.querySelectorAll('button, a')]
  .filter((el) => !el.closest('.rail, .dock'))
  .filter((el) => /Spiel hinzufügen/.test(el.textContent) || /Spiel hinzufügen/.test(el.getAttribute('aria-label') || ''));

for (const design of DESIGNS) {
  test(`${label(design)}: a round with games offers no „Spiel hinzufügen" on the hub`, async (t) => {
    const dom = await hub(t, design, round(3));
    assert.deepEqual(addControls(dom).map((el) => el.outerHTML), [], 'the hub grew an add control again');
    // The quick-actions row is gone (#1853); Einstellungen is a gear on the
    // round's name — or the design's own labelled link in its head.
    assert.equal(dom.app.querySelector('.hub-actions'), null, 'the quick actions row is back');
    const settings = [...dom.app.querySelectorAll('a[href="/round/r1/settings"]')].filter((el) => !el.closest('.rail, .dock'));
    assert.equal(settings.length, 1, 'the Start tab must offer exactly one way into Einstellungen');
  });

  test(`${label(design)}: a 0-game round still offers „Spiel hinzufügen" on the hub`, async (t) => {
    const dom = await hub(t, design, round(0));
    const seen = [];
    dom.set('showAddGame', (r) => seen.push(r.id));
    const adds = addControls(dom);
    assert.equal(adds.length, 1, 'the young round lost its one next step (or has it twice)');
    assert.equal(adds[0].closest('.hub-actions'), null, 'the add action belongs to the empty table, not the quick actions');
    adds[0].click();
    assert.deepEqual([...seen], ['r1']);
  });
}
