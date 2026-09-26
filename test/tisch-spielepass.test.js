'use strict';

/* Der Tisch's SPIELEPASS composition (#1274, T3.4 desktop / T6.3 phone).

   Under Der Tisch the game detail screen states the score as a NUMERAL beside
   the title, lists „Verwandte Sessions" as dated rows with winners, and shows
   the page menu's items as an „Aktionen" panel — built from the same list
   `fillMenu` sorts, with the „…" gone. Klassisch must not notice any of it.

   Driven under jsdom (.claude/rules/testing-views-under-jsdom.md): every claim
   here is about what the view RENDERS. The phone's half-height cover header is
   CSS only, so its one load-bearing claim — the title band is opaque and its
   text clears AA whatever the cover is — is asserted over the stylesheet and the
   design's resolved tokens at the end. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');
const { contrast, token } = require('./support/theme');
const { designById } = require('../public/js/designs');

const RID = 'r1';

function roundFixture() {
  return {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    providers: [],
    members: [
      { id: 'm1', name: 'Anna' },
      { id: 'm2', name: 'Ben' },
      { id: 'm3', name: 'Cleo' },
    ],
    games: [
      // Linked to a provider, so the menu carries all three of its items
      // (retire, complete, unlink) — the panel has something to order.
      { id: 'g1', title: 'Catan', image: '/uploads/catan.jpg', tagIds: [],
        source: { provider: 'bgg', externalId: '13', url: 'https://boardgamegeek.com/boardgame/13' } },
      { id: 'g2', title: 'Azul', tagIds: [] },
    ],
    sessions: [
      {
        id: 's1', createdAt: '2026-06-01T19:00:00.000Z', finished: true,
        gameIds: ['g1', 'g2'], chosenGameId: 'g1', winnerIds: ['m1'],
        votes: { m1: { g1: { rating: 5 } }, m2: { g1: { rating: 4 } }, m3: { g1: { rating: 4 } } },
      },
      // On the ballot, not chosen — a row that has no winner to name.
      {
        id: 's2', createdAt: '2026-06-08T19:00:00.000Z', finished: true,
        gameIds: ['g1', 'g2'], chosenGameId: 'g2', winnerIds: ['m2'], votes: {},
      },
      {
        id: 's3', createdAt: '2026-06-15T19:00:00.000Z', finished: true,
        gameIds: ['g1'], chosenGameId: 'g1', winnerIds: ['m2', 'm3'], votes: {},
      },
    ],
  };
}

async function render(t_, design) {
  const dom = loadApp({ locale: 'de' });
  t_.after(() => dom.close());
  const round = roundFixture();
  dom.set('api', async (method, url) => {
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    return {};
  });
  dom.set('toast', () => {});
  const confirms = [];
  dom.set('confirmDialog', async (opts) => { confirms.push(opts); return false; });
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  await dom.call('showGameDetail', RID, 'g1');
  return { dom, confirms };
}

const labelsOf = (els) => [...els].map((b) => b.textContent.trim());
const classOrder = (page) => [...page.children].map((c) => [...c.classList].find((k) => k.startsWith('gd-')));

/* ------------------------------ Klassisch: unchanged ----------------------------- */

test('Klassisch: the spread is exactly #1039\'s — cover pill, stamps, „…", history before raters', async (t_) => {
  const { dom } = await render(t_, 'klassisch');
  const app = dom.app;
  assert.ok(app.querySelector('.gd-cover .gd-score .score-pill--lg'), 'the cover pill is gone');
  assert.equal(app.querySelector('.gd-titleline, .gd-bignum'), null, 'Klassisch grew the Tisch numeral');

  const stamps = app.querySelectorAll('.gd-history .stamps > a.stamp');
  assert.equal(stamps.length, 3, 'one stamp per related session');
  assert.equal(app.querySelector('.gd-plays'), null, 'Klassisch rendered the Tisch list');

  assert.equal(app.querySelector('.gd-actions'), null, 'Klassisch rendered the Aktionen panel');
  const menu = app.querySelector('.back-row .gd-menu');
  assert.ok(menu, 'the „…" menu is gone');
  assert.ok(app.querySelector('.back-row').classList.contains('back-row--split'));

  assert.deepEqual(classOrder(app.querySelector('.pass__table')), ['gd-history', 'gd-raters', 'gd-bar']);

  // The menu still lists the three items in fillMenu's order.
  menu.click();
  const opts = dom.document.querySelectorAll('.popover--menu .popover__opt');
  assert.deepEqual(labelsOf(opts), ['Durchgespielt', 'Aussortieren', 'Verknüpfung lösen']);
});

/* --------------------------------- Tisch: the pass -------------------------------- */

test('Tisch: the score is a numeral BESIDE the title, not a pill on the cover', async (t_) => {
  const { dom } = await render(t_, 'tisch');
  const app = dom.app;
  assert.equal(app.querySelector('.gd-cover .gd-score'), null, 'the cover still carries the pill');
  const line = app.querySelector('.gd-info > .gd-titleline');
  assert.ok(line, 'no title line');
  // DOM order = reading order: the title, then the number.
  assert.deepEqual([...line.children].map((c) => c.className), ['', 'gd-bignum']);
  assert.equal(line.children[0].tagName, 'H1');
  const n = line.querySelector('.gd-bignum__n').textContent.trim();
  assert.match(n, /^\d,\d$/, `the numeral reads „${n}"`);
  const cap = line.querySelector('.gd-bignum__cap');
  assert.match(cap.textContent, /Spielwirbel-Score/);
  assert.ok(cap.querySelector('.score-info'), 'the ⓘ went with the pill');
  assert.equal(line.querySelector('.gd-bignum__ev').textContent.trim(), '3 Bewertungen');
});

test('Tisch: „Verwandte Sessions" is a dated list naming the winners, rows linking to results', async (t_) => {
  const { dom } = await render(t_, 'tisch');
  const app = dom.app;
  assert.equal(app.querySelector('.stamps'), null, 'the stamp strip rendered under Tisch');
  const rows = app.querySelectorAll('.gd-history ul.gd-plays > li.gd-play');
  assert.equal(rows.length, 3);
  const text = (r) => r.querySelector('.gd-play__what').textContent.trim();
  // Newest first, exactly as the stamps.
  assert.match(rows[0].querySelector('.gd-play__date').textContent, /15\.06\.2026/);
  assert.equal(text(rows[0]), 'Ben, Cleo haben gewonnen');
  assert.ok(rows[1].classList.contains('gd-play--muted'), 'a not-chosen session is muted');
  assert.equal(rows[1].querySelector('.avatar'), null, 'nobody won THIS game there');
  assert.equal(text(rows[2]), 'Anna hat gewonnen');
  assert.ok(rows[2].querySelector('.avatar'), 'the winner\'s counter');
  assert.ok(rows[2].querySelector('.score-pill'), 'the evening\'s pill');
  assert.match(rows[2].querySelector('a').getAttribute('href'), /\/session\/s1$/);
});

test('Tisch: the menu\'s items are an Aktionen panel in fillMenu\'s order, and „…" is gone', async (t_) => {
  const { dom, confirms } = await render(t_, 'tisch');
  const app = dom.app;
  assert.equal(app.querySelector('.gd-menu'), null, 'the „…" is still there');
  assert.ok(!app.querySelector('.back-row').classList.contains('back-row--split'));

  const btns = app.querySelectorAll('.gd-actions .gd-actions__grid > button.gd-act');
  assert.deepEqual(labelsOf(btns), ['Durchgespielt', 'Aussortieren', 'Verknüpfung lösen']);
  // Retiring is reversible, so it sits with completion above the rule (#1360).
  assert.deepEqual([...btns].map((b) => b.dataset.kind), ['undoable', 'undoable', 'destructive']);

  // The raters lead, the history follows, then the panel, then the bar.
  assert.deepEqual(classOrder(app.querySelector('.pass__table')), ['gd-raters', 'gd-history', 'gd-actions', 'gd-bar']);

  // Each button runs the item's own confirm — the same one the menu raised.
  btns[1].click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(confirms.length, 1);
  assert.equal(confirms[0].confirmLabel, 'Aussortieren');
});

/* ------------------------------- Contrast (tokens) ------------------------------- */

const SHEET = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('the phone\'s title band is OPAQUE walnut, so its contrast never depends on the cover', () => {
  const hit = rulesOf(SHEET).find(([sel, body]) => /\.gd-titleline$/.test(sel.trim()) && /background:/.test(body));
  assert.ok(hit, 'no background on the title band');
  assert.match(hit[1], /background:\s*var\(--surface\)/);
  // The pair below measures --danger on --surface; the rule must paint that.
  const red = rulesOf(SHEET).find(([sel]) => /\.gd-act\[data-kind="destructive"\]$/.test(sel.trim()));
  assert.ok(red, 'no destructive Aktionen rule');
  assert.match(red[1], /background:\s*var\(--surface\)/);
  assert.match(red[1], /color:\s*var\(--danger\)/);
});

test('every new text pair clears AA on Der Tisch', () => {
  const tisch = designById('tisch');
  const tk = (n) => token(n, tisch);
  const pairs = [
    ['title/numeral on the band', '--ink', '--surface'],
    ['caption / winner line on the band', '--ink-soft', '--surface'],
    ['Aktionen label', '--ink', '--control-fill'],
    // On --surface, deliberately: on --control-fill it is 4.47:1.
    ['destructive Aktionen label', '--danger', '--surface'],
  ];
  for (const [what, fg, bg] of pairs) {
    const r = contrast(tk(fg), tk(bg));
    assert.ok(r >= 4.5, `${what}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
  }
});
