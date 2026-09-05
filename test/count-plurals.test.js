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
 * #838 added four more sites to the scan at the bottom. They are a quieter
 * case: they picked the same key pair with a hand-written `n === 1 ? … : …`,
 * which is already CORRECT for every n they can receive, so no assertion over a
 * reachable input can discriminate the conversion (see the issue). Only one of
 * the four prints its count, so only that one joins the wording table; the other
 * three (carrying two key pairs between them) are held to the call shape
 * alone.
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
    one: 'stats.ratedOne', other: 'stats.rated', params: { score: '4,6' },
    // The number is the Spielwirbel-Score since #914, so the copy must no longer
    // say „von 5"/"out of 5" — the podium is the one surface a logged-out
    // visitor meets it on, and it was the app claiming a mean it stopped using.
    de: ['Score 4,6 — 1 Bewertung', 'Score 4,6 — 2 Bewertungen'],
    en: ['Score 4,6 — 1 rating', 'Score 4,6 — 2 ratings'],
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

/* The other three #838 sites select on a count they never PRINT — the winner
   list's length picks the verb, and the number itself is not in the sentence.
   So they carry no wording claim this file could state: they have no `{n}` to
   substitute, and in English both forms are byte-identical („{names} won!"), so
   a row in the table above would assert precisely nothing.
   What is real about them is the call SHAPE, which is what regresses — hence
   the scan below runs over these as well. */
const SILENT_PAIRS = [
  {
    what: 'home.lastPlayedWon — the round card\'s last-played line',
    one: 'home.lastPlayedWonOne', other: 'home.lastPlayedWonMany',
  },
  {
    // Two call sites, one row: the scan sweeps every file for every row, so a
    // second entry with the same key pair would repeat the work and imply a
    // per-site distinction this test cannot make.
    what: 'result.titleWon — the session-result h1 and the shared summary\'s headline',
    one: 'result.titleWonOne', other: 'result.titleWonMany',
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
    // A real vote per game: since #915 the card omits the „N Spiele bewertet"
    // fragment entirely when nobody voted, so an unvoted fixture would make this
    // spec assert the phrasing of a line that is no longer rendered.
    votes: { 1: Object.fromEntries(gameIds.map((g) => [g, { rating: 4, retire: false }])) },
    votedIds: [1],
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

/* The wording table above proves the KEYS are right; only the Chronik test
   proves a call site was converted. This closes that gap for the others
   without a page of fixture each: it is a claim about the call SHAPE, which is
   what regresses — a view that goes back to t() renders the plural at n = 1
   again while every assertion above stays green.
   Deliberately not a regex over a view's rendered output (which is what
   `.claude/rules/testing-views-under-jsdom.md` exists to replace) — it asks
   only "is this key ever reached through the non-plural helper", which no
   amount of rendering can answer for a dozen screens.
   For #838's four this is the ONLY assertion that can go red at all, which is
   the whole reason that issue is a test-shape change rather than a behavioural
   one. */
test('none of the plural-pair keys is reachable through plain t() any more', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'public', 'js');
  const sources = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.js')) sources.push(path.join(dir, e.name));
    if (e.isDirectory() && e.name !== 'lang') {
      for (const f of fs.readdirSync(path.join(dir, e.name))) {
        if (f.endsWith('.js')) sources.push(path.join(dir, e.name, f));
      }
    }
  }

  /* Escape EVERY regex metacharacter, not just the dot the keys happen to
     contain: a partial escape is the js/incomplete-sanitization shape, and
     "the inputs are all literals in the array above" is exactly the reasoning
     that stops being true when someone adds a key. */
  const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let checked = 0;
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    for (const row of PAIRS.concat(SILENT_PAIRS)) {
      for (const key of [row.one, row.other]) {
        /* `\bt\(` cannot match `tn(` — the n is a word character.

           `[^)\n]*` is load-bearing and was NOT here originally: it lets the key
           sit anywhere in the call's first line, not just immediately after the
           paren. #833's nine were all direct `t('key', …)` calls, so the tighter
           `\s*'key'` caught them — but the shape #838 converts is
           `t(n === 1 ? 'keyOne' : 'keyOther')`, where the key follows a ternary
           condition and the old pattern matched nothing at all. Measured: with
           the four sites reverted on purpose, this test stayed GREEN five times
           out of five before the character class was widened.
           It stays on ONE line and refuses to cross a `)` so it cannot wander
           out of the call it started in — `foo(t('x'), 'keyOne')` is not a hit. */
        const bad = new RegExp(`\\bt\\(\\s*[^)\\n]*'${rx(key)}'`);
        assert.ok(!bad.test(text), `${path.basename(file)}: '${key}' is passed to t(), not tn() — ${row.what}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 100, `expected to have scanned the frontend, made ${checked} checks`);
});
