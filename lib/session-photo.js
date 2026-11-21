'use strict';

/* Server-side re-encoding of an uploaded session photo (#1774).
 *
 * The cover encoder's sibling (lib/cover.js), and it buys the same three things
 * for the same reasons — with the first one weighing far more here, because a
 * session photo is a CAMERA photo by definition, taken at somebody's table:
 *
 *  1. EXIF/GPS is gone. sharp writes no input metadata unless asked to
 *     (`withMetadata`), so the coordinates of someone's home never reach the
 *     bucket. test/session-photo.test.js pins it with a fixture that really
 *     carries GPS.
 *  2. A polyglot does not survive: the stored bytes are our encoder's output.
 *  3. A bounded shape on disk: WebP, at most PHOTO_MAX_DIM on the long edge.
 *
 * THE ONE DIFFERENCE FROM COVERS IS `.rotate()`, and it is load-bearing. A phone
 * stores a portrait photo as landscape pixels plus an EXIF Orientation tag, and
 * the browser turns it upright from that tag. Stripping the metadata without
 * first applying the tag would store every portrait photo lying on its side.
 * `.rotate()` with no argument bakes the tag into the pixels, so stripping it
 * afterwards loses nothing. (A pasted cover is a screenshot or a download, which
 * carries no such tag, so lib/cover.js does not need it.)
 */

const { PHOTO_MAX_DIM, PHOTO_EXT, PHOTO_MAX_PIXELS } = require('../public/js/photo-policy');

// Lazy, exactly as lib/cover.js and lib/avatar.js do it: the native binary is
// loaded only when a photo is actually processed.
let sharp = null;
function lib() {
  if (!sharp) sharp = require('sharp');
  return sharp;
}

// Re-encode arbitrary image bytes into the stored photo shape, or null when
// they cannot be decoded as an image (the caller answers 400 for that, the same
// answer as a failed sniff). A failure of the library itself still throws.
async function renderPhoto(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  try {
    return await lib()(buffer, { limitInputPixels: PHOTO_MAX_PIXELS })
      .rotate()
      // `inside` + `withoutEnlargement`, as for a cover: the photo is shown
      // whole, and upscaling a small one adds bytes without adding detail.
      .resize(PHOTO_MAX_DIM, PHOTO_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    // Includes the pixel-limit refusal: a decompression bomb is an unusable image.
    return null;
  }
}

module.exports = { renderPhoto, PHOTO_EXT };
