'use strict';

/* The per-language device-kind ban (operator decision: a round runs from ONE
   device, and a computer is as valid as any other — naming one kind quietly
   tells everyone else the app is not for them). Shared by test/faq.test.js and
   test/guide.test.js since #1171, because the guide's prose is held to the
   FAQ's content rules and a second, hand-copied map would be the one nobody
   updates when a language is added.

   PER LANGUAGE since #1088, because the ban is on the WORD and every language
   has its own (.claude/rules/source-scanning-guards-enumerate-shapes.md: the
   spelling the scan misses is invisible). Korean has no word boundaries, so it
   takes the substring shape — the same split test/session-naming.test.js
   makes. Each addition was proved red by planting the word on purpose. */
const BANNED_BY_LOCALE = {
  de: /\b(Handy|Handys|Smartphones?|Tablets?)\b/i,
  en: /\b(phones?|smartphones?|tablets?)\b/i,
  es: /\b(m[oó]vil(es)?|tel[eé]fonos?|tabletas?)\b/i,
  fr: /\b(t[eé]l[eé]phones?|portables?|tablettes?)\b/i,
  it: /\b(telefon[oi]|cellulari?|tablets?)\b/i,
  nl: /\b(telefoons?|mobiel(tje)?s?|tablets?)\b/i,
  pt: /\b(celulares?|telefones?|tablets?)\b/i,
  fi: /\b(puhelim\w*|k[aä]nnyk\w*|tabletti\w*)\b/i,
  ko: /(휴대폰|스마트폰|핸드폰|태블릿)/,
};

module.exports = { BANNED_BY_LOCALE };
