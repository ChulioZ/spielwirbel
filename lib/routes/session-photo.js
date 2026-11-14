'use strict';

/* One photo per played session (#1774) — PUT to set or replace, DELETE to remove.
 *
 * Mounted at /api/rounds/:rid/sessions/:sid/photo, ahead of the sessions router,
 * and its own file because it is the only multipart route under /sessions: the
 * upload handling (multer, the 413 code, the client-abort case) would otherwise
 * be the one odd shape in a 1300-line JSON router.
 *
 * The photo is round data like a cover, so the same access applies: anyone the
 * round is shared with may set it (lib/round-access.js lists both routes as
 * `round.write`), and /uploads serves it to exactly that audience
 * (lib/upload-access.js, kind 'session').
 *
 * Reference first, bytes second, in both directions — the ordering every image
 * path here uses (.claude/rules/deletion-paths-must-free-cover-objects.md): the
 * new object is written, the session is pointed at it, and only then is the old
 * one freed, so a failure part-way leaves an orphaned file, never a session
 * pointing at nothing.
 */

const express = require('express');
const storage = require('../storage');
const quota = require('../quota');
const { photoUpload, saveSessionPhoto, clientAborted } = require('../upload');

const router = express.Router({ mergeParams: true });

// The cap is the one upload failure a person can act on, so it gets its own
// code and the toast can state the limit.
const receivePhoto = (req, res, next) => photoUpload.single('photo')(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'photo_too_large' });
  if (clientAborted(req)) return undefined;
  return next(err);
});

router.put('/', receivePhoto, async (req, res) => {
  const { rid, sid } = req.params;
  // Checked before anything is decoded or written, so a refused request costs
  // no encoder work and leaves no object behind.
  const before = await req.repo.getSession(rid, sid);
  if (!before) return res.status(404).json({ error: 'Session not found' });
  if (before.finished !== true) return res.status(409).json({ error: 'not_played' });
  // Replacing a photo does not grow the count, so only a FIRST photo is held
  // against the cap — otherwise a tenant exactly at the ceiling could no longer
  // swap a blurry picture for a better one.
  if (quota.enforced() && !before.photo) {
    const limit = quota.photosPerTenant();
    if (await req.repo.countSessionPhotos() >= limit) {
      return res.status(403).json({ error: 'quota_photos', limit });
    }
  }

  const stored = await saveSessionPhoto(req.file);
  if (!stored) return res.status(400).json({ error: 'invalid_image' });

  const result = await req.repo.setSessionPhoto(rid, sid, stored);
  // The session vanished, or stopped being played, between the read above and
  // this write. Free the object we just wrote — nothing references it.
  if (!result || result === 'not_played') {
    await storage.remove(stored);
    if (!result) return res.status(404).json({ error: 'Session not found' });
    return res.status(409).json({ error: 'not_played' });
  }
  if (result.previous && result.previous !== stored) await storage.remove(result.previous);
  res.json(result.session);
});

// Idempotent: removing a photo a session does not have is a no-op 200, and it
// is NOT gated on `finished` — a photo that outlived its evening's result (the
// chosen game was deleted, lib/repo scrubGames) must still be removable.
router.delete('/', async (req, res) => {
  const result = await req.repo.setSessionPhoto(req.params.rid, req.params.sid, null);
  if (!result) return res.status(404).json({ error: 'Session not found' });
  if (result.previous) await storage.remove(result.previous);
  res.json(result.session);
});

module.exports = router;
