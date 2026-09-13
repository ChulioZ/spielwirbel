'use strict';

/* The operator router's composition (#996).
 *
 * `lib/routes/admin.js` was 1124 lines self-labelling sixteen sections, four of
 * them separately-owned bodies of work with disjoint rule and doc files. It is
 * now `lib/routes/admin/`, composed by `index.js`.
 *
 * WHAT THIS PINS is the one thing a split can lose silently: a sub-router that
 * exists and is never mounted. Every one of its routes then 404s, and nothing
 * else in the suite can tell that apart from the feature not existing —
 * `test/admin.test.js` drives the routes it knows about, so a NEW section
 * forgotten at the mount would simply have no test. Same shape as
 * `ci-passed`'s `needs` list (.claude/rules/ci-aggregate-gate.md) and `MOUNTS`
 * in test/round-roles.test.js: the enumeration is what rots, so it is asserted
 * against the filesystem rather than restated.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'lib', 'routes', 'admin');
// `shared.js` exports schemas, not a router, and `index.js` is the composer.
const NOT_ROUTERS = new Set(['index.js', 'shared.js']);

test('index.js mounts every sub-router in the directory', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && !NOT_ROUTERS.has(f));
  assert.ok(files.length >= 6, `found only ${files.length} sub-routers — the scan has drifted`);

  const index = fs.readFileSync(path.join(DIR, 'index.js'), 'utf8');
  const mounted = [...index.matchAll(/router\.use\(require\('\.\/([\w-]+)'\)\)/g)].map((m) => m[1] + '.js');
  assert.deepEqual(files.filter((f) => !mounted.includes(f)), [],
    'these sub-routers exist but are never mounted — every route in them 404s');
  // The other direction: a mount naming a file that was merged away throws at
  // boot, which is loud — but it would throw on the FIRST request in a dev
  // server and only then, so pin it here too.
  assert.deepEqual(mounted.filter((f) => !files.includes(f)), []);
});

test('every sub-router exports an express Router and takes no gate of its own', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && !NOT_ROUTERS.has(f));
  for (const file of files) {
    const mod = require(path.join(DIR, file));
    assert.equal(typeof mod, 'function', `${file} does not export a router`);
    assert.ok(Array.isArray(mod.stack), `${file} exports something that is not an express Router`);
    // The ADMIN_PASSWORD gate lives once, in index.js, ahead of the mounts. A
    // sub-router applying it again would be harmless today and would quietly
    // become the place someone reads the gate from — and then removing it from
    // index.js would look safe.
    const text = fs.readFileSync(path.join(DIR, file), 'utf8');
    assert.doesNotMatch(text, /requireAdmin/, `${file} re-applies the gate; index.js owns it`);
  }
});

test('the gate is applied once, before the mounts', () => {
  const index = fs.readFileSync(path.join(DIR, 'index.js'), 'utf8');
  const gate = index.indexOf('router.use(admin.requireAdmin)');
  const firstMount = index.indexOf("router.use(require('./");
  assert.notEqual(gate, -1, 'the ADMIN_PASSWORD gate is gone from the composer');
  assert.notEqual(firstMount, -1);
  assert.ok(gate < firstMount,
    'the sub-routers mount BEFORE the gate, so every one of their routes is unauthenticated');
  assert.equal(index.split('router.use(admin.requireAdmin)').length - 1, 1, 'applied exactly once');
});
