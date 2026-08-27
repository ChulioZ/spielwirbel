'use strict';

/* Count-bearing strings must inflect at n = 1 (#833).
 *
 * Nine strings interpolated a number into a grammatically PLURAL sentence with
 * plain t(), so „1 Spiele bewertet" / "1 games rated" reached the screen in
 * every shipped locale. It is not an edge case: a session's gameIds holds
 * exactly one entry on two code paths that always produce it — direct-pick mode
 * (lib/routes/sessions.js) and every child session of a table split
 * (lib/session-split.js).
 *
 * Two layers here, because neither sees the other's failure:
 *
 *  - The Chronik card is rendered through the jsdom harness
 *    (`.claude/rules/testing-views-under-jsdom.md`). That is the reported bug,
 *    and it is the only assertion that can see the CALL SITE — a spec over the
 *    keys alone stays green while views-chronik.js still calls t().
 *  - The wording table drives the real i18n.js over the real lang tables
 *    (the test/players-plural.test.js shape) for the other eight, whose views
 *    need a page of fixture each to reach one line of text.
 *
 * The table is de + en only on purpose. It states a claim about GRAMMAR, and
 * those are the two languages this repo can assert one in; es/fr/it are held to
 * the structural half instead, which test/i18n-parity.test.js already enforces
 * over every locale — key parity, placeholder parity, and (the trap this issue
 * is most likely to be got wrong by) that a singular substitutes {n} rather
 * than spelling out a literal „1", because French routes 0 to the SINGULAR.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, loadI18n } = require('./support/dom');

/* Each row: the tn() pair as the view calls it, plus what it must read.
   `{n}` is injected by tn() itself, so params here carry only the others. */
const PAIRS = [
  {
    what: 'sessions.rated — the Chronik session card',
    one: 'sessions.ratedOne', other: 'sessions.rated', params: {},
    de: ['1 Spiel bewertet', '2 Spiele bewertet'],
    en: ['1 game rated', '2 games rated'],
  },
  {
    what: 'result.subtitle — the session-result and table-result headers',
    one: 'result.subtitleOne', other: 'result.subtitle', params: { when: '7. Aug' },
    de: ['7. Aug · 1 Spiel', '7. Aug · 2 Spiele'],
    en: ['7. Aug · 1 game', '7. Aug · 2 games'],
  },
  {
    what: 'stats.rated — the best-rated stat card',
    one: 'stats.ratedOne', other: 'stats.rated', params: { avg: '4,6' },
    de: ['4,6 von 5 — 1 Bewertung', '4,6 von 5 — 2 Bewertungen'],
    en: ['4,6 out of 5 — 1 rating', '4,6 out of 5 — 2 ratings'],
  },
  {
    what: 'lobby.closeConfirm — closing the lobby with votes outstanding',
    one: 'lobby.closeConfirmOne', other: 'lobby.closeConfirm', params: {},
    de: ['Es fehlt noch 1 Stimme. Abstimmung trotzdem beenden?',
      'Es fehlen noch 2 Stimmen. Abstimmung trotzdem beenden?'],
    en: ['1 vote is still missing. End voting anyway?',
      '2 votes are still missing. End voting anyway?'],
  },
  {
    what: 'voteLink.doneProgress — the shared vote link, after voting',
    one: 'voteLink.doneProgressOne', other: 'voteLink.doneProgress', params: { total: 4 },
    de: ['1 von 4 hat abgestimmt. Das Ergebnis zeigt die Runde am Tisch.',
      '2 von 4 haben abgestimmt. Das Ergebnis zeigt die Runde am Tisch.'],
    en: ['1 of 4 has voted. The group reveals the result at the table.',
      '2 of 4 have voted. The group reveals the result at the table.'],
  },
  {
    what: 'startSession.tableCount — the seat picker centre',
    one: 'startSession.tableCountOne', other: 'startSession.tableCount', params: {},
    de: ['1 spielt mit', '2 spielen mit'],
    en: ['1 playing', '2 playing'],
  },
  {
    what: 'rec.more — the retire-recommendation overflow line',
    one: 'rec.moreOne', other: 'rec.more', params: {},
    de: ['… und 1 weiteres', '… und 2 weitere'],
    en: ['… and 1 more', '… and 2 more'],
  },
  {
    what: 'gameInfo.listMore — the capped category/mechanic list',
    one: 'gameInfo.listMoreOne', other: 'gameInfo.listMore', params: {},
    de: ['+1 weitere', '+2 weitere'],
    en: ['+1 more', '+2 more'],
  },
  {
    what: 'newRound.importOption — the "copy an existing shelf" dropdown',
    one: 'newRound.importOptionOne', other: 'newRound.importOption', params: { name: 'Freitagsrunde' },
    de: ['Freitagsrunde (1 Spiel)', 'Freitagsrunde (2 Spiele)'],
    en: ['Freitagsrunde (1 game)', 'Freitagsrunde (2 games)'],
  },
];

test('every count-bearing string inflects at n = 1', () => {
  const ctx = loadI18n();
  for (const row of PAIRS) {
    for (const loc of ['de', 'en']) {
      ctx.setLocale(loc);
      const [singular, plural] = row[loc];
      assert.equal(ctx.tn(1, row.one, row.other, row.params), singular, `${loc}: ${row.what} at n = 1`);
      assert.equal(ctx.tn(2, row.one, row.other, row.params), plural, `${loc}: ${row.what} at n = 2`);
    }
  }
});

/* A key that does not exist falls back to its own NAME, which reads as a
   plausible-looking dotted string rather than as an error — so a missing
   singular would satisfy a laxer assertion above. Pin it separately: this is
   what goes red first if a locale file is edited and one of the five is
   forgotten (i18n-parity catches that too, from the other direction). */
test('the singular keys resolve in every locale, and none is a fallback to the key name', () => {
  for (const loc of require('../public/js/locales').SUPPORTED_LOCALES) {
    const ctx = loadI18n(loc);
    for (const row of PAIRS) {
      const s = ctx.t(row.one);
      assert.notEqual(s, row.one, `${loc}: '${row.one}' is missing — t() fell back to the key name`);
      assert.ok(s.includes('{n}'), `${loc}: '${row.one}' must substitute {n}, not spell out a literal 1`);
    }
  }
});

/* The call site, not just the key. views-chronik.js is the screen the bug was
   reported on, and rendering it is the only thing here that can tell a
   converted t() from an unconverted one. */
const chronikRound = (gameIds) => ({
  id: 1,
  name: 'Freitagsrunde',
  members: [{ id: 1, name: 'Anna' }],
  games: [{ id: 10, title: 'Azul' }, { id: 11, title: 'Cascadia' }],
  sessions: [{
    id: 100, done: true, finished: true,
    createdAt: '2026-08-10T18:00:00.000Z', gameIds, winnerIds: [1],
  }],
});

function ratedLine(dom, gameIds) {
  dom.app.innerHTML = '';
  dom.call('renderChronikTab', chronikRound(gameIds), []);
  return dom.app.querySelector('.timeline .session-card').textContent;
}

test('a one-game session card reads „1 Spiel bewertet", a two-game one „2 Spiele bewertet"', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());

  const one = ratedLine(dom, [10]);
  assert.match(one, /1 Spiel bewertet/, `one-game card read: ${JSON.stringify(one)}`);
  assert.doesNotMatch(one, /1 Spiele bewertet/, 'the reported bug');

  assert.match(ratedLine(dom, [10, 11]), /2 Spiele bewertet/);
});

/* French routes 0 to the SINGULAR category, and two of the nine reach it: the
   seat picker before anyone is seated (joining.size + extra === 0) and an
   importable round with an empty shelf. So the singular is not only the n = 1
   form — it is also what a French reader sees at zero, which is why it has to
   substitute {n} rather than read "1". This is the same claim i18n-parity makes
   structurally over every key; here it is pinned on the two reachable ones. */
test('a French zero renders through the singular with the actual number in it', () => {
  const fr = loadI18n('fr');
  assert.equal(fr.tn(0, 'startSession.tableCountOne', 'startSession.tableCount'), '0 à jouer');
  assert.equal(
    fr.tn(0, 'newRound.importOptionOne', 'newRound.importOption', { name: 'Vendredi' }),
    'Vendredi (0 jeu)'
  );

  // German sends 0 to the plural instead — the same call, the other branch.
  const de = loadI18n('de');
  assert.equal(de.tn(0, 'startSession.tableCountOne', 'startSession.tableCount'), '0 spielen mit');
});
