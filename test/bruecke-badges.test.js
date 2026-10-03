'use strict';

/* Die Brücke's Abzeichen (#1392, B17): a Dienstplakette — a slim plate with
 * bevelled corners, the glyph left and the tier bars right — over K17's shared
 * markup.
 *
 * B17 adds exactly one thing to that markup, and the review sanctioned it
 * (docs/design/pruefung-abzeichen-2026-09-26.md finding 5, „Brücke clip-path
 * und ein span je Stufe (data-on)"): `.badge__tier`, one span per tier with
 * `data-on` on the reached ones, inside `.badge__mark`. It is rendered for
 * every design and hidden by styles.css, so a design that draws no bars needs
 * no rule of its own. The numeral stays in the name („Stammgast 10"), so the
 * tier never hangs on the bars alone.
 *
 * The pixels were judged in headless Chromium at 390 and 1440. What is pinned
 * here is what regresses silently:
 *   - the bars' count and their on-state, per tile state;
 *   - the bars being hidden everywhere but Die Brücke;
 *   - the B17 values leaving the gated token block (test/support/theme.js
 *     resolves them there and nowhere else);
 *   - a rule of the #1392 section reading the gated colour block ungated;
 *   - a design rule displaying a container K17 hides with `hidden`;
 *   - six tier bars (the round's Sessions since #1463) fitting the plate.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf, bodyOf } = require('./support/css');
const { token, toHex } = require('./support/theme');
const { designById } = require('../public/js/designs');
const { night, badgeRound, stubApi, wideAt } = require('./support/badge-fixture');
const { BADGE_CATALOGUE } = require('../public/js/achievements');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/bruecke.css'), 'utf8');
const DARK = ':root[data-design="bruecke"][data-scheme="dark"]';
const VOICE = ':root[data-design="bruecke"]';
const HEAD = '/* ===== #1392 — Abzeichen: the Dienstplakette (B17) ===== */';

function section(head = HEAD) {
  assert.ok(RAW.includes(head), `the section header ${head} is missing`);
  const start = RAW.indexOf(head);
  const next = RAW.indexOf('/* ===== #', start + head.length);
  return RAW.slice(start, next === -1 ? undefined : next).replace(/\/\*[\s\S]*?\*\//g, '');
}
const selectorsOf = (rules) => rules.flatMap(([sel]) => sel.split(/,(?![^(]*\))/).map((x) => x.trim()))
  .filter((x) => x && !x.startsWith('@') && !/^(from|to|\d+%)$/.test(x));

// Four sessions: Anna wins three (Erster Sieg; Serienheld 3 is a tier), Ben
// one, so the round reaches tiered, untiered, progressing, locked and secret
// tiles in one render.
const bigRound = () => badgeRound([
  night('s1', 1), night('s2', 2), night('s3', 3), night('s4', 4, { winnerIds: ['m2'] }),
], 2);

async function pokale(t, design = 'bruecke') {
  const r = bigRound();
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  stubApi(dom, r);
  wideAt(dom, true);
  await dom.call('renderPokaleTab', r);
  return { dom, r };
}
const defOf = (key) => BADGE_CATALOGUE.find((d) => d.key === key);

// --- the bars -----------------------------------------------------------------

test('a tiered tile carries one bar per tier, the reached ones `data-on`, inside the mark', async (t) => {
  const { dom } = await pokale(t);
  const tiles = [...dom.app.querySelectorAll('.badge-section .badge')];
  let tiered = 0;
  let onSeen = 0;
  for (const tile of tiles) {
    const def = defOf(tile.dataset.key);
    const bars = tile.querySelector('.badge__mark > .badge__tier');
    if (!def.tiers || tile.dataset.state === 'secret') {
      assert.equal(bars, null, `${tile.dataset.key} (${tile.dataset.state}) must draw no bars`);
      continue;
    }
    tiered += 1;
    assert.ok(bars, `${tile.dataset.key} has no .badge__tier`);
    const spans = [...bars.children];
    assert.equal(spans.length, def.tiers.length, `${tile.dataset.key}: one bar per tier`);
    const on = spans.filter((s) => s.hasAttribute('data-on')).length;
    onSeen += on;
    // The reached bars lead, and their count is the tier in the name.
    assert.ok(spans.slice(0, on).every((s) => s.hasAttribute('data-on')), 'reached bars come first');
    const m = /\s(\d+)$/.exec(tile.querySelector('.badge__name').textContent);
    const expected = tile.dataset.state === 'earned' && m ? def.tiers.indexOf(Number(m[1])) + 1 : 0;
    assert.equal(on, expected, `${tile.dataset.key}: ${on} bars on for name „${tile.querySelector('.badge__name').textContent}"`);
  }
  assert.ok(tiered >= 8, `only ${tiered} tiered tiles — the fixture no longer reaches the bars`);
  assert.ok(onSeen >= 1, 'no reached tier in the fixture — `data-on` is never exercised');
  assert.equal(dom.app.querySelector('.badge__tier').getAttribute('aria-hidden'), null,
    'the bars inherit the mark\'s aria-hidden; the name says the tier');
});

test('the card\'s plate carries the same bars', async (t) => {
  const { dom } = await pokale(t);
  const tile = [...dom.app.querySelectorAll('.badge-section .badge[data-state="earned"]')]
    .find((b) => b.querySelector('.badge__tier [data-on]'));
  assert.ok(tile, 'no earned tile with a reached tier');
  tile.click();
  await flush();
  const card = dom.document.querySelector('.badge-card');
  const bars = card.querySelector('.badge-card__head > .badge__mark > .badge__tier');
  assert.ok(bars, 'the card\'s mark has no bars');
  assert.equal(bars.outerHTML, tile.querySelector('.badge__tier').outerHTML);
});

test('every other design renders no bars at all — the tier stays in the name alone there', async (t) => {
  for (const design of ['klassisch', 'tisch', 'ocean']) {
    const { dom } = await pokale(t, design);
    assert.ok(dom.app.querySelectorAll('.badge-section .badge').length > 10, `${design}: no tiles rendered`);
    assert.equal(dom.app.querySelectorAll('.badge__tier').length, 0, `${design} renders tier bars`);
  }
});

test('the bars are hidden by default too: only a design that draws them shows them', () => {
  assert.match(bodyOf('.badge__tier') || '', /display:\s*none/);
  const shown = rulesOf(section()).filter(([s, b]) => /\.badge__tier\s*$/.test(s.trim()) && /display:\s*(flex|inline-flex|grid)/.test(b));
  assert.ok(shown.length >= 1, 'Die Brücke never displays .badge__tier');
});

// --- tokens -------------------------------------------------------------------

test('the B17 values are Brücke tokens, resolvable where the contrast suite reads them', () => {
  const bruecke = designById('bruecke');
  const B17 = { '--badge-open-edge': '#6b7b96', '--badge-load': '#17465a' };
  for (const [name, hex] of Object.entries(B17)) {
    assert.equal(toHex(token(name, bruecke)), hex, `${name} does not resolve to B17's ${hex}`);
  }
});

test('every colour rule in the #1392 section is gated on the dark scheme; the rest is voice', () => {
  const rules = rulesOf(section());
  assert.ok(rules.length > 50, `only ${rules.length} rules found — did the parse break?`);
  const sels = selectorsOf(rules);
  const ungated = sels.filter((x) => !x.startsWith(VOICE));
  assert.deepEqual(ungated, [], 'every rule is scoped to Die Brücke');
  // A rule that reads a colour token must be dark-gated
  // (.claude/rules/design-colour-blocks-are-scheme-gated.md).
  const COLOUR = /var\(--(brand|surface|line|ink|ink-2|ink-soft|on-accent|badge-|action|gold|sunken|bar|hairline|control-edge|page)/;
  const leaks = rules.filter(([, b]) => COLOUR.test(b))
    .flatMap(([s]) => s.split(/,(?![^(]*\))/).map((x) => x.trim()))
    .filter((x) => x && !x.startsWith('@') && !/^(from|to|\d+%)$/.test(x) && !x.startsWith(DARK));
  assert.deepEqual(leaks, []);
});

// --- [hidden] -----------------------------------------------------------------

test('no #1392 rule displays a container K17 hides with the attribute', () => {
  const offenders = [];
  let seen = 0;
  /* Any rule on such a container counts toward the floor; only one that sets
     a display needs the guard — and the ones setting grid tracks carry it too,
     so a later `display` added beside them is already safe. */
  for (const [sel, body] of rulesOf(section())) {
    const m = /(?:^|;)\s*display:\s*([^;]+)/.exec(body);
    for (const s of sel.split(/,(?![^(]*\))/).map((x) => x.trim())) {
      const subject = s.split(/[\s>+~]+/).pop();
      if (!/\.badge-(moment|grid)(?![\w-]*__)/.test(subject)) continue;
      seen += 1;
      if (m && m[1].trim() !== 'none' && !subject.includes(':not([hidden])')) offenders.push(s);
    }
  }
  assert.ok(seen >= 3, `only ${seen} container rules found — the guard is vacuous`);
  assert.deepEqual(offenders, []);
});

// --- six bars at 390 --------------------------------------------------------------

test('the plate grows with its bars, so six tiers fit beside the glyph (#1463)', () => {
  /* The comment from #1463: the round's Sessions reach six tiers. A fixed
     plate width would push the sixth bar under the bevel, so the plate's width
     is its content's, floored by the sheet's 72px. */
  const mark = rulesOf(section()).find(([s]) => s.trim() === `${VOICE} .badge__mark`);
  assert.ok(mark, 'no base plate rule');
  assert.match(mark[1], /min-width:/);
  assert.doesNotMatch(mark[1], /(?:^|;)\s*width:(?!\s*auto)/, 'a fixed width would clip the sixth bar');
});

// --- contrast (B17.9) ----------------------------------------------------------

test('the plate\'s pairs clear their bar on every ground it sits on (B17.9)', () => {
  /* Glyphs, outlines and bars are non-text graphics (3:1, SC 1.4.11); the
     words beside a plate are text (4.5:1). The three grounds are the panel,
     the round's band and the card — the --b-ground a container sets. */
  const { contrast, rgb, composite } = require('./support/theme');
  const d = designById('bruecke');
  const v = (n) => rgb(toHex(token(n, d)));
  // The opaque load token IS B17's 24 % cyan over the plate — not a free pick.
  assert.equal(toHex(composite(v('--brand'), v('--surface'), 0.24)), toHex(v('--badge-load')));
  const grounds = ['--surface', '--bar', '--surface-raised'];
  const pairs = [
    ['--on-accent glyph/bars on the full plate', '--on-accent', '--brand', 3],
    ['--brand glyph over the running fill', '--brand', '--badge-load', 3],
    ...grounds.flatMap((g) => [
      [`--brand outline/glyph on ${g}`, '--brand', g, 3],
      [`--badge-open-edge outline on ${g}`, '--badge-open-edge', g, 3],
      [`--ink-soft glyph on ${g}`, '--ink-soft', g, 3],
      [`--ink name on ${g}`, '--ink', g, 4.5],
      [`--ink-soft line on ${g}`, '--ink-soft', g, 4.5],
    ]),
    ['--ink-soft glyph over the hatch', '--ink-soft', '--line', 3],
    ['„Neu" on the action amber', '--on-accent', '--action', 4.5],
  ];
  const failures = [];
  for (const [label, ink, ground, bar] of pairs) {
    const r = contrast(v(ink), v(ground));
    assert.ok(Number.isFinite(r), `${label}: not a number — the resolver returned no colour`);
    if (!(r >= bar)) failures.push(`${label} = ${r.toFixed(2)}:1 (bar ${bar})`);
  }
  assert.ok(pairs.length >= 15);
  assert.deepEqual(failures, []);
});

// --- motion (B17.5) -------------------------------------------------------------

const MOTION = '/* ===== #1392 B17.5 motion — the HUD frame flashes, the plate slides in ===== */';

test('the HUD flash plays only on a fresh mark, only with motion allowed, and ends', () => {
  const raw = RAW;
  assert.ok(raw.includes(MOTION), 'the motion section header is missing');
  const start = raw.indexOf(MOTION);
  const next = raw.indexOf('/* ===== #', start + MOTION.length);
  const body = raw.slice(start, next === -1 ? undefined : next).replace(/\/\*[\s\S]*?\*\//g, '');
  const open = body.indexOf('@media (prefers-reduced-motion: no-preference)');
  assert.ok(open !== -1, 'the motion is not behind prefers-reduced-motion: no-preference');
  // Everything after the header sits inside that one block.
  assert.equal(body.slice(0, open).trim(), '', 'a motion rule escapes the reduced-motion guard');
  assert.doesNotMatch(body, /\binfinite\b/, 'B17.5: nothing loops');
  const rules = rulesOf(body).filter(([s]) => !/^\s*(from|to|[\d.]+%)\s*$/.test(s));
  const animated = rules.filter(([, b]) => /animation(-name)?:/.test(b) && !/animation-delay/.test(b));
  assert.ok(animated.length >= 3, `only ${animated.length} animated rules`);
  for (const [sel] of animated) assert.match(sel, /\.badge-moment__item\[data-fresh\]/, `${sel.trim()} is not keyed on data-fresh`);
  // The timing table: frame at 300 ms for 540 ms, the fill at 480 ms for 200 ms.
  assert.match(body, /bruecke-hud-frame 540ms 300ms/);
  assert.match(body, /bruecke-plate-in 200ms cubic-bezier\(\.2, \.8, \.3, 1\) 480ms/);
  assert.match(body, /steps\(3/);
  // The empty-outline pre-state must not exist without motion: it lives in the block.
  assert.ok(rules.some(([s, b]) => /data-fresh\] \.badge__mark::before/.test(s) && /var\(--b-ground\)/.test(b)));
});
