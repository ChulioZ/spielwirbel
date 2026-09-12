'use strict';

/* The two archive confirms on the game detail page — „Aussortieren" and
   „Durchgespielt" — must STATE THE CONSEQUENCE, not just restate the button
   (#1019).
 *
 * Reported by a real user, unprompted, on the Ludopedia launch thread: he had
 * found the „CONCLUÍDO" button, could not tell what it would do, and asked on a
 * forum rather than press it. Both actions take the game off the shelf and out
 * of every draw, and the dialog is the last thing standing between the user and
 * that — so it has to say so.
 *
 * TWO HALVES, and each covers what the other cannot:
 *
 *   - the RENDERED half opens the real dialog through the real view, so a
 *     reverted string fails where a user would see it. It can only run one
 *     locale, since the harness boots with one;
 *   - the TABLE half sweeps all seven, parsing each lang file in a `vm` sandbox
 *     the way test/i18n-parity.test.js does. Per-locale phrases rather than a
 *     length floor: "longer than the question" is satisfied by any waffle, and
 *     the three things the issue asks for are specific claims.
 *
 * The phrase table is judgement, exactly like test/session-naming.test.js's
 * RULES — it is the one part of adding a language here that translation alone
 * does not give you.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { loadApp } = require('./support/dom');
const { SUPPORTED_LOCALES } = require('../public/js/locales');

const KEYS = ['detail.retireConfirm', 'detail.completeConfirm'];

/* Per locale: a phrase for each of the three claims the confirm must make —
   (a) it leaves the shelf, (b) it stops being drawn, (c) it can come back.
   Each is matched case-insensitively against the string. */
const CLAIMS = {
  en: { shelf: 'Off the Shelf', draw: 'out of the draw', back: 'bring it back' },
  de: { shelf: 'aus Regal', draw: 'Auslosung', back: 'zurückholen' },
  es: { shelf: 'de la Estantería', draw: 'del sorteo', back: 'recuperarlo' },
  fr: { shelf: 'l’Étagère', draw: 'le tirage', back: 'récupérer' },
  it: { shelf: 'dallo Scaffale', draw: 'sorteggio', back: 'recuperarlo' },
  nl: { shelf: 'uit de Kast', draw: 'loting', back: 'terughalen' },
  pt: { shelf: 'da Estante', draw: 'do sorteio', back: 'de volta' },
};

function loadLocale(name) {
  const file = path.join(__dirname, '..', 'public', 'js', 'lang', `${name}.js`);
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.I18N[name];
}

test('every shipped locale states the consequence in BOTH archive confirms', () => {
  // Derived from locales.js, so a language added there is checked with nobody
  // remembering this file exists — and it fails loudly, naming the locale,
  // rather than shipping one dialog that still only asks the question.
  for (const locale of SUPPORTED_LOCALES) {
    const claims = CLAIMS[locale];
    assert.ok(claims,
      `public/js/locales.js ships '${locale}' but this file has no claim phrases for it — `
      + 'add them (it is judgement, not translation: pick the words that locale actually used)');
    const dict = loadLocale(locale);
    for (const key of KEYS) {
      const value = dict[key];
      assert.ok(value, `${locale}: ${key} is missing`);
      // The question comes FIRST and the consequence after it, so the dialog
      // still reads as a question rather than as a warning notice.
      assert.match(value, /^[^?]*\?/, `${locale}: ${key} no longer opens with the question`);
      for (const [what, phrase] of Object.entries(claims)) {
        assert.ok(value.toLowerCase().includes(phrase.toLowerCase()),
          `${locale}: ${key} does not state "${what}" (expected to contain “${phrase}”)\n  ${value}`);
      }
    }
  }
});

test('the RETIRE dialog on the real detail screen says what pressing it does', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = {
    id: 'r1',
    name: 'Freitagsrunde',
    members: [{ id: 'm1', name: 'Anna' }],
    games: [{ id: 'g1', title: 'Azul', minPlayers: 2, maxPlayers: 4, tagIds: [] }],
    sessions: [],
    tags: [],
  };
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/r1$/.test(url)) return round;
    return {};
  });
  // (rid, gameId) — it fetches the round itself through the stubbed api().
  await dom.call('showGameDetail', 'r1', 'g1');

  // Aussortieren moved off the page and into the „…" page menu in #1039 — it is
  // the opposite of playing, so it does not sit beside the play button. The menu
  // is a popover on <body>, so the walk starts at the trigger in the back row.
  const menu = dom.app.querySelector('.gd-menu');
  assert.ok(menu, 'the „…" page menu is not on the screen');
  menu.click();
  const btn = [...dom.document.querySelectorAll('.popover--menu .popover__opt')]
    .find((b) => b.textContent.includes(dom.run("t('detail.retire')")));
  assert.ok(btn, 'the Aussortieren action is not in the page menu');
  btn.click();
  await new Promise((r) => setImmediate(r));

  const body = dom.document.querySelector('.confirm-dialog__body');
  assert.ok(body, 'pressing Aussortieren opened no confirm dialog at all');
  // The three claims, read off the DOM the user actually sees — so a string
  // reverted to the bare question reddens HERE by name, not only in the table
  // sweep above.
  assert.match(body.textContent, /Azul/, 'the dialog no longer names the game');
  assert.match(body.textContent, /Regal/, 'the dialog does not say the game leaves the shelf');
  assert.match(body.textContent, /Auslosung/, 'the dialog does not say it stops being drawn');
  assert.match(body.textContent, /zurückholen/, 'the dialog does not say it can be brought back');
});
