'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computePlaces } = require('../public/js/ranking');

// Helper: build sorted-desc rows from a list of DISPLAYED scores (all rated
// unless a count is given), mirroring what showResults passes in.
const rows = (...shown) => shown.map((n) => ({ shown: n, count: 1 }));

test('no ties: places are 1, 2, 3, …', () => {
  assert.deepEqual(computePlaces(rows(5, 4, 3, 2)), [1, 2, 3, 4]);
});

test('standard competition ranking after a tie ("1, 2, 2, 4")', () => {
  assert.deepEqual(computePlaces(rows(5, 4, 4, 3)), [1, 2, 2, 4]);
});

test('multi-way tie for first (all crowned, all place 1)', () => {
  assert.deepEqual(computePlaces(rows(4, 4, 4)), [1, 1, 1]);
});

test('tie for third spills past the podium', () => {
  assert.deepEqual(computePlaces(rows(5, 4, 3, 3, 2)), [1, 2, 3, 3, 5]);
});

test('everyone tied', () => {
  assert.deepEqual(computePlaces(rows(3, 3, 3, 3)), [1, 1, 1, 1]);
});

test('ties are decided at the displayed one-decimal precision', () => {
  // 4.04 and 4.02 both render as "4.0" → same place; 4.06 renders "4.1".
  assert.deepEqual(computePlaces(rows(4.06, 4.04, 4.02)), [1, 2, 2]);
});

test('unrated rows (count 0) get no place and never medal', () => {
  const input = [
    { shown: 4, count: 2 },
    { shown: 0, count: 0 },
    { shown: 0, count: 0 },
  ];
  assert.deepEqual(computePlaces(input), [1, null, null]);
});

test('two games at the displayed floor share a place (#893)', () => {
  // The score can go negative and every screen clamps at 0,0. Rows arrive
  // sorted by the UNCLAMPED value, so these are in the right order — but they
  // print the same number, so they must not be ranked 1 and 2.
  assert.deepEqual(computePlaces(rows(2.2, 0, 0)), [1, 2, 2]);
});

test('empty input', () => {
  assert.deepEqual(computePlaces([]), []);
});
