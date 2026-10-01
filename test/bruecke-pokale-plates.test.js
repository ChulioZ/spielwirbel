'use strict';

/* Die Brücke's Pokale right column (#1422, B3.4/B6.2): three plates — „Bestes
 * Spiel", „Längste Serie", „Meiste Vetos" — in place of the four trophy cards.
 *
 * Rendered through the jsdom harness under Brücke AND Klassisch. What is pinned
 * is what regresses silently: a plate reading a different figure than the
 * screen one tap away (the Regal's top game, the Spielepass's play and
 * „kein Schub" counts), the record streak collapsing into the CURRENT one, a
 * retired game topping the veto plate, and any of it leaking into Klassisch.
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
  { id: 'g1', title: 'Catan', tagIds: [] },
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

/* Anna wins three in a row (Feb–Mar), then Ben two (Apr) and still going — so
   the record (Anna 3) and the current streak (Ben 2) differ. Catan is the best
   rated and played three times. Azul draws two 1s in s1 and one in s4: three
   „kein Schub". Monopoly draws four in s3, and is retired — it must not win. */
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
const plates = (dom) => [...dom.app.querySelectorAll('.pokale-card--plate')].map((c) => ({
  label: text(c.querySelector('.pokale-card__label')),
  value: text(c.querySelector('.pokale-card__value')),
  sub: text(c.querySelector('.pokale-card__sub')),
  hrefs: [...c.querySelectorAll('.pokale-card__value a')].map((a) => a.getAttribute('href')),
}));

test('Brücke sets B3.4’s three plates beside the board, in the sheet’s order', async (t) => {
  const dom = boot(t, 'bruecke');
  await dom.call('showRound', RID, 'pokale');
  const col = dom.app.querySelector('.pokale-split > .pokale-cards--plates');
  assert.ok(col, 'the plates are not the split’s right column');
  const [best, streak, vetoes] = plates(dom);
  assert.deepEqual(plates(dom).map((p) => p.label), ['Bestes Spiel', 'Längste Serie', 'Meiste Vetos']);

  // The Bestbewertet card's own pick, with the Spielepass's play count.
  assert.equal(best.value, 'Catan');
  const score = dom.run(`fmtAvg(displayScore(roundScoreIndex(${JSON.stringify(roundWith(SESSIONS))}).byGame.g1.score))`);
  assert.equal(best.sub, `${score} · 3× gespielt`);
  assert.match(best.hrefs[0], /g1/);

  // The RECORD, not the run still going (Ben's 2).
  assert.equal(streak.value, 'Anna · 3');
  assert.equal(streak.sub, 'Februar bis März 2026');
  assert.match(streak.hrefs[0], /m1/);

  // Azul's three 1s — Monopoly's four do not count, it is retired.
  assert.equal(vetoes.value, 'Azul');
  assert.equal(vetoes.sub, '3× kein Schub');
  assert.match(vetoes.hrefs[0], /g2/);
});

test('the four trophy cards stand down under Brücke and stay under Klassisch', async (t) => {
  const bruecke = boot(t, 'bruecke');
  await bruecke.call('showRound', RID, 'pokale');
  const labels = (dom) => [...dom.app.querySelectorAll('.section:first-of-type .pokale-card__label')].map(text);
  assert.ok(!labels(bruecke).includes('Meistgespielt'), 'the Klassisch cards leaked into Brücke’s column');
  assert.equal(bruecke.app.querySelector('.pokale-split .pokale-card__thumb'), null, 'a plate draws no cover');

  const klassisch = boot(t, 'klassisch');
  await klassisch.call('showRound', RID, 'pokale');
  assert.equal(klassisch.app.querySelector('.pokale-card--plate, .pokale-cards--plates'), null);
  assert.ok(labels(klassisch).includes('Meistgespielt'));
  assert.ok(labels(klassisch).includes('Siegesserie'));
});

test('a young round holds the record streak back, as it does the current one', async (t) => {
  const dom = boot(t, 'bruecke', roundWith(SESSIONS.slice(0, 2)));
  await dom.call('showRound', RID, 'pokale');
  assert.ok(!plates(dom).some((p) => p.label === 'Längste Serie'));
});

test('the streak span names the year once, twice across a new year, and a single month once', (t) => {
  const dom = boot(t, 'bruecke');
  assert.equal(dom.run("brueckeStreakSpan('2026-02-05T20:00:00.000Z', '2026-03-12T20:00:00.000Z')"), 'Februar bis März 2026');
  assert.equal(dom.run("brueckeStreakSpan('2025-12-04T20:00:00.000Z', '2026-02-05T20:00:00.000Z')"), 'Dezember 2025 bis Februar 2026');
  assert.equal(dom.run("brueckeStreakSpan('2026-03-05T20:00:00.000Z', '2026-03-26T20:00:00.000Z')"), 'März 2026');
});

// --- the stylesheet --------------------------------------------------------

test('every #1422 rule is scoped to Brücke, and every one reading a colour token is dark-gated', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { rulesOf } = require('./support/css');
  const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/bruecke.css'), 'utf8');
  const SHEET = RAW.replace(/\/\*[\s\S]*?\*\//g, (c) => {
    if (c.includes('===== #1422')) return '/*#1422*/';
    return c.startsWith('/* ===== #') ? '/*§*/' : '';
  });
  assert.ok(SHEET.includes('/*#1422*/'), 'the section header moved — re-read this test');
  const after = SHEET.slice(SHEET.indexOf('/*#1422*/') + '/*#1422*/'.length);
  const section = after.slice(0, after.indexOf('/*§*/'));
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
