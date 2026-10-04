'use strict';

/* Forest's result moment in motion (#1477, F17.5): a firefly flies into a
 * freshly earned jar, the jar dims to dusk and glows once, the second 400 ms
 * later. The droppable half of the slice, so it has its own section in
 * forest.css and its own spec.
 *
 * What is pinned, since jsdom runs no animation:
 *   - motion exists ONLY inside `prefers-reduced-motion: no-preference`, so
 *     reduced motion shows the end state from 0 ms;
 *   - only a `[data-fresh]` moment item moves (K17's one motion hook — a cold
 *     load never carries it, test/badges-moment-fresh.test.js);
 *   - nothing loops and nothing fills, so the resting state is the static
 *     skin; and the whole sequence ends by Ocean's 1 580 ms (the issue: shorten
 *     rather than ship long);
 *   - every keyframe a rule names exists, and the moment's own markup still
 *     marks the second fresh item as fresh (the `~` selector's premise). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rulesOf } = require('./support/css');
const { loadApp } = require('./support/dom');
const { night, badgeRound, stubApi } = require('./support/badge-fixture');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'forest.css'), 'utf8');
const MOTION = (() => {
  const from = RAW.indexOf('/* ===== #1477 — the firefly into the jar');
  const to = RAW.indexOf('/* ===== end #1477 motion ===== */');
  assert.ok(from > 0 && to > from, 'the #1477 motion section is not in forest.css');
  return RAW.slice(from, to).replace(/\/\*[\s\S]*?\*\//g, '');
})();
const GATE = ':root[data-design="forest"]:not([data-scheme="dark"])';
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// The section's top-level blocks: [prelude, inner text].
function blocks(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (depth && j < css.length) {
      if (css[j] === '{') depth += 1;
      if (css[j] === '}') depth -= 1;
      j += 1;
    }
    out.push([norm(css.slice(i, open)), css.slice(open + 1, j - 1)]);
    i = j;
  }
  return out;
}

const TOP = blocks(MOTION);
const ANIMATED = rulesOf(MOTION).filter(([, b]) => /\banimation\s*:/.test(b));
const ms = (v) => (/ms$/.test(v) ? Number(v.slice(0, -2)) : Number(v.slice(0, -1)) * 1000);

test('every block of the motion sits behind prefers-reduced-motion: no-preference', () => {
  assert.ok(TOP.length >= 2, `only ${TOP.length} top-level blocks — did the section move?`);
  const ungated = TOP.filter(([prelude]) => !/^@media \(prefers-reduced-motion: no-preference\)/.test(prelude));
  assert.deepEqual(ungated.map(([p]) => p), [], 'a block moves (or sets up motion) under reduced motion');
});

test('only a FRESH moment item moves', () => {
  assert.ok(ANIMATED.length >= 4, `only ${ANIMATED.length} animated rules`);
  const stray = ANIMATED.map(([sel]) => norm(sel)).filter((s) => !(s.startsWith(GATE) && s.includes('.badge-moment__item[data-fresh]')));
  assert.deepEqual(stray, []);
});

test('nothing loops, nothing fills, and the sequence ends by 1 580 ms', () => {
  let end = 0;
  for (const [sel, body] of ANIMATED) {
    const value = /\banimation\s*:\s*([^;]+)/.exec(body)[1];
    assert.doesNotMatch(value, /infinite|forwards|backwards|both|alternate/, `${norm(sel)} loops or fills`);
    for (const one of value.split(/,(?![^(]*\))/)) {
      const times = one.match(/\d+(?:\.\d+)?m?s\b/g) || [];
      assert.ok(times.length >= 1, `${one.trim()} has no duration`);
      const [dur, delay = '0ms'] = times;
      end = Math.max(end, ms(dur) + ms(delay));
    }
  }
  assert.doesNotMatch(MOTION, /animation-(iteration-count|fill-mode)/);
  assert.ok(end > 1000 && end <= 1580, `the sequence ends at ${end} ms`);
});

test('every keyframe a rule names is declared, and none is left over', () => {
  const declared = new Set([...MOTION.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  const used = new Set(ANIMATED.flatMap(([, b]) => [.../\banimation\s*:\s*([^;]+)/.exec(b)[1].matchAll(/\b(forest-[\w-]+)/g)].map((m) => m[1])));
  assert.deepEqual([...used].filter((k) => !declared.has(k)), [], 'a rule names a keyframe that does not exist');
  assert.deepEqual([...declared].filter((k) => !used.has(k)), [], 'a keyframe nobody uses');
});

test('the firefly comes from up the clearing: above on a phone, left of the Tafel from 1280px', () => {
  const phone = rulesOf(MOTION).find(([sel, b]) => norm(sel) === `${GATE} .badge-moment` && /--ff-from/.test(b));
  assert.ok(phone, 'no start point for the flight');
  assert.match(phone[1], /--ff-from:\s*translate\(-?\d+px, -\d+px\)/, 'the phone flight starts above the jar');
  const wide = TOP.find(([p]) => /min-width: 1280px/.test(p));
  assert.ok(wide && /--ff-from:\s*translate\(-\d+px, -?\d+px\)/.test(wide[1]), 'the desktop flight starts left of the jar');
});

// The `~` sibling selector staggers the second jar — which needs both items
// to be marked fresh by the same refill. Pinned on the real view.
test('a winner tap that earns two marks marks both fresh, so the second follows the first', (t) => {
  const r = badgeRound(Array.from({ length: 10 }, (_, i) => night(`s${i + 1}`, i + 1, { winnerIds: [] })));
  const dom = loadApp({ locale: 'de', design: 'forest' });
  t.after(() => dom.close());
  stubApi(dom, r);
  const el = dom.document.createElement('section');
  el.className = 'badge-moment';
  const last = r.sessions[r.sessions.length - 1];
  const before = { ...r, sessions: r.sessions.slice(0, -1) };
  dom.call('fillBadgeMoment', el, before, r.sessions[r.sessions.length - 2]);
  dom.call('fillBadgeMoment', el, r, last);
  const items = [...el.querySelectorAll('.badge-moment__item')];
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.hasAttribute('data-fresh')), 'both marks of the tap are fresh');
});
