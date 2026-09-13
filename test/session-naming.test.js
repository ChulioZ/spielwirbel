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
 * „Abend" in most lang files (it is the comment documenting this very rule),
 * and most file headers name the banned phrase to warn translators off it. A
 * text-level scan self-trips on its own documentation.
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
  // Dutch takes the FRENCH shape, not the German one, and the reason is one
  // letter: the adverbial « vanavond » (tonight) CONTAINS the entity noun
  // « avond », so a substring ban alone would flag the landing headline and
  // the guest prompt — both correct — and the only way to green would be to
  // weaken the pattern until it stops catching « spelavond ». Strip the
  // adverbial first, then ban bluntly, so compounds keep failing.
  nl: { allow: [/\bvanavond\b/gi], ban: [/avond/i] },
  // Portuguese takes the FRENCH shape too: « noite » is the entity in
  // « noite de jogos » and the time-of-day word in « hoje à noite », which the
  // guest prompt uses legitimately. Strip the adverbial first, then ban the
  // bare noun — the compound is two words here, so the ban needs no substring
  // reach the way Dutch does.
  pt: { allow: [/\b(?:hoje|esta) à noite\b/gi], ban: [/\bnoites?\b/i] },
  /* Finnish is the one locale where a BARE substring ban is wrong, and it took a
     real false positive to see it: „kavereiltasi" (from your friends) contains
     „ilta" because the plural ablative ending is `-ilta`, and so does every
     other noun in that case — „peleiltä", „ihmisiltä". So the ban anchors on a
     WORD BOUNDARY, which still reaches into the compound („peli-ilta" — the
     hyphen is a boundary) while sparing the case ending.

     The allow list then needs only one entry, not two: „illalla" (the adverbial
     „in the evening") is never matched by `\billan\b`, so it needs no exception,
     while „tänä iltana" does — that one really does start a word with the
     banned stem. */
  fi: { allow: [/\btänä iltana\b/gi], ban: [/\bilta/i, /\billan\b/i] },
  /* Korean has NO word boundaries, so `\b` is unavailable and the Dutch
     substring shape is the only one on offer. The entity is “세션”; what is
     banned is 저녁 and 밤 (evening / night) and the loan 나이트, which together
     cover “게임의 밤” and “보드게임 나이트”. The adverbials 오늘 밤 /
     오늘 저녁 are stripped first — the guest prompt uses one legitimately —
     and the optional space matters, because Korean writes both spellings. */
  ko: { allow: [/오늘\s*밤/g, /오늘\s*저녁/g], ban: [/밤/, /저녁/, /나이트/] },
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
    nl: ['De avond werd opgesplitst', 'spelavond', 'jullie gebruikelijke avonden'],
    pt: ['A noite foi dividida', 'noite de jogos', 'as suas noites de sempre'],
    fi: ['Peli-ilta jaettiin', 'peli-ilta', 'tavalliset peli-iltanne', 'Illan peli'],
    ko: ['게임의 밤이 나누어졌습니다', '보드게임 나이트', '평소의 게임 저녁'],
  };
  const fine = {
    de: ['Was spielen wir heute?', 'Die Session wurde aufgeteilt'],
    en: ['What are we playing tonight?', 'Guests along tonight?'],
    es: ['el juego de hoy', 'como vuestras partidas de siempre'],
    fr: ['On joue à quoi ce soir ?', 'Des invités ce soir ?'],
    it: ['A cosa giochiamo stasera?', 'la scelta di stasera'],
    nl: ['Wat spelen we vanavond?', 'De sessie werd opgesplitst'],
    pt: ['O que vamos jogar hoje?', 'Convidados hoje à noite?'],
    // „kavereiltasi" and „illalla" are the two shapes the bare substring ban
    // got wrong — a case ending and an adverbial.
    fi: ['Mitä pelataan tänään?', 'Vieraita tänä iltana?', 'Kavereiltasi ei ole toimintaa', 'pelataan illalla'],
    ko: ['오늘 뭐 할까요?', '오늘 밤에 손님이 오나요?', '세션이 나누어졌습니다'],
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
