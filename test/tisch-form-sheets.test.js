'use strict';

/* Der Tisch's FORM sheets (#1273, T15a): the players, owners and cover editors
 * as row lists with one primary action, the filter panel's controls on raised
 * slips, and the anchored popover's title and ×.
 *
 * Driven under jsdom (.claude/rules/testing-views-under-jsdom.md), with
 * `window.matchMedia` stubbed to pick the presentation — false is the phone's
 * sheet, true the 1440 popover (.claude/rules/popover-vs-sheet-editors.md).
 *
 * The Klassisch half is the one that matters most and the easiest to get
 * wrong silently: every builder branches on designIs('tisch'), so the Klassisch
 * DOM is pinned tag-for-tag as it was before this change.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf } = require('./support/css');

const ROUND = {
  id: 1, name: 'Donnerstagsrunde', shared: false, sessions: [], activity: [], providers: [],
  members: [{ id: 'm1', name: 'Lea', userId: 'u1' }, { id: 'm2', name: 'Jonas' }],
  games: [{ id: 7, title: 'Catan', tagIds: [3], ownerIds: ['m1'], minPlayers: 2, maxPlayers: 4,
    image: '/uploads/catan.jpg', source: { provider: 'bgg', externalId: '13', url: '' },
    retired: false, completed: false }],
  tags: [{ id: 3, name: 'Strategie', icon: 'chess' }],
};

const OPENERS = { players: 'openPlayersPopover', owners: 'openOwnersPopover', cover: 'openImagePopover' };

/** Open one game editor under `design` at `wide` and hand back the dom + what it built. */
function open(t, { design, wide, editor }) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run(`window.matchMedia = () => ({ matches: ${wide}, addEventListener() {}, removeEventListener() {} });`);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.run(`window.__patches = [];`);
  dom.run(`window.__ctx = { rid: 1, round: ${JSON.stringify(ROUND)}, game: ${JSON.stringify(ROUND.games[0])},
    updateGame(p) { window.__patches.push(p); }, refresh() {} };`);
  dom.run(`window.__anchor = document.createElement('button'); document.body.appendChild(window.__anchor);`);
  dom.run(`${OPENERS[editor]}(window.__ctx, window.__anchor)`);
  const card = wide ? dom.document.querySelector('.popover') : dom.document.querySelector('.sheet');
  assert.ok(card, `${editor} opened no ${wide ? 'popover' : 'sheet'}`);
  const body = wide ? card : card.querySelector('.editor');
  return { dom, card, body, patches: () => JSON.parse(dom.run('JSON.stringify(window.__patches)')) };
}

// tag.class for every element under `root`, in document order — the structure,
// without the inline `top/left` a popover gets from place().
const shape = (root) => [...root.querySelectorAll('*')].map((n) => n.tagName.toLowerCase()
  + (n.getAttribute('class') ? '.' + n.getAttribute('class').trim().split(/\s+/).join('.') : ''));

// What each editor rendered on origin/main before #1273, recorded from the real
// builders. Identical at both widths — the builder is presentation-blind.
const KLASSISCH = {
  players: ['div.pp-row', 'input.input', 'span', 'input.input', 'button.btn.btn--primary'],
  owners: ['div.filter-chips', 'button.chip.is-on', 'span.chip__avatar.avatar', 'button.chip',
    'span.chip__avatar.avatar', 'div.pp-row', 'button.btn.btn--primary'],
  cover: ['button.btn.btn--primary', 'button.btn', 'div.cover-picker', 'button.link-btn.cover-picker__toggle',
    'i.ti.ti-photo', 'span', 'div.cover-picker__body', 'button.btn.btn--ghost', 'div.muted.popover__hint'],
};

for (const editor of Object.keys(KLASSISCH)) {
  for (const wide of [false, true]) {
    test(`Klassisch: the ${editor} editor at ${wide ? 1440 : 390} is exactly what it was before #1273`, (t) => {
      const { card, body } = open(t, { design: 'klassisch', wide, editor });
      assert.deepEqual(shape(body), KLASSISCH[editor]);
      if (wide) {
        // No head, no role, no name: the popover is the plain card it always was.
        assert.equal(card.querySelector('.popover__head'), null);
        assert.equal(card.getAttribute('role'), null);
        assert.equal(card.getAttribute('aria-label'), null);
      }
    });
  }
}

/* --------------------------------------------- the popover's head (T15a) */

test('Der Tisch at 1440: every openEditor popover carries its title and a working ×', async (t) => {
  for (const editor of Object.keys(OPENERS)) {
    const { dom, card } = open(t, { design: 'tisch', wide: true, editor });
    const head = card.firstElementChild;
    assert.ok(head && head.classList.contains('popover__head'), `${editor}: the head is not the card's first child`);
    const title = head.querySelector('.popover__title');
    const expected = dom.run(`t(${JSON.stringify({ players: 'detail.onboard.players', owners: 'detail.onboard.owners', cover: 'detail.onboard.cover' }[editor])})`);
    assert.equal(title.textContent, expected);
    assert.equal(card.getAttribute('role'), 'dialog');
    assert.equal(card.getAttribute('aria-label'), expected);
    const x = head.querySelector('button.popover__close');
    assert.equal(x.getAttribute('aria-label'), 'Schließen');
    x.click();
    await flush();
    assert.equal(dom.document.querySelector('.popover'), null, `${editor}: × did not close the popover`);
  }
});

test('the × runs the same onClose every other exit does: the filter trigger drops aria-expanded', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run("window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });");
  dom.run("applyDesign('tisch')");
  const games = [{ id: 1, title: 'A', categories: ['Party'], playtimeMin: 30, playtimeMax: 60 }];
  dom.run(`window.__fp = renderFilterPanel(${JSON.stringify(games)}, { categories: [], excludeCategories: [], mechanics: [], excludeMechanics: [] }, () => {}, null);
    document.body.appendChild(window.__fp.el);`);
  const trigger = dom.document.querySelector('.fbar__trigger');
  trigger.click();
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  const head = dom.document.querySelector('.popover .popover__head');
  assert.ok(head, 'the filter popover has no head under Der Tisch');
  assert.equal(head.querySelector('.popover__title').textContent, dom.run("t('games.filter')"));
  head.querySelector('.popover__close').click();
  await flush();
  assert.equal(dom.document.querySelector('.popover'), null);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'the × left aria-expanded stuck on true');
  assert.equal(dom.run('window.__fp.isOpen()'), false);
});

/* ---------------------------------- rows + one primary, at both widths */

const labels = (root) => [...root.querySelectorAll('button, input, .editor-row__label')]
  .filter((n) => !n.closest('.popover__head'))
  .map((n) => n.tagName.toLowerCase() + ':' + (n.getAttribute('aria-label') || n.textContent.trim()));

for (const editor of Object.keys(OPENERS)) {
  test(`Der Tisch: the ${editor} editor is rows over ONE primary, in the same order at 390 and 1440`, (t) => {
    const phone = open(t, { design: 'tisch', wide: false, editor });
    const desk = open(t, { design: 'tisch', wide: true, editor });
    for (const [where, { body }] of [['390', phone], ['1440', desk]]) {
      assert.ok(body.querySelectorAll('.editor-row, .cover-picker__toggle').length >= 1, `${where}: no rows`);
      const primaries = body.querySelectorAll('.btn--primary');
      assert.equal(primaries.length, 1, `${where}: ${primaries.length} primary actions`);
      assert.ok(primaries[0].parentElement.classList.contains('editor-actions'), `${where}: the primary is not in the action bar`);
      // No second .btn beside it: every other action became a row.
      assert.equal(body.querySelectorAll('.btn:not(.btn--primary)').length, 0, `${where}: a secondary .btn survived`);
      // The primary sits under every row.
      const rows = [...body.querySelectorAll('.editor-row, .cover-picker__toggle')];
      const last = rows[rows.length - 1];
      assert.ok(last.compareDocumentPosition(primaries[0]) & 4, `${where}: the primary is above a row`);
    }
    assert.deepEqual(labels(desk.body), labels(phone.body), 'the two presentations disagree about their content');
  });
}

test('Der Tisch: an owner row is an aria-pressed toggle, and Übernehmen commits the ticked set', (t) => {
  const { dom, body, patches } = open(t, { design: 'tisch', wide: false, editor: 'owners' });
  const rows = [...body.querySelectorAll('.editor-row--toggle')];
  assert.deepEqual(rows.map((r) => [r.querySelector('.editor-row__label').textContent, r.getAttribute('aria-pressed')]),
    [['Lea', 'true'], ['Jonas', 'false']]);
  rows[0].click();
  rows[1].click();
  assert.deepEqual(rows.map((r) => r.getAttribute('aria-pressed')), ['false', 'true']);
  body.querySelector('.btn--primary').click();
  assert.deepEqual(patches(), [{ ownerIds: ['m2'] }]);
  assert.equal(dom.document.querySelector('.sheet'), null, 'the sheet stayed open after committing');
});

test('Der Tisch: the players row names both fields and still saves on Übernehmen', (t) => {
  const { body, patches } = open(t, { design: 'tisch', wide: false, editor: 'players' });
  const row = body.querySelector('.editor-row[role="group"]');
  const label = body.querySelector('#' + row.getAttribute('aria-labelledby'));
  assert.equal(label.textContent, 'Personen (min.–max.)');
  const [min, max] = row.querySelectorAll('input');
  assert.deepEqual([min.getAttribute('aria-label'), max.getAttribute('aria-label')], ['Min.', 'Max.']);
  assert.deepEqual([min.value, max.value], ['2', '4']);
  max.value = '6';
  body.querySelector('.btn--primary').click();
  assert.deepEqual(patches(), [{ minPlayers: 2, maxPlayers: 6 }]);
});

test('Der Tisch: the cover editor keeps every way to a cover, pasting as the one primary', (t) => {
  const { body, patches } = open(t, { design: 'tisch', wide: true, editor: 'cover' });
  const rows = [...body.querySelectorAll('.editor-row, .cover-picker__toggle')]
    .map((r) => r.textContent.replace(/\s+/g, ' ').trim());
  assert.deepEqual(rows, ['Titelbild von BGG holen', 'Cover der Ausgabe wählen', 'Bild entfernen']);
  assert.equal(body.querySelector('.btn--primary').textContent, 'Neues Bild einfügen');
  assert.ok(body.querySelector('.editor-row--danger'), 'the remove row lost its destructive tone');
  // Removing still does exactly what it did — no confirmation was added.
  body.querySelector('.editor-row--danger').click();
  assert.deepEqual(patches(), [{ removeImage: true }]);
});

/* ------------------------------------------------------------ the CSS */

const TISCH = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const HOOK = ':root[data-design="tisch"]';
const body = (sel) => {
  const hit = rulesOf(TISCH).find(([s]) => s.split(',').map((x) => x.trim()).includes(sel));
  assert.ok(hit, `no rule for ${sel}`);
  return hit[1];
};

test('the popover head is a 15px small-caps title that never shrinks with a capped card', () => {
  assert.match(body(`${HOOK} .popover__head`), /flex:\s*none/);
  const title = body(`${HOOK} .popover__title`);
  assert.match(title, /font-size:\s*15px/);
  assert.match(title, /text-transform:\s*uppercase/);
  // SC 2.5.8: the × is at least 24px.
  const x = body(`${HOOK} .popover__close`);
  assert.ok(Number(/width:\s*(\d+)px/.exec(x)[1]) >= 24);
  assert.ok(Number(/height:\s*(\d+)px/.exec(x)[1]) >= 24);
});

test('a T15a row is 44px, and the primary under it is 48px in a sheet', () => {
  assert.match(body(`${HOOK} .editor-row`), /min-height:\s*44px/);
  assert.match(body(`${HOOK} .sheet .editor-actions .btn`), /min-height:\s*48px/);
  // The toggle's state is a tick, not the rim alone.
  assert.match(body(`${HOOK} .editor-row[aria-pressed="true"] .editor-row__tick`), /visibility:\s*visible/);
});

test('nothing here resizes a popover card — the tags, owners and cover caps stay the app\'s', () => {
  const offenders = rulesOf(TISCH)
    .filter(([s]) => /\.popover(?:--[a-z]+)?\b/.test(s) && /\.popover--(tags|owners|image)\s*$|\.popover\s*$/.test(s.split(',').pop().trim()))
    .filter(([, b]) => /(^|[;\s])(max-|min-)?width\s*:/.test(b));
  assert.deepEqual(offenders.map(([s]) => s), []);
});

test('the head and the rows paint from app tokens only, so a light round (pre-flip) still styles them', () => {
  /* The JS builds this markup whenever Der Tisch is worn — also inside a round
     whose own light palette keeps the design's gated colour block from matching
     (.claude/rules/design-colour-blocks-are-scheme-gated.md). A --paper-* or
     --gold-* token read here would be UNSET there, and the row would fall back
     to a UA button. */
  const mine = rulesOf(TISCH).filter(([s]) => s.startsWith(`${HOOK} `)
    && /\.(popover__(head|title|close)|editor-rows?|editor-row__|editor-actions)|cover-picker__toggle|popover--filter/.test(s));
  assert.ok(mine.length >= 15, `only ${mine.length} rules found — the lookup is vacuous`);
  const leaks = mine.filter(([, b]) => /var\(--(paper|gold|brass|felt)/.test(b)).map(([s]) => s);
  assert.deepEqual(leaks, []);
  const gated = mine.filter(([s]) => s.includes('[data-scheme=')).map(([s]) => s);
  assert.deepEqual(gated, [], 'a scheme-gated copy would leave the markup unstyled in a light round');
});
