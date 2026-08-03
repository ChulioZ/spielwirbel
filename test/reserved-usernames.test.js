'use strict';

/* The reserved-handle policy itself (public/js/reserved-usernames.js), unit-tested
   away from the register route that applies it.
 *
 * The assertion that matters most here is the boring one: every entry of
 * RESERVED_USERNAMES is compared against a NORMALISED handle, so an entry that is
 * not itself normalised (a capital, a hyphen, a digit, or fewer than the 3
 * characters registration demands) can never match anything and silently protects
 * nothing. That failure is invisible from the route's side — the list looks longer
 * than it is, and every test over the entries it *can* match stays green.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  RESERVED_USERNAMES,
  RESERVED_FRAGMENTS,
  normalizeUsername,
  isReservedUsername,
} = require('../public/js/reserved-usernames');

test('every reserved word is in the form a normalised handle can actually equal', () => {
  // Anti-vacuous: a gutted list would satisfy every for-of below by iterating zero
  // times, and the route would still answer 200 for `admin`.
  assert.ok(RESERVED_USERNAMES.size >= 20, `expected a real list, got ${RESERVED_USERNAMES.size} entries`);

  for (const word of RESERVED_USERNAMES) {
    assert.match(word, /^[a-z]{3,30}$/, `"${word}" can never match a normalised handle`);
  }
  for (const fragment of RESERVED_FRAGMENTS) {
    assert.match(fragment, /^[a-z]{3,30}$/, `fragment "${fragment}" can never match a normalised handle`);
  }
});

test('normalising strips the case, the separators and the digits', () => {
  assert.equal(normalizeUsername('Ad-Min'), 'admin');
  assert.equal(normalizeUsername('ADMIN_'), 'admin');
  assert.equal(normalizeUsername('admin2026'), 'admin');
  assert.equal(normalizeUsername('a-d-m-i-n'), 'admin');
  // A handle made only of digits and separators normalises to nothing. It must
  // read as "not reserved" rather than as an empty match against the list.
  assert.equal(normalizeUsername('12-34'), '');
  assert.equal(normalizeUsername(''), '');
  assert.equal(normalizeUsername(null), '');
  assert.equal(normalizeUsername(undefined), '');
});

test('every reserved word is refused, in every spelling the charset allows', () => {
  for (const word of RESERVED_USERNAMES) {
    assert.equal(isReservedUsername(word), true, `"${word}" must be reserved`);
    assert.equal(isReservedUsername(word.toUpperCase()), true, `"${word}" upper-cased must be reserved`);
    assert.equal(isReservedUsername(`${word}-2026`), true, `"${word}-2026" must be reserved`);
    assert.equal(isReservedUsername(`_${word}_`), true, `"_${word}_" must be reserved`);
  }
});

test('the brand is refused anywhere in a handle, not just as the whole of it', () => {
  for (const name of [
    'spielwirbel', 'Spielwirbel', 'SPIELWIRBEL',
    'spielwirbel-team', 'Spielwirbel_Support', 'spiel-wirbel',
    'derspielwirbel', 'spielwirbel2026', 'ich-bin-spielwirbel-official',
  ]) {
    assert.equal(isReservedUsername(name), true, `"${name}" must be reserved`);
  }
});

test('a handle that merely CONTAINS a reserved word is left alone', () => {
  // Only the brand gets containment. Role words cannot, because ordinary words
  // contain them — and a refusal at registration is a dead end the person hitting
  // it cannot debug, so a false positive costs more than a missed near-miss.
  for (const name of [
    'badminton', 'Modernista', 'GameModder', 'nomadic', 'Administer',
    'admin-gaming', 'mod-tobi', 'teamchaos', 'supportive', 'infobroker',
    // Handles the rest of the suite registers, plus the two length bounds of the
    // charset — this policy must not narrow what #320 accepts beyond its own list.
    'ada', 'abc', 'a-B_9', 'probe1', 'owner', 'TakenName', 'Anna_91',
    'realuser', 'reg_user_1', 'someone-else', 'notademo', 'z'.repeat(30),
    // Neither a demo account's generated handle nor the operator's forced rename
    // may collide: both are written straight through the repo, so a collision
    // would not fail — it would just make this list quietly wrong about itself.
    'demo-a1b2c3d4', 'demo-12345678', 'user-3b58bac60038176b',
    '', '   ', '123',
  ]) {
    assert.equal(isReservedUsername(name), false, `"${name}" must stay available`);
  }
});
