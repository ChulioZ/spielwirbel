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

/* The slot's art is the badge's own EARNED MARK (#1428): the shared
   `.badge__mark` inside a non-interactive `.badge-emblem` host carrying
   data-state="earned", so each design's earned skin (Klassisch disc, Tisch brass
   pin, Ocean pearl) reaches the feed through its ordinary state selector. */
function assertEarnedMark(root, glyph, where) {
  const host = root.querySelector('.badge-emblem');
  assert.ok(host, `${where}: no .badge-emblem`);
  assert.equal(host.dataset.state, 'earned', `${where}: the host is not earned`);
  assert.equal(host.getAttribute('aria-hidden'), 'true', `${where}: the mark is not decorative`);
  assert.equal(host.closest('button, a, [tabindex]'), null, `${where}: the mark sits in something focusable`);
  assert.equal(host.querySelector('button, a, [tabindex]'), null, `${where}: the mark holds something focusable`);
  const mark = host.querySelector(':scope > .badge__mark');
  assert.ok(mark, `${where}: no .badge__mark in the host`);
  assert.ok(mark.querySelector(`:scope > .ti.${glyph}`), `${where}: the mark does not carry ${glyph}`);
  // No progress ring and no falling pin: a feed event has neither.
  assert.equal(/--pct/.test(mark.getAttribute('style') || ''), false, `${where}: --pct on the feed mark`);
  assert.equal(root.querySelector('[data-fresh]'), null, `${where}: data-fresh on the feed mark`);
  return host;
}

test('the row: „mia · Sessions 100", the kicker, and the earned mark', (t_) => {
  const dom = boot(t_);
  const item = dom.call('renderFeedEvent', mark());
  assert.equal(item.querySelector('.feed-item__text').textContent, `mia · ${t('badges.accountSessions.name')} 100`);
  assert.ok(item.querySelector('.feed-item__time').textContent.startsWith(`${t('badges.title')} · `));
  const host = assertEarnedMark(item, 'ti-cards', 'row');
  assert.ok(host.closest('.feed-item__img'), 'the mark takes the row\'s image slot');
  assert.ok(item.querySelector('.feed-item__who'), 'the author still rides the slot\'s corner');
  assert.equal(item.textContent.includes('accountSessions'), false, 'the key leaked as text');
});

test('a Sessions mark is not a cover-less game, although both carry ti-cards', (t_) => {
  const dom = boot(t_);
  const game = dom.call('renderFeedEvent', { type: 'game_added', title: 'Catan', coverUrl: null, username: 'mia', at: '2026-09-24T19:40:00Z' });
  // The no-cover glyph is the slot's bare child; that is what a mark must not be.
  assert.ok(game.querySelector('.feed-item__img > .ti-cards'), 'the control: a cover-less game shows the bare glyph');
  assert.equal(game.querySelector('.badge-emblem, .badge__mark'), null);
  const badge = dom.call('renderFeedEvent', mark());
  assert.equal(badge.querySelector('.feed-item__img > .ti'), null, 'the mark row shows the no-cover glyph');
  assert.ok(badge.querySelector('.feed-item__img .badge__mark .ti-cards'));
});

test('the tile: the mark as its title, „Abzeichen" as its verb, the earned mark not a shelf placeholder', (t_) => {
  const dom = boot(t_);
  const tile = dom.call('renderFeedTile', mark({ title: 'accountWins', tier: 50 }), {});
  assert.equal(tile.querySelector('.e-tile__title').textContent, `${t('badges.accountWins.name')} 50`);
  assert.equal(tile.querySelector('.e-tile__verb').textContent, t('badges.title'));
  const host = assertEarnedMark(tile, 'ti-trophy', 'tile');
  assert.ok(host.closest('.e-tile__img--badge'), 'the mark sits on the tile\'s band');
  assert.equal(tile.querySelector('.e-tile__img--badge > .ti'), null, 'a bare glyph on the band');
  assert.equal(tile.querySelector('.cover-ph'), null);
});

test('Der Tisch\'s row stands the earned mark where a game stands its box', (t_) => {
  const dom = boot(t_);
  const row = dom.call('renderFeedRow', mark({ title: 'accountRounds', tier: 5 }));
  assertEarnedMark(row, 'ti-world', 'Tisch row');
  assert.equal(row.querySelector('.feed-row__cover'), null, 'the mark is not a cover box');
  assert.match(row.querySelector('.feed-item__text').textContent, /Runden 5/);
});

test('an unknown key names no mark, never prints itself, and shows one generic medal everywhere', (t_) => {
  const dom = boot(t_);
  const ev = mark({ title: 'somethingNew', tier: 7 });
  const item = dom.call('renderFeedEvent', ev);
  assert.equal(item.querySelector('.feed-item__text').textContent, `mia · ${t('badges.title')}`);
  assert.equal(item.textContent.includes('somethingNew'), false);
  assertEarnedMark(item, 'ti-medal', 'row');
  assertEarnedMark(dom.call('renderFeedTile', ev, {}), 'ti-medal', 'tile');
  assertEarnedMark(dom.call('renderFeedRow', ev), 'ti-medal', 'Tisch row');
});

test('game events keep their art: a cover, or the placeholder, and never a mark', (t_) => {
  const dom = boot(t_);
  const covered = { type: 'session_played', title: 'Catan', coverUrl: '/uploads/c.jpg', username: 'mia', at: '2026-09-24T19:40:00Z' };
  const bare = { ...covered, type: 'games_imported', coverUrl: null, count: 3 };
  for (const ev of [covered, bare]) {
    const nodes = [dom.call('renderFeedEvent', ev), dom.call('renderFeedTile', ev, {}), dom.call('renderFeedRow', ev)];
    for (const n of nodes) assert.equal(n.querySelector('.badge-emblem, .badge__mark'), null, `${ev.type}: a mark on a game`);
  }
  assert.match(dom.call('renderFeedEvent', covered).querySelector('.feed-item__img').getAttribute('style'), /background-image/);
  assert.ok(dom.call('renderFeedRow', covered).querySelector('.feed-row__cover'));
  assert.ok(dom.call('renderFeedTile', bare, {}).querySelector('.e-tile__img .cover-ph'));
  assert.equal(dom.call('renderFeedRow', bare).querySelector('.feed-row__cover'), null, 'no box for a game with no art');
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
