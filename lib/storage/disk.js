'use strict';

/* Local-disk storage backend for cover images — the default (issue #128).
 *
 * Files live under DATA_DIR/uploads and the stored public path is
 * '/uploads/<id><ext>'. This is the behaviour the app has always had, extracted
 * behind the storage seam so an S3 backend can replace it when S3_BUCKET is set
 * (see ./index.js and ./s3.js). Nothing else changes: same-origin /uploads URLs,
 * same auth gate, same data.json paths. */

const fs = require('fs');
const path = require('path');
const express = require('express');
const { UPLOAD_DIR, id } = require('../store');

// Write image bytes and return the public '/uploads/<id><ext>' path stored in
// the DB. The extension is the caller's already-validated one (magic-byte sniff
// in lib/upload.js — provider covers are hotlinked and never stored, #172) —
// never the client
// filename.
async function save(buffer, ext) {
  const key = id() + ext;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, key), buffer);
  return '/uploads/' + key;
}

// Best-effort delete of the file behind a '/uploads/...' path. Never throws — a
// file that's already gone (or was never local) is a no-op.
async function remove(publicPath) {
  if (!publicPath) return;
  await fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(publicPath))).catch(() => {});
}

// Byte size of the object behind a '/uploads/...' path, or null when it can't be
// determined (#275). Best-effort by design: the per-tenant summary that uses this
// is an operator convenience, so a missing or unreadable file reports "unknown"
// rather than failing the whole lookup.
async function size(publicPath) {
  if (!publicPath) return null;
  const stat = await fs.promises
    .stat(path.join(UPLOAD_DIR, path.basename(publicPath)))
    .catch(() => null);
  return stat ? stat.size : null;
}

// Read the bytes behind a '/uploads/...' path, or null when they can't be read
// (#867). Used only by the operator's cover re-encode backfill, which sizes and
// re-encodes objects it already knows the app references. Best-effort like
// size(): a missing object is skipped, never guessed at.
async function read(publicPath) {
  if (!publicPath) return null;
  return fs.promises
    .readFile(path.join(UPLOAD_DIR, path.basename(publicPath)))
    .catch(() => null);
}

/* What the store actually holds (#941): `{ objects, bytes, complete, keys }`.
   The operator panel's „Speicher" card reads it, and the orphan estimate needs
   the key list to diff against what the database references.

   BOUNDED, and `complete: false` past the cap — the `SIZE_SAMPLE_MAX` idiom the
   panel already renders a „≥" for. A folder with a million files must not turn
   opening a card into an unbounded walk.

   Keys come back as the PUBLIC `/uploads/<key>` shape, not as file names, so the
   caller can diff them against `image` values straight out of the database
   without knowing which backend answered. */
const USAGE_MAX = 5000;

async function usage() {
  const names = await fs.promises.readdir(UPLOAD_DIR).catch(() => []);
  const page = names.slice(0, USAGE_MAX);
  let bytes = 0;
  const keys = [];
  for (const name of page) {
    const stat = await fs.promises.stat(path.join(UPLOAD_DIR, name)).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    bytes += stat.size;
    keys.push('/uploads/' + name);
  }
  return { objects: keys.length, bytes, complete: names.length <= USAGE_MAX, keys };
}

// Express handler mounted at /uploads (behind requireAuth in lib/app.js): serve
// the files straight off disk.
const serve = express.static(UPLOAD_DIR);

module.exports = {
  save, remove, size, read, usage, serve, backend: 'disk',
};
