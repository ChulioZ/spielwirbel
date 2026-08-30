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
const { filterPanelKit } = require('./support/filter-panel');

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

/* ------------------------ the complexity filter (#855) ---------------------- */

/* The second view-half call site. The complexity bounds became half steps in
   #855, which is the moment their labels started needing a decimal separator at
   all — an integer ladder reads identically in every locale, so nothing here
   could have gone wrong before and nothing was watching. */

const FILTER_ROUND = {
  id: 'fr1',
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  sessions: [],
  // One described game is enough to make the panel offer the weight control at
  // all — `metadataFilterOptions` derives the rows from the shelf.
  games: [{ id: 'g1', title: 'Catan', tagIds: [], weight: 3, minPlaytime: 60, minAge: 10 }],
};

async function weightLabels(t, locale) {
  const dom = loadApp({ locale });
  t.after(() => dom.close());
  const { openPanel } = filterPanelKit(dom);
  dom.set('isLoggedIn', () => false);
  await dom.call('showStartSession', { ...FILTER_ROUND, games: FILTER_ROUND.games.map((g) => ({ ...g })) });
  openPanel();

  const selects = [...dom.document.querySelectorAll('.mfilter__range .mfilter__select')];
  assert.equal(selects.length, 2, `the '${locale}' panel carries no complexity bounds`);
  const options = [...selects[0].options];
  // Drive the bound the way a user does, so the applied chip is real output and
  // not a hand-built string.
  selects[0].value = '2.5';
  selects[0].dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const chip = dom.document.querySelector('.fbar__chips .fchip__label');
  assert.ok(chip, `no applied chip on the '${locale}' panel`);

  return {
    // The machine string stays locale-independent, or a German reader's pick
    // cannot round-trip through `Number(sel.value)`.
    values: options.map((o) => o.value),
    labels: options.slice(1).map((o) => o.textContent),
    chip: chip.textContent,
  };
}

test('the complexity steps are written in the reader\'s notation, and the locales disagree', async (t) => {
  const de = await weightLabels(t, 'de');
  const en = await weightLabels(t, 'en');

  assert.deepEqual(de.values, ['', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5'],
    'the <option value> attributes must stay bare numbers in every locale');
  assert.deepEqual(en.values, de.values);

  assert.deepEqual(de.labels, ['1,0', '1,5', '2,0', '2,5', '3,0', '3,5', '4,0', '4,5', '5,0']);
  assert.deepEqual(en.labels, ['1.0', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0']);

  assert.match(de.chip, /2,5/, `the German chip read ${JSON.stringify(de.chip)}`);
  assert.match(en.chip, /2\.5/, `the English chip read ${JSON.stringify(en.chip)}`);

  // The load-bearing half, exactly as above: a label built from the raw `${v}`,
  // or an fmtAvg wired to one locale, makes these pairs equal while each
  // individual assertion could still be written to pass.
  assert.notEqual(de.labels.join(), en.labels.join(), 'the option labels rendered identically');
  assert.notEqual(de.chip, en.chip, 'the applied chips rendered identically');
});

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
