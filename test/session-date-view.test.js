'use strict';

/*
 * The three ways into a session's day (#1616), run as real screens:
 *  - the direct-play sheet's „Wann?" field — today sends NOTHING new, a past
 *    day sends `playedOn` and lands with the winner picker open;
 *  - the Chronik's „Session nachtragen" — shelf games only, then the same sheet
 *    dated yesterday;
 *  - „Datum ändern" on a finished session's results — PATCHes the day.
 * The server half is test/session-backdate.test.js.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, waitFor, flush } = require('./support/dom');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
// Kept so the results-screen tests can put the real view back: the direct-play
// tests stub it, and `set` replaces the global for the whole file.
const realShowResults = dom.get('showResults');
const toasts = [];
dom.set('toast', (msg, opts) => toasts.push({ msg, tone: opts && opts.tone }));

const plain = (o) => JSON.parse(JSON.stringify(o));
const day = (offset) => dom.run(`localDayKey(new Date(Date.now() + ${offset} * 86400000))`);

let rid = 0;
const roundFixture = (over = {}) => ({
  id: `r${++rid}`,
  name: 'Freitagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: [
    { id: 'g1', title: 'Catan', minPlayers: 2, maxPlayers: 4 },
    { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4 },
    { id: 'g3', title: 'Agricola', retired: true },
    { id: 'g4', title: 'Brass', wish: true },
  ],
  sessions: [],
  ...over,
});

function recordApi(reply) {
  const sent = [];
  dom.set('api', (method, path, body) => {
    sent.push({ method, path, body: body && plain(body) });
    return Promise.resolve(reply(method, path, body));
  });
  return sent;
}

function setDay(input, value) {
  input.value = value;
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

test('the direct-play sheet carries „Wann?" set to today, and today sends no playedOn', async () => {
  const round = roundFixture();
  const opened = [];
  dom.set('showResults', (r, s) => opened.push(s.id));
  await dom.call('startDirectSession', round, round.games[0]);
  const sheet = dom.document.querySelector('.sheet');
  const input = sheet.querySelector('.played-on__input');
  assert.ok(input, 'the date field is in the sheet');
  assert.equal(input.value, day(0));
  assert.equal(input.max, day(0), 'no future day is offered');
  assert.equal(input.min, '2000-01-01');
  assert.match(sheet.querySelector('#startDirect').textContent, /Los geht/);

  const sent = recordApi(() => ({ session: { id: 's-today' }, games: round.games }));
  sheet.querySelector('#startDirect').click();
  await waitFor(() => opened.length, { label: 'the results screen opening' });
  assert.equal('playedOn' in sent[0].body, false, 'today is the ordinary direct play');
  assert.equal(dom.run("takeResultPickerOpen('s-today')"), false, 'and opens on the picture, as before');
});

test('a past day logs the evening: playedOn at 20:00 that day, and the winner picker opens', async () => {
  const round = roundFixture();
  const opened = [];
  dom.set('showResults', (r, s) => opened.push(s.id));
  await dom.call('startDirectSession', round, round.games[0]);
  const sheet = dom.document.querySelector('.sheet');
  const yesterday = day(-1);
  setDay(sheet.querySelector('.played-on__input'), yesterday);
  assert.match(sheet.querySelector('#startDirect').textContent, /Session nachtragen/, 'the button says what it does');

  const sent = recordApi(() => ({ session: { id: 's-past' }, games: round.games }));
  sheet.querySelector('#startDirect').click();
  await waitFor(() => opened.length, { label: 'the results screen opening' });
  assert.equal(sent[0].body.playedOn, dom.run(`playedOnInstant(${JSON.stringify(yesterday)})`));
  assert.equal(new Date(sent[0].body.playedOn).getHours(), 20);
  assert.equal(dom.run("takeResultPickerOpen('s-past')"), true, 'the one open question is who won');
  assert.equal(dom.run("takeResultPickerOpen('s-past')"), false, 'and only once');
});

test('a future or empty day is refused before anything is sent', async () => {
  const round = roundFixture();
  await dom.call('startDirectSession', round, round.games[0]);
  const sheet = dom.document.querySelector('.sheet');
  const sent = recordApi(() => ({}));
  for (const value of [day(2), '']) {
    toasts.length = 0;
    setDay(sheet.querySelector('.played-on__input'), value);
    sheet.querySelector('#startDirect').click();
    await flush();
    assert.equal(sent.length, 0, `nothing sent for ${JSON.stringify(value)}`);
    assert.equal(toasts[0] && toasts[0].tone, 'error');
  }
  dom.run('closeSheet()');
});

test('the Chronik offers „Session nachtragen" — shelf games only — and hands over dated yesterday', async () => {
  const round = roundFixture();
  dom.app.innerHTML = '';
  dom.call('renderChronikTab', round, []);
  const btn = dom.app.querySelector('.chronik-log');
  assert.ok(btn, 'the entry point is on the Chronik');
  btn.click();

  const sheet = dom.document.querySelector('.sheet');
  const titles = () => [...sheet.querySelectorAll('.log-pick li:not([hidden]) .log-pick__row')].map((b) => b.textContent.trim());
  assert.deepEqual(titles(), ['Azul', 'Catan'], 'retired and wished-for games are not offered');

  const search = sheet.querySelector('#logPickSearch');
  search.value = 'cat';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.deepEqual(titles(), ['Catan']);
  search.value = 'zzz';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.equal(sheet.querySelector('.log-pick__empty').hidden, false, 'an empty search says so');

  const handed = [];
  dom.set('startDirectSession', (r, g, opts) => handed.push({ title: g.title, dayKey: opts && opts.dayKey }));
  search.value = '';
  search.dispatchEvent(new dom.window.Event('input'));
  sheet.querySelector('.log-pick__row').click();
  await waitFor(() => handed.length, { label: 'the picker closing into the direct-play sheet' });
  assert.deepEqual(handed[0], { title: 'Azul', dayKey: day(-1) });
});

test('a shelf with nothing to log offers no entry point', () => {
  const round = roundFixture({ games: [{ id: 'g3', title: 'Agricola', retired: true }] });
  dom.app.innerHTML = '';
  dom.call('renderChronikTab', round, []);
  assert.equal(dom.app.querySelector('.chronik-log'), null);
});

test('a finished session offers „Datum ändern" and PATCHes the new day', async () => {
  const session = {
    id: 's1', createdAt: '2026-03-10T19:00:00.000Z', finishedAt: '2026-03-10T19:00:00.000Z',
    gameIds: ['g1'], memberIds: ['m1', 'm2'], votes: {}, done: true, finished: true,
    cancelled: false, winnerIds: [], chosenGameId: 'g1', chosenAt: '2026-03-10T19:00:00.000Z',
  };
  const round = roundFixture({ sessions: [session] });
  dom.set('showResults', realShowResults);
  dom.set('fetchRoundFresh', async () => round);
  recordApi(() => ({}));
  await dom.call('showResults', round, session, round.games);
  const btn = [...dom.app.querySelectorAll('.date-area button')];
  assert.equal(btn.length, 1, 'the footer offers the change');
  assert.match(btn[0].textContent, /Datum ändern/);

  btn[0].click();
  const sheet = dom.document.querySelector('.sheet');
  const input = sheet.querySelector('.played-on__input');
  assert.equal(input.value, dom.run(`localDayKey(new Date('${session.createdAt}'))`), 'opens on the session\'s own day');
  setDay(input, '2026-02-14');
  const reopened = [];
  dom.set('showResults', (r, s) => reopened.push(s.id));
  const sent = recordApi(() => ({}));
  sheet.querySelector('.sheet__actions .btn--primary').click();
  const patch = await waitFor(() => sent.find((c) => c.method === 'PATCH'), { label: 'the date PATCH' });
  assert.equal(patch.path, `/api/rounds/${round.id}/sessions/s1/date`);
  assert.equal(patch.body.playedOn, dom.run("playedOnInstant('2026-02-14')"));
  await waitFor(() => reopened.length, { label: 'the screen re-rendering from the server' });
});

test('a session that is not finished offers no date change', async () => {
  const session = {
    id: 's2', createdAt: '2026-03-10T19:00:00.000Z', gameIds: ['g1'], memberIds: ['m1', 'm2'],
    votes: {}, done: true, finished: false, cancelled: false, winnerIds: [], chosenGameId: 'g1',
  };
  const round = roundFixture({ sessions: [session] });
  dom.set('showResults', realShowResults);
  await dom.call('showResults', round, session, round.games);
  assert.equal(dom.app.querySelectorAll('.date-area button').length, 0);
});
