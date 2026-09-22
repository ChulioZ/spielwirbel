'use strict';

/* Der Tisch's SESSION LOOP (#1191) — setup, vote card, result, several tables,
 * over #1190's Regal, #1189's hub and #1188's tokens.
 *
 * Most of this slice is repaint, and repaint is already guarded generically:
 * test/tisch-hub-lobby.test.js derives "a rule reading a scheme-gated token is
 * itself scheme-gated" over the whole file, test/design-layer's two sweeps
 * refuse a colour literal or a token shadow outside the root blocks, and
 * test/a11y-contrast.test.js now measures the bar ramp, the row tags and the
 * gold sweep's pale stop. A rule added here is picked up by all of them without
 * anyone editing a list.
 *
 * What none of them can see is the four claims below — and three of the four
 * are about a CONTRACT BETWEEN JS AND CSS, which is a shape this repo had none
 * of before this issue: the JS writes a rung and the stylesheet paints it, and
 * nothing in either half knows the other exists.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const SHEET = read('public', 'css', 'designs', 'tisch.css').replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = rulesOf(SHEET.replace(/@media[^{]+\{/g, ''));
const HOOK = ':root[data-design="tisch"][data-scheme="dark"]';

const selectorsMatching = (re) => RULES
  .flatMap(([sel]) => sel.split(',').map((x) => x.trim()))
  .filter((sel) => re.test(sel));
const bodyFor = (needle) => {
  const hit = RULES.find(([sel]) => sel.replace(/\s+/g, ' ').includes(needle));
  return hit ? hit[1] : null;
};

/* 1 — THE RUNGS THE JS WRITES ARE EXACTLY THE RUNGS THE CSS PAINTS.
 *
 * `rampStop`/`scoreStop` (round-theme.js, game-stats.js) turn a value into a
 * string that lands in `data-stop`, and tisch.css paints `[data-stop="…"]`. The
 * two lists are written in different languages, in different files, by hand.
 *
 * A mismatch is SILENT and it is silent in the worst direction: a stop the CSS
 * does not paint leaves `--sc` undefined, and `background: var(--sc)` with an
 * undefined custom property is invalid at computed-value time, so the property
 * falls back to its initial value — a TRANSPARENT pill. Not a wrong colour, not
 * an error: a number floating on the row with no lozenge under it, on whichever
 * rung nobody happened to look at.
 *
 * So the assertion is a set equality in both directions, derived from the real
 * function over its whole domain rather than from a list restated here.
 */
test('every rung the score functions can emit is a rung the design paints, and vice versa', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());

  // The whole domain, finely enough to cross every rounding boundary: the
  // ramp runs 0-5 and `displayScore` floors at SCORE_MIN.
  const emitted = new Set();
  for (let v = 0; v <= 5.0001; v += 0.05) {
    emitted.add(dom.run(`rampStop(${v.toFixed(2)})`));
    emitted.add(dom.run(`scoreStop(${v.toFixed(2)})`));
  }
  assert.ok(emitted.size >= 6, `only ${emitted.size} rungs came out — did the sweep stop running?`);

  const painted = new Set(
    selectorsMatching(/\[data-stop=/)
      .map((sel) => /\[data-stop="([^"]+)"\]/.exec(sel)[1])
  );
  assert.ok(painted.size >= 6, `only ${painted.size} rungs are painted — did the hook move?`);

  assert.deepEqual([...emitted].sort(), [...painted].sort(),
    'the rungs JS writes into data-stop and the rungs tisch.css paints have drifted apart');

  /* The two CLAMPS, asserted directly, because the sweep above cannot reach
     them: nothing in the app feeds these functions a value outside 0-5 today,
     so both edges are inert over the real domain and a break there stays green
     (measured — that is why these two lines exist rather than being trusted).
     They are kept rather than deleted because this is a JS/CSS boundary whose
     failure is a transparent pill, and `rampStop` is a shared-scope helper any
     later view can call (.claude/rules/redundant-guards-make-each-other-
     untestable.md: construct the state, or drop the guard). */
  assert.equal(dom.run('rampStop(7)'), '5', 'a value above the scale must clamp to the top rung');
  assert.equal(dom.run('rampStop(-1)'), 'veto', 'a value below the scale is off it, not a bad 1');
  assert.equal(dom.run('rampStop(null)'), null, 'no score means no rung, so no attribute is written');
});

/* 2 — THE TWO RAMPS MUST NOT BE SWAPPED.
 *
 * T8.2 ships two: pills rise light and switch ink halfway, bars are darker
 * because they are drawn ON paper and on the gold row. Swap them and the app
 * still renders — five plausible colours in both places — and only the gold row
 * fails, at 2,83:1 and 2,68:1, which is exactly the reading nobody takes by eye.
 *
 * test/a11y-contrast.test.js measures each RAMP against its own grounds, so it
 * cannot see a swap: both ramps pass their own test while being wired to the
 * wrong element. This is the assertion that says which is which.
 */
test('the bars take the bar ramp and the pills take the pill ramp, never the other way round', () => {
  const ramps = { bar: /var\(--bar-[1-5]\)/, pill: /var\(--score-(?:[1-5]|veto)\)/ };

  const barRules = RULES.filter(([sel]) => /\.bar-col\[data-stop=/.test(sel));
  const pillRules = RULES.filter(([sel]) => /\.score-pill\[data-stop=/.test(sel));
  assert.equal(barRules.length, 5, 'expected one rule per bar rung');
  assert.equal(pillRules.length, 6, 'expected one rule per pill rung, veto included');

  for (const [sel, body] of barRules) {
    assert.match(body, ramps.bar, `${sel} does not read the bar ramp`);
    assert.doesNotMatch(body, ramps.pill,
      `${sel} paints a bar from the PILL ramp — it will fail 3:1 on the gold winning row`);
  }
  for (const [sel, body] of pillRules) {
    assert.match(body, ramps.pill, `${sel} does not read the pill ramp`);
    assert.doesNotMatch(body, ramps.bar, `${sel} paints a pill from the BAR ramp`);
    // A pill's ink is half of its rung: the low stops are deep fills taking
    // paper, the high ones pale fills taking walnut. A fill without its ink is
    // how a pale stop ends up carrying --on-accent.
    assert.match(body, /--sc-ink:/, `${sel} sets a fill but no ink`);
  }

  /* AND NEITHER MAY SET `--sc` ITSELF. That property arrives INLINE from the
     view, and an inline custom property beats a stylesheet rule for the same
     property exactly as an inline `background` beats a rule for the background
     — so a stop rule written `--sc: var(--bar-3)` is a no-op that reads as the
     obvious spelling. It is how this slice's first cut shipped: the app's own
     continuous ramp rendered everywhere, with the design's tokens declared,
     measured, and never reaching a pixel. Nothing else can see it; jsdom
     applies no stylesheet and the contrast suite measures the tokens rather
     than the paint. */
  for (const [sel, body] of [...barRules, ...pillRules]) {
    assert.doesNotMatch(body, /(?:^|[;{\s])--sc:/,
      `${sel} sets --sc, which the view already sets inline — it will never apply`);
  }
});

/* 3 — THE GOLD ROW'S SINGLE INK IS DERIVED, NOT ENUMERATED.
 *
 * Review finding A2 („Auf Gold nur eine Tinte: #4a3423") is a rule about a
 * GROUND, so the moment it is written as a list of the cells that exist today,
 * the next slice's cell ships at the 4,40:1 the finding was raised about — with
 * every test green, because a list cannot miss what it does not contain
 * (.claude/rules/source-scanning-guards-enumerate-shapes.md).
 *
 * The one deliberate exception is the axis glyph, which is a chart KEY rather
 * than type; it survives the sweep on specificity, and that is the fragile part
 * worth pinning — reorder the two rules and the exception silently stops
 * applying.
 */
test('the gold row states its ink for every descendant, with the chart key as the one exception', () => {
  const sweep = RULES.filter(([sel]) => /\.tafel-top \.trow \*\s*$/.test(sel.split(',').pop().trim()));
  assert.equal(sweep.length, 1, 'the gold row has no descendant ink sweep — was it turned into a list?');
  assert.match(sweep[0][1], /color:\s*var\(--gold-ink\)/);

  const key = RULES.find(([sel]) => /\.tafel-top \.trow \.bar-axis \.ti/.test(sel));
  assert.ok(key, 'the axis glyph has no exception, so the sweep flattens the chart key');

  /* The sweep must also out-specify every OTHER ink this file states inside the
     Tafel — `.tafel .score-big` and `.tafel .score-label` tie with it on class
     weight and sit later in the file, so without the extra `.tafel` in the
     sweep's own selector the winning row's SCORE printed in --paper-ink while
     the title beside it took the gold ink. Both are legible, which is exactly
     why only a browser reading caught it. Derived, so a paper-ink rule added
     later is covered without editing a list. (The assertion is at the end of
     this test, where `weight` is defined.) */

  /* `--sc-fill` IN FRONT of `--sc`, not `--sc` alone. Restoring the exception
     with the bare inline property is the exact bug this rule exists to avoid,
     and it is invisible: the glyph still gets a colour, just the app's ramp
     instead of the design's, on the one row anybody looks at. Measured in a
     browser on #1191 — the first cut shipped it. */
  assert.match(key[1], /color:\s*var\(--sc-fill,\s*var\(--sc\)\)/);

  /* The exception wins on SPECIFICITY, not on source order — a tie would be
     broken by position, which is the trap `.tisch__box .stamp--table` records
     in styles.css. Counted on the descendant arm alone: the sweep is a GROUP
     (`… .trow, … .trow *`) and counting the group would compare the key against
     both arms at once, which is how this assertion first passed for the wrong
     reason. Class-column weight = classes + attribute selectors + `:root`. */
  const weight = (sel) => (sel.match(/\.[a-z0-9_-]+|\[[^\]]+\]|:root/g) || []).length;
  const sweepArm = sweep[0][0].split(',').map((x) => x.trim()).find((x) => x.endsWith('*'));
  assert.ok(weight(key[0]) > weight(sweepArm),
    `the chart key (${weight(key[0])}) must out-specify the ink sweep (${weight(sweepArm)}), not merely follow it`);

  /* …and the sweep must out-specify every other ink this file states on a ROW
     CELL inside the Tafel. Scoped to the `.trow`/`.score-`/`.bar-` families
     rather than to "anything under `.tafel`": the Tafel also contains the
     winner-picker chips, which are not inside a row and legitimately keep their
     own ink. That is a family, not a hand-written list — a `.trow__*` or
     `.score-*` rule added later is covered without touching this. */
  const beaten = RULES
    .flatMap(([sel, body]) => sel.split(',').map((x) => [x.trim(), body]))
    .filter(([sel, body]) => /\.tafel\b/.test(sel) && !/\.tafel-top\b/.test(sel)
      && /\.(?:trow|score|bar)[-\s.[]/.test(sel) && /(?:^|[;{\s])color:/.test(body))
    .filter(([sel]) => weight(sel) >= weight(sweepArm))
    .map(([sel]) => sel);
  assert.ok(RULES.some(([sel, body]) => /\.tafel .score-big/.test(sel) && /color:/.test(body)),
    'no paper ink is stated inside the Tafel any more — this check has stopped seeing the file');
  assert.deepEqual(beaten, [],
    'these Tafel ink rules tie with or beat the gold sweep, so the winning row takes two inks');
});

/* 4 — NO SITE MAY GO BACK TO AN INLINE `background`.
 *
 * The whole override mechanism rests on the score colour travelling as a custom
 * property. One site re-written as `style="background:${scoreColor(x)}"` works
 * perfectly, looks exactly like the code it replaced, and quietly makes that one
 * element unpaintable by every design — the #1040 trap, from the other side.
 *
 * Scanned over the source because there is nowhere else to see it: jsdom applies
 * no stylesheet, so a DOM test of a pill cannot tell an inline fill from a token
 * one. The pattern is deliberately loose about what is between `background:` and
 * the call — it is the two FUNCTION NAMES that matter, and a shape this scan has
 * not seen is exactly what it would otherwise miss.
 */
test('no view paints a score straight onto an element', () => {
  const dir = path.join(__dirname, '..', 'public', 'js');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 40, `scanned ${files.length} files — the directory walk is wrong`);

  const INLINE = /(?:background|borderColor|background-color)\s*(?::|=)[^;'"`]*\b(?:avgColor|scoreColor)\s*\(/;
  const offenders = files
    .map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')])
    .filter(([, text]) => INLINE.test(text))
    .map(([f, text]) => `${f}: ${text.match(INLINE)[0].trim()}`);
  assert.deepEqual(offenders, [],
    'a score painted inline cannot be overridden by a design — write it as `--sc` plus `data-stop`');

  // Anti-vacuous: the scan must actually be able to see the shape it bans.
  assert.ok(INLINE.test('style="background:${scoreColor(x)}"'), 'the pattern no longer matches the banned shape');
  assert.ok(INLINE.test("b.style.background = avgColor(n);"), 'the pattern misses the property-assignment shape');
  assert.ok(!INLINE.test('style="--sc:${scoreColor(x)}"'), 'the pattern flags the shape it is meant to allow');
});

/* 5 — THE TWO ADDED ELEMENTS ARE INVISIBLE UNTIL A DESIGN ASKS FOR THEM.
 *
 * „Falls etwas anders lief" and the card's secrecy line are rendered on EVERY
 * design and revealed by this one. That is only safe while styles.css hides
 * them: without the default rule they would appear under Klassisch, which this
 * issue does not touch — and the secrecy line would then be said twice, once on
 * the handover and once on the card behind it.
 */
test('the two elements this issue adds are hidden by default and shown by Der Tisch', () => {
  const app = read('public', 'styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const cls of ['.vote__secret', '.tisch__actions-label']) {
    assert.match(app, new RegExp(`\\${cls}\\s*\\{[^}]*display:\\s*none`),
      `${cls} is not hidden by default — it would appear on Klassisch`);
    const body = bodyFor(HOOK + ' ' + cls);
    assert.ok(body && /display:\s*(?:flex|block)/.test(body),
      `${cls} is never revealed, so Der Tisch renders it and hides it`);
  }
});
