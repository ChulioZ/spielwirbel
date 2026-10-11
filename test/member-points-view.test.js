'use strict';

/*
 * „Bestleistungen" (#1631) on the member page and the profile card, in every
 * enabled design — views-member-points.js, run through the real views under
 * jsdom (.claude/rules/testing-views-under-jsdom.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');
const { DESIGN_REGISTRY } = require('../public/js/designs');

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const ENABLED = DESIGN_REGISTRY.filter((d) => d.enabled).map((d) => d.id);

const day = (n) => `2026-03-${String(n).padStart(2, '0')}T20:00:00.000Z`;
const play = (id, gid, n, scores, over = {}) => ({
  id, createdAt: day(n), finished: true, cancelled: false, gameIds: [gid], chosenGameId: gid,
  memberIds: ['m1', 'm2'], votes: {}, winnerIds: [], scores, ...over,
});
const ROUND = {
  id: 'r1', name: 'Donnerstagsrunde', marker: 2, background: null, tags: [], providers: [], savedFilters: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: [
    { id: 'g1', title: 'Wingspan', tagIds: [] },
    { id: 'g2', title: 'Azul', tagIds: [] },
    { id: 'g3', title: 'Codenames', tagIds: [] },
  ],
  sessions: [
    play('s1', 'g1', 1, { m1: 70, m2: 80 }),
    play('s2', 'g1', 2, { m1: 90, m2: 60 }),   // Anna breaks Wingspan's record and her own best
    play('s3', 'g2', 3, { m1: 40, m2: 55 }),   // Ben holds Azul's
    play('s4', 'g3', 4, { m2: 1 }),
    play('s5', 'g3', 5, { t1: 9 }, { teams: [{ id: 't1', personIds: ['m1', 'm2'] }] }), // a team record: held, no row
  ],
};

function boot(t, design, round = ROUND) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return JSON.parse(JSON.stringify(round));
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('toast', () => {});
  if (design) dom.call('applyDesign', design);
  return dom;
}

for (const design of ENABLED) {
  test(`member page (${design}): bests by title, the record medal, records held and bests bettered`, async (t) => {
    const dom = boot(t, design);
    await dom.call('showMember', 'r1', 'm1');
    const panels = dom.app.querySelectorAll('.member-points');
    assert.equal(panels.length, 1, 'exactly one panel');
    const panel = panels[0];
    assert.ok(panel.closest('.member-card'), 'it sits inside the member card');
    const rows = [...panel.querySelectorAll('.member-points__row')];
    assert.deepEqual(rows.map((r) => text(r.querySelector('.member-points__game'))), ['Azul', 'Wingspan']);
    assert.deepEqual(rows.map((r) => text(r.querySelector('.member-points__value'))), ['40', '90']);
    assert.deepEqual(rows.map((r) => !!r.querySelector('.member-points__record')), [false, true],
      'the medal marks Wingspan, whose record Anna holds — not Azul');
    assert.equal(rows[1].getAttribute('href'), '/round/r1/game/g1', 'each row links to its game');
    // Wingspan alone, plus Codenames through the team: two records held, one best bettered.
    assert.equal(text(panel.querySelector('.member-points__meta')), 'Hält 2 Rekorde · 1 Bestleistung verbessert');
  });
}

test('member page: no panel for a member without points, nor in a round that never counts them', async (t) => {
  const dom = boot(t, 'klassisch', {
    ...ROUND,
    members: [...ROUND.members, { id: 'm3', name: 'Cem' }],
  });
  await dom.call('showMember', 'r1', 'm3');
  assert.ok(dom.app.querySelector('.member-card'), 'the page rendered');
  assert.equal(dom.app.querySelector('.member-points'), null);

  const bare = boot(t, 'klassisch', { ...ROUND, sessions: ROUND.sessions.map((s) => ({ ...s, scores: undefined })) });
  await bare.call('showMember', 'r1', 'm1');
  assert.ok(bare.app.querySelector('.member-card'));
  assert.equal(bare.app.querySelector('.member-points'), null);
});

test('member page: a record held only through a team shows the meta line without rows', async (t) => {
  const dom = boot(t, 'klassisch', { ...ROUND, sessions: ROUND.sessions.filter((s) => s.chosenGameId === 'g3') });
  await dom.call('showMember', 'r1', 'm1');
  const panel = dom.app.querySelector('.member-points');
  assert.ok(panel);
  assert.equal(panel.querySelector('.member-points__list'), null, 'no empty list');
  assert.equal(text(panel.querySelector('.member-points__meta')), 'Hält 1 Rekord');
});

// --- the profile ------------------------------------------------------------------

const PROFILE = (points) => ({
  username: 'ada', createdAt: '2026-01-01T00:00:00.000Z', friendship: 'friends',
  stats: { sessions: 5, wins: 2, winRate: 0.4, avgGiven: 3.5, rounds: 2, gamesPlayed: 3,
    favorite: [], favAvg: null, bestGames: [], bestScore: null, bestPlays: 0, badges: [],
    ...(points ? { points } : {}) },
});

function bootProfile(t, design, profile) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => 'u-me');
  dom.set('accountApi', async (method, url) => {
    if (/^\/profile\//.test(url)) return profile;
    return {};
  });
  dom.set('api', async () => ({}));
  if (design) dom.call('applyDesign', design);
  return dom;
}

for (const design of ENABLED) {
  test(`profile (${design}): the account-wide bests, plain rows, no dates`, async (t) => {
    const dom = bootProfile(t, design, PROFILE({
      bests: [{ title: 'Wingspan', image: null, points: 90, record: true }, { title: 'Azul', image: null, points: 61, record: false }],
      held: 3,
      bettered: 4,
    }));
    await dom.call('showProfile', 'ada');
    const panel = dom.app.querySelector('.profile-card .member-points');
    assert.ok(panel, 'the panel is on the profile card');
    const rows = [...panel.querySelectorAll('.member-points__row')];
    assert.deepEqual(rows.map((r) => [text(r.querySelector('.member-points__game')), text(r.querySelector('.member-points__value'))]),
      [['Azul', '61'], ['Wingspan', '90']]);
    assert.equal(rows[0].tagName, 'SPAN', 'a profile has no round to link into');
    assert.equal(panel.querySelector('.member-points__when'), null);
    assert.equal(panel.querySelectorAll('.member-points__record').length, 1);
    assert.equal(text(panel.querySelector('.member-points__meta')), 'Hält 3 Rekorde · 4 Bestleistungen verbessert');
  });
}

test('profile: no panel when the payload carries no points', async (t) => {
  const dom = bootProfile(t, 'klassisch', PROFILE(null));
  await dom.call('showProfile', 'ada');
  assert.ok(dom.app.querySelector('.profile-card .member-card__figures'), 'the record rendered');
  assert.equal(dom.app.querySelector('.member-points'), null);
});
