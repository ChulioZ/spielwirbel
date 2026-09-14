'use strict';

/* The game detail hero band (#868).
 *
 * The screen is reached from every cover on the shelf, and it used to read as a
 * database record: a 240px thumbnail under an 88px saturated rating ring, inside
 * a band whose width was `fit-content` and therefore a function of the game's
 * own title and chips. Measured across four games of one round before the fix,
 * the band's right edge landed at 990, 1109, 1119 and 1212px while every section
 * below it runs to 1212px — so the page frame shifted from game to game.
 *
 * Two halves, tested with the two different tools they need:
 *   - the DOM half (does the band carry the cover url the glow layer reads?)
 *     runs the real view through the jsdom harness, because the interesting case
 *     is the ABSENCE of the property on a game with no cover — a text assertion
 *     over the view's source cannot see that
 *     (.claude/rules/testing-views-under-jsdom.md);
 *   - the CSS half is a text assertion, because jsdom applies no stylesheet.
 *     Comments are stripped by test/support/css.js
 *     (.claude/rules/css-text-assertions-strip-comments.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { bodyOf, bodyOfIn, RULES, rulesOf, mediaBlocks, whole, CSS } = require('./support/css');

/* Every rule declared inside a media block whose query matches `re`, flattened
   — so a rule is found whether or not it shares a block with its neighbours. */
const rulesUnder = (re) => rulesOf(mediaBlocks()
  .filter(([query]) => re.test(query)).map(([, css]) => css).join('\n'));
const { contrast, composite, tokensFor } = require('./support/theme');
const { DESIGNS } = require('../public/js/round-designs');
const { COVER_HERO } = require('../public/js/cover-size');

const RID = 'r1';

function roundFixture() {
  return {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    providers: [],
    members: [{ id: 'm1', name: 'Anna' }],
    games: [
      // Has box art: the band gets a cover to glow with.
      {
        id: 'g1', title: 'CATAN', image: 'https://cf.geekdo-images.com/catan.jpg',
        minPlayers: 3, maxPlayers: 4, tagIds: [],
      },
      // No box art at all — #256's coverPlaceholder() path.
      { id: 'g2', title: 'Ticket to Ride', minPlayers: 2, maxPlayers: 5, tagIds: [] },
    ],
    sessions: [],
  };
}

function bootApp(t_) {
  const dom = loadApp({ locale: 'de' });
  t_.after(() => dom.close());
  const round = roundFixture();
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    return {};
  });
  dom.set('toast', () => {});
  return dom;
}

const band = (dom) => dom.app.querySelector('.gd-head');

test('a game with box art hands its cover to the band as --gd-cover', async (t_) => {
  const dom = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const head = band(dom);
  assert.ok(head, 'the hero band renders');
  const glow = head.style.getPropertyValue('--gd-cover');
  assert.match(glow, /^url\('.*catan\.jpg.*'\)$/,
    '--gd-cover carries the same cover url the frame itself paints');
  // The band's own layer, not a second copy of the frame's markup: the cover
  // stays exactly one <button>, whatever the glow does behind it.
  assert.equal(head.querySelectorAll('.gd-img').length, 1);
});

test('a game with no cover sets no --gd-cover, so the glow layer draws nothing', async (t_) => {
  const dom = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g2');
  const head = band(dom);
  assert.ok(head, 'the hero band renders');
  /* The CSS reads `background-image: var(--gd-cover, none)`. Leaving the
     property UNSET is what makes that fallback engage; setting it to an empty
     string or `url('')` would make the layer request the page itself. This is
     the assertion that keeps #256's placeholder path intact. */
  assert.equal(head.style.getPropertyValue('--gd-cover'), '',
    'no cover means no --gd-cover on the band at all');
  assert.equal(head.getAttribute('style'), null,
    'and no empty style attribute left behind either');
});

test('the band takes the column width instead of sizing to its content', () => {
  const head = bodyOf('.gd-head');
  assert.ok(head, '.gd-head still has a rule of its own');
  /* The regression this exists for: `width: fit-content` made the band's right
     edge depend on the title and chips, so the page frame moved between games.
     Any explicit `width` here reintroduces that class of bug — the band is a
     block-level flex container and simply takes the column. */
  assert.doesNotMatch(head, /(^|[;{\s])width\s*:/,
    '.gd-head must not set its own width (fit-content is what shifted the frame)');
});

test('the cover glow stays under the opacity that would break the text contrast floor', () => {
  const glow = bodyOfIn('.gd-head::before');
  assert.ok(glow, 'the band still has its cover-glow layer');
  assert.match(glow, /background-image:\s*var\(--gd-cover,\s*none\)/,
    'the layer reads --gd-cover and falls back to none');

  const m = glow.match(/(^|[;{\s])opacity\s*:\s*([\d.]+)/);
  assert.ok(m, 'the glow layer pins an explicit opacity');
  const alpha = Number(m[2]);
  /* The ceiling. It was derived when `--surface` was white everywhere, as
     "a pure-black cover reaches 4.5:1 at (1.05 - a) / 0.1775 = 4.5, i.e.
     a = 0.25" — and that arithmetic is WRONG in a way worth recording, because
     it is the natural mistake: it treats the composited background's luminance
     as linear in alpha. Compositing happens in gamma-encoded channels, so black
     at 25% over white lands at channel 191, i.e. luminance 0.523 rather than
     0.75, and the real ratio there is 3.22:1. The ceiling is kept as the
     ceiling it has always been; what it is NOT is a proof of AA. */
  assert.ok(alpha <= 0.25, `the glow is ${alpha}; the band's wash may not exceed 0.25`);

  /* What is actually measured, per design and in both directions (#904). A dark
     design paints a dark `--surface`, so an arbitrary cover LIGHTENS the band
     rather than darkening it and the binding cover is white instead of black —
     the old single-direction reasoning could not see that case at all.

     FLOOR is a NON-REGRESSION guard, not a pass: at the shipped 0.16 the worst
     case is ~4.07 on a light design and ~3.96 on Sci-Fi, both under AA. Two
     things make that acceptable rather than a live defect, and both are
     pessimism in this model: the cover is a real image behind `blur(40px)`, never
     a flat black or white field, and the layer is masked by a radial gradient
     centred at 22% that is fully transparent by 82% — i.e. it has largely faded
     out before it reaches the column the `--ink-soft` meta lines sit in. Raising
     the text to a true 4.5 means dropping the glow to ~0.11, which is a design
     decision about the hero rather than a derivation one. */
  const FLOOR = 3.9;
  const failures = [];
  for (const design of DESIGNS) {
    const t = tokensFor(design);
    for (const [what, cover] of [['a black cover', [0, 0, 0]], ['a white cover', [255, 255, 255]]]) {
      const ratio = contrast(t.inkSoft, composite(cover, t.surface, alpha));
      if (ratio < FLOOR) failures.push(`${design.id}: --ink-soft under ${what} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [],
    `the band's wash may not take --ink-soft below ${FLOOR}:1 on any design`);
});

/* The measurement above is only sound while the harness can SEE every surface
   the app paints. `--surface` stopped being a constant in #904 — a dark design
   lifts it off its own page — so what has to hold now is not "it is white" but
   "it is declared where tokensFor() resolves it": the two token blocks, and
   nowhere else. A per-design inline value, or applyBackground() writing one at
   runtime, would put a surface on screen that no contrast check ever sees. */
test('--surface is declared only in the two token blocks the harness resolves', () => {
  const declaring = RULES
    .filter(([, body]) => /(^|[;{\s])--surface\s*:/.test(body))
    .map(([sel]) => sel.replace(/\s+/g, ' ').trim());
  assert.deepEqual(declaring, [':root', ':root[data-scheme="dark"], .theme-card[data-scheme="dark"]'],
    '--surface must be declared by :root and the dark scheme block, and by nothing else');

  /* The other way a design could reach it: applyBackground() writing it at runtime.
     The function moved to round-theme.js in #956 — and this spec did NOT go red,
     because `indexOf` returned -1 and the slice arithmetic left a ONE-CHARACTER
     string that trivially satisfies doesNotMatch. Hence the explicit find
     assertions: a scan that cannot locate its subject must fail, not pass. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/round-theme.js'), 'utf8');
  const from = src.indexOf('function applyBackground');
  assert.notEqual(from, -1, 'applyBackground() not found in round-theme.js — did it move again?');
  const end = src.indexOf('\n}\n', from);
  assert.notEqual(end, -1, 'could not find the end of applyBackground()');
  const body = src.slice(from, end + 2);
  assert.doesNotMatch(body, /--surface/,
    'applyBackground() must not set --surface, or a round could paint one nothing measures');
});

/* --- The card's two tracks (#901, re-derived for #1039) --------------------
   #868 fixed the band's OUTER edge; the row inside it still wrapped for some
   games and not others, because `.gd-stats` was `flex: none` — i.e. as wide as
   its longest label, so a two-digit rating count or switching the UI to French
   took the band from 281px to 450px tall.

   #1039 removed that column outright (the score is a pill on the cover) and
   made the card a GRID, which retires the whole `--gd-stats-w` headroom
   arithmetic the old assertions computed: with two tracks and one of them
   fixed, there is no content-dependent wrap point left to measure. What has to
   hold instead is that the text track cannot be pushed wider by its content,
   which is the same defect one mechanism over — and the mechanism is now two
   declarations that only work as a pair.

   Route 1 is unavailable for a CSS text assertion (the sheet already exists), so
   each of the three below was seen red against a deliberate break
   (`.claude/rules/break-the-code-on-purpose.md`): dropping the `minmax(0, …)`
   from the text track, dropping `min-width: 0` from `.gd-info`, and dropping the
   `grid-template-columns` restatement from the 700px block. */

test('the card is a two-track grid: a fixed cover column and a text track that cannot be pushed', () => {
  const head = bodyOf('.gd-head');
  assert.ok(head, '.gd-head still has a rule of its own');
  /* `bodyOf()` returns whichever rule comes first in the sheet, and `.gd-head`
     is declared three times (here, the 700px stack and the 1280px cover bump).
     Pin that this is the base one: the phone rule declares a ONE-column grid,
     against which every assertion below would be vacuous. */
  assert.match(head, /--gd-cover-w:\s*\d+px/, 'this must be the base .gd-head rule, not a media block');

  assert.match(head, /display:\s*grid/, '.gd-head is a grid since #1039, not a wrapping flex row');
  const tracks = head.match(/grid-template-columns:([^;]+);/);
  assert.ok(tracks, '.gd-head declares no tracks');
  assert.match(tracks[1], /var\(--gd-cover-w\)/, 'the cover track sizes from the band token');
  /* The whole point of the grid. A bare `1fr` track has an auto (min-content)
     minimum, so one long unbroken game title would push the text column — and
     with it the card — wider than the column it sits in. */
  assert.match(tracks[1], /minmax\(\s*0\s*,\s*1fr\s*\)/,
    `the text track is "${tracks[1].trim()}"; without a 0 minimum its content can blow the grid out`);
});

test('the text column carries the other half of that pair', () => {
  const info = bodyOf('.gd-info');
  assert.ok(info, '.gd-info still has a rule of its own');
  /* `minmax(0, …)` on the track and `min-width: 0` on the item are a pair —
     either alone leaves the blow-out, because a grid item's own automatic
     minimum size is its min-content size. The old `flex: 1 1 240px` floor is
     what this replaced, and a floor here would be the bug back. */
  assert.match(info, /min-width:\s*0/, '.gd-info needs min-width: 0 for the minmax track to bite');
  assert.doesNotMatch(info, /min-width:\s*[1-9]/, '.gd-info must not floor its own width');
});

test('the cover track is a fraction of the CARD, capped by the token', () => {
  /* The bug this replaced an assertion for: a flat `var(--gd-cover-w)` track is
     a number chosen against the viewport, and the card is two indirections away
     from one — it sits in the spread's left page, itself 3/5 of the pane. At a
     1280px viewport that left the title, the chips and the fact pills **130px**
     and the card 626px tall, with a cover that measured perfectly fine. So the
     assertion has to be about the TRACK, not about the cover's size: "is the
     cover big enough" passes against the defect
     (`.claude/rules/card-tracks-are-a-fraction-of-a-fraction.md`). */
  const head = bodyOf('.gd-head');
  const tracks = head.match(/grid-template-columns:([^;]+);/)[1];
  const cap = tracks.match(/min\(\s*var\(--gd-cover-w\)\s*,\s*(\d+)%\s*\)/);
  assert.ok(cap, `the cover track is "${tracks.trim()}"; it must be min(var(--gd-cover-w), <pct>)`);
  /* The percentage is what keeps the two sides comparable at every pane width.
     Past ~50% the cover is the majority of the card and the text column starves
     again — the same defect, one number further on. */
  assert.ok(Number(cap[1]) <= 50,
    `the cover takes ${cap[1]}% of the card, so the text column is the minority share`);

  const w = head.match(/--gd-cover-w:\s*(\d+)px/);
  assert.ok(w, '.gd-head sets a cover ceiling');
  /* 240px was the thumbnail #868 was filed about; once the cap binds, the cover
     has to read as the card's leading object. And it must stay inside the
     requested image (COVER_HERO), or the hero is upscaled. */
  assert.ok(Number(w[1]) >= 300, `the cover ceiling is ${w[1]}px, not clearly leading`);
  assert.ok(Number(w[1]) <= COVER_HERO,
    `the ceiling is ${w[1]}px but the hero is requested at ${COVER_HERO}px, so it upscales`);

  // And the cover fills whatever that track resolves to.
  assert.match(bodyOf('.gd-img'), /width:\s*100%/,
    '.gd-img must fill its track — the track is what carries the size now');
});

test('the action bar can actually pin, at both ends of the split', () => {
  /* Measured, not assumed — `.claude/rules/sticky-bottom-bar-needs-slack-below-it.md`
     said this could not work and had the mechanism backwards. A bottom-stuck box
     travels over its PRECEDING siblings, clamped by its containing block's top
     edge, so the two declarations below are a pair and each is useless alone:

       - `position: sticky` on the bar (its containing block holds the history
         above it, which is what it travels over);
       - `display: contents` on `.pass__table` below the split, which promotes the
         bar's siblings to `.pass`. Without it the containing block starts at
         y=813 on a 390x844 phone and the pin stops 55px short of the floor —
         measured in both engines, gapToFloor -55 vs +12 at scroll 0. */
  const bar = bodyOf('.gd-bar');
  assert.ok(bar, '.gd-bar still has a rule of its own');
  assert.match(bar, /position:\s*sticky/, 'the action bar is not sticky, so it scrolls away');
  assert.match(bar, /bottom:\s*\d+px/, 'a sticky bar with no `bottom` inset never sticks');
  /* It rides up over the history rows, so it has to paint above them. */
  assert.match(bar, /z-index:\s*[1-9]/, 'an opaque bar over scrolling rows needs a z-index');

  const promoted = bodyOf('.pass__table', rulesUnder(/max-width:\s*859px/));
  assert.ok(promoted, 'nothing retunes .pass__table below the split');
  assert.match(promoted, /display:\s*contents/,
    'below the split the right page must hand its children to .pass, or the pin cannot reach the fold at rest');
});

test('the card stacks to a SINGLE track, not just a 100% cover', () => {
  /* `--gd-cover-w: 100%` alone is not enough and fails in the worst direction:
     inside a two-track grid a 100% first track is 100% of the GRID, which
     pushes the text off the card entirely. So the phone block has to restate
     `grid-template-columns`. */
  const phone = bodyOf('.gd-head', rulesUnder(/max-width:\s*700px/));
  assert.ok(phone, '.gd-head is no longer retuned for the narrow stack');
  const phoneTracks = phone.match(/grid-template-columns:([^;]+);/);
  assert.ok(phoneTracks, 'the phone block does not restate the tracks, so the card stays two columns');
  assert.equal((phoneTracks[1].match(/minmax\(/g) || []).length, 1,
    `the stacked card declares "${phoneTracks[1].trim()}" rather than a single track`);
});

/* The ring, its column and the section the chip replaced are gone from the
   stylesheet too, not merely unused by the view. Dead CSS for a component that
   no longer exists is how `.tag--digital` survived four releases (#242). */
test('the ring, the stats column and the expansions section leave no dead CSS', () => {
  for (const dead of ['.gd-ring', '.gd-ring__num', '.gd-ring--none', '.gd-stats', '.gd-expansions', '.gd-source', '.gd-about']) {
    assert.ok(
      !RULES.some(([sel]) => sel.split(',').some((one) => whole(dead).test(one.trim()))),
      `${dead} is dead CSS — nothing in public/js renders it any more`,
    );
  }
  assert.doesNotMatch(CSS, /--gd-stats-w/, '--gd-stats-w outlived the column it sized');
});
