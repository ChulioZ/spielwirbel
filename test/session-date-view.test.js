'use strict';

/*
 * The three ways into a session's day (#1616), run as real screens:
 *  - the direct-play sheet's „Wann?" field — today sends NOTHING new, a past
 *    day sends `playedOn` and lands with the winner picker open;
 *  - the Chronik's „Session nachtragen" — shelf games only, then the same sheet
 *    dated yesterday;
 *  - „Datum ändern" on a finished session's results — PATCHes the day;
 *  - the optional TIME beside the day (#1629): sent with `dateOnly: false`,
 *    refused when still ahead, emptied by its ✕ — and a date-only session
 *    shown without the stand-in 20:00.
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
// Same for the direct-play sheet, which the Chronik test replaces with a recorder.
const realStartDirect = dom.get('startDirectSession');
const toasts = [];
dom.set('toast', (msg, opts) => toasts.push({ msg, tone: opts && opts.tone }));

const plain = (o) => JSON.parse(JSON.stringify(o));
// Calendar days, not 24-hour steps, which slip a day around a DST change.
const day = (offset) => dom.run(`(() => { const d = new Date(); d.setDate(d.getDate() + ${offset}); return localDayKey(d); })()`);

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
  // The area also holds „Punkte eintragen" since #1630.
  const btn = [...dom.app.querySelectorAll('.date-area button')].filter((b) => /Datum ändern/.test(b.textContent));
  assert.equal(btn.length, 1, 'the footer offers the change');

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
  // A session stamped by the app has a REAL time, so the sheet opens with it and
  // moving only the day keeps it (#1629) — not the 20:00 stand-in.
  const own = dom.run(`localTimeKey(new Date('${session.createdAt}'))`);
  assert.equal(sheet.querySelector('.played-on__time').value, own, 'opens on the session\'s own time');
  assert.equal(patch.body.playedOn, dom.run(`playedOnInstant('2026-02-14', new Date(), '${own}')`));
  assert.equal(patch.body.dateOnly, false);
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

// ---- The optional time (#1629) ----

const openDirect = async (round) => {
  dom.set('startDirectSession', realStartDirect);
  await dom.call('startDirectSession', round, round.games[0]);
  return dom.document.querySelector('.sheet');
};
const setTime = (sheet, value) => {
  const input = sheet.querySelector('.played-on__time');
  input.value = value;
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};
// 'HH:MM' some minutes away from now, on today's clock. Null when that crosses
// midnight, so a spec run at 00:05 skips rather than testing yesterday.
const timeFromNow = (minutes) => dom.run(`(() => {
  const d = new Date(Date.now() + ${minutes} * 60000);
  return localDayKey(d) === localDayKey(new Date()) ? localTimeKey(d) : null;
})()`);

test('the time starts empty, and its ✕ appears only while there is a time to empty', async () => {
  const round = roundFixture();
  const sheet = await openDirect(round);
  const time = sheet.querySelector('.played-on__time');
  const clear = sheet.querySelector('.played-on__clear');
  assert.equal(time.value, '');
  assert.ok(time.getAttribute('aria-label'), 'the time input is labelled');
  assert.equal(clear.hidden, true);
  // Not a .link-btn: a design restyling that class with a `display` would beat
  // the ✕'s [hidden] rule and show it beside an empty field (Der Tisch did).
  assert.equal(clear.classList.contains('link-btn'), false);
  setTime(sheet, '18:00');
  assert.equal(clear.hidden, false);
  clear.click();
  assert.equal(time.value, '');
  assert.equal(clear.hidden, true);
  dom.run('closeSheet()');
});

test('today with an EARLIER time logs the evening at that time, born finished', async (t) => {
  const earlier = timeFromNow(-90);
  if (!earlier) return t.skip('too close to midnight');
  const round = roundFixture();
  const opened = [];
  dom.set('showResults', (r, s) => opened.push(s.id));
  const sheet = await openDirect(round);
  setTime(sheet, earlier);
  assert.match(sheet.querySelector('#startDirect').textContent, /Session nachtragen/, 'a time means it already happened');

  const sent = recordApi(() => ({ session: { id: 's-timed' }, games: round.games }));
  sheet.querySelector('#startDirect').click();
  await waitFor(() => opened.length, { label: 'the results screen opening' });
  assert.equal(sent[0].body.playedOn, dom.run(`playedOnInstant(localDayKey(new Date()), new Date(), '${earlier}')`));
  assert.equal(sent[0].body.dateOnly, false);
  assert.equal(dom.run("takeResultPickerOpen('s-timed')"), true);
});

test('a past day without a time is sent as date-only; emptying the time puts „today" back', async () => {
  const round = roundFixture();
  const opened = [];
  dom.set('showResults', (r, s) => opened.push(s.id));
  const sheet = await openDirect(round);
  setTime(sheet, '00:01');
  assert.match(sheet.querySelector('#startDirect').textContent, /Session nachtragen/);
  sheet.querySelector('.played-on__clear').click();
  assert.match(sheet.querySelector('#startDirect').textContent, /Los geht/, 'today and no time is the ordinary start again');

  setDay(sheet.querySelector('.played-on__input'), day(-3));
  const sent = recordApi(() => ({ session: { id: 's-day' }, games: round.games }));
  sheet.querySelector('#startDirect').click();
  await waitFor(() => opened.length, { label: 'the results screen opening' });
  assert.equal(sent[0].body.dateOnly, true);
  assert.equal(new Date(sent[0].body.playedOn).getHours(), 20);
});

test('a time still ahead today is refused before anything is sent', async (t) => {
  const later = timeFromNow(90);
  if (!later) return t.skip('too close to midnight');
  const round = roundFixture();
  const sheet = await openDirect(round);
  setTime(sheet, later);
  const sent = recordApi(() => ({}));
  toasts.length = 0;
  sheet.querySelector('#startDirect').click();
  await flush();
  assert.equal(sent.length, 0);
  assert.equal(toasts[0].tone, 'error');
  assert.match(toasts[0].msg, /Uhrzeit/, 'it says the TIME is the problem');
  dom.run('closeSheet()');
});

const datedSession = (over) => ({
  id: 'sd', gameIds: ['g1'], memberIds: ['m1', 'm2'], votes: {}, done: true, finished: true,
  cancelled: false, winnerIds: [], chosenGameId: 'g1', ...over,
});

test('„Datum ändern" on a date-only session opens with NO time and keeps it date-only', async () => {
  const at = dom.run("playedOnInstant('2026-03-10')");
  const session = datedSession({ id: 'sd1', createdAt: at, finishedAt: at, chosenAt: at, dateOnly: true });
  const round = roundFixture({ sessions: [session] });
  dom.set('showResults', realShowResults);
  dom.set('fetchRoundFresh', async () => round);
  recordApi(() => ({}));
  await dom.call('showResults', round, session, round.games);
  [...dom.app.querySelectorAll('.date-area button')].find((b) => /Datum ändern/.test(b.textContent)).click();
  const sheet = dom.document.querySelector('.sheet');
  assert.equal(sheet.querySelector('.played-on__time').value, '', 'no stand-in 20:00 in the field');

  // Untouched, „Übernehmen" changes nothing at all.
  const sent = recordApi(() => ({}));
  sheet.querySelector('.sheet__actions .btn--primary').click();
  await flush();
  assert.equal(sent.filter((c) => c.method === 'PATCH').length, 0);

  // A time added turns it into a timed session.
  dom.set('showResults', () => {});
  setTime(sheet, '19:15');
  sheet.querySelector('.sheet__actions .btn--primary').click();
  const patch = await waitFor(() => sent.find((c) => c.method === 'PATCH'), { label: 'the date PATCH' });
  assert.equal(patch.body.playedOn, dom.run("playedOnInstant('2026-03-10', new Date(), '19:15')"));
  assert.equal(patch.body.dateOnly, false);
});

test('a date-only session shows NO time in the Chronik or on its results; a timed one does', async () => {
  const plain = dom.run("playedOnInstant('2026-03-01')");
  const timed = dom.run("playedOnInstant('2026-03-02', new Date(), '18:35')");
  const legacyAt = dom.run("playedOnInstant('2026-03-03')");
  const sessions = [
    datedSession({ id: 'p1', createdAt: plain, finishedAt: plain, chosenAt: plain, dateOnly: true }),
    datedSession({ id: 't1', createdAt: timed, finishedAt: timed, chosenAt: timed, dateOnly: false,
      events: [{ type: 'logged', at: timed }] }),
    // Logged before #1629: no marker, only its `logged` entry.
    datedSession({ id: 'l1', createdAt: legacyAt, finishedAt: legacyAt, chosenAt: legacyAt,
      events: [{ type: 'logged', at: legacyAt }] }),
  ];
  const round = roundFixture({ sessions });
  // One session per render, so each card's meta line is that session's alone.
  const metaOf = (session) => {
    dom.app.innerHTML = '';
    dom.call('renderChronikTab', { ...round, sessions: [session] }, []);
    const meta = dom.app.querySelector('.session-card .session-card__meta');
    assert.ok(meta, `the Chronik renders ${session.id}`);
    return meta.textContent;
  };
  const clock = /\b\d{1,2}:\d{2}\b/;
  assert.doesNotMatch(metaOf(sessions[0]), clock, 'no stand-in time on a date-only session');
  assert.doesNotMatch(metaOf(sessions[2]), clock, 'nor on one logged before the marker existed');
  assert.match(metaOf(sessions[1]), /18:35/, 'an entered time is shown');
  assert.match(metaOf(sessions[0]), /2026/, 'the date itself is still there');

  dom.set('showResults', realShowResults);
  await dom.call('showResults', round, sessions[0], round.games);
  assert.doesNotMatch(dom.app.querySelector('.result-screen').textContent, /20:00/);
  await dom.call('showResults', round, sessions[1], round.games);
  assert.match(dom.app.querySelector('.result-screen').textContent, /18:35/);
});
