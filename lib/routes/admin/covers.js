'use strict';

/*
 * The cover re-encode backfill (#867).
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
const repo = require('../../repo');
const storage = require('../../storage');
const { logger } = require('../../observability');
// The cover encoder (#867). Required at module scope, but sharp itself stays
// lazy inside lib/cover.js, so the admin router does not put the native binary
// on the boot path.
const {
  renderCover, inspectCover, coverIsCurrent, COVER_EXT,
} = require('../../cover');
const router = express.Router();

/* ------------------ Cover re-encode backfill (#867) ------------------------ */

// Covers uploaded before #867 were stored exactly as pasted — up to 10 MB, and
// re-served at that size on every render. New uploads are re-encoded on the way
// in; this converts the ones already in the bucket. An operator action rather
// than boot-time migration code, per CLAUDE.md's standing rule.
//
// Bounded per press, like SIZE_SAMPLE_MAX above, but far tighter — and the
// number is set by the WALL CLOCK, not by memory. Each object costs an object
// read, a decode, an encode and a write, which on S3/R2 is a few hundred
// milliseconds; at 200 per press a full batch would hold one HTTP request open
// for minutes, where a proxy timeout or a closed laptop lid loses the operator
// the run's report (the work itself survives — every converted object is
// skipped next time). 25 keeps a press to a handful of seconds, and the panel
// says how many are left, so a large bucket is several cheap presses instead of
// one fragile long one.
const REENCODE_BATCH_MAX = 25;

router.post('/covers/reencode', async (req, res) => {
  // Only objects WE host. A hotlinked provider cover (#172) has no bytes of
  // ours behind it and must never be fetched or rewritten — the same filter
  // uploadUsage applies, for the same reason.
  const hosted = (await repo.listGameImages()).filter(storage.isHostedImage);
  const batch = hosted.slice(0, REENCODE_BATCH_MAX);

  const run = {
    hosted: hosted.length,
    scanned: 0,
    converted: 0,
    skipped: 0,
    failed: 0,
    remaining: hosted.length - batch.length,
    bytesBefore: 0,
    bytesAfter: 0,
  };

  for (const oldPath of batch) {
    run.scanned += 1;
    const buf = await storage.read(oldPath).catch(() => null);
    if (!buf) { run.failed += 1; continue; }

    const meta = await inspectCover(buf);
    if (!meta) { run.failed += 1; continue; }
    // Idempotence lives here: an object already in the stored shape is left
    // alone, so pressing the button twice re-reads and re-decides but never
    // re-encodes.
    if (coverIsCurrent(meta)) { run.skipped += 1; continue; }

    const rendered = await renderCover(buf);
    if (!rendered) { run.failed += 1; continue; }

    const newPath = await storage.save(rendered, COVER_EXT);
    // Reference first, bytes second — the ordering takedownImage and
    // POST /me/avatar use. A crash between the two leaves an orphan object,
    // never a row pointing at bytes that are gone.
    const changed = await repo.replaceImage(oldPath, newPath);
    if (!changed) {
      // The games moved off this path between the listing and now. Free the
      // object we just wrote rather than orphaning it; nothing references it.
      await storage.remove(newPath);
      run.skipped += 1;
      continue;
    }
    // Safe by construction rather than by an isImageReferenced check:
    // replaceImage rewrote EVERY game referencing this path, across all
    // tenants, and an account avatar is a separate object that a game cover
    // path is never shared with.
    await storage.remove(oldPath);

    run.converted += 1;
    run.bytesBefore += buf.length;
    run.bytesAfter += rendered.length;
  }

  run.reclaimed = run.bytesBefore - run.bytesAfter;
  logger.info({ event: 'admin_covers_reencode', ...run }, 'cover re-encode backfill run');
  res.json({ ok: true, run });
});

module.exports = router;
