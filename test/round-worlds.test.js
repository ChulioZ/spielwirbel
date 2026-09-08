'use strict';

/* Worlds (#903): the machinery, not the art. A world is a design with a
   display face, a backdrop and ornament framing on top of the two palette
   tokens, and everything it adds hangs off ONE hook — `<html data-world="…">`.
   These specs pin that hook end to end (applyBackground sets and clears it,
   the design screen saves the id that resolves to it, the home tile shows the
   world's glyph) and the CSS contract behind it: one token block per world,
   seven slot rules that are pseudo-elements only, the two media gates, and a
   backdrop alpha inside the contrast budget. Slot 7 (#940) is the winner
   reveal's victory scene — the one slot with text ON it, so its geometry is
   pinned below the way slots 5 and 6 are. What they cannot judge is whether
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
const { contrast, tokensFor } = require('./support/theme');
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
  /* The stub PERSISTS the design, like the server does. It matters since #904:
     choosing a design now re-renders the screen, and the SWR revalidation that
     follows would otherwise hand back the ORIGINAL background and undo the
     change — a fixture artefact that reads exactly like the bug the redraw is
     there to fix. */
  let savedBg = background;
  dom.set('api', async (method, url, body) => {
    if (method === 'POST') { posts.push({ url, body }); savedBg = body; return { background: body }; }
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return roundFixture(savedBg);
    if (url === '/api/rounds') return [roundFixture(savedBg)];
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
  dom.app.querySelector('.theme-card[data-world="forest"]').click();
  await flush();

  // Through JSON: the body was built inside the jsdom realm, whose Object is
  // not this realm's, and strict deepEqual compares prototypes.
  assert.deepEqual(JSON.parse(JSON.stringify(posts)), [{ url: '/api/rounds/r1/background', body: stored(forest) }]);
  assert.equal(dom.document.documentElement.dataset.world, 'forest');
  // Re-queried, not held from before the click: the screen is REDRAWN now (see
  // below), so the elements captured earlier are detached and would report the
  // pre-click state forever.
  assert.equal(dom.app.querySelector('.theme-card[data-world="forest"]').getAttribute('aria-pressed'), 'true');
  assert.equal(dom.app.querySelector('.theme-card').getAttribute('aria-pressed'), 'false',
    'the palette group must let go of Standard');
});

test('choosing a design REDRAWS the screen, so the tones resolved in JS follow it', async (t) => {
  /* The one thing a design change could not do before #904: a dark design flips
     memberTone() and avgColor(), both of which paint inline AT RENDER TIME. Left
     un-redrawn, the rail's avatars keep the light scheme's dark discs and take
     the dark scheme's near-black initials — unreadable, on the one screen where
     a design can change. Measured in a browser before this was added. */
  const { dom } = await openDesign(t, null);
  const before = dom.app.querySelector('.theme-cards');
  dom.app.querySelector('.theme-card[data-world="scifi"]').click();
  await flush();

  assert.notEqual(dom.app.querySelector('.theme-cards'), before, 'the screen was not re-rendered');
  /* And the redraw must not repaint the PREVIOUS design: fetchRound() serves the
     SWR copy, which still holds the old background until the click handler seeds
     it. Without that seed this lands back on Standard for a beat. */
  assert.equal(dom.document.documentElement.dataset.scheme, 'dark');
  assert.equal(dom.document.documentElement.dataset.world, 'scifi');
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
  const tiles = [...dom.document.querySelectorAll('.round-card:not(.round-card--new)')];
  const glyphs = tiles.map((a) => [...a.querySelector('.round-card__emblem .ti').classList].find((c) => c.startsWith('ti-')));
  assert.deepEqual(glyphs, [forest.icon, 'ti-tornado']);
  // The tile carries the hook ITSELF, with its own accent: home has no root
  // hook, so the tile's backdrop and face come from its own attribute.
  assert.equal(tiles[0].dataset.world, 'forest');
  assert.match(tiles[0].getAttribute('style'), new RegExp(`--brand:${forest.accent}`));
  assert.equal(tiles[1].hasAttribute('data-world'), false, 'a palette tile carries no hook');
  assert.equal(dom.document.documentElement.hasAttribute('data-world'), false, 'home itself stays standard');
});

// ---- the CSS contract ----------------------------------------------------

const TOKENS = ['--world-font', '--world-backdrop', '--world-backdrop-size', '--world-backdrop-fade',
  '--world-frame', '--world-rule', '--world-corner', '--world-scene',
  '--world-stage', '--world-stage-size', '--world-stage-repeat', '--world-stage-position',
  // Slot 7 (#940): the victory scene's two layers, each a gutter pair plus a
  // band, the keyframes that grow it, and the shape the confetti bits take.
  '--world-victory-l', '--world-victory-r', '--world-victory-band',
  '--world-victory-2-l', '--world-victory-2-r', '--world-victory-2-band',
  '--world-victory-y', '--world-victory-2-y', '--world-victory-anim', '--world-victory-anim-2',
  '--world-particle', '--world-particle-w', '--world-particle-h', '--world-particle-inset',
  '--world-particle-anim', '--world-particle-dur'];

test('each world declares the whole token set the seven slots read, in the registry\'s face', () => {
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
  '[data-world] .spotlight::before',
];

// A slot selector can hold commas inside :is(), which bodyOfIn() would split on.
const slotBody = (sel) => (rulesOf(CSS).find(([s]) => s.split('\n').map((x) => x.trim().replace(/,$/, '')).includes(sel)) || [])[1] || null;

test('the seven slots exist, and every ornament is a pseudo-element that takes no clicks', () => {
  for (const sel of SLOTS) assert.ok(slotBody(sel), `slot ${sel} is missing`);
  const rules = rulesOf(CSS).filter(([sel]) => sel.includes('[data-world'));
  assert.ok(rules.length >= 19, `the world rules have moved (found ${rules.length})`);
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
  assert.ok(ornaments >= 9, `expected the slot pseudo-elements, found ${ornaments}`);
  // Whatever paints, paints in a theme token — never a shade of its own
  // (.claude/rules/theme-derived-colors.md). The stage glow is a gradient OF one.
  let painted = 0;
  for (const [sel, body] of rules) {
    for (const m of body.matchAll(/background:\s*([^;]+);/g)) {
      painted += 1;
      assert.match(m[1], /^(var\(--(brand|brand-strong|stage-ink)\)|radial-gradient\([^;]*var\(--stage-ink\))/,
        `${sel}: background ${m[1]} is not a theme token`);
    }
  }
  assert.ok(painted >= 10, `expected the ornaments to paint, found ${painted} backgrounds`);
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
  /* The inks come from test/support/theme.js, resolved FOR THE WORLD: a dark
     world (#904) replaces both, and a regex over `:root` would have measured the
     light pair over a night page — reporting ~1.05:1 for a combination the app
     never paints, i.e. failing for the wrong reason and hiding the real one. */
  const over = (top, under, a) => top.map((c, i) => Math.round(c * a + under[i] * (1 - a)));
  // The motif is at its densest where a silhouette is fully covered, so the
  // composite IS the worst pixel; body text keeps AAA there and the muted ink
  // keeps AA. (At .09 the drop is ~1.5 points off a ~13:1 ratio.)
  const failures = [];
  for (const w of WORLDS) {
    const t = tokensFor(w);
    const bg = over(t.brand, t.page, alpha);
    const onMotif = contrast(t.ink, bg);
    const softOnMotif = contrast(t.inkSoft, bg);
    if (onMotif < 7) failures.push(`${w.id}: --ink on the motif = ${onMotif.toFixed(2)}:1`);
    if (softOnMotif < 4.5) failures.push(`${w.id}: --ink-soft on the motif = ${softOnMotif.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], 'a motif under text must keep AAA for --ink and AA for --ink-soft');
});

/* The scene slots are BOLD (.36 / .4) because they sit where no text is — and
   that is geometry, not a promise. The empty state's band is the art's own
   height-to-width ratio, and the box reserves that much below its text; the
   stage's band must end above the title, i.e. inside the seal's own height. */
const artRatio = (token, world) => {
  const m = /width='(\d+)' height='(\d+)'/.exec(bodyOf(`[data-world="${world.id}"]`).split(token + ':')[1] || '');
  assert.ok(m, `${world.id}: ${token} is not an SVG with a width and a height`);
  return Number(m[2]) / Number(m[1]);
};

test('the empty-state scene lives in a reserved band below the text', () => {
  const box = bodyOf('[data-world] .empty');
  assert.ok(box, 'the empty-state host rule has moved');
  // Reserved: 44px + min(P%, CAPpx). Drawn: min(100%, Wpx) wide at the art's
  // ratio. Both halves must cover the band, at every width.
  const pad = /padding-bottom:\s*calc\(\s*44px\s*\+\s*min\(\s*(\d+)%\s*,\s*(\d+)px\s*\)\s*\)/.exec(box);
  assert.ok(pad, '.empty must reserve a capped percentage band below its 44px padding');
  const scene = slotBody('[data-world] .empty::before');
  const size = /mask-size:\s*min\(\s*100%\s*,\s*(\d+)px\s*\)\s+auto/.exec(scene);
  assert.ok(size, 'the scene must stop growing at a capped width');
  assert.match(scene, /mask-position:\s*center bottom/);
  assert.match(scene, /mask-repeat:\s*no-repeat/);
  for (const w of WORLDS) {
    const ratio = artRatio('--world-scene', w);
    assert.ok(Number(pad[1]) / 100 >= ratio - 1e-9,
      `${w.id}: the scene is ${(ratio * 100).toFixed(0)}% of the width but only ${pad[1]}% is reserved`);
    assert.ok(Number(pad[2]) >= Number(size[1]) * ratio - 1e-9,
      `${w.id}: the scene caps at ${(Number(size[1]) * ratio).toFixed(0)}px tall but only ${pad[2]}px is reserved`);
  }
});

test('the stage scene is a band behind the seal that ends above the title', () => {
  const stage = bodyOf('.stage');
  const seal = bodyOf('.stage__seal');
  const maxW = Number(/max-width:\s*(\d+)px/.exec(stage)[1]);
  const padTop = Number(/padding:\s*(\d+)px/.exec(stage)[1]);
  const sealH = Number(/height:\s*(\d+)px/.exec(seal)[1]);
  const sealGap = Number(/margin-bottom:\s*(\d+)px/.exec(seal)[1]);
  const scene = bodyOf('[data-world] .stage::before'); // exact: the shared before/after rule carries no mask
  assert.match(scene, /mask-size:\s*var\(--world-stage-size\)/);
  for (const w of WORLDS) {
    const body = bodyOf(`[data-world="${w.id}"]`);
    assert.match(body, /--world-stage-size:\s*100% auto/, `${w.id}: the stage scene must scale with the width`);
    assert.match(body, /--world-stage-repeat:\s*no-repeat/, `${w.id}: a tiled stage motif sits under the text`);
    assert.match(body, /--world-stage-position:\s*center top/, `${w.id}: the band belongs behind the seal`);
    const bandPx = artRatio('--world-stage', w) * maxW;
    assert.ok(bandPx <= padTop + sealH + sealGap,
      `${w.id}: the band is ${bandPx.toFixed(0)}px tall at ${maxW}px, past the title at ${padTop + sealH + sealGap}px`);
  }
});

test('every animation is motion-gated, and the motifs drop under prefers-contrast: more', () => {
  const blocks = mediaBlocks();
  const motion = blocks.filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q)).map(([, css]) => css).join('\n');
  // Both call shapes — `animation:` and `animation-name:` — or a rule written
  // the second way would be invisible here (source-scanning-guards-enumerate-shapes.md).
  const animated = rulesOf(CSS).filter(([sel, body]) => sel.includes('[data-world') && /animation(?:-name)?\s*:/.test(body));
  assert.ok(animated.length >= 4, `the world animations have moved (found ${animated.length})`);
  for (const [sel, body] of animated) {
    assert.ok(motion.includes(body), `${sel} animates outside a prefers-reduced-motion: no-preference block`);
  }
  const more = blocks.filter(([q]) => /prefers-contrast:\s*more/.test(q)).map(([, css]) => css).join('\n');
  for (const sel of ['[data-world] body::before', '[data-world] .empty::before', '[data-world] .stage::before',
    '[data-world] .spotlight::before', '[data-world] .spotlight::after']) {
    assert.ok(more.includes(sel), `${sel} stays on under prefers-contrast: more`);
  }
  assert.match(more, /display:\s*none/);
});

// ---- slot 7: the victory scene (#940) ------------------------------------

/* The scene sits on the winner spotlight, which has text ON it — the kicker
   and the title — so, unlike slots 5 and 6, no band is text-free by nature.
   The contract that makes it bold anyway: the hero paints only in the two
   side gutters and the bottom band, and the host RESERVES exactly those as
   padding, through the same two custom properties the masks are sized with.
   One property on both sides makes a drift unrepresentable (the shape #928
   argued for), so the spec pins the sharing rather than comparing numbers. */
const tokenValue = (world, tok) => {
  // The LAST declaration, as the cascade reads it: a duplicated token would
  // otherwise let the spec read one value while the browser paints another.
  const all = [...bodyOf(`[data-world="${world.id}"]`).matchAll(new RegExp(`${tok}:\\s*([^;]+);`, 'g'))];
  assert.ok(all.length, `${world.id} lacks ${tok}`);
  return all[all.length - 1][1].trim();
};

test('the victory scene paints only in the gutters and the band the spotlight reserves', () => {
  const host = bodyOf('[data-world] .spotlight');
  assert.ok(host, 'the spotlight host rule is missing');
  const col = /--victory-col:\s*min\(\s*(\d+)%\s*,\s*(\d+)px\s*\)/.exec(host);
  const band = /--victory-band:\s*min\(\s*(\d+)%\s*,\s*(\d+)px\s*\)/.exec(host);
  assert.ok(col, 'the gutter width must be a capped percentage, declared once on the host');
  assert.ok(band, 'the band height must be a capped percentage, declared once on the host');
  assert.match(host, /padding-inline:\s*var\(--victory-col\)/,
    'the gutters are reserved through the SAME property the gutter masks are sized with');
  assert.match(host, /padding-bottom:\s*calc\(20px \+ var\(--victory-band\)\)/, 'and so is the band');
  assert.match(host, /overflow:\s*hidden/, 'a launching rocket starts below the card');
  assert.match(host, /isolation:\s*isolate/, 'z-index: -1 must not sink the scene under the page');

  const shared = slotBody('[data-world] .spotlight::before');
  const size = /mask-size:\s*var\(--victory-col\) auto,\s*var\(--victory-col\) auto,\s*min\(\s*100%\s*,\s*(\d+)px\s*\)\s+auto/.exec(shared);
  assert.ok(size, 'the two gutter layers are sized by --victory-col and the band layer caps its width');
  assert.match(shared, /mask-repeat:\s*no-repeat/);
  assert.match(shared, /transform-origin:\s*50% 100%/, 'a scene grows from the ground, never toward the centre');
  for (const pseudo of ['before', 'after']) {
    const own = bodyOf(`[data-world] .spotlight::${pseudo}`);
    assert.ok(own, `::${pseudo} has no rule of its own`);
    assert.match(own, /mask-position:\s*left var\(--world-victory(?:-2)?-y\),\s*right var\(--world-victory(?:-2)?-y\),\s*center bottom/,
      `::${pseudo}: the gutter layers hug the edges and the band sits at the bottom`);
  }
  for (const w of WORLDS) {
    for (const tok of ['--world-victory-y', '--world-victory-2-y']) {
      assert.match(tokenValue(w, tok), /^(top|bottom)$/, `${w.id}: ${tok} must anchor a gutter layer to an edge`);
    }
    // The band art's height-to-width ratio must fit the reserved band at every
    // width, and its capped width at the cap — slot 5's arithmetic.
    for (const tok of ['--world-victory-band', '--world-victory-2-band']) {
      if (tokenValue(w, tok) === 'none') continue;
      const ratio = artRatio(tok, w);
      assert.ok(Number(band[1]) / 100 >= ratio - 1e-9,
        `${w.id}: ${tok} is ${(ratio * 100).toFixed(1)}% of the width tall but only ${band[1]}% is reserved`);
      assert.ok(Number(band[2]) >= Number(size[1]) * ratio - 1e-9,
        `${w.id}: ${tok} caps at ${(Number(size[1]) * ratio).toFixed(0)}px tall but only ${band[2]}px is reserved`);
    }
    // And every world puts SOMETHING in the band and in a gutter: an empty
    // frame is the one end state the issue rules out.
    assert.ok(['--world-victory-band', '--world-victory-2-band'].some((tok) => tokenValue(w, tok) !== 'none'),
      `${w.id}: the band is empty`);
    assert.ok(['--world-victory-l', '--world-victory-r', '--world-victory-2-l', '--world-victory-2-r']
      .some((tok) => tokenValue(w, tok) !== 'none'), `${w.id}: both gutters are empty`);
  }
  // At the narrowest phone width the winner must still fit between the gutters
  // WITHOUT its max-width: 100% squeeze, or the reservation is paid for with a
  // cropped cover. 320px is the floor test/phone-width-overflow.test.js holds.
  const appPad = Number(/padding:\s*\d+px\s+(\d+)px/.exec(bodyOf('.app'))[1]);
  const inner = 320 - 2 * appPad;
  const winner = Number(/width:\s*(\d+)px/.exec(bodyOf('.spotlight__winner'))[1]);
  const left = inner * (1 - 2 * Number(col[1]) / 100);
  assert.ok(left >= winner, `at 320px the gutters leave ${left.toFixed(0)}px for a ${winner}px winner`);
});

test('the scene rests in its end state; only the reveal animates it, through motion-gated keyframes each world names', () => {
  // The end state IS the ornament: the un-revealed rules carry no animation,
  // so a cold load, the Chronik and a reduced-motion reader get the composed scene.
  for (const sel of ['[data-world] .spotlight::before', '[data-world] .spotlight::after']) {
    assert.doesNotMatch(bodyOf(sel), /animation/, `${sel} must rest — the reveal class is what animates`);
  }
  const motion = mediaBlocks().filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q)).map(([, css]) => css).join('\n');
  const reveal = rulesOf(motion).filter(([sel]) => /^\[data-world\] \.spotlight\.is-reveal::(before|after)$/.test(sel));
  assert.equal(reveal.length, 2, 'both layers animate on the reveal, inside the motion gate');
  for (const [sel, body] of reveal) {
    // Once, after the 0.55s spotlight rise (0.1s delay + 0.55s), on the
    // long-form scale the :root comment enumerates — never the micro scale.
    assert.match(body, /animation:\s*var\(--world-victory-anim(?:-2)?\)\s+2\.6s\s+[^;]*\.65s\s+both/,
      `${sel} must run the world's own keyframes once, after the rise, holding both end states`);
    assert.doesNotMatch(body, /infinite/, `${sel}: the hero runs ONCE`);
  }
  // Every keyframe name a world declares must exist inside the gate: a typo
  // here animates nothing and reports nothing.
  const names = [...motion.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  for (const w of WORLDS) {
    for (const tok of ['--world-victory-anim', '--world-victory-anim-2', '--world-particle-anim']) {
      const name = tokenValue(w, tok);
      assert.ok(names.includes(name), `${w.id}: ${tok} names "${name}", which no motion-gated @keyframes declares`);
    }
  }
});

test('a world re-shapes the confetti bits through tokens — the same bits, no second generator', () => {
  // The palette colour has to arrive as a custom property: an inline
  // `background` would beat every rule, and a world could never recolour it.
  assert.match(bodyOf('.confetti__bit'), /background:\s*var\(--bit-color\)/);
  const bits = bodyOf('[data-world] .confetti__bit');
  assert.ok(bits, 'the world particle rule is missing');
  for (const decl of ['mask-image:\\s*var\\(--world-particle\\)', 'width:\\s*var\\(--world-particle-w\\)',
    'height:\\s*var\\(--world-particle-h\\)', 'inset-block:\\s*var\\(--world-particle-inset\\)',
    'background:\\s*var\\(--brand\\)']) {
    assert.match(bits, new RegExp(decl), `the particle rule lacks ${decl}`);
  }
  const motion = mediaBlocks().filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q)).map(([, css]) => css).join('\n');
  const animated = rulesOf(motion).find(([sel]) => sel === '[data-world] .confetti__bit');
  assert.ok(animated, 'the particles animate inside the motion gate');
  assert.match(animated[1], /animation:\s*var\(--world-particle-anim\)\s+var\(--world-particle-dur\)/,
    'the shape and the pace are the world\'s; the loop is shared');
});

/* Slot 2's frame hangs .8em outside the button box, and a button row sits its
   controls 10px apart — so a primary button with a neighbour paints its ornament
   onto that neighbour unless something reserves the space. Measured in the pane
   on 2026-09-08 before the fix: 4.4px of leaf over „Zurück" (.vote__nav) and
   7.6px over „Speichern & weiteres" (.toolbar.sheet__actions).

   Two properties are asserted, and the SECOND is the one that cost a cycle. The
   clearance must be `column-gap`, never a margin on the button: .toolbar wraps,
   and a horizontal margin then narrows the primary button relative to the one
   stacked under it (measured at 390px: 335px vs 344px) — a new defect in the
   place the ornament never collided. column-gap is inert between lines, so it
   cannot reintroduce that. A margin passes a naive "is there clearance" check
   just as well, which is why the property itself is pinned.

   CSS text rather than jsdom, because jsdom applies no stylesheet and the
   geometry this is about does not exist there. */
test('a world-framed primary button reserves room for its ornament beside a neighbour', () => {
  const rule = rulesOf(CSS).find(([sel]) =>
    sel.includes('[data-world]') && sel.includes(':has(> .btn--primary)'));
  assert.ok(rule, 'no ornament-clearance rule scoped to a row holding a primary button');
  const [sel, body] = rule;

  // Both rows that hold a primary button today.
  assert.match(sel, /\.toolbar/);
  assert.match(sel, /\.vote__nav/);

  // column-gap, not `gap` and not a margin — see the note above.
  assert.match(body, /column-gap:/, 'the clearance must be column-gap');
  assert.doesNotMatch(body, /margin-inline|margin-left|margin-right/,
    'a horizontal margin narrows the button when the row wraps');

  const px = parseFloat(body.match(/column-gap:\s*([\d.]+)px/)?.[1] ?? '0');
  // .8em of the largest button in these rows (22px btn--lg) is 17.6px.
  assert.ok(px >= 18, `column-gap ${px}px does not clear the 17.6px overhang`);
});
