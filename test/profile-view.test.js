'use strict';

/* The profile screen's own rendering (#1089) — the self branch in particular.
 *
 * Rendered through the jsdom harness rather than matched over the view source
 * (`.claude/rules/testing-views-under-jsdom.md`): three of the four things
 * pinned here are the ABSENCE of a node — no „Das bist du." line, no stat tiles
 * on an empty record, no friend-facing note on your own profile — which a regex
 * over the view cannot see at all.
 *
 * The payload is stubbed at `accountApi` rather than driven over HTTP: what the
 * server decides to SEND (who may see `stats`, and when) is pinned in
 * test/profile.test.js, and re-asserting it here would be the same guarantee
 * measured twice in the weaker place.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, translator } = require('./support/dom');

const t = translator('de');

const STATS = {
  sessions: 12,
  wins: 5,
  winRate: 0.5,
  winScore: 2.5,
  avgGiven: 3.75,
  rounds: 3,
  gamesPlayed: 9,
  favorite: [{ title: 'Azul', image: null }],
  favAvg: 5,
  bestGames: [{ title: 'Carcassonne', image: null }, { title: 'Codenames', image: null }],
  bestScore: 1.5,
};

const EMPTY = {
  sessions: 0, wins: 0, winRate: null, winScore: 0, avgGiven: null,
  rounds: 0, gamesPlayed: 0, favorite: [], favAvg: null, bestGames: [], bestScore: null,
};

/** A booted app whose profile fetch answers `body`. */
function bootWith(t_, body) {
  const dom = loadApp();
  t_.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => 'user-me');
  dom.set('accountApi', async (method, url) => {
    if (/^\/profile\//.test(url)) return body;
    return {};
  });
  return dom;
}

const self = (over = {}) => ({
  userId: 'user-me', username: 'ada', avatar: null, createdAt: '2026-01-01T00:00:00.000Z',
  self: true, friendship: 'none', events: [], stats: STATS, ...over,
});

const figures = (app) => [...app.querySelectorAll('.profile-figures .member-figure')]
  .map((f) => f.querySelector('.member-figure__label').textContent);

test('the self profile renders its record, and „Das bist du." is gone', async (t_) => {
  const dom = bootWith(t_, self());
  await dom.call('showProfile', 'ada');

  assert.deepEqual(figures(dom.app), [
    t('member.sessions'), t('member.wins'), t('member.winRate'), t('member.winScore'),
    t('member.avgGiven'), t('profile.rounds'), t('profile.gamesPlayed'),
  ]);
  // The line this screen used to consist of, removed with the key behind it.
  assert.equal(dom.app.textContent.includes('Das bist du'), false);
  // Ties share the tile, as on the member page.
  assert.deepEqual(
    [...dom.app.querySelectorAll('.profile-stats__games .pokale-game')].map((g) => g.textContent),
    ['Carcassonne', 'Codenames', 'Azul'],
  );
  // No round is named, and nothing here is a link: the payload deliberately
  // carries no round id, so a game tile has nowhere it could point.
  assert.equal(dom.app.querySelectorAll('.profile-stats a').length, 0);
});

test('your own profile gets no friend-facing note; a friend\'s does', async (t_) => {
  const mine = bootWith(t_, self());
  await mine.call('showProfile', 'ada');
  assert.equal(mine.app.querySelector('.profile-stats__note'), null,
    'the note explains to a READER what they are seeing — you are not one');

  const theirs = bootWith(t_, self({
    userId: 'user-bo', username: 'bo', self: false, friendship: 'friends', since: '2026-02-01T00:00:00.000Z',
  }));
  await theirs.call('showProfile', 'bo');
  assert.equal(theirs.app.querySelector('.profile-stats__note').textContent, t('profile.statsNote'));
});

test('an empty record is ONE line, not a grid of zeroes', async (t_) => {
  const dom = bootWith(t_, self({ stats: EMPTY }));
  await dom.call('showProfile', 'ada');

  // Nine zero tiles would read as broken rather than as empty — and „0 %" in
  // particular claims something false about somebody never in a contest.
  assert.equal(dom.app.querySelector('.profile-figures'), null);
  assert.equal(dom.app.querySelector('.profile-stats__games'), null);
  assert.ok([...dom.app.querySelectorAll('.empty-note')]
    .some((el) => el.textContent === t('profile.statsEmptySelf')));
});

test('an account with stats switched off renders no block at all', async (t_) => {
  // The server omits the key entirely (absent, never empty), so the view must
  // key off its presence rather than off a falsy record.
  const body = self({ userId: 'user-bo', username: 'bo', self: false, friendship: 'friends', since: 'x' });
  delete body.stats;
  const dom = bootWith(t_, body);
  await dom.call('showProfile', 'bo');

  assert.equal(dom.app.querySelector('.profile-stats'), null);
  assert.equal(dom.app.textContent.includes(t('profile.statsTitle')), false);
});

test('the self feed says so — it does not date itself from a friendship', async (t_) => {
  const dom = bootWith(t_, self());
  await dom.call('showProfile', 'ada');

  const notes = [...dom.app.querySelectorAll('.empty-note')].map((el) => el.textContent);
  assert.ok(notes.includes(t('profile.feedEmptySelf')));
  // The friend wording names „eurer Freundschaft", which your own profile has none of.
  assert.equal(notes.includes(t('profile.feedEmpty')), false);
});
