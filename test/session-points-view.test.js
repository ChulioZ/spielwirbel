'use strict';

/*
 * A finished session's points (#1630), run as real screens:
 *  - the results screen offers „Punkte eintragen" only once a game was played;
 *  - the sheet has one field per PARTY (a team, or a person playing alone),
 *    flips the sign with „±" (iOS's numeric keypad has no minus), refuses a
 *    decimal by disabling „Übernehmen", and PUTs the seat map;
 *  - the result lists the points best first with the „Neuer Rekord" mark;
 *  - the game page shows the group record and each scored stamp's best line,
 *    and its „Niedrigere Punktzahl gewinnt" switch PATCHes the game.
 * The server half is test/session-scores.test.js, the derivation
 * test/point-records.test.js.
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
const finished = (id, createdAt, scores, extra = {}) => ({
  id, createdAt, finishedAt: createdAt, chosenAt: createdAt, gameIds: ['g1'], memberIds: ['m1', 'm2', 'm3'],
  votes: {}, done: true, finished: true, cancelled: false, winnerIds: [], chosenGameId: 'g1',
  ...(scores ? { scores } : {}), ...extra,
});
const roundFixture = (sessions, game = {}) => ({
  id: `r${++rid}`, name: 'Freitagsrunde', background: null,
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }],
  games: [{ id: 'g1', title: 'Catan', minPlayers: 2, maxPlayers: 4, ...game }],
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

async function results(round, session) {
  dom.set('showResults', realShowResults);
  dom.set('fetchRoundFresh', async () => round);
  await dom.call('showResults', round, session, round.games);
}
/* The foot's „Mehr" item matching `re` (#1575 moved Klassisch's link row into
   it), or undefined. The menu is closed again when nothing matched, so a later
   test does not find a stale popover. */
function mehrItem(re) {
  const more = dom.app.querySelector('.result-foot__more');
  if (!more) return undefined;
  more.click();
  const pops = dom.document.querySelectorAll('.popover--menu');
  const opt = [...pops[pops.length - 1].querySelectorAll('.popover__opt')].find((b) => re.test(b.textContent));
  if (!opt) dom.run('closePopover()');
  return opt;
}
const pointsButton = () => mehrItem(/Punkte (eintragen|bearbeiten)/);

test('the sheet has one field per party, flips the sign, and PUTs the seat map', async () => {
  const session = finished('s1', '2026-03-10T19:00:00.000Z', null, {
    teams: [{ id: 't1', personIds: ['m1', 'm2'] }],
  });
  const round = roundFixture([session]);
  recordApi(() => ({}));
  await results(round, session);
  const btn = pointsButton();
  assert.ok(btn, 'a played session offers the points');
  assert.match(btn.textContent, /Punkte eintragen/);
  btn.click();

  const sheet = dom.document.querySelector('.sheet');
  const rows = [...sheet.querySelectorAll('.points-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('label').textContent), ['Anna und Ben', 'Clara'],
    'the team scores as one, the person beside it as themselves');
  const [team, clara] = rows.map((r) => r.querySelector('input'));
  assert.equal(team.getAttribute('inputmode'), 'numeric');

  const ok = sheet.querySelector('.sheet__actions .btn--primary');
  const type = (input, v) => { input.value = v; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  type(team, '12.5');
  assert.equal(ok.disabled, true, 'a decimal is refused before it is sent');
  assert.equal(team.getAttribute('aria-invalid'), 'true');
  type(team, '12');
  assert.equal(ok.disabled, false);
  rows[0].querySelector('.points-row__sign').click();
  assert.equal(team.value, '-12', '„±" makes it negative without a minus key');
  type(clara, '0');

  const reopened = [];
  dom.set('showResults', (r, s) => reopened.push(s.id));
  const sent = recordApi(() => ({}));
  ok.click();
  const put = await waitFor(() => sent.find((c) => c.method === 'PUT'), { label: 'the points PUT' });
  assert.equal(put.path, `/api/rounds/${round.id}/sessions/s1/scores`);
  assert.deepEqual(put.body, { scores: { t1: -12, m3: 0 }, automa: null });
  await waitFor(() => reopened.length, { label: 'the screen re-rendering from the server' });
});

test('the result lists the points best first and marks a beaten best', async () => {
  const s1 = finished('s1', '2026-03-01T19:00:00.000Z', { m1: 40, m2: 55 });
  const s2 = finished('s2', '2026-03-08T19:00:00.000Z', { m1: 48, m2: 50, m3: 30 });
  const round = roundFixture([s1, s2]);
  await results(round, s2);
  const lines = [...dom.app.querySelectorAll('.result-points__line')].map((li) => [
    li.querySelector('.result-points__name').textContent,
    li.querySelector('.result-points__value').textContent,
    !!li.querySelector('.result-points__record'),
  ]);
  assert.deepEqual(lines, [['Ben', '50', false], ['Anna', '48', true], ['Clara', '30', false]]);
  assert.match(pointsButton().textContent, /Punkte bearbeiten/);
});

test('a running session offers no points and shows none', async () => {
  const s = finished('s3', '2026-03-10T19:00:00.000Z', { m1: 9 }, { finished: false });
  const round = roundFixture([s]);
  await results(round, s);
  assert.equal(pointsButton(), undefined);
  assert.equal(dom.app.querySelector('.result-points'), null);
});

test('the game page shows the record, the stamp’s best line, and switches the direction', async () => {
  const s1 = finished('s1', '2026-03-01T19:00:00.000Z', { m1: 40, m2: 55 });
  const s2 = finished('s2', '2026-03-08T19:00:00.000Z', { m3: 61 });
  const round = roundFixture([s1, s2]);
  const sent = recordApi((method, path) => (path === `/api/rounds/${round.id}` ? round : {}));
  dom.set('fetchRoundFresh', async () => round);
  await dom.call('showGameDetail', round.id, 'g1');
  const record = dom.app.querySelector('.gd-record__line');
  assert.ok(record, 'the record line is on the page');
  assert.match(record.textContent, /Rekord: 61 · Clara/);
  const pts = [...dom.app.querySelectorAll('.stamp__pts')].map((el) => el.textContent.trim());
  assert.deepEqual(pts, ['Clara: 61', 'Ben: 55'], 'newest first, each evening’s best');

  const box = dom.app.querySelector('.gd-record__dir input');
  assert.equal(box.checked, false);
  box.checked = true;
  box.dispatchEvent(new dom.window.Event('change'));
  const patch = await waitFor(() => sent.find((c) => c.method === 'PATCH'), { label: 'the game PATCH' });
  assert.deepEqual(patch.body, { lowScoreWins: true });
});

test('a game nobody has scored shows no record and no switch', async () => {
  const round = roundFixture([finished('s1', '2026-03-01T19:00:00.000Z', null)]);
  recordApi((method, path) => (path === `/api/rounds/${round.id}` ? round : {}));
  await dom.call('showGameDetail', round.id, 'g1');
  assert.equal(dom.app.querySelector('.gd-record'), null);
  assert.equal(dom.app.querySelector('.stamp__pts'), null);
});

// #1672: the automa row — added by „Automa hinzufügen", named „Automa" by
// default, sent as `automa` BESIDE the seat map and never as a key in it.
test('the sheet adds an automa beside the parties and PUTs it as its own field', async () => {
  const session = finished('s1', '2026-03-10T19:00:00.000Z', null, { memberIds: ['m1'] });
  const round = roundFixture([session]);
  recordApi(() => ({}));
  await results(round, session);
  pointsButton().click();
  const sheet = dom.document.querySelector('.sheet');
  const toggle = sheet.querySelector('.points-automa__toggle');
  assert.match(toggle.textContent, /Automa hinzufügen/);
  assert.equal(sheet.querySelector('.points-row--automa'), null, 'no automa until asked for');
  toggle.click();
  const row = sheet.querySelector('.points-row--automa');
  assert.ok(row, 'the automa row appears');
  assert.match(toggle.textContent, /Automa entfernen/);
  const name = row.querySelector('.points-row__automa-name');
  const pts = row.querySelector('.points-row__input');
  assert.equal(name.value, 'Automa', 'named „Automa" by default');

  const ok = sheet.querySelector('.sheet__actions .btn--primary');
  const type = (input, v) => { input.value = v; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  type(name, '  ');
  assert.equal(ok.disabled, true, 'a blank name is refused');
  type(name, 'Automa (schwer)');
  type(pts, '82');
  type(sheet.querySelector('.points-row:not(.points-row--automa) input'), '70');
  assert.equal(ok.disabled, false);

  const sent = recordApi(() => ({}));
  dom.set('showResults', () => {});
  ok.click();
  const put = await waitFor(() => sent.find((c) => c.method === 'PUT'), { label: 'the points PUT' });
  assert.deepEqual(put.body, { scores: { m1: 70 }, automa: { name: 'Automa (schwer)', points: 82 } });
});

test('a stored automa reopens in the sheet, removing it sends null, and the result lists it last', async () => {
  const session = finished('s1', '2026-03-10T19:00:00.000Z', { m1: 70 }, {
    memberIds: ['m1'], automa: { name: 'Automa (schwer)', points: 82 },
  });
  const round = roundFixture([session]);
  await results(round, session);
  const lines = [...dom.app.querySelectorAll('.result-points__line')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
  assert.deepEqual(lines, ['Anna 70', 'Automa (schwer) 82'], 'the automa closes the list, outside the ranking');
  assert.ok(dom.app.querySelector('.result-points__line--automa'));
  assert.match(pointsButton().textContent, /Punkte bearbeiten/);

  pointsButton().click();
  const sheet = dom.document.querySelector('.sheet');
  assert.equal(sheet.querySelector('.points-row__automa-name').value, 'Automa (schwer)');
  sheet.querySelector('.points-automa__toggle').click();
  assert.equal(sheet.querySelector('.points-row--automa'), null);
  const sent = recordApi(() => ({}));
  dom.set('showResults', () => {});
  sheet.querySelector('.sheet__actions .btn--primary').click();
  const put = await waitFor(() => sent.find((c) => c.method === 'PUT'), { label: 'the points PUT' });
  assert.deepEqual(put.body, { scores: { m1: 70 }, automa: null });
});

test('an automa alone still shows the points block, and „Punkte bearbeiten"', async () => {
  const session = finished('s1', '2026-03-10T19:00:00.000Z', null, { memberIds: ['m1'], automa: { name: 'Bot' } });
  const round = roundFixture([session]);
  await results(round, session);
  const lines = [...dom.app.querySelectorAll('.result-points__line')];
  assert.equal(lines.length, 1);
  assert.equal(lines[0].querySelector('.result-points__value'), null, 'an automa without points shows no number');
  assert.match(pointsButton().textContent, /Punkte bearbeiten/);
});

// The „±" flip used to dispatch a non-bubbling `input`, so the list's validity
// check never saw it: „±" on an empty field left a bare "-" with „Übernehmen"
// still enabled. Found building #1672.
test('„±" re-runs the validity check', async () => {
  const session = finished('s1', '2026-03-10T19:00:00.000Z', null);
  const round = roundFixture([session]);
  recordApi(() => ({}));
  await results(round, session);
  pointsButton().click();
  const sheet = dom.document.querySelector('.sheet');
  const row = sheet.querySelector('.points-row');
  row.querySelector('.points-row__sign').click();
  assert.equal(row.querySelector('input').value, '-');
  assert.equal(sheet.querySelector('.sheet__actions .btn--primary').disabled, true, 'a bare minus is not a number');
});
