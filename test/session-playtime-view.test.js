'use strict';

/*
 * A session's playing time on screen (#1770), run as real views under jsdom:
 *  - the results band says „Läuft seit … Min." while the game is on the table,
 *    read off the stored start, and nothing for a session that has none;
 *  - a played session shows „Gespielt: … Min." and offers „Spieldauer ändern"
 *    (or „eintragen") behind „Mehr", whose sheet PUTs the figure or null;
 *  - choosing a game copies the server's start onto the screen;
 *  - „Session nachtragen" asks for the minutes only while it LOGS;
 *  - the Spielepass prints the round's median from the second timed play on.
 * The server half is test/session-duration-route.test.js.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, waitFor } = require('./support/dom');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
const realShowResults = dom.get('showResults');
const toasts = [];
dom.set('toast', (msg, opts) => toasts.push({ msg, tone: opts && opts.tone }));

const plain = (o) => JSON.parse(JSON.stringify(o));
const day = (offset) => dom.run(`(() => { const d = new Date(); d.setDate(d.getDate() + ${offset}); return localDayKey(d); })()`);
const minutesAgo = (m) => new Date(Date.now() - m * 60000 - 5000).toISOString();

let rid = 0;
const roundFixture = (over = {}) => ({
  id: `r${++rid}`,
  name: 'Freitagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: [
    { id: 'g1', title: 'Catan', minPlayers: 2, maxPlayers: 4, minPlaytime: 60, maxPlaytime: 60 },
    { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4 },
  ],
  sessions: [],
  ...over,
});
const sessionFixture = (over = {}) => ({
  id: 's1', createdAt: '2026-03-10T19:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1', 'm2'],
  votes: {}, done: true, finished: false, cancelled: false, winnerIds: [],
  chosenGameId: 'g1', chosenAt: '2026-03-10T19:00:00.000Z', ...over,
});

function recordApi(reply = () => ({})) {
  const sent = [];
  dom.set('api', (method, path, body) => {
    sent.push({ method, path, body: body && plain(body) });
    return Promise.resolve(reply(method, path, body));
  });
  return sent;
}

function mehrItem(re) {
  const more = dom.app.querySelector('.result-foot__more');
  if (!more) return undefined;
  more.click();
  const pops = dom.document.querySelectorAll('.popover--menu');
  const opt = [...pops[pops.length - 1].querySelectorAll('.popover__opt')].find((b) => re.test(b.textContent));
  if (!opt) dom.run('closePopover()');
  return opt;
}

async function results(session, round = roundFixture({ sessions: [session] })) {
  dom.set('showResults', realShowResults);
  dom.set('fetchRoundFresh', async () => round);
  await dom.call('showResults', round, session, round.games);
  return round;
}

const timerText = () => {
  const el = dom.app.querySelector('.tisch__note--timer');
  return el ? el.textContent.trim() : null;
};
const durationText = () => {
  const el = dom.app.querySelector('.tisch__note--duration');
  return el ? el.textContent.trim() : null;
};

test('a game on the table shows how long it has been running', async () => {
  recordApi();
  await results(sessionFixture({ startedPlayingAt: minutesAgo(42) }));
  assert.equal(timerText(), 'Läuft seit 42 Min.');
  assert.equal(durationText(), null);
});

test('a running session with no stored start shows no timer', async () => {
  recordApi();
  await results(sessionFixture());
  assert.equal(timerText(), null);
});

test('choosing a game takes the server\'s start and starts the line', async () => {
  const start = minutesAgo(3);
  recordApi((method, path) => (/\/choice$/.test(path) ? { startedPlayingAt: start } : {}));
  await results(sessionFixture({ chosenGameId: null, chosenAt: null }));
  assert.equal(timerText(), null, 'nothing on the table yet');
  const play = dom.app.querySelector('.play-btn');
  play.click();
  await waitFor(() => timerText(), { label: 'the timer line after the choice' });
  assert.equal(timerText(), 'Läuft seit 3 Min.');
});

test('a played session shows its minutes and offers to change them', async () => {
  recordApi();
  await results(sessionFixture({ finished: true, finishedAt: '2026-03-10T21:00:00.000Z', durationMinutes: 110 }));
  assert.equal(timerText(), null, 'the clock stopped');
  assert.equal(durationText(), 'Gespielt: 110 Min.');
  assert.ok(mehrItem(/Spieldauer ändern/), '„Mehr" offers the change');
});

test('an untimed played session offers „Spieldauer eintragen", and the sheet PUTs the figure', async () => {
  recordApi();
  const round = await results(sessionFixture({ finished: true, finishedAt: '2026-03-10T21:00:00.000Z' }));
  assert.equal(durationText(), null);
  const item = mehrItem(/Spieldauer eintragen/);
  assert.ok(item);
  item.click();
  const sheet = dom.document.querySelector('.sheet');
  const input = sheet.querySelector('.duration-field__input');
  assert.equal(input.value, '', 'nothing recorded, nothing prefilled');
  input.value = '95';
  const reopened = [];
  dom.set('showResults', (r, s) => reopened.push(s.id));
  const sent = recordApi();
  sheet.querySelector('.sheet__actions .btn--primary').click();
  const put = await waitFor(() => sent.find((c) => c.method === 'PUT'), { label: 'the duration PUT' });
  assert.equal(put.path, `/api/rounds/${round.id}/sessions/s1/duration`);
  assert.deepEqual(put.body, { durationMinutes: 95 });
  await waitFor(() => reopened.length, { label: 'the re-render from the server' });
});

test('emptying the field clears the minutes; a figure out of bounds sends nothing', async () => {
  recordApi();
  await results(sessionFixture({ finished: true, finishedAt: '2026-03-10T21:00:00.000Z', durationMinutes: 60 }));
  mehrItem(/Spieldauer ändern/).click();
  let sheet = dom.document.querySelector('.sheet');
  assert.equal(sheet.querySelector('.duration-field__input').value, '60', 'the recorded figure is prefilled');
  sheet.querySelector('.duration-field__input').value = '';
  dom.set('showResults', () => {});
  let sent = recordApi();
  sheet.querySelector('.sheet__actions .btn--primary').click();
  const put = await waitFor(() => sent.find((c) => c.method === 'PUT'), { label: 'the clearing PUT' });
  assert.deepEqual(put.body, { durationMinutes: null });

  await results(sessionFixture({ finished: true, finishedAt: '2026-03-10T21:00:00.000Z', durationMinutes: 60 }));
  mehrItem(/Spieldauer ändern/).click();
  sheet = dom.document.querySelector('.sheet');
  sheet.querySelector('.duration-field__input').value = '0';
  toasts.length = 0;
  sent = recordApi();
  sheet.querySelector('.sheet__actions .btn--primary').click();
  await waitFor(() => toasts.length, { label: 'the refusal toast' });
  assert.equal(toasts[0].tone, 'error');
  assert.equal(sent.filter((c) => c.method === 'PUT').length, 0);
});

test('parseDurationInput reads what the route accepts', () => {
  // Through JSON: an object built in the app's realm has another Object.prototype.
  const parse = (v) => JSON.parse(dom.run(`JSON.stringify(parseDurationInput('${v}'))`));
  assert.deepEqual(parse(''), { value: null });
  assert.deepEqual(parse(' 90 '), { value: 90 });
  assert.deepEqual(parse('1440'), { value: 1440 });
  for (const bad of ['0', '1441', '9.5', '-3', 'abc']) assert.deepEqual(parse(bad), { error: true }, bad);
});

test('„Session nachtragen" asks for the minutes only while it logs, and sends them', async () => {
  const round = roundFixture();
  dom.set('showResults', () => {});
  await dom.call('startDirectSession', round, round.games[0]);
  const sheet = dom.document.querySelector('.sheet');
  assert.equal(sheet.querySelector('.duration-field'), null, 'playing now is timed, not typed');
  const input = sheet.querySelector('.played-on__input');
  input.value = day(-2);
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const field = sheet.querySelector('.duration-field__input');
  assert.ok(field, 'a logged evening asks for the minutes');
  field.value = '80';
  const sent = recordApi(() => ({ session: { id: 'new', ...sessionFixture({ finished: true }) }, games: round.games }));
  sheet.querySelector('#startDirect').click();
  const post = await waitFor(() => sent.find((c) => c.method === 'POST'), { label: 'the create POST' });
  assert.equal(post.body.durationMinutes, 80);
  assert.ok(post.body.playedOn);

  input.value = day(0);
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(sheet.querySelector('.duration-field'), null, 'and drops the field again for today');
  dom.run('closeSheet()');
});

test('the Spielepass prints the round\'s median from the second timed play on', async () => {
  const played = (id, min) => sessionFixture({ id, gameIds: ['g1'], finished: true, durationMinutes: min });
  const round = roundFixture({ sessions: [played('a', 100)] });
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    return {};
  });
  const ownNote = () => {
    const el = dom.app.querySelector('.gd-facts .fact__note--own');
    return el ? el.textContent : null;
  };
  await dom.call('showGameDetail', round.id, 'g1');
  assert.equal(ownNote(), null, 'one timed play is not „bei euch" yet');
  round.sessions.push(played('b', 121));
  await dom.call('showGameDetail', round.id, 'g1');
  assert.equal(ownNote(), 'Bei euch: ~110 Min.');
  const pill = dom.app.querySelector('.gd-facts .fact__note--own').closest('.fact');
  assert.equal(pill.querySelector('.fact__value').textContent, '60 Min.', 'the box figure stays the value');
});

test('with no box figure, the round\'s own duration is the pill\'s value', async () => {
  const played = (id, min) => sessionFixture({ id, gameIds: ['g2'], chosenGameId: 'g2', finished: true, durationMinutes: min });
  const round = roundFixture({ sessions: [played('a', 30), played('b', 40)] });
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    return {};
  });
  await dom.call('showGameDetail', round.id, 'g2');
  const values = [...dom.app.querySelectorAll('.gd-facts .fact__value')].map((v) => v.textContent);
  assert.ok(values.includes('Bei euch: ~35 Min.'), values.join(' | '));
});
