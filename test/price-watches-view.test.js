'use strict';

/* The price-watch screens (#680), rendered under jsdom: the account-menu row,
   the control under a wished game's price box, the /preisalarme list, and the
   price-drop row in the inbox. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const WATCH = {
  id: 'w1', externalId: '342942', title: 'Arche Nova', thresholdCents: 4000, currency: 'EUR',
  destination: 'DE', editionLang: 'DE', lastPrice: { amountCents: 4299, currency: 'EUR', observedAt: '2026-10-08T06:00:00Z' },
  lastCheckedAt: '2026-10-08T06:00:00Z', createdAt: '2026-10-01T10:00:00Z',
};

function app(t, { prices = true } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('toast', () => {});
  dom.run(prices ? 'accountCfg = { prices: true }' : 'accountCfg = { prices: false }');
  const calls = [];
  return { dom, calls };
}

const menuLabels = (dom) => {
  dom.call('setupAccountUi');
  dom.document.getElementById('accountBtn').click();
  return [...dom.document.querySelectorAll('.popover__opt')].map((el) => el.textContent.trim());
};

test('the account menu offers „Preisalarme" only where prices exist', (t) => {
  assert.ok(menuLabels(app(t).dom).includes('Preisalarme'));
  assert.ok(!menuLabels(app(t, { prices: false }).dom).includes('Preisalarme'));
});

test('under the price box: a form prefilled with today\'s price, which sets the watch with the game\'s edition', async (t) => {
  const { dom, calls } = app(t);
  dom.set('api', async (method, url, body) => {
    calls.push([method, url, body && JSON.parse(JSON.stringify(body))]);
    if (method === 'GET') return { watches: [], limit: 50 };
    return { watch: { ...WATCH, thresholdCents: 3999 } };
  });
  const anchor = dom.document.createElement('div');
  dom.app.appendChild(anchor);
  const game = { title: 'Arche Nova', source: { provider: 'bgg', externalId: 342942 }, edition: { languages: ['German'] } };
  await dom.call('renderPriceWatchControl', anchor, game, { amount: 42.99, currency: 'EUR' });
  const input = dom.app.querySelector('#gdWatchAt');
  assert.equal(input.value, '42', 'today\'s price, rounded down');
  input.value = '39,99';
  dom.app.querySelector('.gd-watch__form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush(); await flush();
  const post = calls.find((c) => c[0] === 'POST');
  assert.equal(post[1], '/api/price-watches');
  assert.deepEqual(post[2], { externalId: '342942', title: 'Arche Nova', thresholdCents: 3999, lang: 'de', editionLanguages: ['German'] });
  assert.match(text(dom.app.querySelector('.gd-watch__state')), /höchstens 39,99/);
});

test('an existing watch on that game is shown, wherever it was set, and can be stopped', async (t) => {
  const { dom, calls } = app(t);
  dom.set('api', async (method, url) => {
    calls.push([method, url]);
    return method === 'GET' ? { watches: [WATCH], limit: 50 } : null;
  });
  const anchor = dom.document.createElement('div');
  dom.app.appendChild(anchor);
  await dom.call('renderPriceWatchControl', anchor, { title: 'Arche Nova', source: { externalId: '342942' } }, { amount: 42.99, currency: 'EUR' });
  assert.match(text(dom.app.querySelector('.gd-watch__state')), /Du beobachtest dieses Spiel/);
  dom.app.querySelector('#gdWatchStop').click();
  await flush();
  assert.deepEqual(calls[calls.length - 1], ['DELETE', '/api/price-watches/w1']);
  assert.ok(dom.app.querySelector('.gd-watch__form'), 'back to the form');
});

test('prices off: no control at all', async (t) => {
  const { dom } = app(t, { prices: false });
  let asked = false;
  dom.set('api', async () => { asked = true; return {}; });
  const anchor = dom.document.createElement('div');
  dom.app.appendChild(anchor);
  await dom.call('renderPriceWatchControl', anchor, { source: { externalId: '1' } }, { amount: 1, currency: 'EUR' });
  assert.equal(asked, false);
  assert.equal(anchor.isConnected, false);
});

test('/preisalarme lists each watch with its threshold, last price and market, and adds from a search', async (t) => {
  const { dom, calls } = app(t);
  dom.set('api', async (method, url, body) => {
    calls.push([method, url, body && JSON.parse(JSON.stringify(body))]);
    if (url.startsWith('/api/price-watches/search')) return { results: [{ externalId: '13', title: 'Catan', year: 1995 }, { externalId: '342942', title: 'Arche Nova', year: 2021 }] };
    if (method === 'GET') return { watches: [WATCH], limit: 50 };
    return { watch: { ...WATCH, id: 'w2', externalId: '13', title: 'Catan', lastPrice: null, lastCheckedAt: null } };
  });
  await dom.call('showPriceWatches');
  assert.equal(text(dom.app.querySelector('h1')), 'Preisalarme');
  assert.equal(dom.app.querySelector('.back-row'), null, 'a main page: no back control');
  const row = dom.app.querySelector('.price-watch');
  assert.match(text(row), /Arche Nova/);
  assert.match(text(row), /höchstens 40,00/);
  assert.match(text(row), /zuletzt 42,99/);
  assert.match(text(row), /Versand nach DE · Ausgabe DE/);

  dom.app.querySelector('#watchSearch').value = 'cat';
  dom.app.querySelector('.price-watches__search').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush(); await flush();
  const hits = [...dom.app.querySelectorAll('.price-watches__hit')];
  assert.equal(hits.length, 2);
  assert.match(text(hits[1]), /Wird schon beobachtet/, 'a game already watched is not offered twice');
  hits[0].querySelector('button').click();
  const form = hits[0].querySelector('.price-watch__form');
  form.querySelector('input').value = '25';
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush(); await flush();
  const post = calls.find((c) => c[0] === 'POST');
  assert.deepEqual(post[2], { externalId: '13', title: 'Catan', thresholdCents: 2500, lang: 'de' });
  assert.equal(dom.app.querySelectorAll('.price-watch').length, 2, 'the new watch joins the list');
});

test('a price-drop item states the price, the threshold, when it was seen, and links to the aggregator', async (t) => {
  const { dom } = app(t);
  const calls = [];
  // The watch that wrote the item (w1) was ended since and a new one set (w9):
  // „Beenden" must end the game's LIVE watch, not report the old one's 404.
  dom.set('api', async (method, url) => {
    calls.push([method, url]);
    return method === 'GET' ? { watches: [{ ...WATCH, id: 'w9' }], limit: 50 } : null;
  });
  // afterRemove() re-reads the inbox once its last row is gone.
  dom.set('accountApi', async (method, url) => (url === '/inbox' ? { items: [] } : {}));
  const item = {
    id: 'i1', type: 'price_drop', read: false, createdAt: '2026-10-08T06:00:00Z',
    payload: { watchId: 'w1', externalId: '342942', title: 'Arche Nova', amountCents: 3899, currency: 'EUR', shippingKnown: true, thresholdCents: 4000,
      observedAt: '2026-10-08T06:00:00Z', url: 'https://brettspielpreise.de/item/show/1/arche-nova' },
  };
  const row = dom.call('renderInboxItem', item);
  dom.app.appendChild(row);
  assert.match(text(row), /Preis gefallen: Arche Nova/);
  assert.match(text(row), /38,99.*inkl\. Versand.*höchstens 40,00/);
  assert.match(text(row), /Preis gesehen am/);
  assert.equal(row.querySelector('.inbox-row__offers').getAttribute('href'), item.payload.url);
  assert.match(text(row), /Brettspielpreise\.de/, 'the source line their terms ask for');
  row.querySelector('.inbox-row__stop').click();
  await flush(); await flush();
  assert.deepEqual(calls.map((c) => c.join(' ')), ['GET /api/price-watches', 'DELETE /api/price-watches/w9']);
  assert.equal(row.isConnected, false, 'the item goes with the watch');
});

test('a price-drop link that is not https is not rendered', (t) => {
  const { dom } = app(t);
  const row = dom.call('renderInboxItem', { id: 'i2', type: 'price_drop', read: true, createdAt: '2026-10-08T06:00:00Z',
    payload: { watchId: 'w1', title: 'X', amountCents: 100, currency: 'EUR', thresholdCents: 200, observedAt: '2026-10-08T06:00:00Z', url: 'javascript:alert(1)' } });
  assert.equal(row.querySelector('.inbox-row__offers'), null);
});

test('the prefill is BELOW today\'s price, so setting it unchanged never alerts on a price that did not move', async (t) => {
  for (const [amount, want] of [[42.99, '42'], [39, '38'], [0.5, '0.49']]) {
    const { dom } = app(t);
    dom.set('api', async () => ({ watches: [], limit: 50 }));
    const anchor = dom.document.createElement('div');
    dom.app.appendChild(anchor);
    await dom.call('renderPriceWatchControl', anchor, { title: 'X', source: { externalId: '1' } }, { amount, currency: 'EUR' });
    assert.equal(dom.app.querySelector('#gdWatchAt').value, want, String(amount));
  }
});

test('editing an existing watch labels the amount in the WATCH\'s currency, not today\'s market', async (t) => {
  const { dom } = app(t);
  dom.set('api', async () => ({ watches: [{ ...WATCH, currency: 'GBP' }], limit: 50 }));
  const anchor = dom.document.createElement('div');
  dom.app.appendChild(anchor);
  await dom.call('renderPriceWatchControl', anchor, { title: 'Arche Nova', source: { externalId: '342942' } }, { amount: 42.99, currency: 'EUR' });
  dom.app.querySelector('#gdWatchEdit').click();
  assert.match(text(dom.app.querySelector('.gd-watch__label')), /GBP/);
});

test('without a live price an existing watch still shows — and no new one is offered', async (t) => {
  for (const [watches, shown] of [[[WATCH], true], [[], false]]) {
    const { dom } = app(t);
    dom.set('api', async () => ({ watches, limit: 50 }));
    const anchor = dom.document.createElement('div');
    dom.app.appendChild(anchor);
    await dom.call('renderPriceWatchControl', anchor, { title: 'Arche Nova', source: { externalId: '342942' } }, null);
    assert.equal(!!dom.app.querySelector('.gd-watch__state'), shown);
    assert.equal(dom.app.querySelector('.gd-watch__form'), null, 'no form to set a watch without a price');
    if (shown) {
      dom.app.querySelector('#gdWatchEdit').click();
      assert.equal(dom.app.querySelector('#gdWatchAt').value, '40', 'editing starts from the watch\'s own threshold');
    }
  }
});
