'use strict';

/* Ocean's tier 2a (#1218, O13.1–O13.5): the Chronik's rows and number-tile
 * recap, the Pokale's bars, the member page and the off-shelf segments.
 *
 * The markup is rendered through the jsdom harness under BOTH designs: every
 * Ocean branch is also asserted absent under Klassisch, whose DOM is the
 * default path and must not move. The pixels were judged in a browser at 390
 * and 1440; what is pinned here is what regresses silently —
 *
 *   - a row that loses its winner, or names a winnerless night as won;
 *   - the bars dropping a member (the podium's „rest line" is gone under Ocean,
 *     so a member missing from the bars is missing from the screen);
 *   - the bars appearing on a young round, where the sentence stands in;
 *   - every rule of the #1218 section reading the gated colour block without
 *     being gated itself.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf, bodyOfIn, declaredValue, mediaBlocks } = require('./support/css');

const RID = 'r1';
const MEMBERS = [
  { id: 'm1', name: 'Anna' },
  { id: 'm2', name: 'Ben' },
  { id: 'm3', name: 'Cem' },
  { id: 'm4', name: 'Dora' },
];
const GAMES = [
  { id: 'g1', title: 'Catan', tagIds: [], ownerIds: ['m1'] },
  { id: 'g2', title: 'Azul', tagIds: [], ownerIds: ['m1'] },
  { id: 'g3', title: 'Cascadia', tagIds: [] },
];

const played = (id, gid, at, winnerIds, extra = {}) => ({
  id,
  createdAt: at,
  gameIds: [gid],
  memberIds: ['m1', 'm2', 'm3', 'm4'],
  votes: {},
  votedIds: [],
  finished: true,
  cancelled: false,
  done: true,
  winnerIds,
  chosenGameId: gid,
  events: [],
  ...extra,
});

/* Anna 3, Ben 1, Cem 1, Dora 0 — a tie below the lead, and a member who played
   and never won, so both the tie-aware crown and the „stands at 0" row are in
   view. Two months, so the month headings have two counts to disagree on. */
const SESSIONS = [
  played('s1', 'g1', '2026-07-03T20:00:00.000Z', ['m1']),
  played('s2', 'g2', '2026-07-10T20:00:00.000Z', ['m2']),
  played('s3', 'g1', '2026-08-02T20:00:00.000Z', ['m1']),
  played('s4', 'g3', '2026-08-09T20:00:00.000Z', ['m3']),
  played('s5', 'g1', '2026-08-16T20:00:00.000Z', ['m1']),
  // Played, nobody recorded as winner.
  played('s6', 'g2', '2026-08-20T20:00:00.000Z', []),
];

const roundWith = (sessions) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: MEMBERS,
  games: GAMES,
  sessions,
});

function boot(t, design, round = roundWith(SESSIONS)) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

// --- the Chronik -----------------------------------------------------------

test('Ocean draws each session as a row: the winner in its own slot, the crown on their ring', async (t) => {
  const dom = boot(t, 'ocean');
  await dom.call('showRound', RID, 'chronik');
  const rows = [...dom.app.querySelectorAll('.timeline .session-card--row')];
  assert.equal(rows.length, SESSIONS.length, 'one row per played session');

  const byTitle = (title, at) => rows.find((r) => text(r.querySelector('.session-card__title')) === title
    && r.querySelector(`time[datetime="${at}"]`));
  const won = byTitle('Cascadia', '2026-08-09T20:00:00.000Z');
  assert.ok(won, 'the fixture row for s4 is missing');
  assert.equal(text(won.querySelector('.session-card__won')), dom.run("tn(1, 'chronik.wonOne', 'chronik.won', { names: 'Cem' })"));
  assert.ok(won.querySelector('.session-card__crowned .ti-crown'), 'the winner wears no crown');
  assert.equal(won.querySelector('.session-card__crowned').getAttribute('aria-hidden'), 'true',
    'the ring repeats the sentence beside it; it must stay out of the link name');
  assert.equal(won.getAttribute('href'), `/round/${RID}/session/s4`, 'the row is not the link to its result');

  // A winnerless night says how it ended — never a crown, never „hat gewonnen".
  const plain = byTitle('Azul', '2026-08-20T20:00:00.000Z');
  assert.ok(plain, 'the fixture row for s6 is missing');
  assert.equal(plain.querySelector('.session-card__crowned'), null);
  assert.equal(plain.querySelector('.session-card__won'), null);
  assert.equal(text(plain.querySelector('.session-card__who')), dom.run("t('sessions.played')"));
});

test('an Ocean month heading carries its own session count', async (t) => {
  const dom = boot(t, 'ocean');
  await dom.call('showRound', RID, 'chronik');
  const months = [...dom.app.querySelectorAll('.timeline .tl-month')].map((m) => ({
    name: text(m.querySelector('.tl-month__name')),
    count: text(m.querySelector('.tl-month__count')),
  }));
  assert.deepEqual(months, [
    { name: dom.run("fmtMonth('2026-08-20T20:00:00.000Z')"), count: dom.run("tn(4, 'home.chip.sessionsOne', 'home.chip.sessions')") },
    { name: dom.run("fmtMonth('2026-07-10T20:00:00.000Z')"), count: dom.run("tn(2, 'home.chip.sessionsOne', 'home.chip.sessions')") },
  ]);
});

test('Ocean\'s recap totals are number tiles labelled as the share card labels them', async (t) => {
  const dom = boot(t, 'ocean');
  await dom.call('showRound', RID, 'chronik');
  const tiles = [...dom.app.querySelectorAll('.precap .recap__totals .stat-chip--tile')];
  assert.ok(tiles.length >= 2, 'the recap renders no number tiles');
  assert.equal(text(tiles[0].querySelector('.stat-chip__label')), dom.run("t('periodRecap.label.sessions')"));
  assert.match(text(tiles[0].querySelector('.stat-chip__n')), /^\d+$/);
});

test('Klassisch keeps its cards, chips and bare month labels', async (t) => {
  const dom = boot(t, 'klassisch');
  await dom.call('showRound', RID, 'chronik');
  assert.equal(dom.app.querySelector('.session-card--row, .tl-month__count, .stat-chip--tile, .chronik__count'), null);
  assert.equal(dom.app.querySelectorAll('.timeline .session-card').length, SESSIONS.length);
});

// --- the Pokale ------------------------------------------------------------

const bars = (dom) => [...dom.app.querySelectorAll('.pokale-bars__row')].map((r) => ({
  name: text(r.querySelector('.pokale-bars__name')),
  n: text(r.querySelector('.pokale-bars__n')),
  w: r.querySelector('.pokale-bars__link').style.getPropertyValue('--w'),
  lead: r.classList.contains('is-lead'),
  crown: !!r.querySelector('.ti-crown'),
  href: r.querySelector('a').getAttribute('href'),
}));

test('Ocean ranks every member on a bar as long as their wins, the leader crowned', async (t) => {
  const dom = boot(t, 'ocean');
  await dom.call('showRound', RID, 'pokale');
  const got = bars(dom);
  assert.deepEqual(got.map((b) => [b.name, b.n, b.w]), [
    ['Anna', '3', '100%'], ['Ben', '1', '33%'], ['Cem', '1', '33%'], ['Dora', '0', '0%'],
  ], 'every member must stand on the list, most wins first — Dora included at 0');
  assert.deepEqual(got.map((b) => b.crown), [true, false, false, false]);
  assert.deepEqual(got.map((b) => b.lead), [true, false, false, false]);
  assert.equal(got[0].href, `/round/${RID}/member/m1`, 'a bar is the link to that member');
  assert.equal(text(dom.app.querySelector('.pokale-bars__row .pokale-bars__word')), dom.run("tn(3, 'pokale.winWordOne', 'pokale.winWord')"));

  // The bars replace the podium AND its summary line — nobody is left to name.
  assert.equal(dom.app.querySelector('.podium, .podium__rest'), null);
});

test('a young Ocean round keeps the sentence, not the bars', async (t) => {
  const dom = boot(t, 'ocean', roundWith(SESSIONS.slice(0, 2)));
  await dom.call('showRound', RID, 'pokale');
  assert.equal(dom.app.querySelector('.pokale-bars'), null, 'bars off two evenings rank on noise');
  assert.ok(dom.app.querySelector('.pokale-young'));
});

test('Klassisch keeps its podium', async (t) => {
  const dom = boot(t, 'klassisch');
  await dom.call('showRound', RID, 'pokale');
  assert.equal(dom.app.querySelector('.pokale-bars'), null);
  assert.ok(dom.app.querySelector('.podium'));
});

// --- the member page -------------------------------------------------------

test('Ocean puts „Bringt mit" in the card and the attendance under the name', async (t) => {
  const dom = boot(t, 'ocean');
  await dom.call('showMember', RID, 'm1');
  const card = dom.app.querySelector('.member-card');
  assert.ok(card.querySelector('.member-card__lower .member-owned'), 'the owned boxes are not a panel in the card');
  assert.deepEqual([...card.querySelectorAll('.member-owned__name')].map(text), ['Azul', 'Catan']);
  assert.ok(card.querySelector('.member-card__attendance'));

  const klassisch = boot(t, 'klassisch');
  await klassisch.call('showMember', RID, 'm1');
  assert.equal(klassisch.app.querySelector('.member-owned, .member-card__attendance'), null);
});

// --- the off-shelf segments ------------------------------------------------

test('each segment names its destination, so a design can set the suggestions apart', async (t) => {
  const dom = boot(t, 'ocean');
  await dom.call('showRetired', RID);
  const subs = [...dom.app.querySelectorAll('nav.offshelf-seg a')].map((a) => a.dataset.sub);
  assert.deepEqual(subs, ['retired', 'completed', 'wishlist', 'recommendations']);
});

// --- the stylesheet --------------------------------------------------------

// The section runs to the NEXT section header, not to the end of the file: a
// later slice's rules are not #1218's, and #1221's `@keyframes` steps (`from`)
// carry no gate by construction — they are not rules that read tokens.
const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/ocean.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => {
    if (c.includes('===== #1218')) return '/*#1218*/';
    return c.startsWith('/* ===== #') ? '/*§*/' : '';
  });
const AFTER_1218 = SHEET.slice(SHEET.indexOf('/*#1218*/') + '/*#1218*/'.length);
const SECTION = AFTER_1218.includes('/*§*/') ? AFTER_1218.slice(0, AFTER_1218.indexOf('/*§*/')) : AFTER_1218;
const GATE = ':root[data-design="ocean"]:not([data-scheme="dark"])';

// A selector list split at its TOP-LEVEL commas only — `:has(> a, > b)` is one part.
function topLevelParts(selector) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of selector) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

test('every rule of the #1218 section is gated on the light scheme', () => {
  assert.ok(SHEET.includes('/*#1218*/'), 'the section header moved — re-read this test');
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  assert.ok(flat.length > 60, 'the scan found implausibly few rules');
  for (const [selector] of flat) {
    for (const part of topLevelParts(selector)) {
      assert.ok(part.startsWith(GATE), `${part} reads gated tokens without the gate`);
    }
  }
});

test('the offshelf strip is shown, and from 1280px the recap is a third column', () => {
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  assert.equal(declaredValue(bodyOfIn(`${GATE} .offshelf-seg`, flat), 'display'), 'flex');
  const desk = mediaBlocks(SECTION).filter(([q]) => /min-width:\s*1280px/.test(q)).map(([, css]) => css).join('\n');
  const rules = rulesOf(desk);
  const col = rules.find(([sel]) => sel.trim().endsWith('> .precap'));
  assert.ok(col, 'the recap is not placed beside the timeline');
  assert.equal(declaredValue(col[1], 'grid-column'), '3');
  assert.equal(declaredValue(col[1], 'grid-row'), '1 / span 999');
});
