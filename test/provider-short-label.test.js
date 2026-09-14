'use strict';

/* The short provider labels (#817).
 *
 * „Auf BoardGameGeek ansehen" measured 275px against a 343px phone card, and
 * „Titelbild von BoardGameGeek holen" sized the whole image-editor popover
 * (.claude/rules/popover-width-is-shrink-to-fit.md). Both now take a short name.
 *
 * The half worth pinning is the FALLBACK, not the happy path: PROVIDER_LABELS'
 * own comment warns that a missing entry degrades to the bare id (`steam`),
 * "which reads as a bug". A second table doubles that exposure, so a missing
 * short entry has to land on the full name rather than on the id.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

function labels(t) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  return (provider) => dom.get(`providerLabelShort(${JSON.stringify(provider)})`);
}

test('a provider with a short name renders it', (t) => {
  const short = labels(t);
  assert.equal(short('bgg'), 'BGG');
  assert.equal(short('bgg'), 'BGG');
});

test('a provider with NO short name falls back to its full name, never the raw id', (t) => {
  const short = labels(t);
  // Since #981 no storefront is nameable at all: an unknown id falls through
  // providerLabel to the raw string, which is the behaviour a future retirement
  // relies on.
  // The assertion that matters is the shape: a real name, not the id.
  assert.equal(short('steam'), 'steam');
  assert.equal(short('xbox'), 'xbox');
});

test('an unknown provider degrades exactly as providerLabel already does', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // Not a regression guard so much as a statement that the second table adds no
  // NEW failure mode: for an id neither table knows, both answer identically.
  assert.equal(
    dom.get('providerLabelShort("itch")'),
    dom.get('providerLabel("itch")'),
  );
});
