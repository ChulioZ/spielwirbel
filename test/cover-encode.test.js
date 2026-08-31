'use strict';

/*
 * lib/cover.js — the re-encode that makes an uploaded game cover cheap and safe
 * to store (#867). The sibling of test/avatar.test.js, and it asserts the same
 * privacy property for the same reason: the only bytes-upload path for a cover
 * is a clipboard paste, which in practice is a phone photo of a real box on a
 * real table, so the EXIF a phone writes carries someone's home coordinates.
 *
 * NAMED -encode, not test/cover.test.js: that name was already taken by the
 * specs for `public/js/cover.js`, the unrelated placeholder renderer. This repo
 * has several lib/ and public/js/ modules sharing a basename (avatar, cover,
 * tag-icons), so a spec named after the module alone is ambiguous — see
 * .claude/rules/test-file-names-collide-silently.md.
 *
 * What differs from the avatar specs is the SHAPE assertion. An avatar has one
 * known size; a cover only has a ceiling, and it must keep its aspect ratio
 * (covers render whole against a blurred backdrop of themselves, #181) and must
 * not be upscaled.
 */

const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');

const { renderCover, inspectCover, coverIsCurrent } = require('../lib/cover');
const { COVER_MAX_DIM, COVER_MAX_PIXELS } = require('../public/js/cover-policy');

const solid = (width, height, opts = {}) =>
  sharp({ create: { width, height, channels: opts.channels || 3, background: opts.bg || '#c2410c' } });

async function photoWithGps() {
  return solid(1600, 900)
    .withExif({
      IFD0: { Make: 'TestCam' },
      GPS: {
        GPSLatitudeRef: 'N', GPSLatitude: '52/1 31/1 0/1',
        GPSLongitudeRef: 'E', GPSLongitude: '13/1 24/1 0/1',
      },
    })
    .jpeg()
    .toBuffer();
}

test('the fixture really carries the metadata this file is about', async () => {
  // The anti-vacuous half, as in test/avatar.test.js: stripping metadata from
  // an image that never had any would prove nothing, so a sharp version that
  // quietly stopped WRITING exif must fail here rather than silently passing
  // every assertion below.
  const meta = await sharp(await photoWithGps()).metadata();
  assert.ok(meta.exif, 'fixture has an EXIF block');
  assert.ok(meta.exif.includes(Buffer.from('TestCam')), 'fixture EXIF carries the maker note');
});

test('re-encoding strips EXIF and GPS', async () => {
  const out = await renderCover(await photoWithGps());
  const meta = await sharp(out).metadata();

  assert.equal(meta.exif, undefined, 'no EXIF block survives the round trip');
  assert.equal(out.includes(Buffer.from('TestCam')), false,
    'no maker note anywhere in the stored bytes');
});

test('an oversize cover is fitted INSIDE the ceiling, keeping its aspect ratio', async () => {
  // Landscape and portrait, both past the ceiling on one edge only. `inside`
  // (not `cover`) is what makes the second number shrink proportionally instead
  // of being cropped to a square — cropping would be a visible regression on
  // every shelf, so a ratio assertion is the point of this test, not the
  // dimensions alone.
  for (const [w, h] of [[2400, 1600], [1200, 3000]]) {
    const out = await renderCover(await solid(w, h).png().toBuffer());
    const meta = await sharp(out).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(Math.max(meta.width, meta.height), COVER_MAX_DIM,
      `the long edge of ${w}x${h} lands exactly on the ceiling`);
    assert.ok(Math.abs((meta.width / meta.height) - (w / h)) < 0.01,
      `${w}x${h} kept its aspect ratio (got ${meta.width}x${meta.height})`);
  }
});

test('a cover already inside the ceiling is NOT upscaled', async () => {
  // The half that separates a ceiling from the avatar's one known size. Without
  // withoutEnlargement a 300x200 paste would be blown up to 1024 on its long
  // edge — more bytes, not one more pixel of detail.
  const meta = await sharp(await renderCover(await solid(300, 200).png().toBuffer())).metadata();
  assert.equal(meta.width, 300);
  assert.equal(meta.height, 200);
});

test('a transparent PNG keeps its alpha', async () => {
  // WebP carries alpha; a format that did not would silently paint a black or
  // white box behind every cover with a cut-out.
  const src = await solid(400, 300, { channels: 4, bg: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  const meta = await sharp(await renderCover(src)).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.hasAlpha, true);
});

test('an animated GIF is flattened to a still, never stored as an animation', async () => {
  // `pageHeight` must sit INSIDE the `raw` options — beside them it is silently
  // ignored and the fixture is a tall STILL, i.e. one that proves nothing while
  // looking right. Hence the pages===3 assertion on the fixture first.
  const W = 60, H = 60, N = 3;
  const frames = Buffer.concat([0, 1, 2].map((i) => Buffer.alloc(W * H * 3, 40 + i * 80)));
  const animated = await sharp(frames, { raw: { width: W, height: H * N, channels: 3, pageHeight: H } })
    .gif({ loop: 0 })
    .toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, N,
    'the fixture really is an animation');

  const meta = await sharp(await renderCover(animated), { animated: true }).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.pages || 1, 1, 'the stored object holds exactly one frame');
  assert.equal(meta.height, H, 'the first frame, not a filmstrip of stacked frames');
});

test('a polyglot loses its trailing payload', async () => {
  // A real PNG with a script appended: it sniffs as an image and it decodes as
  // one, so only the RE-ENCODE removes the passenger.
  const payload = Buffer.from('<?php system($_GET[0]); ?>');
  const src = Buffer.concat([await solid(200, 200).png().toBuffer(), payload]);
  assert.ok(src.includes(payload), 'fixture: the payload is really in the input');

  const out = await renderCover(src);
  assert.ok(out, 'the polyglot still decodes as an image, as the attack requires');
  assert.equal(out.includes(payload), false, 'the payload is gone from the stored bytes');
});

test('content that does not decode as an image answers null rather than throwing', async () => {
  // The route turns null into a 400. Throwing would reach the error handler and
  // answer 500 — an operator alert for a user pasting the wrong thing.
  assert.equal(await renderCover(Buffer.from('<?php echo 1; ?>')), null);
  assert.equal(await renderCover(Buffer.alloc(0)), null);
  assert.equal(await renderCover(null), null);
  assert.equal(await renderCover('not a buffer'), null);
});

test('a decompression bomb is refused, not expanded', async () => {
  // 12000x12000 = 144 MP, well past COVER_MAX_PIXELS and only ~90 KB on the
  // wire — it sails through the multer byte cap, which is the whole reason a
  // separate pixel ceiling exists.
  const bomb = await solid(12000, 12000, { bg: '#fff' }).png({ compressionLevel: 9 }).toBuffer();
  assert.ok(bomb.length < 5 * 1024 * 1024, 'the bomb is under the byte cap, as the attack requires');
  assert.ok(12000 * 12000 > COVER_MAX_PIXELS, 'fixture: the bomb really is over the pixel ceiling');
  assert.equal(await renderCover(bomb), null);
});

/* ---------------- the backfill's "is this one already done?" ---------------- */

test('inspectCover reports the stored shape, or null for a non-image', async () => {
  const meta = await inspectCover(await solid(640, 480).jpeg().toBuffer());
  assert.deepEqual(meta, { format: 'jpeg', width: 640, height: 480 });
  assert.equal(await inspectCover(Buffer.from('nope')), null);
  assert.equal(await inspectCover(null), null);
});

test('coverIsCurrent is true only for an object renderCover would leave alone', async () => {
  // This predicate is what makes the admin backfill idempotent: a wrong `true`
  // leaves an oversized cover in the bucket forever, and a wrong `false` costs
  // a generation of lossy re-encoding on every press.
  assert.equal(coverIsCurrent({ format: 'webp', width: COVER_MAX_DIM, height: 400 }), true);
  assert.equal(coverIsCurrent({ format: 'webp', width: COVER_MAX_DIM + 1, height: 400 }), false,
    'one pixel over the ceiling still needs converting');
  assert.equal(coverIsCurrent({ format: 'jpeg', width: 100, height: 100 }), false,
    'a small JPEG is inside the ceiling but is not our format');
  assert.equal(coverIsCurrent(null), false);
});

test('what renderCover produces is, by construction, already current', async () => {
  // The two halves have to agree or the backfill never converges: press the
  // button once and every object it wrote must be skipped on the next press.
  const out = await renderCover(await solid(3000, 2000).jpeg().toBuffer());
  assert.equal(coverIsCurrent(await inspectCover(out)), true);
});
