'use strict';

/* Die Spielerkarte — the account profile's own rendering (#1132, over #1089).
 *
 * Rendered through the jsdom harness rather than matched over the view source
 * (`.claude/rules/testing-views-under-jsdom.md`): most of what is pinned here is
 * the ABSENCE of a node — no menu on your own profile, no pen on someone
 * else's, no stat strip on an empty record, no author on a profile feed tile —
 * which a regex over the view cannot see at all.
 *
 * The payload is stubbed at `accountApi` rather than driven over HTTP: what the
 * server decides to SEND (who may see `stats`, and when) is pinned in
 * test/profile.test.js, and re-asserting it here would be the same guarantee
 * measured twice in the weaker place.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, translator, flush } = require('./support/dom');
const { MEMBER_COLORS } = require('../public/js/member-colors');

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

const events = (n) => Array.from({ length: n }, (_, i) => ({
  type: 'session_played', title: `Spiel ${i + 1}`, coverUrl: null,
  at: `2026-0${(i % 9) + 1}-01T18:00:00.000Z`,
}));

/** A booted app whose profile fetch answers `body`. */
function bootWith(t_, body, over = {}) {
  const dom = loadApp();
  t_.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => 'user-me');
  dom.set('isDemoAccount', () => false);
  // The contact channel is configured on the instance these specs describe, so
  // „Melden" is reachable; report-link.js keeps its own gate and is not stubbed.
  dom.run('setContactAvailable(true)');
  dom.set('accountApi', async (method, url) => {
    if (/^\/profile\//.test(url)) return body;
    return {};
  });
  Object.entries(over).forEach(([k, v]) => dom.set(k, v));
  return dom;
}

const self = (over = {}) => ({
  userId: 'user-me', username: 'ada', avatar: null, createdAt: '2026-01-01T00:00:00.000Z',
  self: true, friendship: 'none', events: [], stats: STATS, ...over,
});

const stranger = (over = {}) => self({
  userId: 'user-bo', username: 'bo', self: true, ...over, // `self` overridden below
  ...{ self: false },
});

const figureLabels = (app) => [...app.querySelectorAll('.profile-card .member-figure')]
  .map((f) => f.querySelector('.member-figure__label').textContent);

const menuLabels = async (dom) => {
  const btn = dom.app.querySelector('.back-row--split .gd-menu');
  if (!btn) return null;
  btn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await flush();
  return [...dom.document.querySelectorAll('.popover--menu .popover__opt')]
    .map((o) => o.textContent.trim());
};

test('the card wears the account\'s own colour, its Siegquote ring and its initials', async (t_) => {
  const dom = bootWith(t_, self());
  await dom.call('showProfile', 'ada');

  const card = dom.app.querySelector('.profile-card');
  assert.ok(card, 'no .profile-card — the profile is still a form');
  // The SAME colour the avatar is painted with, through the shared helper, so
  // the tone and the face cannot drift (accountColor, views-friends.js).
  const tone = dom.run('accountColor("ada")');
  assert.ok(MEMBER_COLORS.includes(tone), 'accountColor returned something outside the palette');
  assert.equal(card.getAttribute('style'), `--m-tone:${tone}`);

  // The ring IS the Siegquote: --pct from the same stats the strip prints.
  const ring = card.querySelector('.member-ring');
  assert.equal(ring.getAttribute('style'), '--pct:50');
  assert.equal(ring.classList.contains('member-ring--none'), false);

  assert.equal(card.querySelector('.member-card__mark').textContent, dom.run('initials("ada")'));
});

test('no contested session at all renders the plain tone ring, never a 0 % gauge', async (t_) => {
  const dom = bootWith(t_, self({ stats: { ...STATS, winRate: null } }));
  await dom.call('showProfile', 'ada');

  const ring = dom.app.querySelector('.member-ring');
  assert.ok(ring.classList.contains('member-ring--none'));
  assert.equal(ring.getAttribute('style'), null, 'a --pct on a gauge-less ring is a statistic nobody made');
});

test('the strip is the Tischkarte\'s five; Runden and Spiele move into the meta line', async (t_) => {
  const dom = bootWith(t_, self());
  await dom.call('showProfile', 'ada');

  assert.deepEqual(figureLabels(dom.app), [
    t('member.wins'), t('member.winRate'), t('member.sessions'),
    t('member.winScore'), t('member.avgGiven'),
  ]);
  // The Siegwertung carries the Tafel's row fill at figure size.
  assert.ok(dom.app.querySelector('.profile-card .member-bar'), 'the Siegwertung lost its bar');

  const meta = dom.app.querySelector('.profile-card__meta').textContent;
  assert.ok(meta.includes(t('profile.memberSince', { when: 'Januar 2026' })), `meta line: ${meta}`);
  assert.ok(meta.includes('3 Runden'), `meta line: ${meta}`);
  assert.ok(meta.includes('9 Spiele'), `meta line: ${meta}`);
});

test('the two games are ribboned boxes, and nothing in them is a link', async (t_) => {
  const dom = bootWith(t_, self());
  await dom.call('showProfile', 'ada');

  assert.deepEqual(
    [...dom.app.querySelectorAll('.profile-card .member-ribbon')].map((r) => r.textContent),
    [t('member.ribbonBest'), t('member.ribbonFav')],
  );
  assert.deepEqual(
    [...dom.app.querySelectorAll('.profile-card .pokale-game')].map((g) => g.textContent),
    ['Carcassonne', 'Codenames', 'Azul'],
  );
  // No round is named, and nothing here is a link: the payload deliberately
  // carries no round id, so a game tile has nowhere it could point.
  assert.equal(dom.app.querySelectorAll('.profile-card a').length, 0);
});

test('each of the five states shows at most one chip and at most one button', async (t_) => {
  const cases = [
    ['self', self(), t('profile.chip.self'), []],
    ['friends', stranger({ friendship: 'friends', since: '2026-02-01T00:00:00.000Z', friendshipId: 'f1' }),
      t('profile.chip.friends', { when: 'Februar 2026' }), []],
    ['incoming', stranger({ friendship: 'incoming', friendshipId: 'f1' }),
      t('profile.chip.incoming'), [t('friends.accept'), t('friends.decline')]],
    ['outgoing', stranger({ friendship: 'outgoing', friendshipId: 'f1' }),
      t('profile.chip.outgoing'), []],
    ['none', stranger(), null, [t('friends.addSubmit')]],
  ];
  for (const [what, body, chip, actions] of cases) {
    const dom = bootWith(t_, body);
    await dom.call('showProfile', body.username);
    const state = dom.app.querySelector('.profile-card .member-card__state');
    assert.deepEqual([...state.querySelectorAll('.member-card__chip')].map((c) => c.textContent),
      chip === null ? [] : [chip], `${what}: chip`);
    assert.deepEqual([...state.querySelectorAll('button')].map((b) => b.textContent.trim()),
      actions, `${what}: actions`);
  }
});

test('a friendship with no date renders NO chip, not a wrong one', async (t_) => {
  // Unreachable today — the route sets `since` from `acceptedAt` on every
  // accepted row — but the fallback that suggests itself (`friends.pending`)
  // would print „Ausstehend" over an accepted friendship, so the branch is
  // pinned rather than left to whoever edits it next.
  const body = stranger({ friendship: 'friends', friendshipId: 'f1' });
  delete body.since;
  const dom = bootWith(t_, body);
  await dom.call('showProfile', 'bo');

  assert.equal(dom.app.querySelector('.member-card__chip'), null);
  assert.equal(dom.app.textContent.includes(t('friends.pending')), false);
  // The relationship is still legible: the menu offers to end it.
  assert.deepEqual(await menuLabels(dom), [t('friends.unfriend'), t('friends.reportAccount')]);
});

test('a demo account is told why, instead of being given a button that must fail', async (t_) => {
  const dom = bootWith(t_, stranger(), { isDemoAccount: () => true });
  await dom.call('showProfile', 'bo');

  const state = dom.app.querySelector('.profile-card .member-card__state');
  assert.equal(state.querySelector('button'), null);
  assert.ok(state.textContent.includes(t('profile.demoNote')));
});

test('the rare actions live in the „…" menu, and your own profile has none', async (t_) => {
  const mine = bootWith(t_, self());
  await mine.call('showProfile', 'ada');
  assert.equal(await menuLabels(mine), null, 'your own profile offers a menu of nothing');
  // The one thing it does offer instead: the way to Konto, on the avatar.
  assert.ok(mine.app.querySelector('.member-avatar__pen'), 'no pen on your own profile');

  const friend = bootWith(t_, stranger({
    friendship: 'friends', since: '2026-02-01T00:00:00.000Z', friendshipId: 'f1',
  }));
  await friend.call('showProfile', 'bo');
  assert.equal(friend.app.querySelector('.member-avatar__pen'), null,
    'the pen edits YOUR picture — it must not appear on someone else\'s profile');
  assert.deepEqual(await menuLabels(friend), [t('friends.unfriend'), t('friends.reportAccount')]);

  const out = bootWith(t_, stranger({ friendship: 'outgoing', friendshipId: 'f1' }));
  await out.call('showProfile', 'bo');
  assert.deepEqual(await menuLabels(out), [t('friends.cancel'), t('friends.reportAccount')]);

  const none = bootWith(t_, stranger());
  await none.call('showProfile', 'bo');
  assert.deepEqual(await menuLabels(none), [t('friends.reportAccount')]);
});

test('the pen opens Konto, the screen that actually holds the picture', async (t_) => {
  let opened = 0;
  const dom = bootWith(t_, self(), { showAccount: () => { opened++; } });
  await dom.call('showProfile', 'ada');

  const avatar = dom.app.querySelector('.profile-card .member-avatar');
  assert.equal(avatar.tagName, 'BUTTON', 'a focusable span is not a control');
  avatar.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await flush();
  assert.equal(opened, 1);
});

test('an empty record is ONE line, not a grid of zeroes — and the card keeps its head', async (t_) => {
  const dom = bootWith(t_, self({ stats: EMPTY }));
  await dom.call('showProfile', 'ada');

  // Nine zero tiles would read as broken rather than as empty — and „0 %" in
  // particular claims something false about somebody never in a contest.
  assert.equal(dom.app.querySelector('.member-figure'), null);
  assert.equal(dom.app.querySelector('.profile-card .pokale-card'), null);
  assert.ok(dom.app.querySelector('.profile-card .member-card__chip'), 'the card lost its head with its numbers');
  assert.ok([...dom.app.querySelectorAll('.empty-note')]
    .some((el) => el.textContent === t('profile.statsEmptySelf')));
});

test('an account with stats switched off renders no strip and no note', async (t_) => {
  // The server omits the key entirely (absent, never empty), so the view must
  // key off its presence rather than off a falsy record.
  const body = stranger({ friendship: 'friends', since: 'x', friendshipId: 'f1' });
  delete body.stats;
  const dom = bootWith(t_, body);
  await dom.call('showProfile', 'bo');

  assert.ok(dom.app.querySelector('.profile-card'), 'the card itself is the identity — it always renders');
  assert.equal(dom.app.querySelector('.member-figure'), null);
  assert.equal(dom.app.querySelector('.profile-note'), null);
  assert.equal(dom.app.textContent.includes(t('profile.statsEmpty')), false,
    'an account that switched its record off has not got an EMPTY record');
});

test('your own profile gets no friend-facing note; a friend\'s does', async (t_) => {
  const mine = bootWith(t_, self());
  await mine.call('showProfile', 'ada');
  assert.equal(mine.app.querySelector('.profile-note'), null,
    'the note explains to a READER what they are seeing — you are not one');

  const theirs = bootWith(t_, stranger({
    friendship: 'friends', since: '2026-02-01T00:00:00.000Z', friendshipId: 'f1',
  }));
  await theirs.call('showProfile', 'bo');
  assert.equal(theirs.app.querySelector('.profile-note').textContent, t('profile.statsNote'));
});

/* ------------------------------ the tiled feed ----------------------------- */

test('the feed is a tile grid, and a profile tile names no author', async (t_) => {
  const dom = bootWith(t_, self({ events: events(3) }));
  await dom.call('showProfile', 'ada');

  const grid = dom.app.querySelector('.profile-screen .e-grid');
  assert.ok(grid, 'the feed is still a row list');
  assert.equal(grid.querySelectorAll('.e-tile').length, 3);
  assert.deepEqual([...grid.querySelectorAll('.e-tile__title')].map((el) => el.textContent),
    ['Spiel 1', 'Spiel 2', 'Spiel 3']);
  // Every event here belongs to the same account, whose name is the <h1> above.
  assert.equal(grid.querySelector('.e-tile__who'), null,
    'the profile tile repeats the heading\'s own name once per tile');
  assert.equal(grid.querySelector('.e-tile__verb').textContent, t('friends.tile.played'));
});

test('below 1024 the grid collapses to eight tiles plus an expander', async (t_) => {
  const few = bootWith(t_, self({ events: events(8) }));
  await few.call('showProfile', 'ada');
  assert.equal(few.app.querySelector('.e-feed__more'), null,
    'eight tiles are the collapsed length — there is nothing to expand');

  const many = bootWith(t_, self({ events: events(9) }));
  await many.call('showProfile', 'ada');
  const feed = many.app.querySelector('.e-feed');
  // EVERY tile is rendered; the collapse is CSS, so no resize listener can be
  // wrong about the width (the .k-feed mechanism, one screen over).
  assert.equal(feed.querySelectorAll('.e-tile').length, 9);
  const more = feed.querySelector('.e-feed__more');
  assert.equal(more.textContent, t('friends.feedMore', { count: 9 }));
  assert.equal(feed.classList.contains('is-open'), false);
  more.dispatchEvent(new many.window.Event('click', { bubbles: true }));
  assert.equal(feed.classList.contains('is-open'), true);
});

test('the self feed says so — it does not date itself from a friendship', async (t_) => {
  const dom = bootWith(t_, self());
  await dom.call('showProfile', 'ada');

  const notes = [...dom.app.querySelectorAll('.empty-note')].map((el) => el.textContent);
  assert.ok(notes.includes(t('profile.feedEmptySelf')));
  // The friend wording names „eurer Freundschaft", which your own profile has none of.
  assert.equal(notes.includes(t('profile.feedEmpty')), false);
});

test('the home screen\'s five-event preview keeps the ROW form', async (t_) => {
  const dom = bootWith(t_, self());
  dom.set('accountApi', async (method, url) => {
    if (/feed/.test(url)) return { friendCount: 2, events: events(3) };
    return {};
  });
  const section = dom.document.createElement('section');
  dom.app.appendChild(section);
  await dom.call('renderHomeFriends', section);

  // A narrow home section is the one place the row is still right, so
  // renderFeedEvent keeps a caller and must not be deleted with the rebuild.
  assert.equal(section.querySelectorAll('.feed-item').length, 3);
  assert.equal(section.querySelector('.e-tile'), null);
});

/* ------------------------------ the screen shell --------------------------- */

test('the card, the feed heading and the grid live in ONE width wrapper', async (t_) => {
  const dom = bootWith(t_, self({ events: events(2) }));
  await dom.call('showProfile', 'ada');

  const screen = dom.app.querySelector('.profile-screen');
  assert.ok(screen, 'without a wrapper the screen cannot opt out of the reading measure as a unit');
  for (const sel of ['.profile-card', '.e-grid']) {
    assert.ok(screen.querySelector(sel), `${sel} is outside .profile-screen, so it keeps its own edge`);
  }
  // The back row stays a SIBLING — it is named beside the wrapper in the width
  // exemption (test/content-width.test.js), not moved inside it.
  assert.equal(screen.querySelector('.back-row'), null);
  assert.ok(dom.app.querySelector('.back-row'));
});
