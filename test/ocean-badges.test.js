'use strict';

/* Ocean's Abzeichen (#1391, O17): a pearl in a Muschel over K17's shared markup.
 *
 * The pixels were judged in headless Chromium at 390 and 1440 over jsdom-rendered
 * K17 markup. What is pinned here is what regresses silently:
 *
 *   - the O17 values leaving the gated token block (they are measured there by
 *     test/a11y-contrast.test.js, and nowhere else);
 *   - Ocean growing markup of its own — O17.10 skins K17, it never forks it;
 *   - a decoration taking a pseudo-element styles.css already draws on;
 *   - a design rule displaying a container K17 hides with the `hidden`
 *     attribute (the empty moment, the folded „N offen" grid);
 *   - the section heading losing to the component layer's Figtree `:is()` list;
 *   - a rule of the #1391 section reading the gated colour block ungated.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf, RULES, specificity, outranks } = require('./support/css');
const { token, toHex } = require('./support/theme');
const { designById } = require('../public/js/designs');
const { night, badgeRound, stubApi, wideAt } = require('./support/badge-fixture');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/ocean.css'), 'utf8');
const GATE = ':root[data-design="ocean"]:not([data-scheme="dark"])';
const HEAD = '/* ===== #1391 — Abzeichen: a pearl in a Muschel (O17) ===== */';

/* The section, up to the next slice's header (not EOF — a later slice appends
   its own, legitimately different, rules after this one). */
function section() {
  assert.ok(RAW.includes(HEAD), 'the #1391 section header is the merge seam other Ocean slices rely on');
  const start = RAW.indexOf(HEAD);
  const next = RAW.indexOf('/* ===== #', start + HEAD.length);
  return RAW.slice(start, next === -1 ? undefined : next).replace(/\/\*[\s\S]*?\*\//g, '');
}
// Split on top-level commas only, so `:is(.a, .b)` stays one selector.
const selectorsOf = (rules) => rules.flatMap(([sel]) => sel.split(/,(?![^(]*\))/).map((x) => x.trim()))
  .filter((x) => x && !x.startsWith('@'));

// --- tokens ------------------------------------------------------------------

test('the O17 values are Ocean tokens, resolvable where the contrast suite reads them', () => {
  /* docs/design/pruefung-abzeichen-2026-09-26.md finding 3: the hexes O17 uses
     outside O1 belong in the gated block. These six are the ones the skin
     paints; the other three (#b9d3df, #dcdaf2, #efeef9) paint nothing in the
     app — see the comment at the tokens. */
  const ocean = designById('ocean');
  const O17 = {
    '--pearl-1': '#f1f4f6', '--pearl-2': '#d5dde3', '--pearl-3': '#b9c6cf',
    '--shell-lid': '#c3dbe6', '--shell-dish': '#bcd6e2', '--shell-open-rim': '#5d7a8b',
  };
  for (const [name, hex] of Object.entries(O17)) {
    assert.equal(toHex(token(name, ocean)), hex, `${name} does not resolve to O17's ${hex}`);
  }
});

test('every rule in the #1391 section is gated on Ocean\'s light scheme', () => {
  const rules = rulesOf(section());
  assert.ok(rules.length > 60, `only ${rules.length} rules found — did the parse break?`);
  const ungated = selectorsOf(rules).filter((x) => !x.startsWith(GATE));
  assert.deepEqual(ungated, []);
});

// --- no markup of its own ---------------------------------------------------------

/* The same round rendered under Klassisch and under Ocean: every K17 placement
   must come out byte-identical, because O17.10 adds only CSS. The card ids are
   a per-boot counter, so they are normalised away. */
const bigRound = () => badgeRound([
  night('s1', 1), night('s2', 2, { winnerIds: ['m2'] }), night('s3', 3, { winnerIds: ['m2'] }),
  night('s4', 4, { winnerIds: ['m1', 'm2'] }),
], 3);
const norm = (html) => html.replace(/badge-card-\d+/g, 'badge-card-N');

async function placements(t, design) {
  const r = bigRound();
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  stubApi(dom, r);
  wideAt(dom, true);
  const out = {};
  await dom.call('renderPokaleTab', r);
  out.section = dom.app.querySelector('.badge-section').outerHTML;
  out.member = dom.call('memberCardBadges', r, r.members[1]).outerHTML;
  out.hub = dom.call('hubBadgeLine', r).outerHTML;
  out.chronik = dom.call('chronikBadgeRows', r, [...dom.call('badgeChronikIndex', r, []).values()][0])
    .map((el) => el.outerHTML).join('');
  const el = dom.document.createElement('section');
  el.className = 'badge-moment';
  dom.call('fillBadgeMoment', el, r, r.sessions[3]);
  out.moment = el.outerHTML;
  dom.app.querySelector('.badge-section .badge').click();
  await flush();
  out.card = dom.document.querySelector('.badge-card').outerHTML;
  return out;
}

test('Ocean renders exactly K17\'s markup in every placement — the skin is CSS only', async (t) => {
  const klassisch = await placements(t, 'klassisch');
  const ocean = await placements(t, 'ocean');
  assert.ok(klassisch.section.includes('data-state="progress"'), 'the fixture reaches a running count');
  assert.ok(klassisch.moment.includes('badge-moment__item'), 'the fixture reaches the moment');
  for (const k of Object.keys(klassisch)) assert.equal(norm(ocean[k]), norm(klassisch[k]), k);
});

// --- pseudo-elements ------------------------------------------------------------

test('the shell draws only on pseudo-element slots styles.css leaves free', () => {
  /* .claude/rules/design-colour-blocks-are-scheme-gated.md: a design must not
     take a pseudo-element the app already owns. DERIVED — every ::before/::after
     this section draws on is looked up in styles.css by its subject's class. */
  const pseudo = selectorsOf(rulesOf(section())).filter((s) => /::(before|after)\b/.test(s));
  assert.ok(pseudo.some((s) => /\.badge__mark::before$/.test(s)), 'the lid is not on .badge__mark::before');
  assert.ok(pseudo.some((s) => /\.badge__mark::after$/.test(s)), 'the dish is not on .badge__mark::after');
  // The one deliberate take-over: K17's own disclosure triangle, re-drawn as
  // O17.3's chevron — it restyles the app's glyph rather than adding a drawing.
  const RESTYLED = new Set(['.badge-member__head::after']);
  const taken = [];
  for (const sel of pseudo) {
    const subject = sel.split(/[\s>+~]+/).pop();
    const [, cls] = /(\.[\w-]+)[^.]*$/.exec(subject.replace(/::(before|after)$/, '')) || [];
    const which = /::(before|after)$/.exec(subject)[0];
    const slot = `${cls}${which}`;
    if (RESTYLED.has(slot)) continue;
    const owner = RULES.find(([s]) => s.split(',').some((x) => new RegExp(`${cls.replace(/[.]/g, '\\.')}(?![\\w-])[^\\s,]*${which}`).test(x)));
    if (owner) taken.push(`${slot} (styles.css: ${owner[0].trim()})`);
  }
  assert.deepEqual(taken, []);
});

// --- [hidden] --------------------------------------------------------------------

test('no #1391 rule displays a container K17 hides with the attribute', () => {
  /* K17 hides the empty moment and the folded „N offen" grid with `hidden`, and
     styles.css's `[hidden] { display: none }` for them is (0,2,0) — any gated
     rule here outranks it. .claude/rules/hidden-attribute-vs-display-rule.md. */
  const offenders = [];
  let seen = 0;
  for (const [sel, body] of rulesOf(section())) {
    const m = /(?:^|;)\s*display:\s*([^;]+)/.exec(body);
    if (!m || m[1].trim() === 'none') continue;
    for (const s of sel.split(/,(?![^(]*\))/).map((x) => x.trim())) {
      const subject = s.split(/[\s>+~]+/).pop();
      if (!/\.badge-(moment|grid)(?![\w-]*__)/.test(subject)) continue;
      seen += 1;
      if (!subject.includes(':not([hidden])')) offenders.push(s);
    }
  }
  assert.ok(seen >= 4, `only ${seen} displaying rules found — the guard is vacuous`);
  assert.deepEqual(offenders, []);
});

// --- the heading ---------------------------------------------------------------------

test('„Abzeichen" is a Comfortaa title that beats the component layer\'s Figtree list', () => {
  /* .claude/rules/is-list-takes-its-most-specific-member.md: the list weighs as
     its longest member, so compare against the rule itself, not `.badge__name`. */
  const list = rulesOf(RAW.replace(/\/\*[\s\S]*?\*\//g, ''))
    .find(([s, b]) => s.includes('.badge__name') && s.includes(':is(') && /font-family:\s*var\(--font\)/.test(b));
  assert.ok(list, 'the component layer\'s Figtree list no longer names .badge__name');
  const [head] = rulesOf(section()).find(([s, b]) => /\.badge-section > \.section-head h2$/.test(s.trim())
    && /font-family:\s*var\(--font-display\)/.test(b)) || [];
  assert.ok(head, 'no display-face rule for the section heading');
  assert.ok(outranks(head.trim(), list[0].trim()),
    `${specificity(head.trim())} does not beat the list's ${specificity(list[0].trim())}`);
});
