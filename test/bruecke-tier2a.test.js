'use strict';

/* Die Brücke's tier 2a (#1245, B13 + B3.3/B3.4 + B6.1–B6.8): the Chronik as a
 * log with column heads, the recap's number tiles, the Pokale as a ranked
 * board with plaques beside it, the member page and the titled off-shelf tabs.
 *
 * Rendered through the jsdom harness under Brücke AND Klassisch — every Brücke
 * branch must be absent from the default path. The pixels were judged in a
 * browser at 390 and 1440; what is pinned here is what regresses silently:
 *
 *   - a log line that loses its winner, names a winnerless night as won, or
 *     drops the veto line („1× kein Schub", B3.3);
 *   - the board dropping a member, crowning anyone, or losing its places;
 *   - the off-shelf tabs growing a group count (the three lists are not one
 *     inventory — the issue says so in as many words);
 *   - a rule of the #1245 section reading a gated colour token ungated.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');

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
  { id: 'g4', title: 'Monopoly', tagIds: [], retired: true, retiredAt: '2026-06-01T00:00:00.000Z' },
  { id: 'g5', title: 'Heat', tagIds: [], wish: true, wishedAt: '2026-06-02T00:00:00.000Z' },
];

const vote = (r) => ({ rating: r });
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

/* Anna 3, Ben 1, Cem 1, Dora 0 — a shared second place, and a member who never
   won, so the tie-aware places and the „stands at 0" row are both in view. s4
   carries ONE veto on the chosen game (Dora's 1), s6 is played with no winner. */
const SESSIONS = [
  played('s1', 'g1', '2026-07-03T20:00:00.000Z', ['m1']),
  played('s2', 'g2', '2026-07-10T20:00:00.000Z', ['m2']),
  played('s3', 'g1', '2026-08-02T20:00:00.000Z', ['m1']),
  played('s4', 'g3', '2026-08-09T20:00:00.000Z', ['m3'], {
    gameIds: ['g3', 'g1'],
    votes: { m1: { g3: vote(4) }, m2: { g3: vote(5) }, m3: { g3: vote(4) }, m4: { g3: vote(1) } },
    votedIds: ['m1', 'm2', 'm3', 'm4'],
  }),
  played('s5', 'g1', '2026-08-16T20:00:00.000Z', ['m1']),
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

// --- the Chronik -----------------------------------------------------------

test('Brücke logs each session: date, game, who won, games drawn, score', async (t) => {
  const dom = boot(t, 'bruecke');
  await dom.call('showRound', RID, 'chronik');
  const rows = [...dom.app.querySelectorAll('.timeline .session-card--log')];
  assert.equal(rows.length, SESSIONS.length, 'one log line per played session');
  const at = (iso) => rows.find((r) => r.querySelector(`time[datetime="${iso}"]`));

  const won = at('2026-08-09T20:00:00.000Z');
  assert.equal(text(won.querySelector('.session-card__title')), 'Cascadia');
  assert.equal(text(won.querySelector('.session-card__won')), dom.run("tn(1, 'chronik.wonOne', 'chronik.won', { names: 'Cem' })"));
  assert.equal(text(won.querySelector('.session-card__drawn')), dom.run("tn(2, 'home.chip.gamesOne', 'home.chip.games')"));
  assert.equal(won.getAttribute('href'), `/round/${RID}/session/s4`, 'the line is not the link to its result');
  assert.ok(won.querySelector('.score-pill[data-stop]'), 'the score pill is missing');
  assert.equal(text(won.querySelector('.session-card__full')), dom.run("new Date('2026-08-09T20:00:00.000Z').toLocaleDateString(localeTag(locale), { day: '2-digit', month: '2-digit', year: 'numeric' })"));
  assert.equal(won.querySelector('.session-card__day').getAttribute('aria-hidden'), 'true',
    'the stacked phone date repeats the full one and must stay out of the link name');

  // B3.3's sub-line, in the scale-end words: one 1 on the chosen game.
  assert.equal(text(won.querySelector('.session-card__vetoes')), dom.run("tn(1, 'chronik.noThrustOne', 'chronik.noThrust', { n: 1 })"));
  assert.equal(text(won.querySelector('.session-card__vetoes')), '1× kein Schub');
  assert.equal(at('2026-08-16T20:00:00.000Z').querySelector('.session-card__vetoes'), null, 'a night without a veto prints none');

  // A winnerless night says how it ended — never „hat gewonnen".
  const plain = at('2026-08-20T20:00:00.000Z');
  assert.equal(plain.querySelector('.session-card__won'), null);
  assert.equal(text(plain.querySelector('.session-card__who')), dom.run("t('sessions.played')"));
});

test('the log has column heads, hidden from assistive tech, and the span beside the title', async (t) => {
  const dom = boot(t, 'bruecke');
  await dom.call('showRound', RID, 'chronik');
  const cols = dom.app.querySelector('.chronik-cols');
  assert.ok(cols, 'no column heads');
  assert.equal(cols.getAttribute('aria-hidden'), 'true');
  assert.deepEqual([...cols.children].map(text), ['Datum', 'Spiel', 'Sieger', 'Spiele gezogen', 'Score']);
  assert.ok(dom.app.querySelector('.section-head .chronik__count'));
  assert.ok(dom.app.querySelector('.precap .stat-chip--tile .stat-chip__n'), 'the recap totals are not number tiles');
});

// B6.1 puts the log FIRST on the phone and the recap after it. The phone is a
// single column in DOM order, so the order is the markup's; the desktop grid
// places the recap in its own column whichever comes first.
const logBeforeRecap = (dom) => {
  const log = dom.app.querySelector('.timeline').closest('.section');
  const recap = dom.app.querySelector('.precap');
  assert.ok(log && recap, 'the screen needs both the log and the recap');
  return Boolean(log.compareDocumentPosition(recap) & 4); // DOCUMENT_POSITION_FOLLOWING
};

test('Brücke puts the log before the period recap (B6.1)', async (t) => {
  const dom = boot(t, 'bruecke');
  await dom.call('showRound', RID, 'chronik');
  assert.equal(logBeforeRecap(dom), true, 'the recap comes before the log');
});

test('Klassisch and Ocean keep the recap above the log', async (t) => {
  for (const design of ['klassisch', 'ocean']) {
    const dom = boot(t, design);
    await dom.call('showRound', RID, 'chronik');
    assert.equal(logBeforeRecap(dom), false, `${design} moved its recap below the log`);
  }
});

test('Klassisch keeps its cards and chips', async (t) => {
  const dom = boot(t, 'klassisch');
  await dom.call('showRound', RID, 'chronik');
  assert.equal(dom.app.querySelector('.session-card--log, .chronik-cols, .stat-chip--tile, .chronik__count'), null);
  assert.equal(dom.app.querySelectorAll('.timeline .session-card').length, SESSIONS.length);
});

// --- the Pokale ------------------------------------------------------------

test('Brücke ranks every member with their place and no crown, plaques beside', async (t) => {
  const dom = boot(t, 'bruecke');
  await dom.call('showRound', RID, 'pokale');
  const rows = [...dom.app.querySelectorAll('.pokale-bars__row')].map((r) => [
    text(r.querySelector('.pokale-bars__rank')),
    text(r.querySelector('.pokale-bars__name')),
    text(r.querySelector('.pokale-bars__n')),
  ]);
  assert.deepEqual(rows, [['1', 'Anna', '3'], ['2', 'Ben', '1'], ['2', 'Cem', '1'], ['–', 'Dora', '0']],
    'every member on the board, a tie sharing its place, Dora at 0 with no place');
  assert.equal(dom.app.querySelector('.pokale-bars .ti-crown'), null, 'the lead is the cyan place, not a crown');
  assert.ok(dom.app.querySelector('.pokale-bars__row.is-lead'));
  assert.ok(dom.app.querySelector('.pokale-split .pokale-split__stage .pokale-bars'), 'the board sits in the split\'s stage');
  assert.equal(dom.app.querySelector('.podium'), null);
  assert.equal(text(dom.app.querySelector('.section-head h1')), 'Pokale', 'the page carries the tab\'s word (B3.4)');
});

test('a young Brücke round keeps the sentence; Ocean keeps its crowned bars without places', async (t) => {
  const young = boot(t, 'bruecke', roundWith(SESSIONS.slice(0, 2)));
  await young.call('showRound', RID, 'pokale');
  assert.equal(young.app.querySelector('.pokale-bars'), null);
  assert.ok(young.app.querySelector('.pokale-young'));

  const ocean = boot(t, 'ocean');
  await ocean.call('showRound', RID, 'pokale');
  assert.equal(ocean.app.querySelector('.pokale-bars__rank'), null);
  assert.ok(ocean.app.querySelector('.pokale-bars .ti-crown'));
  assert.equal(text(ocean.app.querySelector('.section-head h1')), 'Ruhmeshalle', 'other designs keep their title');
});

// --- the member page -------------------------------------------------------

test('Brücke puts „Bringt mit" in the card, with the win count among the figures', async (t) => {
  const dom = boot(t, 'bruecke');
  await dom.call('showMember', RID, 'm1');
  const card = dom.app.querySelector('.member-card');
  assert.ok(card.querySelector('.member-card__lower .member-owned'));
  assert.ok(card.querySelector('.member-card__attendance'));
  const figures = [...card.querySelectorAll('.member-figure')].map((f) => [text(f.querySelector('.member-figure__label')), text(f.querySelector('.member-figure__value'))]);
  assert.ok(figures.some(([, v]) => v === '3'), `Anna's three wins are not on the card: ${JSON.stringify(figures)}`);
});

// --- the off-shelf tabs ----------------------------------------------------

test('the off-shelf tabs are titled „Nicht im Regal", name over count, and carry no group sum', async (t) => {
  const dom = boot(t, 'bruecke');
  await dom.call('showRetired', RID);
  const nav = dom.app.querySelector('nav.offshelf-seg');
  const title = nav.querySelector('.offshelf-seg__title');
  assert.equal(text(title), 'Nicht im Regal');
  assert.equal(title.getAttribute('aria-hidden'), 'true', 'the nav label already says it');
  const tabs = [...nav.querySelectorAll('a')].map((a) => [a.dataset.sub, text(a.querySelector('.offshelf-seg__name')), text(a.querySelector('.offshelf-seg__n'))]);
  assert.deepEqual(tabs, [
    ['retired', 'Aussortiert', '1'],
    ['completed', 'Durchgespielt', '0'],
    ['wishlist', 'Wunschliste', '1'],
    ['recommendations', dom.run("t('suggest.link')"), ''],
  ]);
  assert.equal(nav.querySelector('a.is-on').getAttribute('href'), `/round/${RID}/retired`, 'each tab keeps its own route');
  assert.equal(nav.querySelectorAll('.offshelf-seg__n').length, 3, 'a count beyond the three lists would be a sum');

  const klassisch = boot(t, 'klassisch');
  await klassisch.call('showRetired', RID);
  assert.equal(klassisch.app.querySelector('.offshelf-seg__title, .offshelf-seg__name'), null);
});

// --- the stylesheet --------------------------------------------------------

const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/bruecke.css'), 'utf8');
const SHEET = RAW.replace(/\/\*[\s\S]*?\*\//g, (c) => {
  if (c.includes('===== #1245')) return '/*#1245*/';
  return c.startsWith('/* ===== #') ? '/*§*/' : '';
});
const AFTER = SHEET.slice(SHEET.indexOf('/*#1245*/') + '/*#1245*/'.length);
const SECTION = AFTER.includes('/*§*/') ? AFTER.slice(0, AFTER.indexOf('/*§*/')) : AFTER;
const VOICE = ':root[data-design="bruecke"]';
const DARK = ':root[data-design="bruecke"][data-scheme="dark"]';

// Every custom property the gated colour block declares.
const GATED_TOKENS = (() => {
  const body = rulesOf(SHEET).find(([sel]) => sel.trim() === DARK)[1];
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
})();

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

test('every #1245 rule is scoped to Brücke, and every one reading a colour token is dark-gated', () => {
  assert.ok(SHEET.includes('/*#1245*/'), 'the section header moved — re-read this test');
  assert.ok(GATED_TOKENS.has('--ink-soft') && GATED_TOKENS.size > 30, 'the gated block was not found');
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  assert.ok(flat.length > 80, 'the scan found implausibly few rules');
  let gatedReads = 0;
  for (const [selector, body] of flat) {
    const reads = [...body.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]).filter((v) => GATED_TOKENS.has(v));
    for (const part of topLevelParts(selector)) {
      assert.ok(part.startsWith(VOICE), `${part} is not scoped to Brücke`);
      if (reads.length) assert.ok(part.startsWith(DARK), `${part} reads ${reads.join(', ')} without the dark gate`);
    }
    if (reads.length) gatedReads++;
  }
  assert.ok(gatedReads > 20, 'the scan saw implausibly few colour reads');
});
