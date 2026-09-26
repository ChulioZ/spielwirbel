'use strict';

/* Der Tisch skins the Abzeichen as BRASS PINS ON THE FELT (#1390, T17 —
 * docs/design/tisch/Tisch-T17-Abzeichen.dc.html).
 *
 * The markup is K17's (views-badges.js, #1388) and is shared by every design,
 * so this slice is paint: every assertion below reads public/css/designs/tisch.css
 * as text, since jsdom applies no stylesheet. The one DOM test pins the promise
 * the sheet makes that CSS alone cannot keep — the member's colour reaches the
 * avatar and never a pin.
 *
 *   earned      raised brass, the glyph engraved (T17.1)
 *   open        a felt recess with a dashed edge
 *   in progress the recess plus a brass ring of --pct, and the count
 *   secret      the recess with lock-question (the glyph is the markup's)
 *   tier        a brass shield carrying the numeral
 *
 * The five values T17 uses outside T1 are TOKENS in the scheme-gated block
 * (.claude/rules/design-colour-blocks-are-scheme-gated.md), which is the only
 * place test/support/theme.js reads them; test/a11y-contrast.test.js measures
 * them against T17.9's grounds.
 *
 * The falling pin (T17.5's motion) is NOT part of this slice — the issue ships
 * it as a separate, droppable PR — so the last test pins that nothing here
 * moves.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rulesOf } = require('./support/css');
const { token } = require('./support/theme');
const { DESIGN_REGISTRY } = require('../public/js/designs');
const { loadApp } = require('./support/dom');

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = rulesOf(SHEET);
const GATE = ':root[data-design="tisch"][data-scheme="dark"]';
const TISCH = DESIGN_REGISTRY.find((d) => d.id === 'tisch');

const norm = (s) => s.replace(/\s+/g, ' ').trim();
// Every rule whose selector group names `part` in a member that is scheme-gated.
// A selector group's members, split on TOP-LEVEL commas only — the list inside
// `:is(.badge, .badge-card)` is not the group's.
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
const rulesFor = (part) => RULES.filter(([sel]) => members(sel).some((s) => s.startsWith(GATE) && s.includes(part)));
// The one body for an exact (gated) member selector, wherever it is grouped.
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

// ------------------------------------------------------------- the tokens

test('the five T17 values are tokens of the gated colour block, and theme.js resolves them', () => {
  const T17 = {
    '--pin-recess': '#173a29',
    '--pin-recess-ink': '#9cc4a8',
    '--brass-lo': '#b8893b',
    '--pin-shadow': '#6b4a1a',
    '--paper-track': '#e2d6bc',
  };
  // token() answers as „r,g,b".
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
  for (const [name, hex] of Object.entries(T17)) {
    assert.equal(String(token(name, TISCH)).replace(/\s/g, ''), rgb(hex), `${name} does not resolve to T17's ${hex}`);
  }
  // …and nowhere else: a component rule reads the token, never the hex.
  const outside = RULES.filter(([sel]) => !/^:root\[data-design="tisch"\](\[data-scheme="dark"\])?$/.test(norm(sel)))
    .flatMap(([sel, b]) => Object.values(T17).filter((hex) => b.toLowerCase().includes(hex)).map((hex) => `${norm(sel)} -> ${hex}`));
  assert.deepEqual(outside, [], 'a T17 hex is written on a component rule');
});

// --------------------------------------------------------------- the pin

test('every Abzeichen rule is scheme-gated — the pins read gated tokens', () => {
  const all = RULES.filter(([sel]) => /\.badge|\.hub-row--badges|\.chronik-row--badge|__badges|--badge\b/.test(sel));
  assert.ok(all.length >= 25, `only ${all.length} Abzeichen rules found — did the section move?`);
  const ungated = all.flatMap(([sel]) => members(sel).filter((s) => !s.startsWith(GATE)));
  assert.deepEqual(ungated, [], 'an Abzeichen rule sits on the bare design hook');
});

test('open and secret are a felt RECESS with a dashed edge, the glyph in the recess ink', () => {
  const pin = body('.badge__mark::before');
  assert.equal(decl(pin, 'background'), 'var(--pin-recess)');
  assert.match(decl(pin, 'border'), /2px dashed var\(--control-edge\)/);
  assert.match(decl(pin, 'box-shadow'), /^inset /, 'a recess is pressed INTO the felt');
  assert.equal(decl(body('.badge__mark'), 'color'), 'var(--pin-recess-ink)');
});

test('earned is RAISED brass with the glyph engraved — the four brass stops and the pin shadow', () => {
  const pin = body(':is(.badge, .badge-card)[data-state="earned"] .badge__mark::before');
  const bg = decl(pin, 'background');
  for (const stop of ['--gold-hi', '--gold', '--gold-deep', '--brass-lo']) {
    assert.ok(bg.includes(`var(${stop})`), `the brass misses ${stop}: ${bg}`);
  }
  assert.match(decl(pin, 'border'), /solid var\(--plinth-edge\)/);
  assert.match(decl(pin, 'box-shadow'), /var\(--pin-shadow\)/, 'an earned pin stands on its own shadow');
  assert.equal(decl(body(':is(.badge, .badge-card)[data-state="earned"] .badge__mark'), 'color'), 'var(--on-accent)',
    'the engraving is the dark ink, never a lighter one on brass');
});

test('in progress carries the brass RING of --pct; an earned tier shows it on the way to the next', () => {
  const ring = body('.badge[data-state="progress"] .badge__mark');
  assert.match(decl(ring, 'background'), /conic-gradient\(var\(--gold\) calc\(var\(--pct\) \* 1%\), var\(--gold-soft\) 0\)/);
  assert.equal(decl(body('.badge[data-state="earned"] .badge__mark[style*="--pct"]'), 'background'), decl(ring, 'background'),
    'an earned tier with a next step draws the same ring');
  // The recess of a progressing pin has no dashed edge — the ring is its edge.
  assert.match(body('.badge[data-state="progress"] .badge__mark::before'), /border-style:\s*solid/);
  // Never on an open pin: its --pct is 0 and a bare track ring would read as a state.
  const onLocked = RULES.filter(([sel, b]) => /data-state="(locked|secret)"/.test(sel) && /conic-gradient/.test(b));
  assert.deepEqual(onLocked, [], 'an open or secret pin draws a ring');
});

test('the name and the line sit BESIDE the pin, never on the brass', () => {
  // The glyph is the only thing inside the mark (markup); the name is its own
  // grid row under it, or its own column beside it.
  assert.equal(decl(body('.badge__name'), 'grid-row'), '2');
  assert.equal(decl(body('.badge__line'), 'grid-row'), '3');
  assert.match(decl(body('.badge__mark'), 'grid-row'), /^1/);
});

// ------------------------------------------------------------ placements

test('Pokale: the round is a FELT band, the members wooden rows (T17.2, T17.3)', () => {
  const band = body('.badge-band--round');
  assert.match(band, /var\(--felt\)/);
  assert.match(band, /var\(--felt-deep\)/);
  assert.equal(decl(band, 'color'), 'var(--felt-ink)', 'text on felt is paper ink (review finding A1)');
  assert.equal(decl(body('.badge-band--round .badge__line'), 'color'), 'var(--felt-ink-soft)');
  assert.equal(decl(body('.badge-member'), 'background'), 'var(--surface)');
  assert.match(body('.badge-section > .section-head'), /border-top:\s*3px solid var\(--gold-edge\)/);
});

test('the Tischkarte and the Spielerkarte carry their pins on a band along the lower edge (T17.4, T17.7)', () => {
  const lapel = body('.member-card__badges');
  assert.match(lapel, /border-top:\s*3px solid var\(--gold-edge\)/);
  // One rule dresses both cards, so the two bands cannot drift apart.
  const both = RULES.filter(([sel]) => members(sel).includes(`${GATE} .member-card__badges`)
    && members(sel).includes(`${GATE} .profile-card__badges`));
  assert.ok(both.some(([, b]) => /border-top:\s*3px solid var\(--gold-edge\)/.test(b)), 'the two cards do not share the band');
  // The compact row shows each earned pin's name, which carries its tier.
  assert.equal(decl(body('.badge-grid--compact .badge__name'), 'display'), 'block');
});

test('the result moment: pins on wooden plates, the holder beside them, never „Neu" on every one (T17.5)', () => {
  assert.match(body('.badge-moment'), /var\(--felt-deep\)/);
  assert.equal(decl(body('.badge-moment .badge'), 'background'), 'var(--surface)');
  assert.equal(decl(body('.badge-moment__holder'), 'pointer-events'), 'none', 'the holder must not swallow the tap on the plate');
  assert.equal(decl(body('.badge-moment .badge__new'), 'display'), 'none');
  // A1: nothing under 24px in gold on the felt.
  assert.equal(decl(body('.badge-moment__title'), 'color'), 'var(--felt-ink)');
});

test('the hub line, the Chronik row, the card and the feed (T17.6, T17.7)', () => {
  assert.match(body('.hub-row--badges'), /var\(--felt-deep\)/);
  const chronik = body('.chronik-row--badge');
  assert.equal(decl(chronik, 'background'), 'var(--paper-raised)');
  assert.equal(decl(chronik, 'color'), 'var(--paper-ink)');
  assert.equal(decl(body('.chronik-row--badge .chronik-row__label'), 'color'), 'var(--paper-faint)');
  const bar = decl(body('.badge-card__bar'), 'background');
  assert.match(bar, /var\(--paper-faint\) calc\(var\(--pct\) \* 1%\), var\(--paper-track\) 0/);
  assert.match(body('.feed-row__cover--badge'), /var\(--gold-deep\)/);
});

test('nothing here moves — the falling pin is its own, droppable PR', () => {
  const moving = rulesFor('badge').filter(([, b]) => /\b(animation|transition)\s*:/.test(b));
  assert.deepEqual(moving.map(([s]) => norm(s)), []);
});

// ------------------------------------------------------------ the markup

test('the member colour reaches the avatar and never a pin (T17.10)', (t) => {
  const seats = [{ id: 'm1', name: 'Jonas' }, { id: 'm2', name: 'Lea' }];
  let seq = 0;
  const night = (winnerIds) => ({
    id: `s${++seq}`,
    createdAt: `2026-07-${String(seq).padStart(2, '0')}T12:00:00.000Z`,
    gameIds: ['g1', 'g2'],
    memberIds: ['m1', 'm2'],
    guests: [],
    votes: { m1: { g1: { rating: 4 }, g2: { rating: 2 } }, m2: { g1: { rating: 5 }, g2: { rating: 3 } } },
    votedIds: [],
    finished: true,
    cancelled: false,
    done: true,
    winnerIds,
    chosenGameId: 'g1',
    events: [],
  });
  const round = {
    id: 'r1', name: 'Donnerstagsrunde', background: null, tags: [], providers: [], members: seats,
    games: [{ id: 'g1', title: 'Catan', tagIds: [] }, { id: 'g2', title: 'Azul', tagIds: [] }],
    sessions: [night(['m1']), night(['m2']), night(['m1'])],
  };
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run('applyDesign("tisch")');
  dom.set('api', async (method, url) => (/\/activities$/.test(url) ? [] : round));
  dom.call('renderPokaleTab', round);
  const pins = [...dom.app.querySelectorAll('.badge-section .badge')];
  assert.ok(pins.length >= 10, `only ${pins.length} pins rendered`);
  const styled = pins.flatMap((b) => [b, ...b.querySelectorAll('*')])
    .map((el) => el.getAttribute('style'))
    .filter((s) => s && !/^--pct:\d+$/.test(s.trim()));
  assert.deepEqual(styled, [], 'a pin carries an inline style other than its ring share');
  const avatars = [...dom.app.querySelectorAll('.badge-member__avatar')];
  assert.equal(avatars.length, 2);
  assert.ok(avatars.every((a) => /background/.test(a.getAttribute('style') || '')), 'the avatar lost the member colour');
});
