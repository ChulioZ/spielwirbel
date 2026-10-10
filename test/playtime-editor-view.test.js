'use strict';

/* The playing-time editor on the game page (#1627), run through the jsdom
 * harness (.claude/rules/testing-views-under-jsdom.md).
 *
 * What only a rendered page can show: the pill is the way into the editor, an
 * overridden time says so beside the number (with BGG's own figure), the editor
 * sends the override the route expects — and a cleared one as `null` — and every
 * surface formatting a playing time shows the round's number rather than BGG's.
 * The draw, the route and both backends are test/playtime-override.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush, waitFor } = require('./support/dom');

const RID = 'r1';
const COVER = 'https://cf.geekdo-images.com/x.jpg';

function roundFixture() {
  return {
    id: RID, name: 'Freitagsrunde', background: null, tags: [], providers: [],
    members: [{ id: 'm1', name: 'Anna' }],
    games: [
      // BGG says 60–90, the round says 120–150. A cover keeps the page non-sparse.
      { id: 'g1', title: 'Massive Darkness', image: COVER, minPlayers: 1, maxPlayers: 6, tagIds: [],
        minPlaytime: 60, maxPlaytime: 90, playtimeOverride: { min: 120, max: 150 } },
      // BGG's figure, untouched.
      { id: 'g2', title: 'Azul', image: COVER, minPlayers: 2, maxPlayers: 4, tagIds: [],
        minPlaytime: 30, maxPlaytime: 45 },
      // Hand-typed: no playing time at all.
      { id: 'g3', title: 'Hausregel-Spiel', image: COVER, minPlayers: 2, maxPlayers: 4, tagIds: [] },
      // Hand-typed and timed by the round alone.
      { id: 'g4', title: 'Eigenbau', image: COVER, minPlayers: 2, maxPlayers: 4, tagIds: [],
        playtimeOverride: { min: 40, max: 40 } },
    ],
    sessions: [],
  };
}

function bootApp(t_) {
  const dom = loadApp({ locale: 'de' });
  t_.after(() => dom.close());
  const round = roundFixture();
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    return {};
  });
  dom.set('toast', (msg) => calls.push({ toast: msg }));
  // jsdom has no layout; a phone-width answer presents the editor as a sheet.
  dom.run('window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });');
  return { dom, calls };
}

const pill = (dom) => [...dom.app.querySelectorAll('.gd-facts .fact')]
  .find((p) => p.classList.contains('fact--empty')
    || (p.querySelector('.fact__label') || {}).textContent === 'Spieldauer');
const patches = (calls) => calls.filter((c) => c.method === 'PATCH');

test('an overridden time shows the round\'s number, says so, and names BGG\'s figure', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const p = pill(dom);
  assert.ok(p, 'the playing-time pill is on the card');
  assert.equal(p.tagName, 'BUTTON', 'the pill is the way into its editor');
  assert.equal(p.querySelector('.fact__value').textContent, '120–150 Min.');
  assert.equal(p.querySelector('.fact__note').textContent, 'eigene Angabe · BGG: 60–90 Min.');
});

test('BGG\'s own time carries no note; a time only the round set says „eigene Angabe"', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g2');
  assert.equal(pill(dom).querySelector('.fact__value').textContent, '30–45 Min.');
  assert.equal(pill(dom).querySelector('.fact__note'), null);

  await dom.call('showGameDetail', RID, 'g4');
  assert.equal(pill(dom).querySelector('.fact__value').textContent, '40 Min.');
  assert.equal(pill(dom).querySelector('.fact__note').textContent, 'eigene Angabe');
});

test('a game with no playing time offers an empty pill to set one', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g3');
  const p = pill(dom);
  assert.ok(p.classList.contains('fact--empty'));
  assert.equal(p.querySelector('.fact__value').textContent, 'Spieldauer angeben');
  assert.equal(p.querySelector('.fact__label'), null, 'the invitation does not repeat the word');
});

test('the editor opens prefilled and sends the override the route expects', async (t_) => {
  const { dom, calls } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  pill(dom).click();
  const inputs = dom.document.querySelectorAll('.editor--playtime input, .popover--playtime input');
  assert.equal(inputs.length, 2, 'two minute fields');
  assert.deepEqual([...inputs].map((i) => i.value), ['120', '150']);

  inputs[0].value = '150';
  inputs[1].value = '210';
  const apply = [...dom.document.querySelectorAll('.editor--playtime button, .popover--playtime button')]
    .find((b) => b.textContent.trim() === dom.run("t('common.apply')"));
  apply.click();
  await waitFor(() => patches(calls).length);
  const sent = patches(calls);
  assert.equal(sent.length, 1);
  assert.deepEqual({ ...sent[0].body.playtimeOverride }, { min: 150, max: 210 });
});

test('the reset names BGG\'s figure and clears the override with null', async (t_) => {
  const { dom, calls } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  pill(dom).click();
  const reset = [...dom.document.querySelectorAll('.editor--playtime button, .popover--playtime button')]
    .find((b) => b.textContent.includes('BGG-Wert verwenden'));
  assert.ok(reset, 'an override offers the way back');
  assert.match(reset.textContent, /60–90 Min\./);
  reset.click();
  await waitFor(() => patches(calls).length);
  assert.equal(patches(calls)[0].body.playtimeOverride, null);
});

test('BGG\'s untouched time offers no reset', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g2');
  pill(dom).click();
  const buttons = [...dom.document.querySelectorAll('.editor--playtime button, .popover--playtime button')];
  assert.ok(buttons.length > 0);
  assert.equal(buttons.some((b) => /BGG-Wert|Eigene Angabe/.test(b.textContent)), false);
});

test('a refused input toasts and sends nothing', async (t_) => {
  const { dom, calls } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g2');
  pill(dom).click();
  const inputs = dom.document.querySelectorAll('.editor--playtime input, .popover--playtime input');
  inputs[0].value = '90';
  inputs[1].value = '60';
  inputs[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flush();
  assert.equal(patches(calls).length, 0);
  assert.ok(calls.some((c) => c.toast === dom.run("t('detail.toast.playtimeRange')")));
});

test('playtimeOverrideFrom: one figure fills both bounds, and bad input names its reason', (t_) => {
  const { dom } = bootApp(t_);
  const run = (a, b) => JSON.parse(JSON.stringify(dom.run(`playtimeOverrideFrom(${JSON.stringify(a)}, ${JSON.stringify(b)})`)));
  assert.deepEqual(run('60', '90'), { override: { min: 60, max: 90 } });
  assert.deepEqual(run('90', ''), { override: { min: 90, max: 90 } });
  assert.deepEqual(run('', ' 45 '), { override: { min: 45, max: 45 } });
  assert.deepEqual(run('', ''), { error: 'detail.toast.playtimeNeeded' });
  assert.deepEqual(run('0', '30'), { error: 'detail.toast.playtimeNeeded' });
  assert.deepEqual(run('10', '99999'), { error: 'detail.toast.playtimeNeeded' });
  assert.deepEqual(run('90', '60'), { error: 'detail.toast.playtimeRange' });
});

test('every surface formatting a playing time — vote card, ⓘ sheet, Regal — shows the round\'s', (t_) => {
  const { dom } = bootApp(t_);
  const g = '{ minPlaytime: 60, maxPlaytime: 90, playtimeOverride: { min: 120, max: 150 } }';
  assert.equal(dom.run(`playtimeText(${g})`), '120–150 Min.');
  // The ⓘ sheet's body (also the vote card's) states the same figure.
  const body = dom.run(`gameInfoBody(${g})`);
  assert.match(body.textContent, /120–150 Min\./);
  assert.doesNotMatch(body.textContent, /60–90/);
  // A game timed only by the round counts as having something to show.
  assert.equal(dom.run('hasGameInfo({ playtimeOverride: { min: 40, max: 40 } })'), true);
});
