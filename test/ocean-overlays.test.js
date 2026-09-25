'use strict';

/* Ocean's OVERLAYS (#1217) — sheets and their popover twins, the confirm
 * dialog, the toast and the „…" menu (O15a, O15b).
 *
 * The repaint's colours are covered generically — test/design-layer.test.js
 * refuses a literal or a shadowed token in ocean.css and
 * test/a11y-contrast.test.js measures the tokens it reads. What they cannot see
 * is below:
 *
 *   1. Ocean draws the SAME form markup Der Tisch does (formSheetDesign): the
 *      popover's title bar and the three editors' row lists, with the same
 *      buttons in the same order at 390 and 1440 — and Klassisch draws neither;
 *   2. the CSS claims whose regression renders plausibly: the sticky bars'
 *      ground, the destructive fill confined to a dialog, the docked editor and
 *      its grip confined to a phone, the menu's groups, the target sizes, the
 *      scrim, and no design reopening #858's ellipse toast.
 *
 * The menu ORDER, the kinds' truth and „no OK / no Bist du sicher" are
 * design-independent behaviour and live in test/tisch-overlays.test.js.
 *
 * Named for what it covers: `popover`, `sheet` and `confirm-dialog` are taken
 * (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf, mediaBlocks } = require('./support/css');

const ROOT = path.join(__dirname, '..');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (rel) => strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const OCEAN = read('public/css/designs/ocean.css');
const APP_CSS = read('public/styles.css');
const O = ':root[data-design="ocean"]';
const G = ':root[data-design="ocean"]:not([data-scheme="dark"])';
const RULES = rulesOf(OCEAN).map(([sel, body]) => [sel.replace(/\s+/g, ' ').trim(), body]);
// Every rule whose selector names `needle`, and the joined bodies.
const rulesNaming = (needle) => RULES.filter(([sel]) => sel.includes(needle));
const bodiesNaming = (needle) => rulesNaming(needle).map(([, b]) => b).join(';');

/* ------------------------------------------------- 1. the form markup */

const ROUND = {
  id: 1, name: 'Donnerstagsrunde', shared: false, sessions: [], activity: [], providers: [],
  members: [{ id: 'm1', name: 'Lea', userId: 'u1' }, { id: 'm2', name: 'Jonas' }],
  games: [{ id: 7, title: 'Catan', tagIds: [3], ownerIds: ['m1'], minPlayers: 2, maxPlayers: 4,
    image: '/uploads/catan.jpg', source: { provider: 'bgg', externalId: '13', url: '' },
    retired: false, completed: false }],
  tags: [{ id: 3, name: 'Strategie', icon: 'chess' }],
};
const OPENERS = { players: 'openPlayersPopover', owners: 'openOwnersPopover', cover: 'openImagePopover' };
const TITLES = { players: 'detail.onboard.players', owners: 'detail.onboard.owners', cover: 'detail.onboard.cover' };

function open(t, { design, wide, editor }) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run(`window.matchMedia = () => ({ matches: ${wide}, addEventListener() {}, removeEventListener() {} });`);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.run(`window.__ctx = { rid: 1, round: ${JSON.stringify(ROUND)}, game: ${JSON.stringify(ROUND.games[0])},
    updateGame() {}, refresh() {} };`);
  dom.run('window.__anchor = document.createElement(\'button\'); document.body.appendChild(window.__anchor);');
  dom.run(`${OPENERS[editor]}(window.__ctx, window.__anchor)`);
  const card = wide ? dom.document.querySelector('.popover') : dom.document.querySelector('.sheet');
  assert.ok(card, `${editor} opened no ${wide ? 'popover' : 'sheet'}`);
  return { dom, card, body: wide ? card : card.querySelector('.editor') };
}

const contentLabels = (root) => [...root.querySelectorAll('button, input, .editor-row__label')]
  .filter((n) => !n.closest('.popover__head'))
  .map((n) => n.tagName.toLowerCase() + ':' + (n.getAttribute('aria-label') || n.textContent.trim()));

test('formSheetDesign names Der Tisch and Ocean, and nothing else', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  const ids = JSON.parse(dom.run('JSON.stringify(DESIGN_REGISTRY.map((d) => d.id))'));
  assert.ok(ids.length >= 3, 'the registry read is vacuous');
  const drawn = ids.filter((id) => { dom.run(`applyDesign(${JSON.stringify(id)})`); return dom.run('formSheetDesign()'); });
  assert.deepEqual(drawn.sort(), ['ocean', 'tisch']);
});

for (const editor of Object.keys(OPENERS)) {
  test(`Ocean: the ${editor} editor is rows over ONE primary, the same at 390 and 1440`, (t) => {
    const phone = open(t, { design: 'ocean', wide: false, editor });
    const desk = open(t, { design: 'ocean', wide: true, editor });
    for (const [where, { body }] of [['390', phone], ['1440', desk]]) {
      assert.ok(body.querySelector('.editor-row'), `${editor} at ${where}: no .editor-row — Ocean fell back to Klassisch`);
      assert.equal(body.querySelectorAll('.btn--primary').length, 1, `${editor} at ${where}: not exactly one primary`);
      assert.ok(body.querySelector('.editor-actions > .btn--primary'), `${editor} at ${where}: the primary is not under the rows`);
    }
    assert.deepEqual(contentLabels(desk.body), contentLabels(phone.body),
      `${editor}: the popover and the sheet disagree about their own content`);
    assert.ok(phone.dom.document.querySelector('.sheet-backdrop--editor'),
      `${editor}: the sheet does not carry sheet-backdrop--editor, so Ocean cannot dock it`);
  });
}

test('Ocean at 1440: the editor popover carries its title and a × that closes it', async (t) => {
  for (const editor of Object.keys(OPENERS)) {
    const { dom, card } = open(t, { design: 'ocean', wide: true, editor });
    const head = card.firstElementChild;
    assert.ok(head && head.classList.contains('popover__head--editor'), `${editor}: no editor head first in the card`);
    const title = dom.run(`t(${JSON.stringify(TITLES[editor])})`);
    assert.equal(head.querySelector('.popover__title').textContent, title);
    assert.equal(card.getAttribute('aria-label'), title);
    assert.ok(card.classList.contains('popover--editor'), `${editor}: no popover--editor — the 300px floor cannot reach it`);
    head.querySelector('.popover__close').click();
    await flush();
    assert.equal(dom.document.querySelector('.popover'), null, `${editor}: × did not close the popover`);
  }
});

test('Klassisch at 1440 still gets the plain card — no head, no rows', (t) => {
  for (const editor of Object.keys(OPENERS)) {
    const { card } = open(t, { design: 'klassisch', wide: true, editor });
    assert.equal(card.querySelector('.popover__head'), null, `${editor}: Klassisch grew a head`);
    assert.equal(card.querySelector('.editor-row'), null, `${editor}: Klassisch grew rows`);
    assert.equal(card.classList.contains('popover--editor'), false, `${editor}: Klassisch's card gained the editor class`);
  }
});

/* ------------------------------------------------- 2. the CSS claims */

test('the sheet re-points whatever its sticky bars paint from', () => {
  /* Derived, not listed: `.sheet__head` and `.sheet__actions` are sticky and
     need an opaque ground, which styles.css takes from --page-bg — Ocean's
     WATER — so without a re-point both bars painted as tinted bands on the
     paper (the #1193 defect, one design over). Whatever they read tomorrow,
     the sheet must answer for it. */
  const sources = new Set();
  for (const sel of ['.sheet__head', '.sheet__actions']) {
    const hit = rulesOf(APP_CSS).find(([s]) => s.trim() === sel);
    assert.ok(hit, `styles.css has no ${sel} rule`);
    const m = /background:\s*var\((--[\w-]+)\)/.exec(hit[1]);
    assert.ok(m, `${sel} no longer paints from a token — re-derive this test`);
    sources.add(m[1]);
  }
  const sheet = RULES.filter(([sel]) => sel === `${G} .sheet`).map(([, b]) => b).join(';');
  assert.ok(sheet, 'ocean.css has no gated .sheet rule');
  for (const token of sources) {
    assert.match(sheet, new RegExp(`${token}\\s*:\\s*var\\(--surface\\)`),
      `the sticky bars paint from ${token}, which Ocean's sheet leaves on the water`);
  }
});

test('a destructive button is red-FILLED in a dialog only, at rest and under the pointer', () => {
  // The rules that FILL one (#1210's outline hover only moves the edge and ink).
  // A `:not(.btn--danger)` names the class to EXCLUDE it, so it is dropped first.
  const bare = (sel) => sel.replace(/:not\([^)]*\)/g, '');
  const danger = RULES
    .filter(([sel, body]) => bare(sel).includes('.btn--danger') && /background:/.test(body))
    .map(([sel, body]) => [bare(sel), body]);
  assert.ok(danger.length >= 2, 'no destructive fill rule found — the check is vacuous');
  for (const [sel] of danger) {
    assert.ok(sel.split(',').every((s) => s.includes('.sheet__actions--confirm')),
      `„${sel}" fills a destructive button outside the confirm dialog — O15a: never a sheet's primary`);
  }
  const rest = danger.find(([sel]) => sel.split(',').some((s) => s.trim() === bare(`${G} .sheet__actions--confirm .btn--danger`)));
  assert.ok(rest, 'no resting destructive fill');
  assert.match(rest[1], /background:\s*var\(--danger\)/);
  assert.match(rest[1], /color:\s*var\(--surface\)/);
  const hover = danger.filter(([sel]) => sel.includes(':hover'));
  assert.ok(hover.length >= 1 && hover.every(([, b]) => /background:\s*var\(--danger(-strong)?\)/.test(b)),
    'the hover does not restate the fill — `.btn:hover` would repaint it as a tint under the light verb');
});

test('the docked editor and the grip exist on a phone only', () => {
  const phone = mediaBlocks(OCEAN).filter(([q]) => /max-width:\s*639px/.test(q)).map(([, css]) => css).join('\n');
  assert.match(phone, /\.sheet-backdrop--editor\s*\{[^}]*align-items:\s*flex-end/, 'the editor is not docked below 640px');
  assert.match(phone, /\.sheet__head::before\s*\{[^}]*width:\s*44px/, 'no grip on the phone sheet');
  // Outside that block, neither may appear — the desktop's popover has no grip (O15a difference 1).
  const outside = strip(OCEAN).replace(/@media[^{]*max-width:\s*639px[^{]*\{[\s\S]*?\n\}/g, '');
  assert.doesNotMatch(outside, /sheet__head::before/, 'a grip escaped the phone block');
  assert.doesNotMatch(outside, /\.sheet-backdrop--editor\s*\{/, 'the dock escaped the phone block');
});

test('the menu paints by KIND: red for destructive, a hairline at every group boundary', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/popover.js'), 'utf8');
  const kinds = JSON.parse(/const MENU_KINDS = (\[[^\]]*\]);/.exec(src)[1].replace(/'/g, '"'));
  assert.deepEqual(kinds.at(-1), 'destructive');
  assert.match(bodiesNaming('.popover--menu .popover__opt[data-kind="destructive"]'), /color:\s*var\(--danger\)/);
  const seps = rulesNaming('.popover--menu :is(').map(([sel]) => sel).join(' ');
  for (const kind of kinds.slice(0, -1)) {
    assert.ok(seps.includes(`.popover__opt[data-kind="${kind}"] + .popover__opt:not([data-kind="${kind}"])`),
      `no hairline after the „${kind}" group`);
  }
});

test('every overlay control meets its target token', () => {
  const minH = (needle) => (/min-height:\s*([^;]+);/.exec(bodiesNaming(needle)) || [])[1];
  assert.equal(minH(`${O} .popover__close`), 'var(--target-control)', 'the popover × is under 40px');
  assert.equal(minH(`${O} .editor-row {`.slice(0, -2)), '44px', 'an editor row is under 44px');
  assert.equal(minH('.popover--menu .popover__opt {'.slice(0, -2)), '44px', 'a menu row is under 44px');
  assert.equal(minH(`${O} .sheet .ds-row`), '44px', 'a list row in a sheet is under 44px');
  // Toast actions: 24px, the floor (#1210's rule; pinned here because O15b names it).
  assert.match(bodiesNaming('.toast__action'), /min-height:\s*var\(--target-text\)/);
});

test('the form rows are ungated geometry that paints from app tokens', () => {
  /* The markup is built whenever the design is worn; if the colour gate ever
     failed to match, a gated row rule would leave bare UA buttons
     (.claude/rules/design-colour-blocks-are-scheme-gated.md, „the inverse"). So
     every rule naming `.editor-row` sits on the bare hook, and any Ocean-only
     token it reads carries an app-token fallback. */
  const rows = rulesNaming('.editor-row');
  assert.ok(rows.length >= 8, `only ${rows.length} row rules found`);
  const oceanOnly = ['--line-soft', '--danger-soft'];
  for (const [sel, body] of rows) {
    assert.ok(!sel.includes(':not([data-scheme="dark"])'), `„${sel}" is gated`);
    for (const tok of oceanOnly) {
      if (body.includes(`var(${tok})`)) assert.fail(`„${sel}" reads ${tok} with no fallback`);
    }
  }
});

test('the scrim is --ink at 34%, declared where the harness resolves it', () => {
  const { blocksOf } = require('./support/theme');
  const { designById } = require('../public/js/designs');
  const b = blocksOf(designById('ocean'));
  assert.ok(b && b.light, 'no Ocean colour block');
  assert.match(b.light, /--scrim:\s*color-mix\(in oklab, var\(--ink\) 34%, transparent\);/);
});

test('no design stylesheet gives the toast the pill radius (#858)', () => {
  /* test/toast-shape.test.js pins styles.css; a design sheet re-declaring the
     pill undoes it on that design alone, which is what #1210 shipped for Ocean:
     a wrapped toast painted as an ellipse over the page. */
  const dir = path.join(ROOT, 'public/css/designs');
  const sheets = fs.readdirSync(dir).filter((f) => f.endsWith('.css'));
  assert.ok(sheets.length >= 2);
  for (const f of sheets) {
    for (const [sel, body] of rulesOf(strip(fs.readFileSync(path.join(dir, f), 'utf8')))) {
      if (!/\.toast\b(?![\w-])/.test(sel)) continue;
      assert.doesNotMatch(body, /border-radius:\s*var\(--radius-pill\)/, `${f}: „${sel.trim()}" is a pill again`);
    }
  }
});
