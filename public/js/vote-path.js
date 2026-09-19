/* Spielwirbel – the public vote link's PATH shape (#652, #1170).

   Pure and dependency-free, so it works both as a shared-scope frontend script
   (browser global, used by router.js and views-vote-link.js) and as a CommonJS
   module lib/routes/sessions.js requires when it encodes the link as a QR code.

   Why its own file: the client builds this path to share, and since #1170 the
   SERVER builds the same one to draw the code people scan. Two copies of the
   shape would drift the moment the route moves, and the picture would then lead
   into a 404 that only a phone at a real table would ever surface — the classic
   client-offers/server-validates split in
   .claude/rules/shared-constants-across-the-stack.md. Load order: see
   index.html (before router.js). */

'use strict';

// The token is base64url, which is already path-safe, but it is encoded here
// for the same reason profilePath() encodes a username: the builder, not each
// call site, owns that question.
const votePath = (token) => `/vote/${encodeURIComponent(token)}`;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { votePath };
}
