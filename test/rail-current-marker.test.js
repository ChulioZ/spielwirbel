'use strict';

/* Exactly ONE rail row is marked, and on a game detail it is the list that
   actually holds the game (#794).
 *
 * The defect this pins: `showGameDetail` hard-coded `renderSubScreenTabs(round,
 * 'game')`, HUB_TAB_OF maps 'game' to the Regal, and so the detail page of a
 * wished-for game highlighted the one section that by definition cannot contain
 * it — while the Wunschliste row directly below it, which does, stayed unmarked.
 * The back control on the same screen already derived the game's home from its
 * own flags (#663), so the two navigation affordances pointed at different
 * lists.
 *
 * Rendered through the jsdom harness rather than matched over the view source
 * (`.claude/rules/testing-views-under-jsdom.md`): the assertion is about which
 * of nine rail rows carries the marker after four different screens have run,
 * which no regex over `renderSubScreenTabs(…)` can see.
 *
 * The negative half carries as much weight as the positive one. Asserting only
 * "the Wunschliste row is marked" is satisfied by a change that marks
 * everything, so every case below counts the marked rows and names the Regal
 * explicitly. */

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

for (const { flag, gid, title, path } of OFF_SHELF) {
  test(`the rail marks the ${flag} list, not the Regal, on ${title}'s detail page`, async (t) => {
    const dom = await boot(t);
    await dom.call('showGameDetail', RID, gid);

    const marked = soleMarked(dom, `${flag} game detail`);
    assert.equal(marked.getAttribute('href'), path, `the marked row is not the ${flag} list`);
    // "true", not "page": the user is on the game detail, not on the list.
    assert.equal(marked.getAttribute('aria-current'), 'true');

    // The Regal is the row the bug lit up, so it is named rather than merely
    // covered by the count above.
    const regal = rowFor(dom, `/round/${RID}/regal`);
    assert.ok(regal, 'the rail has no Regal row at all — check the fixture');
    assert.equal(regal.hasAttribute('aria-current'), false, 'the Regal is still marked');
    assert.equal(regal.classList.contains('is-active'), false, 'the Regal is still is-active');
  });

  test(`the marked ${flag} row is still a working link back to the list`, async (t) => {
    const dom = await boot(t);
    await dom.call('showGameDetail', RID, gid);

    const marked = soleMarked(dom, `${flag} game detail`);
    assert.equal(marked.getAttribute('href'), path);
    // The whole reason this is `inside` and not `current`: a click must still
    // navigate, or a desktop user on the detail page has no rail route back up.
    marked.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(
      dom.window.location.pathname, path,
      `clicking the marked ${flag} row did not navigate to the list`,
    );
  });
}

test('an active game\'s detail page still marks the Regal, and no off-shelf row', async (t) => {
  const dom = await boot(t);
  await dom.call('showGameDetail', RID, 'g1');

  const marked = soleMarked(dom, 'active game detail');
  assert.equal(marked.getAttribute('href'), `/round/${RID}/regal`);
  assert.equal(marked.getAttribute('aria-current'), 'true');
  for (const { flag, path } of OFF_SHELF) {
    assert.equal(
      rowFor(dom, path).hasAttribute('aria-current'), false,
      `the ${flag} row is marked on an ACTIVE game's detail page`,
    );
  }
});

for (const { flag, view, path } of OFF_SHELF) {
  test(`the ${flag} list screen itself is unchanged: its own row is "page" and inert`, async (t) => {
    const dom = await boot(t);
    await dom.call(view, RID);

    const marked = soleMarked(dom, `${flag} list screen`);
    assert.equal(marked.getAttribute('href'), path);
    // "page" and click-inert — you ARE on this screen. That is the state the
    // game detail must NOT get, so the two are pinned against each other.
    assert.equal(marked.getAttribute('aria-current'), 'page');
  });
}

test('the dock is untouched: it marks the Regal on a game detail of every state', async (t) => {
  const dom = await boot(t);
  for (const gid of ['g1', 'g2', 'g3', 'g4']) {
    await dom.call('showGameDetail', RID, gid);
    const marked = [...dom.app.querySelectorAll('.dock .dock__item')]
      .filter((el) => el.hasAttribute('aria-current'));
    assert.equal(marked.length, 1, `${gid}: expected exactly one marked dock tab`);
    // Below 1280px the dock carries only the four hub tabs, so it has no
    // off-shelf entry to mark — deliberately left to #777.
    assert.equal(marked[0].getAttribute('href'), `/round/${RID}/regal`, `${gid}: dock moved off the Regal`);
    assert.equal(marked[0].getAttribute('aria-current'), 'true');
    assert.ok(dom.app.querySelector('.dock--sub'), `${gid}: the dock lost its .dock--sub class`);
  }
});
