'use strict';

/* Der Tisch's Abzeichen motion (#1386, T17.5; review finding 6): on the result
 * moment a JUST-earned pin drops onto the felt and settles with one short
 * bounce — pin 1 at 400 ms, pin 2 160 ms behind, nothing running after
 * 1 040 ms. Usable from 0 ms, at most two marks, no motion on text, and
 * reduced motion is the end state from 0 ms.
 *
 * The motion itself is judged in a browser (computed values sampled over time,
 * see the PR). What a spec can pin is the contract: which hook fires it, which
 * elements move, the timing, the gate, and that the rest state is the static
 * design. The hook itself (views-badges.js: the first fill marks nothing, a
 * later fill marks only what it had not shown) is checked here once, under Der
 * Tisch, the design that reads it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, waitFor } = require('./support/dom');
const { night, badgeRound, stubApi } = require('./support/badge-fixture');
const { mediaBlocks, rulesOf } = require('./support/css');

const TISCH_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const motionRules = mediaBlocks(TISCH_CSS)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));
const NAMES = ['tisch-pin-drop', 'tisch-pin-in', 'tisch-pin-cast', 'tisch-pin-ground'];
const usesPin = (body) => NAMES.some((n) => body.includes(n));

function keyframes(name) {
  const m = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(TISCH_CSS);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  for (; depth > 0; i++) {
    if (TISCH_CSS[i] === '{') depth++;
    else if (TISCH_CSS[i] === '}') depth--;
  }
  return TISCH_CSS.slice(m.index + m[0].length, i - 1);
}

const GATE = ':root[data-design="tisch"][data-scheme="dark"] ';
const FRESH = `${GATE}.badge-moment__item[data-fresh] .badge[data-state="earned"] .badge__mark`;
const SECOND = `${GATE}.badge-moment__item[data-fresh] ~ .badge-moment__item[data-fresh] .badge[data-state="earned"] .badge__mark`;

/* ---------------------------------------------------------- the hook, under Tisch */

test('Der Tisch: a winner tap that earns a mark marks only that one fresh', async (t) => {
  const r = badgeRound([night('s1', 1, { winnerIds: [] })]);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, r);
  dom.set('api', async (method, url, body) => {
    if (/\/finish$/.test(url)) return { winnerIds: body.winnerIds, finishedAt: '2026-07-01T22:00:00.000Z' };
    return /\/activities$/.test(url) ? [] : {};
  });
  dom.call('applyDesign', 'tisch');
  await dom.call('showResults', r, r.sessions[0], r.games, false);
  const m = dom.app.querySelector('.badge-moment');
  assert.equal(m.querySelectorAll('.badge-moment__item[data-fresh]').length, 0,
    'arriving at a finished session drops nothing');

  [...dom.app.querySelectorAll('.tisch button')].find((b) => b.textContent.trim() === dom.run("t('result.change')")).click();
  [...dom.app.querySelectorAll('.winner-chip')].find((c) => c.textContent.includes('Anna')).click();
  await waitFor(() => m.querySelectorAll('.badge').length === 2, { label: 'the first win joins the moment' });
  const fresh = [...m.querySelectorAll('.badge-moment__item')]
    .map((li) => [li.querySelector('.badge').dataset.key, li.hasAttribute('data-fresh')]);
  assert.deepEqual(fresh, [['firstWin', true], ['founded', false]],
    'the pin the tap earned drops; the one already lying there does not fall again');
});

/* ---------------------------------------------------------- the CSS contract */

test('the drop runs only on a fresh EARNED pin, only in Der Tisch, only inside the motion gate', () => {
  const users = rulesOf(TISCH_CSS).filter(([, b]) => usesPin(b));
  assert.ok(users.length >= 3, 'the pin, the glyph and the ground shadow are animated');
  assert.equal(users.length, motionRules.filter(([, b]) => usesPin(b)).length,
    'every rule that runs it sits inside prefers-reduced-motion: no-preference — reduced motion is the end state from 0 ms');
  for (const [sel] of users) {
    for (const part of sel.split(',').map((s) => s.trim())) {
      assert.ok(part.startsWith(`${FRESH}::before`) || part.startsWith(`${FRESH} > .ti`) || part.startsWith(`${FRESH}::after`),
        `${part} — only the mark, under the one-shot hook and the scheme gate`);
    }
    assert.ok(motionRules.some(([s, b]) => s === sel && usesPin(b)),
      `${sel} sits inside prefers-reduced-motion: no-preference — reduced motion is the end state from 0 ms`);
  }
});

test('no motion on text: the name, the line, the holder and the kicker never animate', () => {
  const moving = rulesOf(TISCH_CSS).filter(([, b]) => /animation/.test(b)).map(([s]) => s).join('\n');
  assert.doesNotMatch(moving, /badge__name|badge__line|badge-moment__holder|badge-moment__title|badge-moment__more/);
  assert.doesNotMatch(moving, /\.badge-moment\s*\{|\.badge-moment__item[^,{]*\.badge(\[[^\]]*\])?\s*(,|$)/m,
    'nor the plate or the button that carries them');
  for (const [, b] of motionRules.filter(([, x]) => usesPin(x))) {
    assert.doesNotMatch(b, /pointer-events|visibility/, 'usable from 0 ms: the motion never takes the target away');
  }
});

test('the timing: pin 1 at 400 ms, pin 2 160 ms behind, all still by 1 040 ms, no loop', () => {
  const pin = motionRules.find(([s]) => s === `${FRESH}::before`)[1];
  assert.match(pin, /animation-name:\s*tisch-pin-drop,\s*tisch-pin-in,\s*tisch-pin-cast/);
  assert.match(pin, /animation-duration:\s*480ms,\s*120ms,\s*480ms/);
  assert.match(pin, /animation-delay:\s*400ms/);
  const glyph = motionRules.find(([s]) => s === `${FRESH} > .ti`)[1];
  assert.match(glyph, /tisch-pin-drop 480ms 400ms both, tisch-pin-in 120ms linear 400ms both/,
    'the glyph rides the brass on the same clock');
  const ground = motionRules.find(([s]) => s === `${FRESH}::after`)[1];
  assert.match(ground, /tisch-pin-ground 480ms 400ms both/);

  const second = motionRules.find(([s]) => s.split(',').map((x) => x.trim()).includes(`${SECOND}::before`));
  assert.ok(second, 'a second fresh pin has its own delay');
  for (const part of [`${SECOND}::before`, `${SECOND} > .ti`, `${SECOND}::after`]) {
    assert.ok(second[0].split(',').map((x) => x.trim()).includes(part), `${part} is staggered too`);
  }
  const delay2 = Number(/animation-delay:\s*(\d+)ms/.exec(second[1])[1]);
  assert.equal(delay2 - 400, 160, 'the second pin follows 160 ms later');
  assert.ok(delay2 + 480 <= 1040, `the last pin rests at ${delay2 + 480} ms`);
  for (const [, b] of motionRules.filter(([, x]) => usesPin(x))) assert.doesNotMatch(b, /infinite|alternate/);
});

test('the keyframes: −48px and 1.08 to rest on gravity, one 4px lift, and NO end frame', () => {
  const drop = keyframes('tisch-pin-drop');
  assert.ok(drop, 'the keyframes exist');
  assert.match(drop, /0%\s*\{[^}]*translate:\s*0 -48px;[^}]*scale:\s*1\.08;[^}]*cubic-bezier\(\.55, 0, \.9, \.4\)/);
  assert.match(drop, /75%\s*\{[^}]*translate:\s*0 0;[^}]*scale:\s*1;/, 'it lands at 360 of 480 ms, i.e. at 760 ms');
  assert.match(drop, /87%\s*\{\s*translate:\s*0 -4px;/, 'and lifts once, 4px');
  assert.match(keyframes('tisch-pin-ground'), /0%\s*\{\s*opacity:\s*\.25;\s*scale:\s*\.5;/, 'the shadow starts faint and small');
  assert.match(keyframes('tisch-pin-in'), /0%\s*\{\s*opacity:\s*0;/);
  for (const name of NAMES) {
    const frames = keyframes(name);
    assert.ok(frames, `${name} exists`);
    assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, `${name}: no end frame — it settles on the static design`);
    assert.doesNotMatch(frames, /\btransform\s*:/, `${name}: individual translate/scale, never transform`);
  }
});

test('the rest state is the static pin: the ground shadow is at 0 outside the motion', () => {
  const rest = rulesOf(TISCH_CSS).find(([s]) => s === `${GATE}.badge-moment .badge__mark::after`);
  assert.ok(rest, 'the ground shadow has a rest rule');
  assert.match(rest[1], /opacity:\s*0;/, 'so reduced motion and the settled frame both show the static pin');
  assert.ok(!motionRules.some(([s]) => s === rest[0]), 'and that rest rule is not inside the motion gate');
});
