'use strict';

/* Die Brücke's empty and young states (#1243, B7.1–B7.3).
 *
 * The pixels were judged in a browser at 390 and 1440; what is pinned here is
 * what regresses silently —
 *
 *   - the freshly founded round losing its one way in, or offering it twice
 *     (the empty table beside the Missionskontrolle AND the panel's own);
 *   - „ab dem ersten Spiel" going back inside the locked ignition, where it
 *     can only be painted in the disabled tone;
 *   - an empty shelf, Chronik or Pokale offering no action, or one that
 *     cannot work (a start button over a shelf with nothing to draw);
 *   - the young line under the ignition staying once a session is played;
 *   - every rule of the #1243 section that reads a colour without the gate.
 *
 * Every Brücke branch is also asserted absent under Klassisch, whose DOM is the
 * default path and must not move (the hub's and the lobby's whole DOM is
 * pinned by test/programmheft-hub-lobby.test.js's golden fixture as well).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');

const RID = 'r1';
const MEMBERS = [{ id: 'm1', name: 'Aylin' }, { id: 'm2', name: 'Ben' }];
const GAMES = [
  { id: 'g1', title: 'Azul', minPlayers: 2, maxPlayers: 4, tagIds: [] },
  { id: 'g2', title: 'Carcassonne', minPlayers: 2, maxPlayers: 5, tagIds: [] },
];

const roundWith = ({ games = GAMES, sessions = [] } = {}) => ({
  id: RID,
  name: 'WG Kastanienallee',
  background: null,
  tags: [],
  providers: [],
  members: MEMBERS,
  games,
  sessions,
});

const played = {
  id: 's1', createdAt: '2026-08-01T20:00:00.000Z', gameIds: ['g1'], memberIds: ['m1', 'm2'],
  votes: {}, votedIds: [], finished: true, cancelled: false, done: true,
  winnerIds: ['m1'], chosenGameId: 'g1', events: [],
};

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
  dom.went = [];
  for (const name of ['showAddGame', 'showBggImport', 'showStartSession']) {
    dom.set(name, () => dom.went.push(name));
  }
  return dom;
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const controls = (root) => [...root.querySelectorAll('.empty__actions > :is(.btn, .link-btn)')];

// --- the freshly founded round (B7.1) ---------------------------------------

test('a 0-game Brücke hub keeps the empty table inside the Missionskontrolle', async (t) => {
  const dom = boot(t, 'bruecke', roundWith({ games: [] }), { bgg: true });
  await dom.call('showRound', RID, 'start');
  const panel = dom.app.querySelector('.bruecke-hub__mission > .bruecke-mission');
  assert.ok(panel, 'no Missionskontrolle panel');
  assert.equal(dom.app.querySelector('.empty--table'), null,
    'the empty table still stands beside the panel — the way in is offered twice');
  // The panel says what is missing, in the app's own words.
  assert.equal(text(panel.querySelector('.bruecke-mission__state')), dom.run("t('games.emptyTitle')"));
  assert.ok(panel.querySelector('.bruecke-mission__state--empty'), 'the empty state is painted as „Bereit"');
  const fire = panel.querySelector('.bruecke-mission__fire');
  assert.ok(fire.disabled, 'the ignition fires over an empty shelf');
  // The reason is REAL text beside the locked button, never inside it.
  const reason = panel.querySelector('.hub-cta__reason');
  assert.ok(reason, 'the reason is gone');
  assert.ok(!fire.contains(reason), 'the reason is back inside the disabled ignition');
  assert.equal(fire.getAttribute('aria-describedby'), reason.id, 'the reason no longer describes the button');
  assert.equal(text(fire), dom.run("t('round.startSessionBruecke')"), 'the button\'s name changed');
  // One action, and the BGG import as the side road — a text link, never a second button.
  const acts = controls(panel);
  assert.deepEqual(acts.map(text), [dom.run("t('round.addGame')"), dom.run("t('bggImport.tile')")]);
  assert.ok(acts[0].classList.contains('btn--primary'), 'adding a game is not the primary');
  assert.ok(acts[1].classList.contains('link-btn') && !acts[1].classList.contains('btn'),
    'the BGG import is a second button');
  acts[0].click();
  acts[1].click();
  assert.deepEqual(dom.went, ['showAddGame', 'showBggImport']);
  assert.equal(dom.app.querySelectorAll('.btn--primary:not(:disabled)').length, 1, 'more than one live primary on the screen');
});

test('without the BGG import the 0-game panel offers only the add action', async (t) => {
  const dom = boot(t, 'bruecke', roundWith({ games: [] }));
  await dom.call('showRound', RID, 'start');
  assert.deepEqual(controls(dom.app.querySelector('.bruecke-mission')).map(text), [dom.run("t('round.addGame')")]);
});

test('a Brücke round with games keeps „Bereit" and no empty-table actions', async (t) => {
  const dom = boot(t, 'bruecke', roundWith({ sessions: [played] }));
  await dom.call('showRound', RID, 'start');
  const panel = dom.app.querySelector('.bruecke-mission');
  assert.equal(text(panel.querySelector('.bruecke-mission__state')), 'Bereit');
  assert.equal(panel.querySelector('.bruecke-mission__state--empty, .empty__actions, .hub-cta__reason'), null);
});

// --- the young round (B7.3) -------------------------------------------------

test('a young Brücke round says under the ignition what is waiting, and when numbers come', async (t) => {
  const dom = boot(t, 'bruecke', roundWith());
  await dom.call('showRound', RID, 'start');
  const line = dom.app.querySelector('.bruecke-mission__ignition + .bruecke-young');
  assert.ok(line, 'the young line does not sit directly under the ignition');
  assert.equal(text(line.querySelector('.bruecke-young__ready')), dom.run("tn(2, 'hub.young.readyOne', 'hub.young.ready')"));
  assert.equal(text(line.querySelector('.bruecke-young__none')), dom.run("t('round.startEmptyTitle')"));
  // „Wie wär's mit" and the Rundenpuls say WHEN — never a „0", never an empty axis.
  const suggest = dom.app.querySelector('.bruecke-hub__suggest .hub-card--sentence');
  assert.ok(suggest, 'the suggestion slot says nothing on a young Brücke round');
  assert.equal(text(suggest.querySelector('.hub-card__facts')),
    dom.run("tn(SUGGEST_MIN_SHELF, 'hub.young.suggestOne', 'hub.young.suggest')"));
  const pulse = dom.app.querySelector('.bruecke-hub__pulse .hub-card--sentence');
  assert.ok(pulse, 'the Rundenpuls says nothing on a young Brücke round');
  assert.equal(text(pulse.querySelector('.hub-card__facts')),
    dom.run("tn(YOUNG_ROUND_SERIES_FROM, 'hub.young.pulseOne', 'hub.young.pulse')"));
});

test('the freshly founded Brücke round says when the Rundenpuls fills, too', async (t) => {
  const dom = boot(t, 'bruecke', roundWith({ games: [] }));
  await dom.call('showRound', RID, 'start');
  assert.ok(dom.app.querySelector('.bruecke-hub__pulse .hub-card--sentence'), 'B7.1 draws the Rundenpuls on a fresh round');
  assert.equal(dom.app.querySelector('.bruecke-young'), null, 'a 0-game round has the empty panel, not the young line');
});

test('the young line leaves once a session is played', async (t) => {
  const dom = boot(t, 'bruecke', roundWith({ sessions: [played] }));
  await dom.call('showRound', RID, 'start');
  assert.equal(dom.app.querySelector('.bruecke-young'), null);
});

test('Klassisch keeps its young hub: no young line, no sentence cards, the reason inside the button', async (t) => {
  const young = boot(t, 'klassisch', roundWith());
  await young.call('showRound', RID, 'start');
  assert.equal(young.app.querySelector('.bruecke-young, .hub-card--sentence'), null);

  const empty = boot(t, 'klassisch', roundWith({ games: [] }), { bgg: true });
  await empty.call('showRound', RID, 'start');
  assert.ok(empty.app.querySelector('.empty--table'), 'Klassisch lost its empty table');
  assert.ok(empty.app.querySelector('.hub-cta .hub-cta__reason'), 'Klassisch\'s reason left the button');
  assert.equal(empty.app.querySelector('.empty__actions .link-btn'), null, 'Klassisch\'s BGG import became a link');
});

// --- the Regal, the Chronik and the Pokale (B7.2) ---------------------------

test('an empty Brücke shelf carries its one way in on the card, BGG as the side road', async (t) => {
  const dom = boot(t, 'bruecke', roundWith({ games: [] }), { bgg: true });
  await dom.call('showRound', RID, 'regal');
  const empty = dom.app.querySelector('.empty');
  assert.ok(empty, 'the fixture no longer reaches the empty shelf');
  const acts = controls(empty);
  assert.deepEqual(acts.map(text), [dom.run("t('round.addGame')"), dom.run("t('bggImport.tile')")]);
  assert.ok(acts[0].classList.contains('btn--primary'), 'adding a game is not the primary');
  assert.ok(acts[1].classList.contains('link-btn'), 'the BGG import is a second button');
  acts[0].click();
  acts[1].click();
  assert.deepEqual(dom.went, ['showAddGame', 'showBggImport']);
  assert.equal(dom.app.querySelector('.add-tile'), null, 'the empty shelf offers „Spiel hinzufügen" a second time');
});

test('an empty Brücke Chronik and Pokale offer „Mission starten" — only where there is a game to draw', async (t) => {
  for (const tab of ['chronik', 'pokale']) {
    const dom = boot(t, 'bruecke', roundWith());
    await dom.call('showRound', RID, tab);
    const acts = controls(dom.app);
    assert.deepEqual(acts.map(text), [dom.run("t('round.startSessionBruecke')")], `${tab}: not the one action`);
    assert.ok(acts[0].classList.contains('btn--primary'), `${tab}: the action is not the primary`);
    assert.ok(acts[0].querySelector('.ti-rocket'), `${tab}: the action wears another glyph than the ignition`);
    acts[0].click();
    assert.deepEqual(dom.went, ['showStartSession']);

    const bare = boot(t, 'bruecke', roundWith({ games: [] }));
    await bare.call('showRound', RID, tab);
    assert.ok(bare.app.querySelector('.empty'), `${tab}: the fixture no longer reaches the empty state`);
    assert.equal(bare.app.querySelector('.empty__actions'), null, `${tab}: a start button over an empty shelf can only fail`);
  }
});

test('Klassisch keeps its empty shelf, Chronik and Pokale as notices', async (t) => {
  for (const tab of ['regal', 'chronik', 'pokale']) {
    const k = boot(t, 'klassisch', roundWith(tab === 'regal' ? { games: [] } : {}), { bgg: true });
    await k.call('showRound', RID, tab);
    assert.ok(k.app.querySelector('.empty'), `${tab}: the fixture no longer reaches the empty state`);
    assert.equal(k.app.querySelector('.empty__actions'), null, `${tab}: Klassisch grew an action`);
  }
});

// --- the stylesheet ---------------------------------------------------------

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/bruecke.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => {
    if (c.includes('===== #1243')) return '/*#1243*/';
    return c.startsWith('/* ===== #') ? '/*§*/' : '';
  });
// The section runs to the NEXT section header, not to the end of the file.
const AFTER = SHEET.slice(SHEET.indexOf('/*#1243*/') + '/*#1243*/'.length);
const SECTION = AFTER.includes('/*§*/') ? AFTER.slice(0, AFTER.indexOf('/*§*/')) : AFTER;
const GATE = ':root[data-design="bruecke"][data-scheme="dark"]';

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

test('every #1243 rule that reads a colour token is gated on the dark scheme', () => {
  assert.ok(SHEET.includes('/*#1243*/'), 'the section header moved — re-read this test');
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  assert.ok(flat.length > 10, `the scan found implausibly few rules (${flat.length})`);
  const coloured = flat.filter(([, body]) => /(^|;)\s*(color|background[\w-]*|border[\w-]*|outline[\w-]*|box-shadow)\s*:[^;]*var\(--/.test(body));
  assert.ok(coloured.length > 3, `the scan found implausibly few colour rules (${coloured.length})`);
  for (const [selector] of coloured) {
    for (const part of topLevelParts(selector)) {
      assert.ok(part.startsWith(GATE), `${part} reads a colour token without the gate`);
    }
  }
});

test('--ink-dim is not a text colour anywhere in the #1243 section', () => {
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  for (const [selector, body] of flat) {
    assert.ok(!/(^|;)\s*color\s*:[^;]*--ink-dim/.test(body), `${selector} paints text in --ink-dim`);
  }
});
