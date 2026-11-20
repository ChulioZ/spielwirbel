'use strict';

/*
 * The game page's "also change it in your other rounds" sheet (#1843), driven
 * through the real shell in jsdom (test/support/dom.js) — public/js/game-twins.js
 * is never require()d, so it stays out of the coverage report.
 *
 * What it pins: which twins are offered and which are pre-ticked, that applying
 * PATCHes exactly the ticked rounds through each round's own route, and that a
 * game without a BGG link or a failed lookup never shows a sheet.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, waitFor, flush } = require('./support/dom');

const catan = (over = {}) => ({
  id: 'g-here', title: 'Catan', minPlayers: 3, maxPlayers: 4, minPlaytime: 60, maxPlaytime: 120,
  source: { provider: 'bgg', externalId: '13' }, ...over,
});
const twin = (roundId, over = {}) => ({
  roundId, roundName: `Runde ${roundId}`, gameId: `g-${roundId}`, title: 'Catan',
  minPlayers: 3, maxPlayers: 4, minPlaytime: 60, maxPlaytime: 120, ...over,
});

function boot(twins, { patch = () => ({}) } = {}) {
  const dom = loadApp();
  const calls = [];
  const toasts = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (method === 'GET') {
      if (twins instanceof Error) throw twins;
      return { twins };
    }
    return patch(url, body);
  });
  dom.set('toast', (msg, opts) => toasts.push({ msg, tone: opts && opts.tone }));
  return { dom, calls, toasts };
}

// Arrays built inside the jsdom realm fail a cross-realm deepEqual; copy them out.
const plain = (v) => JSON.parse(JSON.stringify(v));
const sheetRows = (dom) => [...dom.document.querySelectorAll('.editor--twins .twin-row')];

test('only twins that differ from the new value are offered, and only the in-sync ones are pre-ticked', () => {
  const dom = loadApp();
  // This round had no override (BGG's 60–120); the edit sets 60–90.
  const offer = dom.call('twinOffers', catan(), { playtimeOverride: { min: 60, max: 90 } }, [
    twin('a'),                                                  // in sync -> ticked
    twin('b', { playtimeOverride: { min: 30, max: 45 } }),      // differs -> unticked
    twin('c', { playtimeOverride: { min: 60, max: 90 } }),      // already the new value -> left out
  ]);
  assert.equal(offer.field.key, 'playtime');
  assert.deepEqual(plain(offer.rows.map((r) => [r.twin.roundId, r.checked])), [['a', true], ['b', false]]);
  // Each row names that round's CURRENT figure, not this round's.
  const t = dom.get('t');
  assert.equal(offer.rows[0].from, t('gameInfo.playtimeRange', { min: 60, max: 120 }));
  assert.equal(offer.rows[1].from, t('gameInfo.playtimeRange', { min: 30, max: 45 }));
  assert.equal(offer.rows[1].to, t('gameInfo.playtimeRange', { min: 60, max: 90 }));
  // A patch touching none of the four fields offers nothing at all.
  assert.equal(dom.call('twinOffers', catan(), { tagIds: ['x'] }, [twin('a')]), null);
  dom.close();
});

test('clearing a pitch is offered too, and the player range is one row with both bounds', () => {
  const dom = loadApp();
  const t = dom.get('t');
  const cleared = dom.call('twinOffers', catan({ pitch: 'Handeln' }), { pitch: null },
    [twin('a', { pitch: 'Handeln' }), twin('b')]);
  // `b` has no pitch already, so there is nothing to clear there.
  assert.deepEqual(plain(cleared.rows.map((r) => [r.twin.roundId, r.checked, r.to])), [['a', true, t('twins.empty')]]);

  const players = dom.call('twinOffers', catan(), { minPlayers: 2, maxPlayers: 5 }, [twin('a'), twin('b', { maxPlayers: 6 })]);
  assert.equal(players.field.key, 'players');
  assert.deepEqual(plain(players.rows.map((r) => [r.twin.roundId, r.checked])), [['a', true], ['b', false]]);
  assert.equal(players.rows[0].to, dom.call('playersText', 2, 5));
  dom.close();
});

test('the sheet PATCHes exactly the ticked rounds, each through its own route', async () => {
  const { dom, calls, toasts } = boot([twin('a'), twin('b'), twin('c', { title: 'Siedler', shared: true })]);
  await dom.call('offerTwinEdit', 'here', catan(), { title: 'Catan (2015)' });
  const rows = await waitFor(() => sheetRows(dom).length === 3 && sheetRows(dom));
  assert.equal(calls[0].url, '/api/game-twins?bggId=13&excludeRoundId=here');
  // a and b were in sync, c differed: pre-ticked accordingly.
  assert.deepEqual(rows.map((r) => r.querySelector('input').checked), [true, true, false]);
  assert.match(rows[2].textContent, /Siedler/);
  assert.match(rows[2].textContent, new RegExp(dom.get('t')('twins.shared')));

  // Untick b, tick c, apply.
  rows[1].querySelector('input').click();
  rows[2].querySelector('input').click();
  const ok = dom.document.querySelector('.editor--twins .btn--primary');
  assert.equal(ok.textContent, dom.call('tn', 2, 'twins.applyOne', 'twins.applyMany'));
  ok.click();
  await waitFor(() => toasts.length);
  const patches = calls.filter((c) => c.method === 'PATCH');
  assert.deepEqual(patches.map((c) => c.url), ['/api/rounds/a/games/g-a', '/api/rounds/c/games/g-c']);
  assert.ok(patches.every((c) => JSON.stringify(c.body) === JSON.stringify({ title: 'Catan (2015)' })));
  assert.equal(toasts[0].tone, undefined);
  assert.equal(dom.document.querySelector('.editor--twins'), null, 'the sheet closed');
  dom.close();
});

test('one refused round does not stop the others, and the toast says so', async () => {
  const { dom, calls, toasts } = boot([twin('a'), twin('b')], {
    patch: (url) => { if (url.includes('/a/')) throw new Error('not_owner'); return {}; },
  });
  await dom.call('offerTwinEdit', 'here', catan(), { pitch: 'Neu' });
  await waitFor(() => sheetRows(dom).length === 2);
  dom.document.querySelector('.editor--twins .btn--primary').click();
  await waitFor(() => toasts.length);
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 2);
  assert.equal(toasts[0].msg, dom.get('t')('twins.toast.partial', { done: 1, failed: 1 }));
  assert.equal(toasts[0].tone, 'error');
  dom.close();
});

test('skipping writes nothing; no BGG link, no twins or a failed lookup never shows a sheet', async () => {
  const skip = boot([twin('a')]);
  await skip.dom.call('offerTwinEdit', 'here', catan(), { title: 'X' });
  await waitFor(() => sheetRows(skip.dom).length === 1);
  skip.dom.document.querySelector('.editor--twins .btn--ghost').click();
  await flush();
  assert.equal(skip.calls.filter((c) => c.method === 'PATCH').length, 0);
  assert.equal(skip.toasts.length, 0, 'a skip is not an error and needs no toast');
  skip.dom.close();

  for (const [label, game, twins] of [
    ['unlinked', catan({ source: null }), [twin('a')]],
    ['another provider', catan({ source: { provider: 'other', externalId: '13' } }), [twin('a')]],
    ['no twins', catan(), []],
    ['lookup failed', catan(), new Error('rate_limited')],
  ]) {
    const { dom, calls, toasts } = boot(twins);
    await dom.call('offerTwinEdit', 'here', game, { title: 'X' });
    await flush();
    assert.equal(dom.document.querySelector('.editor--twins'), null, label);
    assert.equal(toasts.length, 0, label);
    if (label === 'unlinked' || label === 'another provider') assert.equal(calls.length, 0, `${label}: no lookup at all`);
    dom.close();
  }
});

test('a fault while building the sheet is reported to the operator, not shown to the user', async () => {
  const { dom, toasts } = boot([twin('a')]);
  const reports = [];
  dom.set('reportClientError', (kind, err) => reports.push([kind, err && err.message]));
  dom.set('openEditor', () => { throw new Error('boom'); });
  await dom.call('offerTwinEdit', 'here', catan(), { title: 'X' });
  assert.deepEqual(reports, [['game_twins', 'boom']]);
  assert.equal(toasts.length, 0);
  dom.close();
});
