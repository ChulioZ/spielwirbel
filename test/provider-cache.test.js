'use strict';

// lib/provider-cache.js — the shared 10-minute cache for provider hops,
// extracted from lib/routes/lookup.js when the #518 cover refresh became a second
// consumer. The conditional variant is what keeps an unsettled answer ('queued'
// for a collection, "no cover yet" for a refresh) out of the cache, so the
// retry those states invite actually reaches the provider.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cached, cachedIf, TTL_MS } = require('../lib/provider-cache');

// Every test needs its own key: the Map is module-level and lives for the whole
// process, exactly like the real thing.
let n = 0;
const key = () => `test:hop:${n++}`;

test('a second call for the same key does not re-run the hop', async () => {
  const k = key();
  let runs = 0;
  const hop = () => { runs++; return 'value'; };
  assert.equal(await cached(k, hop), 'value');
  assert.equal(await cached(k, hop), 'value');
  assert.equal(runs, 1);
});

test('different keys are independent', async () => {
  let runs = 0;
  const hop = () => { runs++; return 'v'; };
  await cached(key(), hop);
  await cached(key(), hop);
  assert.equal(runs, 2);
});

test('cached() stores an empty answer too — it is a settled result', async () => {
  const k = key();
  let runs = 0;
  const hop = () => { runs++; return []; };
  assert.deepEqual(await cached(k, hop), []);
  assert.deepEqual(await cached(k, hop), []);
  assert.equal(runs, 1, 'an empty search result is worth not re-asking for');
});

test('cachedIf stores only what the predicate accepts', async () => {
  const k = key();
  let runs = 0;
  const ok = (v) => v.state === 'ok';
  let state = 'queued';
  const hop = () => { runs++; return { state }; };

  assert.deepEqual(await cachedIf(k, hop, ok), { state: 'queued' });
  assert.deepEqual(await cachedIf(k, hop, ok), { state: 'queued' });
  assert.equal(runs, 2, 'an unsettled answer must never be served from the cache');

  state = 'ok';
  assert.deepEqual(await cachedIf(k, hop, ok), { state: 'ok' });
  assert.deepEqual(await cachedIf(k, hop, ok), { state: 'ok' });
  assert.equal(runs, 3, 'once settled, it is cached');
});

test('a rejected hop is not cached and propagates to the caller', async () => {
  const k = key();
  let runs = 0;
  const hop = () => { runs++; return Promise.reject(new Error('upstream down')); };
  await assert.rejects(() => cachedIf(k, hop, () => true), /upstream down/);
  await assert.rejects(() => cachedIf(k, hop, () => true), /upstream down/);
  assert.equal(runs, 2, 'a failure must not poison the entry');
});

test('the TTL is the ten minutes the providers are promised', () => {
  assert.equal(TTL_MS, 10 * 60 * 1000);
});
