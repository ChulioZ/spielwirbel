'use strict';

/* Die Brücke's Pokale right column (#1422, B3.4/B6.2): the SAME four trophy
 * cards every design shows — Meistgespielt, Bestbewertet, Siegesserie,
 * Staubfänger, in that order, covers and „Jetzt spielen" launchers intact —
 * styled as the sheet's plates. A design owns its layout, not its content
 * (operator decision in the #1489 review, 2026-10-02), so the three plates the
 * sheet draws were dropped: two were statistics no other design shows.
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
const CARDS = ['Meistgespielt', 'Bestbewertet', 'Siegesserie', 'Staubfänger'];
const labels = (col) => [...col.querySelectorAll(':scope > .pokale-card > .pokale-card__label')].map(text);

test('under Brücke the right column holds exactly the four cards, in the standard order', async (t) => {
  const dom = boot(t, 'bruecke');
  await dom.call('showRound', RID, 'pokale');
  const col = dom.app.querySelector('.pokale-split > .pokale-cards');
  assert.ok(col, 'the cards are not the split’s right column');
  assert.ok(col.classList.contains('pokale-cards--plates'), 'the column is not in the plate style');
  assert.equal(col.children.length, 4, 'the column holds something besides the four cards');
  assert.deepEqual(labels(col), CARDS);
  // Content is the design-independent one: no plate markup of its own.
  assert.equal(dom.app.querySelector('.pokale-card--plate'), null, 'a plate was rendered');
  assert.equal(dom.app.querySelectorAll('.pokale-cards--plates').length, 1);
  // Covers and the launcher are the cards' own, unchanged.
  const [most] = col.children;
  assert.ok(most.classList.contains('pokale-card--cover'), 'Meistgespielt lost its cover');
  assert.match(most.querySelector('.pokale-card__thumb').style.backgroundImage, /catan\.jpg/);
  assert.match(most.querySelector('.pokale-game__title').getAttribute('href'), /g1/);
  assert.ok(most.querySelector('.pokale-game__play'), 'Meistgespielt lost its „Jetzt spielen" launcher');
});

test('Klassisch keeps the four trophy cards, in order, with no plate style', async (t) => {
  const dom = boot(t, 'klassisch');
  await dom.call('showRound', RID, 'pokale');
  assert.equal(dom.app.querySelector('.pokale-card--plate, .pokale-cards--plates'), null);
  const col = dom.app.querySelector('.pokale-cards');
  assert.equal(col.className, 'pokale-cards');
  assert.deepEqual(labels(col), CARDS);
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

test('the #1422 section dresses the cards as plates: no icon, display capitals at one size', () => {
  const { rulesOf } = require('./support/css');
  const { section } = section1422();
  const flat = rulesOf(section);
  const ruleFor = (needle) => flat.filter(([sel]) => sel.includes(needle)).map(([, b]) => b).join(';');
  assert.match(ruleFor('.pokale-card__icon'), /display:\s*none/, 'the cards keep their icon');
  const value = flat.find(([sel]) => sel.includes('.pokale-cards--plates .pokale-card__value') && sel.includes('.pokale-cards--plates .pokale-game__title'));
  assert.ok(value, 'no rule styles both the stat value and the game title');
  // --display-s, not the old plates' --display-m: beside a cover and the
  // launcher, 26px broke „Carcassonne" mid-word in the 340px column.
  assert.match(value[1], /font-size:\s*var\(--display-s\)/, 'the value is not at the card display size');
  assert.match(value[1], /text-transform:\s*uppercase/);
  // The plates are gone — so are their rules.
  assert.ok(!section.includes('pokale-card--plate'), 'a rule still styles the removed plates');
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
