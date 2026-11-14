/* Spielwirbel – what a session photo may be (#1774).

   The client OFFERS these (the pre-flight size check on the result screen and
   the error copy that states the limit) and the server VALIDATES against them
   (lib/session-photo.js, the multer cap in lib/upload.js), so they live in one
   file required by both — .claude/rules/shared-constants-across-the-stack.md.
   The sibling of cover-policy.js and avatar-policy.js.

   Dependency-free on purpose: it is required into Node by lib/, so it may not
   touch the shared frontend scope (.claude/rules/frontend-helper-modules-and-coverage.md). */

'use strict';

// Byte cap on the UPLOAD, enforced by multer before anything is decoded. Twice
// the cover's, because the input here is a phone CAMERA photo rather than a
// pasted cover: a 12 MP JPEG straight off a phone is 3–8 MB, and refusing the
// ordinary case would make the feature fail on its main path. Every accepted
// byte is still work for a native decoder, which is why it is bounded at all.
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

// The same limit as the copy states it, derived so the message cannot drift.
const PHOTO_MAX_MB = PHOTO_MAX_BYTES / (1024 * 1024);

// Ceiling on the LONG EDGE of the stored image. The largest frame the app shows
// a photo in is the result screen's column (at most ~900 CSS px), so 1280
// clears it at ~1.4x DPR. It is held below a "retina-perfect" 1800 because the
// SAME object is the Chronik row's thumbnail (there is no second, smaller copy
// to keep in step through every deletion path), so every byte here is paid on
// each Chronik visit too. Lands a typical table photo at ~100–200 KB.
const PHOTO_MAX_DIM = 1280;

// One output format for every input, as for covers: the re-encode is what
// strips EXIF/GPS and neutralises a polyglot.
const PHOTO_EXT = '.webp';

// Ceiling on DECODED pixels. Above a 48 MP phone sensor's full-resolution
// output (8064×6048 ≈ 48.8 MP) so a real camera photo is never refused, and far
// under sharp's own ~268 MP default so a compressible bomb still is.
const PHOTO_MAX_PIXELS = 50 * 1000 * 1000;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PHOTO_MAX_BYTES, PHOTO_MAX_MB, PHOTO_MAX_DIM, PHOTO_EXT, PHOTO_MAX_PIXELS,
  };
}
