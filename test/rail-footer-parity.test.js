'use strict';

/* Every off-shelf screen the Regal's footer links to must ALSO have a rail entry.
 *
 * The two are not alternatives, they are the same navigation at two widths: the
 * footer is `.rail-owned`, so from 1280px up it is `display: none` and the rail
 * is the ONLY way in. A link present in one and missing from the other is
 * therefore a screen that is unreachable at that width — with nothing red, no
 * error, and a screen that still looks finished from every narrower window.
 *
 * That is not hypothetical: #682 shipped its recommendations screen into the
 * footer alone, so the whole feature had no entry point on a desktop-width
 * window. Verified in a browser at 1180px and 390px — both below the
 * breakpoint — which is exactly the "walk the width transitions" check
 * `.claude/rules/responsive-content-width.md` prescribes and which was skipped.
 *
 * Asserted as PARITY rather than as "the recommendations row exists", so the
 * next screen added to either surface is covered without editing this file.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';

const round = {
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: [
    { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: [] },
    { id: 'g2', title: 'Azul', retired: true, retiredAt: '2026-07-01T10:00:00.000Z', tagIds: [] },
    { id: 'g3', title: 'Cascadia', completed: true, completedAt: '2026-07-02T10:00:00.000Z', tagIds: [] },
    { id: 'g4', title: 'Ark Nova', wish: true, wishAt: '2026-07-03T10:00:00.000Z', tagIds: [] },
  ],
  sessions: [],
};

async function renderRegal(t) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    return {};
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  await dom.call('showRound', RID, 'regal');
  return dom;
}

const hrefsIn = (root, selector) =>
  [...root.querySelectorAll(`${selector} a[href]`)].map((a) => a.getAttribute('href'));

test('every screen the Regal footer links to is also reachable from the rail', async (t) => {
  const dom = await renderRegal(t);

  const footer = hrefsIn(dom.app, '.round-footer');
  const rail = new Set(hrefsIn(dom.app, '.rail'));

  // Anti-vacuous: with no footer links the set comparison passes trivially, and
  // the whole spec would go quiet the day the footer is refactored away.
  assert.ok(footer.length >= 4, `the Regal footer rendered ${footer.length} links — check the fixture`);

  const missing = footer.filter((href) => !rail.has(href));
  assert.deepEqual(
    missing,
    [],
    `hidden from 1280px up and absent from the rail, so unreachable on a desktop: ${missing.join(', ')}`,
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
