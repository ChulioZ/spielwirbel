'use strict';

/* Worlds (#903): the machinery, not the art. A world is a design with a
   display face, a backdrop and ornament framing on top of the two palette
   tokens, and everything it adds hangs off ONE hook — `<html data-world="…">`.
   These specs pin that hook end to end (applyBackground sets and clears it,
   the design screen saves the id that resolves to it, the home tile shows the
   world's glyph) and the CSS contract behind it: one token block per world,
   nine slot rules that are pseudo-elements only, the two media gates, and a
   backdrop alpha inside the contrast budget. Slot 7 (#940) is the winner
   reveal's victory scene — the one slot with text ON it, so its geometry is
   pinned below the way slots 5 and 6 are. Slot 9 (#1083) re-uses slot 7's band
   art as the Pokale podium's floor, so what is pinned for it is the sizing
   discipline and the fact that EVERY world has a band for it to paint. What they cannot judge is whether
   the ornaments LOOK right — that is a browser check, per the issue.

   Driven through the jsdom harness rather than by matching source text where a
   DOM is involved; the stylesheet assertions read the comment-stripped CSS via
   test/support/css.js (.claude/rules/css-text-assertions-strip-comments.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./support/dom');
const { CSS, rulesOf, bodyOf, mediaBlocks, topLevel } = require('./support/css');
const { contrast, tokensFor } = require('./support/theme');
const { PALETTES, WORLDS } = require('../public/js/round-designs');

const ROOT = path.join(__dirname, '..');
const forest = WORLDS.find((w) => w.id === 'forest');
const scifi = WORLDS.find((w) => w.id === 'scifi');
const salbei = PALETTES.find((p) => p.id === 'salbei');
const stored = (d) => ({ type: 'theme', id: d.id, page: d.page, accent: d.accent });

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

// ---- fixtures ------------------------------------------------------------

function roundFixture(background) {
  return {
    id: 'r1', name: 'Waldläufer', background, games: [], members: [], sessions: [], tags: [],
    gameCount: 0, sessionCount: 0, playedCount: 0, lastPlayed: null,
  };
}

/* The design PICKER's five specs lived here until #1187, which replaced that
   screen with the marker picker — rounds no longer choose a design. They moved
   to test/round-marker.test.js in their new form; what stays in this file is the
   rendering of the worlds already on a round, which survives until the flip
   (#1202) deletes the world CSS. */

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

/* The alpha each world declares for slot 1, read from its own token block. */
const backdropAlpha = (world) => {
  const m = /--world-backdrop-alpha:\s*([\d.]+)/.exec(bodyOf(`[data-world="${world.id}"]`) || '');
  assert.ok(m, `${world.id} declares no --world-backdrop-alpha`);
  return Number(m[1]);
};
const over = (top, under, a) => top.map((c, i) => Math.round(c * a + under[i] * (1 - a)));

const TOKENS = ['--world-font', '--world-backdrop', '--world-backdrop-size', '--world-backdrop-fade',
  // Slot 1's alpha (#1138). Explicit in all seven rather than a var() fallback
  // on the slot rule: a world that forgot it would silently inherit a number
  // measured for somebody else's page, which is the bug that issue was.
  '--world-backdrop-alpha',
  '--world-frame', '--world-rule', '--world-corner', '--world-scene',
  '--world-stage', '--world-stage-size', '--world-stage-repeat', '--world-stage-position',
  // Slot 7 (#940): the victory scene's two layers, each a gutter pair plus a
  // band, the keyframes that grow it, and the shape the confetti bits take.
  '--world-victory-l', '--world-victory-r', '--world-victory-band',
  '--world-victory-2-l', '--world-victory-2-r', '--world-victory-2-band',
  '--world-victory-y', '--world-victory-2-y', '--world-victory-anim', '--world-victory-anim-2',
  '--world-particle', '--world-particle-w', '--world-particle-h', '--world-particle-inset',
  '--world-particle-anim', '--world-particle-dur',
  // Slot 8 (#1082): where the stage art is anchored inside the crown strip —
  // `top` for the worlds whose motif hangs (canopy, waves, webs), `bottom` for
  // those whose motif stands (skyline, rank, horizon).
  '--world-crown-y',
  // Slot 10 (#1086): the vessel the session pot's covers are piled in.
  '--world-vessel'];

test('each world declares the whole token set the ten slots read, in the registry\'s face', () => {
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
  // Slot 8 (#1082) — the crown. One rule for both hosts, so it is asserted as
  // the grouped selector the sheet declares rather than twice.
  '[data-world] .hero::before',
  // Slot 9 (#1083) — the podium's floor, slot 7's band art under the pedestals.
  '[data-world] .podium::before',
  // Slot 10 (#1086) — the session pot's vessel. TWO entries, because the pool
  // is rendered twice and CSS picks one by width: deleting either rule leaves
  // a whole class of viewport with no vessel, and a single entry would not see
  // it. That is the mistake the issue's own proposal made — it named only
  // `.pool-shelf`, which is `display: none` from 860px up.
  '[data-world] .setup-panel::after',
  '[data-world] .setup-filterbar .pool-hint::after',
];

/* A slot selector can hold commas inside :is(), which bodyOfIn() would split on.
   TOP LEVEL only: four of these selectors appear again inside the
   prefers-contrast block's grouped `display: none`, so a whole-sheet lookup
   would answer with that reset for a slot that has been DELETED — measured on
   #1083, where removing the podium floor left the existence test green. */
const slotBody = (sel) => (rulesOf(topLevel()).find(([s]) => s.split('\n').map((x) => x.trim().replace(/,$/, '')).includes(sel)) || [])[1] || null;

test('the ten slots exist, and every ornament is a pseudo-element that takes no clicks', () => {
  for (const sel of SLOTS) assert.ok(slotBody(sel), `slot ${sel} is missing`);
  const rules = rulesOf(CSS).filter(([sel]) => sel.includes('[data-world'));
  assert.ok(rules.length >= 21, `the world rules have moved (found ${rules.length})`);
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
  assert.ok(ornaments >= 10, `expected the slot pseudo-elements, found ${ornaments}`);
  // Whatever paints, paints in a theme token — never a shade of its own
  // (.claude/rules/theme-derived-colors.md). The stage glow is a gradient OF one.
  let painted = 0;
  for (const [sel, body] of rules) {
    for (const m of body.matchAll(/background:\s*([^;]+);/g)) {
      painted += 1;
      assert.match(m[1], /^(var\(--(brand|brand-strong|stage-ink)\)|currentColor|radial-gradient\([^;]*var\(--stage-ink\))/,
        `${sel}: background ${m[1]} is not a theme token`);
    }
  }
  assert.ok(painted >= 11, `expected the ornaments to paint, found ${painted} backgrounds`);
  /* `currentColor` is allowed above, and it is NOT a loophole — but it only
     holds while the element it inherits from sets a theme-derived `color`. The
     one user is the coverless tile's motif (#1082), which takes the tornado's
     own ink on purpose so the two cannot differ. Check the chain rather than
     trusting it: an ornament inheriting a literal would pass the allowlist
     while painting a shade of its own. */
  const inheritors = rules.filter(([, body]) => /background:\s*currentColor/.test(body))
    .map(([sel]) => sel.replace(/::(before|after)$/, '').replace(/^\[data-world\]\s*/, '').trim());
  assert.deepEqual([...new Set(inheritors)], ['.cover-ph'],
    'a new ornament paints currentColor — add its host to the colour check below');
  for (const [sel, body] of rulesOf(CSS)) {
    if (sel.trim() !== '.cover-ph') continue;
    const c = /(^|[\s;])color:\s*([^;]+);/.exec(body);
    if (!c) continue;
    assert.match(c[2].trim(), /^(color-mix\(|oklch\(from )[^;]*var\(--brand/,
      `.cover-ph ink ${c[2]} is not derived from the round's accent, so currentColor is not either`);
  }
  // The focus ring and the surface are floors, not styling surfaces.
  for (const [sel, body] of rules) {
    assert.doesNotMatch(body, /box-shadow|outline|--surface\s*:/, `${sel} touches a focus ring or --surface`);
  }
});

test('the crown reserves its own height through ONE property, so art and space cannot drift', () => {
  /* Slot 5's discipline, and the reason it exists: the strip is painted at
     `height: var(--crown-h)` and the host reserves `padding-top: calc(var(--crown-h) + N)`.
     Two literals that must agree would drift on the first retune, and the
     failure is SILENT in both directions — too little padding clips the art,
     too much leaves an empty band above the round's name, and nothing goes red.
     Assert the property is what carries both, not the number it holds today. */
  for (const host of ['[data-world] .hero', '[data-world] .rail__id']) {
    const body = rulesOf(CSS).find(([sel]) => sel.trim() === host);
    assert.ok(body, `${host} does not reserve the crown's strip`);
    assert.match(body[1], /--crown-h:\s*[^;]+;/, `${host} declares no --crown-h`);
    assert.match(body[1], /padding-top:\s*calc\(var\(--crown-h\)/,
      `${host} reserves a literal instead of var(--crown-h) — art and space will drift`);
  }
  const art = slotBody('[data-world] .hero::before');
  assert.match(art, /height:\s*var\(--crown-h\)/,
    'the crown paints at a literal height instead of --crown-h');

  // And the anchor is per world, never a fixed edge: cropping a 600x140 scene to
  // a <=96px strip keeps the TOP for a canopy and the BOTTOM for a skyline.
  assert.match(art, /mask-position:\s*center var\(--world-crown-y\)/,
    'the crown crops at a fixed edge, so half the worlds show the wrong part of their art');
});

test('the poster crown re-uses slot 8\'s art and per-world anchor, over a lighter backdrop', () => {
  /* Two things the natural implementation gets wrong. A second copy of the art
     would drift from the crown the ROUND wears — the design screen is where a
     world is judged, so the two must be the same scene cropped the same way.
     And a poster carries the motif backdrop AND the crown, so the .16 measured
     for a bare swatch stacks; the lighter alpha therefore rides ONE declaration
     on the shared card/tile rule rather than a second rule at the same
     specificity, where source order and not the author decides which wins
     (test/css-specificity.test.js). */
  const crown = slotBody('.theme-card__crown');
  assert.ok(crown, 'the poster card has no crown rule');
  assert.match(crown, /mask-image:\s*var\(--world-stage\)/, 'the poster draws art of its own');
  assert.match(crown, /mask-position:\s*center var\(--world-crown-y\)/,
    'a fixed edge crops half the worlds at the wrong end');
  assert.match(slotBody(':is(.theme-card, .round-card)[data-world]::before'),
    /opacity:\s*var\(--motif-a,\s*\.14\)/, 'the card backdrop takes no per-card alpha');
  /* #1138: the poster's own alpha is DERIVED, so retuning a world's backdrop
     moves the card it is chosen from. The fallback beside it stays a literal on
     purpose — it is reached only by the home round tile, which sits on the
     unthemed lobby and is measured against a different ink in
     test/a11y-contrast.test.js. Asserting the shape, not the number, so the
     two cannot silently converge again. */
  assert.match(slotBody('.theme-card--world'),
    /--motif-a:\s*min\(calc\(var\(--world-backdrop-alpha\)\s*\*\s*[\d.]+\),\s*\.[\d]+\)/,
    'the poster must derive its motif from the backdrop alpha it previews');
});

test('the poster\'s derived motif keeps the world\'s own name legible on it', () => {
  /* The bar on this card is NOT an ink: .theme-card__name is painted in the
     design's own accent (views-round-settings.js writes it inline), and the
     motif under it is that same accent — so the two CLOSE on each other as
     alpha rises, which is the failure a derivation can introduce and no ink
     measurement anywhere else would see. --text-xl at 700 is large text: 3:1.

     The card is self-contained rather than dependent on the round it is shown
     in: it carries background:<page> and --brand:<accent> inline, so the
     composite below is what ships regardless of the surrounding design. */
  const m = /--motif-a:\s*min\(calc\(var\(--world-backdrop-alpha\)\s*\*\s*([\d.]+)\),\s*(\.[\d]+)\)/
    .exec(slotBody('.theme-card--world'));
  assert.ok(m, 'the poster declares no derived --motif-a');
  const [factor, cap] = [Number(m[1]), Number(m[2])];
  const failures = [];
  for (const w of WORLDS) {
    const th = tokensFor(w);
    const a = Math.min(backdropAlpha(w) * factor, cap);
    const ratio = contrast(th.brand, over(th.brand, th.page, a));
    if (ratio < 3) failures.push(`${w.id}: the name at --motif-a ${a.toFixed(3)} = ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [],
    'a poster name is the accent ON the accent; large bold text needs 3:1');
});

test('the podium floor reserves its band through ONE property, and that property is a LENGTH', () => {
  /* The crown's discipline (above), plus the trap that is specific to this host.
     A percentage resolves against the containing block's WIDTH in
     `padding-bottom` and against the element's own HEIGHT in `mask-size`, so one
     property holding `15%` would silently mean two different bands — reserving
     one size and painting another, with nothing to fail. Slot 5 can afford a
     percentage because it pairs it with a capped WIDTH and restates the art's
     ratio; this one is sized by height, so the property must be absolute. */
  const host = rulesOf(CSS).find(([sel]) => sel.trim() === '[data-world] .podium');
  assert.ok(host, 'the podium does not reserve the world floor');
  assert.match(host[1], /--podium-band:\s*([^;]+);/, 'the podium declares no --podium-band');
  assert.doesNotMatch(/--podium-band:\s*([^;]+);/.exec(host[1])[1], /%/,
    '--podium-band is a percentage — it means a different band in each of its two uses');
  assert.match(host[1], /padding-bottom:\s*calc\(\s*\d+px\s*\+\s*var\(--podium-band\)\s*\)/,
    'the podium reserves a literal instead of var(--podium-band) — art and space will drift');

  const floor = slotBody('[data-world] .podium::before');
  assert.match(floor, /mask-size:\s*auto var\(--podium-band\)/,
    'the floor is sized by a literal instead of --podium-band');
  assert.match(floor, /mask-repeat:\s*repeat-x/,
    'the floor must tile — a podium is wider than one band of art');
  assert.match(floor, /mask-position:\s*center bottom/);
  // `overflow: hidden` would clip the focus ring of a .podium__entry link at the
  // outer columns, and buys nothing: the art is `inset: 0` on the pseudo-element.
  assert.doesNotMatch(host[1], /overflow:\s*hidden/,
    'the podium clips its own entries\' focus rings for an ornament that cannot overflow');
  assert.match(host[1], /isolation:\s*isolate/,
    'without a stacking context the z-index: -1 floor paints behind the card');
});

test('every world has a floor for the podium to stand on, on one of the two band layers', () => {
  /* The floor reads BOTH victory bands because a world may carry its ground line
     on either: Sci-Fi's `--world-victory-band` is `none` and its pad and
     starfield live on the `-2` layer. Without this, a new world declaring only
     the layer it happens to animate would ship a bare podium — the ornament
     simply absent, which looks like the round having no world at all. */
  const floor = slotBody('[data-world] .podium::before');
  assert.match(floor, /mask-image:\s*var\(--world-victory-band\),\s*var\(--world-victory-2-band\)/,
    'the floor reads one band layer, so a world carrying its ground on the other paints nothing');
  const bare = WORLDS.filter((w) => {
    const body = bodyOf(`[data-world="${w.id}"]`);
    return ![/--world-victory-band:\s*url\(/, /--world-victory-2-band:\s*url\(/].some((re) => re.test(body));
  }).map((w) => w.id);
  assert.deepEqual(bare, [], 'these worlds declare no victory band at all, so their podium has no floor');
});

// ---- slot 10: the session pot's vessel (#1086) ---------------------------

/* The pool is rendered TWICE and CSS picks one by width (views-session.js), so
   this slot is the only one with two hosts — and the two are not symmetrical.
   The panel can reserve a band and pays for it out of the pool's own scroll
   height; the strip cannot reserve anything (the setup screen fills a 390x844
   phone to the pixel) and is text-free by geometry instead. Both halves are
   pinned here, because each is load-bearing in a way the other is not. */

test('the pot\'s vessel paints on BOTH presentations, in the world\'s own art', () => {
  for (const sel of ['[data-world] .setup-panel::after',
    '[data-world] .setup-filterbar .pool-hint::after']) {
    const art = slotBody(sel);
    assert.ok(art, `${sel} is missing`);
    assert.match(art, /mask-image:\s*var\(--world-vessel\)/, `${sel} draws art of its own`);
    assert.match(art, /background:\s*var\(--brand\)/, `${sel} does not paint in the accent`);
    assert.match(art, /opacity:\s*\.55/, `${sel}: the text-free alpha is slot 7's .55`);
    assert.match(art, /z-index:\s*-1/, `${sel} would paint OVER the covers`);
  }
});

test('the panel reserves its band and pays for it out of the pool, not the screen', () => {
  const host = slotBody('[data-world] .setup-panel');
  assert.ok(host, 'the panel host rule is missing');
  const cap = /--pot-band:\s*clamp\([^,]+,[^,]+,\s*(\d+)px\)/.exec(host);
  assert.ok(cap, 'the band is not one clamped number');
  /* The cap is a measurement, not a round number: at 1280x800 on a short pool
     the band is added height (the max-height floor binds under ~800px tall), and
     116px put the „Loswirbeln" button's bottom at 802 against an 800px fold.
     84 leaves 30px. Raising this without re-measuring loses the CTA. */
  assert.ok(Number(cap[1]) <= 84, `the band's cap is ${cap[1]}px — above 84 the CTA leaves the fold at 1280x800`);
  assert.match(host, /padding-bottom:\s*calc\(16px \+ var\(--pot-band\)\)/,
    'the panel does not reserve the band it paints in — the art sits under the tile titles');
  assert.match(slotBody('[data-world] .setup-panel::after'), /height:\s*var\(--pot-band\)/,
    'the art and the reservation are two numbers, which can drift');
  /* The coupling, and the whole reason the band is affordable: the pool's
     max-height gives the band back, so the panel's total height is unchanged and
     the action bar does not move down the screen. Without this the vessel costs
     the CTA exactly the distance the max-height exists to protect. */
  assert.match(bodyOf('.setup-panel__body'),
    /max-height:\s*max\(300px,\s*calc\(100dvh - 500px - var\(--pot-band,\s*0px\)\)\)/,
    "the pool's scroll height does not give the band back");
});

test('the phone strip reserves NOTHING and clears the count group by geometry', () => {
  /* Measured on the demo at 390x844: the setup screen ends at 844 exactly (app
     732 + footer 112), so a reserved band here buys art with a scrollbar. The
     art is right-anchored instead, and the row's only text — the count group —
     is a left-aligned flex item ending at x 22 of 256 (x 91 of 622 at 768). */
  const host = slotBody('[data-world] .setup-filterbar .pool-hint');
  assert.ok(host, 'the strip host rule is missing');
  assert.doesNotMatch(host, /padding/,
    'the strip reserves height it has not got — the setup screen already fills a 390px phone');
  const art = slotBody('[data-world] .setup-filterbar .pool-hint::after');
  assert.match(art, /inset:\s*0 0 0 auto/, 'the art is not anchored to the row\'s right edge');
  assert.match(art, /width:\s*min\(220px, 60%\)/,
    'the art box is unbounded, so a long caption and the vessel can meet');
  assert.match(art, /mask-position:\s*right bottom/, 'the art does not sit at the anchored edge');
});

test('every world\'s vessel is the same 200x120 box, so one band height sizes them all', () => {
  /* Both hosts size the mask by HEIGHT (`auto 100%`), so the art's width is the
     band height times this ratio — 127px on the strip, which is the number the
     geometry argument above rests on. A world shipping a differently-shaped
     vessel would silently paint wider than the clearance measured for it. */
  for (const w of WORLDS) {
    assert.equal(artRatio('--world-vessel', w), 120 / 200, `${w.id}: the vessel is not a 200x120 box`);
  }
  for (const sel of ['[data-world] .setup-panel::after',
    '[data-world] .setup-filterbar .pool-hint::after']) {
    assert.match(slotBody(sel), /mask-size:\s*auto 100%/, `${sel}: the art must keep its own ratio`);
  }
});

test('the crown, the dock motif and the podium floor stand down under prefers-contrast: more', () => {
  /* Every world ornament does, and three of them need their RESERVATION removed
     with them: a hidden crown over an unchanged `padding-top` leaves the round's
     name floating under an empty 96px band, and a hidden floor leaves the
     pedestals standing on 84px of nothing. The coverless tile gets its tornado
     back rather than nothing at all. */
  const hi = mediaBlocks().filter(([q]) => /prefers-contrast:\s*more/.test(q))
    .map(([, css]) => css).join('\n');
  assert.ok(hi, 'no prefers-contrast: more block');
  for (const sel of ['[data-world] .hero::before', '[data-world] .rail__id::before',
    '[data-world] .dock::before', '[data-world] .cover-ph::after',
    '[data-world] .podium::before', '.theme-card__crown',
    '[data-world] .setup-panel::after', '[data-world] .setup-filterbar .pool-hint::after']) {
    assert.ok(hi.includes(sel), `${sel} still paints under prefers-contrast: more`);
  }
  assert.match(hi, /\[data-world\] \.hero[^:][^{]*\{[^}]*padding-top:\s*0/,
    'the crown is hidden but its reservation stays — an empty band above the name');
  assert.match(hi, /\[data-world\] \.podium\s*\{[^}]*padding-bottom:\s*0/,
    'the floor is hidden but its reservation stays — the pedestals stand on nothing');
  assert.match(hi, /\[data-world\] \.cover-ph \.ti\s*\{[^}]*display:\s*block/,
    'the tornado does not come back, so a coverless tile shows nothing at all');
  /* The pot's reservation is undone by zeroing the BAND, not the padding: the
     same custom property is subtracted in the pool's max-height, so a branch
     that reset `padding-bottom` would hide the art and still shorten the pool.
     Measured by writing it that way — this assertion is the only thing that
     tells the two apart. */
  assert.match(hi, /\[data-world\] \.setup-panel\s*\{[^}]*--pot-band:\s*0px/,
    'the vessel is hidden but its band is not zeroed — an empty strip under the covers');
});

test('the backdrop alpha stays inside the contrast budget for body text on the page', () => {
  /* Until #1138 this read ONE opacity off the slot rule and capped it at .1.
     The cap was standing in for the measurement below — and it stood in badly,
     because .1 is near the ceiling on a light page (dinos' is .090) and about a
     third of it on a dark one (burg's is .335). So the flat number both
     over-constrained the dark worlds and told nobody it was doing so. The slot
     now reads a per-world token and the only bar left is the real one. */
  assert.match(slotBody('[data-world] body::before'), /opacity:\s*var\(--world-backdrop-alpha\)/,
    'slot 1 must take its alpha from the per-world token, not a literal');

  // Composite the accent over the page at that alpha and measure the two inks
  // that sit straight on the page, the way test/a11y-contrast.test.js does.
  /* The inks come from test/support/theme.js, resolved FOR THE WORLD: a dark
     world (#904) replaces both, and a regex over `:root` would have measured the
     light pair over a night page — reporting ~1.05:1 for a combination the app
     never paints, i.e. failing for the wrong reason and hiding the real one. */
  // The motif is at its densest where a silhouette is fully covered, so the
  // composite IS the worst pixel; body text keeps AAA there and the muted ink
  // keeps AA.
  const failures = [];
  for (const w of WORLDS) {
    const t = tokensFor(w);
    const bg = over(t.brand, t.page, backdropAlpha(w));
    const onMotif = contrast(t.ink, bg);
    const softOnMotif = contrast(t.inkSoft, bg);
    if (onMotif < 7) failures.push(`${w.id}: --ink on the motif = ${onMotif.toFixed(2)}:1`);
    if (softOnMotif < 4.5) failures.push(`${w.id}: --ink-soft on the motif = ${softOnMotif.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], 'a motif under text must keep AAA for --ink and AA for --ink-soft');
});

test('a bottom-weighted backdrop fade never starts at zero, or the motif is absent at the top of every screen', () => {
  /* Slot 1 is `position: fixed`, so its fade does not scroll: stop 0% is the
     top of the viewport on every screen the round ever shows. A mask is
     multiplicative, so `transparent 0%` there means NO motif at the top
     whatever the alpha above says — the reported symptom on burg, and the half
     of #1138 that no alpha retune would have fixed.

     Only the worlds whose gradient RISES are in scope; forest and horror
     already start opaque and are excluded by reading the direction rather than
     by naming them, so a world that flips its gradient is covered for free. */
  const checked = [];
  const failures = [];
  for (const w of WORLDS) {
    const body = bodyOf(`[data-world="${w.id}"]`) || '';
    const m = /--world-backdrop-fade:\s*linear-gradient\(([^;]+)\);/.exec(body);
    assert.ok(m, `${w.id} declares no --world-backdrop-fade`);
    const first = m[1].split(',').find((s) => !/^\s*(to |[\d.]+deg)/.test(s)) || '';
    // A gradient that starts opaque is top-weighted; it is not this trap.
    if (/#000\s*0%/.test(first)) continue;
    checked.push(w.id);
    if (/transparent/.test(first)) { failures.push(`${w.id}: fade starts at transparent`); continue; }
    const a = /\/\s*([\d.]+)\s*\)/.exec(first);
    if (!a) { failures.push(`${w.id}: fade's first stop has no readable alpha (${first.trim()})`); continue; }
    if (Number(a[1]) < 0.2) failures.push(`${w.id}: fade starts at ${a[1]}, too faint to read at the top`);
  }
  // Anti-vacuous: the loop must have judged something. If every world were
  // top-weighted the assertion below would pass while measuring nothing.
  assert.ok(checked.length >= 3, `only ${checked.length} rising fades found — has the shape changed?`);
  assert.deepEqual(failures, [], 'a rising fade needs a non-zero floor so the motif reads at the top too');
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
  // Two hosts since #1056: the split screen's spotlight card and the result
  // screen's gold Tafel group, which took the slot over there. `slotBody`, not
  // `bodyOf`: the rule is a selector GROUP now, and an exact-text lookup reports
  // a shared rule as a DELETED one.
  const host = slotBody('[data-world] .spotlight');
  assert.ok(host, 'the spotlight host rule is missing');
  assert.ok(slotBody('[data-world] .tafel-top') || /\.tafel-top/.test(host),
    'the result screen\'s gold group is not a host for the victory scene');
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
  /* The layer's OWN rule, not the `content: ''` block it shares with its
     sibling. Since #1056 both are selector groups, so a "first rule naming this
     selector" lookup lands on the shared one — which carries no mask-position
     and reports the contract as broken. Pick by the declaration under test. */
  const ownBody = (sel) => rulesOf(CSS)
    .filter(([s2]) => s2.split('\n').map((x) => x.trim().replace(/,$/, '')).includes(sel))
    .map(([, b]) => b)
    .find((b) => /mask-position/.test(b));
  for (const pseudo of ['before', 'after']) {
    const own = ownBody(`[data-world] .spotlight::${pseudo}`);
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
  for (const sel of ['[data-world] .spotlight::before', '[data-world] .spotlight::after',
    '[data-world] .tafel-top::before', '[data-world] .tafel-top::after']) {
    assert.doesNotMatch(slotBody(sel), /animation/, `${sel} must rest — the reveal class is what animates`);
  }
  const motion = mediaBlocks().filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q)).map(([, css]) => css).join('\n');
  // Both hosts are named in one `:is()` since #1056, so the reveal is still two
  // rules — one per layer — and the assertion below checks BOTH hosts are in it
  // rather than only that two rules exist.
  const reveal = rulesOf(motion).filter(([sel]) => /^\[data-world\] :is\(\.spotlight, \.tafel-top\)\.is-reveal::(before|after)$/.test(sel));
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
   on 2026-09-08 before the fix: 7.6px of leaf over „Speichern & weiteres"
   (.toolbar.sheet__actions).

   It used to cover a second row, the vote card's (4.4px over „Zurück"), and
   this test asserted `.vote__nav` beside `.toolbar`. #1168 deleted that row —
   the rating tap advances, so the card has no primary button and its one
   remaining control is a bare corner icon — so the arm was removed from the
   selector and the assertion with it. Leaving it would have pinned a selector
   arm that can no longer match anything, which is the same vacuous green this
   file's neighbours are written against.

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

  // The one row that holds a primary button beside a neighbour today.
  assert.match(sel, /\.toolbar/);
  assert.doesNotMatch(sel, /\.vote__nav/,
    'the vote card has had no button row since #1168 — a selector arm for it matches nothing');

  // column-gap, not `gap` and not a margin — see the note above.
  assert.match(body, /column-gap:/, 'the clearance must be column-gap');
  assert.doesNotMatch(body, /margin-inline|margin-left|margin-right/,
    'a horizontal margin narrows the button when the row wraps');

  const px = parseFloat(body.match(/column-gap:\s*([\d.]+)px/)?.[1] ?? '0');
  // .8em of the largest button in these rows (22px btn--lg) is 17.6px.
  assert.ok(px >= 18, `column-gap ${px}px does not clear the 17.6px overhang`);
});
