'use strict';

/* One cover fill for every design (#1504). The three big cover frames
   (.game-card__img, .gd-img, .vote__img) are filled by ONE rule in styles.css
   (#181): a blurred, zoomed ::before and a `contain` ::after, both inheriting the
   frame's inline background-image. A design may reshape the frame — size, ratio,
   radius, border — but never what fills it: Programmheft removing the ::before
   let the frame's raw, tiled inline image paint around the cover, and Ocean's
   crop made a third fill algorithm for one job.

   The scan is over SELECTORS, comments stripped
   (.claude/rules/css-text-assertions-strip-comments.md), and it accepts the
   shapes a stylesheet can spell a frame pseudo in: a direct compound
   (`.x .game-card__img::before`), with more on the compound
   (`.game-card__img:hover::after`), the legacy single colon, and an `:is()`
   group (`:is(.gd-img, .vote__img)::before`) — see
   .claude/rules/source-scanning-guards-enumerate-shapes.md. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, CSS, rulesOf, bodyOfIn } = require('./support/css');

const FRAMES = ['game-card__img', 'gd-img', 'vote__img'];
const DESIGN_DIR = path.join(ROOT, 'public', 'css', 'designs');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// A frame class (not a longer BEM name like gd-img__edit) whose OWN compound
// ends in ::before/::after — a descendant's pseudo is not a fill.
const FRAME = `\\.(?:${FRAMES.join('|')})(?![\\w-])`;
const DIRECT = new RegExp(`${FRAME}[^\\s,>+~{()]*::?(?:before|after)\\b`);
const IS_GROUP = new RegExp(`:(?:is|where)\\([^()]*${FRAME}[^()]*\\)[^\\s,>+~{]*::?(?:before|after)\\b`);
const touchesFill = (selector) => DIRECT.test(selector) || IS_GROUP.test(selector);

test('the matcher sees every shape a frame pseudo can be written in, and nothing else', () => {
  for (const sel of [
    ':root[data-design="ocean"] .game-card__img::before',
    ':root[data-design="programmheft"] .ph-pass .gd-img::after',
    '.vote--bruecke .vote__img:hover::after',
    '.gd-img:before',
    ':root[data-design="x"] :is(.gd-img, .vote__img)::before',
  ]) assert.ok(touchesFill(sel), `missed: ${sel}`);
  for (const sel of [
    '.gd-img__edit::before',
    '.game-card__img .game-card__pick::after',
    '.game-card__img',
    '.ph-card .game-card__img > span::before',
  ]) assert.ok(!touchesFill(sel), `false hit: ${sel}`);
});

test('no design stylesheet styles the ::before/::after of a big cover frame', () => {
  const files = fs.readdirSync(DESIGN_DIR).filter((f) => f.endsWith('.css'));
  assert.ok(files.length >= 4, `expected the design stylesheets, found ${files.length}`);
  const hits = [];
  let scanned = 0;
  for (const file of files) {
    for (const [sel] of rulesOf(strip(fs.readFileSync(path.join(DESIGN_DIR, file), 'utf8')))) {
      scanned++;
      for (const member of sel.split(/,(?![^()]*\))/)) {
        if (touchesFill(member.trim())) hits.push(`${file}: ${member.trim()}`);
      }
    }
  }
  assert.ok(scanned > 500, `only ${scanned} rules scanned — is the parser seeing the files?`);
  assert.deepEqual(hits, [], 'the cover fill is the shared #181 rule — reshape the frame, not its fill');
});

// The only frame pseudos styles.css may declare: the shared fill itself, and the
// bulk-select pick's inset ring (#1358), which is design-agnostic and not a fill.
const ALLOWED_IN_STYLES = new Set([
  '.game-card__img::before', '.gd-img::before', '.vote__img::before',
  '.game-card__img::after', '.gd-img::after', '.vote__img::after',
  '.is-selecting .game-card.is-picked .game-card__img::after',
]);

test('styles.css declares the frame pseudos only in the shared fill (and the pick ring)', () => {
  const extra = rulesOf(CSS)
    .flatMap(([sel]) => sel.split(/,(?![^()]*\))/).map((s) => s.trim()))
    .filter((s) => touchesFill(s) && !ALLOWED_IN_STYLES.has(s));
  assert.deepEqual(extra, []);
});

test('the shared fill is the whole cover on a blurred, zoomed copy of itself, for all three frames', () => {
  for (const frame of FRAMES) {
    const before = bodyOfIn(`.${frame}::before`);
    const after = bodyOfIn(`.${frame}::after`);
    assert.ok(before && after, `.${frame} lost its shared fill`);
    assert.match(before, /background-image:\s*inherit/);
    assert.match(before, /background-size:\s*cover/);
    assert.match(before, /filter:\s*blur\(/);
    assert.match(before, /transform:\s*scale\(/);
    assert.match(after, /background-image:\s*inherit/);
    assert.match(after, /background-size:\s*contain/);
    assert.match(after, /background-repeat:\s*no-repeat/);
  }
});
