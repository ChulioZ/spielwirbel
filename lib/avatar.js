'use strict';

/* Server-side re-encoding of an account profile picture (#841).
 *
 * Covers are stored as the uploader sent them (magic-byte sniffed, #133). A
 * profile picture is not: it is a photo OF A PERSON, so it gets a decode/encode
 * round trip that buys three things the sniff alone cannot.
 *
 *  1. EXIF/GPS is gone. A phone photo carries coordinates and a capture
 *     timestamp; storing those would silently make the app hold location data
 *     about its users. sharp drops metadata unless asked to keep it, and
 *     test/avatar.test.js pins that with a fixture that really carries GPS —
 *     it is a data-minimisation property the privacy policy leans on, and
 *     exactly the kind a later "preserve metadata" change removes without
 *     anyone noticing.
 *  2. A polyglot does not survive. A buffer that sniffs as an image and carries
 *     a second payload after it decodes to pixels and re-encodes to ours.
 *  3. One known shape on disk: a square AVATAR_SIZE webp, whatever came in.
 *
 * ANIMATED INPUT IS FLATTENED TO ITS FIRST FRAME, deliberately, rather than
 * refused. sharp reads only the first frame unless constructed with
 * `{ animated: true }`, so flattening is the behaviour we get by NOT asking for
 * the other one — no second error path, no error string in five languages, and
 * an animated GIF becomes a still portrait instead of a rejection the uploader
 * has to interpret. The issue (#841) left the choice open; this is the half
 * that cannot fail for the user. What must not happen either way is an
 * animation reaching ten member seats at once, and it cannot.
 */

const storage = require('./storage');
const { sniffImageExt } = require('./upload');
const { AVATAR_SIZE, AVATAR_EXT, AVATAR_MAX_PIXELS } = require('../public/js/avatar-policy');

// Required lazily so the native binary is loaded only when an avatar is
// actually processed. Nothing else in the app needs sharp, and a require at
// module scope would put it on the boot path of every test file that builds the
// app.
let sharp = null;
function lib() {
  if (!sharp) sharp = require('sharp');
  return sharp;
}

// Re-encode arbitrary image bytes into the stored avatar shape, or return null
// when the content cannot be decoded as an image at all.
//
// Returns null rather than throwing on bad input: the caller answers 400 for
// both "did not sniff as an image" and "did not decode as one", and the two are
// the same answer to the uploader. A genuine failure of the library itself
// (out of memory, a missing binary) still throws and reaches the route's error
// handler, because that is an operator problem, not a user one.
async function renderAvatar(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  try {
    return await lib()(buffer, { limitInputPixels: AVATAR_MAX_PIXELS })
      // `cover` crops to fill rather than letterboxing, so every stored avatar
      // is edge-to-edge at the same aspect ratio and the circular mask in CSS
      // never reveals a background bar. `withoutEnlargement` is deliberately
      // NOT set: a 64px input must still produce a 256px object, or the stored
      // shape stops being one known size.
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    // Includes the pixel-limit refusal: a decompression bomb lands here and is
    // reported to the uploader as an unusable image, which it is.
    return null;
  }
}

// Verify, re-encode and persist one uploaded avatar, returning the public
// '/uploads/<key>.webp' path — or null when the file is absent or is not usable
// as an image, in which case NOTHING has been written.
//
// The magic-byte sniff runs first even though the decode below would also
// reject a non-image: it is the documented gate (#133), it costs twelve bytes,
// and it keeps arbitrary content from reaching a native decoder at all. The
// sniffed extension is then discarded — unlike a cover, the stored type is
// always ours (AVATAR_EXT), because the bytes on disk are our encoder's output
// and not the uploader's file.
async function saveAvatar(file) {
  if (!file || !file.buffer) return null;
  if (!sniffImageExt(file.buffer)) return null;
  const rendered = await renderAvatar(file.buffer);
  if (!rendered) return null;
  return storage.save(rendered, AVATAR_EXT);
}

module.exports = { renderAvatar, saveAvatar, AVATAR_EXT };
