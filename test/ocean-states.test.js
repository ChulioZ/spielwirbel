'use strict';

/* Ocean's empty, young and error states (#1216, O7.1–O7.5).
 *
 * The pixels were judged in a browser at 390; what is pinned here is what
 * regresses silently —
 *
 *   - an empty screen losing its one next step under Ocean, or offering it
 *     where it cannot work (a start button over a shelf with nothing to draw);
 *   - the empty shelf offering „Spiel hinzufügen" twice (the card AND the
 *     bubble / the dashed tile);
 *   - the young round's line under the shell appearing on a round that has
 *     played, or on Klassisch;
 *   - every rule of the #1216 section reading the gated colour block without
 *     being gated itself.
 *
 * Every Ocean branch is also asserted absent under Klassisch, whose DOM is the
 * default path and must not move.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');

const RID = 'r1';
const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }];
const GAMES = [
  { id: 'g1', title: 'Catan', tagIds: [] },
  { id: 'g2', title: 'Azul', tagIds: [] },
];

const roundWith = ({ games = GAMES, sessions = [] } = {}) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: MEMBERS,
  games,
  sessions,
});

function boot(t, design, round, { bgg = false } = {}) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/recommendations/.test(url)) return { recommendations: [] };
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  dom.set('canImportBgg', () => bgg);
  // Record where each action leads instead of opening the real sheets.
  dom.run('globalThis.__went = []');
  for (const name of ['showAddGame', 'showBggImport', 'showStartSession']) {
    dom.run(`globalThis.${name} = () => globalThis.__went.push(${JSON.stringify(name)})`);
  }
  return dom;
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const actions = (dom) => [...dom.app.querySelectorAll('.empty .empty__actions .btn')];

// --- the Regal (O7.1) -------------------------------------------------------

test('an empty Ocean shelf carries its two ways in on the card, and nowhere else', async (t) => {
  const dom = boot(t, 'ocean', roundWith({ games: [] }), { bgg: true });
  await dom.call('showRound', RID, 'regal');
  const btns = actions(dom);
  assert.deepEqual(btns.map(text), [dom.run("t('round.addGame')"), dom.run("t('bggImport.tile')")]);
  assert.ok(btns[0].classList.contains('btn--primary'), 'adding a game is the one primary action');
  btns[0].click();
  btns[1].click();
  assert.deepEqual(JSON.parse(dom.run('JSON.stringify(globalThis.__went)')), ['showAddGame', 'showBggImport']);
  // The dashed tiles, the tablet pill and the phone bubble would offer it again.
  assert.equal(dom.app.querySelector('.add-tile, .regal-fab, .regal-add--bar'), null,
    'the empty shelf offers „Spiel hinzufügen" a second time');
});

test('without the BGG import the empty Ocean shelf offers only the add action', async (t) => {
  const dom = boot(t, 'ocean', roundWith({ games: [] }));
  await dom.call('showRound', RID, 'regal');
  assert.deepEqual(actions(dom).map(text), [dom.run("t('round.addGame')")]);
});

test('Klassisch keeps its empty shelf a notice, with the dashed tiles below', async (t) => {
  const dom = boot(t, 'klassisch', roundWith({ games: [] }), { bgg: true });
  await dom.call('showRound', RID, 'regal');
  assert.equal(dom.app.querySelector('.empty__actions'), null);
  assert.equal(dom.app.querySelectorAll('.add-tile').length, 2);
});

// --- the Chronik and the Pokale (O7.1) -------------------------------------

test('an empty Ocean Chronik offers „Abtauchen" — only where there is a game to draw', async (t) => {
  const dom = boot(t, 'ocean', roundWith());
  await dom.call('showRound', RID, 'chronik');
  const btns = actions(dom);
  assert.deepEqual(btns.map(text), [dom.run("t('round.startSessionOcean')")]);
  btns[0].click();
  assert.deepEqual(JSON.parse(dom.run('JSON.stringify(globalThis.__went)')), ['showStartSession']);

  const bare = boot(t, 'ocean', roundWith({ games: [] }));
  await bare.call('showRound', RID, 'chronik');
  assert.ok(bare.app.querySelector('.timeline .empty'), 'the fixture no longer reaches the empty Chronik');
  assert.equal(bare.app.querySelector('.empty__actions'), null, 'a start button over an empty shelf can only fail');
});

test('an empty Ocean Pokale offers „Abtauchen" too; Klassisch keeps both as notices', async (t) => {
  const dom = boot(t, 'ocean', roundWith());
  await dom.call('showRound', RID, 'pokale');
  assert.deepEqual(actions(dom).map(text), [dom.run("t('round.startSessionOcean')")]);

  for (const tab of ['chronik', 'pokale']) {
    const k = boot(t, 'klassisch', roundWith());
    await k.call('showRound', RID, tab);
    assert.ok(k.app.querySelector('.empty'), `${tab}: the fixture no longer reaches the empty state`);
    assert.equal(k.app.querySelector('.empty__actions'), null, `${tab}: Klassisch grew an action`);
  }
});

// --- the young round (O7.3) -------------------------------------------------

const played = {
  id: 's1', createdAt: '2026-08-01T20:00:00.000Z', gameIds: ['g1'], memberIds: ['m1', 'm2'],
  votes: {}, votedIds: [], finished: true, cancelled: false, done: true,
  winnerIds: ['m1'], chosenGameId: 'g1', events: [],
};

test('a young Ocean round says under the shell what is waiting', async (t) => {
  const dom = boot(t, 'ocean', roundWith());
  await dom.call('showRound', RID, 'start');
  const line = dom.app.querySelector('.ocean-shell + .ocean-young');
  assert.ok(line, 'the young line does not sit directly under the shell');
  assert.equal(text(line.querySelector('.ocean-young__ready')), dom.run("tn(2, 'hub.young.readyOne', 'hub.young.ready')"));
  assert.equal(text(line.querySelector('.ocean-young__none')), dom.run("t('round.startEmptyTitle')"));
  // „Wie wär's mit" says WHEN, in the pair beside the shell (Der Tisch's copy).
  const sentence = dom.app.querySelector('.ocean-pair .hub-card--sentence');
  assert.ok(sentence, 'the suggestion card says nothing on a young Ocean round');
  assert.equal(text(sentence.querySelector('.hub-card__facts')),
    dom.run("tn(SUGGEST_MIN_SHELF, 'hub.young.suggestOne', 'hub.young.suggest')"));
});

test('the young line leaves once a session is played, and never shows on Klassisch', async (t) => {
  const grown = boot(t, 'ocean', roundWith({ sessions: [played] }));
  await grown.call('showRound', RID, 'start');
  assert.equal(grown.app.querySelector('.ocean-young'), null);

  const empty = boot(t, 'ocean', roundWith({ games: [] }));
  await empty.call('showRound', RID, 'start');
  assert.equal(empty.app.querySelector('.ocean-young'), null, 'a 0-game round has the empty table, not the young line');

  const k = boot(t, 'klassisch', roundWith());
  await k.call('showRound', RID, 'start');
  assert.equal(k.app.querySelector('.ocean-young, .hub-card--sentence'), null);
});

// --- the stylesheet ---------------------------------------------------------

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/ocean.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => (c.includes('===== #1216') ? '/*#1216*/' : ''));
const SECTION = SHEET.slice(SHEET.indexOf('/*#1216*/') + '/*#1216*/'.length);
const GATE = ':root[data-design="ocean"]:not([data-scheme="dark"])';

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

test('every rule of the #1216 section is gated on the light scheme', () => {
  assert.ok(SHEET.includes('/*#1216*/'), 'the section header moved — re-read this test');
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  assert.ok(flat.length > 30, `the scan found implausibly few rules (${flat.length})`);
  for (const [selector] of flat) {
    for (const part of topLevelParts(selector)) {
      assert.ok(part.startsWith(GATE), `${part} reads gated tokens without the gate`);
    }
  }
});

test('the demo banner and the failed search are painted in the section', () => {
  const flat = rulesOf(SECTION);
  const has = (tail) => flat.some(([sel]) => topLevelParts(sel).some((p) => p === `${GATE} ${tail}`));
  assert.ok(has('.demo-banner'), 'the demo banner has no Ocean treatment');
  assert.ok(has('.demo-banner__cta'), 'the demo CTA is still a bare link');
  assert.ok(has('.sheet .add-search__msg.is-fail'), 'a failed search is still a bare line');
});
