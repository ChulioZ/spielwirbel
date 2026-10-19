'use strict';

/*
 * The Chronik's action row (#1680): „Session nachtragen" (#1616) and „Partien
 * importieren" (#1665) live in ONE wrapper directly after the filter chips, in
 * reading order. They used to be two bare siblings inserted with repeated
 * `chips.after()` — reversed insertion, each with a hand-tuned margin that
 * assumed its neighbour, so the import button kept a stray indent when it
 * stood alone.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./support/dom');
const { ROOT, rulesOf, topLevel, bodyOf, whole } = require('./support/css');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);

const roundFixture = (games) => ({
  id: 'r1', name: 'Freitagsrunde', background: null,
  members: [{ id: 'm1', name: 'Anna' }], games, sessions: [],
});

const render = (games) => {
  dom.app.innerHTML = '';
  dom.call('renderChronikTab', roundFixture(games), []);
  return dom.app.querySelector('.chronik-actions');
};
const classesOf = (row) => [...row.children].map((b) => b.classList.contains('chronik-log') ? 'log' : b.classList.contains('chronik-import') ? 'import' : b.className);

test('both actions sit in one row right after the chips, log first', () => {
  const row = render([{ id: 'g1', title: 'Catan', minPlayers: 2, maxPlayers: 4 }]);
  assert.ok(row, 'the wrapper exists');
  assert.ok(row.previousElementSibling.classList.contains('filter-chips'), 'directly after the chips');
  assert.deepEqual(classesOf(row), ['log', 'import']);
  assert.equal(dom.app.querySelectorAll('.chronik-log, .chronik-import').length, 2, 'no stray copy outside the row');
});

test('an empty shelf leaves the import alone in the row', () => {
  const row = render([{ id: 'g3', title: 'Agricola', retired: true }]);
  assert.ok(row, 'the wrapper exists without a loggable game');
  assert.deepEqual(classesOf(row), ['import']);
});

// jsdom applies no stylesheet, so the spacing half is pinned on the text.
test('the row owns the spacing: one wrapping flex line, no margin on either button', () => {
  const row = bodyOf('.chronik-actions', rulesOf(topLevel()));
  assert.ok(row, 'the row has an unconditional rule');
  assert.match(row, /display:\s*flex/);
  assert.match(row, /flex-wrap:\s*wrap/);
  assert.match(row, /gap:/);
  // A margin on a button is what indented a lone import button (#1680), and it
  // would come back from any sheet, so every design stylesheet is read too.
  const sheets = [path.join(ROOT, 'public/styles.css'),
    ...fs.readdirSync(path.join(ROOT, 'public/css/designs')).map((f) => path.join(ROOT, 'public/css/designs', f))];
  assert.ok(sheets.length > 1, 'the design sheets were found');
  const offenders = sheets.flatMap((file) => rulesOf(fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
    .filter(([sel, body]) => /(^|;|\s)margin(-[a-z]+)?\s*:/.test(body)
      && sel.split(',').some((s) => [whole('.chronik-log'), whole('.chronik-import')].some((re) => re.test(s.trim().split(/\s+/).pop()))))
    .map(([sel]) => `${path.basename(file)}: ${sel}`));
  assert.deepEqual(offenders, []);
});
