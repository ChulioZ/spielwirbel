'use strict';

/* „Weitere Listen" made compact (#1579). Klassisch and Das Programmheft spent
 * four full-width rows (~250px) at the foot of the hub on the four lists.
 *
 * - Klassisch from 1280px: the four are rail links with counts — on the START
 *   tab only. The rail is persistent navigation, and #1500 took the four off
 *   it on every screen; the hub's group moving into it on the hub is what Ocean
 *   and Forest already do with their own left column (operator decision
 *   2026-10-20). The hub's own rows are `rail-owned` there, so they are never
 *   on screen twice.
 * - Klassisch below 1280px and Das Programmheft at every width: one wrapping
 *   strip of links instead of a stack of rows.
 *
 * jsdom applies no stylesheet, so the strip half is pinned as CSS text.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf, bodyOf, mediaBlocks, topLevel, CSS } = require('./support/css');

const RID = 'r1';
const round = {
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: [
    { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: [] },
    { id: 'g2', title: 'Azul', retired: true, tagIds: [] },
    { id: 'g3', title: 'Cascadia', completed: true, tagIds: [] },
    { id: 'g4', title: 'Ark Nova', wish: true, tagIds: [] },
    { id: 'g5', title: 'Brass', wish: true, tagIds: [] },
  ],
  sessions: [],
};

async function render(t, tab, design = 'klassisch') {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    return {};
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  await dom.call('showRound', RID, tab);
  return dom;
}

const linksOf = (root) =>
  [...root.querySelectorAll('a[href]')].map((a) => ({
    href: a.getAttribute('href'),
    name: a.getAttribute('aria-label') || a.textContent.replace(/\s+/g, ' ').trim(),
  }));

test('Klassisch Start: the rail carries the four lists with counts, the same as the hub group', async (t) => {
  const dom = await render(t, 'start');
  const group = dom.app.querySelector('.rail .rail__offshelf');
  assert.ok(group, 'the Klassisch rail has no „Weitere Listen" group on the Start tab');
  assert.equal(group.tagName, 'NAV');
  const label = dom.document.getElementById(group.getAttribute('aria-labelledby'));
  assert.equal(label && label.textContent.trim(), 'Weitere Listen');

  const rail = linksOf(group);
  // Anti-vacuous: four lists in this fixture (no guest games).
  assert.equal(rail.length, 4, `the rail group rendered ${rail.length} links`);
  assert.deepEqual(rail, linksOf(dom.app.querySelector('.hub-offshelf')));
  // The count is a figure of its own, beside the name.
  const counts = [...group.querySelectorAll('.rail__count')].map((c) => c.textContent);
  assert.deepEqual(counts, ['2', '1', '1']);
  assert.ok([...group.querySelectorAll('.rail__count')].every((c) => c.getAttribute('aria-hidden') === 'true'));
});

test('Klassisch Start: the hub group is rail-owned, so it is not on screen twice from 1280px', async (t) => {
  const dom = await render(t, 'start');
  assert.ok(dom.app.querySelector('.hub-offshelf').classList.contains('rail-owned'));
});

test('Klassisch elsewhere: the rail carries no list group — #1500 still holds off the hub', async (t) => {
  for (const tab of ['regal', 'chronik', 'pokale']) {
    const dom = await render(t, tab);
    assert.ok(dom.app.querySelector('.rail'), `no rail on ${tab}`);
    assert.equal(dom.app.querySelector('.rail__offshelf'), null, `the rail carries the lists on ${tab}`);
  }
});

test('lean-rail designs keep their hub group in the page and add nothing to the rail', async (t) => {
  for (const design of ['ocean', 'forest', 'programmheft', 'bruecke']) {
    const dom = await render(t, 'start', design);
    assert.equal(dom.app.querySelector('.rail__offshelf'), null, `${design}: rail group`);
    const hub = dom.app.querySelector('.hub-offshelf');
    assert.ok(hub, `${design}: no hub group`);
    assert.ok(!hub.classList.contains('rail-owned'), `${design}: the hub group would vanish from 1280px`);
  }
});

test('Klassisch below the rail: the hub group is one wrapping strip, no chevrons', () => {
  const base = topLevel(CSS);
  const list = bodyOf(':root[data-design="klassisch"] .hub-offshelf__list', rulesOf(base));
  assert.ok(list, 'no Klassisch strip rule for .hub-offshelf__list');
  assert.match(list, /flex-direction:\s*row/);
  assert.match(list, /flex-wrap:\s*wrap/);
  const meta = bodyOf(':root[data-design="klassisch"] .hub-offshelf .off-shelf__row .ds-row__meta', rulesOf(base));
  assert.match(meta || '', /display:\s*none/);
  // The rail's count needs a rule of its own — Forest's lives in its sheet.
  const wide = mediaBlocks(CSS).filter(([q]) => /min-width:\s*1280px/.test(q)).map(([, css]) => css).join('\n');
  assert.ok(bodyOf('.rail__offshelf .rail__count', rulesOf(wide)), 'no rail count rule from 1280px');
});

test('Das Programmheft: one strip at every width, spanning the bottom strip from 1280px', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/programmheft.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const list = bodyOf(':root[data-design="programmheft"] .ph-hub .hub-offshelf__list', rulesOf(topLevel(css)));
  assert.ok(list, 'no unconditional Programmheft strip rule');
  assert.match(list, /flex-direction:\s*row/);
  assert.match(list, /flex-wrap:\s*wrap/);
  const wide = mediaBlocks(css).filter(([q]) => /min-width:\s*1280px/.test(q)).map(([, c]) => c).join('\n');
  assert.match(bodyOf(':root[data-design="programmheft"] .ph-hub__strip > .hub-offshelf', rulesOf(wide)) || '',
    /grid-column:\s*1\s*\/\s*-1/);
});
