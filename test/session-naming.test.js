'use strict';

/*
 * The session entity is called a "Session" in code AND in every UI language
 * (CLAUDE.md, Conventions). "Spielabend", "game night" and "Abend" must not
 * come back for it. That rule was written down and skipped anyway — twice, in
 * #796 (`result.titleSplit`) and #893 (`score.infoBody`), the second time two
 * lines below a comment citing the rule by name. Per criterion C-017 the remedy
 * for a correct-but-skipped rule is a check that cannot be skipped, so this is
 * that check (issue #899).
 *
 * WHAT IT SCANS: translation VALUES and the entries in public/js/news.js.
 * Deliberately NOT raw file text — the comment above `result.winner` contains
 * „Abend" in all five lang files (it is the comment documenting this very rule),
 * and four of the five file headers name the banned phrase to warn translators
 * off it. A text-level scan self-trips on its own documentation.
 *
 * WHAT IT DOES NOT COVER, on purpose:
 *   - developer-facing prose (docs/features.md says "evening" freely),
 *   - ROUND names — a round is a group, not a session, so
 *     lib/demo-seed.js's 'Spieleabend (Demo)' is fine and out of scope,
 *   - time-of-day adverbials, which say WHEN you play and name no entity
 *     ("heute", "tonight", « ce soir », "stasera", "hoy").
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { SUPPORTED_LOCALES } = require('../public/js/locales');
const { NEWS } = require('../public/js/news');

/*
 * Per-locale patterns. `allow` spans are removed from the value BEFORE `ban` is
 * applied, which is the whole design decision here and it exists for French:
 * « soir » is a banned entity noun in « le jeu du soir » and an allowed
 * adverbial in « ce soir », so no substring ban is shippable. Stripping the
 * adverbial phrase first lets the ban stay blunt and still be correct.
 *
 * The other four locales separate on word boundaries alone — "tonight" is not
 * `\bnight\b`, "stasera" is not `\bserata\b` — so they need no allowances, and
 * none are invented for phrases that do not exist yet. That is the safe
 * direction: German „abends" or Spanish « esta noche » would be legitimate
 * adverbials and would fail this guard, at which point adding the allowance is
 * a deliberate act rather than a silent hole.
 */
const RULES = {
  de: { allow: [], ban: [/abend/i] },                  // substring: also catches „Spieleabend"
  en: { allow: [], ban: [/\bevenings?\b/i, /\bnights?\b/i] },
  es: { allow: [], ban: [/\bnoches?\b/i, /\bveladas?\b/i] },
  // One alternation, not two patterns: \b is ASCII, so `soir\b` also matches
  // inside « soirée » and the same string would be reported twice.
  fr: { allow: [/\bce soir\b/gi], ban: [/\bsoirées?\b|\bsoirs?\b/i] },
  it: { allow: [], ban: [/\bserat[ae]\b/i, /\bsera\b/i] },
};

function namesAnEvening(locale, value) {
  const rules = RULES[locale];
  let text = String(value);
  for (const allow of rules.allow) text = text.replace(allow, ' ');
  return rules.ban.map((re) => text.match(re)).filter(Boolean).map((m) => m[0]);
}

function loadLocale(name) {
  const file = path.join(__dirname, '..', 'public', 'js', 'lang', `${name}.js`);
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.I18N[name];
}

/* The matcher's own self-test. Without it the whole file can go inert on a
 * later edit while still reporting a clean sweep — the vacuous green that
 * .claude/rules/source-scanning-guards-enumerate-shapes.md is about. The
 * negative cases are the load-bearing half: they are what proves the guard
 * bans the entity noun rather than the time-of-day word. */
test('the matcher flags the entity noun and spares the time-of-day adverbial', () => {
  const bad = {
    de: ['Der Abend wurde aufgeteilt', 'Spieleabend', 'am Ende ein Abend'],
    en: ['The evening was split', 'your usual evening', 'game night'],
    es: ['La velada se repartió', 'una noche que apetezca'],
    fr: ['la soirée plaise', 'le jeu du soir', 'vos soirées habituelles'],
    it: ['La serata è stata divisa', 'le vostre serate abituali'],
  };
  const fine = {
    de: ['Was spielen wir heute?', 'Die Session wurde aufgeteilt'],
    en: ['What are we playing tonight?', 'Guests along tonight?'],
    es: ['el juego de hoy', 'como vuestras partidas de siempre'],
    fr: ['On joue à quoi ce soir ?', 'Des invités ce soir ?'],
    it: ['A cosa giochiamo stasera?', 'la scelta di stasera'],
  };

  for (const locale of SUPPORTED_LOCALES) {
    for (const s of bad[locale]) {
      assert.ok(namesAnEvening(locale, s).length > 0, `${locale}: should be flagged — "${s}"`);
    }
    for (const s of fine[locale]) {
      assert.deepEqual(namesAnEvening(locale, s), [], `${locale}: must NOT be flagged — "${s}"`);
    }
  }
});

/* A locale added to locales.js with no entry here would be scanned by nothing
 * and pass in silence — the exact failure mode that makes an added language
 * look covered. Fail loudly instead. */
test('every shipped locale has a naming rule', () => {
  assert.deepEqual(Object.keys(RULES).sort(), [...SUPPORTED_LOCALES].sort());
});

test('no translation value names the session an evening', () => {
  const violations = [];
  let scanned = 0;

  for (const locale of SUPPORTED_LOCALES) {
    const dict = loadLocale(locale);
    for (const [key, value] of Object.entries(dict)) {
      scanned += 1;
      for (const hit of namesAnEvening(locale, value)) {
        violations.push(`${locale} ${key}: "${hit}" in ${JSON.stringify(value).slice(0, 120)}`);
      }
    }
  }

  // Counts values actually put through the matcher, so a loader that returns an
  // empty dict cannot satisfy this by scanning nothing.
  assert.ok(scanned > 1000, `expected to scan the whole key set, scanned ${scanned}`);
  assert.deepEqual(violations, [],
    `these strings name the session an evening (CLAUDE.md bans it):\n  ${violations.join('\n  ')}`);
});

/* news.js holds a DIFFERENT value shape — nested {de: {title, body}, en: {…}}
 * rather than a flat string map — and a scan written for one shape sees nothing
 * at all in the other, with no error
 * (.claude/rules/source-scanning-guards-enumerate-shapes.md). Both are covered
 * explicitly for that reason. */
test('no „Was ist neu" entry names the session an evening', () => {
  const violations = [];
  let scanned = 0;

  for (const entry of NEWS) {
    for (const [lang, content] of Object.entries(entry)) {
      if (lang === 'revision') continue;
      assert.ok(RULES[lang], `news entry ${entry.revision} is written in unknown locale '${lang}'`);
      for (const [field, value] of Object.entries(content)) {
        scanned += 1;
        for (const hit of namesAnEvening(lang, value)) {
          violations.push(`${entry.revision} ${lang}.${field}: "${hit}" in ${JSON.stringify(value).slice(0, 120)}`);
        }
      }
    }
  }

  assert.ok(scanned >= 8, `expected to scan the news entries' text, scanned ${scanned}`);
  assert.deepEqual(violations, [],
    `these news strings name the session an evening (CLAUDE.md bans it):\n  ${violations.join('\n  ')}`);
});
