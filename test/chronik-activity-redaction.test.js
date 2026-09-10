'use strict';

/* The Chronik's wording when a cross-round reference has been redacted (#1007).
 *
 * GET …/activities strips `roundName`/`roundId` from the four bulk move/copy
 * events for a grantee who holds no grant on the round they point at, so the
 * view has to have something to say when the name is absent. Without the
 * fallback it interpolated `undefined` into „{n} Spiele aus „{round}“ übernommen"
 * — a redaction that leaks nothing but renders visibly broken.
 *
 * Driven through the jsdom harness (`.claude/rules/testing-views-under-jsdom.md`)
 * rather than asserted over the view's source: what matters is which of the two
 * key pairs the render reaches for, and only running it can see that.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const round = { id: 1, name: 'Freitagsrunde', members: [], games: [], sessions: [] };

// One of each of the four events, redacted (no roundName/roundId) — exactly the
// shape the route hands a grantee.
const REDACTED = [
  { id: 'r1', type: 'games_moved_in', at: '2026-08-12T09:00:00.000Z', count: 3 },
  { id: 'r2', type: 'games_moved_out', at: '2026-08-11T09:00:00.000Z', count: 2 },
  { id: 'r3', type: 'games_copied_in', at: '2026-08-10T09:00:00.000Z', count: 4 },
  { id: 'r4', type: 'games_copied_out', at: '2026-08-09T09:00:00.000Z', count: 1 },
];

const texts = (dom, activities) => {
  dom.app.innerHTML = '';
  dom.call('renderChronikTab', round, activities);
  // .tl-act__text is the label alone — the row also carries the timestamp.
  return [...dom.app.querySelectorAll('.timeline .tl-act__text')].map((el) => el.textContent);
};

const boot = (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  return dom;
};

test('a redacted move/copy event names no round, and never renders "undefined"', (t) => {
  const rendered = texts(boot(t), REDACTED);
  assert.equal(rendered.length, 4, 'all four events still render');

  const joined = rendered.join(' | ');
  assert.equal(/undefined/.test(joined), false, `no interpolated undefined — got ${joined}`);
  // The quote marks are the tell: they belong to the NAMED wording only, so
  // finding one means the view took the wrong branch even if the rest reads fine.
  assert.equal(/[„“]/.test(joined), false, `no quoted round name — got ${joined}`);

  assert.deepEqual(rendered, [
    '3 Spiele aus einer anderen Runde übernommen',
    '2 Spiele in eine andere Runde verschoben',
    '4 Spiele aus einer anderen Runde kopiert',
    '1 Spiel in eine andere Runde kopiert',
  ]);
});

test('an unredacted event still names the round — the owner`s view is unchanged', (t) => {
  const named = REDACTED.map((a) => ({ ...a, roundId: 9, roundName: 'Therapiegruppe' }));
  const rendered = texts(boot(t), named);

  assert.deepEqual(rendered, [
    '3 Spiele aus „Therapiegruppe“ übernommen',
    '2 Spiele nach „Therapiegruppe“ verschoben',
    '4 Spiele aus „Therapiegruppe“ kopiert',
    '1 Spiel nach „Therapiegruppe“ kopiert',
  ]);
});
