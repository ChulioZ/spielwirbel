'use strict';

/* Hours played (#1772): the recorded session durations (#1770) summed into the
 * Chronik's period recap and its share card, and the round's longest timed
 * session as a Pokale card.
 *
 * The pure halves (sessionsPlayTime, longestSession) are required from
 * session-duration.js; the two screens run through the jsdom harness
 * (.claude/rules/testing-views-under-jsdom.md). The per-design share cards are
 * covered in each test/recap-card-*.test.js. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sessionsPlayTime, longestSession } = require('../public/js/session-duration');
const { loadApp } = require('./support/dom');

const RID = 'r1';

const played = (id, gid, at, durationMinutes, extra = {}) => ({
  id,
  createdAt: at,
  gameIds: ['g1', 'g2'],
  memberIds: ['m1', 'm2'],
  votes: {},
  votedIds: [],
  finished: true,
  cancelled: false,
  done: true,
  winnerIds: ['m1'],
  chosenGameId: gid,
  events: [],
  ...(durationMinutes == null ? {} : { durationMinutes }),
  ...extra,
});

const GAMES = [
  { id: 'g1', title: 'Catan', tagIds: [] },
  { id: 'g2', title: 'Azul', tagIds: [] },
];

// ---- the pure helpers ----------------------------------------------------

test('sessionsPlayTime sums only recorded durations and reports the coverage', () => {
  const t = sessionsPlayTime([
    played('a', 'g1', '2026-07-01T20:00:00.000Z', 90),
    played('b', 'g1', '2026-07-02T20:00:00.000Z', 45),
    played('c', 'g1', '2026-07-03T20:00:00.000Z', null),
    // Not real minutes: out of range, and a non-integer.
    played('d', 'g1', '2026-07-04T20:00:00.000Z', 5000),
    played('e', 'g1', '2026-07-05T20:00:00.000Z', 12.5),
    // Not played at all.
    played('f', 'g1', '2026-07-06T20:00:00.000Z', 60, { cancelled: true }),
    played('g', 'g1', '2026-07-07T20:00:00.000Z', 60, { finished: false }),
  ]);
  assert.deepEqual(t, { minutes: 135, timed: 2, played: 5 });
  assert.deepEqual(sessionsPlayTime([]), { minutes: 0, timed: 0, played: 0 });
  assert.deepEqual(sessionsPlayTime(undefined), { minutes: 0, timed: 0, played: 0 });
});

test('longestSession picks the longest timed session whose game still exists', () => {
  const sessions = [
    played('a', 'g1', '2026-07-01T20:00:00.000Z', 90),
    played('b', 'g2', '2026-07-02T20:00:00.000Z', 120),
    // Longer, but its game is gone — the card would have nothing to name.
    played('c', 'gone', '2026-07-03T20:00:00.000Z', 300),
    // Longer, but cancelled.
    played('d', 'g1', '2026-07-04T20:00:00.000Z', 200, { cancelled: true }),
    played('e', 'g1', '2026-07-05T20:00:00.000Z', null),
  ];
  assert.equal(longestSession(sessions, GAMES).id, 'b');
  assert.equal(longestSession([played('x', 'g1', '2026-07-01T20:00:00.000Z', null)], GAMES), null);
  assert.equal(longestSession([], GAMES), null);
});

test('longestSession breaks a tie toward the most recent session', () => {
  const older = played('old', 'g1', '2026-07-01T20:00:00.000Z', 120);
  const newer = played('new', 'g2', '2026-08-01T20:00:00.000Z', 120);
  assert.equal(longestSession([older, newer], GAMES).id, 'new');
  assert.equal(longestSession([newer, older], GAMES).id, 'new', 'independent of input order');
});

// ---- the screens -----------------------------------------------------------

function boot(t, round) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

const roundWith = (sessions) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: GAMES,
  sessions,
});

const timeChip = (dom) => dom.app.querySelector('.precap .precap__time');

test('the period recap says how long the period was played, and from how many sessions', async (t) => {
  const dom = boot(t, roundWith([
    played('s1', 'g1', '2026-07-01T20:00:00.000Z', 90),
    played('s2', 'g1', '2026-07-02T20:00:00.000Z', 60),
    played('s3', 'g2', '2026-07-03T20:00:00.000Z', null),
  ]));
  await dom.call('showRound', RID, 'chronik');
  const chip = timeChip(dom);
  assert.ok(chip, 'the hours chip is missing from a period with timed sessions');
  const time = dom.run("t('periodRecap.hoursValue', { h: '2,5' })");
  const note = dom.run("t('periodRecap.timedPartial', { n: 2, total: 3 })");
  assert.equal(chip.textContent, `${dom.run(`t('periodRecap.hoursPlayed', { time: ${JSON.stringify(time)} })`)} · ${note}`);
});

test('the coverage note is dropped when every played session is timed', async (t) => {
  const dom = boot(t, roundWith([
    played('s1', 'g1', '2026-07-01T20:00:00.000Z', 600),
    played('s2', 'g1', '2026-07-02T20:00:00.000Z', 30),
  ]));
  await dom.call('showRound', RID, 'chronik');
  // 630 min = 10.5 h, at or past ten hours shown whole.
  const time = dom.run("t('periodRecap.hoursValue', { h: '11' })");
  assert.equal(timeChip(dom).textContent, dom.run(`t('periodRecap.hoursPlayed', { time: ${JSON.stringify(time)} })`));
});

test('a period with no timed session shows no hours at all', async (t) => {
  const dom = boot(t, roundWith([played('s1', 'g1', '2026-07-01T20:00:00.000Z', null)]));
  await dom.call('showRound', RID, 'chronik');
  assert.ok(dom.app.querySelector('.precap'), 'the recap itself still renders');
  assert.equal(timeChip(dom), null);
});

test('„Teilen" hands the card the same hours line the screen shows', async (t) => {
  const dom = boot(t, roundWith([
    played('s1', 'g1', '2026-07-01T20:00:00.000Z', 90),
    played('s2', 'g1', '2026-07-02T20:00:00.000Z', null),
  ]));
  const seen = [];
  dom.set('canShareRecapImage', () => true);
  dom.set('shareRecapCard', (period, model) => { seen.push(model); });
  await dom.call('showRound', RID, 'chronik');
  dom.app.querySelector('.precap__share').click();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].timePlayed, dom.run("t('periodRecap.hoursValue', { h: '1,5' })"));
  assert.equal(seen[0].timedNote, dom.run("t('periodRecap.timedPartial', { n: 1, total: 2 })"));
});

const longestCard = (dom) =>
  [...dom.app.querySelectorAll('.pokale-card')].find(
    (c) => (c.querySelector('.pokale-card__label') || {}).textContent === dom.run("t('pokale.longest')")
  );

test('Pokale names the longest session from the first timed one', async (t) => {
  const sessions = [
    played('s1', 'g1', '2026-07-01T20:00:00.000Z', 95),
    played('s2', 'g2', '2026-07-02T20:00:00.000Z', null),
  ];
  const dom = boot(t, roundWith(sessions));
  await dom.call('showRound', RID, 'pokale');
  const card = longestCard(dom);
  assert.ok(card, 'the Längste Session card is missing');
  assert.equal(card.querySelector('.pokale-game__title').textContent, 'Catan');
  assert.equal(
    card.querySelector('.pokale-card__sub').textContent,
    `${dom.run('fmtPlayMinutes(95)')} · ${dom.run("fmtDate('2026-07-01T20:00:00.000Z')")}`
  );
});

test('Pokale has no longest-session card without a timed session — deleting it removes the card', async (t) => {
  const dom = boot(t, roundWith([played('s2', 'g2', '2026-07-02T20:00:00.000Z', null)]));
  await dom.call('showRound', RID, 'pokale');
  assert.ok(dom.app.querySelector('.pokale-card'), 'other Pokale cards still render');
  assert.equal(longestCard(dom), undefined);
});

test('the classic share card adds the hours row, and only when the model carries one', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const blocks = (model) => JSON.parse(dom.run(`JSON.stringify(recapCardBlocks(${JSON.stringify(model)}))`));
  const base = { heading: 'R', periodLabel: 'Juli 2026', sessions: 3, gamesPlayed: 2, played: ['Catan'], playedSub: '2 Sessions', rated: [], shelf: [] };
  assert.equal(blocks(base).rows.length, 1, 'no timePlayed, no row — the account recap draws what it did');
  const rows = blocks({ ...base, timePlayed: '2,5 Std.', timedNote: 'aus 2 von 3 Sessions' }).rows;
  assert.deepEqual(rows[1], { label: dom.run("t('periodRecap.label.timePlayed')"), value: '2,5 Std.', sub: 'aus 2 von 3 Sessions' });
});
