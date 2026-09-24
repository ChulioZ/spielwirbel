'use strict';

/* Der Tisch's EMPTY and YOUNG states, the demo's two marks, and the density
 * cases (#1194, T7.1–T7.7).
 *
 * All CSS, so all of it is text: jsdom applies no external stylesheet and the
 * Browser pane is where the pixels were judged
 * (.claude/rules/testing-views-under-jsdom.md). What a text assertion can hold
 * is the handful of claims that are LOAD-BEARING rather than cosmetic — the
 * ones whose regression is silent, which on this slice is all four of:
 *
 *   - the locked plate falling back to styles.css's 45% opacity, which on this
 *     design dissolves the screen's one object and drops its label to 2.2:1;
 *   - the demo banderole keeping a child whose ink is brass, i.e. invisible on
 *     brass — derived from styles.css rather than listed, so a child added
 *     later is covered without anyone editing this file;
 *   - the hatch growing a second source of truth, where dropping either copy
 *     takes every felt background in the file invalid at once;
 *   - the seat arc going back to a fixed amplitude, which is the twelve-seat
 *     case the whole rule exists for.
 *
 * The scheme gate is NOT re-checked here: test/tisch-hub-lobby.test.js derives
 * it over the whole file, so every rule below is already covered there.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rulesOf, bodyOf, declaredValue } = require('./support/css');

const SHEET = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const RULES = rulesOf(SHEET.replace(/@media[^{]+\{/g, ''));

/* Every body whose selector list mentions `needle`, joined. A component here is
   routinely styled by more than one rule (the base, then the size override), so
   the question is what the design says about it in total. */
const bodiesFor = (needle) => RULES
  .filter(([selector]) => selector.includes(needle))
  .map(([, body]) => body)
  .join('\n');

test('the empty state stops being a brand medallion and becomes the table', () => {
  const icon = bodiesFor('.empty__icon');
  assert.ok(icon, '.empty__icon is not styled by the design at all');

  /* The whole gesture: a brass ring (the border box) around a disc of the
     round's own felt (the padding box). Built exactly like the lobby tile's
     emblem, so a young round's screens and its tile show one object. */
  assert.match(icon, /border:\s*\d+px solid transparent/,
    'the ring is a transparent border with two background clips — see .round-card__emblem');
  assert.match(icon, /padding-box/, 'the felt disc must clip to the padding box');
  assert.match(icon, /border-box/, 'the brass must clip to the border box');
  assert.match(icon, /var\(--marker,\s*var\(--felt\)\)/,
    'the disc is the ROUND\'s felt, falling back to the design default outside one');
  assert.match(icon, /var\(--gold-deep\)[\s\S]*var\(--gold-edge\)/,
    'the ring is the brass gradient');

  // The box itself: the walnut the design already is, not the brand wash.
  const box = RULES.find(([sel]) => sel.includes('.empty,') || sel.includes('.empty\n'));
  assert.ok(box, 'no rule re-grounds .empty');
  assert.equal(declaredValue(box[1], 'background'), 'var(--surface)');
  assert.equal(declaredValue(box[1], 'border-color'), 'var(--control-edge)');
});

test('the locked plate is unlit, not dissolved', () => {
  /* styles.css disables every .btn with `opacity: .45`. On this design that
     fades the milled brass plate — the one object the hub is built around —
     into a ghost, on precisely the screen a new round spends its first week
     in, and takes its label to 2.2:1 with it. */
  assert.equal(declaredValue(bodyOf('.btn:disabled'), 'opacity'), '0.45',
    'styles.css no longer fades a disabled button — re-read this whole test');

  const locked = bodiesFor('.hub-cta:disabled');
  assert.ok(locked, 'the hub CTA has no disabled treatment in this design');
  assert.equal(declaredValue(locked, 'opacity'), '1',
    'without this the app-wide 45% fade wins and the plate is a ghost again');
  assert.equal(declaredValue(locked, 'color'), 'var(--ink-soft)');
  assert.equal(declaredValue(locked, 'background'), 'var(--control-fill)');
  /* The cast inverts: a plate pressed INTO the table cannot be pressed
     further, which is what carries "unavailable" once the fade is gone. */
  assert.match(declaredValue(locked, 'box-shadow'), /^inset /,
    'the locked plate is sunken — it is the only remaining disabled signal');
  assert.ok(locked.includes('.rail__cta:disabled') || bodiesFor('.rail__cta:disabled'),
    'the rail carries the same CTA and needs the same treatment');
});

test('every ink the demo banner carries is answered for on brass', () => {
  /* The banderole is the brass plate, so its ink is --on-accent. Every child
     styles.css gives a colour to is then standing on brass wearing a colour
     tuned for walnut — and on this design --brand and --warn are both LIGHT,
     so those children would be very nearly invisible: --brand measures 1.55:1
     on --brass-hi and 1.00:1 on --gold-deep, where it IS the stop.

     DERIVED from styles.css, never listed: a child added to the banner later
     inherits this check instead of needing someone to remember this file. The
     same shape test/tisch-konto.test.js uses for the sticky sheet bars. */
  const inked = [...new Set(rulesOf(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
  )
    .filter(([sel, body]) => sel.includes('.demo-banner') && declaredValue(body, 'color'))
    .flatMap(([sel]) => sel.split(',').map((s) => s.trim()))
    .filter((sel) => sel.includes('.demo-banner') && !sel.endsWith(':hover')))];

  assert.ok(inked.length >= 3,
    `only ${inked.length} inked banner parts found — the derivation has gone vacuous`);

  const answered = inked.filter((sel) => {
    // The bare part, without the state or the ancestor, is what the design names.
    const part = sel.replace(/^.*\.demo-banner/, '.demo-banner').replace(/:[a-z-]+$/, '');
    return RULES.some(([s, body]) => s.includes(part) && declaredValue(body, 'color'));
  });

  assert.deepEqual(answered.sort(), inked.sort(),
    'these parts of the demo banner keep a walnut-tuned ink on a brass ground');

  // And the banner itself is the plate, with the plate's measured ink.
  const banner = RULES.find(([sel]) => /\.demo-banner\s*$/.test(sel.trim()));
  assert.ok(banner, 'the demo banner is not re-grounded by the design');
  assert.match(declaredValue(banner[1], 'background'),
    /linear-gradient\(180deg, var\(--brass-hi\), var\(--gold-deep\)\)/);
  assert.equal(declaredValue(banner[1], 'color'), 'var(--on-accent)');
});

test('the demo hatch has exactly one source of truth', () => {
  /* `--felt-hatch` is declared ONLY where the demo switches it on; every felt
     surface that names it supplies `none` as the fallback, which IS the
     default for an ordinary round. Two copies would be the dangerous kind of
     redundancy: drop either and the surviving one is still "correct", but drop
     the declaration while a use site has no fallback and `background` goes
     invalid on every felt in the file at once — with no error and no test
     (.claude/rules/redundant-guards-make-each-other-untestable.md). */
  const declarations = [...SHEET.matchAll(/--felt-hatch:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.equal(declarations.length, 1,
    `--felt-hatch is declared ${declarations.length} times — the fallback at the use site is the default`);
  assert.match(declarations[0], /^repeating-linear-gradient\(135deg, var\(--cast-soft\)/,
    'the hatch darkens, so every felt pair already measured stays the worst case');

  const owner = RULES.find(([, body]) => body.includes('--felt-hatch:'));
  assert.match(owner[0], /body\.has-demo-banner/,
    'the hatch is switched on the demo body class, and inherits from there');

  const uses = [...SHEET.matchAll(/var\(--felt-hatch([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 1, 'nothing paints the hatch');
  assert.deepEqual([...new Set(uses)], [', none'],
    'every use site must carry the `none` fallback — it is the default, not a safety net');
});

test('the seat arc flattens as the table fills', () => {
  /* #1189 fixed the bulge at 14px, which is right for the six or eight seats a
     round usually has and wrong for twelve: the row wraps and the second line
     carries the tail of the same curve. T7.7 lays twelve seats out flat.

     Asserted as the DECISION rather than as its ingredients — the clamp is
     evaluated here for a normal round and for T7.7's own case, so a retuned
     falloff that stopped reaching zero would fail rather than pass on a
     still-present `clamp(`. */
  const row = bodiesFor('.hero__members');
  const lift = declaredValue(row, '--seat-lift');
  assert.ok(lift, 'the seat lift is not a variable — a fixed amplitude is the bug');

  const m = lift.match(/clamp\(\s*([\d.]+)px,\s*calc\(\(([\d.]+) - var\(--seat-n[^)]*\)\) \* ([\d.]+)px\),\s*([\d.]+)px\)/);
  assert.ok(m, `--seat-lift is not the expected falloff: ${lift}`);
  const [, floor, zeroAt, step, ceiling] = m.map(Number);
  const at = (n) => Math.min(Math.max((zeroAt - n) * step, floor), ceiling);

  assert.equal(at(7), 14, 'a six-member round must keep the arc #1189 shipped, unchanged');
  assert.equal(at(9), ceiling, 'eight members plus the „+" still sit on the full arc');
  assert.equal(at(13), 0, 'twelve members plus the „+" is T7.7\'s case and must lie flat');
  assert.ok(at(10) > 0 && at(10) < ceiling,
    'the falloff must be gradual — a cliff makes adding one member jolt the whole row');

  // And the transform has to actually read it.
  assert.match(bodiesFor('.hero__members > *'), /var\(--seat-lift\)/);
  assert.doesNotMatch(bodiesFor('.hero__members > *'), /-14px \* sin/,
    'the fixed amplitude is what this rule replaces');
});

test('a long round name breaks in the rail instead of bleeding out of it', () => {
  /* Measured at 1440: the rail is 260px, prints the name in the display face
     at --text-2xl, and „Donnerstagsrunde im Spielecafé Nord" reported
     scrollWidth 242 against clientWidth 221 — one word wider than the rail.
     Klassisch does not have this (narrower face, two steps smaller), which is
     why the fix is here.

     Never an ellipsis: a round's name is how people tell their rounds apart,
     and the identifying part is as often at the end as at the start. */
  const name = bodiesFor('.rail__name');
  assert.equal(declaredValue(name, 'overflow-wrap'), 'break-word');
  /* …and where the language allows it, the break is a HYPHENATED one: without
     this a single long word split as „Donnerstagsrun / de" (seen at 1440 on
     #1197's screenshots). `hyphens` needs <html lang>, which i18n.js sets to the
     active locale; break-word stays as the fallback for a word no dictionary
     can split. Both spellings, because Safari before 17 knows only the prefix. */
  assert.equal(declaredValue(name, 'hyphens'), 'auto', 'a long word breaks at a syllable, with a hyphen');
  assert.equal(declaredValue(name, '-webkit-hyphens'), 'auto', 'and in older Safari too');
  assert.equal(declaredValue(name, 'text-overflow'), null, 'the name must not be truncated');
  assert.equal(declaredValue(name, 'white-space'), null, 'the name must be allowed to wrap');
});
