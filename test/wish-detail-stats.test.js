'use strict';

/* A wished-for game's detail page hides the score ring and the related-sessions
 * section (#699). A wish is a game the round does not own, so it can never be
 * drawn, played, rated or aussortiert while on the list — the empty "–" ring
 * („Noch keine Bewertung") and the empty „Related sessions" block implied
 * otherwise and padded the page with exactly the near-empty widgets #256
 * removed for sparse games.
 *
 * The hide is unconditional for a wish: even when the data DOES hold sessions
 * and ratings for the game (reachable only by flagging an already-played game
 * `wish: true` through the raw API), the page shows neither. Nothing is
 * deleted — both reappear the moment the game moves onto the shelf. The wish
 * fixture below therefore carries a cover, a finished session and a rating, so
 * it is decisively non-sparse AND exercises that edge: a spec whose wish
 * fixture were sparse would pass against the sparse suppression alone, with
 * the wish condition missing (`.claude/rules/testing-views-under-jsdom.md`).
 *
 * Rendered through the jsdom harness; selectors are scoped to `.gd-head` / the
 * screen's own sections because the desktop rail inside `dom.app` carries its
 * own headings.
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
    tags: [],
    providers: [],
    members: [{ id: 'm1', name: 'Anna' }],
    games: [
      // Active control with NO ratings/sessions but a cover: not sparse, so the
      // empty ring and the empty related section must still render for it.
      { id: 'g1', title: 'Catan', image: '/uploads/catan.jpg', minPlayers: 3, maxPlayers: 4, tagIds: [] },
      { id: 'g2', title: 'Azul', image: '/uploads/azul.jpg', retired: true, retiredAt: '2026-07-01T10:00:00.000Z', tagIds: [] },
      // The wish, with a cover AND real session data (the API-only edge case).
      {
        id: 'g4', title: 'Ark Nova', image: '/uploads/ark.jpg', wish: true,
        wishAt: '2026-07-03T10:00:00.000Z', minPlayers: 1, maxPlayers: 4, tagIds: [],
      },
    ],
    sessions: [
      {
        id: 's1', createdAt: '2026-06-01T19:00:00.000Z', finished: true,
        gameIds: ['g4'], chosenGameId: 'g4', winnerIds: ['m1'],
        votes: { m1: { g4: { rating: 4 } } },
      },
    ],
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

/** The screen's related-sessions section, found by its heading — scoped past
 *  the rail by walking only direct `.section` children of #app. */
function relatedSection(dom) {
  return [...dom.app.querySelectorAll(':scope > .section')].find(
    (sec) => sec.querySelector('h2') && sec.querySelector('h2').textContent === t('detail.relatedTitle')
  );
}

test('a wished game shows neither the score ring nor related sessions — even with session data present', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g4');
  assert.ok(dom.app.querySelector('.gd-head'), 'detail page rendered');
  assert.equal(dom.app.querySelector('.gd-head .gd-stats'), null, 'no score ring block on a wish');
  assert.equal(relatedSection(dom), undefined, 'no related-sessions section on a wish');
});

test('an active game still renders both, including their empty states', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const stats = dom.app.querySelector('.gd-head .gd-stats');
  assert.ok(stats, 'score ring block renders for an active game');
  assert.ok(stats.textContent.includes(t('detail.noRating')), 'the empty ring state still shows');
  const sec = relatedSection(dom);
  assert.ok(sec, 'related-sessions section renders for an active game');
  assert.ok(sec.textContent.includes(t('detail.relatedEmpty')), 'its empty state still shows');
});

test('a retired game still renders both', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g2');
  assert.ok(dom.app.querySelector('.gd-head .gd-stats'));
  assert.ok(relatedSection(dom));
});
