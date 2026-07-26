'use strict';

/*
 * Landing-page product screenshots (issue #438).
 *
 * The hero and the how-it-works section render committed static images. Nothing
 * else in the suite would notice if one of them broke, and both failure modes are
 * silent in exactly the way link-preview.test.js describes for og-image.png:
 *
 *  1. A renamed or missing file yields a blank hero with no server-side error —
 *     the visitor sees an empty box on the page that decides whether they stay.
 *  2. A regenerated asset whose real pixel size no longer matches the declared
 *     width/height reintroduces layout shift above the fold, which is precisely
 *     what those attributes exist to prevent. So the dimensions are read back out
 *     of the files rather than trusted.
 *
 * The weight cap is the third half of the issue's constraint ("budget it like a
 * cover"): it stops a future regeneration from quietly dropping a multi-megabyte
 * PNG into the hero.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

const { app } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'public/js/views-landing.js'), 'utf8');

// Total committed weight of the landing imagery. Generous next to today's ~120 KB
// so an honest re-crop never trips it, small enough that a full-resolution
// screenshot does.
const WEIGHT_BUDGET = 400 * 1024;

// The LANDING_SHOTS table, read out of the view rather than restated here — a
// test constant hand-copied from the thing under test proves nothing
// (.claude/rules/shared-constants-across-the-stack.md).
function declaredShots() {
  const table = VIEW.match(/const LANDING_SHOTS = \{([\s\S]*?)\n\};/);
  assert.ok(table, 'views-landing.js still declares a LANDING_SHOTS table');
  const shots = [...table[1].matchAll(
    /(\w+):\s*\{\s*src:\s*'([^']+)',\s*w:\s*(\d+),\s*h:\s*(\d+)\s*\}/g
  )].map(([, name, src, w, h]) => ({ name, src, w: Number(w), h: Number(h) }));
  assert.ok(shots.length >= 3, 'every LANDING_SHOTS entry parsed');
  return shots;
}

// Minimal WebP dimension reader — enough for the chunk types Chrome's encoder
// emits, and it refuses anything else rather than guessing.
// RIFF....WEBP<fourcc>, then per-format bit packing.
function webpSize(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF', 'is a RIFF container');
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP', 'is a WebP file');
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') {
    // Extended format (what Chrome's screenshot encoder writes): the canvas size
    // lives in the VP8X header itself as two 24-bit LE values, each minus one.
    return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
  }
  if (fourcc === 'VP8 ') {
    // Lossy: 3-byte start code at 23..25, then 14-bit width and height.
    return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    // Lossless: 1-byte signature, then 14-bit width-1 and height-1, bit-packed.
    const bits = buf.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`unsupported WebP chunk ${fourcc}`);
}

test('every landing screenshot the view references is actually served', async () => {
  for (const shot of declaredShots()) {
    const res = await request(app).get(shot.src);
    assert.equal(res.status, 200, `${shot.src} is served`);
    assert.match(res.headers['content-type'], /^image\//, `${shot.src} is served as an image`);
  }
});

test('the declared width/height match the real pixels, so the hero reserves its box', () => {
  for (const shot of declaredShots()) {
    const buf = fs.readFileSync(path.join(ROOT, 'public', shot.src));
    const real = webpSize(buf);
    assert.deepEqual(
      { w: real.w, h: real.h },
      { w: shot.w, h: shot.h },
      `${shot.src} is ${real.w}x${real.h} but the view declares ${shot.w}x${shot.h}`
    );
  }
});

test('the landing imagery stays inside its weight budget', () => {
  const shots = declaredShots();
  const bytes = shots.reduce(
    (sum, s) => sum + fs.statSync(path.join(ROOT, 'public', s.src)).size,
    0
  );
  assert.ok(
    bytes <= WEIGHT_BUDGET,
    `landing screenshots total ${(bytes / 1024).toFixed(0)} KB, budget is ${WEIGHT_BUDGET / 1024} KB`
  );
});

test('the <picture> breakpoint and the stylesheet agree on 720px', () => {
  const bp = VIEW.match(/const LANDING_SHOT_BP = '\(min-width: (\d+)px\)'/);
  assert.ok(bp, 'views-landing.js declares LANDING_SHOT_BP');
  // Comments stripped first: a selector regex otherwise matches inside prose
  // that merely mentions the class (.claude/rules/css-text-assertions-strip-comments.md).
  const css = fs
    .readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // The rule that un-caps the hero shot must fire at exactly the width at which
  // <picture> swaps in the desktop screenshot. If they drift, the wide shot
  // renders inside the 300px phone cap (or the phone shot stretches full-width).
  const rule = new RegExp(
    `@media \\(min-width: ${bp[1]}px\\)\\s*\\{[^}]*\\.landing-hero__visual \\.landing-shot`
  );
  assert.match(css, rule, `styles.css un-caps the hero shot at ${bp[1]}px`);

  // …and every narrow landing block must stop one pixel BELOW it. A block left
  // at `max-width: 720px` overlaps the wide branch by exactly 1px, so at a
  // viewport of exactly 720 the hero renders the desktop screenshot — un-capped
  // by the wide block — on the phone's tighter vertical rhythm. Same adjacency
  // rule as the dock clearance (.claude/rules/responsive-hub-tabs.md §2), and
  // just as invisible.
  const wide = Number(bp[1]);
  let checked = 0;
  for (const m of css.matchAll(/@media \(max-width: (\d+)px\)\s*\{/g)) {
    // Inner rules are indented, so a newline followed by an unindented `}` is
    // the @media block's own close.
    const body = css.slice(m.index + m[0].length, css.indexOf('\n}', m.index));
    if (!/\.landing[\w-]*\s*\{|\.landing[\w-]*\s+\./.test(body)) continue;
    checked++;
    assert.equal(
      Number(m[1]), wide - 1,
      `a landing @media (max-width: ${m[1]}px) block must end at ${wide - 1}px to tile with ${wide}px`
    );
  }
  // Without this the loop passes vacuously the moment the stylesheet's
  // formatting changes enough that the slice above stops matching — the exact
  // silent-green failure .claude/rules/css-text-assertions-strip-comments.md
  // describes, in a test whose whole job is catching an invisible 1px straddle.
  assert.ok(checked > 0, 'found at least one narrow landing @media block to check');
});

test('the screenshots are informative images, not decoration', () => {
  // Both carry localized alt text and neither is aria-hidden — the pre-#438 hero
  // was aria-hidden decoration, which is the wrong answer once the image is the
  // thing explaining the product.
  assert.match(VIEW, /alt="\$\{esc\(t\('landing\.shot\.shelfAlt'\)\)\}"/);
  assert.match(VIEW, /alt="\$\{esc\(t\('landing\.shot\.voteAlt'\)\)\}"/);
  assert.doesNotMatch(VIEW, /landing-hero__visual"[^>]*aria-hidden/);
});
