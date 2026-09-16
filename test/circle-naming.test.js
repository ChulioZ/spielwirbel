'use strict';

/*
 * „Kreis" on its own is not a name for a friends list (#1136).
 *
 * The bare metaphor shipped in one key pair, `friends.band.count` / `countOne`,
 * and it had idiomatic support in THREE of the nine locales — and only as a
 * compound. In the other six the screen title is already the plain plural, so
 * it was a translated German figure of speech with nothing holding it up. In
 * Italian it was the wrong word outright: the social sense is « cerchia » (f.),
 * while « cerchio » is the geometric ring.
 *
 * The fix was a removal rather than nine retranslations — the band heading
 * carries the noun, so the meta beside it needs only the number — and this is
 * the guard that keeps it removed.
 *
 * WHAT IT SCANS: translation VALUES, parsed out of each `lang/*.js` through a
 * `vm` sandbox. Deliberately NOT raw file text: this file, the issue and the
 * rule that documents the ban all contain the banned words, and several lang
 * files name them in a comment to warn translators off them
 * (.claude/rules/source-scanning-guards-enumerate-shapes.md, "The inverse").
 *
 * WHAT IS DELIBERATELY ALLOWED: the COMPOUND. „Freundeskreis", « vriendenkring »
 * and « kaveripiiri » are the three idiomatic forms, and `friends.title` is
 * „Freundeskreis" in German on purpose. Every ban therefore anchors on a word
 * boundary at the START of the stem only, which reaches the bare noun and its
 * case endings while sparing a word that merely ENDS in it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { SUPPORTED_LOCALES } = require('../public/js/locales');

/*
 * One pattern per locale. All nine are "a word STARTING with the stem", which is
 * the single decision in this file and is what makes the compound safe:
 * „Freundeskreis" has no word boundary before „kreis", so it is not a match,
 * while „im Kreis" and „Kreises" are.
 *
 * Korean has no word boundaries, so `\b` is unavailable — but the loanword 서클
 * is unambiguous and appears in nothing else. The native 원 is NOT banned: it is
 * a syllable inside dozens of ordinary words (회원 member, 지원 support), so a
 * substring ban on it would flag correct copy with no way to green but weakening
 * the pattern.
 */
const RULES = {
  de: [/\bkreis/i],        // „im Kreis", „Kreises" — but not „Freundeskreis"
  en: [/\bcircles?\b/i],
  es: [/\bcírculos?\b/i],
  fr: [/\bcercles?\b/i],
  // Every inflection of both nouns: cerchio/cerchi (the ring) and
  // cerchia/cerchie (the social sense). Banning only the shipped „cerchio"
  // would invite the "fix" that swaps one for the other.
  it: [/\bcerchi[oae]?\b/i],
  nl: [/\bkring/i],        // but not « vriendenkring »
  pt: [/\bcírculos?\b/i],
  fi: [/\bpiiri/i],        // „piirissä" — but not « kaveripiiri »
  ko: [/서클/],
};

function namesACircle(locale, value) {
  return RULES[locale].map((re) => String(value).match(re)).filter(Boolean).map((m) => m[0]);
}

function loadLocale(name) {
  const file = path.join(__dirname, '..', 'public', 'js', 'lang', `${name}.js`);
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.I18N[name];
}

/* The matcher's own self-test. Without it this file can go inert on a later edit
 * while still reporting a clean sweep. The NEGATIVE cases are the load-bearing
 * half: they are what proves the guard bans the bare noun rather than the word,
 * and the three compounds are the whole reason the ban is anchored the way it
 * is. */
test('the matcher flags the bare noun and spares the compound', () => {
  const bad = {
    de: ['{n} im Kreis', 'Mitglieder des Kreises'],
    en: ['{n} in the circle', 'your circle'],
    es: ['{n} en el círculo', 'tu círculo'],
    fr: ['{n} dans le cercle', 'ton cercle'],
    // Both nouns, so swapping the wrong word for the right one is not the fix.
    it: ['{n} nel cerchio', 'la tua cerchia', 'nei cerchi'],
    nl: ['{n} in de kring', 'jouw kring'],
    pt: ['{n} no círculo', 'o teu círculo'],
    fi: ['{n} piirissä', 'oma piirisi'],
    ko: ['서클에 {n}명'],
  };
  const fine = {
    de: ['Freundeskreis', 'Deine Freunde', '{n} Freunde'],
    en: ['Friends', 'Your friends'],
    es: ['Amigos', 'Tus amigos'],
    fr: ['Amis', 'Tes amis'],
    it: ['Amici', 'I tuoi amici'],
    nl: ['Vrienden', 'vriendenkring', 'Jouw vrienden'],
    pt: ['Amigos', 'Os teus amigos'],
    fi: ['Kaverit', 'kaveripiiri', 'Kaverisi'],
    ko: ['친구', '내 친구'],
  };

  for (const locale of SUPPORTED_LOCALES) {
    for (const s of bad[locale]) {
      assert.ok(namesACircle(locale, s).length > 0, `${locale}: should be flagged — "${s}"`);
    }
    for (const s of fine[locale]) {
      assert.deepEqual(namesACircle(locale, s), [], `${locale}: must NOT be flagged — "${s}"`);
    }
  }
});

/* A locale added to locales.js with no entry here would be scanned by nothing
 * and pass in silence — the failure mode that makes an added language look
 * covered. Fail loudly instead. */
test('every shipped locale has a circle rule', () => {
  assert.deepEqual(Object.keys(RULES).sort(), [...SUPPORTED_LOCALES].sort());
});

test('no translation value calls the friends list a circle', () => {
  const violations = [];
  let scanned = 0;

  for (const locale of SUPPORTED_LOCALES) {
    const dict = loadLocale(locale);
    for (const [key, value] of Object.entries(dict)) {
      scanned += 1;
      for (const hit of namesACircle(locale, value)) {
        violations.push(`${locale} ${key}: "${hit}" in ${JSON.stringify(value).slice(0, 120)}`);
      }
    }
  }

  // Counts values actually put through the matcher, so a loader that returns an
  // empty dict cannot satisfy this by scanning nothing.
  assert.ok(scanned > 1000, `expected to scan the whole key set, scanned ${scanned}`);
  assert.deepEqual(violations, [],
    'these strings name the friends list a bare circle (#1136 retired it — the band '
    + `heading carries the noun):\n  ${violations.join('\n  ')}`);
});

/* The one form that stays, and the reason the ban is anchored rather than
 * blunt. Asserted positively so that "retiring the metaphor" cannot quietly
 * take the German screen title with it. */
test('„Freundeskreis" itself is untouched', () => {
  assert.equal(loadLocale('de')['friends.title'], 'Freundeskreis');
});
