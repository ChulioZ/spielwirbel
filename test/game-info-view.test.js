'use strict';

/* The weight/description surfaces (#717), rendered for real in jsdom
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
        source: { provider: 'bgg', externalId: '13', url: 'https://boardgamegeek.com/boardgame/13' },
        providerInfoAt: '2026-08-09T10:00:00.000Z',
      },
      // A storefront game: no weight, no description — the section and the
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
      return providerInfo || { weight: null, description: null };
    }
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    return {};
  });
  dom.set('toast', () => {});
  return { dom, round, infoCalls };
}

const aboutSection = (dom) => dom.app.querySelector(':scope > .gd-about');

test('the detail section renders weight, clamped description and the BGG attribution', async (t_) => {
  const { dom, infoCalls } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const sec = aboutSection(dom);
  assert.ok(sec, 'the gd-about section renders when the game carries the data');
  assert.equal(sec.querySelector('h2').textContent, t('gameInfo.title'));
  // One decimal — never BGG's four (2.2809 would imply a precision the number
  // does not have).
  assert.match(sec.querySelector('.game-info__weight').textContent, /2\.3 von 5/);
  assert.equal(sec.querySelectorAll('.weight-dots__dot').length, 5);
  assert.equal(sec.querySelectorAll('.weight-dots__dot.is-filled').length, 2);
  const desc = sec.querySelector('.game-info__desc');
  assert.equal(desc.textContent, LONG_DESC, 'the stored text renders whole — the clamp is CSS-only');
  assert.ok(desc.classList.contains('is-clamped'));
  assert.match(sec.querySelector('.game-info__source').textContent, /BoardGameGeek/);
  // Both fields present -> no backfill request.
  assert.equal(infoCalls.length, 0);

  // The toggle expands and collapses, stating its state.
  const toggle = sec.querySelector('.game-info__more');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.click();
  assert.equal(desc.classList.contains('is-clamped'), false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.textContent, t('gameInfo.showLess'));
  toggle.click();
  assert.ok(desc.classList.contains('is-clamped'));
});

test('a storefront game gets no section and fires no backfill request', async (t_) => {
  const { dom, infoCalls } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g2');
  assert.equal(aboutSection(dom), null);
  assert.equal(infoCalls.length, 0);
});

test('a BGG-linked game missing the fields asks the server and renders the answer', async (t_) => {
  const { dom, infoCalls } = bootApp(t_, {
    providerInfo: { weight: 3.5, description: 'Nachgefüllt.' },
  });
  await dom.call('showGameDetail', RID, 'g3');
  // The request went out; the response settles on a later microtask.
  assert.equal(infoCalls.length, 1);
  assert.match(infoCalls[0], /\/games\/g3\/provider-info$/);
  await new Promise((r) => setTimeout(r, 0));
  const sec = aboutSection(dom);
  assert.ok(sec, 'the section appears once the backfill answers');
  assert.match(sec.querySelector('.game-info__weight').textContent, /3\.5 von 5/);
  assert.equal(sec.querySelector('.game-info__desc').textContent, 'Nachgefüllt.');
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

  const btn = dom.call('gameInfoButton', { id: 'g', title: 'Catan', weight: 2.3, description: 'Kurz.' });
  assert.ok(btn, 'a game with info gets the affordance');
  assert.match(btn.getAttribute('aria-label'), /Catan/);
  dom.document.body.appendChild(btn);
  btn.click();
  const sheet = dom.document.querySelector('.sheet-backdrop .sheet');
  assert.ok(sheet, 'the info sheet opened');
  assert.equal(sheet.querySelector('.sheet__head h2').textContent, 'Catan');
  // A short description clamps nothing and offers no toggle.
  assert.equal(sheet.querySelector('.game-info__desc').classList.contains('is-clamped'), false);
  assert.equal(sheet.querySelector('.game-info__more'), null);
  assert.match(sheet.querySelector('.game-info__source').textContent, /BoardGameGeek/);
});

test('a stored description with BGG\'s double-encoded HTML entities renders decoded', async (t_) => {
  /* BGG stores its descriptions HTML-encoded and XML-encodes them again when
   * serving, so after the provider's one XML decode the stored text still
   * carries literals like `&mdash;` — seen live on production (Ark Nova ends
   * "&mdash;description from the publisher", raw XML captured 2026-08-09).
   * Decoded at RENDER time so every already-stored row self-corrects with no
   * migration code. Literal '<' and clean text must survive untouched. */
  const { dom } = bootApp(t_);
  const stored = 'Ein Zoo &mdash; mit Stil.&#10;Neue Zeile &amp; mehr, 3 &lt; 5.';
  const btn = dom.call('gameInfoButton', { id: 'g', title: 'Ark Nova', weight: 3.7, description: stored });
  dom.document.body.appendChild(btn);
  btn.click();
  const desc = dom.document.querySelector('.sheet-backdrop .game-info__desc');
  assert.equal(desc.textContent, 'Ein Zoo — mit Stil.\nNeue Zeile & mehr, 3 < 5.');

  // Text with no entity-shaped content passes through byte-identically —
  // including a literal '<' and a bare '&'.
  const plain = dom.call('decodeGameDescription', 'Tigris & Euphrates: a < b, kein Tag <br/> bleibt Text');
  assert.equal(plain, 'Tigris & Euphrates: a < b, kein Tag <br/> bleibt Text');

  // Leading whitespace (blank first lines are real BGG data) survives the
  // decode path too.
  assert.equal(dom.call('decodeGameDescription', '\n\n&quot;Zitat&quot;'), '\n\n"Zitat"');
});

test('the vote-link card shows the ⓘ only for a game carrying info', async (t_) => {
  const { dom } = bootApp(t_);
  const person = { id: 'm1', name: 'Anna', guest: false, color: null };
  const ballot = {
    roundName: 'Freitagsrunde',
    people: [person],
    games: [
      { id: 'g1', title: 'Catan', image: null, weight: 2.3, description: 'Kurz.' },
      { id: 'g2', title: 'Ohne', image: null, weight: null, description: null },
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
