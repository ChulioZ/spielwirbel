'use strict';

/* The result moment's one motion hook (#1386, O17.5): `data-fresh` on each
 * `.badge-moment__item` the screen has not shown before. A design animates the
 * moment off this attribute alone (Ocean's rising bubble, Der Tisch's pin), so
 * what it must NOT mark is what would replay: the screen's first fill (a cold
 * load of a finished session) and a mark a winner tap's refill already showed.
 *
 * Design-neutral on purpose — Klassisch draws nothing from it — so it is
 * pinned here and not in any one design's spec. Rendered through showResults,
 * the real call site.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, waitFor, flush } = require('./support/dom');
const { night, badgeRound, stubApi } = require('./support/badge-fixture');

const moment = (dom) => dom.app.querySelector('.badge-moment');
// Each item's mark key and whether it is fresh, in order.
const marks = (dom) => [...moment(dom).querySelectorAll('.badge-moment__item')]
  .map((li) => `${li.querySelector('.badge').dataset.key}${li.hasAttribute('data-fresh') ? '*' : ''}`);

function mount(t, sessions) {
  const r = badgeRound(sessions);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, r);
  dom.set('toast', () => {});
  dom.set('api', async (method, url, body) => {
    if (/\/finish$/.test(url)) return { winnerIds: body.winnerIds || [], finishedAt: '2026-07-01T22:00:00.000Z' };
    return /\/activities$/.test(url) ? [] : {};
  });
  return { r, dom };
}
const chip = (dom, name) => [...dom.app.querySelectorAll('.winner-chip')].find((c) => c.textContent.includes(name));

test('a cold load of a finished session shows its marks still — nothing is fresh', async (t) => {
  const { r, dom } = mount(t, [night('s1', 1)]);
  await dom.call('showResults', r, r.sessions[0], r.games, false);
  assert.deepEqual(marks(dom), ['firstWin', 'founded']);
});

test('recording the finish makes its marks fresh; a winner tap adds only what it earned', async (t) => {
  const { r, dom } = mount(t, [night('s1', 1, { finished: false, winnerIds: [] })]);
  await dom.call('showResults', r, r.sessions[0], r.games, false);
  assert.equal(moment(dom).hidden, true, 'nothing is earned before the finish');

  const finish = [...dom.app.querySelectorAll('.tisch button')].find((b) => /Als gespielt markieren/.test(b.textContent));
  assert.ok(finish, 'the table offers the finish');
  finish.click();
  await waitFor(() => marks(dom).length === 1, { label: 'the finish earns the founding' });
  assert.deepEqual(marks(dom), ['founded*'], 'the mark the finish earned arrives fresh');

  chip(dom, 'Anna').click();
  await waitFor(() => marks(dom).length === 2, { label: 'the tap earns the first win' });
  assert.deepEqual(marks(dom), ['firstWin*', 'founded'], 'the founding was shown — it must not replay');

  chip(dom, 'Ben').click();
  await waitFor(() => marks(dom).length === 3 || moment(dom).querySelector('.badge-moment__more'), { label: 'Ben’s win' });
  await flush();
  assert.deepEqual(marks(dom), ['firstWin', 'firstWin*'], 'Anna’s first win is already shown; Ben’s is new');
});

test('a mark un-earned and earned again does not replay on the same screen', async (t) => {
  const { r, dom } = mount(t, [night('s1', 1, { winnerIds: [] })]);
  await dom.call('showResults', r, r.sessions[0], r.games, false);
  [...dom.app.querySelectorAll('.tisch button')].find((b) => b.textContent.trim() === dom.run("t('result.change')")).click();
  chip(dom, 'Anna').click();
  await waitFor(() => marks(dom).length === 2, { label: 'first win' });
  assert.deepEqual(marks(dom), ['firstWin*', 'founded']);
  chip(dom, 'Anna').click();
  await waitFor(() => marks(dom).length === 1, { label: 'un-won' });
  chip(dom, 'Anna').click();
  await waitFor(() => marks(dom).length === 2, { label: 'won again' });
  assert.deepEqual(marks(dom), ['firstWin', 'founded']);
});
