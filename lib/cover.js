'use strict';

/* Server-side re-encoding of an uploaded game cover (#867).
 *
 * Until #867 a cover was stored exactly as pasted — magic-byte sniffed (#133),
 * then handed to the storage seam untouched. That made a 10 MB paste a 10 MB
 * object, RE-SERVED AT 10 MB ON EVERY RENDER into a frame at most 480px wide:
 * coverUrl() rewrites a *provider* URL to a CDN variant, but our own uploads
 * pass through byte-identically (public/js/cover-size.js), so there was no
 * render-time sizing to fall back on. The round trip below is what makes that
 * contract cheap instead of expensive.
 *
 * It buys the same three things lib/avatar.js does, for the same reasons:
 *
 *  1. EXIF/GPS is gone. The only bytes-upload path for a cover is a clipboard
 *     paste, and in practice that is a phone photo of a real box on a real
 *     table — so the coordinates are of someone's home. test/cover.test.js
 *     pins it with a fixture that really carries GPS.
 *  2. A polyglot does not survive. A buffer that sniffs as an image and carries
 *     a second payload after it decodes to pixels and re-encodes to ours.
 *  3. A bounded shape on disk: WebP, at most COVER_MAX_DIM on the long edge.
 *
 * ANIMATED INPUT IS FLATTENED TO ITS FIRST FRAME, deliberately — sharp reads
 * only the first frame unless constructed with `{ animated: true }`, so this is
 * the behaviour we get by NOT asking for the other one. No second error path
 * and no fifth error string in five languages.
 */

const { COVER_MAX_DIM, COVER_EXT, COVER_MAX_PIXELS } = require('../public/js/cover-policy');

// Required lazily so the native binary is loaded only when a cover is actually
// processed, exactly as lib/avatar.js does it. A require at module scope would
// put sharp on the boot path of every test file that builds the app.
let sharp = null;
function lib() {
  if (!sharp) sharp = require('sharp');
  return sharp;
}

// Re-encode arbitrary image bytes into the stored cover shape, or return null
// when the content cannot be decoded as an image at all.
//
// Returns null rather than throwing on bad input: the caller answers 400 for
// both "did not sniff as an image" and "did not decode as one", and the two are
// the same answer to the uploader. A genuine failure of the library itself
// still throws and reaches the route's error handler, because that is an
// operator problem, not a user one.
async function renderCover(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  try {
    return await lib()(buffer, { limitInputPixels: COVER_MAX_PIXELS })
      // `inside`, NOT `cover` — the one place this deliberately diverges from
      // lib/avatar.js. Covers are shown whole against a blurred backdrop of
      // themselves (#181), so cropping to a square would be a visible
      // regression on every shelf. `withoutEnlargement` is right here where it
      // was deliberately wrong for an avatar: an avatar needs ONE known size,
      // a cover only needs a ceiling, and upscaling a small paste would add
      // bytes without adding a pixel of detail.
      .resize(COVER_MAX_DIM, COVER_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    // Includes the pixel-limit refusal: a decompression bomb lands here and is
    // reported to the uploader as an unusable image, which it is.
    return null;
  }
}

// What an EXISTING stored object is — { format, width, height } — or null when
// it cannot be decoded. Only the operator's re-encode backfill uses it, to tell
// an object that already has the stored shape from one that needs converting,
// which is what makes pressing the button twice a cheap no-op rather than a
// second round of lossy re-encoding.
async function inspectCover(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  try {
    const meta = await lib()(buffer, { limitInputPixels: COVER_MAX_PIXELS }).metadata();
    if (!meta || !meta.width || !meta.height) return null;
    return { format: meta.format, width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

// True when the stored bytes already have the shape renderCover produces, so
// re-encoding them would cost a generation of quality and reclaim nothing.
function coverIsCurrent(meta) {
  return !!meta && meta.format === 'webp' && Math.max(meta.width, meta.height) <= COVER_MAX_DIM;
}

module.exports = {
  renderCover, inspectCover, coverIsCurrent, COVER_EXT,
};
