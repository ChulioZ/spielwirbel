'use strict';

/*
 * Cover-image storage backends (issue #128). The disk backend is the default
 * exercised end-to-end by test/games.test.js already; here we cover both
 * backends' contract directly — save -> serve -> remove — and, crucially, the
 * S3 backend, which is driven with a fake client so it needs no network and no
 * real bucket (mirrors the "stub the network" rule the provider tests follow).
 */

// helpers points DATA_DIR at a fresh temp folder before the store is required,
// so the disk backend writes into an isolated uploads dir.
require('./helpers');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Readable } = require('node:stream');
const express = require('express');
const request = require('supertest');

const store = require('../lib/store');
const disk = require('../lib/storage/disk');
const createS3Storage = require('../lib/storage/s3');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

// Mount a backend's `serve` handler on a bare app so we can drive real HTTP GETs.
function serveApp(storage) {
  const app = express();
  app.use('/uploads', storage.serve);
  return app;
}

// An in-memory stand-in for an S3 client: records the commands it receives and
// keeps objects in a Map. Branches on the SDK command class name.
function fakeS3({ pageSize = 1000 } = {}) {
  const objects = new Map(); // Key -> { body: Buffer, contentType }
  const puts = [];
  const lists = [];
  const client = {
    async send(cmd) {
      const name = cmd.constructor.name;
      const input = cmd.input;
      if (name === 'PutObjectCommand') {
        puts.push({ Key: input.Key, ContentType: input.ContentType });
        objects.set(input.Key, { body: Buffer.from(input.Body), contentType: input.ContentType });
        return {};
      }
      if (name === 'DeleteObjectCommand') {
        objects.delete(input.Key);
        return {};
      }
      if (name === 'GetObjectCommand') {
        const obj = objects.get(input.Key);
        if (!obj) {
          const err = new Error('NoSuchKey');
          err.name = 'NoSuchKey';
          throw err;
        }
        return { Body: Readable.from(obj.body), ContentType: obj.contentType };
      }
      // size() (#275) — a HEAD carries only the metadata, never the bytes.
      if (name === 'HeadObjectCommand') {
        const obj = objects.get(input.Key);
        if (!obj) {
          const err = new Error('NotFound');
          err.name = 'NotFound';
          throw err;
        }
        return { ContentLength: obj.body.length, ContentType: obj.contentType };
      }
      // usage() (#941) — ONE listing per 1000 keys, carrying Size per object, so
      // a bucket-wide sweep costs no HeadObject at all. `lists` records the
      // calls so a test can prove the paging actually paged.
      if (name === 'ListObjectsV2Command') {
        lists.push({ Prefix: input.Prefix, ContinuationToken: input.ContinuationToken });
        const all = [...objects.entries()]
          .filter(([k]) => !input.Prefix || k.startsWith(input.Prefix))
          .map(([k, o]) => ({ Key: k, Size: o.body.length }));
        const from = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
        const page = all.slice(from, from + pageSize);
        const next = from + page.length;
        return {
          Contents: page,
          IsTruncated: next < all.length,
          NextContinuationToken: next < all.length ? String(next) : undefined,
        };
      }
      throw new Error('unexpected command ' + name);
    },
  };
  return { client, objects, puts, lists };
}

/* --------------------------------- disk ----------------------------------- */

test('disk: save writes the file and returns a /uploads path', async () => {
  const p = await disk.save(PNG, '.png');
  assert.match(p, /^\/uploads\/[0-9a-f]+\.png$/);
  const file = path.join(store.UPLOAD_DIR, path.basename(p));
  assert.ok(fs.existsSync(file));
  assert.deepEqual(fs.readFileSync(file), PNG);
});

test('disk: serve streams the bytes, remove deletes them (404 after)', async () => {
  const p = await disk.save(PNG, '.png');
  const app = serveApp(disk);

  const ok = await request(app).get(p);
  assert.equal(ok.status, 200);
  assert.match(ok.headers['content-type'], /image\/png/);
  assert.deepEqual(ok.body, PNG);

  await disk.remove(p);
  assert.ok(!fs.existsSync(path.join(store.UPLOAD_DIR, path.basename(p))));
  const gone = await request(app).get(p);
  assert.equal(gone.status, 404);
});

test('disk: remove is a no-op for a missing/absent path (never throws)', async () => {
  await disk.remove(null);
  await disk.remove('/uploads/does-not-exist.png');
});

// size() backs the operator panel's per-tenant storage figure (#275). It is
// best-effort by contract: an unreadable object must report "unknown" rather
// than fail the whole lookup it is one line of.
test('disk: size reports the bytes, and null for anything it cannot stat', async () => {
  const p = await disk.save(PNG, '.png');
  assert.equal(await disk.size(p), PNG.length);

  assert.equal(await disk.size('/uploads/does-not-exist.png'), null);
  assert.equal(await disk.size(null), null);

  await disk.remove(p);
  assert.equal(await disk.size(p), null);
});

/* ---------------------------------- s3 ------------------------------------ */

test('s3: save PUTs the object with the right key + content-type', async () => {
  const { client, objects, puts } = fakeS3();
  const s3 = createS3Storage({ client, bucket: 'test-bucket' });

  const p = await s3.save(PNG, '.png');
  assert.match(p, /^\/uploads\/[0-9a-f]+\.png$/);
  const key = path.basename(p);
  assert.ok(objects.has(key));
  assert.equal(puts.length, 1);
  assert.equal(puts[0].Key, key);
  assert.equal(puts[0].ContentType, 'image/png');
});

test('s3: a key prefix namespaces objects but not the public path', async () => {
  const { client, objects } = fakeS3();
  const s3 = createS3Storage({ client, bucket: 'test-bucket', prefix: 'covers/' });

  const p = await s3.save(PNG, '.png');
  assert.match(p, /^\/uploads\/[0-9a-f]+\.png$/); // public path has no prefix
  assert.ok(objects.has('covers/' + path.basename(p))); // object key does
});

test('s3: serve streams the object back with its content-type', async () => {
  const { client } = fakeS3();
  const s3 = createS3Storage({ client, bucket: 'test-bucket' });
  const p = await s3.save(PNG, '.png');

  const res = await request(serveApp(s3)).get(p);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /image\/png/);
  assert.match(res.headers['cache-control'], /immutable/);
  assert.deepEqual(res.body, PNG);
});

test('s3: serve 404s a missing key, remove deletes an existing one', async () => {
  const { client } = fakeS3();
  const s3 = createS3Storage({ client, bucket: 'test-bucket' });
  const app = serveApp(s3);

  assert.equal((await request(app).get('/uploads/nope.png')).status, 404);

  const p = await s3.save(PNG, '.png');
  assert.equal((await request(app).get(p)).status, 200);
  await s3.remove(p);
  assert.equal((await request(app).get(p)).status, 404);
});

test('s3: serve rejects non-GET/HEAD with 405', async () => {
  const { client } = fakeS3();
  const s3 = createS3Storage({ client, bucket: 'test-bucket' });
  const res = await request(serveApp(s3)).post('/uploads/whatever.png');
  assert.equal(res.status, 405);
});

test('s3: remove swallows client errors (best effort)', async () => {
  const client = { async send() { throw new Error('network down'); } };
  const s3 = createS3Storage({ client, bucket: 'test-bucket' });
  await s3.remove('/uploads/x.png'); // must not throw
});

test('s3: size HEADs the prefixed key and degrades to null (#275)', async () => {
  const { client } = fakeS3();
  const s3 = createS3Storage({ client, bucket: 'test-bucket', prefix: 'covers/' });

  const p = await s3.save(PNG, '.png');
  assert.equal(await s3.size(p), PNG.length);
  // The public path never carries the prefix, so size() must rebuild the key the
  // same way serve/remove do — otherwise every object reads as "unknown" on a
  // prefixed bucket and the panel silently reports 0 bytes.
  assert.equal(await s3.size('/uploads/missing.png'), null);
  assert.equal(await s3.size(null), null);
});

test('s3: size swallows client errors (best effort, like remove)', async () => {
  const client = { async send() { throw new Error('network down'); } };
  const s3 = createS3Storage({ client, bucket: 'test-bucket' });
  assert.equal(await s3.size('/uploads/x.png'), null);
});

/* ---------------- read(): the backfill's byte source (#867) ---------------- */

test('disk: read returns the bytes, and null for anything it cannot read', async () => {
  const p = await disk.save(PNG, '.png');
  assert.deepEqual(await disk.read(p), PNG);
  assert.equal(await disk.read('/uploads/missing.png'), null);
  assert.equal(await disk.read(null), null);
  await disk.remove(p);
});

test('s3: read returns the bytes from a STREAMING body', async () => {
  const { client } = fakeS3();
  const s3 = createS3Storage({ client, bucket: 'test-bucket', prefix: 'covers/' });
  const p = await s3.save(PNG, '.png');
  // Rebuilds the prefixed key the way serve/remove/size do — on a prefixed
  // bucket a wrong key reads as "missing", and the backfill would report every
  // cover unreadable rather than converting one.
  assert.deepEqual(await s3.read(p), PNG);
});

test('s3: read prefers the SDK helper when the body offers one', async () => {
  // The REAL @aws-sdk body exposes transformToByteArray, so this is the branch
  // production takes — fakeS3 hands back a bare Readable and therefore only ever
  // exercises the stream fallback. Without this case the path that runs against
  // R2 would be the one no test has executed.
  let usedHelper = false;
  const client = {
    async send() {
      return {
        Body: {
          async transformToByteArray() { usedHelper = true; return new Uint8Array(PNG); },
        },
      };
    },
  };
  const s3 = createS3Storage({ client, bucket: 'test-bucket' });
  const out = await s3.read('/uploads/x.png');
  assert.equal(usedHelper, true, 'the helper was used, not the stream fallback');
  assert.ok(Buffer.isBuffer(out), 'a Buffer comes back, not a Uint8Array');
  assert.deepEqual(out, PNG);
});

test('s3: read degrades to null on a missing key or a client error', async () => {
  const { client } = fakeS3();
  assert.equal(await createS3Storage({ client, bucket: 'b' }).read('/uploads/gone.png'), null);

  const broken = { async send() { throw new Error('network down'); } };
  assert.equal(await createS3Storage({ client: broken, bucket: 'b' }).read('/uploads/x.png'), null);
});

test('index: read ignores anything that is not a hosted /uploads path', async () => {
  // Same guard, same reason as size() below: basename() of a hotlinked provider
  // URL (#172) would read OUR object of that name — and here the bytes would
  // then be re-encoded and written over a stranger's cover.
  const storage = require('../lib/storage');
  const p = await storage.save(PNG, '.png');
  assert.deepEqual(await storage.read(p), PNG);

  assert.equal(await storage.read(`https://cf.geekdo-images.com/x/${path.basename(p)}`), null);
  assert.equal(await storage.read(null), null);

  await storage.remove(p);
});

// The seam guard (lib/storage/index.js) applies to size() for the same reason it
// applies to remove(): both backends take path.basename() of what they are
// handed, so a hotlinked provider URL (#172) ending in '/pic123.jpg' would size
// OUR object of that name and report a stranger's bytes as this tenant's.
test('index: size ignores anything that is not a hosted /uploads path', async () => {
  const storage = require('../lib/storage');
  const p = await storage.save(PNG, '.png');
  assert.equal(await storage.size(p), PNG.length);

  assert.equal(await storage.size(`https://cf.geekdo-images.com/x/${path.basename(p)}`), null);
  assert.equal(await storage.size('https://image.api.playstation.com/a/b.png'), null);
  assert.equal(await storage.size(null), null);

  await storage.remove(p);
});

/* ------------------------- usage() — both backends (#941) ------------------ */

test('disk: usage reports objects, bytes and the public keys', async () => {
  const a = await disk.save(PNG, '.png');
  const b = await disk.save(Buffer.concat([PNG, PNG]), '.png');

  const u = await disk.usage();
  assert.ok(u.objects >= 2, `expected at least the two just written, got ${u.objects}`);
  assert.ok(u.bytes >= PNG.length * 3);
  assert.equal(u.complete, true);
  // The PUBLIC shape, not file names: the caller diffs these straight against
  // the `image` values in the database without knowing which backend answered.
  assert.ok(u.keys.includes(a), 'the first object is missing from the key list');
  assert.ok(u.keys.includes(b));
  for (const k of u.keys) assert.match(k, /^\/uploads\//);
  assert.equal(u.keys.length, u.objects, 'objects must be the length of keys');

  await disk.remove(a);
  await disk.remove(b);
});

test('s3: usage pages the listing, honours the prefix, and needs no HeadObject', async () => {
  // pageSize 2 with 5 objects, so the paging is actually exercised rather than
  // returned whole on the first call.
  const { client, lists } = fakeS3({ pageSize: 2 });
  const s3 = createS3Storage({ client, bucket: 'test-bucket', prefix: 'cov/' });
  const saved = [];
  for (let i = 0; i < 5; i += 1) saved.push(await s3.save(PNG, '.png'));

  const u = await s3.usage();
  assert.equal(u.objects, 5);
  assert.equal(u.bytes, PNG.length * 5);
  assert.equal(u.complete, true);
  assert.ok(lists.length >= 3, `expected the listing to page, it made ${lists.length} call(s)`);
  assert.equal(lists[0].Prefix, 'cov/', 'the sweep must honour S3_PREFIX');

  // The prefix is an internal detail: keys come back in the public shape, so
  // they compare against stored `image` values directly.
  for (const k of u.keys) assert.match(k, /^\/uploads\/[^/]+$/);
  assert.deepEqual([...u.keys].sort(), [...saved].sort());
});

test('s3: a listing that fails mid-sweep reports what it has, and says it is incomplete', async () => {
  /* Best-effort like size(): the card is an operator convenience, and a bucket
     we cannot finish listing must report a FLOOR rather than failing the whole
     page — `complete: false` is what stops the panel presenting it as a total. */
  const { client } = fakeS3({ pageSize: 2 });
  const s3 = createS3Storage({ client, bucket: 'test-bucket' });
  for (let i = 0; i < 5; i += 1) await s3.save(PNG, '.png');

  let calls = 0;
  const flaky = { async send(cmd) {
    if (cmd.constructor.name === 'ListObjectsV2Command') {
      calls += 1;
      if (calls > 1) throw new Error('network');
    }
    return client.send(cmd);
  } };
  const broken = createS3Storage({ client: flaky, bucket: 'test-bucket' });
  const u = await broken.usage();
  assert.equal(u.complete, false, 'a truncated sweep must not claim to be complete');
  assert.equal(u.objects, 2, 'it reports the page it did get');
});
