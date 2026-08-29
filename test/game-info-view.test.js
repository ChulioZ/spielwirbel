'use strict';

/* The provider-info surfaces (#717/#724), rendered for real in jsdom
 * (.claude/rules/testing-views-under-jsdom.md): the game-detail section with
 * its detail-open backfill request, the info sheet, and the ⓘ affordance on
 * the vote-link card. The hot-seat wizard's card shares gameInfoButton with
 * the vote-link card, so the affordance's gating is proven once through the
 * card that is directly callable.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, translator } = require('./support/dom');

const RID = 'r1';
const t = translator('de');

// Long enough to clamp (over the 280-char display threshold).
const LONG_DESC = 'Ein Aufbauspiel über Handel und Städtebau. '.repeat(10).trim();

function roundFixture() {
  return {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    providers: [],
    members: [{ id: 'm1', name: 'Anna' }],
    games: [
      {
        id: 'g1', title: 'Catan', image: '/uploads/catan.jpg', minPlayers: 3, maxPlayers: 4,
        tagIds: [], weight: 2.2809, description: LONG_DESC,
        // The COMPLETE #724 set, so wantsGameInfo() is satisfied and this
        // fixture keeps proving "nothing missing -> no backfill request".
        minPlaytime: 60, maxPlaytime: 120, minAge: 10,
        categories: ['Civilization', 'Economic'],
        mechanics: ['Dice Rolling', 'Hand Management', 'Trading', 'Network Building', 'Income', 'Set Collection'],
        rating: 7.09054,
        source: { provider: 'bgg', externalId: '13', url: 'https://boardgamegeek.com/boardgame/13' },
        providerInfoAt: '2026-08-09T10:00:00.000Z',
      },
      // A storefront game: no provider metadata at all — the section and the
      // backfill request must both stay away.
      {
        id: 'g2', title: 'It Takes Two', image: '/uploads/itt.jpg', minPlayers: 1, maxPlayers: 2,
        tagIds: [], source: { provider: 'psstore', externalId: 'EP0006', url: null },
      },
      // BGG-linked, fields missing — the detail-open backfill case.
      {
        id: 'g3', title: 'Alt-Import', image: '/uploads/alt.jpg', minPlayers: 2, maxPlayers: 4,
        tagIds: [], source: { provider: 'bgg', externalId: '99', url: null },
      },
    ],
    sessions: [],
  };
}

function bootApp(t_, { providerInfo } = {}) {
  const dom = loadApp();
  t_.after(() => dom.close());
  const round = roundFixture();
  const infoCalls = [];
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/\/provider-info$/.test(url)) {
      infoCalls.push(url);
      return providerInfo || { weight: null };
    }
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    return {};
  });
  dom.set('toast', () => {});
  return { dom, round, infoCalls };
}

const aboutSection = (dom) => dom.app.querySelector(':scope > .gd-about');

// #729: a row stored before the field was dropped still HOLDS the text (no
// purge, no migration code — CLAUDE.md), so the guarantee is that nothing
// renders it. The fixture's g1 carries LONG_DESC, which is what keeps this from
// passing vacuously against a game that simply had no description.
test('a stored description renders nowhere — not in the detail section, not in the sheet', async (t_) => {
  const { dom, round } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');

  const sec = aboutSection(dom);
  assert.ok(sec, 'the section still renders — weight and the #724 facts remain');
  assert.equal(sec.querySelector('.game-info__desc'), null, 'the detail section still renders the description');
  assert.doesNotMatch(sec.textContent, /Aufbauspiel/, 'the description text leaked into the section');
  assert.equal(sec.querySelector('.game-info__more'), null, 'the show-more toggle survived');

  const btn = dom.call('gameInfoButton', round.games[0]);
  assert.ok(btn, 'the ⓘ affordance still renders for a game with weight');
  dom.document.body.appendChild(btn);
  btn.click();
  const sheet = dom.document.querySelector('.sheet-backdrop .sheet');
  assert.ok(sheet);
  assert.equal(sheet.querySelector('.game-info__desc'), null, 'the vote sheet still renders the description');
  assert.doesNotMatch(sheet.textContent, /Aufbauspiel/, 'the description text leaked into the sheet');
});

test('the detail section renders weight and the BGG attribution', async (t_) => {
  const { dom, infoCalls } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const sec = aboutSection(dom);
  assert.ok(sec, 'the gd-about section renders when the game carries the data');
  assert.equal(sec.querySelector('h2').textContent, t('gameInfo.title'));
  // One decimal — never BGG's four (2.2809 would imply a precision the number
  // does not have).
  assert.match(sec.querySelector('.game-info__weight').textContent, /2,3 von 5/);
  assert.equal(sec.querySelectorAll('.weight-dots__dot').length, 5);
  assert.equal(sec.querySelectorAll('.weight-dots__dot.is-filled').length, 2);
  assert.match(sec.querySelector('.game-info__source').textContent, /BoardGameGeek/);
  // Every field present -> no backfill request.
  assert.equal(infoCalls.length, 0);
});

test('a storefront game gets no section and fires no backfill request', async (t_) => {
  const { dom, infoCalls } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g2');
  assert.equal(aboutSection(dom), null);
  assert.equal(infoCalls.length, 0);
});

test('a BGG-linked game missing the fields asks the server and renders the answer', async (t_) => {
  const { dom, infoCalls } = bootApp(t_, {
    providerInfo: { weight: 3.5 },
  });
  await dom.call('showGameDetail', RID, 'g3');
  // The request went out; the response settles on a later microtask.
  assert.equal(infoCalls.length, 1);
  assert.match(infoCalls[0], /\/games\/g3\/provider-info$/);
  await new Promise((r) => setTimeout(r, 0));
  const sec = aboutSection(dom);
  assert.ok(sec, 'the section appears once the backfill answers');
  assert.match(sec.querySelector('.game-info__weight').textContent, /3,5 von 5/);
});

test('a backfill that finds nothing leaves the page without the section', async (t_) => {
  const { dom, infoCalls } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g3');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(infoCalls.length, 1);
  assert.equal(aboutSection(dom), null);
});

test('gameInfoButton renders only when there is something to show, and opens the sheet', async (t_) => {
  const { dom } = bootApp(t_);
  assert.equal(dom.call('gameInfoButton', { id: 'x', title: 'Leer' }), null);

  const btn = dom.call('gameInfoButton', { id: 'g', title: 'Catan', weight: 2.3 });
  assert.ok(btn, 'a game with info gets the affordance');
  assert.match(btn.getAttribute('aria-label'), /Catan/);
  dom.document.body.appendChild(btn);
  btn.click();
  const sheet = dom.document.querySelector('.sheet-backdrop .sheet');
  assert.ok(sheet, 'the info sheet opened');
  assert.equal(sheet.querySelector('.sheet__head h2').textContent, 'Catan');
  assert.match(sheet.querySelector('.game-info__source').textContent, /BoardGameGeek/);
});

// A game carrying every #724 field, for the two surfaces that must disagree
// about exactly one of them.
const RICH = {
  id: 'g', title: 'Catan', weight: 2.2809,
  minPlaytime: 60, maxPlaytime: 120, minAge: 10,
  categories: ['Civilization', 'Economic'],
  mechanics: ['Dice Rolling', 'Hand Management', 'Trading', 'Network Building', 'Income', 'Set Collection'],
  rating: 7.09054,
};

const factOf = (root, label) => [...root.querySelectorAll('.game-info__fact')]
  .find((f) => f.querySelector('.game-info__fact-label').textContent === label);

test('the detail section renders the standard metadata AND the BGG rating', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const sec = aboutSection(dom);
  // The playtime SPREAD is the information — a range where the bounds differ.
  assert.equal(factOf(sec, t('gameInfo.playtime')).querySelector('.game-info__fact-value').textContent, '60–120 Min.');
  assert.equal(factOf(sec, t('gameInfo.minAge')).querySelector('.game-info__fact-value').textContent, 'ab 10');
  assert.equal(factOf(sec, t('gameInfo.categories')).querySelector('.game-info__fact-value').textContent, 'Civilization, Economic');
  // Uncapped here: the detail screen shows all six mechanics, unlike the sheet.
  assert.equal(factOf(sec, t('gameInfo.mechanics')).querySelector('.game-info__fact-value').textContent,
    'Dice Rolling, Hand Management, Trading, Network Building, Income, Set Collection');
  // One decimal, like the weight — never BGG's five.
  assert.equal(factOf(sec, t('gameInfo.rating')).querySelector('.game-info__fact-value').textContent, '7,1 von 10');
});

test('the vote sheet shows the same metadata but NEVER the rating', async (t_) => {
  /* The client half of #724's rating rule (the enforceable half is the ballot
   * projection in lib/routes/vote-link.js). gameInfoBody defaults `rating` to
   * OFF, so this asserts the DEFAULT rather than a flag the caller passes —
   * flipping that default to true reddens this by name, which a spec that
   * passed `{ rating: false }` itself could never see
   * (.claude/rules/break-the-code-on-purpose.md). */
  const { dom } = bootApp(t_);
  const btn = dom.call('gameInfoButton', RICH);
  dom.document.body.appendChild(btn);
  btn.click();
  const sheet = dom.document.querySelector('.sheet-backdrop .sheet');
  assert.ok(factOf(sheet, t('gameInfo.playtime')), 'the sheet lost the metadata it should carry');
  assert.equal(factOf(sheet, t('gameInfo.minAge')).querySelector('.game-info__fact-value').textContent, 'ab 10');
  // Capped at five, with the remainder summarised rather than silently dropped.
  assert.equal(factOf(sheet, t('gameInfo.mechanics')).querySelector('.game-info__fact-value').textContent,
    'Dice Rolling, Hand Management, Trading, Network Building, Income, +1 weitere');

  assert.equal(factOf(sheet, t('gameInfo.rating')), undefined, 'the rating reached a voting surface');
  assert.doesNotMatch(sheet.textContent, /7[.,]1/, 'the rating leaked in some other row');
});

test('a game whose only provider fact is a rating gets no ⓘ, but does get a detail section', async (t_) => {
  /* The two gates have to disagree here, and both directions are a real bug:
   * an ⓘ opening an empty sheet, or a detail screen hiding a section that has
   * something to say. */
  const { dom } = bootApp(t_);
  const ratingOnly = { id: 'g', title: 'Nur Wertung', rating: 8.1 };
  assert.equal(dom.call('gameInfoButton', ratingOnly), null);
  const sec = dom.call('renderGameInfoSection', ratingOnly);
  assert.ok(factOf(sec, t('gameInfo.rating')), 'the detail section dropped the one fact it had');
});

test('one known playtime bound reads as a single number, not a half-open range', async (t_) => {
  const { dom } = bootApp(t_);
  const value = (game) => factOf(dom.call('renderGameInfoSection', game), t('gameInfo.playtime'))
    .querySelector('.game-info__fact-value').textContent;
  assert.equal(value({ id: 'a', title: 'A', minPlaytime: 90, maxPlaytime: 90 }), '90 Min.',
    'equal bounds are one number, not "90–90"');
  assert.equal(value({ id: 'b', title: 'B', minPlaytime: 45, maxPlaytime: null }), '45 Min.');
  assert.equal(value({ id: 'c', title: 'C', minPlaytime: null, maxPlaytime: 30 }), '30 Min.');
  // The live case the data shape exists for (Toriki: 20–600).
  assert.equal(value({ id: 'd', title: 'D', minPlaytime: 20, maxPlaytime: 600 }), '20–600 Min.');
});

test('the hot-seat card self-heals: a field-less BGG game asks the server and gains the ⓘ', async (t_) => {
  /* The production report on #717: a session drawn before the fields existed
   * (or before the fire-and-forget backfill landed) hands the wizard games
   * without them, so voting showed no ⓘ while the detail page — which has its
   * own lazy trigger — did. The card now uses the same trigger. */
  const { dom, infoCalls } = bootApp(t_, {
    providerInfo: { weight: 3.0 },
  });
  const round = roundFixture();
  const session = { id: 's1', gameIds: ['g3'], memberIds: ['m1'], votes: {} };
  const games = [round.games.find((g) => g.id === 'g3')]; // BGG source, no fields
  const people = [{ id: 'm1', name: 'Anna', guest: false }];
  dom.call('startVoting', round, session, games, people,
    { skipIntro: true, saveVotes: async () => {}, onSaved: () => {} });

  assert.ok(dom.app.querySelector('.vote__title'), 'the card rendered');
  assert.equal(dom.app.querySelector('.vote__title .vote__info'), null, 'no ⓘ before the answer');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(infoCalls.length, 1, 'the card asked the provider-info endpoint once');
  assert.ok(dom.app.querySelector('.vote__title .vote__info'), 'the ⓘ appears when the answer lands');

  // A rating tap rebuilds the card; the mutated game object keeps the ⓘ
  // WITHOUT a second request.
  dom.app.querySelectorAll('.rating .mood')[2].click();
  assert.ok(dom.app.querySelector('.vote__title .vote__info'), 'the rebuilt card still has the ⓘ');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(infoCalls.length, 1, 'no re-fetch on re-render');
});

test('a storefront game in the wizard asks nothing', async (t_) => {
  const { dom, infoCalls } = bootApp(t_);
  const round = roundFixture();
  const session = { id: 's1', gameIds: ['g2'], memberIds: ['m1'], votes: {} };
  const games = [round.games.find((g) => g.id === 'g2')];
  dom.call('startVoting', round, session, games, [{ id: 'm1', name: 'Anna', guest: false }],
    { skipIntro: true, saveVotes: async () => {}, onSaved: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(infoCalls.length, 0);
  assert.equal(dom.app.querySelector('.vote__title .vote__info'), null);
});

test('the vote-link card shows the ⓘ only for a game carrying info', async (t_) => {
  const { dom } = bootApp(t_);
  const person = { id: 'm1', name: 'Anna', guest: false, color: null };
  const ballot = {
    roundName: 'Freitagsrunde',
    people: [person],
    games: [
      { id: 'g1', title: 'Catan', image: null, weight: 2.3 },
      { id: 'g2', title: 'Ohne', image: null, weight: null },
    ],
  };
  dom.call('renderVoteLinkCards', 'tok', ballot, person);
  assert.ok(dom.app.querySelector('.vote__title .vote__info'), 'game with info gets the ⓘ in the title line');

  // Advance to the second card: no info -> no affordance.
  const first = dom.app.querySelector('.vote__title').textContent;
  assert.match(first, /Catan/);
  // Select a rating so „Weiter" passes its guard, then advance.
  dom.app.querySelectorAll('.rating .mood')[3].click();
  dom.app.querySelector('#nextBtn').click();
  assert.match(dom.app.querySelector('.vote__title').textContent, /Ohne/);
  assert.equal(dom.app.querySelector('.vote__title .vote__info'), null);
});
