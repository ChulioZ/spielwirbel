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

/*
 * The stored last-known price (#688). The age stops being a footnote here, and
 * that is the legal half of the feature rather than presentation: a days-old
 * price shown with only a quiet „Abgerufen am …" line reads as a current one,
 * which is a § 5a UWG misleading omission.
 */
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const HOUR = 60 * 60 * 1000;

test('a stale price leads with its age, and says why it is old', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const sec = render(dom, { ...BGP, stale: true, fetchedAt: ago(3 * 24 * HOUR) });

  assert.equal(sec.querySelector('.gd-price__stale').textContent, 'Preis von vor 3 Tagen');
  assert.match(sec.querySelector('.gd-price__stale-why').textContent, /nicht erreichbar/);

  // Prominence is POSITION, not just wording: the age has to precede the
  // qualifying facts, or it is a footnote again in a different font.
  const order = [...sec.children].map((el) => el.className);
  assert.ok(
    order.indexOf('gd-price__stale') < order.indexOf('muted gd-price__facts'),
    `age must come before the facts, got ${JSON.stringify(order)}`
  );
  // The exact timestamp stays in the footnote — the headline summarises it.
  assert.match(sec.querySelector('.gd-price__note').textContent, /Abgerufen am/);
});

test('a FRESH price renders no age line at all', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // Same payload minus the flag: an hour-old cached price is not stale, and
  // shouting about its age would train the reader to ignore the line.
  const sec = render(dom, { ...BGP, fetchedAt: ago(HOUR) });
  assert.equal(sec.querySelector('.gd-price__stale'), null);
  assert.equal(sec.querySelector('.gd-price__stale-why'), null);
});

test('the age is phrased in hours under a day, and never rounds down to zero', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const age = (ms) => render(dom, { ...BGP, stale: true, fetchedAt: ago(ms) })
    .querySelector('.gd-price__stale').textContent;

  assert.equal(age(5 * HOUR), 'Preis von vor 5 Stunden');
  assert.equal(age(HOUR), 'Preis von vor 1 Stunde', 'singular, via the plural rules');
  // A price stored twenty minutes ago is genuinely fresh, but "vor 0 Stunden"
  // invites the reader to treat it as live — and the clock doing the arithmetic
  // is theirs. The label may overstate the age, never understate it.
  assert.equal(age(20 * 60 * 1000), 'Preis von vor 1 Stunde');
  // The unit changes at a day and the remainder is dropped downward, so 47 hours
  // reads as one day rather than two.
  assert.equal(age(47 * HOUR), 'Preis von vor 1 Tag');
  assert.equal(age(50 * HOUR), 'Preis von vor 2 Tagen');
});

test('the age follows the reader\'s language', (t) => {
  const dom = loadApp({ locale: 'en' });
  t.after(() => dom.close());
  const sec = render(dom, { ...BGP, stale: true, fetchedAt: ago(2 * 24 * HOUR) });
  assert.equal(sec.querySelector('.gd-price__stale').textContent, 'Price from 2 days ago');
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
  // Two legs since #707: the stored fast read and the full lookup, raced.
  assert.equal(asked.length, 2);
  assert.match(asked[0], /^\/api\/rounds\/r1\/games\/g1\/prices\?lang=de&stored=1$/);
  assert.match(asked[1], /^\/api\/rounds\/r1\/games\/g1\/prices\?lang=de$/);
  assert.ok(dom.app.querySelector('.gd-price'), 'the wished, linked game shows a price');
  assert.equal(dom.app.querySelectorAll('.gd-price').length, 1, 'one section, not one per leg');

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

/*
 * The stale-while-revalidate race (#707). Each spec wires the two price legs to
 * promises it settles by hand, so the orderings under test — stored first, live
 * first, live failing — are driven rather than hoped for.
 */
const WISH_ROUND = {
  id: 'r1', name: 'Freitagsrunde', members: [], sessions: [], tags: [],
  games: [{ id: 'g1', title: 'Arche Nova', wish: true, source: { provider: 'bgg', externalId: '342942' } }],
};
const tick = () => new Promise((r) => setTimeout(r, 0));

// Renders the wish detail page with both price legs pending; returns their
// resolve/reject handles.
async function openRaced(dom, round = WISH_ROUND) {
  const pending = {};
  dom.set('api', (method, path) => {
    if (path.includes('stored=1')) return new Promise((res, rej) => { pending.stored = { res, rej }; });
    if (path.includes('/prices')) return new Promise((res, rej) => { pending.live = { res, rej }; });
    return Promise.resolve(round);
  });
  await dom.call('showGameDetail', round.id, round.games[0].id);
  await tick();
  assert.ok(pending.stored && pending.live, 'both legs go out together');
  return pending;
}

test('the stored price renders immediately — checking note, not "unreachable" — and the live answer replaces it', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const pending = await openRaced(dom);

  pending.stored.res({ ...BGP, amount: 51.5, stale: true, fetchedAt: ago(2 * 24 * HOUR) });
  await tick();
  const interim = dom.app.querySelector('.gd-price');
  assert.ok(interim, 'the stored price is on screen before the live answer');
  assert.match(interim.querySelector('.gd-price__amount').textContent, /51,5/);
  assert.equal(interim.querySelector('.gd-price__stale').textContent, 'Preis von vor 2 Tagen',
    'the age-first labelling survives the transient render — the legal half');
  assert.match(interim.querySelector('.gd-price__checking').textContent, /wird gerade geprüft/);
  assert.equal(interim.querySelector('.gd-price__stale-why'), null,
    '"unreachable" would be a false claim while the check is still running');

  pending.live.res(BGP);
  await tick();
  const final = dom.app.querySelector('.gd-price');
  assert.match(final.querySelector('.gd-price__amount').textContent, /49,89/);
  assert.equal(final.querySelector('.gd-price__checking'), null);
  assert.equal(final.querySelector('.gd-price__stale'), null, 'the live answer is fresh');
  assert.equal(dom.app.querySelectorAll('.gd-price').length, 1, 'replaced, not stacked');
});

test('a settled no-offers answer is stated — replacing a stored price that was on screen', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const pending = await openRaced(dom);

  pending.stored.res({ ...BGP, stale: true, fetchedAt: ago(5 * HOUR) });
  await tick();
  assert.ok(dom.app.querySelector('.gd-price__amount'));

  pending.live.res({ available: false, reason: 'no_offers' });
  await tick();
  const sec = dom.app.querySelector('.gd-price');
  assert.ok(sec, 'stated, not blanked (operator decision on #707)');
  assert.match(sec.querySelector('.gd-price__none').textContent, /Zurzeit kein Preis verfügbar\./);
  assert.equal(sec.querySelector('.gd-price__amount'), null, 'the old price is gone — it would contradict fresh data');
  // The disclosure still rides with it: the statement derives from the aggregator.
  assert.match(sec.querySelector('.gd-price__note').textContent, /nur die dort gelisteten Shops/);
});

test('no-offers renders even when nothing was on screen first, with the source\'s own disclosure', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const steamRound = {
    ...WISH_ROUND,
    games: [{ id: 'g1', title: 'Grounded', wish: true, source: { provider: 'steam', externalId: '77' } }],
  };
  const pending = await openRaced(dom, steamRound);

  pending.live.res({ available: false, reason: 'no_offers' });
  await tick();
  const sec = dom.app.querySelector('.gd-price');
  assert.ok(sec);
  assert.match(sec.querySelector('.gd-price__none').textContent, /kein Preis/);
  assert.match(sec.querySelector('.gd-price__note').textContent, /Steam Store/);

  // The stored leg settling afterwards must not resurrect a price over the
  // settled answer.
  pending.stored.res({ ...BGP, stale: true, fetchedAt: ago(5 * HOUR) });
  await tick();
  assert.equal(dom.app.querySelector('.gd-price__amount'), null);
});

test('an unavailable live answer with no reason removes even a rendered stored price', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const pending = await openRaced(dom);

  pending.stored.res({ ...BGP, stale: true, fetchedAt: ago(5 * HOUR) });
  await tick();
  assert.ok(dom.app.querySelector('.gd-price'));

  // The server itself falls back to the stored row when the upstream fails, so a
  // plain unavailable means there is nothing honest left to show at all.
  pending.live.res({ available: false });
  await tick();
  assert.equal(dom.app.querySelector('.gd-price'), null);
});

test('the stored answer is skipped once the live one has settled — no stale flash on cache hits', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const pending = await openRaced(dom);

  pending.live.res(BGP);
  await tick();
  assert.match(dom.app.querySelector('.gd-price__amount').textContent, /49,89/);

  pending.stored.res({ ...BGP, amount: 99.99, stale: true, fetchedAt: ago(2 * 24 * HOUR) });
  await tick();
  const sec = dom.app.querySelector('.gd-price');
  assert.match(sec.querySelector('.gd-price__amount').textContent, /49,89/, 'the fresh render stays');
  assert.equal(sec.querySelector('.gd-price__checking'), null);
  assert.equal(dom.app.querySelectorAll('.gd-price').length, 1);
});

test('our own server failing mid-check keeps the stored price and drops the checking note', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const pending = await openRaced(dom);

  pending.stored.res({ ...BGP, stale: true, fetchedAt: ago(5 * HOUR) });
  await tick();
  assert.ok(dom.app.querySelector('.gd-price__checking'));

  pending.live.rej(new Error('network'));
  await tick();
  const sec = dom.app.querySelector('.gd-price');
  assert.ok(sec, 'the stored price survives our server going away');
  assert.equal(sec.querySelector('.gd-price__checking'), null, 'no eternal "checking…" claim');
  assert.ok(sec.querySelector('.gd-price__stale-why'), 'the honest stale explanation stands in');
});

test('with nothing rendered, a failing live leg still removes the anchor', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const pending = await openRaced(dom);

  pending.live.rej(new Error('network'));
  await tick();
  assert.equal(dom.app.querySelector('.gd-price'), null);
  // The stored leg resolving after the failure must not render into a dead slot.
  pending.stored.res({ ...BGP, stale: true, fetchedAt: ago(5 * HOUR) });
  await tick();
  assert.equal(dom.app.querySelector('.gd-price'), null);
});
