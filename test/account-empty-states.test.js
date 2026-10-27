'use strict';

/* The account-level screens' whole-screen empty states — the inbox, „Was ist
   neu", the quiz archive and the price-alert list — render through the one
   empty-state component (public/js/empty-state.js, #869), like every round
   screen already did. They were a bare muted sentence under the title: the
   „three visual languages on sibling screens" #869 removed inside a round,
   still present one level up (UI audit, 2026-10-27).

   Each keeps its existing string as the sub-line and gains no invented title
   (empty-state.js: the title is optional on purpose). Inline empties inside a
   populated screen — the feed bands, the profile's sections — stay notes. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');

function boot(t, cfg = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('toast', () => {});
  dom.run(`accountCfg = ${JSON.stringify(cfg)}`);
  return dom;
}

// The component, carrying the screen's own string, and no bare note beside it.
function assertEmptyState(dom, key) {
  const empty = dom.app.querySelector('.empty');
  assert.ok(empty, 'no .empty component rendered');
  assert.ok(empty.querySelector('.empty__icon .ti'), 'the medallion has no icon');
  assert.equal(empty.querySelector('.empty__text').textContent, dom.run(`t(${JSON.stringify(key)})`));
  assert.equal(dom.app.querySelector('.empty-note, .price-watches__empty'), null, 'a bare note is still rendered');
}

test('an empty inbox renders the empty-state component', async (t) => {
  const dom = boot(t);
  dom.set('accountApi', async () => ({ items: [] }));
  await dom.call('showInbox');
  assertEmptyState(dom, 'inbox.empty');
});

test('an empty „Was ist neu" renders the empty-state component', async (t) => {
  const dom = boot(t);
  const news = dom.get('NEWS');
  const saved = [...news];
  news.length = 0;
  t.after(() => { news.length = 0; news.push(...saved); });
  dom.context.__user = { id: 'u1', username: 'ada', email: 'a@example.com', lastSeenNewsRevision: null };
  dom.run('accountUser = __user');
  dom.set('accountApi', async () => ({}));
  await dom.call('showNews');
  assertEmptyState(dom, 'news.empty');
});

test('an empty quiz archive renders the empty-state component', async (t) => {
  const dom = boot(t, { quiz: true });
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ current: null, past: [] }) });
  await dom.call('showQuizArchive');
  await flush();
  assertEmptyState(dom, 'quiz.archive.empty');
});

test('an empty price-alert list renders the empty-state component', async (t) => {
  const dom = boot(t, { prices: true });
  dom.set('api', async () => ({ watches: [], limit: 50 }));
  await dom.call('showPriceWatches');
  await flush();
  assertEmptyState(dom, 'priceWatch.empty');
});

// The demo banner's text must carry a DEFINITE flex-basis. With the default
// `auto` its basis is its own content (up to `max-width: 60ch`), wider than a
// phone, so flex-wrap puts the text on a line of its own and strands the 14px
// clock icon alone above it — measured at 390px: a 137px banner with a
// one-icon first row (UI audit, 2026-10-27). A basis lets icon and text share
// the first line, while the CTA still wraps beneath.
test('the demo banner text has a definite flex-basis, so its icon is not stranded', () => {
  const { bodyOf, declaredValue } = require('./support/css');
  const body = bodyOf('.demo-banner__text');
  assert.ok(body, '.demo-banner__text rule not found');
  const flex = declaredValue(body, 'flex') || declaredValue(body, 'flex-basis') || '';
  assert.match(flex, /\d+(?:\.\d+)?(?:rem|px|ch|em)/, `no definite basis: "${flex}"`);
});
