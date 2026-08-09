'use strict';

/* The sparse onboarding panel („Ein unbeschriebenes Blatt", #256) keeps its
 * title and its cover/tags/players actions on a wished-for game, but swaps its
 * explanatory sentence (#716). The shipped text promises that ratings and
 * sessions appear „sobald ihr es spielt" — impossible while the game sits on
 * the Wunschliste, since a wish can never be drawn, played or rated (#560,
 * `.claude/rules/active-games-filter-sites.md`). Follow-up to #699/PR #715,
 * which hid the ring and the related sessions on a wish and left this panel
 * deliberately out of scope.
 *
 * The wish fixture here is the INVERSE of `test/wish-detail-stats.test.js`'s:
 * that one is deliberately non-sparse (cover + session + rating) to prove the
 * hide is unconditional, this one is deliberately sparse, because the panel
 * only renders at all for a sparse game.
 *
 * Rendered through the jsdom harness; selectors are scoped to `.gd-onboard`
 * because the desktop rail inside `dom.app` carries its own headings and text.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, translator } = require('./support/dom');

const RID = 'r1';
const t = translator('de');

function roundFixture() {
  return {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [{ id: 'tg1', name: 'Kenner' }],
    providers: [],
    members: [{ id: 'm1', name: 'Anna' }],
    games: [
      // Sparse wish: no cover, no tag, no rating, no session — the state a
      // hand-added wish or a wishlist import lands in.
      { id: 'g1', title: 'Ark Nova', wish: true, wishAt: '2026-07-03T10:00:00.000Z', tagIds: [] },
      // Sparse shelf game: the control that must keep the original sentence.
      { id: 'g2', title: 'Catan', tagIds: [] },
      // Non-sparse wish (carries a tag): no panel renders for it at all.
      { id: 'g3', title: 'Dune', wish: true, wishAt: '2026-07-04T10:00:00.000Z', tagIds: ['tg1'] },
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
  return { dom, round };
}

const onboard = (dom) => dom.app.querySelector('.gd-onboard');

test('a sparse wish explains the wish list instead of promising play-derived data', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const panel = onboard(dom);
  assert.ok(panel, 'the onboarding panel renders for a sparse wish');
  assert.ok(
    panel.textContent.includes(t('detail.onboard.wishText')),
    'the wish-specific sentence is shown'
  );
  assert.ok(
    !panel.textContent.includes(t('detail.onboard.text')),
    'the play-promise sentence is not shown on a wish'
  );
});

test('a sparse wish keeps the panel title and all three actions', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const panel = onboard(dom);
  assert.equal(panel.querySelector('h2').textContent, t('detail.onboard.title'));
  assert.deepEqual(
    [...panel.querySelectorAll('.gd-onboard__act')].map((b) => b.textContent.trim()),
    [t('detail.onboard.cover'), t('detail.onboard.tags'), t('detail.onboard.players')]
  );
});

test('a sparse shelf game still shows the original sentence', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g2');
  const panel = onboard(dom);
  assert.ok(panel, 'the onboarding panel renders for a sparse shelf game');
  assert.ok(
    panel.textContent.includes(t('detail.onboard.text')),
    'the play-promise sentence is kept off the wish list'
  );
  assert.ok(
    !panel.textContent.includes(t('detail.onboard.wishText')),
    'the wish sentence does not leak onto a shelf game'
  );
});

test('a non-sparse wish renders no onboarding panel at all', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g3');
  assert.equal(onboard(dom), null);
});
