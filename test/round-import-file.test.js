'use strict';

/*
 * The browser half of the round import (#1756): reading a picked file — the
 * export's zip or a bare round.json — and the confirmation's counts. fflate is
 * the same package the vendored bundle is a byte-identical copy of
 * (test/round-export.test.js), so the zip here is a real export-shaped zip.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { zipSync, unzipSync, strToU8 } = require('fflate');

const {
  readRoundExport, roundExportSummary, withRoundExportMarker, roundImportSessions,
} = require('../public/js/round-import-file');
const { sessionOutcome, sessionChildIds } = require('../public/js/session-outcome');

const deps = { sessionOutcome, sessionChildIds };
const ROUND = {
  id: 'r', name: 'Spieleabend',
  members: [{ id: 'm', name: 'Ann' }],
  games: [{ id: 'g', title: 'Azul' }, { id: 'h', title: 'Brass' }],
  sessions: [
    { id: 'a', finished: true, chosenGameId: 'g' },
    { id: 'b', finished: false },
    { id: 'p', childSessionIds: ['c'] },
    { id: 'c', parentSessionId: 'p', finished: false },
  ],
};
const file = withRoundExportMarker(ROUND, new Date('2026-11-23T10:00:00Z'));

test('the export zip is read through its round.json', () => {
  const zip = zipSync({ 'games.csv': strToU8('x'), 'round.json': strToU8(JSON.stringify(file)) });
  assert.deepEqual(readRoundExport(zip, unzipSync), file);
});

test('a bare round.json reads too', () => {
  assert.deepEqual(readRoundExport(strToU8(JSON.stringify(file)), unzipSync), file);
});

test('a zip without round.json, a non-round and a newer format each say which', () => {
  const read = (bytes) => { try { readRoundExport(bytes, unzipSync); return null; } catch (e) { return e.message; } };
  assert.equal(read(zipSync({ 'games.csv': strToU8('x') })), 'no_round_json');
  assert.equal(read(strToU8('not json at all')), 'not_a_round');
  assert.equal(read(strToU8(JSON.stringify({ name: 'x' }))), 'not_a_round');
  assert.equal(read(strToU8(JSON.stringify({ ...file, formatVersion: 2 }))), 'newer_format');
});

test('the confirmation counts only the sessions that will arrive', () => {
  // `a` is played; `b` is open; the split `p` goes with its only, open table `c`.
  assert.deepEqual(roundExportSummary(file, deps), { name: 'Spieleabend', games: 2, members: 1, sessions: 1 });
  assert.deepEqual(roundImportSessions(ROUND.sessions, deps).map((s) => s.id), ['a']);
});
