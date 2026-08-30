/* Spielwirbel – what an account profile picture may be (#841).

   The client OFFERS these (the file input's `accept`, the pre-flight size
   check, the error copy that states the limit) and the server VALIDATES against
   them (lib/avatar.js, the multer cap in lib/upload.js), so they live in one
   file required by both — .claude/rules/shared-constants-across-the-stack.md.
   A drifted copy here is the palette bug with a worse ending: the picker would
   offer a file the route then 400s, or the input would cap at a size the server
   silently truncates.

   Dependency-free on purpose: it is required into Node by lib/, so it may not
   touch the shared frontend scope (.claude/rules/frontend-helper-modules-and-coverage.md). */

'use strict';

// Byte cap on the UPLOAD, enforced by multer before anything is decoded, so a
// decompression bomb is refused at the door rather than expanded in memory. Far
// below the 10 MB cover cap: a square 256px portrait needs nothing like it, and
// every byte allowed here is CPU the decoder can be made to spend.
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

// The stored square. 256 rather than the issue's suggested 512 because the
// LARGEST avatar the app renders anywhere is `.profile-head .avatar` at 64px
// (public/styles.css) — 256 still covers that at 3x DPR, and a single variant
// keeps one object per account on every takedown, erasure and purge path.
const AVATAR_SIZE = 256;

// One output format for every input: re-encoding is what neutralises a polyglot
// file, so the stored type is ours, never the uploader's.
const AVATAR_EXT = '.webp';

// The picker's `accept` list — the four types lib/upload.js's sniffImageExt can
// recognise. Advisory only (a file dialog filter is not a security control);
// the magic-byte sniff and the decode are the real gate.
const AVATAR_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

// Ceiling on DECODED pixels, well under sharp's own ~268 MP default. The byte
// cap alone does not bound this: a highly compressible 5 MB PNG can decode to
// gigabytes, so the pixel count needs its own limit.
const AVATAR_MAX_PIXELS = 40 * 1000 * 1000;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AVATAR_MAX_BYTES, AVATAR_SIZE, AVATAR_EXT, AVATAR_ACCEPT, AVATAR_MAX_PIXELS,
  };
}
