'use strict';

/* The game detail header carries the Spielwirbel-Score and nothing else (#919).
 *
 * #893 kept the raw mean on this one screen as the honest counterpart to the
 * score — the answer to „warum steht da 2,2 wenn alle 4 gegeben haben". The
 * score has since become the number the app ranks on everywhere (Regal,
 * results, Pokale, recommendations, the public Discover podium since #918),
 * and the plain average is read nowhere else, so the line was spending the
 * page's most valuable real estate on a number nobody acts on. It went, and
 * with it the `scoreReason()` line and the ⓘ sheet's paragraph promising the
 * average is still printed further down.
 *
 * BOTH branches of the old line are gone, which is wider than the raw mean:
 * a game with plays and no ratings used to render „Noch nicht bewertet · 3×
 * gespielt" here (#894). The Regal row still carries that evidence, and the
 * ⓘ sheet still explains the play lift as a principle.
 *
 * These assertions are over a REMOVAL, so the test-first red is available in
 * its inverted form: written against the pre-#919 code the first three tests
 * fail, because the lines they forbid are still on the page
 * (`.claude/rules/break-the-code-on-purpose.md`). Measured before the change —
 * three named failures; after it, green.
 *
 * The results screen deliberately KEEPS its `.score-why` line, which is why
 * `scoreReason()` stays in game-stats.js — `test/score-results-view.test.js` guards
 * that end and must stay green unchanged.
 *
 * #1039 moved the number again: the 88px ring and its „Spielwirbel-Score"
 * caption are gone, and the score is a pill on the cover's top-right corner —
 * exactly where every Regal card already puts it — with the ⓘ beside it. The
 * removals above all still hold, and are now asserted over the card as a whole:
 * a caption that came back would be on the page again whether or not anything
 * called it `.score-label`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { loadApp } = require('./support/dom');
const { SUPPORTED_LOCALES } = require('../public/js/locales');

const RID = 'r1';

/* The lang files are plain browser scripts registering into a global I18N, so
   they load in a tiny vm sandbox — the same seam test/i18n-parity.test.js uses.
   Reading the PARSED dictionary rather than the file text matters here: the
   header comment above names the removed keys, and a text scan would find them
   in this very file's own documentation
   (`.claude/rules/source-scanning-guards-enumerate-shapes.md`). */
function loadLocale(name) {
  const file = path.join(__dirname, '..', 'public', 'js', 'lang', `${name}.js`);
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.I18N[name];
}

function roundFixture() {
  return {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    providers: [],
    members: [
      { id: 'm1', name: 'Anna' },
      { id: 'm2', name: 'Ben' },
      { id: 'm3', name: 'Cleo' },
    ],
    games: [
      // Rated, and rated unevenly enough that the score diverges from the mean:
      // Cleo's 1 is a veto, so `scoreReason()` has something to say and the
      // `.score-why` line WOULD render if it had not been removed. A fixture
      // without a veto would pass this spec against the unchanged code.
      { id: 'g1', title: 'Catan', image: '/uploads/catan.jpg', tagIds: [] },
      // Played twice, never rated. Since #894 this still carries a score (the
      // play lift), so it renders a ring — and used to render the evidence
      // line under it.
      { id: 'g2', title: 'Azul', image: '/uploads/azul.jpg', tagIds: [] },
    ],
    sessions: [
      {
        id: 's1', createdAt: '2026-06-01T19:00:00.000Z', finished: true,
        gameIds: ['g1'], chosenGameId: 'g1', winnerIds: ['m1'],
        votes: {
          m1: { g1: { rating: 4 } },
          m2: { g1: { rating: 4 } },
          m3: { g1: { rating: 1 } },
        },
      },
      {
        id: 's2', createdAt: '2026-06-08T19:00:00.000Z', finished: true,
        gameIds: ['g2'], chosenGameId: 'g2', winnerIds: ['m1'], votes: {},
      },
      {
        id: 's3', createdAt: '2026-06-15T19:00:00.000Z', finished: true,
        gameIds: ['g2'], chosenGameId: 'g2', winnerIds: ['m2'], votes: {},
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

/** The score badge on the cover (#1039) — the pill and its ⓘ. */
const scoreBadge = (dom) => dom.app.querySelector('.gd-head .gd-cover .gd-score');
/** The whole game card, which is what the removals below are asserted over. */
const card = (dom) => dom.app.querySelector('.gd-head');

test('a rated game shows the score as a pill on the cover, with its ⓘ and nothing else', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const badge = scoreBadge(dom);
  assert.ok(badge, 'the score badge renders on the cover');

  const pill = badge.querySelector('.score-pill--lg');
  assert.ok(pill, 'the score is the cover pill');
  // The value, so this cannot pass against an empty pill. g1's veto pulls the
  // score below its 3,0 mean, which is also what gives `scoreReason()` below
  // something to say.
  assert.match(pill.textContent.trim(), /^\d,\d$/, `the pill reads „${pill.textContent.trim()}"`);
  // The visible caption went with the ring, so the pill carries its subject in
  // the accessible name instead — and the name CONTAINS the visible text.
  assert.match(pill.getAttribute('aria-label'), /Spielwirbel-Score/);
  assert.ok(pill.getAttribute('aria-label').includes(pill.textContent.trim()));
  assert.ok(badge.querySelector('.score-info'), 'the ⓘ button survived');

  // The ring and its column are gone outright, not merely restyled.
  assert.equal(card(dom).querySelector('.gd-ring'), null, 'the score ring is still on the page');
  assert.equal(card(dom).querySelector('.gd-stats'), null, 'the stats column is still on the page');
  assert.equal(card(dom).querySelector('.score-label'), null, 'the caption came back');

  // The #919 removals, now asserted over the whole card rather than one block:
  // a line that returned would be on the page whatever it was called.
  assert.doesNotMatch(card(dom).textContent, /Ø/, 'no raw average');
  assert.doesNotMatch(card(dom).textContent, /Bewertung/, 'no ratings count');
  assert.doesNotMatch(card(dom).textContent, /Session/, 'no session count');
});

test('the reason line is gone from the detail card even when the score diverges', async (t_) => {
  const { dom, round } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  // Anti-vacuous: prove the fixture really does produce a reason, so the
  // assertions below test a REMOVED line rather than an empty one.
  dom.set('__round', round);
  assert.ok(dom.run('scoreReason(gameStats(__round, "g1"))'), 'the fixture produces a reason line');
  assert.equal(card(dom).querySelector('.score-why'), null, 'no .score-why on the detail card');
  assert.doesNotMatch(card(dom).textContent, /gar nicht/, 'and its text is not rendered elsewhere');
});

test('a played-but-unrated game shows no evidence line either', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g2');
  const badge = scoreBadge(dom);
  assert.ok(badge, 'the score badge renders');
  // Since #894 a played-but-unrated game still HAS a score (the play lift), so
  // it gets a real pill rather than the „neu" variant — which is what makes the
  // absence below about the evidence line and not about an empty page.
  assert.ok(badge.querySelector('.score-pill--lg'), 'it still carries a number');
  assert.equal(badge.querySelector('.score-pill--none'), null, 'and it is not the unscored variant');
  assert.equal(card(dom).querySelector('.score-label'), null, 'no caption');
  assert.doesNotMatch(card(dom).textContent, /gespielt/, 'no „×gespielt" evidence line');
});

test('the ⓘ sheet no longer promises the raw average is printed on the page', async (t_) => {
  const { dom } = bootApp(t_);
  const body = dom.get('INFO_SHEETS').score.body;
  assert.ok(!body.includes('score.infoRaw'), 'score.infoRaw is not in the sheet');
  // Anti-vacuous: the sheet must still say the other things, so an empty body
  // cannot satisfy the assertion above.
  assert.ok(body.length >= 3, 'the principle, the ramp and the play lift remain');
  const dict = loadLocale('de');
  for (const key of body) assert.ok(dict[key], `${key} still resolves`);
});

test('the removed keys are gone from every shipped locale', () => {
  const gone = [
    'detail.ratingsLine', 'detail.ratingsLineOne', 'score.infoRaw',
    // #1039's three: the empty-ring caption (the unscored state now takes the
    // Regal's own „neu" pill), and the two strings of the `.gd-expansions`
    // section the chip replaced.
    'detail.noRating', 'detail.expansionsEmpty', 'detail.expansionAdd',
  ];
  for (const name of SUPPORTED_LOCALES) {
    const dict = loadLocale(name);
    // Anti-vacuous floor: a typo'd path or an empty dictionary would satisfy
    // the absence check below for the wrong reason.
    assert.ok(Object.keys(dict).length > 100, `${name} loaded`);
    for (const key of gone) {
      assert.equal(dict[key], undefined, `${key} still present in ${name}.js`);
    }
  }
});
