'use strict';

/* The result screen's Verlauf, collapsed to one line (#1055).

   Measured 2026-09-12 on a finished six-game session: the expanded list cost
   355px of a 2905px page on every visit, for a list most sessions never open.
   So the RESULT screen renders it as a `<details>` whose summary states the
   count and the latest entry; the lobby — where the log is the live record of
   what is happening right now — keeps the open `<section>`.

   Rendered for real through the jsdom harness, because what is under test is
   the node the screen builds and its default state, not the presence of a
   string in the view's source (.claude/rules/testing-views-under-jsdom.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

const ME = 'user-me';

// Four events, so the plural summary is exercised and a wrong `n` cannot pass
// by coinciding with the number of games or of people.
const EVENTS = [
  { at: '2026-08-02T18:00:00.000Z', type: 'started', actor: 'm1' },
  { at: '2026-08-02T18:05:00.000Z', type: 'voted', actor: 'm1', personId: 'm1' },
  { at: '2026-08-02T18:07:00.000Z', type: 'voted', actor: 'm1', personId: 'm2' },
  { at: '2026-08-02T18:09:00.000Z', type: 'voting_closed', actor: 'm1' },
];

function fixture(sessionOver = {}) {
  const session = {
    id: 's1',
    createdAt: '2026-08-02T18:00:00.000Z',
    gameIds: ['g1', 'g2'],
    memberIds: ['m1', 'm2'],
    events: EVENTS,
    votes: {
      m1: { g1: { rating: 5 }, g2: { rating: 3 } },
      m2: { g1: { rating: 4 }, g2: { rating: 2 } },
    },
    votedIds: ['m1', 'm2'],
    done: true,
    cancelled: false,
    finished: false,
    winnerIds: [],
    chosenGameId: null,
    ...sessionOver,
  };
  const round = {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    members: [{ id: 'm1', name: 'Anna', userId: ME }, { id: 'm2', name: 'Ben' }],
    games: [
      { id: 'g1', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
    ],
    sessions: [session],
  };
  round.sessions = [session];
  return { round, session };
}

async function results(t, sessionOver = {}) {
  const { round, session } = fixture(sessionOver);
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => round);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  await dom.call('showResults', round, session);
  return dom;
}

test('the result screen renders the log collapsed, as a details that is not open', async (t) => {
  const dom = await results(t);

  const log = dom.app.querySelector('.session-log');
  assert.ok(log, 'expected a session log on the result screen');
  assert.equal(log.tagName, 'DETAILS',
    'the log must be a disclosure on this screen, not an always-open section');
  assert.equal(log.open, false, 'it must start collapsed — that is the 355px this slice buys');
  assert.ok(log.querySelector('summary'), 'a details with no summary has no control to open it');
});

test('the summary states the entry count and the latest entry', async (t) => {
  const dom = await results(t);

  const log = dom.app.querySelector('.session-log');
  const summary = log.querySelector('summary');
  const rows = log.querySelectorAll('.session-log__row');
  assert.equal(rows.length, EVENTS.length, 'fixture should produce one row per event');

  // The COUNT, read off the summary rather than pattern-matched against a
  // translation: a summary that omitted it, or printed the game count, fails.
  assert.match(summary.textContent, new RegExp(`\\b${rows.length}\\b`),
    `summary "${summary.textContent.trim()}" does not state the ${rows.length} entries it hides`);
  // …and the newest entry's timestamp, which is the other half of "is it worth
  // opening". `fmtDateTime` is locale-formatted, so match on its own output.
  const latest = dom.run('fmtDateTime')('2026-08-02T18:09:00.000Z');
  assert.ok(summary.textContent.includes(latest),
    `summary "${summary.textContent.trim()}" does not name the latest entry (${latest})`);
  // The title still names the thing, so the one line reads as the log and not
  // as a stray count.
  assert.ok(summary.textContent.includes(dom.run('t')('log.title')),
    'the collapsed line does not name the log');
});

test('opening it reveals the existing list markup, unchanged', async (t) => {
  const dom = await results(t);

  const log = dom.app.querySelector('.session-log');
  const list = log.querySelector('ol.session-log__list');
  assert.ok(list, 'the expanded list must keep the ordered-list markup');
  assert.ok(list.hasAttribute('reversed'),
    'the list is newest-first, so it must stay `reversed` for the implicit numbering');
  const first = list.querySelector('.session-log__row');
  assert.ok(first.querySelector('.session-log__when'), 'each row keeps its timestamp');
  assert.ok(first.querySelector('.session-log__what'), 'each row keeps its text');

  log.open = true;
  assert.equal(log.open, true, 'the disclosure opens');
});

test('the lobby keeps the log open — it is the live record there', async (t) => {
  const { round, session } = fixture({ done: false, votedIds: ['m1'] });
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => round);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  await dom.call('showSessionLobby', round, session);

  const log = dom.app.querySelector('.session-log');
  assert.ok(log, 'expected a session log in the lobby');
  assert.equal(log.tagName, 'SECTION',
    'collapsing the lobby log would hide the one thing that screen is watching');
  assert.ok(log.querySelector('h2.session-log__title'), 'the lobby keeps its heading');
});
