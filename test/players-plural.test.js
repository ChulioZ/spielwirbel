'use strict';

/*
 * The player-count tag must read grammatically for a count of 1 ("1 Person" /
 * "1 player", not "1 Personen" / "1 players"). playersText (public/js/core.js)
 * picks the key via the tn() plural helper, so we load the real i18n.js and the
 * two language files in a vm sandbox and assert the rendered strings.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// The real i18n.js over the real lang tables, in a vm sandbox (test/support/dom.js).
const { loadI18n } = require('./support/dom');

test('players.single/players.one render the right grammatical number', () => {
  const ctx = loadI18n();
  const players = (loc, min, max) => {
    ctx.setLocale(loc);
    return min === max
      ? ctx.tn(min, 'players.one', 'players.single', { n: min })
      : ctx.t('players.range', { min, max });
  };

  assert.equal(players('de', 1, 1), '1 Person');
  assert.equal(players('de', 3, 3), '3 Personen');
  assert.equal(players('de', 1, 4), '1–4 Personen');

  assert.equal(players('en', 1, 1), '1 player');
  assert.equal(players('en', 3, 3), '3 players');
  assert.equal(players('en', 1, 4), '1–4 players');
});
