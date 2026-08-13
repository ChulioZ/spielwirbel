'use strict';

/* The edition line under a game's cover (#742): which printing the round picked
 * its box art from („Ausgabe: Deutsche Erstausgabe · 2019").
 *
 * Rendered through the jsdom harness rather than asserted as a regex over the
 * view's source, because the interesting half is STRUCTURAL: the wrapper that
 * carries the line is added only when there is one, so a game without an edition
 * must render the cover as a direct child of `.gd-head` exactly as it always did.
 * A text assertion cannot see that (.claude/rules/testing-views-under-jsdom.md).
 *
 * Selectors are scoped to `.gd-head` because the desktop rail inside `dom.app`
 * carries its own headings and its own `.gd-title`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, translator } = require('./support/dom');
const { editionLabel } = require('../public/js/bgg-covers');

const RID = 'r1';

function roundFixture() {
  return {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    providers: [],
    members: [{ id: 'm1', name: 'Anna' }],
    games: [
      // A full edition: name, year and language.
      {
        id: 'g1', title: 'Ark Nova', image: 'https://cf.geekdo-images.com/ark.jpg',
        minPlayers: 1, maxPlayers: 4, tagIds: [],
        source: { provider: 'bgg', externalId: '342942', url: null },
        edition: { name: 'Deutsche Erstausgabe', year: 2021, languages: ['German'] },
      },
      // No edition at all — every game whose cover predates #742.
      {
        id: 'g2', title: 'Catan', image: 'https://cf.geekdo-images.com/catan.jpg',
        minPlayers: 3, maxPlayers: 4, tagIds: [],
        source: { provider: 'bgg', externalId: '13', url: null },
      },
      // Languages only: it prices correctly but has NOTHING to say on screen.
      {
        id: 'g3', title: 'Azul', image: 'https://cf.geekdo-images.com/azul.jpg',
        minPlayers: 2, maxPlayers: 4, tagIds: [],
        source: { provider: 'bgg', externalId: '230802', url: null },
        edition: { name: '', year: null, languages: ['German'] },
      },
      // The name alone — BGG's `yearpublished value="0"` is its "unknown".
      {
        id: 'g4', title: 'Karak', image: 'https://cf.geekdo-images.com/karak.jpg',
        minPlayers: 2, maxPlayers: 5, tagIds: [],
        source: { provider: 'bgg', externalId: '241477', url: null },
        edition: { name: 'English first edition', year: null, languages: ['English'] },
      },
    ],
    sessions: [],
  };
}

function bootApp(t_, locale) {
  const dom = loadApp(locale ? { locale } : undefined);
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

const editionLine = (dom) => dom.app.querySelector('.gd-head .gd-edition');

test('a game with a stored edition names its printing under the cover', async (t_) => {
  const { dom } = bootApp(t_, 'de');
  const t = translator('de');
  await dom.call('showGameDetail', RID, 'g1');
  const line = editionLine(dom);
  assert.ok(line, 'the edition line renders');
  assert.equal(line.textContent, t('detail.edition', { edition: 'Deutsche Erstausgabe · 2021' }));
  // Under the cover, not beside it: same column, cover first.
  const col = dom.app.querySelector('.gd-head .gd-cover');
  assert.ok(col, 'the cover gains its own column');
  assert.equal(col.children[0].classList.contains('gd-img'), true);
  assert.equal(col.children[1], line);
});

test('the line follows the UI language', async (t_) => {
  const { dom } = bootApp(t_, 'en');
  const t = translator('en');
  await dom.call('showGameDetail', RID, 'g1');
  assert.equal(editionLine(dom).textContent, t('detail.edition', { edition: 'Deutsche Erstausgabe · 2021' }));
  // The edition NAME is BGG's own data and stays unmodified — the XML API terms
  // forbid rewriting what is retrieved (.claude/rules/add-game-lookup-provider.md).
  assert.match(editionLine(dom).textContent, /Deutsche Erstausgabe/);
});

test('a game with NO edition renders the cover exactly as it always did', async (t_) => {
  const { dom } = bootApp(t_, 'de');
  await dom.call('showGameDetail', RID, 'g2');
  assert.equal(editionLine(dom), null, 'no line');
  assert.equal(dom.app.querySelector('.gd-head .gd-cover'), null, 'and no wrapper either');
  // The load-bearing half: the cover is still a DIRECT child of .gd-head, which
  // is what `.gd-head`'s flex layout was written against. A wrapper added
  // unconditionally would restructure the head band of every game in the app.
  const head = dom.app.querySelector('.gd-head');
  const img = head.querySelector('.gd-img');
  assert.ok(img, 'the cover renders');
  assert.equal(img.parentElement, head);
});

test('an edition with only a language renders nothing — it prices, it does not label', async (t_) => {
  const { dom } = bootApp(t_, 'de');
  await dom.call('showGameDetail', RID, 'g3');
  assert.equal(editionLine(dom), null);
  assert.equal(dom.app.querySelector('.gd-head .gd-cover'), null);
  // Derived from the same helper the view uses, so this stays true if the
  // "what counts as a label" rule ever moves.
  assert.equal(editionLabel({ name: '', year: null, languages: ['German'] }), '');
});

test('either half alone still renders, without a stray separator', async (t_) => {
  const { dom } = bootApp(t_, 'de');
  const t = translator('de');
  await dom.call('showGameDetail', RID, 'g4');
  assert.equal(editionLine(dom).textContent, t('detail.edition', { edition: 'English first edition' }));
  assert.doesNotMatch(editionLine(dom).textContent, /·/);
});
