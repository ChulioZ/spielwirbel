'use strict';

/* The two session orders (#1616, #1622): chronological for the repo's read,
   and newest-first for every list that shows the latest session on top. The
   newest-first half exists because a stable DESCENDING sort keeps tied stamps
   in their ascending insertion order — so two sessions logged for the same
   past day (both stored at 20:00 local) listed the one entered FIRST on top. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { sortSessionsByDate, newestSessionsFirst } = require('../public/js/session-order');

const S = (id, createdAt) => ({ id, createdAt });
const ids = (list) => list.map((s) => s.id);

test('sortSessionsByDate: oldest first, equal stamps keep insertion order', () => {
  const input = [S('c', '2026-03-02T19:00:00.000Z'), S('a', '2026-03-01T19:00:00.000Z'), S('b', '2026-03-01T19:00:00.000Z')];
  assert.deepEqual(ids(sortSessionsByDate(input)), ['a', 'b', 'c']);
  assert.deepEqual(ids(input), ['c', 'a', 'b'], 'the input is left alone');
});

test('newestSessionsFirst: different stamps sort newest first', () => {
  const input = [S('old', '2026-03-01T19:00:00.000Z'), S('new', '2026-03-05T19:00:00.000Z'), S('mid', '2026-03-03T19:00:00.000Z')];
  assert.deepEqual(ids(newestSessionsFirst(input)), ['new', 'mid', 'old']);
});

test('newestSessionsFirst: equal stamps come out last-inserted first', () => {
  const day = '2026-03-01T19:00:00.000Z';
  const input = [S('a', day), S('b', day), S('c', day)];
  assert.deepEqual(ids(newestSessionsFirst(input)), ['c', 'b', 'a']);
  assert.deepEqual(ids(input), ['a', 'b', 'c'], 'the input is left alone');
});

test('newestSessionsFirst: a filtered subset keeps working (no ascending-then-reverse)', () => {
  const day = '2026-03-01T19:00:00.000Z';
  const all = [S('a', day), S('x', '2026-03-09T19:00:00.000Z'), S('b', day)];
  const subset = all.filter((s) => s.id !== 'x');
  assert.deepEqual(ids(newestSessionsFirst(subset)), ['b', 'a']);
  assert.deepEqual(ids(newestSessionsFirst(all)), ['x', 'b', 'a']);
});

test('newestSessionsFirst: a stamp-less row sorts last', () => {
  const input = [{ id: 'none' }, S('a', '2026-03-01T19:00:00.000Z'), { id: 'null', createdAt: null }];
  assert.deepEqual(ids(newestSessionsFirst(input)), ['a', 'null', 'none']);
});

test('newestSessionsFirst: an accessor sorts other rows by their own stamp', () => {
  const day = '2026-03-01T19:00:00.000Z';
  const input = [{ id: 'a', at: day }, { id: 'b', at: day }, { id: 'c', at: '2026-02-01T19:00:00.000Z' }];
  assert.deepEqual(ids(newestSessionsFirst(input, (e) => e.at)), ['b', 'a', 'c']);
});

test('both tolerate a missing list', () => {
  assert.deepEqual(sortSessionsByDate(undefined), []);
  assert.deepEqual(newestSessionsFirst(null), []);
});
