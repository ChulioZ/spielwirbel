'use strict';

/* Forest's Regal, Spielepass and add-game lookup (#1467, sheets
 * Forest-F3-Runde-Desktop F3.3–F3.5, Forest-F6-Phone-Rest F6.2–F6.4 and
 * Forest-F7-Leerzustaende F7.8).
 *
 * Operator ruling „A design owns its layout": the views branch on
 * designIs('forest') only, and Klassisch's DOM must not move. That half is a
 * GOLDEN SNAPSHOT of the screens, generated from the views BEFORE #1467 touched
 * them, and seen red against a build whose Forest branches were made
 * unconditional. Regenerate only for a change that deliberately alters
 * Klassisch:
 *   SPIELWIRBEL_UPDATE_GOLDEN=1 node --test test/forest-regal.test.js
 *
 * The pixels were judged in headless Chromium at 390 and 1440; what is pinned
 * here is what regresses silently —
 *   - text landing on a cover (review rule T3): the score or the expansion
 *     count back in the frame;
 *   - the sort offering anything but the app's three orders;
 *   - the Spielepass's figures disagreeing with the sessions, a guest winner
 *     losing the guest marker, or the score's explanation becoming a paraphrase;
 *   - a block that is reachable today (the raters, the history, the actions,
 *     the source link) going missing under Forest;
 *   - the lookup's two ways out losing the app's words, or the BGG badge its
 *     link;
 *   - a rule of the #1467 section reading the gated colour block ungated, or
 *     spelling a colour instead of a token.
 */

process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');

const GOLDEN = path.join(__dirname, 'fixtures', 'forest-regal-klassisch-golden.json');
const RID = 'r1';
const MEMBERS = [
  { id: 'm1', name: 'Anna' },
  { id: 'm2', name: 'Ben' },
  { id: 'm3', name: 'Cem' },
];
const LONG = 'Kartographen des Nordens Deluxe Edition';
const GAMES = [
  {
    id: 'g1', title: 'Catan', tagIds: [], ownerIds: ['m1'], image: '/uploads/catan.jpg', minPlayers: 3, maxPlayers: 4,
    minPlaytime: 60, maxPlaytime: 90, expansions: [{ id: 'e1', title: 'Seefahrer', minPlayers: 5, maxPlayers: 6 }],
    source: { provider: 'bgg', externalId: '13', url: 'https://boardgamegeek.com/boardgame/13' },
  },
  { id: 'g2', title: 'Azul', tagIds: [], ownerIds: ['m2'], image: '/uploads/azul.jpg', minPlayers: 2, maxPlayers: 4 },
  { id: 'g3', title: LONG, tagIds: [] },
  { id: 'g4', title: 'Monopoly', tagIds: [], retired: true, retiredAt: '2026-06-01T00:00:00.000Z' },
  { id: 'g6', title: 'Heat', tagIds: [], wish: true, wishAt: '2026-06-02T00:00:00.000Z', source: { provider: 'bgg', externalId: '366013' } },
];

const vote = (r) => ({ rating: r });
const played = (id, gid, at, winnerIds, extra = {}) => ({
  id,
  createdAt: at,
  gameIds: [gid, 'g2'],
  memberIds: ['m1', 'm2', 'm3'],
  votes: { m1: { [gid]: vote(5) }, m2: { [gid]: vote(4) } },
  votedIds: ['m1', 'm2'],
  finished: true,
  cancelled: false,
  done: true,
  winnerIds,
  chosenGameId: gid,
  events: [],
  ...extra,
});

/* Catan played three times: Anna won twice, a guest once — so „most wins" is
   Anna · 2 and the guest must not leak in as a member. s4 was cancelled and
   counts for nothing. */
const SESSIONS = [
  played('s1', 'g1', '2026-07-03T20:00:00.000Z', ['m1']),
  played('s2', 'g1', '2026-07-10T20:00:00.000Z', ['x1'], { guests: [{ id: 'x1', name: 'Gil' }] }),
  played('s3', 'g1', '2026-08-02T20:00:00.000Z', ['m1']),
  played('s4', 'g1', '2026-08-09T20:00:00.000Z', [], { finished: false, cancelled: true, chosenGameId: null }),
];

const roundWith = (games = GAMES, sessions = SESSIONS) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: MEMBERS,
  games,
  sessions,
});

function boot(t, design, round = roundWith()) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/\/provider-info$/.test(url)) return {};
    if (/\/prices/.test(url)) return { available: false };
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('toast', () => {});
  return dom;
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const flush = () => new Promise((r) => setImmediate(r));

// --- Klassisch: the golden ---------------------------------------------------

function snapshot(root) {
  const clone = root.cloneNode(true);
  clone.querySelectorAll('.rail, .dock').forEach((n) => n.remove());
  return clone.innerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
}

const SCREENS = [
  ['regal', async (dom) => { await dom.call('showRound', RID, 'regal'); return dom.app; }],
  ['regalEmpty', async (dom) => {
    dom.set('api', async (m, url) => (/^\/api\/rounds\/[^/]+$/.test(url) ? roundWith([], []) : []));
    await dom.call('showRound', RID, 'regal');
    return dom.app;
  }],
  ['pass', async (dom) => { await dom.call('showGameDetail', RID, 'g1'); return dom.app; }],
  ['passSparse', async (dom) => { await dom.call('showGameDetail', RID, 'g3'); return dom.app; }],
  ['passRetired', async (dom) => { await dom.call('showGameDetail', RID, 'g4'); return dom.app; }],
  ['passWish', async (dom) => { await dom.call('showGameDetail', RID, 'g6'); return dom.app; }],
  ['addGame', async (dom) => {
    dom.call('showAddGame', roundWith());
    return dom.document.querySelector('.sheet-backdrop');
  }],
];

async function renderAll(t, design) {
  const out = {};
  for (const [name, show] of SCREENS) {
    const dom = boot(t, design);
    const root = await show(dom);
    await flush();
    out[name] = snapshot(root);
  }
  return out;
}

test('Klassisch: the Regal, the Spielepass and the add-game sheet render exactly as before #1467', async (t) => {
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

test('the snapshot can see Forest: those screens under it are NOT the golden', async (t) => {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const forest = await renderAll(t, 'forest');
  for (const k of ['regal', 'pass', 'passWish', 'addGame']) {
    assert.notEqual(forest[k], golden[k], `Forest's ${k} is identical to Klassisch's`);
  }
});

// --- the Regal ---------------------------------------------------------------

test('Forest\'s Regal: „Regal" with its count, the sort says exactly Zufällig · Name · Bewertung', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showRound', RID, 'regal');
  const sec = dom.app.querySelector('.section.forest-regal');
  assert.ok(sec, 'no Forest Regal section');
  assert.equal(text(sec.querySelector('.regal-title h1')), dom.run("t('hub.tab.regal')"));
  assert.equal(text(sec.querySelector('.regal-title__count')), dom.run("tn(3, 'home.chip.gamesOne', 'home.chip.games')"));
  const sel = sec.querySelector('.regal-sort .sort-select');
  assert.deepEqual([...sel.options].map((o) => o.textContent), ['Zufällig', 'Name', 'Bewertung']);
  assert.deepEqual([...sel.options].map((o) => o.value), ['random', 'name', 'avg']);
  assert.equal(text(sec.querySelector('.regal-sort__prefix')), dom.run("t('games.sortedBy')"));
  assert.equal(sec.querySelector('.regal-sort__prefix').getAttribute('aria-hidden'), 'true');
});

test('Forest\'s toolbar reads in F3.3\'s order: search, sort, ⓘ, „Auswählen", the BGG import, the phone „…", the add', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showRound', RID, 'regal');
  const tools = [...dom.app.querySelectorAll('.forest-regal .regal-head .section-tools > *')];
  const kind = (el) => {
    if (el.classList.contains('search-pill')) return 'search';
    if (el.classList.contains('regal-sort')) return 'sort';
    if (el.classList.contains('score-info')) return 'info';
    if (el.classList.contains('fbar__trigger')) return 'filter';
    if (el.classList.contains('regal-more')) return 'more';
    if (el.classList.contains('regal-add--bar')) return 'add';
    if (el.querySelector('.ti-checkbox')) return 'select';
    if (el.querySelector('.ti-download')) return 'import';
    return el.className;
  };
  const order = tools.map(kind).filter((k) => k !== 'filter');
  assert.deepEqual(order, ['search', 'sort', 'info', 'select', 'import', 'more', 'add']);
  assert.ok(tools.find((el) => kind(el) === 'select').classList.contains('regal-tool--wide'));
  assert.ok(tools.find((el) => kind(el) === 'import').classList.contains('regal-tool--wide'));
  // The phone's copy of the add comes after the grid; the dashed tile closes it.
  const sec = dom.app.querySelector('.forest-regal');
  const grid = sec.querySelector('.cards');
  const dock = sec.querySelector('.regal-add--dock');
  assert.ok(dock && (grid.compareDocumentPosition(dock) & 4), 'the phone add is not after the grid');
  assert.ok(grid.lastElementChild.classList.contains('add-tile'), 'the dashed tile no longer closes the grid');
});

test('no text on a cover: the title, the score and the owner sit on the card under the hollow', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showRound', RID, 'regal');
  const cards = [...dom.app.querySelectorAll('.forest-regal .cards > .forest-card')];
  assert.equal(cards.length, 3, 'one card per active game');
  for (const c of cards) {
    const frame = c.querySelector('.forest-card__well > .game-card__img');
    assert.ok(frame, 'the frame must stand in the hollow');
    assert.equal(frame.querySelector('.score-pill, .exp-pill, .game-card__title, .game-card__badges'), null, `text on ${text(c.querySelector('.game-card__title'))}'s cover`);
    assert.ok(c.querySelector('.game-card__body .forest-card__head .game-card__title + .score-pill'), 'the score is not beside the title');
  }
  const catan = cards.find((c) => text(c.querySelector('.game-card__title')) === 'Catan');
  assert.equal(text(catan.querySelector('.forest-card__owner')), dom.run("t('detail.owners', { names: 'Anna' })"));
  assert.ok(catan.querySelector('.forest-card__meta .exp-pill'), 'the expansion count left the card');
  assert.ok(catan.querySelector('.score-pill[data-stop]'), 'a scored game lost its rung');
  assert.equal(catan.getAttribute('href'), `/round/${RID}/game/g1`);
  const bare = cards.find((c) => text(c.querySelector('.game-card__title')) === LONG);
  assert.ok(bare.classList.contains('forest-card--bare'));
  const ph = bare.querySelector('.forest-nocover');
  assert.equal(ph.getAttribute('aria-hidden'), 'true');
  assert.equal(text(ph.querySelector('.forest-nocover__label')), dom.run("t('games.noCover')"));
  assert.ok(ph.querySelector('.forest-leaf'));
  assert.ok(bare.querySelector('.score-pill--none'), 'an unscored game says „neu"');
  assert.ok(bare.querySelector('.game-card__pick'), 'the bulk tick left the frame');
});

// --- the Spielepass ----------------------------------------------------------

test('Forest\'s Spielepass: cover | story | actions, the score in a card and never on the cover', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showGameDetail', RID, 'g1');
  const pass = dom.app.querySelector('.pass.forest-pass');
  assert.ok(pass, 'no Forest Spielepass');
  assert.deepEqual([...pass.children].map((c) => c.className), ['pass__game', 'pass__story', 'pass__table']);
  const [game, story, table] = pass.children;
  assert.ok(game.querySelector('.gd-cover .gd-img'));
  assert.equal(game.querySelector('.score-pill, .gd-score'), null, 'text on the cover');
  assert.ok(story.querySelector('.gd-head h1 .gd-title'));
  // DOM order = reading order: title, score card, figures, raters, history.
  const order = [...story.children].map((c) => c.className.split(' ').find((x) => /^(gd-head|forest-score|forest-facts|gd-raters|gd-history)$/.test(x)));
  assert.deepEqual(order, ['gd-head', 'forest-score', 'forest-facts', 'gd-raters', 'gd-history']);
  const score = story.querySelector('.forest-score');
  assert.ok(score.querySelector('.score-pill[data-stop]'));
  assert.equal(text(score.querySelector('.forest-score__name')), dom.run("t('score.name')"));
  assert.ok(score.querySelector('.score-info'), 'the explanation is not the app\'s ⓘ entry');
  const n = dom.call('gameStats', roundWith(), 'g1').count;
  assert.ok(n > 0, 'the fixture is meant to carry ratings');
  assert.equal(text(score.querySelector('.forest-score__ev')), dom.run(`tn(${n}, 'score.evidenceOne', 'score.evidence')`));
  // The one action, the Aktionen (no „…" left), then the source card.
  assert.deepEqual([...table.children].map((c) => c.className.split(' ')[0]), ['gd-bar', 'section', 'forest-source']);
  assert.ok(table.querySelector('.gd-actions .gd-act'));
  assert.equal(dom.app.querySelector('.back-row .gd-menu'), null, 'the „…" menu is still there');
});

test('the three figures read the sessions: plays, the last time, and who has won it most — a guest stays a guest', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showGameDetail', RID, 'g1');
  const figs = [...dom.app.querySelectorAll('.forest-facts > .forest-fact')];
  assert.deepEqual(figs.map((f) => text(f.querySelector('.forest-fact__k'))),
    ['detail.statPlaysBruecke', 'round.lastPlayedLabel', 'detail.factMostWins'].map((k) => dom.run(`t('${k}')`)));
  const vals = figs.map((f) => text(f.querySelector('.forest-fact__v')));
  assert.equal(vals[0], '3', 'the cancelled night counted as a play');
  assert.equal(vals[1], dom.run("forestShortDate('2026-08-02T20:00:00.000Z')"));
  assert.equal(vals[2], 'Anna · 2');

  // A tie names everyone tied; a guest is named as one.
  const tied = roundWith(GAMES, [
    played('s1', 'g1', '2026-07-03T20:00:00.000Z', ['m1']),
    played('s2', 'g1', '2026-07-10T20:00:00.000Z', ['x1'], { guests: [{ id: 'x1', name: 'Gil' }] }),
  ]);
  const two = boot(t, 'forest', tied);
  await two.call('showGameDetail', RID, 'g1');
  const most = text(two.app.querySelectorAll('.forest-fact__v')[2]);
  const [names, count] = most.split(' · ');
  assert.equal(count, '1');
  assert.deepEqual(names.split(', ').sort(), ['Anna', two.run("t('people.guest', { name: 'Gil' })")].sort());
  // Never played: dashes, not zeros dressed as dates.
  const none = boot(t, 'forest', roundWith(GAMES, []));
  await none.call('showGameDetail', RID, 'g2');
  assert.deepEqual([...none.app.querySelectorAll('.forest-fact__v')].map(text), ['0', '–', '–']);
});

test('the BGG link leaves the disclosure for the source card, beside a linked „Powered by BGG"', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showGameDetail', RID, 'g1');
  const card = dom.app.querySelector('.forest-source');
  const link = card.querySelector('a.link-out');
  assert.equal(link.getAttribute('href'), 'https://boardgamegeek.com/boardgame/13');
  assert.equal(text(link), dom.run("t('detail.viewSource', { provider: 'BGG' })"));
  const badge = card.querySelector('a.forest-bgg-link');
  assert.equal(badge.getAttribute('href'), 'https://boardgamegeek.com');
  assert.equal(badge.querySelector('img').getAttribute('alt'), 'Powered by BGG');
  assert.equal(dom.app.querySelector('.gd-more .link-out'), null, 'the link is offered twice');
  // A game with no source keeps the way to link one, in the same card.
  const azul = boot(t, 'forest');
  await azul.call('showGameDetail', RID, 'g2');
  const own = azul.app.querySelector('.forest-source');
  assert.ok(own.querySelector('.link-out--btn'));
  assert.equal(own.querySelector('.forest-bgg-link'), null, 'the BGG badge on a game BGG has nothing to do with');
});

test('a wish keeps no score and no figures, and offers „Ins Regal"', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showGameDetail', RID, 'g6');
  assert.equal(dom.app.querySelector('.forest-score, .forest-facts'), null);
  assert.ok(text(dom.app.querySelector('.gd-bar')).includes(dom.run("t('wish.restore')")));
});

// --- the lookup --------------------------------------------------------------

test('Forest opens the search-first lookup with the app\'s two ways out and a linked BGG badge', async (t) => {
  const dom = boot(t, 'forest');
  dom.call('showAddGame', roundWith());
  const sheet = dom.document.querySelector('.sheet.add-search');
  assert.ok(sheet, 'Forest went straight to the form');
  assert.deepEqual([...sheet.querySelectorAll('.add-search__way')].map(text),
    [dom.run("t('bggImport.tile')"), dom.run("t('addGame.selfEntry')")]);
  const credit = sheet.querySelector('.add-search__query + .add-search__credit a.forest-bgg-link');
  assert.ok(credit, 'no BGG badge under the query');
  assert.equal(credit.getAttribute('href'), 'https://boardgamegeek.com');
  assert.equal(credit.querySelector('img').getAttribute('alt'), 'Powered by BGG');
});

// --- the stylesheet ----------------------------------------------------------

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/forest.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => {
    if (c.includes('===== #1467')) return '/*#1467*/';
    return c.startsWith('/* ===== #') ? '/*§*/' : '';
  });
const AFTER = SHEET.slice(SHEET.indexOf('/*#1467*/') + '/*#1467*/'.length);
const SECTION = AFTER.includes('/*§*/') ? AFTER.slice(0, AFTER.indexOf('/*§*/')) : AFTER;
const ROOT = ':root[data-design="forest"]';
const GATE = ':root[data-design="forest"]:not([data-scheme="dark"])';
const COLOUR_PROPS = /(^|;)\s*(color|background(-color)?|border(-(top|right|bottom|left))?(-color)?|box-shadow|outline(-color)?|fill|stroke)\s*:/;
const flat = () => rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));

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

test('every rule of the #1467 section is Forest-scoped, and every rule that paints is gated on the light scheme', () => {
  assert.ok(SHEET.includes('/*#1467*/'), 'the section header moved — re-read this test');
  const rules = flat();
  assert.ok(rules.length > 80, `the scan found implausibly few rules (${rules.length})`);
  let painted = 0;
  for (const [selector, body] of rules) {
    // A colour-free value (transparent, none, a width) paints nothing; a var() token
    // or a keyword colour does.
    const paints = COLOUR_PROPS.test(body.replace(/:\s*(transparent|none|0|inherit)\s*(;|$)/g, ';'));
    if (paints) painted++;
    for (const part of topLevelParts(selector)) {
      assert.ok(part.startsWith(ROOT), `${part} is not scoped to Forest`);
      if (paints) assert.ok(part.startsWith(GATE), `${part} paints without the light-scheme gate`);
    }
  }
  assert.ok(painted > 30, `implausibly few painting rules (${painted})`);
});

test('the #1467 section spells no colour', () => {
  const literal = flat().filter(([, body]) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(body)).map(([sel]) => sel);
  assert.deepEqual(literal, []);
});

test('a shelf title wraps: no ellipsis and no nowrap on the card\'s title', () => {
  const titles = flat().filter(([sel]) => sel.includes('forest-card') && sel.includes('game-card__title'));
  assert.ok(titles.length >= 2, 'no rule for the card title');
  for (const [, body] of titles) assert.doesNotMatch(body, /text-overflow|white-space:\s*nowrap|line-clamp/);
  assert.ok(titles.some(([, body]) => /overflow-wrap:\s*anywhere/.test(body)));
});

test('the search field and the sort meet the field target, the toolbar\'s buttons the key target', () => {
  const body = (sel) => (flat().find(([s]) => s === sel) || [])[1] || '';
  assert.match(body(`${ROOT} .forest-regal .regal-head .search-pill`), /min-height:\s*var\(--target-field\)/);
  assert.match(body(`${ROOT} .forest-regal .regal-sort`), /min-height:\s*var\(--target-field\)/);
  assert.match(body(`${ROOT} .forest-regal .regal-head .section-tools :is(.fbar__trigger, .regal-more)`), /min-height:\s*var\(--target-key\)[\s\S]*min-width:\s*var\(--target-key\)/);
  assert.match(body(`${ROOT} .forest-regal .regal-head .section-tools .link-btn`), /min-height:\s*var\(--target-key\)/);
});
