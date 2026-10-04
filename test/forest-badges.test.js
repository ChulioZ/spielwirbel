'use strict';

/* Forest skins the Abzeichen as FIREFLIES IN JARS and LEAVES ON A BRANCH
 * (#1477, F17 — docs/design/forest/Forest-F17-Abzeichen.dc.html).
 *
 *   a person's mark   a jar with a bark lid: earned = the dusk with the firefly
 *                     glyph, in progress = a light jar filling with moss, open =
 *                     a dashed outline, secret = the dusk without light
 *   the round's mark  a leaf on the branch, the same four states (a secret leaf
 *                     is the dusk without light, as the secret jar)
 *   the tier          the numeral on the lid (or at the leaf's stem) from
 *                     `data-tier`, and one dot per tier under the name
 *
 * Two pieces of markup, both rendered under Forest ONLY (so every other design
 * keeps K17 byte for byte — the golden below): `data-shape="leaf"` on a round
 * mark, which CSS cannot otherwise tell from a person's, and `.badge__dots`.
 *
 * The CSS half reads public/css/designs/forest.css as text, since jsdom applies
 * no stylesheet; the DOM half renders the real views; the contrast half
 * resolves F17.9's pairs through the design's own tokens. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { night, badgeRound, stubApi, wideAt } = require('./support/badge-fixture');
const { accountBadges, BADGE_CATALOGUE } = require('../public/js/achievements');

const GOLDEN = path.join(__dirname, 'fixtures', 'forest-badges-klassisch-golden.json');
const CREATED = '2025-03-10T12:00:00.000Z';
const NOW = Date.parse('2026-09-26T12:00:00.000Z');

const DAY = 24 * 3600 * 1000;
// `count` finished sessions on consecutive days, everyone seated, Anna winning
// every other one — enough for tiers, a streak, and an open entry or two.
function nights(count, memberIds) {
  const base = Date.parse('2026-01-01T20:00:00.000Z');
  return Array.from({ length: count }, (_, i) => night(`s${i + 1}`, 1, {
    createdAt: new Date(base + i * DAY).toISOString(),
    memberIds,
    winnerIds: [i % 2 ? memberIds[1] : memberIds[0]],
  }));
}

function boot(t, design, round, { wide = false } = {}) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  stubApi(dom, round);
  wideAt(dom, wide);
  return dom;
}

const squash = (html) => html.replace(/\s+/g, ' ').replace(/> </g, '><').replace(/badge-card-\d+/g, 'badge-card-N').trim();

/* Every K17 surface Forest restyles, as rendered under `design`. */
async function surfaces(t, design) {
  const out = {};
  const r = badgeRound(nights(10, ['m1', 'm2']));
  let dom = boot(t, design, r);
  await dom.call('renderPokaleTab', r);
  out.pokale = squash(dom.app.querySelector('.badge-section').outerHTML);
  dom.app.querySelector('.badge-member .badge').click();
  await flush();
  const card = dom.document.querySelector('.badge-card');
  out.card = card ? squash(card.outerHTML) : '';
  out.tischkarte = squash(dom.call('memberCardBadges', r, r.members[0]).outerHTML);
  out.chronik = dom.call('chronikBadgeRows', r, dom.call('badgeChronikIndex', r).get('s3')).map((row) => squash(row.outerHTML)).join('');
  out.hub = squash(dom.call('hubBadgeLine', r).outerHTML);
  out.account = squash(dom.call('profileCardBadges', accountBadges({ sessions: 41, wins: 11, rounds: 3, gamesPlayed: 9 }, CREATED, NOW), CREATED, 'Lea').outerHTML);
  await dom.call('showResults', r, r.sessions[r.sessions.length - 1], r.games, false);
  out.moment = squash(dom.app.querySelector('.badge-moment').outerHTML);

  const dense = badgeRound(nights(6, ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']), 7);
  dom = boot(t, design, dense, { wide: true });
  await dom.call('renderPokaleTab', dense);
  out.dense = squash(dom.app.querySelector('.badge-section').outerHTML);
  return out;
}

// --------------------------------------------------------------- Klassisch

test('Klassisch: every Abzeichen surface renders exactly as before #1477', async (t) => {
  const now = await surfaces(t, 'klassisch');
  if (process.env.SPIELWIRBEL_UPDATE_GOLDEN === '1') {
    fs.writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.deepEqual(Object.keys(now), Object.keys(golden));
  for (const k of Object.keys(golden)) {
    assert.ok(golden[k].length > 100, `the golden for ${k} is implausibly small — the render did not happen`);
    assert.equal(now[k], golden[k], `Klassisch ${k} changed`);
  }
});

// --------------------------------------------------------------- the CSS

const { rulesOf } = require('./support/css');
const { contrast, token } = require('./support/theme');
const { designById } = require('../public/js/designs');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'forest.css'), 'utf8');
const SECTION = (() => {
  const from = RAW.indexOf('/* ===== #1477 — Abzeichen');
  const to = RAW.indexOf('/* ===== end #1477 ===== */');
  assert.ok(from > 0 && to > from, 'the #1477 section is not in forest.css');
  return RAW.slice(from, to).replace(/\/\*[\s\S]*?\*\//g, '');
})();
const RULES = rulesOf(SECTION);
const GATE = ':root[data-design="forest"]:not([data-scheme="dark"])';
const norm = (s) => s.replace(/\s+/g, ' ').trim();
// A selector group's members, split on TOP-LEVEL commas only.
const members = (sel) => {
  const out = [''];
  let depth = 0;
  for (const ch of sel) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) out.push('');
    else out[out.length - 1] += ch;
  }
  return out.map(norm).filter(Boolean);
};
const body = (member) => {
  const want = norm(`${GATE} ${member}`);
  const hits = RULES.filter(([sel]) => members(sel).includes(want));
  assert.ok(hits.length >= 1, `no rule for ${want}`);
  return hits.map(([, b]) => b).join(';');
};
const decl = (b, prop) => {
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(b);
  return m ? m[1].trim() : null;
};

test('every rule of the slice is gated on the light scheme (and there is a slice to check)', () => {
  assert.ok(RULES.length >= 80, `only ${RULES.length} rules in the #1477 section — did it move?`);
  const ungated = RULES.flatMap(([sel]) => members(sel).map((s) => s.replace(/^@media[^:]*\)\s*/, '')).filter((s) => !s.startsWith(GATE)));
  assert.deepEqual(ungated, [], 'a rule sits outside the light gate');
});

test('earned is the DUSK with the firefly glyph; secret is the dusk WITHOUT light', () => {
  const earned = body(':is(.badge, .badge-card, .badge-emblem)[data-state="earned"] .badge__mark');
  assert.equal(decl(earned, 'background'), 'var(--dusk)');
  assert.equal(decl(earned, 'color'), 'var(--firefly)', 'the firefly is the glyph');
  assert.match(decl(earned, 'box-shadow'), /var\(--firefly-halo\)/, 'the earned jar glows');
  const secret = body(':is(.badge, .badge-card)[data-state="secret"] .badge__mark');
  assert.equal(decl(secret, 'background'), 'var(--dusk)');
  assert.equal(decl(secret, 'color'), 'var(--dusk-soft)', 'no light: the padlock in the soft dusk ink');
  assert.equal(decl(secret, 'box-shadow'), null, 'a secret jar has no halo');
});

test('in progress is a light jar filling with moss to --pct; open is a dashed outline', () => {
  const prog = body(':is(.badge, .badge-card)[data-state="progress"] .badge__mark');
  assert.equal(decl(prog, 'background'), 'linear-gradient(to top, var(--moss) calc(var(--pct) * 1%), var(--surface) 0)');
  assert.equal(decl(prog, 'border'), '2px solid var(--control-edge)');
  assert.equal(decl(prog, 'color'), 'var(--ink)');
  const open = body(':is(.badge, .badge-card)[data-state="locked"] .badge__mark');
  assert.equal(decl(open, 'border'), '2px dashed var(--control-edge)');
  assert.equal(decl(open, 'color'), 'var(--ink-soft)');
  // The moss is only ever a fill level while counting — never on a lit, open
  // or secret mark, where it would read as a state it is not in.
  const wrong = RULES.filter(([sel, b]) => /data-state="(earned|locked|secret)"/.test(sel) && /var\(--moss\)/.test(b));
  assert.deepEqual(wrong.map(([s]) => norm(s)), []);
  // The Spielerkarte's jars carry no fill (F17.10 (3)).
  assert.equal(decl(body('.badge-grid--account .badge[data-state="progress"] .badge__mark'), 'background'), 'var(--surface)');
});

test('the lid is bark and prints the tier from data-tier; a leaf carries it at the stem', () => {
  const lid = body('.badge__mark::before');
  assert.equal(decl(lid, 'background'), 'var(--bark)');
  assert.equal(decl(lid, 'color'), 'var(--on-dusk)');
  assert.equal(decl(body('.badge__mark[data-tier]::before'), 'content'), 'attr(data-tier)');
  assert.equal(decl(body('.badge__mark[data-shape="leaf"]:not([data-tier])::before'), 'display'), 'none', 'an untiered leaf has no stem tab');
});

test('a leaf is Laubgrün when earned — and every other state, secret included, is the jar’s', () => {
  const leaf = body(':is(.badge, .badge-card)[data-state="earned"] .badge__mark[data-shape="leaf"]');
  assert.equal(decl(leaf, 'background'), 'var(--brand)');
  assert.equal(decl(leaf, 'color'), 'var(--on-dusk)');
  // The issue's secret leaf: the jar's secret state carries over unchanged, so
  // nothing may restyle a leaf's colours for any other state.
  const other = RULES.filter(([sel, b]) => /data-shape="leaf"/.test(sel) && /data-state="(progress|locked|secret)"/.test(sel) && /(background|color)\s*:/.test(b));
  assert.deepEqual(other.map(([s]) => norm(s)), []);
});

test('the tier dots: one ring each, the reached ones filled Laubgrün', () => {
  assert.match(body('.badge__dots > span'), /border:\s*1\.5px solid var\(--control-edge\)/);
  assert.equal(decl(body('.badge__dots > span[data-on]'), 'background'), 'var(--brand)');
  assert.equal(decl(body('.badge__dots'), 'flex-wrap'), 'wrap', 'six dots must wrap rather than overflow a narrow cell');
});

test('the branch and the shelves are auto-fill grids — no count of entries anywhere', () => {
  const grids = RULES.filter(([, b]) => /grid-template-columns/.test(b)).map(([s, b]) => [norm(s), decl(b, 'grid-template-columns')]);
  const branch = grids.filter(([s]) => s.includes('.badge-band--round > .badge-grid'));
  assert.ok(branch.length >= 2 && branch.every(([, v]) => /^repeat\(auto-fill, minmax\(\d+px, 1fr\)\)$/.test(v)), JSON.stringify(branch));
  // No repeat(N, …) but the phone shelf's four and the desktop's two member
  // columns — neither depends on how many marks exist.
  const fixed = grids.filter(([, v]) => /repeat\(\d+,/.test(v)).map(([s, v]) => `${s.slice(s.indexOf(GATE) + GATE.length).trim()} → ${v}`);
  assert.deepEqual(fixed, [
    '.badge-member > .badge-grid:not([hidden]) → repeat(4, minmax(0, 1fr))',
    '.badge-members:not(:has(> .badge-member > .badge-member__more)) → repeat(2, minmax(0, 1fr))',
  ]);
});

test('a mark on its way keeps its count wherever it is drawn (the moss level is decoration)', () => {
  assert.equal(decl(body('.badge-band--round .badge:not([data-state="progress"]) .badge__line'), 'display'), 'none');
  // Every other rule hiding a line names a place a counting mark never sits:
  // a dense row's EARNED shelf, the Tischkarte (earned only) and the moment.
  const hides = RULES.filter(([, b]) => /display:\s*none/.test(b))
    .flatMap(([sel]) => members(sel).filter((m) => /\.badge__line\b/.test(m)))
    .map((m) => m.slice(GATE.length).trim());
  assert.deepEqual(hides, [
    '.badge-band--round .badge:not([data-state="progress"]) .badge__line',
    '.badge-members:has(> .badge-member > .badge-member__more) .badge-member > .badge-grid:not(.badge-grid--rest) :is(.badge__name, .badge__dots, .badge__line, .badge__new)',
  ]);
});

test('the static skin holds still', () => {
  const moving = RULES.filter(([, b]) => /\b(animation|transition)[-a-z]*\s*:/.test(b));
  assert.deepEqual(moving.map(([s]) => norm(s)), []);
});

test('F17.9: every contrast pair the sheet lists clears its bar under Forest’s own tokens', () => {
  const FOREST = designById('forest');
  const v = (n) => token(n, FOREST);
  const pairs = [
    ['the glyph in the lit jar', '--firefly', '--dusk', 3],
    ['the glyph in the secret jar', '--dusk-soft', '--dusk', 3],
    ['the tier numeral on the lid (12px)', '--on-dusk', '--bark', 4.5],
    ['the glyph in the light jar', '--ink', '--surface', 3],
    ['the jar edge (progress / open) on the card', '--control-edge', '--surface', 3],
    ['the open jar edge against its own ground', '--control-edge', '--page-bg', 3],
    ['the open glyph (soft)', '--ink-soft', '--page-bg', 3],
    ['the lit jar against the card', '--dusk', '--surface', 3],
    ['the lit leaf against the card', '--brand', '--surface', 3],
    ['the glyph in the lit leaf', '--on-dusk', '--brand', 3],
    ['the name under the form', '--ink', '--surface', 4.5],
    ['the line under the form', '--ink-soft', '--surface', 4.5],
    ['the „Neu" chip and a reached tier chip', '--on-dusk', '--brand', 4.5],
    // Not on F17.9, but painted by this slice:
    ['the earned month in the card (popover)', '--gold-deep', '--raised', 4.5],
    ['an unreached tier chip in the card', '--ink-soft', '--raised', 4.5],
    ['a tier chip’s edge in the card', '--control-edge', '--raised', 3],
    ['the „Abzeichen" kickers in Laubgrün', '--brand', '--surface', 4.5],
    ['„N offen" / „+N weitere" on moss', '--ink', '--moss', 4.5],
    ['a reached tier dot on the card', '--brand', '--surface', 3],
    ['an unreached tier dot on the card', '--control-edge', '--surface', 3],
  ];
  const fails = pairs
    .map(([label, ink, ground, bar]) => [label, contrast(v(ink), v(ground)), bar])
    .filter(([, r, bar]) => !(r >= bar))
    .map(([label, r, bar]) => `${label}: ${r.toFixed(2)}:1 (bar ${bar})`);
  assert.deepEqual(fails, []);
  // The fill level is decoration (1.2:1) — pinned so nobody leans on it.
  assert.ok(contrast(v('--moss'), v('--surface')) < 1.5, 'the moss fill is meant to be decoration');
});

// ---------------------------------------------------------------- the markup

async function forestPokale(t, sessions, memberCount = 2, design = 'forest') {
  const r = badgeRound(sessions, memberCount);
  const dom = boot(t, design, r);
  await dom.call('renderPokaleTab', r);
  return { dom, r, sec: dom.app.querySelector('.badge-section') };
}

test('under Forest a round mark is a leaf and a person’s mark a jar — in the band, the card and the Chronik', async (t) => {
  const { dom, r, sec } = await forestPokale(t, nights(10, ['m1', 'm2']));
  const roundMarks = [...sec.querySelectorAll('.badge-band--round .badge__mark')];
  assert.ok(roundMarks.length >= 15, `only ${roundMarks.length} round marks`);
  assert.ok(roundMarks.every((m) => m.dataset.shape === 'leaf'), 'a round mark is not a leaf');
  const personMarks = [...sec.querySelectorAll('.badge-member .badge__mark')];
  assert.ok(personMarks.length >= 15);
  assert.ok(personMarks.every((m) => !m.hasAttribute('data-shape')), 'a person’s mark is drawn as a leaf');
  // The card of a round mark is a leaf too.
  sec.querySelector('.badge-band--round .badge').click();
  await flush();
  assert.equal(dom.document.querySelector('.badge-card .badge__mark').dataset.shape, 'leaf');
  // The Chronik: the round's „Sessions 10" row is a leaf, the people's rows jars.
  const rows = dom.call('chronikBadgeRows', r, dom.call('badgeChronikIndex', r).get('s10'));
  const isLeaf = (row) => !!row.querySelector('.chronik-row__icon[data-shape="leaf"]');
  const holder = (row) => row.querySelector('.chronik-row__text').textContent.split(' · ')[0];
  assert.ok(rows.some((row) => isLeaf(row) && /Kartographen · Sessions 10/.test(row.textContent)), 'the round’s Sessions 10 is not a leaf');
  assert.ok(rows.some((row) => !isLeaf(row)), 'no person’s row to compare');
  for (const row of rows) assert.equal(isLeaf(row), holder(row) === 'Kartographen', row.textContent.trim());
});

test('one dot per tier, the reached ones on — generic over the catalogue, never on a secret', async (t) => {
  const { sec } = await forestPokale(t, nights(10, ['m1', 'm2']));
  let tiered = 0;
  for (const tile of sec.querySelectorAll('.badge')) {
    const def = BADGE_CATALOGUE.find((d) => d.key === tile.dataset.key);
    const dots = tile.querySelector('.badge__dots');
    if (tile.dataset.state === 'secret' || !def.tiers) {
      assert.equal(dots, null, `${tile.dataset.key} (${tile.dataset.state}) draws dots`);
      continue;
    }
    tiered += 1;
    assert.equal(dots.getAttribute('aria-hidden'), 'true');
    assert.equal(dots.children.length, def.tiers.length, `${tile.dataset.key}: one dot per tier`);
    const tier = Number(tile.querySelector('.badge__mark').dataset.tier || 0);
    const on = tier ? def.tiers.indexOf(tier) + 1 : 0;
    assert.equal(dots.querySelectorAll('[data-on]').length, on, `${tile.dataset.key}: ${on} reached`);
    // Under the name, not inside the mark.
    assert.equal(dots.previousElementSibling.className, 'badge__name');
  }
  assert.ok(tiered >= 10, `only ${tiered} tiered tiles checked`);
  // The six-tier ladder (#1463) is drawn in full.
  const sessions = sec.querySelector('.badge-band--round .badge[data-key="sessions"] .badge__dots');
  assert.equal(sessions.children.length, 6);
  assert.equal(sessions.querySelectorAll('[data-on]').length, 1, 'Sessions 10 is the first of six');
});

test('a secret never shows its tier count, even a tiered one', (t) => {
  // No secret in today's catalogue is tiered, so the Pokale render above
  // cannot reach the guard — ask the builder directly (a tiered secret would
  // otherwise hint at what it is by its number of dots).
  const dom = loadApp({ locale: 'de', design: 'forest' });
  t.after(() => dom.close());
  assert.equal(dom.call('badgeTierDots', { key: 'sessions', state: 'secret', tier: null }), '');
  assert.match(dom.call('badgeTierDots', { key: 'sessions', state: 'locked', tier: null }), /^<span class="badge__dots" aria-hidden="true">(<span><\/span>){6}<\/span>$/);
});

test('a secret round mark is a leaf with ti-lock-question and „Geheim"', async (t) => {
  const { sec } = await forestPokale(t, nights(3, ['m1', 'm2']));
  const secret = sec.querySelector('.badge-band--round .badge[data-state="secret"]');
  assert.ok(secret, 'the round has a secret mark');
  assert.equal(secret.querySelector('.badge__mark').dataset.shape, 'leaf');
  assert.ok(secret.querySelector('.badge__mark .ti-lock-question'));
  assert.equal(secret.querySelector('.badge__name').textContent, 'Geheim');
  assert.equal(secret.querySelector('.badge__mark').hasAttribute('data-tier'), false);
});

test('the rubric reads „Abzeichen" and the Tischkarte shows earned marks only', async (t) => {
  const { dom, r, sec } = await forestPokale(t, nights(10, ['m1', 'm2']));
  assert.equal(sec.querySelector('h2').textContent.trim(), 'Abzeichen');
  assert.ok(!/Auszeichnung/.test(dom.app.textContent), 'a rubric reads „Auszeichnungen"');
  const row = dom.call('memberCardBadges', r, r.members[0]);
  const states = [...row.querySelectorAll('.badge')].map((b) => b.dataset.state);
  assert.ok(states.length >= 2);
  assert.deepEqual([...new Set(states)], ['earned']);
});

test('every other design keeps K17: no leaf attribute, no dots', async (t) => {
  for (const design of ['tisch', 'programmheft', 'bruecke', 'ocean']) {
    const { dom, r, sec } = await forestPokale(t, nights(10, ['m1', 'm2']), 2, design);
    assert.equal(sec.querySelector('[data-shape], .badge__dots'), null, `${design} draws Forest’s markup`);
    const rows = dom.call('chronikBadgeRows', r, dom.call('badgeChronikIndex', r).get('s10'));
    assert.ok(rows.every((row) => !row.querySelector('[data-shape]')), `${design}: a Chronik row carries the leaf`);
  }
});
