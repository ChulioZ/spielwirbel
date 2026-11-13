'use strict';

/*
 * Scoring categories (#1780), run as real screens:
 *  - with categories the points sheet is a grid (categories down, parties
 *    across), sums each column live, refuses a sum outside the bounds, flips
 *    the sign of the last-focused field, and PUTs totals plus `parts`;
 *  - a seat scored before the game had categories keeps its total untouched;
 *  - the game page's „…" offers „Wertungskategorien", whose editor reorders,
 *    removes, refuses a duplicate and PATCHes `[{ id?, name }]`;
 *  - the game page lists per-category records, the member page per-category
 *    bests in a disclosure.
 * The server half is test/score-categories-routes.test.js, the derivation
 * test/score-categories.test.js.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, waitFor } = require('./support/dom');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
dom.set('toast', () => {});
const realShowResults = dom.get('showResults');

const plain = (o) => JSON.parse(JSON.stringify(o));
let rid = 0;
const CATS = [{ id: 'ca', name: 'Vögel' }, { id: 'cb', name: 'Eier' }, { id: 'cx', name: 'Alt', removed: true }];
const finished = (id, createdAt, extra = {}) => ({
  id, createdAt, finishedAt: createdAt, chosenAt: createdAt, gameIds: ['g1'], memberIds: ['m1', 'm2'],
  votes: {}, done: true, finished: true, cancelled: false, winnerIds: [], chosenGameId: 'g1', ...extra,
});
const roundFixture = (sessions, game = {}) => ({
  id: `r${++rid}`, name: 'Freitagsrunde', background: null,
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: [{ id: 'g1', title: 'Flügelschlag', minPlayers: 1, maxPlayers: 5, scoreCategories: CATS, ...game }],
  sessions,
});
function recordApi(reply) {
  const sent = [];
  dom.set('api', (method, path, body) => {
    sent.push({ method, path, body: body && plain(body) });
    return Promise.resolve(reply(method, path, body));
  });
  return sent;
}
const type = (input, v) => { input.value = v; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };

async function openPointsSheet(round, session) {
  dom.set('showResults', realShowResults);
  dom.set('fetchRoundFresh', async () => round);
  await dom.call('showResults', round, session, round.games);
  dom.app.querySelector('.result-foot__more').click();
  const pops = dom.document.querySelectorAll('.popover--menu');
  [...pops[pops.length - 1].querySelectorAll('.popover__opt')].find((b) => /Punkte (eintragen|bearbeiten)/.test(b.textContent)).click();
  return dom.document.querySelector('.sheet');
}

test('the grid sums each column live, flips a sign, and PUTs totals plus parts', async () => {
  const session = finished('s1', '2026-03-10T19:00:00.000Z');
  const round = roundFixture([session]);
  recordApi(() => ({}));
  const sheet = await openPointsSheet(round, session);
  assert.equal(sheet.querySelector('.points-row:not(.points-row--automa)'), null, 'no single fields beside the grid');
  const rows = [...sheet.querySelectorAll('.points-grid tbody tr')];
  assert.deepEqual(rows.map((r) => r.querySelector('th').textContent), ['Vögel', 'Eier'],
    'active categories in order; a removed one this session never used is not offered');
  assert.deepEqual([...sheet.querySelectorAll('.points-grid thead th')].slice(1).map((th) => th.textContent), ['Anna', 'Ben']);
  const cell = (r, c) => rows[r].querySelectorAll('input')[c];
  assert.equal(cell(0, 0).getAttribute('aria-label'), 'Vögel – Anna');
  const totals = () => [...sheet.querySelectorAll('.points-grid__total')].map((o) => o.textContent);
  const ok = sheet.querySelector('.sheet__actions .btn--primary');

  type(cell(0, 0), '20');
  type(cell(1, 0), '7');
  assert.deepEqual(totals(), ['27', '–'], 'live sum; an untouched column shows nothing');
  cell(1, 0).dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true }));
  sheet.querySelector('.points-grid__sign').click();
  assert.equal(cell(1, 0).value, '-7', '„±" flips the field last focused');
  assert.deepEqual(totals(), ['13', '–']);
  type(cell(0, 1), '99999');
  type(cell(1, 1), '1');
  assert.equal(ok.disabled, true, 'a column summing past the bounds cannot be saved');
  type(cell(1, 1), '0');
  assert.equal(ok.disabled, false);

  dom.set('showResults', () => {});
  const sent = recordApi(() => ({}));
  ok.click();
  const put = await waitFor(() => sent.find((c) => c.method === 'PUT'), { label: 'the points PUT' });
  assert.deepEqual(put.body, {
    scores: { m1: 13, m2: 99999 },
    parts: { m1: { ca: 20, cb: -7 }, m2: { ca: 99999, cb: 0 } },
    automa: null,
  });
});

test('a seat scored before categories keeps its total; a removed category this session used is shown', async () => {
  const session = finished('s2', '2026-03-10T19:00:00.000Z', {
    scores: { m1: 42, m2: 9 }, scoreParts: { m2: { ca: 4, cx: 5 } },
  });
  const round = roundFixture([session]);
  recordApi(() => ({}));
  const sheet = await openPointsSheet(round, session);
  const rows = [...sheet.querySelectorAll('.points-grid tbody tr')];
  assert.deepEqual(rows.map((r) => r.querySelector('th').textContent), ['Vögel', 'Eier', 'Alt']);
  assert.deepEqual(rows.map((r) => r.querySelectorAll('input')[1].value), ['4', '', '5'], 'Ben’s breakdown is prefilled');
  const totals = [...sheet.querySelectorAll('.points-grid__total')];
  assert.equal(totals[0].textContent, '42');
  assert.ok(totals[0].classList.contains('points-grid__total--legacy'), 'Anna’s old total, marked as such');

  dom.set('showResults', () => {});
  const sent = recordApi(() => ({}));
  sheet.querySelector('.sheet__actions .btn--primary').click();
  const put = await waitFor(() => sent.find((c) => c.method === 'PUT'), { label: 'the points PUT' });
  assert.deepEqual(put.body.scores, { m1: 42, m2: 9 }, 'the untouched old total is kept as it was');
  assert.deepEqual(put.body.parts, { m2: { ca: 4, cx: 5 } });
});

test('the editor reorders, removes, refuses a duplicate, and PATCHes the list', async () => {
  const round = roundFixture([]);
  const sent = recordApi((method, path) => (path === `/api/rounds/${round.id}` ? round : {}));
  dom.set('fetchRoundFresh', async () => round);
  await dom.call('showGameDetail', round.id, 'g1');
  dom.app.querySelector('.gd-menu').click();
  const pops = dom.document.querySelectorAll('.popover--menu');
  const item = [...pops[pops.length - 1].querySelectorAll('.popover__opt')].find((b) => /Wertungskategorien/.test(b.textContent));
  assert.ok(item, 'the „…" menu offers the categories');
  item.click();

  const sheet = dom.document.querySelector('.sheet');
  const names = () => [...sheet.querySelectorAll('.score-cats__name')].map((i) => i.value);
  assert.deepEqual(names(), ['Vögel', 'Eier'], 'the removed category is not listed');
  const rows = () => [...sheet.querySelectorAll('.score-cats__row')];
  assert.equal(rows()[0].querySelector('.score-cats__up').disabled, true);
  rows()[1].querySelector('.score-cats__up').click();
  assert.deepEqual(names(), ['Eier', 'Vögel']);
  sheet.querySelector('.score-cats__add').click();
  const ok = sheet.querySelector('.sheet__actions .btn--primary');
  type(rows()[2].querySelector('input'), 'eier');
  assert.equal(ok.disabled, true, 'a duplicate name blocks the save');
  type(rows()[2].querySelector('input'), 'Boni');
  assert.equal(ok.disabled, false);
  sheet.querySelector('.score-cats__add').click(); // left blank: dropped
  rows()[1].querySelector('.score-cats__remove').click();
  assert.deepEqual(names(), ['Eier', 'Boni', '']);

  ok.click();
  const patch = await waitFor(() => sent.find((c) => c.method === 'PATCH'), { label: 'the game PATCH' });
  assert.deepEqual(patch.body, { scoreCategories: [{ id: 'cb', name: 'Eier' }, { name: 'Boni' }] });
});

test('the game page lists per-category records; the member page shows per-category bests', async () => {
  const s1 = finished('s1', '2026-03-01T19:00:00.000Z', { scores: { m1: 30, m2: 25 }, scoreParts: { m1: { ca: 20, cb: 10 }, m2: { ca: 13, cb: 12 } } });
  const s2 = finished('s2', '2026-03-08T19:00:00.000Z', { scores: { m1: 31 }, scoreParts: { m1: { ca: 31 } } });
  const round = roundFixture([s1, s2]);
  recordApi((method, path) => (path === `/api/rounds/${round.id}` ? round : {}));
  dom.set('fetchRoundFresh', async () => round);
  await dom.call('showGameDetail', round.id, 'g1');
  assert.deepEqual([...dom.app.querySelectorAll('.gd-record__cats li')].map((li) => li.textContent),
    ['Vögel: 31 · Anna', 'Eier: 12 · Ben']);

  await dom.call('showMember', round.id, 'm1');
  const cats = dom.app.querySelector('.member-points__cats');
  assert.ok(cats, 'the disclosure is on the member page');
  assert.equal(cats.tagName, 'DETAILS');
  assert.match(cats.querySelector('summary').textContent, /Nach Kategorie/);
  const lines = [...cats.querySelectorAll('.member-points__row')].map((r) => [
    r.querySelector('.member-points__game').textContent, r.querySelector('.member-points__value').textContent]);
  assert.deepEqual(lines, [['Vögel', '31'], ['Eier', '10']]);
});
