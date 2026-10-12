'use strict';

// „Einfacher Modus" (#1646): the shared predicate and its two toggles, required
// straight from the file the Konto screen, the route and both backends use.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SIMPLE_MODE_FEATURES, SIMPLE_MODE_GROUPS, normalizeSimpleMode, simpleModeHides,
  simpleModeParentState, simpleModeToggleAll, simpleModeToggle, tallySimpleMode,
} = require('../public/js/simple-mode');

test('the feature list is the thirteen options, each in exactly one group', () => {
  assert.equal(SIMPLE_MODE_FEATURES.length, 13);
  assert.equal(new Set(SIMPLE_MODE_FEATURES).size, 13, 'an id appears twice');
  assert.deepEqual(SIMPLE_MODE_GROUPS.flatMap((g) => g.features), SIMPLE_MODE_FEATURES);
});

test('an absent, legacy or junk value normalises to OFF', () => {
  for (const v of [undefined, null, true, 'all', [], 7, { all: 'true' }, { except: 'trophies' }]) {
    assert.deepEqual(normalizeSimpleMode(v), { all: false, except: [] }, JSON.stringify(v));
    for (const f of SIMPLE_MODE_FEATURES) assert.equal(simpleModeHides(v, f), false);
  }
});

test('normalising drops unknown ids, dedupes and keeps feature order', () => {
  assert.deepEqual(normalizeSimpleMode({ all: false, except: ['recap', 'nope', 'trophies', 'recap'] }),
    { all: false, except: ['trophies', 'recap'] });
});

test('hidden(f) follows the formula in both directions of `all`', () => {
  const allBut = { all: true, except: ['trophies'] };
  assert.equal(simpleModeHides(allBut, 'trophies'), false);
  assert.equal(simpleModeHides(allBut, 'recap'), true);
  const onlyOne = { all: false, except: ['trophies'] };
  assert.equal(simpleModeHides(onlyOne, 'trophies'), true);
  assert.equal(simpleModeHides(onlyOne, 'recap'), false);
});

test('an "everything off" account hides a feature ADDED LATER without any change', () => {
  // An id outside the list stands in for a feature a later release adds.
  assert.equal(simpleModeHides({ all: true, except: [] }, 'someFutureFeature'), true);
  assert.equal(simpleModeHides({ all: true, except: ['trophies'] }, 'someFutureFeature'), true);
  assert.equal(simpleModeHides({ all: false, except: ['trophies'] }, 'someFutureFeature'), false);
});

test('the parent is off / mixed / on, over the features actually shown', () => {
  assert.equal(simpleModeParentState({ all: false, except: [] }), 'off');
  assert.equal(simpleModeParentState({ all: true, except: [] }), 'on');
  assert.equal(simpleModeParentState({ all: true, except: ['recap'] }), 'mixed');
  assert.equal(simpleModeParentState({ all: false, except: ['recap'] }), 'mixed');
  // An instance without the quiz does not offer it: excepting it changes nothing on screen.
  const shown = SIMPLE_MODE_FEATURES.filter((f) => f !== 'quiz');
  assert.equal(simpleModeParentState({ all: true, except: ['quiz'] }, shown), 'on');
});

test('a parent click is uniform and clears every exception', () => {
  assert.deepEqual(simpleModeToggleAll({ all: false, except: [] }), { all: true, except: [] });
  assert.deepEqual(simpleModeToggleAll({ all: true, except: [] }), { all: false, except: [] });
  assert.deepEqual(simpleModeToggleAll({ all: true, except: ['recap'] }), { all: true, except: [] });
  assert.deepEqual(simpleModeToggleAll({ all: false, except: ['recap'] }), { all: true, except: [] });
});

test('a sub-option click flips exactly that feature, under either value of `all`', () => {
  for (const all of [true, false]) {
    let p = { all, except: [] };
    const before = SIMPLE_MODE_FEATURES.map((f) => simpleModeHides(p, f));
    p = simpleModeToggle(p, 'stats');
    SIMPLE_MODE_FEATURES.forEach((f, i) => assert.equal(simpleModeHides(p, f), f === 'stats' ? !before[i] : before[i], `${all}/${f}`));
    p = simpleModeToggle(p, 'stats');
    assert.deepEqual(p, { all, except: [] }, 'toggling twice is the identity');
  }
});

test('excepting EVERY feature collapses to the opposite — what the screen shows', () => {
  let p = { all: true, except: [] };
  for (const f of SIMPLE_MODE_FEATURES) p = simpleModeToggle(p, f);
  assert.deepEqual(p, { all: false, except: [] }, 'nothing is hidden, so a later feature must not be either');
  p = { all: false, except: [] };
  for (const f of SIMPLE_MODE_FEATURES) p = simpleModeToggle(p, f);
  assert.deepEqual(p, { all: true, except: [] }, 'everything is hidden, so a later feature is too');
});

test('the operator tally counts komplett, any and the EFFECTIVE hide per feature', () => {
  const t = tallySimpleMode([
    { all: true, except: [] }, { all: true, except: ['trophies'] }, { all: false, except: ['recap'] },
    { all: false, except: [] }, undefined,
  ]);
  assert.equal(t.all, 1);
  assert.equal(t.any, 3);
  assert.deepEqual(Object.keys(t.hidden), SIMPLE_MODE_FEATURES);
  assert.equal(t.hidden.trophies, 1);
  assert.equal(t.hidden.recap, 3);
  assert.equal(t.hidden.stats, 2);
});
