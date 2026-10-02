'use strict';

/* The hub carries no „Spiel hinzufügen" once a round has games (#1498), in
 * every design: the Regal owns adding (#1427, #1278, #1239), and the hub's copy
 * sat at the very end of the page where nobody found it. A 0-game round keeps
 * its add action on the empty table — that is the young round's one next step.
 *
 * Each design is rendered through the real view. The CSS half — the lone
 * „Einstellungen" is not stretched on a phone, and the all-hidden quick actions
 * cost no space from 1280 — is pinned as text, since jsdom applies no sheet.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { CSS, rulesOf, mediaBlocks } = require('./support/css');

const DESIGNS = [null, 'tisch', 'ocean', 'bruecke', 'programmheft'];
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
    const actions = dom.app.querySelectorAll('.hub-actions');
    assert.equal(actions.length, 1, 'the quick actions left the hub');
    assert.deepEqual([...actions[0].children].map((el) => el.textContent.trim()), ['Einstellungen'],
      'the quick actions hold exactly the settings link');
    // The container, not only the link: from 1280 an all-hidden row would still
    // pay its margin, a flex gap or a grid row.
    assert.ok(actions[0].classList.contains('rail-owned'), 'the quick actions are not rail-owned');
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

test('styles.css: the lone „Einstellungen" is not stretched full width on a phone', () => {
  const stretched = rulesOf(CSS).filter(([sel, decl]) => /\.hub-actions\b/.test(sel) && /\bflex:\s*1/.test(decl));
  assert.deepEqual(stretched, [], 'a lone full-width button reads as the screen\'s primary action');
});

test('bruecke.css: from 1280 the quiet-actions slot and its grid row are gone', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/bruecke.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const wide = mediaBlocks(css).filter(([q]) => q === '(min-width: 1280px)').map(([, c]) => c).join('\n');
  const rules = rulesOf(wide);
  const slot = rules.find(([sel]) => /\.bruecke-hub__actions(?![\w-])\s*$/.test(sel));
  assert.ok(slot, 'no rule for the actions slot from 1280');
  assert.match(slot[1], /display:\s*none/);
  const frame = rules.find(([sel, decl]) => /\.bruecke-hub(?![\w-])\s*$/.test(sel.trim()) && /grid-template-areas/.test(decl));
  assert.doesNotMatch(frame[1], /"actions/, 'an empty explicit row still costs its row-gap');
});
