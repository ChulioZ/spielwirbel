'use strict';

/* The shared provider field set (public/js/provider-info-fields.js) — here only
   what #1505 added: `designers` as a stored field, and the one helper every
   reader drops BGG's `(Uncredited)` sentinel through. The rest of the module is
   exercised through the backfill, both repo backends and the routes. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROVIDER_INFO_FIELDS, hasProviderField, assignProviderInfo, BGG_UNCREDITED, creditedDesigners,
} = require('../public/js/provider-info-fields');

test('designers is a stored provider field, and an uncredited game still completes', () => {
  assert.ok(PROVIDER_INFO_FIELDS.includes('designers'));
  // The sentinel IS a value — otherwise an uncredited game could never complete
  // and would re-ask BGG once per TTL forever.
  assert.equal(hasProviderField({ designers: [BGG_UNCREDITED] }, 'designers'), true);
  // An empty list is "BGG named none", skipped like a null (values only accrete).
  assert.equal(hasProviderField({ designers: [] }, 'designers'), false);
  assert.deepEqual(assignProviderInfo({ designers: ['Ada'] }, { designers: [] }), { designers: ['Ada'] });
  // A free-text game keeps the key ABSENT, never gains a null or an empty list.
  assert.equal('designers' in assignProviderInfo({}, { designers: null }), false);
});

test('creditedDesigners drops the sentinel and junk, and never throws', () => {
  assert.equal(BGG_UNCREDITED, '(Uncredited)');
  assert.deepEqual(creditedDesigners(['Uwe Rosenberg', BGG_UNCREDITED, '', null, 7]), ['Uwe Rosenberg']);
  assert.deepEqual(creditedDesigners([BGG_UNCREDITED]), []);
  assert.deepEqual(creditedDesigners(undefined), []);
  assert.deepEqual(creditedDesigners('Uwe Rosenberg'), []);
});
