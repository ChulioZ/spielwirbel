'use strict';

/* Das Programmheft's stamp press (#1393, P17.5's motion): a medal this result
 * screen had not shown before is pressed into the paper — a dashed place until
 * 400ms, then the medal at 115% with no fade, pressed to 100% in 120ms on
 * cubic-bezier(.5,0,.9,.5), one 16ms frame of a 4px ink bleed at 520ms, the
 * second medal 180ms later, nothing after 880ms. Reduced motion: printed from
 * 0ms.
 *
 * The premise — `data-fresh` marks only what a REFILL newly earned, never a
 * cold load — is K17's and is tested in test/badges-moment-fresh.test.js; this
 * file pins the CSS contract. Named for the design and the ritual
 * (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mediaBlocks, rulesOf } = require('./support/css');

const PH_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'programmheft.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const GATE = ':root[data-design="programmheft"]:not([data-scheme="dark"]) ';
const FIRST = `${GATE}.badge-moment__item[data-fresh] .badge__mark`;
const SECOND = `${GATE}.badge-moment__item[data-fresh] ~ .badge-moment__item[data-fresh] .badge__mark`;
const norm = (s) => s.replace(/\s+/g, ' ').trim();

const motionRules = mediaBlocks(PH_CSS)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));
const ruleIn = (rules, sel) => (rules.find(([s]) => norm(s) === norm(sel)) || [])[1] || null;

function keyframes(name) {
  const m = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(PH_CSS);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  for (; depth > 0; i++) {
    if (PH_CSS[i] === '{') depth++;
    else if (PH_CSS[i] === '}') depth--;
  }
  return PH_CSS.slice(m.index + m[0].length, i - 1);
}

// „name 120ms cubic-bezier(…) 400ms" → { name, dur, delay, easing }
function animations(body) {
  const v = (/animation:\s*([^;]+)/.exec(body) || [])[1] || '';
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => {
    const times = [...p.matchAll(/(\d+)ms/g)].map((x) => Number(x[1]));
    return {
      name: p.trim().split(/\s+/)[0],
      dur: times[0],
      delay: times[1] || 0,
      easing: (/cubic-bezier\([^)]*\)|step-end|ease[-a-z]*|linear/.exec(p) || [''])[0],
      text: p.trim(),
    };
  });
}

test('every medal animation is inside the motion gate, on a fresh moment item only', () => {
  const users = rulesOf(PH_CSS).filter(([, b]) => /animation[-a-z]*:[^;]*ph-medal-/.test(b));
  assert.equal(users.length, 4, `expected the medal and its seal, for each of the two items: ${users.map(([s]) => norm(s)).join(' | ')}`);
  for (const [sel] of users) {
    assert.ok(norm(sel).startsWith(norm(GATE)), `${norm(sel)} is not gated on the light scheme`);
    assert.match(sel, /\.badge-moment__item\[data-fresh\]/, `${norm(sel)} would move a cold-loaded medal`);
    assert.ok(motionRules.some(([s]) => norm(s) === norm(sel)), `${norm(sel)} runs outside prefers-reduced-motion: no-preference`);
  }
  // Nothing on the band itself moves — only its medal (the selectors above).
  assert.equal(motionRules.filter(([s, b]) => /badge-moment--special/.test(s) && /animation/.test(b)).length, 0);
});

test('the press: 115% → 100% in 120ms on cubic-bezier(.5,0,.9,.5), from 400ms, no fade', () => {
  const press = animations(ruleIn(motionRules, FIRST)).find((a) => a.name === 'ph-medal-press');
  assert.ok(press, 'no press on the first medal');
  assert.equal(press.dur, 120);
  assert.equal(press.delay, 400);
  assert.equal(press.easing.replace(/\s/g, ''), 'cubic-bezier(0.5,0,0.9,0.5)');
  const kf = keyframes('ph-medal-press');
  assert.match(kf, /from\s*\{\s*transform:\s*scale\(1\.15\);?\s*\}/);
  assert.doesNotMatch(PH_CSS.slice(PH_CSS.indexOf('@keyframes ph-medal')), /opacity/, 'P17: „ohne Einblenden"');
});

test('the ghost holds until the press, the bleed is one frame at 520ms', () => {
  const anims = animations(ruleIn(motionRules, FIRST));
  const wait = anims.find((a) => a.name === 'ph-medal-wait');
  assert.equal(wait.dur, 400);
  assert.equal(wait.easing, 'step-end');
  assert.match(keyframes('ph-medal-wait'), /color:\s*transparent/);
  const ghost = animations(ruleIn(motionRules, `${FIRST}::before`)).find((a) => a.name === 'ph-medal-ghost');
  assert.equal(ghost.dur, 400);
  assert.match(keyframes('ph-medal-ghost'), /border:\s*2px dashed var\(--ink-soft\)/);
  const bleed = anims.find((a) => a.name === 'ph-medal-bleed');
  assert.equal(bleed.delay, 520);
  assert.equal(bleed.dur, 16);
  assert.match(keyframes('ph-medal-bleed'), /0 0 0 4px var\(--cast\)/);
});

test('the second medal follows 180ms later, and nothing runs past 880ms', () => {
  const first = animations(ruleIn(motionRules, FIRST));
  const second = animations(ruleIn(motionRules, SECOND));
  assert.deepEqual(second.map((a) => a.name), first.map((a) => a.name));
  second.forEach((a, i) => {
    const lag = (a.name === 'ph-medal-wait' ? a.dur - first[i].dur : a.delay - first[i].delay);
    assert.equal(lag, 180, `${a.name} is not 180ms behind the first medal`);
  });
  const ghost2 = animations(ruleIn(motionRules, `${SECOND}::before`)).find((a) => a.name === 'ph-medal-ghost');
  assert.equal(ghost2.dur, 580);
  const ends = [FIRST, SECOND, `${FIRST}::before`, `${SECOND}::before`]
    .flatMap((s) => animations(ruleIn(motionRules, s)).map((a) => a.delay + a.dur));
  assert.ok(Math.max(...ends) <= 880, `the stamp runs until ${Math.max(...ends)}ms`);
});

test('no fill mode — every keyframe holds only while it runs, so the rest is the printed skin', () => {
  for (const s of [FIRST, SECOND, `${FIRST}::before`, `${SECOND}::before`]) {
    const b = ruleIn(motionRules, s);
    assert.doesNotMatch(b, /\b(both|forwards|backwards|infinite)\b/, `${norm(s)} fills or loops`);
  }
});
