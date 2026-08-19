'use strict';

/* The recommendations screen (#682), run in jsdom.
 *
 * The scoring is covered in test/recommend.test.js and the payload in
 * test/recommendations.test.js. What only a rendered screen can see is the half
 * that decides whether the feature is legible at all: which of the four empty
 * states is chosen, and whether the reason lines — the entire argument for a
 * deterministic recommender over #264's — actually reach the card.
 *
 * The harness loads the frontend through `vm`, so the view stays out of the
 * coverage report; a `require()` would red `coverage:ci` with every test green
 * (.claude/rules/testing-views-under-jsdom.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const round = { id: 'r1', name: 'Freitagsrunde', games: [], sessions: [], members: [], background: null };

const rec = (over = {}) => ({
  externalId: '999',
  title: 'Ark Nova',
  year: 2021,
  rank: 12,
  rating: 8.4,
  weight: 3.7,
  minPlayers: 1,
  maxPlayers: 4,
  minPlaytime: 90,
  maxPlaytime: 150,
  score: 0.81,
  url: 'https://boardgamegeek.com/boardgame/999',
  reasons: [],
  ...over,
});

// Render the screen against a stubbed payload. `api` is the one function both
// the round read and the recommendations read go through, so one stub serves
// both — dispatched on the path, which also asserts the URL the view builds.
async function render(t, payload, { locale = 'de' } = {}) {
  const dom = loadApp({ locale });
  t.after(() => dom.close());
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (/\/recommendations$/.test(url)) return payload;
    return round;
  });
  dom.set('toast', () => {});
  await dom.call('showRecommendations', 'r1');
  return { dom, calls };
}

const full = (over = {}) => ({
  profileGames: 12,
  linkedGames: 12,
  minProfileGames: 8,
  corpusRows: 5000,
  parties: [{ players: 4, share: 1 }],
  recommendations: [],
  ...over,
});

test('a recommendation renders its title, its BGG facts and its reason lines', async (t) => {
  const { dom } = await render(t, full({
    recommendations: [rec({
      reasons: [
        { term: 'quality', rating: 8.4 },
        { term: 'mechanics', games: ['Wingspan', 'Terraforming Mars'] },
      ],
    })],
  }));

  const card = dom.app.querySelector('.rec-card');
  assert.ok(card, 'the card is rendered');
  assert.match(card.querySelector('.rec-card__title').textContent, /Ark Nova/);
  const why = [...card.querySelectorAll('.rec-card__why li')].map((li) => li.textContent);
  assert.equal(why.length, 2);
  assert.match(why[0], /8,4/, 'the rating is formatted for the reader\'s locale');
  // The whole argument for this recommender over #264's: it names the games it
  // reasoned from, so the list is checkable rather than merely confident.
  assert.match(why[1], /Wingspan/);
  assert.match(why[1], /Terraforming Mars/);
  // The link out is a real anchor at the row's own BGG page.
  assert.equal(card.querySelector('a.link-btn').getAttribute('href'), 'https://boardgamegeek.com/boardgame/999');
});

test('the BGG cover is painted on the frame, and a coverless row keeps the placeholder (#779)', async (t) => {
  const cover = 'https://cf.geekdo-images.com/abc__small/img/x=/fit-in/200x150/filters:strip_icc()/pic1.jpg';
  const { dom } = await render(t, full({
    recommendations: [
      rec({ externalId: '999', title: 'Ark Nova', image: cover }),
      rec({ externalId: '998', title: 'Toriki', image: null }),
    ],
  }));

  const [withCover, without] = [...dom.app.querySelectorAll('.rec-card__img')];
  // The frame paints it; geekdo signs its transform paths, so coverUrl() leaves
  // the URL untouched rather than appending a size query
  // (.claude/rules/provider-cover-sizing.md).
  assert.ok(withCover.style.backgroundImage.includes(cover), withCover.style.backgroundImage);
  // ...and the placeholder is GONE, not merely covered up — it paints its own
  // gradient layer, which would otherwise sit on top of the box art.
  assert.equal(withCover.querySelector('.cover-ph'), null);

  assert.equal(without.style.backgroundImage, '');
  assert.ok(without.querySelector('.cover-ph'), 'a coverless row still gets the deterministic placeholder');
});

test('the players reason reads as a sentence, with its own solo phrasing (#805)', async (t) => {
  const both = [{ term: 'players', players: 4 }, { term: 'players', players: 1 }];
  const lines = async (locale) => {
    const { dom } = await render(t, full({
      recommendations: both.map((r, i) => rec({ externalId: String(900 + i), reasons: [r] })),
    }), { locale });
    return [...dom.app.querySelectorAll('.rec-card__why li')].map((li) => li.textContent);
  };

  // The collective numeral is deliberately not used: „Zu 4. am besten" reads as
  // an ordinal and „zu viert" would need a hand-written table, so the line
  // reuses the app's own established „{n} Personen" phrasing.
  assert.deepEqual(await lines('de'), ['Am besten mit 4 Personen', 'Am besten solo']);
  // n = 1 goes through tn()'s one-category key rather than an `n === 1` branch,
  // which is what keeps „Am besten mit 1 Personen" off the card.
  assert.deepEqual(await lines('en'), ['Plays best with 4 players', 'Plays best solo']);
});

test('a reason the client has no phrase for renders NOTHING, never a raw key', async (t) => {
  const { dom } = await render(t, full({
    recommendations: [rec({ reasons: [{ term: 'from-a-newer-server' }, { term: 'quality', rating: 8.4 }] })],
  }));
  const why = [...dom.app.querySelectorAll('.rec-card__why li')].map((li) => li.textContent);
  assert.equal(why.length, 1, 'the unknown term is dropped, not half-rendered');
  assert.match(why[0], /8,4/);
  assert.doesNotMatch(dom.app.textContent, /from-a-newer-server|suggest\.reason/);
});

/* The four empty states ask the reader for OPPOSITE things, so each is asserted
   against the copy it must show. A single "nothing to show" would send someone
   off to re-import a collection they have already imported — which is why this
   is four cases rather than one. */
const EMPTIES = [
  { name: 'a thin shelf points at the BGG import', data: { profileGames: 2, linkedGames: 2 }, match: /BoardGameGeek/ },
  { name: 'a shelf the corpus does not know says so', data: { profileGames: 2, linkedGames: 12 }, match: /Spieledatenbank kennt euer Regal/ },
  { name: 'no corpus at all names the instance, not the shelf', data: { corpusRows: 0, profileGames: 0, linkedGames: 12 }, match: /keine Spieledatenbank/ },
  { name: 'nothing left to suggest is not an error', data: {}, match: /besitzt schon alles/ },
];

for (const c of EMPTIES) {
  test(`empty state: ${c.name}`, async (t) => {
    const { dom } = await render(t, full({ ...c.data, recommendations: [] }));
    assert.equal(dom.app.querySelectorAll('.rec-card').length, 0);
    assert.match(dom.app.querySelector('.empty').textContent, c.match);
  });
}

test('accepting a recommendation posts the ordinary wish-game write, source and all', async (t) => {
  const { dom, calls } = await render(t, full({ recommendations: [rec()] }));
  dom.app.querySelector('[data-act="wish"]').click();
  await new Promise((r) => setTimeout(r, 0));

  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'the click writes');
  assert.equal(post.url, '/api/rounds/r1/games');
  // A FormData built inside the vm realm — read it field by field rather than
  // comparing objects across realms (.claude/rules/testing-views-under-jsdom.md).
  assert.equal(post.body.get('title'), 'Ark Nova');
  assert.equal(post.body.get('wish'), 'true', 'a recommendation lands on the WUNSCHLISTE, never the shelf');
  assert.equal(post.body.get('sourceProvider'), 'bgg');
  assert.equal(post.body.get('sourceExternalId'), '999');
  assert.equal(post.body.get('minPlayers'), '1');
  assert.equal(post.body.get('maxPlayers'), '4');
});

/* The cover is the one field the card already HAS and the write used to drop
   (#789). It matters beyond this screen: the add is the only moment the URL is
   available, so a wish stored without it renders the placeholder in the wish
   list, on its detail page and in the Regal until somebody hand-picks a cover.

   Two renders rather than two clicks in one: a successful wish re-runs
   showRecommendations(), so the second card is rebuilt mid-assertion. */
const GEEKDO_COVER = 'https://cf.geekdo-images.com/abc__small/img/x=/fit-in/200x150/filters:strip_icc()/pic1.jpg';

test('the card cover travels with the wish (#789)', async (t) => {
  const { dom, calls } = await render(t, full({ recommendations: [rec({ image: GEEKDO_COVER })] }));
  dom.app.querySelector('[data-act="wish"]').click();
  await new Promise((r) => setTimeout(r, 0));

  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.body.get('imageUrl'), GEEKDO_COVER, 'the wish carries the box art the reader just clicked');
  // Sending a cover makes the route's EDITION branch reachable for the first
  // time on this path (`if (image) edition = buildEdition(...)`, lib/routes/games.js).
  // The corpus carries no printing, so no edition field is sent and
  // normalizeEdition answers null — a cover without a claimed printing, which is
  // what a recommendation actually knows. Picking one is the cover picker's job.
  assert.equal(post.body.get('editionName'), null);
  assert.equal(post.body.get('editionYear'), null);
});

test('a coverless recommendation sends NO imageUrl, rather than an empty one (#789)', async (t) => {
  const { dom, calls } = await render(t, full({ recommendations: [rec({ image: null })] }));
  dom.app.querySelector('[data-act="wish"]').click();
  await new Promise((r) => setTimeout(r, 0));

  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'a coverless recommendation still adds');
  // Absent, not ''. The route branches on the field's truthiness before it ever
  // reaches providerCoverUrl, so an empty string would be harmless today — but
  // it would also be a field the client states and means nothing by.
  assert.equal(post.body.get('imageUrl'), null);
  assert.equal(post.body.get('title'), 'Ark Nova');
});

test('the screen credits BoardGameGeek, which its licence requires wherever the data shows', async (t) => {
  const { dom } = await render(t, full({ recommendations: [rec()] }));
  assert.match(dom.app.querySelector('.rec-source').textContent, /BoardGameGeek/);
});

test('an inverted upstream range is rendered in order, not backwards', async (t) => {
  // BGG's two bounds are not guaranteed to be ordered. Rendering them verbatim
  // printed "80–60 Min." on the first browser pass, which reads as a bug in the
  // app rather than as odd upstream data.
  const { dom } = await render(t, full({
    recommendations: [rec({ minPlaytime: 80, maxPlaytime: 60, minPlayers: 6, maxPlayers: 2 })],
  }));
  const facts = dom.app.querySelector('.rec-card__facts').textContent;
  assert.match(facts, /60–80/);
  assert.match(facts, /2–6/);
  assert.doesNotMatch(facts, /80–60|6–2/);
});
