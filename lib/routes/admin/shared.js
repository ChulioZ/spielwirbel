'use strict';

/* The three things more than one operator sub-router needs (#996).

   Measured before the split: exactly one helper crossed a section boundary in
   the old single file — `sendCsv`, which moved to lib/csv.js beside the
   `CSV_BOM`/`toCsv` it wraps. Everything else was section-local and stayed
   there. What is here is the schemas the write actions share plus the paging
   shape the two list routes share; something new appearing here is a signal that
   two sections have stopped being independent.

   `idSchema` is the correction to that measurement: it turned out to cross into
   the log and the notices sections as well, and the split is what made that
   visible — in one 1124-line file a `const` used 400 lines away looks exactly
   like one used on the next line. */

const { z } = require('zod');

const REASON_MAX = 500;

// A reason is REQUIRED on every state-changing action: an Art. 17 statement of
// reasons needs one, and it is the whole point of the action log.
const reasonSchema = z.preprocess(
  (v) => String(v || '').trim(),
  z.string().min(1, 'A reason is required').max(REASON_MAX, 'Reason is too long'),
);

// Only ever a stored cover path. Anchoring to '/uploads/' and forbidding
// slashes/dots past it keeps this from being pointed at anything else — the
// stored form is always a single '/uploads/<id><ext>' segment
// (.claude/rules/cover-image-storage-backend.md).
const imageSchema = z.preprocess(
  (v) => String(v || '').trim(),
  z.string().regex(/^\/uploads\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/, 'Not a valid /uploads/ path'),
);

// Both list routes below page with the same (limit, offset) and report a total,
// so the panel can say "100 von 342" instead of silently truncating (#288).
const pageParams = (req) => ({
  limit: Math.min(Math.max(Number(req.query.limit) || 100, 1), 500),
  offset: Math.max(Number(req.query.offset) || 0, 0),
});

// An opaque entity id as both backends mint them (hex / nanoid-ish). Narrow on
// purpose: these ids are interpolated into repo lookups, and a notice never
// legitimately names anything but one of them.
const idSchema = z.preprocess(
  (v) => String(v || '').trim(),
  z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'Not a valid id'),
);

module.exports = { REASON_MAX, reasonSchema, imageSchema, idSchema, pageParams };
