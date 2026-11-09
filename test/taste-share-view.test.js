'use strict';

/* #1776 — the two places the taste share is shown: the Pokale Rückblick's
 * „Wessen Favoriten auf den Tisch kommen" list and the member page's line.
 * The arithmetic is pinned by test/taste-share.test.js; this file pins the
 * gates (sixth played session, two favourites, „Einfacher Modus") and that the
 * words carry no figure but the count.
 *
 * Fixture: Anna rates g1+g2 at 5 (two favourites), Ben g3+g4 (two), Cem only g5
 * (one — never listed). Plays: g1 ×3, g3 ×1, g4 ×1, g5 ×1, all at full table.
 * So Anna 3 evenings / 1 distinct favourite, Ben 2 / 2. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';
const VOTES = {
  m1: { g1: { rating: 5 }, g2: { rating: 5 }, g5: { rating: 2 } },
  m2: { g3: { rating: 5 }, g4: { rating: 5 } },
  m3: { g5: { rating: 5 } },
};

const played = (n, gid, votes = {}) => ({
  id: `s${n}`,
  createdAt: `2026-07-0${n}T20:00:00.000Z`,
  gameIds: ['g1', 'g2', 'g3', 'g4', 'g5'],
  memberIds: ['m1', 'm2', 'm3'],
  votes,
  votedIds: Object.keys(votes),
  finished: true,
  cancelled: false,
  done: true,
  winnerIds: ['m1'],
  chosenGameId: gid,
  events: [],
});

function round(sessions) {
  return {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    providers: [],
    members: [
      { id: 'm1', name: 'Anna' },
      { id: 'm2', name: 'Ben' },
      { id: 'm3', name: 'Cem' },
    ],
    games: ['Azul', 'Brass', 'Catan', 'Dune', 'Everdell'].map((title, i) => ({ id: `g${i + 1}`, title, tagIds: [] })),
    sessions,
  };
}

const SIX = [played(1, 'g1', VOTES), played(2, 'g1'), played(3, 'g1'), played(4, 'g3'), played(5, 'g4'), played(6, 'g5')];

function boot(t, data, me) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return data;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  if (me) dom.run(`accountUser = ${JSON.stringify(me)}`);
  return dom;
}

const rows = (dom) => [...dom.app.querySelectorAll('.taste-share__row')].map((li) => ({
  name: li.querySelector('.taste-share__who').textContent,
  text: li.querySelector('.taste-share__text').textContent,
}));

test('Rückblick: from the sixth session, members with two favourites, most evenings first, in words', async (t) => {
  const dom = boot(t, round(SIX));
  await dom.call('showRound', RID, 'pokale');
  assert.deepEqual(rows(dom), [
    { name: 'Anna', text: dom.run("tn(3, 'recap.tasteShareOne', 'recap.tasteShareMany')") },
    { name: 'Ben', text: dom.run("tn(2, 'recap.tasteShareOne', 'recap.tasteShareMany')") },
  ]);
  assert.equal(rows(dom)[0].text, 'Favoriten kamen 3× auf den Tisch');
  const heading = [...dom.app.querySelectorAll('.recap__sub')].map((el) => el.textContent);
  assert.ok(heading.includes(dom.run("t('recap.tasteShare')")));
  // No percentages and no places: the only digits in the block are the counts.
  const text = dom.app.querySelector('.taste-share').textContent;
  assert.doesNotMatch(text, /%/);
  assert.deepEqual(text.match(/\d+/g), ['3', '2']);
});

test('Rückblick: hidden with five played sessions', async (t) => {
  const dom = boot(t, round(SIX.slice(0, 5)));
  await dom.call('showRound', RID, 'pokale');
  assert.ok(dom.app.querySelector('.recap'), 'the Rückblick itself must have rendered');
  assert.equal(dom.app.querySelector('.taste-share'), null);
});

test('Rückblick: a cancelled sixth session does not open it', async (t) => {
  const sessions = [...SIX.slice(0, 5), { ...played(6, null), finished: false, cancelled: true }];
  const dom = boot(t, round(sessions));
  await dom.call('showRound', RID, 'pokale');
  assert.ok(dom.app.querySelector('.recap'));
  assert.equal(dom.app.querySelector('.taste-share'), null);
});

test('member page: the distinct favourites that reached the table', async (t) => {
  const dom = boot(t, round(SIX));
  await dom.call('showMember', RID, 'm2');
  assert.equal(dom.app.querySelector('.member-taste').textContent, 'Von den Favoriten kamen 2 auf den Tisch');
});

test('member page: singular, and absent below two favourites', async (t) => {
  const dom = boot(t, round(SIX));
  await dom.call('showMember', RID, 'm1');
  assert.equal(dom.app.querySelector('.member-taste').textContent, 'Von den Favoriten kam einer auf den Tisch');
  await dom.call('showMember', RID, 'm3');
  assert.ok(dom.app.querySelector('.member-card'), 'the member page must have rendered');
  assert.equal(dom.app.querySelector('.member-taste'), null);
});

test('member page: absent below the sixth session', async (t) => {
  const dom = boot(t, round(SIX.slice(0, 5)));
  await dom.call('showMember', RID, 'm2');
  assert.ok(dom.app.querySelector('.member-card'));
  assert.equal(dom.app.querySelector('.member-taste'), null);
});

test('member page: „Einfacher Modus" hiding the trophies hides the line too', async (t) => {
  const dom = boot(t, round(SIX), { id: 'u1', simpleMode: { all: false, except: ['trophies'] } });
  await dom.call('showMember', RID, 'm2');
  assert.ok(dom.app.querySelector('.member-card'));
  assert.equal(dom.app.querySelector('.member-taste'), null);
});

test('member page: the line is shown when „Einfacher Modus" hides something else', async (t) => {
  const dom = boot(t, round(SIX), { id: 'u1', simpleMode: { all: false, except: ['stats'] } });
  await dom.call('showMember', RID, 'm2');
  assert.ok(dom.app.querySelector('.member-taste'));
});
