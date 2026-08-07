'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

/*
 * The price box on a wished-for game's detail page (#679), rendered for real in
 * jsdom rather than matched out of the view's source
 * (.claude/rules/testing-views-under-jsdom.md).
 *
 * The three things asserted hardest here are legal requirements, not layout:
 * an offer whose shipping is unknown must never read as an inclusive total
 * (PAngV § 3/§ 6), the retrieval time must be on screen, and the source line
 * must say the comparison covers participating shops only (§ 5a UWG, BGH
 * I ZR 55/16). Each of them is a line that could be dropped in a tidy-up with
 * nothing else going wrong.
 */

const BGP = {
  available: true,
  source: 'boardgameprices',
  currency: 'EUR',
  amount: 49.89,
  product: 44.99,
  shipping: 4.9,
  shippingKnown: true,
  country: 'DE',
  destination: 'DE',
  offerCount: 8,
  inStockCount: 5,
  edition: { title: 'Arche Nova', lang: 'DE' },
  url: 'https://brettspielpreise.de/item/show/42840/arche-nova',
  fetchedAt: '2026-08-07T10:04:00.000Z',
};

const render = (dom, payload) => {
  const node = dom.call('renderPriceSection', payload);
  dom.document.body.appendChild(node);
  return node;
};

test('the board-game box leads with the total and says what it includes', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const sec = render(dom, BGP);

  assert.match(sec.querySelector('.gd-price__amount').textContent, /49,89/);
  const facts = sec.querySelector('.gd-price__facts').textContent;
  assert.match(facts, /inkl\. Versand/);
  assert.match(facts, /Händler in DE/);
  assert.match(facts, /Arche Nova \(DE\)/, 'which edition is priced must be stated');
  assert.match(facts, /5 von 8/);

  const link = sec.querySelector('a.link-out');
  assert.equal(link.getAttribute('href'), BGP.url);
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
});

test('an unknown-shipping offer is labelled "zzgl. Versand", never as a total', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const sec = render(dom, { ...BGP, amount: 35.99, shipping: null, shippingKnown: false, country: 'GR' });
  const facts = sec.querySelector('.gd-price__facts').textContent;
  assert.match(facts, /zzgl\. Versand/);
  assert.doesNotMatch(facts, /inkl\. Versand/);
});

test('the retrieval time and the may-have-changed note are on screen', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const note = render(dom, BGP).querySelector('.gd-price__note').textContent;
  // The formatted date, not the ISO string — whatever the reader's locale spells.
  assert.match(note, /2026/);
  assert.match(note, /Preise können sich geändert haben\./);
});

test('the source line names the aggregator AND that the listing is not the whole market', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const note = render(dom, BGP).querySelector('.gd-price__note').textContent;
  assert.match(note, /Brettspielpreise\.de/);
  // The § 5a UWG half: a comparison must disclose that shops pay to be listed.
  assert.match(note, /nur die dort gelisteten Shops/);
});

test('a Steam price shows the discount it was struck from', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const sec = render(dom, {
    available: true, source: 'steam', currency: 'EUR', amount: 29.99, regular: 59.99,
    discountPercent: 50, shippingKnown: true,
    url: 'https://store.steampowered.com/app/77/', fetchedAt: '2026-08-07T10:04:00.000Z',
  });
  assert.match(sec.querySelector('.gd-price__amount').textContent, /29,99/);
  const facts = sec.querySelector('.gd-price__facts').textContent;
  assert.match(facts, /59,99/);
  assert.match(facts, /50/);
  // No edition, no country, no offer count — a digital store has none of them,
  // and an empty "Ausgabe: ()" is worse than no line.
  assert.doesNotMatch(facts, /Ausgabe|Händler|Angeboten/);
  assert.match(sec.querySelector('.gd-price__note').textContent, /Steam Store/);
});

test('the currency comes from the price, not from the reader', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // A German reader looking at a British shop must see pounds, not a number
  // silently relabelled as euros.
  const sec = render(dom, { ...BGP, currency: 'GBP', amount: 42.5, destination: 'GB', country: 'GB' });
  assert.match(sec.querySelector('.gd-price__amount').textContent, /£/);
});

test('an unusable currency degrades to the bare number instead of taking the screen down', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // Intl.NumberFormat throws a RangeError on an unknown code; a price label must
  // not be able to kill the detail page.
  const sec = render(dom, { ...BGP, currency: 'NOPE' });
  assert.equal(sec.querySelector('.gd-price__amount').textContent, '49.89');
});

test('the section is fetched for a wished game with a link — and for nothing else', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());

  const asked = [];
  const round = {
    id: 'r1', name: 'Freitagsrunde', members: [], sessions: [], tags: [],
    games: [
      { id: 'g1', title: 'Arche Nova', wish: true, source: { provider: 'bgg', externalId: '342942', url: 'https://boardgamegeek.com/boardgame/342942' } },
      { id: 'g2', title: 'Selbst getippt', wish: true },
      { id: 'g3', title: 'Im Regal', source: { provider: 'bgg', externalId: '13' } },
    ],
  };
  dom.set('api', async (method, path) => {
    if (path.includes('/prices')) { asked.push(path); return BGP; }
    return round;
  });

  await dom.call('showGameDetail', 'r1', 'g1');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked.length, 1);
  assert.match(asked[0], /^\/api\/rounds\/r1\/games\/g1\/prices\?lang=de$/);
  assert.ok(dom.app.querySelector('.gd-price'), 'the wished, linked game shows a price');

  // A hand-typed wish has no id to ask about, and a title search would quote a
  // price for the wrong edition.
  asked.length = 0;
  await dom.call('showGameDetail', 'r1', 'g2');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(asked, []);
  assert.equal(dom.app.querySelector('.gd-price'), null);

  // The round already owns everything on the shelf.
  await dom.call('showGameDetail', 'r1', 'g3');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(asked, []);
  assert.equal(dom.app.querySelector('.gd-price'), null);
});

test('a disabled or unreachable price service leaves the page exactly as it was', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = {
    id: 'r1', name: 'Freitagsrunde', members: [], sessions: [], tags: [],
    games: [{ id: 'g1', title: 'Arche Nova', wish: true, source: { provider: 'bgg', externalId: '342942' } }],
  };

  // What PRICES_ENABLED=off looks like from here: the route 404s, so api() throws.
  dom.set('api', async (method, path) => {
    if (path.includes('/prices')) throw new Error('prices_disabled');
    return round;
  });
  await dom.call('showGameDetail', 'r1', 'g1');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(dom.app.querySelector('.gd-price'), null);
  // And no orphan placeholder is left behind where the section would have gone.
  assert.equal(dom.app.querySelector('.gd-price__amount'), null);
  assert.ok(dom.app.querySelector('h1'), 'the rest of the detail page still rendered');

  // `{ available: false }` — reachable, nothing to show — is the same outcome.
  dom.set('api', async (method, path) => (path.includes('/prices') ? { available: false } : round));
  await dom.call('showGameDetail', 'r1', 'g1');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(dom.app.querySelector('.gd-price'), null);
});
