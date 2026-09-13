'use strict';

/*
 * The licensed BoardGameGeek corpus (#681): upload the ranks dump and see what it holds.
 *
 * One of the operator router's sub-routers (#996). Mounted by
 * lib/routes/admin/index.js, which owns the /api/admin prefix, the
 * ADMIN_PASSWORD gate and the single mount in lib/app.js.
 *
 * Like every handler here it uses the module-level `repo`, NOT req.repo:
 * moderation is deliberately cross-tenant (a notice names an image, not a
 * tenant), which is exactly why the moderation methods are absent from
 * TENANT_METHODS. The tenant middleware never runs for this router. See
 * .claude/rules/admin-moderation-surface.md.
 */

const express = require('express');
const multer = require('multer');
const repo = require('../../repo');
const corpus = require('../../corpus');
const bgg = require('../../providers/bgg');
const { logger } = require('../../observability');
const router = express.Router();

/* ------------------------------- BGG corpus -------------------------------- */
/*
 * The licensed BoardGameGeek corpus (issue #681): upload the ranks dump, see how
 * far enrichment has got, and run a pass on demand. See lib/corpus.js for why
 * the upload is manual — the dump needs a logged-in BGG session cookie, which
 * the server does not have and must not acquire.
 *
 * It sits on the operator surface rather than anywhere user-facing because it is
 * an instance-wide data set with an instance-wide cost, and because the operator
 * prefers a panel button to a script for one-off production actions.
 */

// Its OWN multer instance, not lib/upload.js — that one sniffs image magic bytes
// and would reject a CSV by design. Memory storage: the file is parsed and
// discarded, never persisted as a file, so nothing reaches the storage seam.
const CORPUS_UPLOAD_MAX = 32 * 1024 * 1024; // the dump is ~10 MB today

const corpusUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CORPUS_UPLOAD_MAX, files: 1 },
  // Deliberately no mimetype filter: browsers label a .csv anything from
  // text/csv to application/vnd.ms-excel to an empty string, so the check would
  // reject valid uploads while proving nothing. The real gate is the header
  // check in parseRanksCsv, which refuses anything without the dump's columns.
});

// multer signals an over-size file by CALLING BACK with a MulterError, which
// carries no `status` — so left to the central error handler it becomes a 500
// `internal_error`, i.e. "the server is broken" for a file the operator can
// simply see is too big.
const acceptCsv = (req, res, next) => corpusUpload.single('file')(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
  return res.status(400).json({ error: 'upload_failed' });
});

// Everything the card renders. Counts and configured ceilings only — no secret,
// not even truncated; `tokenSet` is a boolean about BGG_API_TOKEN, never its
// value.
router.get('/corpus', async (req, res) => {
  res.json({
    corpus: {
      ...(await repo.corpusStats()),
      limit: corpus.corpusSize(),
      minRatings: corpus.minRatings(),
      batchesPerTick: corpus.batchesPerTick(),
      staleDays: corpus.staleDays(),
      tokenSet: bgg.tokenSet(),
    },
  });
});

router.post('/corpus', acceptCsv, async (req, res) => {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ error: 'no_file' });
  }
  const out = await corpus.ingestCsv(req.file.buffer.toString('utf8'), {
    filename: req.file.originalname,
  });
  // A file that is not the ranks dump leaves the previous corpus untouched —
  // the features reading it must not lose their data to a mis-picked file.
  if (out === 'invalid_csv') return res.status(400).json({ error: 'invalid_csv' });
  logger.info({ event: 'admin_corpus_uploaded', rows: out.rows });
  // The card needs the ceiling alongside the counts to phrase the over-cap line.
  const stats = await repo.corpusStats();
  res.json({ ok: true, upload: out, corpus: { ...stats, limit: corpus.corpusSize() } });
});

// Run one bounded enrichment pass now, instead of waiting for the next tick.
// Deliberately the SAME bounded pass the scheduler runs rather than an
// "enrich everything" variant: an operator button that fires 250 upstream
// requests in one request is exactly what the per-tick bound exists to prevent,
// and the button is for seeing that the job works, not for racing it.
router.post('/corpus/enrich', async (req, res) => {
  if (!corpus.enrichEnabled()) return res.status(400).json({ error: 'bgg_token_missing' });
  const run = await corpus.enrich();
  res.json({ ok: true, run, corpus: await repo.corpusStats() });
});

module.exports = router;
