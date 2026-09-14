'use strict';

/* The Tischkarte's character (#1075) — the Siegquote ring, the initials
 * watermark, the Siegwertung bar and the two game boxes.
 *
 * Two halves, the split test/member-hero.test.js established for this card:
 * the DOM half runs the real view (the interesting question is where each
 * number COMES FROM), the CSS half is a text assertion because jsdom applies no
 * external stylesheet.
 *
 * What NEITHER can see is the geometry — whether the watermark overlaps any
 * text — because that depends on layout. It was measured in a browser against
 * the painted INK of every label, figure, chip and ribbon (a Range over the
 * text nodes; the h1 is a full-width block, so its BOX overlaps at any size and
 * says nothing), and both numbers are written into the stylesheet beside the
 * rule they justify. The PR carries the table.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { bodyOf, rulesOf, CSS } = require('./support/css');

const RID = 'r1';
const MID = 'm1';

const roundFixture = (over = {}) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  members: [{ id: MID, name: 'Anna Bauer', color: '#7f77dd' }, { id: 'm2', name: 'Ben' }],
  games: [],
  sessions: [],
  tags: [],
  ...over,
});

async function show(t, round = roundFixture()) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (new RegExp(`^/api/rounds/${RID}$`).test(url)) return round;
    return {};
  });
  await dom.call('showMember', RID, MID);
  return dom;
}

/* A round where m1 played three contested sessions and won two, so winRate is a
   real 2/3 rather than the null a bare fixture produces. */
const contested = () => roundFixture({
  games: [{ id: 'g1', title: 'Catan', tagIds: [] }],
  sessions: [1, 2, 3].map((n) => ({
    id: 's' + n,
    createdAt: `2026-0${n}-01T18:00:00.000Z`,
    gameIds: ['g1'], memberIds: [MID, 'm2'], guests: [],
    votes: {}, votedIds: [], finished: true, cancelled: false, done: true,
    chosenGameId: 'g1', winnerIds: n < 3 ? [MID] : ['m2'], events: [],
  })),
});

/* ------------------------------- the ring --------------------------------- */

test('the ring carries the Siegquote as --pct, from memberStats and nowhere else', async (t) => {
  const dom = await show(t, contested());
  const ring = dom.app.querySelector('.member-ring');
  assert.ok(ring, 'the avatar has no gauge ring');

  const pct = Number(ring.style.getPropertyValue('--pct'));
  const stats = dom.run(`memberStats(${JSON.stringify(contested())}, '${MID}')`);
  assert.equal(pct, Math.round(stats.winRate * 100),
    'the gauge is not the same number the figure strip prints');
  assert.equal(pct, 67, '2 wins in 3 contested sessions');
  assert.ok(!ring.classList.contains('member-ring--none'));
});

test('no contested session shows the plain tone ring, not a 0% gauge', async (t) => {
  /* A 0% gauge says "never wins" about somebody who has never been in a
     contest. `--pct` must be absent, not zero — an inline 0 would paint the
     empty gauge the modifier exists to avoid. */
  const dom = await show(t);
  const ring = dom.app.querySelector('.member-ring');
  assert.ok(ring.classList.contains('member-ring--none'));
  assert.equal(ring.style.getPropertyValue('--pct'), '');
});

test('the avatar button stays inside the ring, and is still the colour control', async (t) => {
  const dom = await show(t, contested());
  const ring = dom.app.querySelector('.member-ring');
  const btn = ring.querySelector('.member-avatar');
  assert.ok(btn, 'the avatar moved out of the ring');
  assert.equal(btn.tagName, 'BUTTON', 'the colour control must stay a real button');
  assert.ok(btn.querySelector('.member-avatar__pen'), 'the pencil badge went missing');
});

/* ----------------------------- the watermark ------------------------------ */

test('the watermark is the member\'s initials, and is hidden from assistive tech', async (t) => {
  const dom = await show(t);
  const mark = dom.app.querySelector('.member-card__mark');
  assert.ok(mark, 'the card carries no watermark');
  assert.equal(mark.textContent, dom.run("initials('Anna Bauer')"),
    'the watermark is not initials() of the member name');
  assert.equal(mark.getAttribute('aria-hidden'), 'true',
    'the watermark would be read out — it is the <h1> again, at furniture scale');
});

/* --------------------------------- the bar -------------------------------- */

test('the Siegwertung bar follows the sign and the magnitude', async (t) => {
  const dom = await show(t, contested());
  const bar = dom.app.querySelector('.member-bar');
  assert.ok(bar, 'the Siegwertung figure carries no bar');
  assert.equal(bar.getAttribute('aria-hidden'), 'true', 'the number beside it is the statement');

  const w = (el) => Number(/--w:\s*([\d.]+)%/.exec(el.getAttribute('style'))[1]);
  assert.ok(w(bar) >= 0 && w(bar) <= 50, `--w ${w(bar)} is outside the half it may fill`);
});

test('the bar is clamped to the half, and a negative score leans the other way', async (t) => {
  /* ±2.0 fills the half. A runaway score must not paint past the track, and the
     direction is a class rather than a negative width. */
  const dom = await show(t, contested());
  const mk = (score) => {
    const w = Math.min(50, Math.abs(score) * 25);
    return { w, neg: score < 0 };
  };
  assert.equal(mk(2).w, 50, '±2.0 fills the half exactly');
  assert.equal(mk(9).w, 50, 'a runaway score is clamped');
  assert.equal(mk(1.4).w, 35);
  assert.equal(mk(-1.4).neg, true);
  assert.ok(dom.app.querySelector('.member-bar'));
});

test('a score of exactly 0 shows the TRACK, not a missing bar', async (t) => {
  /* `memberStats` returns 0 rather than undefined for a member with no
     sessions — my first version of this test assumed undefined and was wrong,
     not the code. 0 is a real statement („even"), and the acceptance criterion
     asks for the track with the centre mark and no fill. A bar that vanished at
     0 would read as "no data" for a member who has plenty. */
  const dom = await show(t);
  const st = dom.run(`memberStats(${JSON.stringify(roundFixture())}, '${MID}')`);
  assert.equal(st.winScore, 0, 'the fixture no longer produces a zero score');
  const bar = dom.app.querySelector('.member-bar');
  assert.ok(bar, 'a zero score dropped the track entirely');
  assert.match(bar.getAttribute('style'), /--w:\s*0\.0%/, 'the fill must be empty, not absent');
  assert.ok(!bar.classList.contains('member-bar--neg'), '0 leans neither way');
});

/* ------------------------------- the boxes -------------------------------- */

test('a populated game tile wears its ribbon; an empty one does not', async (t) => {
  /* A ribbon over „noch kein Lieblingsspiel" labels an absence as an award. */
  const full = await show(t, contested());
  /* The `contested()` fixture has WINS but no votes, so „Stärkstes" is
     populated and „Liebling" is not — which makes one render exactly the
     positive and the negative case side by side. */
  const best = full.app.querySelector('.member-stats__best');
  const fav = full.app.querySelector('.member-stats__fav');
  assert.equal(best.querySelector('.member-ribbon').textContent, 'Stärkstes');
  assert.equal(fav.querySelector('.member-ribbon'), null,
    'the empty „Liebling" tile wears a ribbon — that labels an absence as an award');

  const empty = await show(t);
  assert.equal(empty.app.querySelector('.member-ribbon'), null,
    'a member with nothing at all must carry no ribbon');
});

/* --------------------------------- the CSS -------------------------------- */

test('the ring is a conic gauge in the member\'s tone, with @property behind it', () => {
  const body = bodyOf('.member-ring');
  assert.ok(body, '.member-ring is gone');
  assert.match(body, /conic-gradient\(\s*var\(--m-tone\)\s*calc\(var\(--pct\)/,
    'the gauge does not read --pct, so the ring cannot be the Siegquote');
  // No tinted glow: elevation comes from the ramp (test/design-tokens.test.js).
  assert.doesNotMatch(body, /box-shadow/, 'the ring grew a shadow — the gauge is the treatment');
});

test('the gauge does NOT animate — it renders at its value', () => {
  /* The ring originally swept from 0 over 800ms. The operator dropped that
     during #1075's merge review (2026-09-14), together with #1095's accept
     whirl, so the gauge simply appears filled.

     Asserted rather than merely deleted, because re-adding motion here is a
     decision with a trap attached: the `from` keyframe would be `--pct: 0`, so
     it must be GATED on `prefers-reduced-motion: no-preference` and never
     cancelled by a `reduce` override — a missed override parks the gauge at
     EMPTY, which is a wrong statistic rather than a still picture. It would also
     need the `@property --pct` registration back, since an unregistered custom
     property does not interpolate. */
  assert.equal(rulesOf(CSS).filter(([sel]) => /\.member-ring/.test(sel))
    .filter(([, body]) => /animation/.test(body)).length, 0,
  'the ring animates again — see the comment above before keeping it');
  assert.doesNotMatch(CSS, /@keyframes\s+member-sweep/, 'the sweep keyframe is back');
  assert.doesNotMatch(CSS, /@property\s+--pct/,
    '--pct is registered again, which is only needed to animate it');
});

test('the game boxes use a HARD edge, not a tinted glow', () => {
  const body = bodyOf('.member-card__games .pokale-card');
  assert.ok(body, 'the game tiles lost their box treatment');
  const shadow = /box-shadow:\s*([^;]+);/.exec(body)[1];
  assert.match(shadow, /^\d+px \d+px 0 0 color-mix\(in oklab/,
    `the edge is not a zero-blur colour-mix: ${shadow}`);
  // No rotation anywhere: the operator rejected the tilt on the Spielepass stamps.
  for (const sel of ['.member-card__games .pokale-card', '.member-card__games .pokale-card:hover',
    '.member-ribbon', '.member-card__mark', '.member-ring']) {
    const b = bodyOf(sel);
    if (b) assert.doesNotMatch(b, /rotate\(/, `${sel} rotates — character comes from ink, not angles`);
  }
});
