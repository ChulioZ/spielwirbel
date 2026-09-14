'use strict';

/* S3-compatible object-storage backend for cover images (issue #128).
 * Selected by ./index.js when S3_BUCKET is set; otherwise ./disk.js is used.
 *
 * The stored public path stays '/uploads/<id><ext>' exactly as with disk
 * storage, so nothing else in the app changes: the frontend still renders
 * same-origin /uploads URLs, the CSP (img-src 'self') is untouched, /uploads
 * stays behind the auth gate, and existing data.json paths keep working. Only
 * the bytes move off local disk.
 *
 * The app streams objects back through GET /uploads/<key> (a read-through
 * proxy) instead of exposing the bucket publicly. That is deliberate: cover
 * images are user data, so keeping them behind the app preserves the same auth
 * gate the disk backend has and avoids a cross-origin CSP allowance. The extra
 * bandwidth through the app tier is negligible for this app's scale.
 *
 * Works with any S3-compatible store (AWS S3, Cloudflare R2, Backblaze B2,
 * MinIO) via a configurable endpoint. Exported as a factory so tests can inject
 * a fake client + bucket and drive it with no network — see test/storage.test.js. */

const path = require('path');
const {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { id } = require('../store');

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const isTrue = (v) => v === 'true' || v === '1';

// At 1000 keys per request this bounds a sweep to 5000 objects, matching the
// disk backend's own cap so the two report `complete` at the same scale.
const USAGE_MAX_PAGES = 5;

// Build an S3Client from the S3_* env. Credentials are optional here: when
// S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are unset the SDK's default provider
// chain resolves them (AWS_* env, IAM role, …). A custom endpoint (+ path style)
// covers R2 / MinIO / B2.
function clientFromEnv() {
  const cfg = { region: process.env.S3_REGION || 'us-east-1' };
  if (process.env.S3_ENDPOINT) cfg.endpoint = process.env.S3_ENDPOINT;
  if (isTrue(process.env.S3_FORCE_PATH_STYLE)) cfg.forcePathStyle = true;
  if (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
    cfg.credentials = {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    };
  }
  return new S3Client(cfg);
}

function createS3Storage(opts = {}) {
  const client = opts.client || clientFromEnv();
  const bucket = opts.bucket || process.env.S3_BUCKET;
  // Optional key prefix (e.g. 'uploads/') to namespace objects in a shared
  // bucket. It is an internal detail, not part of the public /uploads/<key> path.
  const prefix = opts.prefix != null ? opts.prefix : (process.env.S3_PREFIX || '');
  const keyOf = (name) => prefix + name;

  async function save(buffer, ext) {
    const name = id() + ext;
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: keyOf(name),
      Body: buffer,
      ContentType: MIME_BY_EXT[ext] || 'application/octet-stream',
    }));
    return '/uploads/' + name;
  }

  async function remove(publicPath) {
    if (!publicPath) return;
    try {
      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: keyOf(path.basename(publicPath)),
      }));
    } catch { /* best effort: a missing object is fine */ }
  }

  // Byte size of one object, or null when it can't be determined (#275). One
  // HeadObject per key: the per-tenant summary that uses this reads an operator-
  // sized set (a tenant's covers), and a HEAD is the only way to size a single
  // object without listing — a bucket-wide ListObjectsV2 would enumerate every
  // tenant's keys to answer a question about one. Best-effort: a missing object
  // or a transport error reports "unknown" rather than failing the lookup.
  async function size(publicPath) {
    if (!publicPath) return null;
    try {
      const out = await client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: keyOf(path.basename(publicPath)),
      }));
      return typeof out.ContentLength === 'number' ? out.ContentLength : null;
    } catch {
      return null;
    }
  }

  // Read one object's bytes, or null when they can't be read (#867). Only the
  // operator's cover re-encode backfill uses this; ordinary serving stays a
  // stream through serve() below rather than a buffer through the app.
  async function read(publicPath) {
    if (!publicPath) return null;
    try {
      const out = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: keyOf(path.basename(publicPath)),
      }));
      // The SDK's own helper when present; otherwise drain the stream, which is
      // also what a test double hands back.
      if (out.Body && typeof out.Body.transformToByteArray === 'function') {
        return Buffer.from(await out.Body.transformToByteArray());
      }
      const chunks = [];
      for await (const chunk of out.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  /* What the bucket actually holds (#941) — see the disk backend for the
     contract. One request per 1000 objects rather than a HeadObject each: the
     listing already carries `Size` per key, which is what makes a bucket-wide
     sweep affordable at all (contrast `uploadUsage`'s per-object HEADs, which
     are per-tenant and far fewer).

     Honours S3_PREFIX, and strips it again so the keys come back in the public
     `/uploads/<key>` shape the database stores. */
  async function usage() {
    let token;
    let objects = 0;
    let bytes = 0;
    const keys = [];
    let complete = true;
    for (let page = 0; page < USAGE_MAX_PAGES; page += 1) {
      let out;
      try {
        out = await client.send(new ListObjectsV2Command({
          Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token,
        }));
      } catch {
        // Best-effort, like size(): a listing we cannot complete reports what it
        // has and says so, rather than failing the whole card.
        return { objects, bytes, complete: false, keys };
      }
      for (const o of out.Contents || []) {
        if (!o.Key || o.Key.endsWith('/')) continue;
        objects += 1;
        bytes += Number(o.Size) || 0;
        keys.push('/uploads/' + o.Key.slice(prefix.length));
      }
      token = out.NextContinuationToken;
      if (!out.IsTruncated || !token) return { objects, bytes, complete, keys };
    }
    complete = false;
    return { objects, bytes, complete, keys };
  }

  // Read-through proxy for GET /uploads/<key>. Mounted behind requireAuth in
  // lib/app.js, so it inherits the same auth gate the disk backend has. basename
  // strips any path traversal; keys are only ever '<id><ext>'.
  async function serve(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.sendStatus(405);
    const key = keyOf(path.basename(req.path));
    let out;
    try {
      out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return res.sendStatus(404);
      }
      return res.sendStatus(502);
    }
    res.type(out.ContentType || MIME_BY_EXT[path.extname(key)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (req.method === 'HEAD') return res.end();
    out.Body.on('error', () => { if (res.headersSent) res.destroy(); else res.sendStatus(502); });
    return out.Body.pipe(res);
  }

  return {
    save, remove, size, read, usage, serve, backend: 's3',
  };
}

module.exports = createS3Storage;
