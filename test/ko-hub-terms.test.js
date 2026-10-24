'use strict';

/*
 * Korean names each hub tab ONE way. The tab labels are 선반 (Regal) and 기록
 * (Chronik), but guest-game, design-chooser, import, news and FAQ copy had
 * drifted to the synonyms 책장 and 연대기 — so the guest sheet told a reader a
 * brought game stays out of the 책장 while the rail beside it said 선반, and
 * the import's „go to the 연대기" pointed at a tab that does not exist by that
 * name. Nothing failed; a reader just met two words for one screen.
 *
 * Scans parsed VALUES (lang/ko.js, the ko half of every news entry, the ko FAQ
 * answers), never raw file text, for the reason test/session-naming.test.js
 * gives: a text scan trips on comments documenting the rule.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { NEWS } = require('../public/js/news');
const { QUESTIONS } = require('../lib/faq');

const BANNED = [/책장/, /연대기/];

function loadKo() {
  const file = path.join(__dirname, '..', 'public', 'js', 'lang', 'ko.js');
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.I18N.ko;
}

function hits(where, value, out) {
  if (typeof value !== 'string') return;
  for (const re of BANNED) {
    const m = value.match(re);
    if (m) out.push(`${where}: "${m[0]}" in ${JSON.stringify(value).slice(0, 100)}`);
  }
}

// The premise: the banned words are synonyms of the tab labels, not the labels.
// If a tab is ever renamed to one of them, this spec must be rethought, not
// silently start banning the real name.
test('the Korean tab labels are 선반 and 기록', () => {
  const ko = loadKo();
  assert.equal(ko['hub.tab.regal'], '선반');
  assert.equal(ko['hub.tab.chronik'], '기록');
});

test('no Korean string calls the Regal 책장 or the Chronik 연대기', () => {
  const out = [];
  let scanned = 0;

  for (const [key, value] of Object.entries(loadKo())) { scanned += 1; hits(`lang/ko.js ${key}`, value, out); }
  for (const entry of NEWS) {
    if (!entry.ko) continue;
    for (const [field, value] of Object.entries(entry.ko)) { scanned += 1; hits(`news ${entry.revision}.${field}`, value, out); }
  }
  for (const q of QUESTIONS) {
    const ko = q.ko;
    if (!ko) continue;
    for (const field of ['q', 'a']) {
      // An answer may be a getter (the forums block); reading it is the point.
      scanned += 1;
      hits(`faq ${q.id}.${field}`, ko[field], out);
    }
  }

  assert.ok(scanned > 1500, `expected to scan ko.js, news and the FAQ, scanned ${scanned}`);
  assert.deepEqual(out, [], `Korean names a hub tab by a synonym:\n  ${out.join('\n  ')}`);
});
