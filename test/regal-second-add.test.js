'use strict';

/* A second „Spiel hinzufügen" on the Regal (#1427).

   The dashed tile closes the grid, which on a big shelf is the end of a long
   scroll from the only add control. Der Tisch solved it in #1278 with two
   buttons (a header one, a sticky one under the grid); this slice gives the
   designs that still had the tile alone the same, each in its own vocabulary:

     Klassisch          every width            own `shelf-add` pair
     Ocean              1280px and up          the toolbar pill, shown earlier
     Das Programmheft   below 860px            a sticky black copy under the grid

   The views are asserted by RENDERING them; the per-width display rules are CSS,
   which jsdom does not apply, so they are asserted as text. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { ROOT, CSS, mediaBlocks, rulesOf, topLevel } = require('./support/css');

const RID = 'r1';

const roundFixture = () => ({
  id: RID,
  name: 'Freitagsrunde',
  tags: [],
  providers: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: [
    { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: [] },
    { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4, tagIds: [] },
  ],
  sessions: [],
  activity: [],
});

function boot(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('toast', () => {});
  dom.set('isLoggedIn', () => false);
  dom.set('canImportBgg', () => false);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  return { dom, round: roundFixture() };
}

function renderShelf(dom, round, games = round.games) {
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', round, games);
  return dom.app.querySelector('.section');
}

const follows = (dom, a, b) => Boolean(a.compareDocumentPosition(b) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);

/* ------------------------------------------------------------------ Klassisch */

test('Klassisch: a header button closes the toolbar and a second copy follows the grid; the tile stays', (t) => {
  const { dom, round } = boot(t, 'klassisch');
  const sec = renderShelf(dom, round);
  const grid = sec.querySelector('.cards');

  const bar = sec.querySelector('.section-head .section-tools').lastElementChild;
  assert.ok(bar.matches('button.btn.btn--primary.shelf-add.shelf-add--bar'), `the toolbar ends in ${bar.className}`);
  assert.equal(bar.textContent.trim(), 'Spiel hinzufügen');

  const dock = sec.lastElementChild;
  assert.ok(dock.matches('button.btn.btn--primary.shelf-add.shelf-add--dock'), `the section ends in ${dock.className}`);
  assert.equal(dock.textContent.trim(), 'Spiel hinzufügen');
  assert.ok(follows(dom, grid, dock), 'the sticky copy is AFTER the grid: a sticky box only sticks inside its parent, and DOM order is visual order');

  assert.ok(grid.lastElementChild.classList.contains('add-tile'), 'the dashed tile still closes the grid');
  assert.equal(sec.querySelector('.regal-add'), null, 'Der Tisch\'s, Ocean\'s and Das Programmheft\'s class must not leak into Klassisch');
});

test('Klassisch: both copies open the add sheet for the round', (t) => {
  for (const where of ['bar', 'dock']) {
    const { dom, round } = boot(t, 'klassisch');
    const opened = [];
    dom.set('showAddGame', (r) => opened.push(r.id));
    renderShelf(dom, round).querySelector(`.shelf-add--${where}`).click();
    assert.deepEqual(opened, [RID], `the ${where} copy did not open the add sheet`);
  }
});

test('Klassisch: an empty shelf takes neither — the empty state and its tile carry the add', (t) => {
  const { dom, round } = boot(t, 'klassisch');
  const sec = renderShelf(dom, round, []);
  assert.equal(sec.querySelector('.shelf-add'), null);
  assert.ok(sec.querySelector('.cards .add-tile'), 'the tile is the empty shelf\'s add');
});

test('the Klassisch pair exists under no other design', (t) => {
  for (const design of ['tisch', 'ocean', 'programmheft']) {
    const { dom, round } = boot(t, design);
    assert.equal(renderShelf(dom, round).querySelector('.shelf-add'), null, `.shelf-add leaked into ${design}`);
  }
});

/* ----------------------------------------------------------- Das Programmheft */

test('Programmheft: the phone copy follows the grid, the toolbar copy stays, an empty shelf takes neither', (t) => {
  const { dom, round } = boot(t, 'programmheft');
  const sec = renderShelf(dom, round);
  const grid = sec.querySelector('.cards');
  const dock = sec.querySelector('.regal-add--dock');
  assert.ok(dock && dock.matches('button.btn.btn--primary'), 'no sticky black copy for the phone');
  assert.ok(follows(dom, grid, dock), 'the phone copy is after the grid');
  assert.ok(follows(dom, dock, sec.querySelector('nav.ph-offshelf')), 'and before the list that closes the shelf');
  assert.ok(sec.querySelector('.section-tools .regal-add--bar'), 'the toolbar copy is gone');
  assert.ok(grid.lastElementChild.classList.contains('add-tile'), 'the tile stays in the grid');

  const empty = renderShelf(dom, round, []);
  assert.equal(empty.querySelector('.regal-add--dock'), null);
  assert.equal(empty.querySelector('.regal-add--bar'), null);
});

test('Programmheft: the phone copy opens the add sheet', (t) => {
  const { dom, round } = boot(t, 'programmheft');
  const opened = [];
  dom.set('showAddGame', (r) => opened.push(r.id));
  renderShelf(dom, round).querySelector('.regal-add--dock').click();
  assert.deepEqual(opened, [RID]);
});

/* ---------------------------------------------------------------- stylesheets */

const sheet = (name) => fs
  .readFileSync(path.join(ROOT, 'public', 'css', 'designs', name), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// The declarations of the rule whose selector is EXACTLY `selector`, looked up
// inside one media block (or the whole chunk it is given).
const ruleIn = (css, selector) => {
  const hit = rulesOf(css).find(([sel]) => sel === selector);
  return hit ? hit[1] : null;
};
const blockWith = (css, query, selector) => mediaBlocks(css)
  .find(([q, body]) => q === query && ruleIn(body, selector) !== null);

test('CSS Klassisch: the dock copy is hidden by default and sticks above the dock on a phone', () => {
  assert.match(ruleIn(topLevel(), '.shelf-add--dock'), /display:\s*none/, 'two copies would show at desktop');

  const phone = blockWith(CSS, '(max-width: 859px)', '.shelf-add--dock');
  assert.ok(phone, 'no phone block styles the dock copy');
  assert.match(ruleIn(phone[1], '.shelf-add--bar'), /display:\s*none/, 'the header copy must yield to the dock copy on a phone');
  const dock = ruleIn(phone[1], '.shelf-add--dock');
  assert.match(dock, /display:\s*block/);
  assert.match(dock, /position:\s*sticky/);
  assert.match(dock, /bottom:\s*calc\(var\(--dock-clearance\)/, 'it must ride above the floating dock');
  assert.match(dock, /min-height:\s*52px/, 'Der Tisch\'s plate is 52px; a thumb target no smaller');
});

test('CSS Klassisch: selecting hides both copies, as it drops the tile', () => {
  assert.match(ruleIn(topLevel(), '.is-selecting .shelf-add'), /display:\s*none/);
});

test('CSS Klassisch: nothing styles the bare `regal-add` of the other designs', () => {
  assert.equal(rulesOf(CSS).filter(([sel]) => /\.regal-add(?![\w-])/.test(sel)).length, 0,
    'a bare .regal-add rule in styles.css would reach Der Tisch, Ocean and Das Programmheft');
});

test('CSS Ocean: the toolbar pill shows from 600px up, the tablet-only rules stay tablet-only', () => {
  const ocean = sheet('ocean.css');
  const from600 = blockWith(ocean, '(min-width: 600px)', ':root[data-design="ocean"] .regal-add--bar');
  assert.ok(from600, 'the pill is not shown at desktop: the query must have no upper bound');
  assert.match(ruleIn(from600[1], ':root[data-design="ocean"] .regal-add--bar'), /display:\s*inline-flex/);

  const tablet = mediaBlocks(ocean).find(([q]) => q === '(min-width: 600px) and (max-width: 1279px)');
  assert.ok(tablet, 'the tablet block is gone');
  assert.ok(ruleIn(tablet[1], ':root[data-design="ocean"] .cards'), 'the four-column grid belongs to the tablet block only');
  assert.equal(ruleIn(tablet[1], ':root[data-design="ocean"] .regal-add--bar'), null, 'the pill\'s display moved out of the tablet block');
});

test('CSS Ocean: the pill needs room — from 1280px the short import label, below 1440px no „Sortiert:"', () => {
  /* Measured on the demo at 1366×768 (the most common laptop): the pill alone on
     a second toolbar line, head 85px → 133px. The short „Von BGG übernehmen" is
     what O3.3 draws, and „Sortiert:" (aria-hidden; the select names itself) is
     what buys the last ~80px below 1440. */
  const ocean = sheet('ocean.css');
  const long = ':root[data-design="ocean"] .regal-head .tools-label--long';
  const short = ':root[data-design="ocean"] .regal-head .tools-label--short';
  const wide = blockWith(ocean, '(min-width: 1280px)', long);
  assert.ok(wide, 'the long import label is not swapped for the short one from 1280px');
  assert.match(ruleIn(wide[1], long), /display:\s*none/);
  assert.match(ruleIn(wide[1], short), /display:\s*inline/);

  const prefix = ':root[data-design="ocean"] .regal-sort__prefix';
  const band = blockWith(ocean, '(min-width: 1280px) and (max-width: 1439px)', prefix);
  assert.ok(band, '„Sortiert:" does not yield between 1280 and 1439px');
  assert.match(ruleIn(band[1], prefix), /display:\s*none/);
  assert.equal(ruleIn(wide[1], prefix), null, 'the prefix must come back at 1440px, where the sheet draws it');
});

test('CSS Programmheft: the dock copy is hidden by default and sticks above the dock on a phone', () => {
  const ph = sheet('programmheft.css');
  const sel = ':root[data-design="programmheft"] .ph-regal .regal-add--dock';
  assert.match(ruleIn(topLevel(ph), sel), /display:\s*none/, 'two copies would show at desktop');

  const phone = blockWith(ph, '(max-width: 859px)', sel);
  assert.ok(phone, 'no phone block styles the dock copy');
  const dock = ruleIn(phone[1], sel);
  assert.match(dock, /display:\s*block/);
  assert.match(dock, /position:\s*sticky/);
  assert.match(dock, /bottom:\s*calc\(67px \+ env\(safe-area-inset-bottom/, 'it must clear the 64px cells + 3px rule of the flush dock');
  assert.match(dock, /min-height:\s*52px/);
});
