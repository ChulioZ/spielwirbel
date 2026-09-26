'use strict';

/* How an account-tier Abzeichen reads in the friends' feed (#1389, X17.7:
   „Mia · Sessions 100", kicker „Abzeichen · <time>"). The row stores the
   catalogue KEY in `title`, so every presentation must name the mark instead of
   printing the key — and a key this build does not know must not leak as text.
   Run through the jsdom harness, like test/feed-imported-line.test.js. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, translator } = require('./support/dom');

const t = translator('de');
const mark = (over = {}) => ({
  type: 'badge_earned', title: 'accountSessions', tier: 100, coverUrl: null,
  username: 'mia', at: '2026-09-24T19:40:00Z', ...over,
});

function boot(t_) {
  const dom = loadApp({ locale: 'de' });
  t_.after(() => dom.close());
  return dom;
}

test('the row: „mia · Sessions 100", the kicker, and the mark\'s glyph', (t_) => {
  const dom = boot(t_);
  const item = dom.call('renderFeedEvent', mark());
  assert.equal(item.querySelector('.feed-item__text').textContent, `mia · ${t('badges.accountSessions.name')} 100`);
  assert.ok(item.querySelector('.feed-item__time').textContent.startsWith(`${t('badges.title')} · `));
  assert.ok(item.querySelector('.feed-item__img .ti-cards'), 'the Sessions glyph');
  assert.equal(item.textContent.includes('accountSessions'), false, 'the key leaked as text');
});

test('the tile: the mark as its title, „Abzeichen" as its verb, a glyph not a shelf placeholder', (t_) => {
  const dom = boot(t_);
  const tile = dom.call('renderFeedTile', mark({ title: 'accountWins', tier: 50 }), {});
  assert.equal(tile.querySelector('.e-tile__title').textContent, `${t('badges.accountWins.name')} 50`);
  assert.equal(tile.querySelector('.e-tile__verb').textContent, t('badges.title'));
  assert.ok(tile.querySelector('.e-tile__img--badge .ti-trophy'));
  assert.equal(tile.querySelector('.cover-ph'), null);
});

test('Der Tisch\'s row stands the glyph where a game stands its box', (t_) => {
  const dom = boot(t_);
  const row = dom.call('renderFeedRow', mark({ title: 'accountRounds', tier: 5 }));
  assert.ok(row.querySelector('.feed-row__cover--badge .ti-world'));
  assert.match(row.querySelector('.feed-item__text').textContent, /Runden 5/);
});

test('an unknown key names no mark and never prints itself', (t_) => {
  const dom = boot(t_);
  const item = dom.call('renderFeedEvent', mark({ title: 'somethingNew', tier: 7 }));
  assert.equal(item.querySelector('.feed-item__text').textContent, `mia · ${t('badges.title')}`);
  assert.equal(item.textContent.includes('somethingNew'), false);
});

test('the other types are untouched: a play still names its game', (t_) => {
  const dom = boot(t_);
  const item = dom.call('renderFeedEvent', { type: 'session_played', title: 'Catan', coverUrl: null, username: 'mia', at: '2026-09-24T19:40:00Z' });
  assert.match(item.querySelector('.feed-item__text').textContent, /Catan/);
  assert.equal(item.querySelector('.feed-item__time').textContent.startsWith(t('badges.title')), false);
});

test('a friend tile\'s „last did" line names the mark, not its key', (t_) => {
  const dom = boot(t_);
  const line = dom.call('personTileLine', { username: 'mia' }, [mark()]);
  assert.match(line, new RegExp(`${t('badges.accountSessions.name')} 100`));
  assert.equal(line.includes('accountSessions'), false);
});
