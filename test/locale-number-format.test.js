'use strict';

/*
 * Rating averages are written in the READER's notation (#850).
 *
 * Every Ø the app prints used to go through `Number.prototype.toFixed(1)`, which
 * is locale-independent by definition and always emits a dot — so four of the
 * five shipped locales read "Ø 3.7" where their own convention is "Ø 3,7". The
 * correct helper already existed on one screen (`/entdecken`, #786) and never
 * made it out of that file; `fmtAvg` in i18n.js is that helper, hoisted.
 *
 * The specs below are deliberately split in two, because either half alone is
 * satisfiable by a wrong implementation:
 *
 *   - the FORMATTER half pins the notation per locale, but says nothing about
 *     whether any screen calls it;
 *   - the VIEW half renders a real screen twice and pins that the two locales
 *     DISAGREE — which a `fmtAvg` hard-wired to one locale would fail, and which
 *     a German-only assertion could never see.
 *
 * The German assertions scattered through the other view specs (pokale-retired,
 * table-builder-view, vote-zero-counts, game-info-view, session-share) are the
 * regression net for the individual call sites; those run under `loadApp`'s
 * default locale, which is `de`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SUPPORTED_LOCALES } = require('../public/js/locales');
const { loadI18n, loadApp } = require('./support/dom');

/* --------------------------- the formatter itself -------------------------- */

test('fmtAvg writes a rating in the active locale, one decimal always', () => {
  const de = loadI18n('de');
  const en = loadI18n('en');

  assert.equal(de.fmtAvg(3.7), '3,7');
  assert.equal(en.fmtAvg(3.7), '3.7');

  // The one-decimal pin. Without minimumFractionDigits a whole average renders
  // as "4", which reads as a COUNT rather than as a rating out of five.
  assert.equal(de.fmtAvg(4), '4,0');
  assert.equal(en.fmtAvg(4), '4.0');
});

test('every shipped locale formats a rating without throwing', () => {
  /* Derived from the shipped set, never a hand-written ['de', 'en'] — a copy
     here goes one locale stale the moment a sixth ships
     (.claude/rules/locale-set-is-data.md). Note this loop is deliberately NOT
     the whole guard: it would pass against a fmtAvg that ignored the locale
     entirely, which is what the disagreement assertion below exists for. */
  const seen = new Set();
  for (const code of SUPPORTED_LOCALES) {
    const out = loadI18n(code).fmtAvg(3.7);
    assert.match(out, /^3[.,]7$/, `locale '${code}' rendered '${out}'`);
    seen.add(out);
  }
  assert.ok(
    seen.size > 1,
    `every shipped locale rendered the same string (${[...seen]}) — fmtAvg is ignoring the locale`
  );
});

test('a value Intl cannot format degrades instead of taking the screen down', () => {
  const de = loadI18n('de');
  // Same reasoning as fmtMoney/localeTag: a label must never throw a whole
  // view away. `null`/undefined reach this from an unrated game's stats.
  assert.equal(de.fmtAvg(null), '');
  assert.equal(de.fmtAvg(undefined), '');
  assert.equal(de.fmtAvg(NaN), '');
});

/* ------------------------------ a real screen ------------------------------ */

const RID = 'r1';

const ROUND = {
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  // Anna 5 + Ben 4 -> Ø 4.5, which differs in notation between the two locales
  // and is not a whole number, so it cannot pass by way of the one-decimal pin.
  games: [{ id: 'g1', title: 'Catan', tagIds: [] }],
  sessions: [{
    id: 's1',
    createdAt: '2026-07-01T20:00:00.000Z',
    gameIds: ['g1'],
    memberIds: ['m1', 'm2'],
    votes: { m1: { g1: { rating: 5 } }, m2: { g1: { rating: 4 } } },
    votedIds: ['m1', 'm2'],
    finished: true,
    cancelled: false,
    done: true,
    winnerIds: ['m1'],
    chosenGameId: 'g1',
    events: [],
  }],
};

async function regalPill(t, locale) {
  const dom = loadApp({ locale });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return ROUND;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  await dom.call('showRound', RID, 'regal');
  const pill = dom.app.querySelector('.score-pill');
  assert.ok(pill, `no score pill rendered on the '${locale}' Regal`);
  return pill.textContent.trim();
}

test('the Regal pill is written in the reader\'s notation, and the locales disagree', async (t) => {
  const de = await regalPill(t, 'de');
  const en = await regalPill(t, 'en');

  assert.equal(de, 'Ø 4,5');
  assert.equal(en, 'Ø 4.5');
  // The load-bearing half: a fmtAvg wired to a single locale, or a call site
  // still on toFixed(1), makes these two equal while each individual assertion
  // above could still be written to pass.
  assert.notEqual(de, en, 'the German and English pills rendered identically');
});
