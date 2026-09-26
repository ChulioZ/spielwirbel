'use strict';

/* Ocean's Abzeichen motion (#1386, O17.5): after the whale (O10.2) surfaces, a
 * bubble rises from the water, bursts in the shell and becomes the pearl; the
 * second mark follows 160 ms later. Binding: docs/design/pruefung-abzeichen-
 * 2026-09-26.md finding 6 — 800 → 1580 ms, usable from 0 ms, at most two marks,
 * reduced motion = the pearl in place from 0 ms, no motion on text, and the
 * pearl never overtakes the whale.
 *
 * The CSS contract is pinned here as text (jsdom applies no stylesheet); the
 * motion itself was sampled as computed values in headless Chromium, see the
 * PR. The DOM half proves the ritual's selectors match what the result screen
 * renders under Ocean — a selector that matches nothing is a ritual that never
 * plays, with every other assertion green. The hook itself (`data-fresh`) is
 * design-neutral and pinned in test/badges-moment-fresh.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, waitFor } = require('./support/dom');
const { mediaBlocks, rulesOf, topLevel } = require('./support/css');
const { night, badgeRound, stubApi } = require('./support/badge-fixture');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'ocean.css'), 'utf8');
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '');
const HEAD = '/* ===== #1386 O17.5 motion — the bubble rises after the whale ===== */';
const GATE = ':root[data-design="ocean"]:not([data-scheme="dark"]) ';
const ITEM = `${GATE}.badge-moment__item[data-fresh]`;
const BUBBLE = `${ITEM}::after`;
const PEARL = `${ITEM} .badge__mark > .ti`;
const BUBBLE_2 = `${ITEM}:nth-child(2)::after`;
const PEARL_2 = `${ITEM}:nth-child(2) .badge__mark > .ti`;

function section() {
  assert.ok(RAW.includes(HEAD), 'the section header is this slice\'s drop seam');
  const start = RAW.indexOf(HEAD);
  const next = RAW.indexOf('/* ===== #', start + HEAD.length);
  return RAW.slice(start, next === -1 ? undefined : next).replace(/\/\*[\s\S]*?\*\//g, '');
}
const motionRules = (css) => mediaBlocks(css)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, block]) => rulesOf(block));
const bodyIn = (rules, sel) => (rules.find(([s]) => s === sel) || [])[1] || null;
const ms = (v) => (/ms$/.test(v) ? parseFloat(v) : parseFloat(v) * 1000);
// The <time>s of an `animation` shorthand, in order: [duration, delay].
const times = (body) => {
  const m = /animation:\s*([^;]+);/.exec(body || '');
  return m ? (m[1].match(/\b[\d.]+m?s\b/g) || []).map(ms) : [];
};
const delayOf = (body) => {
  const m = /animation-delay:\s*([\d.]+m?s)/.exec(body || '');
  return m ? ms(m[1]) : null;
};

function keyframes(name) {
  const m = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(CSS);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  for (; depth > 0; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}') depth--;
  }
  return rulesOf(CSS.slice(m.index + m[0].length, i - 1));
}

/* -------------------------------------------------------- the CSS contract */

test('the whole slice sits inside the motion gate — reduced motion keeps the pearl in place, no bubble', () => {
  const css = section();
  assert.deepEqual(rulesOf(topLevel(css)), [], 'no rule of this slice applies outside a media block');
  const gated = motionRules(css);
  assert.ok(gated.length >= 4, `only ${gated.length} gated rules — did the parse break?`);
  const selectors = gated.map(([s]) => s).filter((s) => !/^(from|to|\d)/.test(s));
  for (const s of selectors) assert.ok(s.startsWith(GATE), `${s} is not gated on Ocean's light scheme`);
  // The bubble exists only inside the no-preference gate, and nothing gives the
  // pearl an animation under `reduce`: the #1391 rest state is the Endbild.
  const bubble = bodyIn(gated, BUBBLE);
  assert.ok(bubble && /content:\s*""/.test(bubble), 'the bubble exists only inside the gate');
  const reduce = mediaBlocks(CSS)
    .filter(([q]) => /prefers-reduced-motion:\s*reduce/.test(q))
    .flatMap(([, b]) => rulesOf(b)).filter(([s]) => /badge-moment/.test(s));
  assert.deepEqual(reduce, [], 'nothing re-adds motion to the moment under reduce');
});

test('only a fresh mark moves, and never its text', () => {
  const gated = motionRules(section());
  const animated = gated.filter(([, b]) => /animation(-delay)?:/.test(b)).map(([s]) => s);
  assert.deepEqual(animated.sort(), [BUBBLE, PEARL, BUBBLE_2, PEARL_2].sort());
  for (const s of animated) {
    assert.ok(s.includes('[data-fresh]'), `${s} would replay on every refill`);
    assert.ok(!/badge__(name|line)|badge-moment__(holder|title|more)/.test(s), `${s} moves text`);
  }
});

test('O17.5\'s timing: bubble at 800 ms (420 climb + 160 burst), pearl at 1220 ms for 200 ms, the second +160, still at 1580', () => {
  const gated = motionRules(section());
  const [bubbleDur, bubbleDelay] = times(bodyIn(gated, BUBBLE));
  const [pearlDur, pearlDelay] = times(bodyIn(gated, PEARL));
  assert.equal(bubbleDelay, 800);
  assert.equal(bubbleDur, 420 + 160);
  assert.equal(pearlDelay, 800 + 420, 'the pearl grows the moment the bubble bursts');
  assert.equal(pearlDur, 200);
  assert.match(bodyIn(gated, PEARL), /ease-out/);
  assert.equal(delayOf(bodyIn(gated, BUBBLE_2)), bubbleDelay + 160);
  assert.equal(delayOf(bodyIn(gated, PEARL_2)), pearlDelay + 160);
  assert.equal(pearlDelay + 160 + pearlDur, 1580, 'the whole ritual ends at 1580 ms');
});

test('the pearl never overtakes the whale: it is held invisible until after O10.2 is still', () => {
  const gated = motionRules(CSS);
  const whale = gated.find(([s, b]) => /\.tisch-slot\[data-stamped\]/.test(s) && /ocean-surface/.test(b));
  assert.ok(whale, 'the whale ritual is where #1221 put it');
  const [whaleDur, whaleDelay = 0] = times(whale[1]);
  const whaleEnd = whaleDelay + whaleDur;
  const [, bubbleDelay] = times(bodyIn(gated, BUBBLE));
  const [, pearlDelay] = times(bodyIn(gated, PEARL));
  assert.ok(bubbleDelay > whaleEnd, `the bubble starts at ${bubbleDelay} ms, the whale ends at ${whaleEnd}`);
  assert.ok(pearlDelay > whaleEnd, `the pearl shows at ${pearlDelay} ms, the whale ends at ${whaleEnd}`);
  // Before its delay the pearl is held at the invisible from-frame rather than
  // shown at rest: a `backwards` fill over a from-frame at opacity 0.
  assert.match(bodyIn(gated, PEARL), /\bbackwards\b/);
  const pearl = keyframes('ocean-pearl');
  assert.ok(pearl, '@keyframes ocean-pearl exists');
  const from = (pearl.find(([s]) => /^(from|0%)$/.test(s)) || [])[1] || '';
  assert.match(from, /opacity:\s*0\b/);
  assert.match(from, /scale\(0\.6\)/);
  assert.ok(!pearl.some(([s]) => /^(to|100%)$/.test(s)), 'no end frame: it ends on the #1391 rest');
});

test('the bubble climbs 60px at 0.6 → 0.9 on O10\'s curve, bursts to 1.3 and 0, and rests invisible', () => {
  const kf = keyframes('ocean-bubble');
  assert.ok(kf, '@keyframes ocean-bubble exists');
  const at = (step) => (kf.find(([s]) => s === step) || [])[1] || '';
  assert.match(at('0%'), /translateY\(60px\) scale\(0\.6\)/);
  assert.match(at('0%'), /cubic-bezier\(0\.2, 0\.8, 0\.3, 1\)/);
  const climbEnd = kf.find(([, b]) => /translateY\(0\) scale\(0\.9\)/.test(b));
  assert.ok(climbEnd, 'the climb ends at the shell at 0.9');
  assert.ok(Math.abs(parseFloat(climbEnd[0]) - (420 / 580) * 100) < 0.01, `the climb ends at ${climbEnd[0]}, not 420/580`);
  assert.match(at('100%'), /opacity:\s*0\b/);
  assert.match(at('100%'), /scale\(1\.3\)/);
  const body = bodyIn(motionRules(section()), BUBBLE);
  assert.match(body, /opacity:\s*0\b/, 'the bubble rests invisible, so no fill is needed');
  assert.match(body, /pointer-events:\s*none/, 'the pill is a button from 0 ms — the bubble takes no tap');
  assert.ok(!/animation:[^;]*\b(forwards|both|infinite)\b/.test(body), 'no fill, no loop');
});

/* ----------------------------------------- the selectors match the real DOM */

test('under Ocean the ritual\'s selectors match a mark the tap just earned, and nothing already shown', async (t) => {
  const r = badgeRound([night('s1', 1, { winnerIds: [] })]);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, r);
  dom.set('toast', () => {});
  dom.set('api', async (method, url, body) => {
    if (/\/finish$/.test(url)) return { winnerIds: body.winnerIds || [], finishedAt: '2026-07-01T22:00:00.000Z' };
    return /\/activities$/.test(url) ? [] : {};
  });
  dom.call('applyDesign', 'ocean');
  await dom.call('showResults', r, r.sessions[0], r.games, false);
  const q = (sel) => [...dom.document.querySelectorAll(sel.replace('::after', ''))];
  assert.ok(dom.document.querySelector(`${GATE}.badge-moment .badge__mark > .ti`), 'the cold moment renders under Ocean');
  assert.equal(q(PEARL).length, 0, 'a cold load plays nothing');

  [...dom.app.querySelectorAll('.tisch button')].find((b) => b.textContent.trim() === dom.run("t('result.change')")).click();
  [...dom.app.querySelectorAll('.winner-chip')].find((c) => c.textContent.includes('Anna')).click();
  await waitFor(() => q(PEARL).length === 1, { label: 'the first win arrives fresh' });
  assert.equal(q(BUBBLE).length, 1);
  assert.equal(q(PEARL)[0].closest('.badge').dataset.key, 'firstWin');
  assert.equal(q(PEARL_2).length, 0, 'the fresh one is the first item — no stagger');
});
