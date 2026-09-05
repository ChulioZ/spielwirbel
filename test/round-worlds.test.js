'use strict';

/* Worlds (#903): the machinery, not the art. A world is a design with a
   display face, a backdrop and ornament framing on top of the two palette
   tokens, and everything it adds hangs off ONE hook — `<html data-world="…">`.
   These specs pin that hook end to end (applyBackground sets and clears it,
   the design screen saves the id that resolves to it, the home tile shows the
   world's glyph) and the CSS contract behind it: one token block per world,
   six slot rules that are pseudo-elements only, the two media gates, and a
   backdrop alpha inside the contrast budget. What they cannot judge is whether
   the ornaments LOOK right — that is a browser check, per the issue.

   Driven through the jsdom harness rather than by matching source text where a
   DOM is involved; the stylesheet assertions read the comment-stripped CSS via
   test/support/css.js (.claude/rules/css-text-assertions-strip-comments.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./support/dom');
const { CSS, rulesOf, bodyOf, mediaBlocks } = require('./support/css');
const { PALETTES, WORLDS } = require('../public/js/round-designs');

const ROOT = path.join(__dirname, '..');
const forest = WORLDS.find((w) => w.id === 'forest');
const scifi = WORLDS.find((w) => w.id === 'scifi');
const salbei = PALETTES.find((p) => p.id === 'salbei');
const stored = (d) => ({ type: 'theme', id: d.id, page: d.page, accent: d.accent });
const flush = () => new Promise((r) => setImmediate(r));

// ---- the DOM hook --------------------------------------------------------

test('a world sets data-world on the root; a palette, a legacy design and home clear it', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  const root = dom.document.documentElement;

  dom.call('applyBackground', stored(forest));
  assert.equal(root.dataset.world, 'forest');
  assert.equal(root.style.getPropertyValue('--brand'), forest.accent);
  assert.equal(root.style.getPropertyValue('--page-bg'), forest.page);

  // Entering first is the point of each of these: asserting "no hook" on a
  // fresh document passes against a function that never touches it.
  dom.call('applyBackground', stored(salbei));
  assert.equal(root.hasAttribute('data-world'), false, 'a palette carries no world');

  dom.call('applyBackground', stored(scifi));
  assert.equal(root.dataset.world, 'scifi');
  dom.call('applyBackground', { type: 'theme', page: salbei.page, accent: salbei.accent });
  assert.equal(root.hasAttribute('data-world'), false, 'a round saved before ids is a palette');

  dom.call('applyBackground', stored(forest));
  dom.call('applyBackground', null);
  assert.equal(root.hasAttribute('data-world'), false, 'home must not inherit the vines');
  assert.equal(root.style.getPropertyValue('--brand'), '');
});

test('the id wins over a stale colour snapshot; an unknown id keeps the stored colours and no world', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  const root = dom.document.documentElement;

  dom.call('applyBackground', { type: 'theme', id: 'forest', page: salbei.page, accent: salbei.accent });
  assert.equal(root.dataset.world, 'forest');
  assert.equal(root.style.getPropertyValue('--brand'), forest.accent, 'the registry, not the snapshot, paints');
  assert.equal(root.style.getPropertyValue('--page-bg'), forest.page);

  dom.call('applyBackground', { type: 'theme', id: 'nope', page: '#123456', accent: '#654321' });
  assert.equal(root.hasAttribute('data-world'), false);
  assert.equal(root.style.getPropertyValue('--brand'), '#654321', 'an unknown id degrades to the plain palette');
  assert.equal(root.style.getPropertyValue('--page-bg'), '#123456');
});

// ---- the design screen ---------------------------------------------------

function roundFixture(background) {
  return {
    id: 'r1', name: 'Waldläufer', background, games: [], members: [], sessions: [], tags: [],
    gameCount: 0, sessionCount: 0, playedCount: 0, lastPlayed: null,
  };
}

async function openDesign(t, background) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const posts = [];
  dom.set('api', async (method, url, body) => {
    if (method === 'POST') { posts.push({ url, body }); return { background: body }; }
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return roundFixture(background);
    if (url === '/api/rounds') return [roundFixture(background)];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  dom.set('toast', () => {});
  await dom.call('showBackground', 'r1');
  return { dom, posts };
}

test('the design screen shows Farben and Welten, and only a world card carries the hook', async (t) => {
  const { dom } = await openDesign(t, null);
  const headings = [...dom.app.querySelectorAll('.section > h2')].map((el) => el.textContent);
  assert.deepEqual(headings, ['Farben', 'Welten']);

  const cards = [...dom.app.querySelectorAll('.theme-card')];
  assert.equal(cards.length, PALETTES.length + WORLDS.length);
  assert.equal(dom.app.querySelectorAll('.theme-card[data-world]').length, WORLDS.length);
  assert.equal(dom.app.querySelectorAll('.theme-card:not([data-world])').length, PALETTES.length,
    'a palette card must not carry data-world, or the ornament rules would dress it');
  for (const w of WORLDS) {
    const card = dom.app.querySelector(`.theme-card[data-world="${w.id}"]`);
    assert.ok(card, `${w.id} has no card`);
    assert.ok(card.classList.contains('theme-card--world'));
    // Its own accent, so its backdrop and frame preview ITS world inside any round.
    assert.match(card.getAttribute('style'), new RegExp(`--brand:${w.accent}`));
    assert.equal(card.textContent.trim(), dom.run(`t('${w.labelKey}')`));
  }
  assert.equal(cards[0].getAttribute('aria-pressed'), 'true', 'Standard is active on an undesigned round');
});

test('choosing a world saves its id, applies it at once and sweeps the active state across both groups', async (t) => {
  const { dom, posts } = await openDesign(t, null);
  const std = dom.app.querySelector('.theme-card');
  const card = dom.app.querySelector('.theme-card[data-world="forest"]');
  card.click();
  await flush();

  // Through JSON: the body was built inside the jsdom realm, whose Object is
  // not this realm's, and strict deepEqual compares prototypes.
  assert.deepEqual(JSON.parse(JSON.stringify(posts)), [{ url: '/api/rounds/r1/background', body: stored(forest) }]);
  assert.equal(dom.document.documentElement.dataset.world, 'forest');
  assert.equal(card.getAttribute('aria-pressed'), 'true');
  assert.equal(std.getAttribute('aria-pressed'), 'false', 'the palette group must let go of Standard');
});

test('a round on a world reopens the design screen with that world active', async (t) => {
  const { dom } = await openDesign(t, stored(scifi));
  const active = [...dom.app.querySelectorAll('.theme-card[aria-pressed="true"]')];
  assert.equal(active.length, 1);
  assert.equal(active[0].dataset.world, 'scifi');
  assert.equal(dom.document.documentElement.dataset.world, 'scifi');
});

// ---- the home tile -------------------------------------------------------

test('the home tile shows the world glyph, and the app glyph for a palette', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => [
    { ...roundFixture(stored(forest)), id: 'a', members: [] },
    { ...roundFixture(stored(salbei)), id: 'b', members: [] },
  ]);
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  await dom.call('showHome');
  const glyphs = [...dom.document.querySelectorAll('.round-card:not(.round-card--new) .round-card__emblem .ti')]
    .map((i) => [...i.classList].find((c) => c.startsWith('ti-')));
  assert.deepEqual(glyphs, [forest.icon, 'ti-tornado']);
});

// ---- the CSS contract ----------------------------------------------------

const TOKENS = ['--world-font', '--world-backdrop', '--world-backdrop-size', '--world-backdrop-fade',
  '--world-frame', '--world-rule', '--world-corner', '--world-scene',
  '--world-stage', '--world-stage-size', '--world-stage-repeat', '--world-stage-position'];

test('each world declares the whole token set the six slots read, in the registry\'s face', () => {
  for (const w of WORLDS) {
    const body = bodyOf(`[data-world="${w.id}"]`);
    assert.ok(body, `styles.css has no [data-world="${w.id}"] token block`);
    for (const tok of TOKENS) assert.match(body, new RegExp(`${tok}:`), `${w.id} lacks ${tok}`);
    assert.match(body, new RegExp(`--world-font:\\s*"${w.font}"`), `${w.id}: the CSS face must be the registry's`);
  }
  // The face reaches the screen through --font-display ONLY; body text stays --font.
  assert.match(bodyOf('[data-world]'), /--font-display:\s*var\(--world-font\)/);
  assert.doesNotMatch(bodyOf('[data-world]'), /(^|[^-])--font:/, 'a world must not retheme body text');
});

test('every world face is declared, committed with its OFL licence, and not precached', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
  for (const w of WORLDS) {
    const faces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)]
      .map((m) => m[1])
      .filter((b) => b.includes(`font-family: '${w.font}'`))
      .map((b) => /url\('fonts\/([^']+)'\)/.exec(b)[1]);
    assert.ok(faces.length >= 1, `${w.font}: no @font-face declares it`);
    for (const f of faces) assert.ok(fs.existsSync(path.join(ROOT, 'public/fonts', f)), `${f} is not committed`);
    const licence = `LICENSE-${w.font.toLowerCase().replace(/\s+/g, '-')}.txt`;
    assert.ok(fs.existsSync(path.join(ROOT, 'public/fonts', licence)), `${licence} is missing`);
    assert.match(fs.readFileSync(path.join(ROOT, 'public/fonts', licence), 'utf8'), /SIL Open Font License/);
    // Lazy by construction: a face in SHELL would download in every Standard round.
    for (const f of faces) assert.doesNotMatch(sw, new RegExp(f), `${f} must not be in SHELL`);
  }
});

const SLOTS = [
  '[data-world] body::before',
  '[data-world] .btn--primary::before',
  '[data-world] .section > :is(h1, h2, h3)::after',
  '[data-world] :is(.card, .ticket, .round-card, .vote)::after',
  '[data-world] .empty::before',
  '[data-world] .stage::before',
];

// A slot selector can hold commas inside :is(), which bodyOfIn() would split on.
const slotBody = (sel) => (rulesOf(CSS).find(([s]) => s.split('\n').map((x) => x.trim().replace(/,$/, '')).includes(sel)) || [])[1] || null;

test('the six slots exist, and every ornament is a pseudo-element that takes no clicks', () => {
  for (const sel of SLOTS) assert.ok(slotBody(sel), `slot ${sel} is missing`);
  const rules = rulesOf(CSS).filter(([sel]) => sel.includes('[data-world'));
  assert.ok(rules.length >= 15, `the world rules have moved (found ${rules.length})`);
  let ornaments = 0;
  for (const [sel, body] of rules) {
    if (!/content\s*:/.test(body)) continue;
    ornaments += 1;
    // One selector per line in the sheet; a split on commas would cut :is() open.
    for (const part of sel.split('\n').map((x) => x.trim().replace(/,$/, '')).filter(Boolean)) {
      assert.match(part, /::(before|after)$/, `${part} paints content outside a pseudo-element`);
    }
    assert.match(body, /pointer-events:\s*none/, `${sel}: an ornament must not enlarge a hit target`);
  }
  assert.ok(ornaments >= 8, `expected the slot pseudo-elements, found ${ornaments}`);
  // Whatever paints, paints in a theme token — never a shade of its own
  // (.claude/rules/theme-derived-colors.md). The stage glow is a gradient OF one.
  let painted = 0;
  for (const [sel, body] of rules) {
    for (const m of body.matchAll(/background:\s*([^;]+);/g)) {
      painted += 1;
      assert.match(m[1], /^(var\(--(brand|brand-dark|stage-ink)\)|radial-gradient\([^;]*var\(--stage-ink\))/,
        `${sel}: background ${m[1]} is not a theme token`);
    }
  }
  assert.ok(painted >= 8, `expected the ornaments to paint, found ${painted} backgrounds`);
  // The focus ring and the surface are floors, not styling surfaces.
  for (const [sel, body] of rules) {
    assert.doesNotMatch(body, /box-shadow|outline|--surface\s*:/, `${sel} touches a focus ring or --surface`);
  }
});

test('the backdrop alpha stays inside the contrast budget for body text on the page', () => {
  const m = /opacity:\s*([\d.]+)/.exec(slotBody('[data-world] body::before'));
  assert.ok(m, 'the backdrop declares no opacity');
  const alpha = Number(m[1]);
  assert.ok(alpha <= 0.1, `backdrop alpha ${alpha} is above the .1 ceiling`);

  // Composite the accent over the page at that alpha and measure the two inks
  // that sit straight on the page, the way test/a11y-contrast.test.js does.
  const srgb = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (top, under, a) => top.map((c, i) => Math.round(c * a + under[i] * (1 - a)));
  const ink = (name) => hex(new RegExp(`\\${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(CSS)[1]);
  // The motif is at its densest where a silhouette is fully covered, so the
  // composite IS the worst pixel; body text keeps AAA there and the muted ink
  // keeps AA. (At .09 the drop is ~1.5 points off a ~13:1 ratio.)
  const failures = [];
  for (const w of WORLDS) {
    const bg = over(hex(w.accent), hex(w.page), alpha);
    const onMotif = contrast(ink('--ink'), bg);
    const softOnMotif = contrast(ink('--ink-soft'), bg);
    if (onMotif < 7) failures.push(`${w.id}: --ink on the motif = ${onMotif.toFixed(2)}:1`);
    if (softOnMotif < 4.5) failures.push(`${w.id}: --ink-soft on the motif = ${softOnMotif.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], 'a motif under text must keep AAA for --ink and AA for --ink-soft');
});

test('the one animation is motion-gated, and the motifs drop under prefers-contrast: more', () => {
  const blocks = mediaBlocks();
  const motion = blocks.filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q)).map(([, css]) => css).join('\n');
  const animated = rulesOf(CSS).filter(([sel, body]) => sel.includes('[data-world') && /animation\s*:/.test(body));
  assert.ok(animated.length >= 1, 'the stage glow animation has moved');
  for (const [sel, body] of animated) {
    assert.ok(motion.includes(body), `${sel} animates outside a prefers-reduced-motion: no-preference block`);
  }
  const more = blocks.filter(([q]) => /prefers-contrast:\s*more/.test(q)).map(([, css]) => css).join('\n');
  for (const sel of ['[data-world] body::before', '[data-world] .empty::before', '[data-world] .stage::before']) {
    assert.ok(more.includes(sel), `${sel} stays on under prefers-contrast: more`);
  }
  assert.match(more, /display:\s*none/);
});
