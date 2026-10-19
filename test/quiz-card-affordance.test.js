'use strict';

/* The weekly quiz reuses `.card` as a plain container (#1686), but `.card` began
   as the clickable round/game tile: every one gets the pointer cursor and a
   hover lift. These pin that the three quiz shapes opt out of both, in
   styles.css AND in every design stylesheet, while an ordinary card keeps them
   (the control, without which a scan that matched nothing would pass). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, rulesOf, bodyOf, matchesEl, declaredValue, resolvedDeclaration } = require('./support/css');

const QUIZ_CARDS = {
  'quiz question / teaser': { tag: 'article', classes: ['card', 'quiz-q'] },
  'this week': { tag: 'section', classes: ['card', 'quiz-archive__week', 'quiz-archive__week--current'] },
  'past week': { tag: 'details', classes: ['card', 'quiz-archive__week'] },
};
const PLAIN_CARD = { tag: 'div', classes: ['card'] };

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// A selector group's members, split only on top-level commas: the opt-out
// itself is a `:where(a, b)`, which a plain split would cut in half.
function members(group) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of group) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  return [...out, cur.trim()];
}
const DESIGNS = path.join(ROOT, 'public/css/designs');
const SHEETS = [
  ['styles.css', path.join(ROOT, 'public/styles.css')],
  ...fs.readdirSync(DESIGNS).filter((f) => f.endsWith('.css')).map((f) => [f, path.join(DESIGNS, f)]),
];

/* Every `.card…:hover` selector member, with `:hover` taken off so the resting-
   state matcher can ask "would this rule apply to that element once hovered?".
   Restricted to members whose own text names `.card` as a whole class and
   `:hover`, which is the shape that lifts a card. */
function cardHoverMembers() {
  const out = [];
  for (const [file, p] of SHEETS) {
    for (const [sel, body] of rulesOf(strip(fs.readFileSync(p, 'utf8')))) {
      for (const one of members(sel)) {
        if (!/\.card(?![\w-])(?:[^\s>+~()]|\([^()]*(?:\([^()]*\))?[^()]*\))*:hover/.test(one)) continue;
        if (!['transform', 'box-shadow', 'border-color'].some((prop) => declaredValue(body, prop))) continue;
        out.push({ file, sel: one, bare: one.replace(/:hover/g, '') });
      }
    }
  }
  return out;
}

test('no card hover rule — in styles.css or any design — lifts or lights a quiz card', () => {
  const members = cardHoverMembers();
  for (const [name, el] of Object.entries(QUIZ_CARDS)) {
    const hits = members.filter((m) => matchesEl(m.bare, el)).map((m) => `${m.file}: ${m.sel}`);
    assert.deepEqual(hits, [], `the ${name} card still reacts to hover`);
  }
});

test('control: an ordinary card still lifts on hover, in styles.css and in Die Brücke', () => {
  const hits = cardHoverMembers().filter((m) => matchesEl(m.bare, PLAIN_CARD)).map((m) => m.file);
  assert.ok(hits.includes('styles.css'), 'the base .card hover lift is gone');
  assert.ok(hits.includes('bruecke.css'), 'Die Brücke\'s edge-light hover is gone');
});

test('the quiz cards show the default cursor; an ordinary card keeps the pointer', () => {
  for (const [name, el] of Object.entries(QUIZ_CARDS)) {
    const won = resolvedDeclaration(el, 'cursor');
    assert.notEqual(won.value, 'pointer', `the ${name} card shows a pointer, from ${won.sel}`);
  }
  assert.equal(resolvedDeclaration(PLAIN_CARD, 'cursor').value, 'pointer');
});

test('a past week\'s summary row is the one part that says it opens: pointer, no native marker, a chevron that flips', () => {
  assert.equal(declaredValue(bodyOf('.quiz-archive__week > summary'), 'cursor'), 'pointer');
  assert.equal(declaredValue(bodyOf('.quiz-archive__week > summary::-webkit-details-marker'), 'display'), 'none');
  assert.match(declaredValue(bodyOf('.quiz-archive__week[open] > summary .ti'), 'transform'), /rotate\(180deg\)/);
});
