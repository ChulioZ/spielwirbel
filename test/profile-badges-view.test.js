'use strict';

/* The Spielerkarte's account-tier Abzeichen (#1389, X17.7), rendered through the
   jsdom harness (.claude/rules/testing-views-under-jsdom.md). Who RECEIVES
   `stats.badges` is the server's decision and is pinned in test/profile.test.js;
   this file pins what the card does with it — the four shared tiles under the
   figures, their words, the tap-open card, and nothing at all when the key is
   absent. The fixture is the real `accountBadges`, not a hand-written copy. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, translator, flush } = require('./support/dom');
const { accountBadges } = require('../public/js/achievements');

const t = translator('de');
const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const CREATED = '2025-03-10T12:00:00.000Z';

const STATS = {
  sessions: 41, wins: 11, winRate: 0.4, avgGiven: 3.5, rounds: 3, gamesPlayed: 9,
  favorite: [], favAvg: null, bestGames: [], bestScore: null,
};
const withBadges = (over = {}) => {
  const st = { ...STATS, ...over };
  return { ...st, badges: accountBadges({ sessions: st.sessions, wins: st.wins, rounds: st.rounds }, CREATED, NOW) };
};

function bootWith(t_, stats, over = {}) {
  const dom = loadApp();
  t_.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => 'user-me');
  dom.set('isDemoAccount', () => false);
  const body = {
    userId: 'user-lea', username: 'lea', avatar: null, createdAt: CREATED,
    self: false, friendship: 'friends', since: CREATED, events: [], stats, ...over,
  };
  dom.set('accountApi', async (method, url) => (/^\/profile\//.test(url) ? body : {}));
  return dom;
}

const tiles = (dom) => [...dom.app.querySelectorAll('.profile-card__badges .badge')];

test('a friend\'s card carries the four account tiles, under the figures', async (t_) => {
  const dom = bootWith(t_, withBadges());
  await dom.call('showProfile', 'lea');
  const row = dom.app.querySelector('.profile-card .profile-card__badges');
  assert.ok(row, 'no .profile-card__badges');
  assert.equal(row.previousElementSibling.className, 'member-card__figures', 'the row sits right under the totals');
  assert.deepEqual(tiles(dom).map((b) => b.dataset.key), ['accountSessions', 'accountWins', 'accountRounds', 'accountYears']);
  assert.deepEqual(tiles(dom).map((b) => b.dataset.state), ['earned', 'earned', 'earned', 'earned']);

  // The shared tile: the name with its tier, and the way to the next tier as its line.
  const [sessions, , , years] = tiles(dom);
  assert.equal(sessions.querySelector('.badge__tier'), null, 'the tier lives in the name alone');
  assert.equal(sessions.querySelector('.badge__name').textContent, `${t('badges.accountSessions.name')} 25`);
  assert.equal(sessions.querySelector('.badge__line').textContent, '41 / 100');
  // Jahre counts from the registration month, which is what its line says.
  assert.equal(years.querySelector('.badge__line').textContent, t('profile.memberSince', { when: 'März 2025' }));
  // The state is a word in the accessible name, never only the fill.
  assert.match(sessions.getAttribute('aria-label'), /verdient/);
});

test('a tile opens the badge card, which names the holder and every tier', async (t_) => {
  const dom = bootWith(t_, withBadges());
  // jsdom has no matchMedia; a phone width, so the card is a sheet.
  dom.run('window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });');
  await dom.call('showProfile', 'lea');
  tiles(dom)[0].click();
  await flush();
  const card = dom.document.querySelector('.badge-card');
  assert.ok(card, 'no badge card opened');
  assert.equal(card.querySelector('.badge-card__holder').textContent, 'lea');
  assert.deepEqual([...card.querySelectorAll('.badge-card__tier')].map((li) => li.textContent.trim().split(',')[0]),
    ['25', '100', '500']);
});

test('Jahre 1 takes the singular condition („1 Jahr")', async (t_) => {
  // A fresh account: Jahre is still open, so its condition talks about year one.
  const young = { ...STATS, badges: accountBadges({ sessions: 41, wins: 11, rounds: 3 }, '2026-06-01T00:00:00.000Z', NOW) };
  const dom = bootWith(t_, young, { createdAt: null });
  await dom.call('showProfile', 'lea');
  const years = tiles(dom)[3];
  assert.equal(years.dataset.state, 'locked');
  assert.equal(years.querySelector('.badge__line').textContent, t('badges.accountYears.lineOne', { n: 1 }));
  assert.notEqual(t('badges.accountYears.lineOne', { n: 1 }), t('badges.accountYears.line', { n: 1 }), 'control: the two forms differ');
});

test('no `badges` key — a demo, or a payload from before #1389 — means no row', async (t_) => {
  const dom = bootWith(t_, { ...STATS });
  await dom.call('showProfile', 'lea');
  assert.ok(dom.app.querySelector('.member-card__figures'), 'control: the card itself rendered');
  assert.equal(dom.app.querySelector('.profile-card__badges'), null);
});

test('an empty record shows the row only once something is earned', async (t_) => {
  const empty = { sessions: 0, wins: 0, winRate: null, avgGiven: null, rounds: 0, gamesPlayed: 0,
    favorite: [], favAvg: null, bestGames: [], bestScore: null };
  const none = bootWith(t_, { ...empty, badges: accountBadges(empty, '2026-09-01T00:00:00.000Z', NOW) });
  await none.call('showProfile', 'lea');
  assert.ok(none.app.querySelector('.profile-card .empty-note'), 'control: the empty record rendered');
  assert.equal(none.app.querySelector('.profile-card__badges'), null, 'four open tiles say nothing');

  const veteran = bootWith(t_, { ...empty, badges: accountBadges(empty, CREATED, NOW) });
  await veteran.call('showProfile', 'lea');
  assert.equal(veteran.app.querySelectorAll('.profile-card__badges .badge').length, 4, 'Jahre 1 is earned');
});
