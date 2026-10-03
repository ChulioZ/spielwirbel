'use strict';

/* Das Programmheft prints the Abzeichen as MEDALS IN INK (#1393, P17 —
 * docs/design/programmheft/Programmheft-P17-Abzeichen.dc.html).
 *
 *   earned      a full ink seal with an inner paper ring, the glyph knocked out
 *   in progress a paper disc closed by an ink arc of --pct, and the count
 *   open        a dashed circle in the soft ink
 *   secret      a hatched disc with a paper spot under lock-question
 *   tier        a seal band carrying the numeral (data-tier on the mark)
 *
 * Plus the one piece of markup P17 adds to K17: `.badge-moment--special`, the
 * vermilion „Sonderausgabe" band on the result moment, for the round's Sessions
 * 100 · 250 · 500 and Stammgast 100 · 250 only (decided on #1393, 2026-10-01).
 *
 * The CSS half reads public/css/designs/programmheft.css as text, since jsdom
 * applies no stylesheet; the DOM half renders the real views.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rulesOf } = require('./support/css');
const { loadApp } = require('./support/dom');
const { night, badgeRound, stubApi } = require('./support/badge-fixture');

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'programmheft.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = rulesOf(SHEET);
const GATE = ':root[data-design="programmheft"]:not([data-scheme="dark"])';

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
// The joined bodies of every rule whose group holds exactly `GATE member`.
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
// Every Abzeichen rule of this slice (the font reset list above it predates it).
const BADGE_SEL = /\.badge(?![a-z])|\.badge[-_]|\.hub-row--badges|\.chronik-row--badge|__badges/;
// The design's font reset list (an ungated voice rule, #1371) names three badge
// classes; it is the one place an ungated badge selector belongs, so it is not
// part of this slice.
const FONT_RESET = /^\s*font-family:\s*var\(--font\);?\s*$/;
const badgeRules = () => RULES.filter(([sel, b]) => BADGE_SEL.test(sel) && !FONT_RESET.test(b));

// ------------------------------------------------------------------ the CSS

test('every Abzeichen rule is gated on the light scheme (and there is a slice to check)', () => {
  const all = badgeRules();
  assert.ok(all.length >= 40, `only ${all.length} Abzeichen rules found — did the section move?`);
  const ungated = all.flatMap(([sel]) => members(sel).filter((s) => !s.startsWith(GATE)));
  assert.deepEqual(ungated, [], 'an Abzeichen rule sits outside the light gate');
});

test('earned is a full INK seal with an inner paper ring, the glyph in paper', () => {
  const seal = body(':is(.badge, .badge-card, .badge-emblem)[data-state="earned"] .badge__mark::before');
  assert.equal(decl(seal, 'background'), 'var(--ink)');
  assert.match(decl(seal, 'box-shadow'), /inset 0 0 0 \d+px var\(--ink\), inset 0 0 0 \d+px var\(--box-ink\)/,
    'the inner ring is paper inside the ink edge');
  assert.equal(decl(body(':is(.badge, .badge-card, .badge-emblem)[data-state="earned"] .badge__mark'), 'color'), 'var(--box-ink)',
    'the glyph is knocked out to paper');
});

test('in progress is a paper disc closed by an INK ARC of --pct — and only progress and an earned tier carry it', () => {
  const ring = body('.badge[data-state="progress"] .badge__mark');
  assert.match(decl(ring, 'background'), /conic-gradient\(var\(--ink\) calc\(var\(--pct\) \* 1%\), var\(--sunken\) 0\)/);
  assert.equal(decl(body('.badge[data-state="earned"] .badge__mark[style*="--pct"]'), 'background'), decl(ring, 'background'),
    'an earned tier on its way to the next draws the same arc');
  const disc = body(':is(.badge, .badge-card)[data-state="progress"] .badge__mark::before');
  assert.match(decl(disc, 'border'), /2px solid var\(--ink\)/);
  assert.equal(decl(body(':is(.badge, .badge-card)[data-state="progress"] .badge__mark'), 'color'), 'var(--ink)');
  // An open mark may carry --pct:0 (a counted entry nobody has started); a ring
  // there would read as a state it is not in.
  const wrong = RULES.filter(([sel, b]) => /data-state="(locked|secret)"/.test(sel) && /conic-gradient/.test(b));
  assert.deepEqual(wrong.map(([s]) => norm(s)), []);
});

test('open is a DASHED circle in the soft ink; secret is HATCHED with a paper spot', () => {
  const open = body(':is(.badge, .badge-card)[data-state="locked"] .badge__mark::before');
  assert.match(decl(open, 'border'), /2px dashed var\(--ink-soft\)/);
  assert.equal(decl(body(':is(.badge, .badge-card)[data-state="locked"] .badge__mark'), 'color'), 'var(--ink-soft)');
  const secret = body(':is(.badge, .badge-card)[data-state="secret"] .badge__mark::before');
  assert.match(decl(secret, 'background'), /repeating-linear-gradient\(45deg, var\(--ink\) 0 1\.5px, var\(--page-bg\) 1\.5px 5px\)/);
  assert.match(decl(secret, 'border'), /2px solid var\(--ink\)/);
  const spot = body(':is(.badge, .badge-card)[data-state="secret"] .badge__mark > .ti');
  assert.equal(decl(spot, 'background'), 'var(--page-bg)', 'the padlock sits on a paper spot');
});

test('the tier is a seal band printing the numeral from data-tier', () => {
  const band = body('.badge__mark[data-tier]::after');
  assert.equal(decl(band, 'content'), 'attr(data-tier)');
  assert.match(decl(band, 'border'), /2px solid var\(--ink\)/);
  assert.equal(decl(band, 'color'), 'var(--ink)');
  assert.equal(decl(band, 'background'), 'var(--page-bg)');
});

test('Pokale: the rubric is Anton over a 4px rule, the members are COLUMNS from 1024px', () => {
  const h2 = body('.badge-section > .section-head h2');
  assert.equal(decl(h2, 'font-family'), 'var(--font-display)');
  assert.equal(decl(h2, 'text-transform'), 'uppercase');
  assert.match(body('.badge-section > .section-head'), /border-bottom:\s*var\(--rule-page\) solid var\(--ink\)/);
  const wide = RULES.filter(([sel, b]) => members(sel).includes(norm(`${GATE} .badge-members`)) && /grid-template-columns:\s*repeat\(auto-fit/.test(b));
  assert.equal(wide.length, 1, 'the member columns are not an auto-fit grid');
  // Dense (seven and more): six columns, never more.
  assert.match(body('.badge-members:has(> .badge-member > .badge-member__more)'), /grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/);
});

test('vermilion appears only as the Sonderausgabe band, and every word on it is Anton from 26px', () => {
  const uses = RULES.filter(([sel, b]) => BADGE_SEL.test(sel) && /var\(--vermilion\)/.test(b));
  assert.ok(uses.length >= 1, 'the band is not painted vermilion');
  const elsewhere = uses.flatMap(([sel]) => members(sel).filter((m) => !m.includes('.badge-moment--special')));
  assert.deepEqual(elsewhere, [], 'vermilion leaks out of the band');
  assert.equal(decl(body('.badge-moment--special'), 'background'), 'var(--vermilion)');
  assert.equal(decl(body('.badge-moment--special'), 'color'), 'var(--box-ink)');
  // Paper on vermilion is 3.79:1 — large text only. So every rule inside the
  // band that sets type sets Anton at 24px or more (P17: „ab 26 px").
  const px = (v) => {
    const lit = /^(\d+)px$/.exec(v || '');
    if (lit) return Number(lit[1]);
    const tok = /^var\(--display-(\d)\)$/.exec(v || '');
    return tok ? { 1: 118, 2: 84, 3: 60, 4: 40, 5: 30, 6: 24 }[tok[1]] : null;
  };
  const typed = RULES.filter(([sel, b]) => members(sel).some((m) => m.includes('.badge-moment--special')) && /font-size/.test(b));
  assert.ok(typed.length >= 4, `only ${typed.length} sized rules in the band`);
  for (const [sel, b] of typed) {
    assert.ok(px(decl(b, 'font-size')) >= 26, `${norm(sel)} sets ${decl(b, 'font-size')} on the vermilion`);
    // A media query may only resize: the face comes from the same selector's
    // base rule, wherever it sits.
    const anton = RULES.filter(([s2]) => norm(s2) === norm(sel)).some(([, b2]) => decl(b2, 'font-family') === 'var(--font-display)');
    assert.ok(anton, `${norm(sel)} is not Anton on the vermilion`);
  }
  // The NEW mark is the one 11px label that would land on the band: gone there.
  assert.equal(decl(body('.badge-moment--special .badge__new'), 'display'), 'none');
});

test('the static skin holds still — only a fresh moment item moves', () => {
  const moving = badgeRules().filter(([, b]) => /\b(animation|transition)[-a-z]*\s*:/.test(b));
  const stray = moving.filter(([s]) => !members(s).every((m) => m.includes('[data-fresh]')));
  assert.deepEqual(stray.map(([s]) => norm(s)), []);
});

// ---------------------------------------------------------------- the markup

const DAY = 24 * 3600 * 1000;
// `count` finished sessions on consecutive days, with real ISO dates (the
// fixture's day-of-July cannot count past 31, and the ladder needs 500).
function nights(count, seatsOf) {
  const base = Date.parse('2024-01-01T20:00:00.000Z');
  return Array.from({ length: count }, (_, i) => night(`s${i + 1}`, 1, {
    createdAt: new Date(base + i * DAY).toISOString(),
    memberIds: seatsOf(i),
    winnerIds: [],
  }));
}

async function results(t, sessions, { design = 'programmheft' } = {}) {
  const r = badgeRound(sessions);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, r);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  const s = r.sessions[r.sessions.length - 1];
  await dom.call('showResults', r, s, r.games, false);
  return dom.app.querySelector('.badge-moment');
}

// Anna and Ben alternate, so neither reaches a Stammgast tier with the round.
const alternate = (i) => [i % 2 ? 'm2' : 'm1'];

test('the round’s 100th session prints a Sonderausgabe band — first, in one of the two slots', async (t) => {
  // Ben wins the 100th, his first win: newSince lists members BEFORE the round,
  // so the band is first only because the moment moves it there.
  const ss = nights(100, alternate);
  ss[99].winnerIds = ss[99].memberIds;
  const m = await results(t, ss);
  const items = [...m.querySelectorAll('.badge-moment__item')];
  assert.ok(items.length >= 1 && items.length <= 2, `${items.length} slots`);
  const band = items[0];
  assert.ok(band.classList.contains('badge-moment--special'), 'the band is not the first slot');
  assert.equal(band.querySelector('.badge-moment__kicker').textContent, 'Sonderausgabe');
  const tile = band.querySelector('.badge');
  assert.equal(tile.dataset.key, 'sessions');
  assert.equal(tile.querySelector('.badge__mark').dataset.tier, '100');
  assert.equal(m.querySelectorAll('.badge-moment--special').length, 1);
  assert.equal(items[1].querySelector('.badge').dataset.key, 'firstWin', 'the other slot keeps the next mark');
});

test('Stammgast 100 is a Sonderausgabe too', async (t) => {
  // Ben alone for 50, then both for 100: Anna's 100th is the round's 150th —
  // no round tier — and Ben is at 150, no Stammgast tier either.
  const m = await results(t, nights(150, (i) => (i < 50 ? ['m2'] : ['m1', 'm2'])));
  const band = m.querySelector('.badge-moment--special');
  assert.ok(band, 'no band for Stammgast 100');
  assert.equal(band.querySelector('.badge').dataset.key, 'regular');
  assert.equal(band.querySelector('.badge-moment__holder').textContent, 'Anna');
});

test('the band is exactly the decided ladder: Sessions 100 · 250 · 500, Stammgast 100 · 250', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const cat = dom.run('BADGE_CATALOGUE');
  const tiers = (key) => cat.find((d) => d.key === key).tiers;
  const yes = (key) => [...tiers(key)].filter((n) => dom.run(`badgeSpecialEdition(${JSON.stringify(key)}, ${n})`));
  assert.deepEqual(yes('sessions'), [100, 250, 500]);
  assert.deepEqual(yes('regular'), [100, 250]);
  // No other entry, at any of its tiers, is an edition.
  const others = [...cat].filter((d) => d.tiers && !['sessions', 'regular'].includes(d.key))
    .flatMap((d) => [...d.tiers].filter((n) => dom.run(`badgeSpecialEdition(${JSON.stringify(d.key)}, ${n})`)).map((n) => `${d.key} ${n}`));
  assert.deepEqual(others, []);
});

test('Sessions 50 is an ordinary slot — no band', async (t) => {
  const m = await results(t, nights(50, alternate));
  assert.ok(m.querySelector('.badge[data-key="sessions"]'), 'Sessions 50 should still be in the moment');
  assert.equal(m.querySelector('.badge-moment--special'), null);
});

test('every other design shows the 100th session as an ordinary mark', async (t) => {
  for (const design of ['klassisch', 'tisch']) {
    const m = await results(t, nights(100, alternate), { design });
    assert.equal(m.querySelector('.badge-moment--special, .badge-moment__kicker'), null, `${design} prints a band`);
  }
});

test('the band never displaces the result’s own actions', async (t) => {
  const m = await results(t, nights(100, alternate));
  const band = m.querySelector('.badge-moment--special');
  assert.ok(band);
  assert.equal(m.querySelector('.btn'), null, 'the moment holds a button of the result’s own');
  const tisch = m.ownerDocument.querySelector('.tisch');
  assert.ok(tisch && !m.contains(tisch), 'the table (and its actions) live outside the moment');
  assert.ok(m.compareDocumentPosition(tisch) & m.ownerDocument.defaultView.Node.DOCUMENT_POSITION_FOLLOWING);
});

test('a reached tier rides on the mark as data-tier; a secret never shows one', async (t) => {
  const r = badgeRound(nights(12, () => ['m1', 'm2']));
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, r);
  dom.run('applyDesign("programmheft")');
  dom.call('renderPokaleTab', r);
  const mark = (key) => dom.app.querySelector(`.badge-band--round .badge[data-key="${key}"] .badge__mark`);
  assert.equal(mark('sessions').dataset.tier, '10');
  assert.equal(mark('founded').hasAttribute('data-tier'), false, 'a one-step entry has no tier');
  const secrets = [...dom.app.querySelectorAll('.badge[data-state="secret"] .badge__mark')];
  assert.ok(secrets.length >= 1);
  assert.ok(secrets.every((s) => !s.hasAttribute('data-tier')), 'a secret leaks its tier');
});
