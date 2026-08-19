'use strict';

/* Every off-shelf screen the Regal offers below 1280px must ALSO have a rail entry.
 *
 * The two are not alternatives, they are the same navigation at two widths: the
 * Regal's control is `.rail-owned`, so from 1280px up it is `display: none` and
 * the rail is the ONLY way in. A link present in one and missing from the other
 * is therefore a screen that is unreachable at that width — with nothing red, no
 * error, and a screen that still looks finished from every narrower window.
 *
 * That is not hypothetical: #682 shipped its recommendations screen into the
 * narrow surface alone, so the whole feature had no entry point on a
 * desktop-width window. Verified in a browser at 1180px and 390px — both below
 * the breakpoint — which is exactly the "walk the width transitions" check
 * `.claude/rules/responsive-content-width.md` prescribes and which was skipped.
 *
 * Asserted as PARITY rather than as "the recommendations row exists", so the
 * next screen added to either surface is covered without editing this file.
 *
 * #777 moved the narrow surface from a `.round-footer` row BELOW the whole cover
 * grid into a sheet opened from the Regal's header tools. This file's header
 * used to predict that moment — "the whole spec would go quiet the day the
 * footer is refactored away" — so the parity assertion was retargeted at the
 * sheet rather than left watching an empty `.round-footer` selector, and the
 * anti-vacuous floor below is what makes that retarget checkable.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';

const baseGames = [
  { id: 'g2', title: 'Azul', retired: true, retiredAt: '2026-07-01T10:00:00.000Z', tagIds: [] },
  { id: 'g3', title: 'Cascadia', completed: true, completedAt: '2026-07-02T10:00:00.000Z', tagIds: [] },
  { id: 'g4', title: 'Ark Nova', wish: true, wishAt: '2026-07-03T10:00:00.000Z', tagIds: [] },
];

const roundWith = (games) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games,
  sessions: [],
});

const round = roundWith([
  { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: [] },
  ...baseGames,
]);

async function renderRegal(t, payload = round) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return payload;
    return {};
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  await dom.call('showRound', RID, 'regal');
  return dom;
}

/* The trigger, as the user finds it: a control in the Regal's header tools row,
   not anywhere below the grid. Scoped to `.section-tools` so a stray
   `.rail-owned` elsewhere on the screen cannot stand in for it. */
const offShelfTrigger = (dom) => dom.app.querySelector('.section-tools .rail-owned');

function openOffShelf(dom) {
  const trigger = offShelfTrigger(dom);
  assert.ok(trigger, 'the Regal renders no off-shelf control in its header tools');
  trigger.click();
  const sheet = dom.document.querySelector('.off-shelf');
  assert.ok(sheet, 'clicking the off-shelf control opened no sheet');
  return sheet;
}

const rowsOf = (root) =>
  [...root.querySelectorAll('a[href]')].map((a) => ({
    href: a.getAttribute('href'),
    text: a.textContent.replace(/\s+/g, ' ').trim(),
  }));

test('every off-shelf screen the Regal offers is also reachable from the rail', async (t) => {
  const dom = await renderRegal(t);
  const sheet = rowsOf(openOffShelf(dom));
  const rail = new Map(rowsOf(dom.app.querySelector('.rail')).map((r) => [r.href, r.text]));

  // Anti-vacuous: with no rows the set comparison passes trivially, and the
  // whole spec would go quiet the day the sheet is refactored away — which is
  // precisely what happened to its `.round-footer` predecessor in #777.
  assert.ok(sheet.length >= 4, `the off-shelf sheet rendered ${sheet.length} links — check the fixture`);

  const missing = sheet.filter((r) => !rail.has(r.href)).map((r) => r.href);
  assert.deepEqual(
    missing,
    [],
    `hidden from 1280px up and absent from the rail, so unreachable on a desktop: ${missing.join(', ')}`,
  );

  // Same COUNTS, not merely the same destinations: the two surfaces each derive
  // their own numbers from round.games, so one of them can silently start
  // counting a different set (or stop counting at all) while parity above holds.
  const drifted = sheet.filter((r) => rail.get(r.href) !== r.text);
  assert.deepEqual(
    drifted.map((r) => `${r.href}: sheet "${r.text}" vs rail "${rail.get(r.href)}"`),
    [],
  );
});

test('the off-shelf control is a real button and its rows are real links', async (t) => {
  const dom = await renderRegal(t);
  // A control that opens an overlay rather than navigating is a <button>, and a
  // destination is an <a href> — .claude/rules/native-button-vs-focusable-span.md
  // and .claude/rules/in-app-nav-links.md. The rows carrying real hrefs is what
  // keeps ⌘-click and middle-click opening them in a new tab.
  assert.equal(offShelfTrigger(dom).tagName, 'BUTTON');
  const sheet = openOffShelf(dom);
  const anchors = [...sheet.querySelectorAll('.ds-row')];
  assert.equal(anchors.length, 4);
  for (const row of anchors) {
    assert.equal(row.tagName, 'A', 'an off-shelf row is not an anchor, so it cannot be opened in a new tab');
    assert.match(row.getAttribute('href') || '', new RegExp(`^/round/${RID}/`));
  }
});

test('the off-shelf control is offered on an EMPTY shelf too', async (t) => {
  // The regression this guards: `.section-tools` is only populated inside the
  // "there are active games" branch, so a control added there would vanish for a
  // round whose games are ALL off the shelf — the case that needs it most.
  const dom = await renderRegal(t, roundWith(baseGames));
  // `.empty` is rendered by the zero-active-games branch ONLY. The obvious guard
  // — that the grid has an `.add-tile` — is vacuous: that tile closes the grid in
  // BOTH branches, so it would have let a non-empty fixture through and this
  // spec would have tested nothing it claims to.
  assert.ok(dom.app.querySelector('.section .empty'), 'fixture is not an empty shelf');
  const sheet = rowsOf(openOffShelf(dom));
  assert.ok(sheet.length >= 4, `an empty Regal offered ${sheet.length} off-shelf links`);
});

test('the Regal no longer strands the off-shelf links in a footer below the grid', async (t) => {
  const dom = await renderRegal(t);
  assert.equal(
    dom.app.querySelector('.round-footer'),
    null,
    'the Regal still renders a .round-footer — the links are back below the whole cover grid',
  );
});

test('the recommendations rail row marks itself current, like the other off-shelf rows', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/recommendations$/.test(url)) {
      return { recommendations: [], profileGames: 0, linkedGames: 0, minProfileGames: 8, corpusRows: 0, parties: [] };
    }
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    return {};
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  await dom.call('showRecommendations', RID);

  const row = [...dom.app.querySelectorAll('.rail a[href]')]
    .find((a) => a.getAttribute('href') === `/round/${RID}/recommendations`);
  assert.ok(row, 'the rail carries no recommendations row on its own screen');
  // "page" (you are ON it) rather than "true" (you are on a screen it owns) —
  // the distinction railItem draws, and the same one the wishlist row uses.
  assert.equal(row.getAttribute('aria-current'), 'page');
  assert.ok(row.classList.contains('is-active'));
  // And no SECTION is marked at the same time, which is what RAIL_OWN_ENTRY is
  // for: without the entry in that list, the Regal section would light up too.
  const marked = [...dom.app.querySelectorAll('.rail [aria-current]')].map((el) => el.textContent.trim());
  assert.equal(marked.length, 1, `two rail rows claim to be current: ${marked.join(' / ')}`);
});
