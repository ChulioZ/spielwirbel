'use strict';

/* The Abzeichen details #1386 added: the legend in Pokale › Abzeichen and
 * „Platz N" on a member row — both removed by #1856, so pinned here as ABSENT —
 * and the chevron on the Tischkarte row (T17.4, O17.4). All three are SHARED K17 markup
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

// ----------------------------------------------- no legend, no place (#1856)

/* #1386 gave the section a legend and each member row a „Platz N". #1856
   removed both: a row draws EARNED marks only, so a three-state key has
   nothing to explain, and the place is the standings' — printed a few rows
   above, by the component that owns it. Held on a mature round, where the
   place used to print. */
test('a mature round prints neither a legend nor a place (#1856)', async (t) => {
  const three = ['m1', 'm2', 'm3'];
  const r = badgeRound([
    night('s1', 1, { memberIds: three }),
    night('s2', 2, { memberIds: three, winnerIds: ['m2'] }),
    night('s3', 3, { memberIds: three, winnerIds: ['m2'] }),
  ], 3);
  for (const wide of [false, true]) {
    const dom = await pokale(t, r, { wide });
    assert.ok(section(dom).querySelector('#abzeichen-m2'), 'the rows rendered');
    assert.equal(section(dom).querySelector('.badge-legend'), null, `no legend (wide: ${wide})`);
    assert.equal(section(dom).querySelector('.badge-member__rank'), null, `no place (wide: ${wide})`);
    assert.doesNotMatch(section(dom).textContent, /Platz \d/, `no „Platz N" anywhere (wide: ${wide})`);
  }
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
  await waitFor(() => dom.document.getElementById('abzeichen-m1'), { label: 'Pokale rendered' });
  const sheet = await waitFor(() => dom.document.querySelector('.sheet-backdrop .badge-collection'), { label: 'the collection opened' });
  assert.equal(sheet.closest('.sheet').getAttribute('aria-label'), 'Abzeichen von Anna', 'the member’s collection is the one that opens');
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

test('Klassisch draws the chevron as a real target, and no legend or place rule is left (#1856)', () => {
  const go = plain(KLASSISCH_CSS, /^\.member-card__badges-go$/).map(([, b]) => b).join(';');
  assert.match(go, /min-width:\s*(3[2-9]|4\d)px/, 'the chevron is a target of at least 32px');
  assert.match(go, /min-height:\s*(3[2-9]|4\d)px/, 'the chevron is a target of at least 32px');
  assert.doesNotMatch(go, /display:\s*none/, 'Klassisch hides the chevron');
  for (const [name, css] of [['styles.css', KLASSISCH_CSS], ['tisch.css', TISCH_CSS], ['ocean.css', OCEAN_CSS]]) {
    assert.deepEqual(rulesOf(css).filter(([sel]) => /badge-legend|badge-member__rank/.test(sel)).map(([sel]) => norm(sel)), [],
      `${name} still styles the legend or the place, which no longer render`);
  }
});

const hiddenIn = (css, gate, part) => plain(css, new RegExp(`^${esc(gate)} ${esc(part)}$`))
  .some(([, b]) => /display:\s*none/.test(b));

test('Der Tisch: the chevron at every width, in gold', () => {
  const GATE = ':root[data-design="tisch"][data-scheme="dark"]';
  assert.ok(!hiddenIn(TISCH_CSS, GATE, '.member-card__badges-go'), 'T17.4 draws the chevron at 390 too');
  assert.ok(plain(TISCH_CSS, new RegExp(`^${esc(GATE)} \\.member-card__badges-go$`)).some(([, b]) => /color:\s*var\(--gold\)/.test(b)), 'the chevron is gold');
});

test('Der Tisch: the Tischkarte kicker never wraps its count off at 860px+ (it was a fixed 96px)', () => {
  const rules = inMedia(TISCH_CSS, '.member-card__badges-label', 'min-width: 860px')
    .filter(([s]) => s.endsWith('.member-card__badges-label'));
  assert.ok(rules.length > 0, 'the 1440 kicker column rule exists');
  for (const [, b] of rules) {
    assert.match(b, /white-space:\s*nowrap/, '„ABZEICHEN · 4" stays on one line');
    assert.doesNotMatch(b, /(^|[^-])width:\s*96px/, 'a fixed width is what broke it; the column is a minimum');
  }
});

test('Ocean: the chevron from 860px only', () => {
  const GATE = ':root[data-design="ocean"]:not([data-scheme="dark"])';
  assert.ok(hiddenIn(OCEAN_CSS, GATE, '.member-card__badges-go'), 'O17.4 at 390 draws no chevron');
  assert.ok(inMedia(OCEAN_CSS, '.member-card__badges-go', 'min-width: 860px').some(([, b]) => /display:\s*(inline-)?flex/.test(b)), 'O17.4 at 1440 shows the chevron');
});
