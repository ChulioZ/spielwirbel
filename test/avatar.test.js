'use strict';

/*
 * lib/avatar.js — the re-encode that makes an account profile picture safe to
 * store (#841).
 *
 * These are the assertions the privacy policy leans on. §5 tells a reader that
 * a profile picture is re-encoded and stripped of EXIF/GPS, so "sharp drops
 * metadata by default" is not enough: the default is a property of a dependency
 * we do not control, and a later `.withMetadata()` added for some unrelated
 * reason would silently make the published statement false. Hence a fixture
 * that really carries GPS, and an assertion on the OUTPUT.
 */

const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');

const { renderAvatar } = require('../lib/avatar');
const { AVATAR_SIZE } = require('../public/js/avatar-policy');

// A JPEG carrying a maker note and real GPS coordinates — what a phone photo
// looks like. Built rather than committed: a binary fixture nobody can read is
// exactly the kind that rots into "we think this has GPS in it".
async function photoWithGps() {
  return sharp({ create: { width: 900, height: 400, channels: 3, background: '#c2410c' } })
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
  // The anti-vacuous half. Without it, a sharp version that quietly stopped
  // WRITING exif would make every assertion below pass while proving nothing —
  // stripping metadata from an image that never had any is not a guarantee.
  const meta = await sharp(await photoWithGps()).metadata();
  assert.ok(meta.exif, 'fixture has an EXIF block');
  assert.ok(meta.exif.includes(Buffer.from('TestCam')), 'fixture EXIF carries the maker note');
});

test('re-encoding strips EXIF and GPS', async () => {
  const out = await renderAvatar(await photoWithGps());
  const meta = await sharp(out).metadata();

  assert.equal(meta.exif, undefined, 'no EXIF block survives the round trip');
  // Belt and braces against a future format that carries coordinates elsewhere:
  // the stored bytes must not contain the marker at all.
  assert.equal(out.includes(Buffer.from('TestCam')), false, 'no maker note anywhere in the stored bytes');
});

test('whatever goes in, one square webp comes out', async () => {
  // A wide JPEG, a tall PNG and a tiny one — the last proves the square is not
  // merely a downscale ceiling: a 40px input must still be stored at 256, or
  // "one known shape on disk" is not true.
  const inputs = [
    await sharp({ create: { width: 900, height: 400, channels: 3, background: '#111' } }).jpeg().toBuffer(),
    await sharp({ create: { width: 300, height: 1200, channels: 4, background: '#222' } }).png().toBuffer(),
    await sharp({ create: { width: 40, height: 40, channels: 3, background: '#333' } }).png().toBuffer(),
  ];
  for (const input of inputs) {
    const meta = await sharp(await renderAvatar(input)).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, AVATAR_SIZE);
    assert.equal(meta.height, AVATAR_SIZE);
  }
});

test('an animated GIF is flattened to a still, never stored as an animation', async () => {
  // Three 60x60 frames. `pageHeight` must sit INSIDE the `raw` options — beside
  // them it is silently ignored and you get a 60x180 STILL, i.e. a fixture that
  // proves nothing while looking exactly right. Hence the pages===3 assertion
  // on the fixture before the one on the output.
  const W = 60, H = 60, N = 3;
  const frames = Buffer.concat([0, 1, 2].map((i) => Buffer.alloc(W * H * 3, 40 + i * 80)));
  const animated = await sharp(frames, { raw: { width: W, height: H * N, channels: 3, pageHeight: H } })
    .gif({ loop: 0 })
    .toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, N,
    'the fixture really is an animation');

  // The decision (#841 left it open) is flatten rather than refuse; what must
  // not happen either way is an animation reaching ten member seats at once.
  const meta = await sharp(await renderAvatar(animated), { animated: true }).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.pages || 1, 1, 'the stored object holds exactly one frame');
  assert.equal(meta.height, AVATAR_SIZE, 'the square, not a filmstrip of stacked frames');
});

test('content that does not decode as an image answers null rather than throwing', async () => {
  // The route turns null into a 400. Throwing would reach the error handler and
  // answer 500 — an operator alert for a user picking the wrong file.
  assert.equal(await renderAvatar(Buffer.from('<?php echo 1; ?>')), null);
  assert.equal(await renderAvatar(Buffer.alloc(0)), null);
  assert.equal(await renderAvatar(null), null);
  assert.equal(await renderAvatar('not a buffer'), null);
});

test('a decompression bomb is refused, not expanded', async () => {
  // 12000x12000 = 144 MP, well past AVATAR_MAX_PIXELS (40 MP) and only ~90 KB
  // on the wire — i.e. it sails through the multer byte cap, which is the whole
  // reason a separate pixel ceiling exists. A plain `sharp()` with no
  // limitInputPixels would happily allocate this.
  const bomb = await sharp({ create: { width: 12000, height: 12000, channels: 3, background: '#fff' } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  assert.ok(bomb.length < 5 * 1024 * 1024, 'the bomb is under the byte cap, as the attack requires');
  assert.equal(await renderAvatar(bomb), null);
});
