'use strict';

/* Das Programmheft's tier 2a (#1379, P13): the Chronik as an archive of
 * editions with the recap as the black box beside it, the Pokale as podium +
 * table + plaques, the member page with its boxes in the card, the off-shelf
 * lists titled „Nicht im Regal" and the recommendations.
 *
 * Operator ruling „A design owns its layout": the views branch on
 * designIs('programmheft') only, and Klassisch's DOM must not move. That half is
 * a GOLDEN SNAPSHOT of the six screens, generated from the views BEFORE #1379
 * touched them and seen red against a build whose Programmheft branches were
 * made unconditional — a per-selector absence check only sees the classes
 * someone thought to list. Regenerate only for a change that deliberately
 * alters Klassisch:
 *   SPIELWIRBEL_UPDATE_GOLDEN=1 node --test test/programmheft-tier2a.test.js
 *
 * The pixels were judged in a browser at 390 and 1440; what is pinned here is
 * what regresses silently —
 *   - an edition line that loses its game, names a winnerless night as won, or
 *     drops the date that is READ (the phone copy is aria-hidden);
 *   - the recap moving back above the editions;
 *   - the table disagreeing with the podium's places, or with the member
 *     page's own Sessions / Siegquote, or crowning anyone in silver or bronze;
 *   - a rule of the #1379 section reading the gated colour block ungated, or
 *     spelling a colour instead of a token.
 */

process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');

const GOLDEN = path.join(__dirname, 'fixtures', 'programmheft-tier2a-klassisch-golden.json');
const RID = 'r1';
const MEMBERS = [
  { id: 'm1', name: 'Anna' },
  { id: 'm2', name: 'Ben' },
  { id: 'm3', name: 'Cem' },
  { id: 'm4', name: 'Dora' },
];
// g5 is the ONE active game never played, so „Staubfänger" has no tie to break
// at random and the snapshot is deterministic.
const GAMES = [
  { id: 'g1', title: 'Catan', tagIds: [], ownerIds: ['m1'] },
  { id: 'g2', title: 'Azul', tagIds: [], ownerIds: ['m1'] },
  { id: 'g3', title: 'Cascadia', tagIds: [] },
  { id: 'g5', title: 'Kupferzeit', tagIds: [] },
  { id: 'g4', title: 'Monopoly', tagIds: [], retired: true, retiredAt: '2026-06-01T00:00:00.000Z' },
  { id: 'g6', title: 'Heat', tagIds: [], wish: true, wishAt: '2026-06-02T00:00:00.000Z' },
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

/* Anna 3, Ben 1, Cem 1, Dora 0 — a shared second place and a member who never
   won. s4 is voted (a score), s6 is played with no winner. */
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

const ACTIVITIES = [
  { id: 'a1', type: 'game_added', title: 'Kupferzeit', gameId: 'g5', at: '2026-08-12T10:00:00.000Z' },
  { id: 'a2', type: 'game_retired', title: 'Monopoly', gameId: 'g4', at: '2026-06-01T00:00:00.000Z' },
];

const RECS = {
  corpusRows: 100,
  profileGames: 3,
  recommendations: [
    {
      externalId: '1', title: 'Kaskadia', year: 2021, rating: 7.9, weight: 1.8, minPlayers: 1, maxPlayers: 4,
      minPlaytime: 30, maxPlaytime: 45, image: null,
      reasons: [{ term: 'mechanics', games: ['Catan'] }, { term: 'players', players: 4 }],
    },
    {
      externalId: '2', title: 'Die Crew', year: 2019, rating: 7.8, minPlayers: 2, maxPlayers: 5,
      maxPlaytime: 20, image: null, reasons: [{ term: 'quality', rating: 7.8 }],
    },
  ],
  spotlights: [],
  dismissed: [],
};

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
    if (/\/activities$/.test(url)) return ACTIVITIES.map((a) => ({ ...a }));
    if (/\/recommendations$/.test(url)) return JSON.parse(JSON.stringify(RECS));
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  dom.set('toast', () => {});
  return dom;
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const flush = () => new Promise((r) => setImmediate(r));

// --- Klassisch: the golden ---------------------------------------------------

function snapshot(root) {
  const clone = root.cloneNode(true);
  clone.querySelectorAll('.rail, .dock').forEach((n) => n.remove());
  return clone.innerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').replace(/tl-run-\d+/g, 'tl-run-N').trim();
}

async function renderAll(t, design) {
  const out = {};
  const screens = [
    ['chronik', (dom) => dom.call('showRound', RID, 'chronik')],
    ['pokale', (dom) => dom.call('showRound', RID, 'pokale')],
    ['member', (dom) => dom.call('showMember', RID, 'm1')],
    ['retired', (dom) => dom.call('showRetired', RID)],
    ['wishlist', (dom) => dom.call('showWishlist', RID)],
    ['recommendations', (dom) => dom.call('showRecommendations', RID)],
  ];
  for (const [name, show] of screens) {
    const dom = boot(t, design);
    await show(dom);
    await flush();
    out[name] = snapshot(dom.app);
  }
  return out;
}

test('Klassisch: Chronik, Pokale, member page, off-shelf lists and recommendations render exactly as before #1379', async (t) => {
  const now = await renderAll(t, 'klassisch');
  if (process.env.SPIELWIRBEL_UPDATE_GOLDEN === '1') {
    fs.writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.deepEqual(Object.keys(now), Object.keys(golden));
  for (const k of Object.keys(golden)) {
    assert.ok(golden[k].length > 200, `the golden for ${k} is implausibly small — the render did not happen`);
    assert.equal(now[k], golden[k], `Klassisch ${k} changed`);
  }
});

test('the snapshot can see Programmheft: those screens under it are NOT the golden', async (t) => {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const ph = await renderAll(t, 'programmheft');
  for (const k of ['chronik', 'pokale', 'member', 'retired', 'recommendations']) {
    assert.notEqual(ph[k], golden[k], `Programmheft's ${k} is identical to Klassisch's`);
  }
});

// --- the Chronik -------------------------------------------------------------

test('Programmheft sets each session as an edition: date, cover, game, who won, the score', async (t) => {
  const dom = boot(t, 'programmheft');
  await dom.call('showRound', RID, 'chronik');
  const rows = [...dom.app.querySelectorAll('.timeline .session-card--edition')];
  assert.equal(rows.length, SESSIONS.length, 'one edition per played session');
  const at = (iso) => rows.find((r) => r.querySelector(`time[datetime="${iso}"]`));

  const won = at('2026-08-09T20:00:00.000Z');
  assert.ok(won, 'the date column is missing');
  assert.equal(text(won.querySelector('.session-card__title')), 'Cascadia');
  assert.equal(text(won.querySelector('.session-card__won')), dom.run("tn(1, 'chronik.wonOne', 'chronik.won', { names: 'Cem' })"));
  assert.ok(text(won.querySelector('.session-card__meta')).includes(dom.run("tn(4, 'chronik.seatedOne', 'chronik.seated')")));
  assert.ok(text(won.querySelector('.session-card__meta')).includes(dom.run("tn(2, 'home.chip.gamesOne', 'home.chip.games')")));
  assert.ok(won.querySelector('.session-card__img'), 'the cover slot is missing');
  assert.ok(won.querySelector('.score-pill[data-stop]'), 'the score is missing');
  assert.equal(won.getAttribute('href'), `/round/${RID}/session/s4`);
  // The date is read ONCE: the column. The phone's copy in the sub-line is
  // aria-hidden, so the link's name does not say it twice.
  const day = dom.run("new Date('2026-08-09T20:00:00.000Z').toLocaleString(localeTag(locale), { day: 'numeric', month: 'long' })");
  assert.equal(text(won.querySelector('time.session-card__date')), day);
  assert.equal(won.querySelector('.session-card__when').getAttribute('aria-hidden'), 'true');
  assert.equal(won.firstElementChild.tagName, 'TIME', 'the date leads the line (DOM order = visual order)');

  const plain = at('2026-08-20T20:00:00.000Z');
  assert.equal(plain.querySelector('.session-card__won'), null, 'a winnerless night is not „won"');
  assert.ok(text(plain.querySelector('.session-card__meta')).includes(dom.run("t('sessions.played')")));
});

test('Programmheft puts the editions before the recap, names the span and draws the recap figures as tiles', async (t) => {
  const dom = boot(t, 'programmheft');
  await dom.call('showRound', RID, 'chronik');
  const log = dom.app.querySelector('.timeline').closest('.section');
  const recap = dom.app.querySelector('.precap');
  assert.ok(log && recap);
  assert.ok(log.compareDocumentPosition(recap) & 4, 'the recap comes before the editions');
  assert.ok(dom.app.querySelector('.section-head .chronik__count'));
  assert.ok(recap.querySelector('.stat-chip--tile .stat-chip__n'), 'the recap totals are not number tiles');
  assert.equal(dom.app.querySelector('.tl-dot--session') !== null, true, 'the timeline items keep their markup');
});

// --- the Pokale --------------------------------------------------------------

test('Programmheft: „Pokale" titles the page, „Ruhmeshalle" heads the podium, the table sits beside it', async (t) => {
  const dom = boot(t, 'programmheft');
  await dom.call('showRound', RID, 'pokale');
  assert.equal(text(dom.app.querySelector('.section-head h1')), 'Pokale');
  const stage = dom.app.querySelector('.pokale-split > .pokale-split__stage');
  const side = dom.app.querySelector('.pokale-split > .pokale-split__side');
  assert.ok(stage && side, 'no split');
  assert.equal(text(stage.querySelector('h2.pokale-split__kicker')), 'Ruhmeshalle');
  assert.ok(stage.querySelector('.podium'), 'the podium left the stage');
  assert.ok(side.querySelector('.pokale-table'), 'the table is not in the side column');
  assert.ok(side.querySelector('.pokale-cards'), 'the plaques are not under the table');
  assert.ok(side.querySelector('.pokale-table').compareDocumentPosition(side.querySelector('.pokale-cards')) & 4);
  assert.equal(dom.app.querySelector('.podium__rest'), null, 'the table names everyone, so no summary line');
});

test('the table ranks every member like the podium, with the member page\'s Sessions and Siegquote', async (t) => {
  const dom = boot(t, 'programmheft');
  await dom.call('showRound', RID, 'pokale');
  const heads = [...dom.app.querySelectorAll('.pokale-table thead th')].map(text);
  assert.deepEqual(heads, [
    dom.run("t('pokale.col.place')"), dom.run("t('pokale.col.name')"),
    dom.run("t('member.wins')"), dom.run("t('member.sessions')"), dom.run("t('member.winRate')"),
  ]);
  const rows = [...dom.app.querySelectorAll('.pokale-table tbody tr')].map((r) => [...r.children].map(text));
  const stat = (mid) => {
    const s = dom.call('memberStats', roundWith(SESSIONS), mid);
    return [String(s.joined), s.winRate === null ? '–' : Math.round(s.winRate * 100) + '%'];
  };
  assert.deepEqual(rows, [
    ['1', 'Anna', '3', ...stat('m1')],
    ['2', 'Ben', '1', ...stat('m2')],
    ['2', 'Cem', '1', ...stat('m3')],
    ['–', 'Dora', '0', ...stat('m4')],
  ]);
  assert.equal(dom.app.querySelectorAll('.pokale-table tr.is-lead').length, 1, 'only the leader wears the gold row');
  assert.equal(dom.app.querySelector('.pokale-table tbody a').getAttribute('href'), `/round/${RID}/member/m1`);
});

test('a young Programmheft round keeps the sentence: no kicker, no podium, no table', async (t) => {
  const dom = boot(t, 'programmheft', roundWith(SESSIONS.slice(0, 2)));
  await dom.call('showRound', RID, 'pokale');
  assert.ok(dom.app.querySelector('.pokale-young'));
  assert.equal(dom.app.querySelector('.pokale-table, .pokale-split__kicker, .podium'), null);
});

// --- the member page and the off-shelf strip ---------------------------------

test('Programmheft puts „Gehört Anna" in the card', async (t) => {
  const dom = boot(t, 'programmheft');
  await dom.call('showMember', RID, 'm1');
  const card = dom.app.querySelector('.member-card');
  assert.ok(card.querySelector('.member-card__lower .member-owned'));
  assert.ok(card.querySelector('.member-card__attendance'));
});

test('the off-shelf screens are titled „Nicht im Regal", each tab its name beside its count', async (t) => {
  for (const [show, sub] of [['showRetired', 'retired'], ['showRecommendations', 'recommendations']]) {
    const dom = boot(t, 'programmheft');
    await dom.call(show, RID);
    const nav = dom.app.querySelector('nav.offshelf-seg');
    assert.equal(text(nav.querySelector('.offshelf-seg__title')), 'Nicht im Regal');
    assert.equal(nav.querySelector('.offshelf-seg__title').getAttribute('aria-hidden'), 'true');
    const tabs = [...nav.querySelectorAll('a')].map((a) => [a.dataset.sub, text(a.querySelector('.offshelf-seg__name')), text(a.querySelector('.offshelf-seg__n'))]);
    assert.deepEqual(tabs, [
      ['retired', 'Aussortiert', '1'],
      ['completed', 'Durchgespielt', '0'],
      ['wishlist', 'Wunschliste', '1'],
      ['recommendations', dom.run("t('suggest.link')"), ''],
    ]);
    assert.equal(nav.querySelector('a.is-on').dataset.sub, sub);
  }
});

test('the recommendation reasons are the recommender\'s own, not the sheet\'s copy (P9.5)', async (t) => {
  const dom = boot(t, 'programmheft');
  await dom.call('showRecommendations', RID);
  const why = [...dom.app.querySelectorAll('.rec-list .rec-card')[0].querySelectorAll('.rec-card__why li')].map(text);
  assert.deepEqual(why, [
    dom.run("t('suggest.reason.mechanics', { games: joinNames(['Catan']) })"),
    dom.run("tn(4, 'suggest.reason.playersOne', 'suggest.reason.players')"),
  ]);
});

// --- the stylesheet ----------------------------------------------------------

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/programmheft.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => {
    if (c.includes('===== #1379')) return '/*#1379*/';
    return c.startsWith('/* ===== #') ? '/*§*/' : '';
  });
const AFTER = SHEET.slice(SHEET.indexOf('/*#1379*/') + '/*#1379*/'.length);
const SECTION = AFTER.includes('/*§*/') ? AFTER.slice(0, AFTER.indexOf('/*§*/')) : AFTER;
const GATE = ':root[data-design="programmheft"]:not([data-scheme="dark"])';

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

test('every rule of the #1379 section is gated on the light scheme', () => {
  assert.ok(SHEET.includes('/*#1379*/'), 'the section header moved — re-read this test');
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  assert.ok(flat.length > 60, `the scan found implausibly few rules (${flat.length})`);
  for (const [selector] of flat) {
    for (const part of topLevelParts(selector)) {
      assert.ok(part.startsWith(GATE), `${part} reads gated tokens without the gate`);
    }
  }
});

test('the #1379 section spells no colour, and introduces no silver or bronze', () => {
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  const literal = flat.filter(([, body]) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(body)).map(([sel]) => sel);
  assert.deepEqual(literal, []);
  assert.doesNotMatch(SECTION, /silver|bronze/i);
});
