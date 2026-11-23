'use strict';

/* Die Brücke's Pokale right column (#1422, B3.4/B6.2; one records list since
 * #1856): the SAME records every design shows — Meistgespielt, Bestbewertet,
 * Siegesserie, in that order, covers intact — styled as the sheet's plates. A
 * design owns its layout, not its content (operator decision in the #1489
 * review, 2026-10-02). No Staubfänger and no „Jetzt spielen" anywhere since
 * #1856, in any design.
 *
 * Pinned through the jsdom harness under Brücke AND Klassisch, plus the
 * stylesheet section that does the restyling.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';
const MEMBERS = [
  { id: 'm1', name: 'Anna' },
  { id: 'm2', name: 'Ben' },
  { id: 'm3', name: 'Cem' },
  { id: 'm4', name: 'Dora' },
];
const GAMES = [
  { id: 'g1', title: 'Catan', tagIds: [], image: '/uploads/catan.jpg' },
  { id: 'g2', title: 'Azul', tagIds: [] },
  { id: 'g3', title: 'Cascadia', tagIds: [] },
  { id: 'g4', title: 'Monopoly', tagIds: [], retired: true, retiredAt: '2026-06-01T00:00:00.000Z' },
];

// Four voters' ratings for one game, in member order.
const votesFor = (gid, ratings) => Object.fromEntries(MEMBERS.map((m, i) => [m.id, { [gid]: { rating: ratings[i] } }]));
const merge = (...vs) => {
  const out = {};
  vs.forEach((v) => Object.entries(v).forEach(([mid, g]) => (out[mid] = { ...(out[mid] || {}), ...g })));
  return out;
};
const played = (id, gid, at, winnerIds, votes = {}) => ({
  id,
  createdAt: at,
  gameIds: [...new Set([gid, ...Object.values(votes).flatMap((g) => Object.keys(g))])],
  memberIds: MEMBERS.map((m) => m.id),
  votes,
  votedIds: Object.keys(votes),
  finished: true,
  cancelled: false,
  done: true,
  winnerIds,
  chosenGameId: gid,
  events: [],
});

/* Enough history for all four cards: Catan is played most and rated best,
   Ben's two wins in April are the current streak, and Cascadia (last played
   in March) is the only dusty candidate, so the Staubfänger pick is fixed. */
const SESSIONS = [
  played('s1', 'g1', '2026-02-05T20:00:00.000Z', ['m1'], merge(votesFor('g1', [5, 5, 4, 4]), votesFor('g2', [1, 1, 3, 3]))),
  played('s2', 'g1', '2026-02-19T20:00:00.000Z', ['m1']),
  played('s3', 'g3', '2026-03-12T20:00:00.000Z', ['m1'], votesFor('g4', [1, 1, 1, 1])),
  played('s4', 'g1', '2026-04-02T20:00:00.000Z', ['m2'], votesFor('g2', [1, 2, 3, 4])),
  played('s5', 'g2', '2026-04-09T20:00:00.000Z', ['m2']),
];

const roundWith = (sessions) => ({
  id: RID, name: 'Freitagsrunde', background: null, tags: [], providers: [],
  members: MEMBERS, games: GAMES, sessions,
});

function boot(t, design, round = roundWith(SESSIONS)) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/\/recommendations$/.test(url)) return { recommendations: [], spotlights: [] };
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const RECORDS = ['Meistgespielt', 'Bestbewertet', 'Siegesserie'];
const labels = (list) => [...list.querySelectorAll(':scope > .pokale-record > .pokale-record__body > .pokale-record__label')].map(text);

test('under Brücke the right column holds the one records list, in the standard order (#1856)', async (t) => {
  const dom = boot(t, 'bruecke');
  await dom.call('showRound', RID, 'pokale');
  // On the round's plaque since #1857, which is the split's right column.
  const records = dom.app.querySelector('.pokale-split > .pokale-plaque > .pokale-records');
  assert.ok(records, 'the records are not the split’s right column');
  const list = records.querySelector('.pokale-records__list');
  assert.equal(list.tagName, 'OL');
  assert.deepEqual(labels(list), RECORDS);
  // Content is the design-independent one: no plate markup of its own.
  assert.equal(dom.app.querySelector('.pokale-card--plate, .pokale-cards--plates, .pokale-cards'), null, 'a card grid was rendered on Pokale');
  // The cover is the record's own; the title links the game.
  const [most] = list.children;
  assert.match(most.querySelector('.pokale-record__thumb').style.backgroundImage, /catan\.jpg/);
  assert.match(most.querySelector('.pokale-record__name').getAttribute('href'), /g1/);
});

test('Klassisch shows the same records list under the standings, and nothing launches a game', async (t) => {
  const dom = boot(t, 'klassisch');
  await dom.call('showRound', RID, 'pokale');
  assert.equal(dom.app.querySelector('.pokale-split'), null);
  const list = dom.app.querySelector('.pokale-page > .pokale-plaque > .pokale-records .pokale-records__list');
  assert.ok(list, 'the records list is not in the page section');
  assert.deepEqual(labels(list), RECORDS);
  assert.equal(dom.app.querySelector('.pokale-game__play'), null, 'a „Jetzt spielen" launcher survives on Pokale');
  assert.doesNotMatch(dom.app.textContent, /Staubfänger/, 'the Staubfänger survives');
});

// --- the stylesheet --------------------------------------------------------

function section1422() {
  const fs = require('node:fs');
  const path = require('node:path');
  const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/bruecke.css'), 'utf8');
  const SHEET = RAW.replace(/\/\*[\s\S]*?\*\//g, (c) => {
    if (c.includes('===== #1422')) return '/*#1422*/';
    return c.startsWith('/* ===== #') ? '/*§*/' : '';
  });
  assert.ok(SHEET.includes('/*#1422*/'), 'the section header moved — re-read this test');
  const after = SHEET.slice(SHEET.indexOf('/*#1422*/') + '/*#1422*/'.length);
  return { SHEET, section: after.slice(0, after.indexOf('/*§*/')) };
}

test('the #1422 section dresses the records as plates: no icon, the holder in display capitals', () => {
  const { rulesOf } = require('./support/css');
  const { section } = section1422();
  const flat = rulesOf(section);
  const ruleFor = (needle) => flat.filter(([sel]) => sel.trim().endsWith(needle)).map(([, b]) => b).join(';');
  assert.match(ruleFor('.pokale-record__label .ti'), /display:\s*none/, 'the rows keep their icon');
  const who = ruleFor('.pokale-record__who');
  assert.match(who, /font-size:\s*var\(--display-s\)/, 'the holder is not at the plate display size');
  assert.match(who, /text-transform:\s*uppercase/);
  // The cards' plate skin went with the cards.
  assert.ok(!/pokale-cards--plates|pokale-card--plate/.test(section), 'a rule still styles the removed plates');
});

test('every #1422 rule is scoped to Brücke, and every one reading a colour token is dark-gated', () => {
  const { rulesOf } = require('./support/css');
  const { SHEET, section } = section1422();
  const VOICE = ':root[data-design="bruecke"]';
  const DARK = ':root[data-design="bruecke"][data-scheme="dark"]';
  const gated = new Set([...rulesOf(SHEET).find(([sel]) => sel.trim() === DARK)[1].matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  assert.ok(gated.has('--line') && gated.has('--ink-2'), 'the gated block was not found');
  const flat = rulesOf(section.replace(/@media[^{]+\{/g, ''));
  assert.ok(flat.length >= 8, 'the scan found implausibly few rules');
  let reads = 0;
  for (const [selector, body] of flat) {
    const colour = [...body.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]).filter((v) => gated.has(v));
    for (const part of selector.split(',').map((p) => p.trim()).filter(Boolean)) {
      assert.ok(part.startsWith(VOICE), `${part} is not scoped to Brücke`);
      if (colour.length) assert.ok(part.startsWith(DARK), `${part} reads ${colour.join(', ')} without the dark gate`);
    }
    if (colour.length) reads++;
  }
  assert.ok(reads >= 2, 'the scan saw no colour reads');
});
