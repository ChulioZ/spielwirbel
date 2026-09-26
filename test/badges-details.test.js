'use strict';

/* The three Abzeichen details the first batch left out (#1386): the legend in
 * Pokale › Abzeichen (T17.2, O17.2), „Platz N" on a member row (T17.2) and the
 * chevron on the Tischkarte row (T17.4, O17.4). All three are SHARED K17 markup
 * (views-badges.js) that Klassisch shows and each design skins or hides, so
 * they are rendered here under jsdom through their real callers
 * (.claude/rules/testing-views-under-jsdom.md); the per-design CSS is pinned at
 * the end as text. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, waitFor } = require('./support/dom');
const { rulesOf, mediaBlocks, topLevel } = require('./support/css');
const { RID, night, badgeRound, stubApi, wideAt } = require('./support/badge-fixture');

function boot(t, round, { wide = false } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, round);
  wideAt(dom, wide);
  return dom;
}
async function pokale(t, round, opts) {
  const dom = boot(t, round, opts);
  await dom.call('renderPokaleTab', round);
  return dom;
}
const section = (dom) => dom.app.querySelector('.badge-section');

// ------------------------------------------------------------------ the legend

test('the legend names the three drawn states in the section head, in the tile order', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1)]));
  const legend = section(dom).querySelector('.section-head .badge-legend');
  assert.ok(legend, 'the legend sits in the section head, beside the count');
  const items = [...legend.querySelectorAll('.badge-legend__item')];
  assert.deepEqual(items.map((i) => i.dataset.state), ['earned', 'progress', 'locked']);
  assert.deepEqual(items.map((i) => i.textContent.trim()),
    ['earned', 'progress', 'locked'].map((s) => dom.run(`t('badges.state.${s}')`)),
    'the words are the states the tiles announce');
  items.forEach((i) => assert.ok(i.querySelector('.badge-legend__mark'), `${i.dataset.state} has a swatch`));
  // Every tile already names its state in its accessible name; the legend is a
  // key to the DRAWING, so it is not read a second time.
  assert.equal(legend.getAttribute('aria-hidden'), 'true');
});

test('a round with no finished session gets no legend — there is nothing to decode', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1, { finished: false, done: false, winnerIds: [] })]));
  assert.equal(section(dom).querySelector('.badge-legend'), null);
});

// ------------------------------------------------------------------ Platz N

test('a member row carries its standings place, tie-aware, as the Tafel ranks it', async (t) => {
  // Ben wins twice, Anna once, Clara plays and never wins: 1, 2, 3.
  const three = ['m1', 'm2', 'm3'];
  const r = badgeRound([
    night('s1', 1, { memberIds: three }),
    night('s2', 2, { memberIds: three, winnerIds: ['m2'] }),
    night('s3', 3, { memberIds: three, winnerIds: ['m2'] }),
  ], 3);
  const dom = await pokale(t, r, { wide: true });
  const rank = (mid) => section(dom).querySelector(`#abzeichen-${mid} .badge-member__head .badge-member__rank`);
  assert.equal(rank('m2').textContent, 'Platz 1');
  assert.equal(rank('m1').textContent, 'Platz 2');
  assert.equal(rank('m3').textContent, 'Platz 3', 'a member who played and lost still has a place');

  // A tie shares its place, as the podium's computePlaces says.
  const tie = await pokale(t, badgeRound([night('s1', 1), night('s2', 2, { winnerIds: ['m2'] })]), { wide: true });
  const places = [...section(tie).querySelectorAll('.badge-member__rank')].map((x) => x.textContent);
  assert.deepEqual(places, ['Platz 1', 'Platz 1']);
});

test('a member with no record has no place — the standings do not rank them', async (t) => {
  // Clara joined no decided session: she is on the list, never on the Tafel.
  const r = badgeRound([night('s1', 1)], 3);
  const dom = await pokale(t, r, { wide: true });
  assert.ok(section(dom).querySelector('#abzeichen-m1 .badge-member__rank'));
  assert.equal(section(dom).querySelector('#abzeichen-m3 .badge-member__rank'), null);
});

// ------------------------------------------------------------------ the chevron

test('the Tischkarte row ends on a chevron link to this member in Pokale › Abzeichen', async (t) => {
  const r = badgeRound([night('s1', 1)]);
  const dom = boot(t, r);
  await dom.call('showMember', RID, 'm1');
  const row = await waitFor(() => dom.app.querySelector('.member-card__badges'), { label: 'the Tischkarte rendered' });
  const go = row.querySelector('a.member-card__badges-go');
  assert.ok(go, 'the row has its chevron');
  assert.ok(go.querySelector('.ti.ti-chevron-right[aria-hidden="true"]'), 'the glyph is decoration');
  assert.equal(go.getAttribute('aria-label'), 'Alle Abzeichen von Anna', 'a glyph-only link needs a name');
  assert.match(go.getAttribute('href'), /\/pokale$/, 'a real href, so ⌘-click opens the page');
  assert.equal(row.lastElementChild, go, 'the chevron closes the row, after the pins');

  go.click();
  const target = await waitFor(() => dom.document.getElementById('abzeichen-m1'), { label: 'Pokale rendered' });
  assert.equal(target.open, true, 'the member’s row is the one that opens');
  assert.equal(dom.document.activeElement, target.querySelector('summary'));
});

test('the Spielerkarte’s row gets no chevron — it has no Pokale page to open', async (t) => {
  const dom = boot(t, badgeRound([night('s1', 1)]));
  const row = dom.call('profileCardBadges', [{ key: 'accountSessions', state: 'progress', count: 3, of: 25, glyph: 'ti-cards' }], null, 'Anna');
  assert.ok(row);
  assert.equal(row.querySelector('.member-card__badges-go'), null);
});

// ------------------------------------------------------------------ the skins

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const TISCH_CSS = read('public/css/designs/tisch.css');
const OCEAN_CSS = read('public/css/designs/ocean.css');
const KLASSISCH_CSS = read('public/styles.css');
const norm = (s) => s.replace(/\s+/g, ' ').trim();
// The unconditional rules whose selector matches `re`, as [selector, body].
// A grouped selector is split, so each member answers for itself.
const plain = (css, re) => rulesOf(topLevel(css))
  .flatMap(([s, b]) => s.split(',').map((one) => [norm(one), b])).filter(([s]) => re.test(s));
// The rules for `part` inside a top-level @media block whose query holds `q`.
const inMedia = (css, part, q) => mediaBlocks(css).filter(([query]) => query.includes(q))
  .flatMap(([, c]) => rulesOf(c)).map(([s, b]) => [norm(s), b]).filter(([s]) => s.includes(part));
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('Klassisch draws all three: the swatches as its tiles draw the states, the place, the chevron', () => {
  const legend = plain(KLASSISCH_CSS, /\.badge-legend__item\[data-state="(earned|progress|locked)"\] \.badge-legend__mark/);
  assert.ok(legend.some(([s, b]) => /earned/.test(s) && /background:\s*var\(--brand\)/.test(b)), 'earned is FILLED');
  assert.ok(legend.some(([s, b]) => /progress/.test(s) && /conic-gradient/.test(b)), 'under way is a RING');
  assert.ok(legend.some(([s, b]) => /locked/.test(s) && /dashed/.test(b)), 'open is a DASHED outline');
  assert.ok(plain(KLASSISCH_CSS, /^\.badge-member__rank$/).length, 'the place has a rule');
  const go = plain(KLASSISCH_CSS, /^\.member-card__badges-go$/).map(([, b]) => b).join(';');
  assert.match(go, /min-width:\s*(3[2-9]|4\d)px/, 'the chevron is a target of at least 32px');
  assert.match(go, /min-height:\s*(3[2-9]|4\d)px/, 'the chevron is a target of at least 32px');
  const all = rulesOf(KLASSISCH_CSS).filter(([s]) => /badge-legend|badge-member__rank|member-card__badges-go/.test(s));
  assert.ok(all.length >= 5, 'the guard below saw the rules');
  for (const [s, b] of all) assert.doesNotMatch(b, /display:\s*none/, `Klassisch hides ${norm(s)}`);
});

const hiddenIn = (css, gate, part) => plain(css, new RegExp(`^${esc(gate)} ${esc(part)}$`))
  .some(([, b]) => /display:\s*none/.test(b));

test('Der Tisch: legend and place from 860px only, as T17.2 draws them; the chevron at every width', () => {
  const GATE = ':root[data-design="tisch"][data-scheme="dark"]';
  assert.ok(hiddenIn(TISCH_CSS, GATE, '.badge-legend'), 'T17.3 (390) draws no legend');
  assert.ok(hiddenIn(TISCH_CSS, GATE, '.badge-member__rank'), 'T17.3 (390) draws no place');
  assert.ok(inMedia(TISCH_CSS, '.badge-legend', 'min-width: 860px').some(([s, b]) => s.endsWith('.badge-legend') && /display:\s*flex/.test(b)), 'T17.2 shows the legend');
  assert.ok(inMedia(TISCH_CSS, '.badge-member__rank', 'min-width: 860px').some(([, b]) => /display:\s*(inline|block)/.test(b)), 'T17.2 shows the place');
  assert.ok(!hiddenIn(TISCH_CSS, GATE, '.member-card__badges-go'), 'T17.4 draws the chevron at 390 too');
  assert.ok(plain(TISCH_CSS, new RegExp(`^${esc(GATE)} \\.member-card__badges-go$`)).some(([, b]) => /color:\s*var\(--gold\)/.test(b)), 'the chevron is gold');
});

test('Ocean: legend and chevron from 860px only; no place — O17 never draws one', () => {
  const GATE = ':root[data-design="ocean"]:not([data-scheme="dark"])';
  assert.ok(hiddenIn(OCEAN_CSS, GATE, '.badge-legend'), 'O17.3 (390) draws no legend');
  assert.ok(hiddenIn(OCEAN_CSS, GATE, '.member-card__badges-go'), 'O17.4 at 390 draws no chevron');
  assert.ok(hiddenIn(OCEAN_CSS, GATE, '.badge-member__rank'), 'no O17 view draws a place');
  assert.deepEqual(inMedia(OCEAN_CSS, '.badge-member__rank', 'width').filter(([, b]) => /display:/.test(b)), [],
    'and nothing brings the place back at any width');
  assert.ok(inMedia(OCEAN_CSS, '.badge-legend', 'min-width: 860px').some(([s, b]) => s.endsWith('.badge-legend') && /display:\s*flex/.test(b)), 'O17.2 shows the legend');
  assert.ok(inMedia(OCEAN_CSS, '.member-card__badges-go', 'min-width: 860px').some(([, b]) => /display:\s*(inline-)?flex/.test(b)), 'O17.4 at 1440 shows the chevron');
});
