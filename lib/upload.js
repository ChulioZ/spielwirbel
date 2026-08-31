'use strict';

/* Image upload (multer) for game cover images.
 *
 * Files are buffered in memory rather than written straight to disk, so the
 * real content can be verified before anything is persisted: both the client
 * `mimetype` and the `originalname` are attacker-controlled, so we sniff the
 * leading magic bytes and accept only known image types (issue #133). Since
 * #867 the sniffed extension is DISCARDED and the bytes are re-encoded, so the
 * stored object is our encoder's output rather than the uploader's file. Only
 * `saveUploadedImage` persists anything. The bytes go through the storage seam
 * (lib/storage: local disk by default, S3 when configured — issue #128). */

const multer = require('multer');
const storage = require('./storage');
const { AVATAR_MAX_BYTES } = require('../public/js/avatar-policy');
const { COVER_MAX_BYTES } = require('../public/js/cover-policy');

// Sniff the leading bytes of a buffer and return the extension for the image
// type we store (`.jpg`/`.png`/`.gif`/`.webp`), or null when the content isn't
// one of them. The client mimetype/filename are ignored entirely.
function sniffImageExt(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return '.png';
  // GIF: "GIF87a" or "GIF89a"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
      (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) return '.gif';
  // WEBP: "RIFF" <4-byte size> "WEBP"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return '.webp';
  return null;
}

// Verify an uploaded file's real content, re-encode it into the stored cover
// shape, and persist it through the storage backend. Returns the public
// '/uploads/<id>.webp' path, or null when there is no file or its content isn't
// usable as an image (the caller rejects that with 400). Nothing is persisted
// for a rejected file.
//
// The magic-byte sniff runs first even though renderCover would also reject a
// non-image: it is the documented gate (#133), it costs twelve bytes, and it
// keeps arbitrary content from reaching a native decoder at all. Its extension
// is then discarded — since #867 the stored type is always COVER_EXT, because
// the bytes on disk are our encoder's output and not the uploader's file. Same
// shape as saveAvatar; see lib/cover.js for what the round trip buys.
async function saveUploadedImage(file) {
  if (!file || !file.buffer) return null;
  if (!sniffImageExt(file.buffer)) return null;
  // Required here rather than at module scope so lib/cover.js's lazy sharp
  // require stays lazy for callers that never upload anything.
  const { renderCover, COVER_EXT } = require('./cover');
  const rendered = await renderCover(file.buffer);
  if (!rendered) return null;
  return storage.save(rendered, COVER_EXT);
}

// The cap came down 10 MB -> 5 MB WITH the re-encode (#867), not independently
// of it: every byte accepted here is now work a native image decoder will be
// made to do, which is the same reasoning the avatar instance below spells out.
// Shared with the client, which offers the same limit
// (.claude/rules/shared-constants-across-the-stack.md).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: COVER_MAX_BYTES },
  // Cheap first-pass reject on the (spoofable) mimetype; the real gate is the
  // magic-byte sniff in saveUploadedImage before anything is written to disk.
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

// Account profile pictures (#841) get their own instance so the two caps can
// move independently — they happen to be equal today, and that is a
// coincidence of two separate decisions rather than a shared value. Both are
// enforced BEFORE anything is decoded, because both kinds are re-encoded
// server-side and the accepted bytes are bytes a native image decoder will be
// made to read. Each cap is shared with the client
// (.claude/rules/shared-constants-across-the-stack.md).
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

module.exports = { upload, avatarUpload, saveUploadedImage, sniffImageExt };
