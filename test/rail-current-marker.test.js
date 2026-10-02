'use strict';

/* Exactly ONE rail row is marked, and since #1500 the four off-shelf lists are
 * views of the Regal — so on a list screen, and on the detail page of a game
 * sitting in one, the marked row is the Regal, `inside` ("true").
 *
 * History, because the previous answer was the opposite: #794 gave the Klassisch
 * rail a „Nicht im Regal" group and made the list that holds a game claim the
 * marker on its detail page, since the Regal "by definition cannot contain" a
 * wished-for game. #1500 removed that group — the lists are reached through the
 * Regal's scope strip in every design — so the rail has no row for them, and
 * the section that owns the strip is the honest answer. The dock already said
 * so below 1280px; now both navigations agree.
 *
 * Rendered through the jsdom harness rather than matched over the view source
 * (`.claude/rules/testing-views-under-jsdom.md`). Every case counts the marked
 * rows, so a change that marks everything cannot pass. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';

/* One fixture for every case: an active game plus one in each of the three
   off-shelf lists, so each screen has a real row rather than its empty state. */
const GAMES = [
  { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: [] },
  { id: 'g2', title: 'Azul', retired: true, retiredAt: '2026-07-01T10:00:00.000Z', tagIds: [] },
  { id: 'g3', title: 'Cascadia', completed: true, completedAt: '2026-07-02T10:00:00.000Z', tagIds: [] },
  { id: 'g4', title: 'Ark Nova', wish: true, wishAt: '2026-07-03T10:00:00.000Z', tagIds: [] },
];

const ROUND = {
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: GAMES,
  sessions: [],
};

async function boot(t) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return ROUND;
    return {};
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  return dom;
}

/* Scoped to `.rail`, never to `#app`: renderSubScreenTabs prepends BOTH the rail
   and the dock, and the dock deliberately keeps marking the Regal here — reading
   them together would make the two answers indistinguishable. */
const railRows = (dom) => [...dom.app.querySelectorAll('.rail .rail__item')];
const markedRows = (dom) => railRows(dom).filter((el) => el.hasAttribute('aria-current'));
const rowFor = (dom, path) => railRows(dom).find((el) => el.getAttribute('href') === path);

/** The single marked rail row, asserting there is exactly one. */
function soleMarked(dom, where) {
  const marked = markedRows(dom);
  assert.equal(
    marked.length, 1,
    `${where}: expected exactly one marked rail row, got ${marked.length} (${marked
      .map((el) => el.getAttribute('href')).join(', ')})`,
  );
  // `is-active` is the visual half of the same marker and drifts silently from
  // the ARIA half, since each is written by a separate expression.
  const active = railRows(dom).filter((el) => el.classList.contains('is-active'));
  assert.deepEqual(
    active.map((el) => el.getAttribute('href')), [marked[0].getAttribute('href')],
    `${where}: is-active and aria-current disagree about which row is marked`,
  );
  return marked[0];
}

const OFF_SHELF = [
  { flag: 'wish', gid: 'g4', title: 'Ark Nova', view: 'showWishlist', path: `/round/${RID}/wishlist` },
  { flag: 'retired', gid: 'g2', title: 'Azul', view: 'showRetired', path: `/round/${RID}/retired` },
  { flag: 'completed', gid: 'g3', title: 'Cascadia', view: 'showCompleted', path: `/round/${RID}/completed` },
];

const REGAL = `/round/${RID}/regal`;

test('the rail carries no off-shelf rows at all — the Regal\'s strip reaches the lists', async (t) => {
  const dom = await boot(t);
  await dom.call('showRound', RID, 'regal');
  assert.ok(railRows(dom).length >= 5, 'the rail rendered too few rows — check the fixture');
  for (const { flag, path } of OFF_SHELF) {
    assert.equal(rowFor(dom, path), undefined, `the rail still carries a ${flag} row`);
  }
  assert.equal(rowFor(dom, `/round/${RID}/recommendations`), undefined, 'the rail still carries the recommendations row');
});

for (const { flag, gid, title } of OFF_SHELF) {
  test(`the rail marks the Regal, inside, on ${title}'s detail page (a ${flag} game)`, async (t) => {
    const dom = await boot(t);
    await dom.call('showGameDetail', RID, gid);
    const marked = soleMarked(dom, `${flag} game detail`);
    assert.equal(marked.getAttribute('href'), REGAL);
    // "true", not "page": the user is on the game detail, not on the Regal.
    assert.equal(marked.getAttribute('aria-current'), 'true');
  });
}

test('an active game\'s detail page marks the Regal, inside', async (t) => {
  const dom = await boot(t);
  await dom.call('showGameDetail', RID, 'g1');
  const marked = soleMarked(dom, 'active game detail');
  assert.equal(marked.getAttribute('href'), REGAL);
  assert.equal(marked.getAttribute('aria-current'), 'true');
});

for (const { flag, view } of OFF_SHELF) {
  test(`on the ${flag} list the Regal is marked inside and is still a working link back`, async (t) => {
    const dom = await boot(t);
    await dom.call(view, RID);
    const marked = soleMarked(dom, `${flag} list screen`);
    assert.equal(marked.getAttribute('href'), REGAL);
    // `inside`, not `page`: the list is a view of the Regal, not the Regal —
    // and a click must still navigate, or a desktop user has no rail route back.
    assert.equal(marked.getAttribute('aria-current'), 'true');
    marked.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(dom.window.location.pathname, REGAL, `clicking the Regal on the ${flag} list did not navigate`);
  });
}

test('the dock is untouched: it marks the Regal on a game detail of every state', async (t) => {
  const dom = await boot(t);
  for (const gid of ['g1', 'g2', 'g3', 'g4']) {
    await dom.call('showGameDetail', RID, gid);
    const marked = [...dom.app.querySelectorAll('.dock .dock__item')]
      .filter((el) => el.hasAttribute('aria-current'));
    assert.equal(marked.length, 1, `${gid}: expected exactly one marked dock tab`);
    // The dock carries only the four hub tabs, and the Regal owns every game.
    assert.equal(marked[0].getAttribute('href'), `/round/${RID}/regal`, `${gid}: dock moved off the Regal`);
    assert.equal(marked[0].getAttribute('aria-current'), 'true');
    assert.ok(dom.app.querySelector('.dock--sub'), `${gid}: the dock lost its .dock--sub class`);
  }
});
