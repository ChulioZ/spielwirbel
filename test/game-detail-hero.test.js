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
const { bodyOf, bodyOfIn, RULES, rootPx, whole, CSS: RAW_CSS } = require('./support/css');

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
  /* An arbitrary user cover over `--surface` (#ffffff on :root, never themed)
     can only DARKEN it. The binding token is `--ink-soft` (#6b6358, relative
     luminance 0.1275, 5.92:1 on white); a worst-case pure-black cover reaches
     the 4.5:1 floor at (1.05 - a) / 0.1775 = 4.5, i.e. a = 0.25. Above that the
     softest text on the band drops below AA. */
  assert.ok(Number(m[2]) <= 0.25,
    `the glow is ${m[2]}; above 0.25 a dark cover pushes --ink-soft under 4.5:1`);
});

/* The opacity bound above is only sound while the band's background is the
   LIGHTEST surface going — a wash can then only darken it, and darkening helps
   dark text. If a theme ever painted `--surface` darker, the wash would move
   text the other way and the 0.25 ceiling would be void, with nothing to say so.
   That premise is two facts, and this pins both. */
test('--surface is un-themed, which is what makes the glow bound sound', () => {
  const decls = [...RAW_CSS.matchAll(/(^|[;{\s])--surface\s*:\s*([^;}]+)/g)].map((m) => m[2].trim());
  assert.deepEqual(decls, ['#ffffff'],
    '--surface is declared exactly once, on :root, as white');

  // The other way a theme could reach it: applyBackground() writing it at runtime.
  const core = fs.readFileSync(path.join(__dirname, '..', 'public/js/core.js'), 'utf8');
  const applyBackground = core.slice(core.indexOf('function applyBackground'));
  const body = applyBackground.slice(0, applyBackground.indexOf('\n}\n') + 2);
  assert.doesNotMatch(body, /--surface/,
    'applyBackground() must not set --surface, or a round could darken the band');
});

test('the cover leads the band and the ring does not outweigh it', () => {
  const img = bodyOf('.gd-img');
  assert.ok(img, '.gd-img still has a rule of its own');
  assert.match(img, /width:\s*var\(--gd-cover-w\)/,
    'the cover sizes from the band token, so one breakpoint retunes it');

  const head = bodyOf('.gd-head');
  const w = head.match(/--gd-cover-w:\s*(\d+)px/);
  assert.ok(w, 'the band sets a desktop cover width');
  /* 240px was the thumbnail this issue was filed about; the ring is 88px, and
     the cover has to read as the larger object by a clear margin. */
  assert.ok(Number(w[1]) >= 300, `the desktop cover is ${w[1]}px, not clearly leading`);
});

/* --- The score ring's column (#901) ---------------------------------------
   #868 fixed the band's OUTER edge; the row inside it still wrapped for some
   games and not others, because `.gd-stats` was `flex: none` — i.e. as wide as
   its longest label. Route 1 is unavailable for a CSS text assertion (the sheet
   already exists), so each of the three below was seen red against a deliberate
   break (`.claude/rules/break-the-code-on-purpose.md`). */

const px = (body, prop) => {
  const m = body && body.match(new RegExp(`(^|[;{\\s])${prop}\\s*:\\s*(\\d+)px`));
  return m ? Number(m[2]) : null;
};

test('the stats column sizes from a token, not from its longest label', () => {
  const stats = bodyOf('.gd-stats');
  assert.ok(stats, '.gd-stats still has a rule of its own');
  assert.match(stats, /flex:\s*0\s+0\s+var\(--gd-stats-w\)/,
    '.gd-stats needs a fixed basis; `flex: none` is what made the row data-dependent');
  /* `flex: none` and `flex: 0 0 auto` are the same declaration spelled two ways,
     and either one reinstates the bug while still looking like a sized column. */
  assert.doesNotMatch(stats, /flex:\s*(none|0\s+0\s+auto)/,
    '.gd-stats must not be content-sized');
});

test('the stats column fits the row it shares with the cover and the title block', () => {
  const head = bodyOf('.gd-head');
  const info = bodyOf('.gd-info');
  assert.ok(head && info, 'both halves of the hero row still have rules');

  /* Every term is read from the sheet rather than pinned as a literal, so this
     also catches a retune of the cover, the gap, the padding, the .gd-info
     floor or --w-read — any of which eats the same headroom this column needs.
     Above 1280px `.app > *:not(.rail):not(.dock)` caps the band at --w-read. */
  const inner = rootPx('--w-read') - 2 * px(head, 'padding');
  const infoFloor = Number(info.match(/flex:\s*1\s+1\s+(\d+)px/)[1]);
  const headroom = inner - px(head, '--gd-cover-w') - 2 * px(head, 'gap') - infoFloor;

  const statsW = px(head, '--gd-stats-w');
  assert.ok(statsW, '.gd-head declares --gd-stats-w as a px value');
  assert.ok(statsW <= headroom,
    `--gd-stats-w is ${statsW}px but only ${headroom}px is left on the row — the ring wraps`);
  /* The ring is a fixed 88px box, so a column narrower than that clips it. */
  const ring = px(bodyOf('.gd-ring'), 'width');
  assert.ok(statsW >= ring, `--gd-stats-w is ${statsW}px, narrower than the ${ring}px ring`);
});

test('the stats column wraps its labels instead of clipping them', () => {
  /* A fixed width only works because the labels reflow inside it. Truncating
     them instead would keep the row from wrapping while losing the text —
     the same screen, broken a quieter way. */
  const cls = ['.gd-stats', '.score-label', '.score-why', '.sort-flag'];
  for (const [sel, body] of RULES) {
    if (!cls.some((c) => sel.split(',').some((s_) => whole(c).test(s_.trim())))) continue;
    assert.doesNotMatch(body, /white-space:\s*nowrap/, `${sel} must not stop the labels wrapping`);
    assert.doesNotMatch(body, /text-overflow:\s*ellipsis/, `${sel} must not truncate the labels`);
  }
});
