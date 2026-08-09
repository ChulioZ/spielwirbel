'use strict';

/* The Wunschliste's action weights (#696): the screen exists to bring games IN,
 * so „Ins Regal" leads the row as the filled primary, and the destructive
 * „Von der Liste nehmen" is demoted to the quiet danger-text form the
 * game-detail „Aussortieren" set the precedent for. `btn--danger`'s louder
 * treatment stays reserved for the two archives, where the delete really is
 * „Endgültig löschen" of a game the round played.
 *
 * Rendered through the jsdom harness (`.claude/rules/testing-views-under-jsdom.md`)
 * because the claim is about which classes the built buttons carry — a regex
 * over the template literal cannot see which `kind` a conditional resolves for.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';

function roundFixture() {
  return {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    providers: [],
    members: [{ id: 'm1', name: 'Anna' }],
    games: [
      { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: [] },
      { id: 'g2', title: 'Azul', retired: true, retiredAt: '2026-07-01T10:00:00.000Z', tagIds: [] },
      { id: 'g3', title: 'Cascadia', completed: true, completedAt: '2026-07-02T10:00:00.000Z', tagIds: [] },
      { id: 'g4', title: 'Ark Nova', wish: true, wishAt: '2026-07-03T10:00:00.000Z', tagIds: [] },
    ],
    sessions: [],
  };
}

function bootApp(t_) {
  const dom = loadApp();
  t_.after(() => dom.close());
  const round = roundFixture();
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    return {};
  });
  dom.set('toast', () => {});
  return dom;
}

/** The row's two action buttons, scoped to the list (the rail is in #app too). */
function rowActions(app) {
  const row = app.querySelector('.archive-list .archive-row');
  assert.ok(row, 'the screen rendered no row — check the fixture');
  return {
    restore: row.querySelector('[data-act="restore"]'),
    del: row.querySelector('[data-act="delete"]'),
  };
}

test('a wish row leads with „Ins Regal" and keeps only a quiet danger hint on removal', async (t_) => {
  const dom = bootApp(t_);
  await dom.call('showWishlist', RID);
  const { restore, del } = rowActions(dom.app);

  assert.ok(restore.classList.contains('btn--primary'),
    '„Ins Regal" is not the row\'s leading action');
  assert.ok(!del.classList.contains('btn--danger'),
    'the removal still carries the loud btn--danger treatment');
  assert.match(del.getAttribute('style') || '',
    /var\(--danger\)/,
    'the removal lost its danger hint entirely — it does delete the wish row');
});

/* The control half: the two archives keep the established weights, where the
   delete really is permanent removal of a played game and earns `btn--danger`. */
for (const [view, kind] of [['showRetired', 'retired'], ['showCompleted', 'completed']]) {
  test(`a ${kind} row keeps the plain restore and the btn--danger delete`, async (t_) => {
    const dom = bootApp(t_);
    await dom.call(view, RID);
    const { restore, del } = rowActions(dom.app);

    assert.ok(!restore.classList.contains('btn--primary'),
      `the ${kind} restore was promoted — #696 rebalances only the wish list`);
    assert.ok(del.classList.contains('btn--danger'),
      `the ${kind} delete lost its earned danger treatment`);
    assert.equal(del.getAttribute('style'), null,
      `the ${kind} delete gained an inline style it never had`);
  });
}
