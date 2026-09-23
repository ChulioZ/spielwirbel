'use strict';

/* Der Tisch's OVERLAYS (#1195) — sheets and their popover twins, the confirm
 * dialog, the toast and the „…" menu (T15a, T15b).
 *
 * As in the other test/tisch-*.test.js files, the repaint itself is covered
 * generically: test/tisch-hub-lobby.test.js derives the scheme gate over the
 * whole file, test/design-layer.test.js refuses a literal or a shadowed token,
 * and test/a11y-contrast.test.js measures the paper family by name. What they
 * cannot see is below, and four of the six are behaviour rather than paint:
 *
 *   1. the menu's ORDER in its four appearances, and that "red" means "asks a
 *      red question" (a jsdom walk of the real menus, each item clicked);
 *   2. one form, two appearances — an editor offers the same buttons in the
 *      same order as a sheet at 390 and as a popover at 1440;
 *   3. the confirm dialog's title is the question and its text the consequence,
 *      lifted out of copy that already exists, never cut inside a quotation;
 *   4. no locale says „OK" or „Bist du sicher?" any more;
 *   5-6. the CSS claims whose regression renders plausibly: every token the
 *      overlay's descendants inherit from the walnut page is re-pointed, and the
 *      destructive button, the docked sheet and the toast seat are where T15a/b
 *      put them.
 *
 * Named for what it covers, not for a module: no module is called "overlays",
 * and `popover`/`sheet`/`confirm-dialog` are all taken
 * (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { loadApp, flush } = require('./support/dom');
const { rulesOf } = require('./support/css');

const ROOT = path.join(__dirname, '..');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const TISCH = strip(fs.readFileSync(path.join(ROOT, 'public/css/designs/tisch.css'), 'utf8'));
const APP_CSS = strip(fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8'));
const GATE = ':root[data-design="tisch"][data-scheme="dark"]';

/* ------------------------------------------------------------------ 1. menus */

/* Every „…" menu goes through fillMenu (popover.js), which orders by `kind`.
   The assertion that matters is not the order alone — any fixed sort passes
   that — but that the kinds are TRUE: an item is `destructive` exactly when
   pressing it raises a danger confirmation. So each item is clicked with
   confirmDialog stubbed to record what it was asked, and the two are compared.
   A mislabelled kind (a danger action filed as `undoable`) fails here even
   though the order it produces is perfectly sorted. */

const KINDS = ['edit', 'share', 'undoable', 'destructive'];

async function menuFacts(dom, trigger) {
  const read = () => {
    // A selector, or a function for a trigger the screen rebuilds on a click.
    const btn = typeof trigger === 'function' ? trigger() : dom.document.querySelector(trigger);
    assert.ok(btn, `no „…" trigger ${trigger} on screen`);
    btn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    return [...dom.document.querySelectorAll('.popover--menu .popover__opt')];
  };
  const items = read().map((b) => ({ label: b.textContent.trim(), kind: b.dataset.kind }));
  dom.document.querySelectorAll('.popover').forEach((el) => el.remove());
  // Click each item in a fresh menu, recording whether it asked a red question.
  for (const item of items) {
    const asked = [];
    dom.set('confirmDialog', async (o) => { asked.push(o || {}); return false; });
    const btn = read().find((b) => b.textContent.trim() === item.label);
    btn.click();
    await flush();
    item.danger = asked.some((o) => o.danger !== false);
    dom.document.querySelectorAll('.popover').forEach((el) => el.remove());
  }
  return items;
}

function assertMenuContract(where, items, expectedLabels) {
  assert.ok(items.length >= 2, `${where}: the fixture offers ${items.length} item(s) — too few to test an order`);
  for (const { label, kind } of items) {
    assert.ok(KINDS.includes(kind), `${where}: „${label}" carries kind ${kind}, which no menu sorts by`);
  }
  const ranks = items.map(({ kind }) => KINDS.indexOf(kind));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b),
    `${where}: the menu is out of order — ${items.map((i) => `${i.label}:${i.kind}`).join(', ')}`);
  for (const { label, kind, danger } of items) {
    assert.equal(kind === 'destructive', danger,
      `${where}: „${label}" is filed as ${kind} but ${danger ? 'raises' : 'does not raise'} a danger confirm`);
  }
  assert.deepEqual(items.map((i) => i.label), expectedLabels, `${where}: the rows`);
}

test('the game menu: completion first, then the two red questions', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = {
    id: 'r1', name: 'Freitagsrunde', members: [{ id: 'm1', name: 'Anna' }], sessions: [], tags: [],
    games: [{ id: 'g1', title: 'Azul', minPlayers: 2, maxPlayers: 4, tagIds: [],
      source: { provider: 'bgg', id: '230802' } }],
  };
  dom.set('api', async (method, url) => (/^\/api\/rounds\/r1$/.test(url) ? round : (/\/activities$/.test(url) ? [] : {})));
  await dom.call('showGameDetail', 'r1', 'g1');
  const tr = (k) => dom.run(`t('${k}')`);
  assertMenuContract('game detail', await menuFacts(dom, '.gd-menu'),
    [tr('detail.complete'), tr('detail.retire'), tr('detail.unlinkProvider')]);
});

test('the member menu: the way back above the two red questions', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // A retired seat linked to someone else's account, in a round I own: the one
  // state that offers an undoable item AND destructive ones, and — before
  // fillMenu — the one whose branches wrote them in the wrong order.
  const round = {
    id: 'r2', name: 'Freitagsrunde', games: [], sessions: [], tags: [], background: null,
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben', retired: true, userId: 'acct-them' }],
  };
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => 'acct-me');
  dom.set('roundCan', () => true);
  dom.set('showRound', () => {});
  dom.set('api', async (method, url) => {
    if (/\/shares$/.test(url)) return [];
    if (/^\/api\/rounds\/r2$/.test(url)) return round;
    return {};
  });
  await dom.call('showMember', 'r2', 'm2');
  dom.set('showMember', () => {});
  const tr = (k) => dom.run(`t('${k}')`);
  assertMenuContract('member', await menuFacts(dom, '.gd-menu'),
    [tr('member.restore'), tr('share.revoke'), tr('member.delete')]);
});

test('the result-row menu: open the game, change your mind, then remove', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = {
    id: 'r3', name: 'Freitagsrunde', background: null, tags: [], providers: [],
    members: [{ id: 'm1', name: 'Anna' }],
    games: [{ id: 'g1', title: 'Catan', tagIds: [] }, { id: 'g2', title: 'Azul', tagIds: [] }],
  };
  const session = {
    id: 's1', createdAt: '2026-07-01T20:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1'],
    votes: { m1: { g1: { rating: 5 }, g2: { rating: 3 } } }, votedIds: ['m1'],
    finished: false, cancelled: false, done: true, winnerIds: [], chosenGameId: 'g1', events: [],
  };
  round.sessions = [session];
  dom.set('api', async (method, url) => (/^\/api\/rounds\/[^/]+$/.test(url) ? round : (/\/activities$/.test(url) ? [] : {})));
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  await dom.call('showResults', round, session, round.games, false);
  dom.set('showGameDetail', () => {});
  const tr = (k) => dom.run(`t('${k}')`);
  // The CHOSEN row, which is the one offering all three kinds.
  // Re-found on every open: un-choosing rebuilds the row's action column.
  const catanMenu = () => [...dom.app.querySelectorAll('.trow')]
    .find((r) => r.textContent.includes('Catan')).querySelector('.trow__menu');
  assertMenuContract('result row', await menuFacts(dom, catanMenu),
    [tr('result.openGame'), tr('result.clearChoice'), tr('result.removeGame')]);
});

test('the profile menu: the report above the unfriend', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => 'user-me');
  dom.set('isDemoAccount', () => false);
  dom.run('setContactAvailable(true)');
  const profile = {
    userId: 'user-bo', username: 'bo', avatar: null, createdAt: '2026-01-01T00:00:00.000Z',
    self: false, friendship: 'friends', friendshipId: 'f1', since: '2026-02-01T00:00:00.000Z',
    events: [], stats: null,
  };
  dom.set('accountApi', async (method, url) => (/^\/profile\//.test(url) ? profile : {}));
  await dom.call('showProfile', 'bo');
  const tr = (k) => dom.run(`t('${k}')`);
  // „Melden" opens the report channel rather than a confirm; stub the click it
  // forwards to so the walk does not try to navigate jsdom.
  dom.window.HTMLAnchorElement.prototype.click = function click() {};
  assertMenuContract('profile', await menuFacts(dom, '.back-row--split .gd-menu'),
    [tr('friends.reportAccount'), tr('friends.unfriend')]);
});

test('fillMenu sorts by kind, keeps a kind\'s own order, and files an unknown kind as undoable', () => {
  const dom = loadApp();
  try {
    const order = dom.run(`sortMenuItems([
      { label: 'd1', kind: 'destructive' }, { label: 'u1', kind: 'undoable' },
      { label: 'e1', kind: 'edit' }, { label: 'x', kind: 'typo' },
      { label: 'd2', kind: 'destructive' }, { label: 's1', kind: 'share' },
    ]).map((i) => i.label).join(',')`);
    assert.equal(order, 'e1,s1,u1,x,d1,d2');
  } finally { dom.close(); }
});

/* ------------------------------------------- 2. one form, two appearances */

/* T15a: „gleicher Inhalt, gleiche Reihenfolge, gleiche Knöpfe" between the
   phone's sheet and the desktop's popover. The app builds both from ONE
   builder, so this can only break if a builder starts branching on the
   presentation — which is exactly the change that would make it drift, and
   exactly what a per-presentation test would never notice. The sheet's own ×
   is chrome of the sheet, not content, so it is read from `.editor`, the part
   the builder fills. */

const GAME_ROUND = {
  id: 1, name: 'Donnerstagsrunde', shared: false, members: [], sessions: [], activity: [], providers: [],
  games: [{ id: 7, title: 'Catan', tagIds: [3], minPlayers: 2, maxPlayers: 4, image: '/uploads/catan.jpg',
    retired: false, completed: false }],
  tags: [{ id: 3, name: 'Strategie', icon: 'chess' }],
};

const buttonLabels = (root) => [...root.querySelectorAll('button')]
  .map((b) => b.textContent.trim() || b.getAttribute('aria-label') || b.title || '?');

async function editorAt(wide, trigger, open) {
  const dom = loadApp({ locale: 'de' });
  dom.run(`window.matchMedia = () => ({ matches: ${wide}, addEventListener() {}, removeEventListener() {} });`);
  await open(dom);
  dom.document.querySelector(trigger).click();
  const root = wide ? dom.document.querySelector('.popover') : dom.document.querySelector('.sheet .editor');
  assert.ok(root, `${trigger} opened no ${wide ? 'popover at 1440' : 'sheet at 390'}`);
  const docked = dom.document.querySelector('.sheet-backdrop--editor');
  const labels = buttonLabels(root);
  dom.close();
  return { labels, docked: Boolean(docked) };
}

const EDITORS = [
  ['players', '.tag--players', (dom) => { dom.set('api', async () => GAME_ROUND); return dom.call('showGameDetail', 1, 7); }],
  ['tags', '.tag--custom', (dom) => { dom.set('api', async () => GAME_ROUND); return dom.call('showGameDetail', 1, 7); }],
  ['cover', '.gd-img--edit', (dom) => { dom.set('api', async () => GAME_ROUND); return dom.call('showGameDetail', 1, 7); }],
  ['member colour', '.member-card .member-avatar', (dom) => {
    const round = { id: 'r9', name: 'R', games: [], sessions: [], tags: [], background: null,
      members: [{ id: 'm1', name: 'Anna', color: '#7f77dd' }] };
    dom.set('isLoggedIn', () => true);
    dom.set('roundCan', () => true);
    dom.set('api', async (m, url) => (/\/shares$/.test(url) ? [] : round));
    return dom.call('showMember', 'r9', 'm1');
  }],
];

for (const [name, trigger, open] of EDITORS) {
  test(`the ${name} editor offers the same buttons, in the same order, at 390 and at 1440`, async () => {
    const phone = await editorAt(false, trigger, open);
    const desk = await editorAt(true, trigger, open);
    assert.ok(phone.labels.length >= 1, `the ${name} editor rendered no button at all — the walk is vacuous`);
    assert.deepEqual(desk.labels, phone.labels,
      `the ${name} editor's popover and sheet disagree about their own content`);
    assert.equal(phone.docked, true, `the ${name} sheet does not carry sheet-backdrop--editor, so Der Tisch cannot dock it`);
  });
}

test('a LIST editor stays a dialog at every width and is never offered for docking', () => {
  const dom = loadApp();
  try {
    dom.run("window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });");
    dom.run(`openEditor(document.body, 'probe', 'T', (el) => { el.appendChild(h('<button>x</button>')); }, null, { list: true });`);
    const backdrop = dom.document.querySelector('.sheet-backdrop');
    assert.ok(backdrop.classList.contains('sheet-backdrop--center'));
    assert.equal(backdrop.classList.contains('sheet-backdrop--editor'), false,
      'a scanning list docked to the bottom edge would lose the room the dialog exists to give it');
  } finally { dom.close(); }
});

/* --------------------------------------------- 3. title = the question */

const split = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/confirm-dialog.js'), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(src.indexOf('function splitConfirmQuestion'), src.indexOf('/* Ask the user')), ctx);
  return (s) => vm.runInContext(`splitConfirmQuestion(${JSON.stringify(s)})`, ctx);
})();

test('the question is lifted out of the message, and never cut inside a quotation', () => {
  const cases = [
    ['„Azul“ aussortieren? Weg aus Regal und Auslosung.', '„Azul“ aussortieren?', 'Weg aus Regal und Auslosung.'],
    ['„Wer war’s? Das Spiel“ löschen? Weg.', '„Wer war’s? Das Spiel“ löschen?', 'Weg.'],
    ['Delete “Who? What” now? It is gone.', 'Delete “Who? What” now?', 'It is gone.'],
    ['Supprimer « Qui ? » ? Tout part.', 'Supprimer « Qui ? » ?', 'Tout part.'],
    ['¿Eliminar "¿Qué?" ahora? Se borra.', '¿Eliminar "¿Qué?" ahora?', 'Se borra.'],
    ["Remove 'Who? What' now? Gone.", "Remove 'Who? What' now?", 'Gone.'],
    ["Remove Anna's seat? It's gone.", "Remove Anna's seat?", "It's gone."],
    ['Session vom 19.09. wirklich löschen?', 'Session vom 19.09. wirklich löschen?', ''],
    ['세션을 삭제할까요? 되돌릴 수 없습니다.', '세션을 삭제할까요?', '되돌릴 수 없습니다.'],
    ['Wirklich?Nein.', null, null], // a mark that ends no sentence is not a split point
  ];
  for (const [text, q, rest] of cases) {
    const got = split(text);
    if (q === null) { assert.equal(got, null, text); continue; }
    assert.deepEqual({ ...got }, { question: q, rest }, text);
  }
  assert.equal(split('Diese Aktion ausführen.'), null, 'a statement keeps the neutral heading');
});

test('every confirm message in every locale splits cleanly, even around a title with a „?" in it', () => {
  /* Over the real copy: whatever the split lifts into the heading must hold
     balanced quotation marks, i.e. it never stopped inside one. The params are
     filled with a title that itself asks a question, which is the case the
     quote tracking exists for. */
  const dir = path.join(ROOT, 'public/js/lang');
  const PAIRS = [['„', '“'], ['«', '»'], ['“', '”']];
  let checked = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const table = dictionary(dir, file);
    assert.ok(table && table['common.cancel'], `${file}: could not read the dictionary`);
    for (const [key, value] of Object.entries(table)) {
      if (!/Confirm(Cover)?$/.test(key)) continue;
      const text = value.replace(/\{[a-z]+\}/gi, 'Wer war’s? Das Spiel');
      const got = split(text);
      if (!got) continue;
      checked += 1;
      for (const [open, close] of PAIRS) {
        const o = got.question.split(open).length - 1;
        const c = got.question.split(close).length - 1;
        if (open === '“' && got.question.includes('„')) continue; // German closes „ with “
        assert.ok(o <= c, `${file} ${key}: the heading stops inside ${open}…${close}: ${got.question}`);
      }
    }
  }
  assert.ok(checked > 100, `only ${checked} messages split — did the dictionary read break?`);
});

test('the rendered dialog: the question heads it, the consequence is its text', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.call('confirmDialog', { body: '„Azul“ aussortieren? Weg aus Regal.' });
  const sheet = dom.document.querySelector('.sheet[role="alertdialog"]');
  assert.equal(sheet.querySelector('.sheet__head h2').textContent, '„Azul“ aussortieren?');
  assert.equal(sheet.getAttribute('aria-label'), '„Azul“ aussortieren?');
  assert.equal(sheet.querySelector('.confirm-dialog__body').textContent, 'Weg aus Regal.');
  // Cancel and the verb, in that order: the destructive action on the right.
  const acts = [...sheet.querySelectorAll('.sheet__actions .btn')].map((b) => b.dataset.act);
  assert.deepEqual(acts, ['cancel', 'ok']);
  assert.ok(sheet.querySelector('[data-act="ok"]').classList.contains('btn--danger'));
  sheet.querySelector('[data-act="cancel"]').click();
  await flush();
});

/* A locale's parsed dictionary — the `vm` seam test/i18n-parity.test.js uses,
   so comments (which name the banned phrases to warn translators off them) are
   gone by construction (.claude/rules/source-scanning-guards-enumerate-shapes.md). */
function dictionary(dir, file) {
  const ctx = vm.createContext({ I18N: {} });
  vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), ctx);
  return Object.values(ctx.I18N)[0];
}

/* ------------------------------------------------ 4. no „OK", no „sure?" */

test('no locale offers a bare „OK" or asks „Bist du sicher?"', () => {
  const dir = path.join(ROOT, 'public/js/lang');
  const BANNED = /^(ok|okay)$|bist du sicher|sind sie sicher|are you sure|êtes-vous sûr|estás seguro|sei sicuro|weet je het zeker|tem certeza|oletko varma/i;
  let values = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const table = dictionary(dir, file);
    for (const [key, value] of Object.entries(table)) {
      values += 1;
      assert.doesNotMatch(value.trim(), BANNED, `${file} ${key} = „${value}" — T15b: the button names the verb`);
    }
  }
  assert.ok(values > 5000, `only ${values} values read — the sweep is vacuous`);
});

/* ---------------------------------------------------- 5-6. the CSS claims */

const RULES = rulesOf(TISCH);
const gated = (needle) => RULES.filter(([sel]) => sel.replace(/\s+/g, ' ').includes(needle));
const overlayBodies = RULES
  .filter(([sel]) => sel.includes(`${GATE} .sheet,`) && sel.includes(`${GATE} .popover`))
  .map(([, body]) => body)
  .join(';');

test('the overlay re-points EVERY token :root mixes from the page or the surface', () => {
  /* Derived, not listed: a token that :root computes from --page-bg or
     --surface is substituted THERE, against the walnut, and inherits into the
     sheet as a finished colour. So every one of them has to be re-pointed on the
     overlay or it paints wood on paper — the #1193 --page-bg defect, and before
     #1195 --sunken, --line and the brand tints, which put a dark disc under the
     close button's dark × in every sheet. A token added to :root tomorrow in the
     same shape is covered without anyone editing this file. */
  const root = rulesOf(APP_CSS).filter(([sel]) => sel.trim() === ':root').map(([, b]) => b).join(';');
  const derived = [...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)]
    .filter(([, , v]) => /var\(--(page-bg|surface)\)/.test(v))
    .map(([, name]) => name);
  assert.ok(derived.length >= 6, `only ${derived.length} derived tokens found — did the :root parse break?`);
  assert.ok(overlayBodies.includes('--surface'), 'the overlay rules were not found');
  const missing = derived.filter((n) => !new RegExp(`(?:^|[;{\\s])${n}\\s*:`).test(overlayBodies));
  assert.deepEqual(missing, [], 'these tokens are mixed from the walnut page at :root and reach the paper overlay unre-pointed');
});

test('the three status inks are re-pointed at the paper family inside an overlay', () => {
  for (const [name, target] of [['--good', '--paper-good'], ['--danger', '--paper-danger'], ['--warn', '--paper-faint']]) {
    assert.match(overlayBodies, new RegExp(`${name}\\s*:\\s*var\\(${target}\\)`),
      `${name} keeps its wood-tuned value on the paper`);
  }
});

test('a destructive button in a sheet is red-FILLED, at rest and under the pointer', () => {
  const rule = gated(`${GATE} .sheet .btn--danger:hover`);
  assert.equal(rule.length, 1, 'the destructive rule no longer covers :hover — `.btn:hover` repaints it as paper');
  // A plain substring, not a regex built from the selector: nothing to escape.
  assert.ok(rule[0][0].replace(/\s+/g, ' ').includes(`${GATE} .sheet .btn--danger,`),
    'the resting state is not in the same rule');
  assert.match(rule[0][1], /background:\s*var\(--paper-danger\)/);
  assert.match(rule[0][1], /color:\s*var\(--paper-danger-ink\)/);
});

test('on a phone the editor docks to the bottom edge and carries a grip on its sticky head', () => {
  const m = /@media \(max-width: 639px\)\s*\{([\s\S]*?)\n\}/.exec(
    TISCH.slice(TISCH.indexOf('sheet-backdrop--editor') - 200));
  assert.ok(m, 'the phone block holding the docked editor is gone');
  const block = m[1];
  assert.match(block, /\.sheet-backdrop--editor\s*\{[^}]*align-items:\s*flex-end/, 'the editor sheet is not docked');
  assert.match(block, /\.sheet__head::before\s*\{[^}]*width:\s*42px[^}]*height:\s*4px/, 'T15a\'s 42×4 grip is gone');
  assert.doesNotMatch(block, /role="alertdialog"|sheet--list/,
    'a confirm dialog or a list dialog is being docked — T15b draws both the same at every width');
});

test('the menu paints by what an item DOES, with a rule above the destructive group', () => {
  assert.equal(gated('.popover__opt[data-kind="destructive"]').length >= 2, true,
    'the destructive colour or its rule is no longer keyed on data-kind');
  const red = gated('.popover--menu .popover__opt[data-kind="destructive"]')
    .find(([sel]) => sel.trim().endsWith('[data-kind="destructive"]'));
  assert.ok(red, 'the destructive row has no colour rule of its own');
  assert.match(red[1], /color:\s*var\(--danger\)/);
  const ruleAbove = gated(':not([data-kind="destructive"]) + .popover__opt[data-kind="destructive"]');
  assert.equal(ruleAbove.length, 1, 'no rule separates the destructive group');
  assert.match(ruleAbove[0][1], /border-top:/);
});

test('the toast sits over the dock on a phone and bottom-left over the rail from 1280', () => {
  const phone = /@media \(max-width: 859px\)\s*\{\s*:root\[data-design="tisch"\]\[data-scheme="dark"\] \.toast \{([^}]*)\}/.exec(TISCH);
  assert.ok(phone, 'the phone seat for the toast is gone');
  assert.match(phone[1], /bottom:\s*var\(--dock-clearance\)/, 'the toast sits on top of the dock');
  const desk = /@media \(min-width: 1280px\)\s*\{\s*:root\[data-design="tisch"\]\[data-scheme="dark"\] \.toast \{([^}]*)\}/.exec(TISCH);
  assert.ok(desk, 'the desktop seat for the toast is gone');
  assert.match(desk[1], /transform:\s*none/, 'the app\'s centring transform survives, so `left` places the wrong edge');
  assert.match(desk[1], /left:[^;]*var\(--w-shell\)/, 'the toast is not aligned with the centred shell\'s rail');
});
