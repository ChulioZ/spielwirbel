'use strict';

/* The Regal's scope strip (#1500) is the ONE way onto the four off-shelf lists
 * from the Regal side, at every width and in every design — so every list the
 * hub's „Weitere Listen" group offers must be in it, with the same count.
 *
 * Why parity and not "the strip exists": the strip replaced up to four other
 * presentations (a toolbar sheet, a band or line under the grid, the Klassisch
 * rail's group). Each of those used to be the only way in at SOME width, and a
 * row missing from one was a screen unreachable at that width with nothing red —
 * #682 shipped its recommendations screen into the narrow surface alone, so the
 * feature had no entry point on a desktop. One strip at every width closes the
 * width half of that; this file keeps the other half, that the strip and the hub
 * offer the same destinations and counts, so a fifth list added to one is
 * checked against the other without editing this file.
 *
 * The rows come from offShelfEntries() (public/js/off-shelf.js) on both
 * surfaces, so this cannot drift by construction today — the assertions are
 * what notices the day a surface goes back to deriving its own.
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
  { id: 'g5', title: 'Dixit', minPlayers: 3, maxPlayers: 6, tagIds: [] },
  ...baseGames,
]);

async function render(t, tab, payload = round) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return payload;
    return {};
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  await dom.call('showRound', RID, tab);
  return dom;
}

const rowsOf = (root) =>
  [...root.querySelectorAll('a[href]')].map((a) => ({
    href: a.getAttribute('href'),
    text: a.textContent.replace(/\s+/g, ' ').trim(),
  }));

const strip = (dom) => {
  const nav = dom.app.querySelector('nav.offshelf-seg');
  assert.ok(nav, 'the screen renders no scope strip');
  return nav;
};

test('the Regal is headed by the strip: Regal first and current, then the four lists', async (t) => {
  const dom = await render(t, 'regal');
  const nav = strip(dom);
  assert.equal(nav.getAttribute('aria-label'), 'Regal und Listen');
  // Above the shelf's own section, never below the grid.
  assert.equal(nav.nextElementSibling, dom.app.querySelector('.section'), 'the strip does not head the Regal');
  assert.deepEqual(rowsOf(nav), [
    { href: `/round/${RID}/regal`, text: 'Regal (2)' },
    { href: `/round/${RID}/wishlist`, text: 'Wunschliste (1)' },
    { href: `/round/${RID}/retired`, text: 'Aussortiert (1)' },
    { href: `/round/${RID}/completed`, text: 'Durchgespielt (1)' },
    { href: `/round/${RID}/recommendations`, text: 'Könnte euch gefallen' },
  ]);
  const current = [...nav.querySelectorAll('[aria-current]')];
  assert.equal(current.length, 1);
  assert.equal(current[0].dataset.sub, 'regal');
  assert.equal(current[0].getAttribute('aria-current'), 'page');
});

test('every list the hub offers is in the strip, with the same count', async (t) => {
  const regal = rowsOf(strip(await render(t, 'regal')));
  const hub = rowsOf((await render(t, 'start')).app.querySelector('.hub-offshelf'));
  // Anti-vacuous: with no rows the comparison passes trivially.
  assert.equal(hub.length, 4, `the hub group rendered ${hub.length} links — check the fixture`);
  const byHref = new Map(regal.map((r) => [r.href, r.text]));
  const drifted = hub.filter((r) => byHref.get(r.href) !== r.text);
  assert.deepEqual(drifted.map((r) => `${r.href}: hub "${r.text}" vs strip "${byHref.get(r.href)}"`), []);
  // And the hub never offers the Regal as one of its „Weitere Listen".
  assert.ok(!hub.some((r) => r.href.endsWith('/regal')), 'the hub group offers the Regal as a further list');
});

test('the strip is the Regal\'s ONLY way onto the lists — no sheet, no footer, no toolbar control', async (t) => {
  const dom = await render(t, 'regal');
  const listHrefs = /\/(wishlist|retired|completed|recommendations)$/;
  const outside = [...dom.app.querySelectorAll('a[href]')]
    .filter((a) => listHrefs.test(a.getAttribute('href')) && !a.closest('nav.offshelf-seg'))
    .map((a) => `${a.className} → ${a.getAttribute('href')}`);
  assert.deepEqual(outside, [], 'the Regal (or the rail beside it) still links the lists outside the strip');
  assert.equal(dom.app.querySelector('.round-footer'), null);
  assert.equal(dom.app.querySelector('.section-tools .ti-archive'), null, 'the toolbar still carries an off-shelf control');
});

test('the strip\'s rows are real links', async (t) => {
  const dom = await render(t, 'regal');
  const items = [...strip(dom).querySelectorAll('.offshelf-seg__item')];
  assert.equal(items.length, 5);
  for (const a of items) {
    assert.equal(a.tagName, 'A', 'a strip segment is not an anchor, so it cannot be opened in a new tab');
    assert.match(a.getAttribute('href') || '', new RegExp(`^/round/${RID}/`));
  }
});

test('the strip heads an EMPTY shelf too', async (t) => {
  // An empty shelf can still have a full Wunschliste — the case that needs the
  // way in most. `.empty` is rendered by the zero-active-games branch ONLY.
  const dom = await render(t, 'regal', roundWith(baseGames));
  assert.ok(dom.app.querySelector('.section .empty'), 'fixture is not an empty shelf');
  const rows = rowsOf(strip(dom));
  assert.equal(rows.length, 5);
  assert.equal(rows[0].text, 'Regal (0)');
});

test('on a list screen the same strip marks the list, and the Regal is a live link back', async (t) => {
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

  const nav = strip(dom);
  const current = [...nav.querySelectorAll('[aria-current]')];
  assert.deepEqual(current.map((a) => a.dataset.sub), ['recommendations']);
  const back = nav.querySelector('[data-sub="regal"]');
  assert.equal(back.getAttribute('aria-current'), null);
  back.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(dom.app.querySelector('.section .cards'), 'the Regal segment did not lead back to the shelf');
});
