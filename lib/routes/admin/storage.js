'use strict';

/*
 * Object-storage usage and the orphan estimate (#941).
 *
 * One of the operator router's sub-routers (#996). Mounted by
 * lib/routes/admin/index.js, which owns the /api/admin prefix, the
 * ADMIN_PASSWORD gate and the single mount in lib/app.js.
 *
 * ITS OWN ENDPOINT, BEHIND A BUTTON, on purpose: this lists the whole bucket,
 * and a bucket-wide listing must not run every time somebody opens the panel.
 * The BGG-Korpus card's „Neu laden" is the same idiom.
 *
 * Like every handler here it uses the module-level `repo`, NOT req.repo — the
 * tenant middleware never runs for this router
 * (.claude/rules/admin-moderation-surface.md).
 */

const express = require('express');
const repo = require('../../repo');
const storage = require('../../storage');
const router = express.Router();

/* ------------------------------ storage usage ------------------------------ */

/* Numbers only — no key, no path, no tenant. An object key is a random id and
 * not personal data by itself, but the referenced/orphaned SPLIT is a statement
 * about somebody's uploads, and the panel needs no more than the counts to be
 * useful. Same generic sweeps as /status cover this in test/status.test.js.
 *
 * REPORT ONLY. NEVER DELETES, and that is not a scope decision — it is a
 * correctness one: an object written by another replica between the listing and
 * the database read looks orphaned, and a zero-downtime deploy overlaps two
 * processes on every push (.claude/rules/deploy-invariants-are-pinned-in-code.md).
 * Deleting on that evidence would remove a cover somebody uploaded seconds ago.
 * The panel words it as an estimate for the same reason.
 */
router.get('/storage', async (req, res) => {
  const usage = typeof storage.usage === 'function' ? await storage.usage() : null;
  if (!usage) return res.json({ storage: null });

  const referenced = new Set(
    (await repo.referencedImages()).filter(storage.isHostedImage),
  );
  // Counted against the LISTED keys only. When the sweep hit its cap the orphan
  // figure is a floor rather than a total, which `complete: false` is what tells
  // the panel — an orphan count from a partial listing is otherwise indistinguishable
  // from a complete one.
  let orphans = 0;
  for (const key of usage.keys) if (!referenced.has(key)) orphans += 1;

  res.json({
    storage: {
      objects: usage.objects,
      bytes: usage.bytes,
      complete: usage.complete === true,
      referenced: referenced.size,
      orphans,
    },
  });
});

module.exports = router;
