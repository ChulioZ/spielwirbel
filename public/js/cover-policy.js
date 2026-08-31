/* Spielwirbel – what a game cover may be (#867).

   The client OFFERS these (the pre-flight size check at both paste sites and
   the error copy that states the limit) and the server VALIDATES against them
   (lib/cover.js, the multer cap in lib/upload.js), so they live in one file
   required by both — .claude/rules/shared-constants-across-the-stack.md. The
   sibling of avatar-policy.js (#841), and the same plain-value half of that
   rule: a drifted copy here either offers a paste the route then 413s, or caps
   below the server and refuses a cover that would have been accepted.

   Dependency-free on purpose: it is required into Node by lib/, so it may not
   touch the shared frontend scope (.claude/rules/frontend-helper-modules-and-coverage.md). */

'use strict';

// Byte cap on the UPLOAD, enforced by multer before anything is decoded. Down
// from 10 MB with the re-encode, not independently of it: every byte accepted
// here is now work a native decoder is made to do, which is the same reasoning
// that gave avatars their own smaller cap.
const COVER_MAX_BYTES = 5 * 1024 * 1024;

// The same limit as the copy states it. Derived rather than written out,
// because a hand-typed "at most 5 MB" in the message is the third copy — the
// one that states a number nobody re-checks when the cap moves (the trap named
// in the avatar-policy paragraph of the shared-constants rule).
const COVER_MAX_MB = COVER_MAX_BYTES / (1024 * 1024);

// Ceiling on the LONG EDGE of the stored image. The largest frame the app
// renders a cover into is the game-detail hero at 240 CSS px, and COVER_HERO
// (480, public/js/cover-size.js) already carries 1.5x DPR headroom — 1024
// clears 3x DPR with room for the blurred zoomed backdrop layer (#181) and
// still lands a typical cover at 60–150 KB.
const COVER_MAX_DIM = 1024;

// One output format for every input: re-encoding is what neutralises a
// polyglot, so the stored type is ours, never the uploader's. WebP carries
// alpha, so a transparent PNG survives.
const COVER_EXT = '.webp';

// Ceiling on DECODED pixels, well under sharp's own ~268 MP default. The byte
// cap alone does not bound this: a highly compressible 5 MB PNG can decode to
// gigabytes, so the pixel count needs its own limit.
const COVER_MAX_PIXELS = 40 * 1000 * 1000;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COVER_MAX_BYTES, COVER_MAX_MB, COVER_MAX_DIM, COVER_EXT, COVER_MAX_PIXELS,
  };
}
