'use strict';

/* „Aus euren Sessions" on the game page (#1874), run through the jsdom harness
 * (.claude/rules/testing-views-under-jsdom.md).
 *
 * What only a rendered page can show: „Übernehmen" sits BESIDE the pill (an
 * editable pill is a <button>, so a link inside it would be invalid) and only
 * when the measured figure says something new; tapping it sends the flag; a
 * flagged game's pill IS the median and says where it comes from; the editor
 * opens on the median and its reset switches the flag off; and the other
 * readers (the Regal card, the vote card) print the same number.
 * The resolver, the route and the server readers are
 * test/playtime-from-sessions.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, waitFor } = require('./support/dom');

const RID = 'r1';
const COVER = 'https://cf.geekdo-images.com/x.jpg';

let n = 0;
const evening = (gid, durationMinutes) => ({
  id: `s${++n}`, gameIds: [gid], votes: {}, finished: true, chosenGameId: gid, durationMinutes,
  createdAt: `2026-10-${String(n).padStart(2, '0')}T19:00:00.000Z`,
});

function roundFixture() {
  const base = { image: COVER, minPlayers: 2, maxPlayers: 4, tagIds: [], minPlaytime: 60, maxPlaytime: 90 };
  return {
    id: RID, name: 'Freitagsrunde', background: null, tags: [], providers: [],
    members: [{ id: 'm1', name: 'Anna' }],
    games: [
      { id: 'g1', title: 'Länger als die Schachtel', ...base },          // median 150 vs 60–90
      { id: 'g2', title: 'Wie angegeben', ...base },                     // median 80, inside
      { id: 'g3', title: 'Übernommen', ...base, playtimeFromSessions: true }, // median 150
      { id: 'g4', title: 'Noch ungemessen', ...base, playtimeFromSessions: true }, // one evening
      { id: 'g5', title: 'Eigene Angabe', ...base, playtimeOverride: { min: 120, max: 150 } }, // median 220
    ],
    sessions: [
      evening('g1', 140), evening('g1', 160),
      evening('g2', 75), evening('g2', 85),
      evening('g3', 140), evening('g3', 160),
      evening('g4', 200),
      evening('g5', 210), evening('g5', 230),
    ],
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
  dom.set('toast', () => {});
  dom.run('window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });');
  return { dom, calls, round };
}

const pill = (dom) => [...dom.app.querySelectorAll('.gd-facts .fact')]
  .find((p) => (p.querySelector('.fact__label') || {}).textContent === 'Spieldauer');
const adopt = (dom) => dom.app.querySelector('.gd-facts .fact-adopt');
const patches = (calls) => calls.filter((c) => c.method === 'PATCH');

test('a game that runs longer than its box offers „Übernehmen" beside the pill, and it sends the flag', async (t_) => {
  const { dom, calls } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const p = pill(dom);
  assert.equal(p.querySelector('.fact__value').textContent, '60–90 Min.', 'the box figure stays the value');
  assert.equal(p.querySelector('.fact__note--own').textContent, 'Bei euch: ~150 Min.');
  const a = adopt(dom);
  assert.ok(a, 'the offer is on the card');
  assert.equal(a.tagName, 'BUTTON');
  assert.equal(p.contains(a), false, 'beside the pill, never inside its <button>');
  // One wrap item with its pill, so the facts row cannot break between them
  // and seat the link beside the NEXT pill (seen at 1280 in Der Tisch).
  assert.equal(a.parentElement, p.parentElement);
  assert.ok(a.parentElement.classList.contains('fact-group'));
  assert.equal(a.textContent, 'Übernehmen');
  assert.equal(a.getAttribute('aria-label'), 'Spieldauer aus euren Sessions übernehmen (~150 Min.)');

  a.click();
  await waitFor(() => patches(calls).length);
  assert.deepEqual({ ...patches(calls)[0].body }, { playtimeFromSessions: true });
});

test('a measured figure inside the box\'s range offers nothing', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g2');
  assert.equal(pill(dom).querySelector('.fact__note--own').textContent, 'Bei euch: ~80 Min.');
  assert.equal(adopt(dom), null);
});

test('a hand-set time is offered the measured one too, when they disagree', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g5');
  assert.equal(pill(dom).querySelector('.fact__value').textContent, '120–150 Min.');
  assert.ok(adopt(dom), 'an override does not suppress the offer');
});

test('an adopted game\'s pill IS the median, says where it comes from, and offers nothing more', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g3');
  const p = pill(dom);
  assert.equal(p.querySelector('.fact__value').textContent, '150 Min.');
  assert.equal(p.querySelector('.fact__note').textContent, 'aus euren Sessions · BGG: 60–90 Min.');
  assert.equal(p.querySelector('.fact__note--own'), null, '„Bei euch" is not repeated');
  assert.equal(adopt(dom), null);
});

test('adopted but not yet measured twice: BGG\'s figure, with no note claiming otherwise', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g4');
  const p = pill(dom);
  assert.equal(p.querySelector('.fact__value').textContent, '60–90 Min.');
  assert.equal(p.querySelector('.fact__note'), null);
});

test('the editor opens on the median, and its reset switches the flag off — not an override', async (t_) => {
  const { dom, calls } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g3');
  pill(dom).click();
  const inputs = dom.document.querySelectorAll('.editor--playtime input, .popover--playtime input');
  assert.deepEqual([...inputs].map((i) => i.value), ['150', '150']);
  const reset = [...dom.document.querySelectorAll('.editor--playtime button, .popover--playtime button')]
    .find((b) => b.textContent.includes('BGG-Wert verwenden'));
  assert.ok(reset, 'the measured choice offers the way back');
  reset.click();
  await waitFor(() => patches(calls).length);
  assert.deepEqual({ ...patches(calls)[0].body }, { playtimeFromSessions: null });
});

test('the reset is offered even before a median exists — the choice is what it undoes', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g4');
  pill(dom).click();
  const buttons = [...dom.document.querySelectorAll('.editor--playtime button, .popover--playtime button')];
  assert.ok(buttons.some((b) => b.textContent.includes('BGG-Wert verwenden')));
});

test('the Regal card and the vote card print the same median', (t_) => {
  const { dom, round } = bootApp(t_);
  dom.set('__round', round);
  const durations = dom.run('roundDurations(__round.sessions)');
  dom.set('__d', durations);
  const meta = dom.run("cardMeta(__round.games.find((g) => g.id === 'g3'), __d)");
  assert.match(meta, /150 Min\./);
  assert.doesNotMatch(meta, /60–90/);
  const line = dom.run("voteMetaLine(__round.games.find((g) => g.id === 'g3'), __round)");
  assert.match(line, /150 Min\./);
  // A reader handed no index throws for a flagged game instead of printing BGG.
  assert.throws(() => dom.run("cardMeta(__round.games.find((g) => g.id === 'g3'))"), /duration index/);
});
