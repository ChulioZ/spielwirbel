'use strict';

/* The game detail screen's finishing pass (#1041): the score pill and each
 * session stamp press in once when the page opens, and the cover stands as a
 * box with a hard depth edge that grows on hover.
 *
 * Slice C2 of the 2026-09-12 Spielepass deep-dive. The first proposal carried
 * its playfulness in a TILT on the stamps and the cover; the operator rejected
 * that outright, so what the angle was saying — these were pressed by hand, one
 * evening at a time — is said once in motion and then the page holds still.
 * That makes "no rotation" an acceptance criterion rather than an aesthetic
 * preference, and it has no symptom in the DOM: `session-stamps.test.js` guards
 * the stamp half, this file guards the cover and the pill.
 *
 * Everything here is a CSS-TEXT assertion except the stagger, because the pane
 * omits an animating layer from screenshots and only advances an animation
 * clock when it paints (`.claude/rules/preview-pane-paint-artifacts.md`), and
 * jsdom applies no external stylesheet at all. The parsing traps are in
 * `test/support/css.js` (`.claude/rules/css-text-assertions-strip-comments.md`).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { CSS, RULES, rulesOf, bodyOf, mediaBlocks } = require('./support/css');

const RID = 'r1';

/* An at-rule's body is not a rule body — `rulesOf()` is built out of `[^{}]*`,
 * so it sees a keyframe's STOPS (`from`, `60%`, `to`) and never the block that
 * holds them. Brace-match instead of reaching for a `[\s\S]*?` regex, which
 * would end at the first stop's closing brace. */
function atRule(name, css = CSS) {
  const at = css.indexOf(name);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  let depth = 1;
  let i = open + 1;
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
  }
  return css.slice(open + 1, i - 1);
}

const isMotionGate = ([q]) => /prefers-reduced-motion:\s*no-preference/.test(q);

// The one top-level block that carries this screen's entry animations.
const motionBlock = () => mediaBlocks()
  .filter(isMotionGate)
  .map(([, css]) => css)
  .find((css) => /@keyframes\s+press-in\b/.test(css));

/* Every rule NOT behind a reduced-motion gate. `rulesOf()` deliberately sees
 * through @media (its query is brace-free, so it never matches as a selector),
 * which is exactly wrong for asking "is this declared outside the gate?" —
 * without the excision the gated rules answer for themselves and the assertion
 * is green against a stylesheet with no gate at all. */
function ungatedRules() {
  let css = CSS;
  for (const block of mediaBlocks().filter(isMotionGate)) css = css.replace(block[1], '');
  return rulesOf(css);
}

test('the press-in keyframe overshoots and settles, and it is declared once', () => {
  const hits = [...CSS.matchAll(/@keyframes\s+press-in\b/g)];
  assert.equal(hits.length, 1, `press-in declared ${hits.length} times, expected 1`);
  const stops = rulesOf(atRule('@keyframes press-in'));
  const at = (k) => (stops.find(([sel]) => sel === k) || [])[1];
  // It reads as a stamp being pressed down, so it arrives LARGER and lands
  // through a compression — a plain fade-up would be the app's existing
  // `spotlight-rise` and would say nothing about pressing.
  assert.match(at('from'), /scale\(1\.25\)/, 'it starts oversized');
  assert.match(at('from'), /opacity:\s*0/, 'and invisible');
  assert.match(at('60%'), /scale\(0?\.97\)/, 'it compresses past its resting size');
  assert.match(at('to'), /scale\(1\)/, 'and settles there');
});

/* The animation must be DECLARED inside the no-preference block rather than
 * cancelled by a `reduce` one — the repo's convention everywhere else
 * (`seal-pulse`, `spotlight-rise`, `confetti-fall`), and the safe direction: a
 * media query that never matches leaves the element at its resting state, where
 * a missed `animation: none` override would leave it at `opacity: 0` forever,
 * i.e. an invisible pill and an empty Stempelkarte for exactly the users who
 * asked for less motion. */
test('both entry animations live only under prefers-reduced-motion: no-preference', () => {
  const block = motionBlock();
  assert.ok(block, 'no no-preference block declares press-in');
  const inBlock = rulesOf(block);
  assert.match(bodyOf('.score-pill--lg', inBlock), /animation:\s*press-in/, 'the cover pill presses in');
  assert.match(bodyOf('.stamp', inBlock), /animation:\s*press-in/, 'and so does each stamp');
  // Nothing outside the gate may animate these two, or the gate is decorative.
  const ungated = ungatedRules()
    .filter(([sel, body]) => /\.(score-pill--lg|stamp)\b/.test(sel) && /animation[-a-z]*\s*:/.test(body))
    .map(([sel]) => sel);
  assert.deepEqual(ungated, [], 'an entry animation declared outside the gate ignores the preference');
});

test('the stamps stagger off an index the renderer supplies', () => {
  const body = bodyOf('.stamp', rulesOf(motionBlock()));
  assert.match(body, /animation-delay:\s*calc\(var\(--i[^)]*\)\s*\*\s*\d+ms\s*\+\s*\d+ms\)/,
    'the delay is a function of the stamp index');
});

/* The acceptance criterion is "nothing on the page animates after ~1 s", and it
 * is a property of the CSS and the RENDERER together: 15 stamps ship (the view
 * slices there), so an uncapped 70ms step would still be pressing at 1.55s —
 * long after the reader has started reading. Derived from the three numbers
 * rather than restated, so retuning any of them re-checks the budget. */
test('the whole entry sequence is over inside 1.1 s, however many stamps there are', async (t_) => {
  const body = bodyOf('.stamp', rulesOf(motionBlock()));
  const [, step, offset] = /calc\(var\(--i[^)]*\)\s*\*\s*(\d+)ms\s*\+\s*(\d+)ms\)/.exec(body).map(Number);
  const dur = Number(/animation:\s*press-in\s+([\d.]+)s/.exec(body)[1]) * 1000;

  const dom = loadApp();
  t_.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    return {};
  });
  dom.set('toast', () => {});
  const round = {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    providers: [],
    members: [{ id: 'm1', name: 'Anna' }],
    games: [{ id: 'g1', title: 'Catan', image: '/uploads/catan.jpg', tagIds: [] }],
    // More sessions than the view renders, so the cap is exercised rather than
    // the slice hiding it.
    sessions: Array.from({ length: 20 }, (_, n) => ({
      id: `s${n}`,
      createdAt: `2026-06-${String(n + 1).padStart(2, '0')}T19:00:00.000Z`,
      finished: true,
      gameIds: ['g1'],
      chosenGameId: 'g1',
      winnerIds: ['m1'],
      votes: { m1: { g1: { rating: 4 } } },
    })),
  };
  await dom.call('showGameDetail', RID, 'g1');

  const idx = [...dom.app.querySelectorAll('.stamps .stamp')]
    .map((el) => Number(el.style.getPropertyValue('--i')));
  assert.ok(idx.length > 10, `expected the view to render its full slice, got ${idx.length}`);
  assert.deepEqual(idx.slice(0, 4), [0, 1, 2, 3], 'the newest stamp lands first');
  assert.ok(idx.every((n) => Number.isInteger(n)), 'every stamp carries an index');
  const last = Math.max(...idx) * step + offset + dur;
  assert.ok(last <= 1100, `the last stamp settles at ${last}ms, past the 1.1s budget`);
});

/* The cover's depth edge. Two separate things are pinned: that it exists at all
 * above the stack breakpoint, and that its colour is DERIVED. A hard shadow is
 * the natural place to write a literal warm grey (the issue proposed one), and
 * on the seven dark designs a 16%-black edge against a dark surface is simply
 * invisible — the rule reads as working and paints nothing anyone can see
 * (`.claude/rules/theme-derived-colors.md`). */
test('the cover stands on a theme-derived hard edge, and lifts on hover', () => {
  const wide = mediaBlocks().filter(([q]) => /min-width:\s*701px/.test(q)).map(([, css]) => css);
  assert.equal(wide.length, 1, 'one block owns the box treatment');
  const rules = rulesOf(wide[0]);
  const img = bodyOf('.gd-img', rules);
  assert.ok(img, 'the cover takes no depth edge above the stack breakpoint');
  assert.match(img, /box-shadow:[^;]*\b0\s+var\(--gd-edge-ink\)/, 'the edge is a hard, unblurred layer');
  assert.match(img, /--gd-edge-ink:\s*color-mix\([^;]*var\(--shade\)/,
    'a literal grey is invisible on the seven dark designs');

  const hover = bodyOf('.gd-cover:hover :is(.gd-img, .gd-score)', rules);
  assert.ok(hover, 'the pill must travel with the cover it is pinned to, or it drifts off the corner');
  assert.match(hover, /transform:\s*translate\(/, 'the box lifts');
  assert.match(img, /transition:[^;]*transform/, 'and it is a transition, not a jump');
});

/* Below the stack breakpoint the cover is the full column width with nothing to
 * stand off, so the edge would read as a stray line down the page rather than as
 * a box. 701, not 700: it has to tile with the `max-width: 700px` block that
 * stacks the card, or at exactly 700px both apply. */
test('none of the box treatment reaches the stacked layout', () => {
  const box = RULES.filter(([sel, body]) =>
    /\.gd-(img|cover|score)\b/.test(sel) && /--gd-edge-ink|transform:\s*translate/.test(body));
  assert.ok(box.length >= 3, `expected the edge, the hover lift and the hover edge, got ${box.length}`);
  for (const [sel] of box) {
    const owner = mediaBlocks().find(([, css]) => rulesOf(css).some(([s]) => s === sel));
    assert.ok(owner && /min-width:\s*701px/.test(owner[0]),
      `${sel} is not gated to the unstacked layout`);
  }
});

/* The operator rejected tilt outright (2026-09-12). `session-stamps.test.js`
 * guards the stamps; the cover and its pill are the other two things the
 * rejected proposal rotated, and a rotation on either has no DOM symptom. */
test('nothing on the cover or its pill rotates', () => {
  const rotated = RULES
    .filter(([sel, body]) => /\.(gd-img|gd-cover|gd-score|score-pill--lg)\b/.test(sel) && /\brotate[\s(]/.test(body))
    .map(([sel]) => sel);
  assert.deepEqual(rotated, [], 'tilt was rejected for this screen');
});
