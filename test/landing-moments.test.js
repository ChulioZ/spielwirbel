'use strict';

/*
 * The landing hero's stage (#1091) — the app's own pot, vote and Tafel played
 * once from the shipped components. RUN through the jsdom harness rather than
 * regex-matched (.claude/rules/testing-views-under-jsdom.md), and never
 * `require`d: pulling a view file into the coverage report is an ~11-point drop
 * and a red `coverage:ci` with every test green.
 *
 * Named `landing-moments` after the module, which is free — `landing-copy`,
 * `landing-shots` and `landing-view` are the siblings, and a spec that
 * overwrites one is silent in both directions
 * (.claude/rules/test-file-names-collide-silently.md).
 *
 * ## Why this file brings its own clock
 *
 * The timeline is a `setTimeout` chain, and `t.mock.timers` patches the TEST
 * realm's globals while the module runs inside the `vm` context, where a bare
 * `setTimeout` is `window.setTimeout` — the same problem
 * test/session-pot.test.js solves with a recorder. A recorder is not enough here: what has to be pinned
 * is WHEN each state lands, so the stub below is a real fake clock that fires
 * each callback at its own due time.
 *
 * Every boundary is asserted as a PAIR — absent one millisecond before, present
 * one millisecond after. A single `tick(10000)` then `assert(present)` passes
 * against any schedule at all, which is exactly the vacuous shape
 * .claude/rules/mock-timers-jump-the-clock-before-firing.md describes. And no
 * assertion reads a timestamp from inside a callback, for the same reason.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./support/dom');

const ROOT = path.join(__dirname, '..');

/* Replace the context's window timers with a clock the spec drives. Returns the
   handle; `pending` is what proves a cancel actually cancelled. */
function fakeClock(dom) {
  const realSet = dom.window.setTimeout;
  const realClear = dom.window.clearTimeout;
  const armed = new Map();
  let now = 0;
  let seq = 0;
  dom.window.setTimeout = (fn, ms) => {
    const id = ++seq;
    armed.set(id, { at: now + (ms || 0), fn });
    return id;
  };
  dom.window.clearTimeout = (id) => { armed.delete(id); };
  return {
    get pending() { return armed.size; },
    /** Advance by `ms`, running everything that falls due, in due order. */
    tick(ms) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const [id, item] of armed) {
          if (item.at <= target && (next === null || item.at < armed.get(next).at)) next = id;
        }
        if (next === null) break;
        const item = armed.get(next);
        armed.delete(next);
        now = item.at;
        item.fn();
      }
      now = target;
    },
    restore() { dom.window.setTimeout = realSet; dom.window.clearTimeout = realClear; },
  };
}

/* Boot the shell and mount a stage into the document. `isConnected` is a real
   guard in the chain, so a detached stage would stop after the first step — an
   appended one is the normal case, and the detached one has its own test. */
function mount(t, { reduced = false } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('matchMedia', (q) => ({ matches: reduced && /prefers-reduced-motion/.test(q), media: q }));
  const clock = fakeClock(dom);
  t.after(() => { dom.run('stopLandingMoments()'); clock.restore(); });
  const stage = dom.call('renderLandingMoments');
  dom.app.appendChild(stage);
  return { dom, clock, stage };
}

/* ------------------------------- the scenes ------------------------------- */

test('the three scenes are the app’s own markup, not a look-alike', (t) => {
  const { stage } = mount(t);

  // One of each, and the classes are the ones the real views render — a stage
  // built from private classes would drift the moment a component is restyled,
  // which is the whole point of .claude/rules/landing-character-is-shipped-
  // moments.md.
  assert.equal(stage.querySelectorAll('.lm-scene').length, 3);
  const pot = stage.querySelector('.lm-scene--pot');
  const vote = stage.querySelector('.lm-scene--vote');
  const result = stage.querySelector('.lm-scene--result');

  assert.ok(pot.querySelector('.setup-panel .setup-panel__body'), 'the pot is the real panel');
  assert.equal(pot.querySelectorAll('.pool-tile').length, 6, 'the whole pot is rendered');
  assert.ok(pot.querySelector('.setup-bar .btn.btn--primary'), 'the draw button is the real CTA');

  assert.ok(vote.querySelector('.vote .vote__img'), 'the vote card is the real card');
  assert.equal(vote.querySelectorAll('.rating .mood').length, 5, 'the five-face scale');

  assert.ok(result.querySelector('.tafel .tafel-top .tafel-top__kicker'), 'the gold group');
  assert.equal(result.querySelectorAll('.trow').length, 3, 'three ranked rows');
  assert.ok(result.querySelector('.tisch-slot .tisch .stamp.stamp--table'), 'the table band and its stamp');
});

test('every cover is a placeholder gradient — no sample game carries an image', (t) => {
  const { stage } = mount(t);

  // Rule 2 of the module: a provider's cover art on the most public page we
  // have would be re-hosting someone else's artwork
  // (.claude/rules/provider-cover-hotlinking.md). Asserted from both ends —
  // every frame HAS a placeholder, and nothing anywhere carries a background
  // image — because either alone can be satisfied by a half-measure.
  const frames = [...stage.querySelectorAll('.pool-tile__img, .vote__img, .trow__img, .tisch__box')];
  assert.ok(frames.length >= 11, 'every cover frame on the stage is in view');
  for (const frame of frames) {
    assert.ok(frame.querySelector('.cover-ph'), `${frame.className} renders no placeholder gradient`);
  }
  assert.equal(stage.innerHTML.includes('background-image'), false,
    'a cover url reached the stage');
});

test('the ranked rows carry the app’s own fill arithmetic', (t) => {
  const { dom, stage } = mount(t);
  const rows = [...stage.querySelectorAll('.trow')];

  // --pct is the score over the scale's top, so the row IS its own bar; --dur is
  // 0.5s + score x 0.32s, which is what makes every fill start together and the
  // winner's complete last. Restating the numbers here is deliberate: they are
  // the app's formula, and a stage that quietly used its own would look right
  // and mean nothing.
  assert.equal(rows[0].style.getPropertyValue('--pct'), '94%');
  assert.equal(rows[1].style.getPropertyValue('--pct'), '72%');
  assert.equal(rows[2].style.getPropertyValue('--pct'), '48%');
  assert.equal(rows[0].style.getPropertyValue('--dur'), '2.00s');
  assert.equal(rows[2].style.getPropertyValue('--dur'), '1.27s');

  // The accent is the app's own ramp, not a lookalike: avgColor(shown) is
  // byte-for-byte what the row computes as scoreColor(r.score), since
  // scoreColor is avgColor(displayScore(...)) and these scores ARE the displayed
  // ones. A stage with its own ramp would look right and mean nothing.
  const sc = rows[0].style.getPropertyValue('--sc');
  assert.equal(sc, dom.run('avgColor(4.7)'));
  // …and the big number makes that same statement about that same score, now by
  // READING the row's --sc rather than by restating it inline (#1191): an
  // inline `color` is the one thing a design cannot repaint, and this stage is
  // the face design's own shop window. So what is pinned is that the numeral
  // adds no colour of its own — the value it will take is the `--sc` asserted
  // one line above, and `.score-big` reads it in styles.css. jsdom applies no
  // stylesheet, so the resolved colour is not observable here; the CSS half is
  // covered by test/tisch-session.test.js.
  assert.equal(rows[0].querySelector('.score-big').style.color, '',
    'an inline colour here would make this the one score no design can repaint');

  // Ranked 1-2-3 with the rank-colour hook, so a reader sees places rather than
  // three anonymous rows.
  assert.deepEqual(rows.map((r) => r.querySelector('.trow__rank').textContent.trim()), ['1', '2', '3']);
  assert.ok(rows[0].querySelector('.trow__rank--1'));
});

test('nothing on the stage is focusable or clickable except the replay button', (t) => {
  const { stage } = mount(t);

  // The stage is a picture. A dead button inside it that still takes a tab stop
  // is a keyboard trap's less dramatic cousin: focus lands somewhere that does
  // nothing and says nothing.
  const buttons = [...stage.querySelectorAll('button')].filter((b) => !b.classList.contains('landing-moments__replay'));
  // Seven since #1168 took „Weiter" off the vote card — the scene mirrors the
  // real card, so the floor moves with it rather than the scene keeping a
  // button the app no longer has.
  assert.ok(buttons.length >= 7, 'the scenes really do contain the app’s buttons');
  for (const b of buttons) {
    assert.equal(b.disabled, true, `${b.className} is live on the stage`);
    assert.equal(b.getAttribute('tabindex'), '-1', `${b.className} is still a tab stop`);
  }
  assert.equal(stage.querySelectorAll('a').length, 0,
    'the app’s <a> covers and titles must be inert spans here — there is no game page to open');

  // The scenes are decoration; the stage names itself once, for the one control
  // a reader can actually reach. The role is load-bearing rather than tidy: an
  // aria-label on a bare <div> has no role to name and is dropped outright, so
  // the replay button would be announced with no context at all.
  assert.equal(stage.getAttribute('role'), 'group');
  assert.ok(stage.getAttribute('aria-label'));
  assert.equal(stage.querySelector('.landing-moments__stage').getAttribute('aria-hidden'), 'true');

  // …and nothing focusable may live inside that hidden subtree, which is the
  // pairing that makes the whole arrangement legal.
  const hidden = stage.querySelector('[aria-hidden="true"]');
  for (const el of hidden.querySelectorAll('button, a, input, [tabindex]')) {
    const tabbable = el.getAttribute('tabindex') !== '-1' && !el.disabled;
    assert.equal(tabbable, false, `${el.className} is focusable inside an aria-hidden subtree`);
  }
});

/* ------------------------------ the timeline ------------------------------ */

test('each beat lands on its own boundary, and not before', (t) => {
  const { stage, clock } = mount(t);
  const draw = stage.querySelector('.lm-draw');
  const mood = stage.querySelectorAll('.mood')[3];
  const rows = [...stage.querySelectorAll('.trow')];
  const top = stage.querySelector('.tafel-top');
  const slot = stage.querySelector('.tisch-slot');
  const tisch = stage.querySelector('.tisch');

  // Scene 1 is on from the first frame: the hero must never render blank while
  // a timer decides what to show.
  assert.equal(stage.dataset.scene, '1');

  // A cursor, so each boundary is checked relative to the clock's own position
  // and the pairs cannot drift as beats are retuned.
  let cursor = 0;
  const upTo = (ms) => { clock.tick(ms - cursor); cursor = ms; };
  const pair = (ms, label, read) => {
    upTo(ms - 1);
    assert.equal(read(), false, `${label} landed before ${ms}ms`);
    upTo(ms);
    assert.equal(read(), true, `${label} had not landed at ${ms}ms`);
  };

  pair(1300, 'the draw button’s press', () => draw.classList.contains('is-press'));
  pair(1600, 'the release', () => !draw.classList.contains('is-press'));
  pair(1900, 'the cut to the vote card', () => stage.dataset.scene === '2');
  pair(3000, 'Lea’s rating', () => mood.classList.contains('is-selected'));
  pair(4200, 'the cut to the result', () => stage.dataset.scene === '3');
  pair(4500, 'the race', () => rows.every((r) => r.classList.contains('is-race')));
  assert.ok(top.classList.contains('is-reveal'), 'the gold group reveals with the race, not after it');
  pair(8200, 'the winner’s lift', () => rows[0].classList.contains('is-lift'));
  pair(8300, 'the table band', () => slot.hasAttribute('data-unroll'));

  assert.equal(tisch.hidden, false, 'the band is revealed as it unrolls');
  assert.equal(clock.pending, 0, 'the stage rests with no timer still armed');
});

test('the gold has landed before the winner is lifted', (t) => {
  const { dom } = mount(t);
  // The one number the chain restates from the stylesheet: `tafel-gold` runs for
  // 3.6s from `is-reveal`, and the lift must read as someone picking up a game
  // that has already been crowned. Asserted against the constants rather than
  // against the beats above, so a retune of either one fails HERE, naming the
  // relationship, instead of merely re-ordering the picture.
  const race = dom.get('LM_RACE');
  const lift = dom.get('LM_LIFT');
  assert.ok(lift >= race + 3600, `the lift at ${lift}ms interrupts the 3.6s gold that starts at ${race}ms`);
});

test('the selected face carries its colour as --sc, which is what a design can repaint', (t) => {
  const { dom, stage, clock } = mount(t);
  clock.tick(3000);
  const mood = stage.querySelectorAll('.mood')[3];

  /* As a custom PROPERTY, not as an inline `background` (#1191). The inline
     form was the point until a design needed to repaint the chosen face — Der
     Tisch draws it as its brass plate — and an inline background is precisely
     what no stylesheet can beat. `.mood.is-selected` in styles.css reads `--sc`,
     so the rendered colour is unchanged while the rule is now overridable.

     Compared as WRITTEN, never canonicalised: a custom property is not a colour
     to the CSSOM, so jsdom stores the string exactly as the view spelled it —
     which is also why nothing in this file normalises colours any more, now
     that every score travels as a property rather than as an inline fill. */
  assert.equal(mood.style.getPropertyValue('--sc'), dom.run('avgColor(4)'));
  assert.equal(mood.style.background, '', 'an inline background would beat every rule a design could write');
});

/* --------------------------- reduced motion ------------------------------ */

test('under reduced motion nothing is armed and the finished picture is up', (t) => {
  const { stage, clock } = mount(t, { reduced: true });

  assert.equal(clock.pending, 0, 'a timer was armed for a reader who asked for no motion');
  assert.equal(stage.dataset.scene, '3', 'the stage does not rest on the finished scene');
  assert.equal(stage.querySelector('.tisch').hidden, false, 'the table band is still hidden');
  assert.ok(stage.querySelectorAll('.mood')[3].classList.contains('is-selected'),
    'the vote card shows no rating at rest');

  // …and NONE of the app's animation hooks, which is the half that is easy to
  // get wrong: every one of those keyframes is declared inside a
  // `prefers-reduced-motion: no-preference` block, so setting the hooks here
  // would be a silent no-op in the browser and a lie in the DOM.
  assert.equal(stage.querySelectorAll('.is-race, .is-reveal, .is-lift').length, 0);
  assert.equal(stage.querySelector('.tisch-slot').hasAttribute('data-unroll'), false);
});

/* ------------------------------ cancellation ----------------------------- */

test('a stage that leaves the document stops its chain', (t) => {
  const { stage, clock } = mount(t);
  clock.tick(1000);
  stage.remove();
  clock.tick(10000);

  assert.equal(clock.pending, 0, 'the detached stage kept its timers armed');
  assert.equal(stage.dataset.scene, '1', 'a detached stage went on playing');
});

test('„Nochmal ansehen" replaces the stage and leaves nothing of the old one running', (t) => {
  const { dom, stage, clock } = mount(t);
  clock.tick(5000);
  assert.equal(stage.dataset.scene, '3');
  assert.ok(clock.pending > 0, 'the first play must still have beats left, or this proves nothing');

  stage.querySelector('.landing-moments__replay').click();
  const fresh = dom.app.querySelector('.landing-moments');

  assert.notEqual(fresh, stage, 'the replay must mount a new stage, not rewind the old one');
  assert.equal(stage.isConnected, false, 'the old stage is still in the document');
  assert.equal(fresh.dataset.scene, '1', 'the replay does not start from the beginning');
  // The first play's remaining beats must be gone, not merely inert: they close
  // over the OLD stage, and a lift landing on it four seconds later is exactly
  // what a per-stage handle would have missed (a language switch does the same).
  clock.tick(10000);
  assert.equal(stage.querySelectorAll('.is-lift').length, 0, 'the old chain was still running');
  assert.equal(fresh.dataset.scene, '3', 'the new chain never played');
});

test('re-rendering the landing (a language switch) cancels the running play', (t) => {
  const { dom, stage, clock } = mount(t);
  // Short of the first scene change (1900ms), so `scene === '1'` below reads as
  // "this stage stopped" rather than "this stage had not started".
  clock.tick(1000);

  // currentView re-runs showLanding on a language switch, which builds a whole
  // new stage while this one's chain is still armed. The timers are held at
  // MODULE level for exactly this case.
  const second = dom.call('renderLandingMoments');
  dom.app.replaceChildren(second);
  clock.tick(10000);

  assert.equal(stage.dataset.scene, '1', 'the abandoned stage played on');
  assert.equal(second.dataset.scene, '3');
});

/* ------------------------- the breakpoint coupling ------------------------ */

/* The one assertion here that reads the STYLESHEET rather than the DOM, because
 * jsdom applies no external CSS and the claim is a relationship between two
 * media queries that must agree.
 *
 * It exists because they did not. The stage trims the Tafel to two rows because
 * the app's row is a two-line grid until `min-width: 1280px`, where it re-lays
 * as one line — but the trim shipped at `max-width: 719px`, so every width from
 * 720 to 1279 got three TALL rows: 650px of scene in a 560px box at 848px,
 * 50px of it painted over the caption underneath. Both spot checks (390 and
 * 1280) sat on opposite sides of the gap and both passed.
 *
 * So the number is derived from the Tafel's own block, never restated. */
test('the stage trims its rows exactly where the app’s row stops being one line', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8')
    // Or a selector regex matches inside prose that merely mentions the class —
    // and this file's own CSS comment names both of these
    // (.claude/rules/css-text-assertions-strip-comments.md).
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const oneLine = css.match(/@media \(min-width: (\d+)px\)\s*\{[^}]*\.tafel \.trow\b/);
  assert.ok(oneLine, 'styles.css re-lays .tafel .trow as one line in a min-width block');

  const trim = css.match(/@media \(max-width: (\d+)px\)\s*\{\s*\.landing-moments \.tafel > \.trow:last-child/);
  assert.ok(trim, 'the stage trims its last row in a max-width block');

  assert.equal(
    Number(trim[1]),
    Number(oneLine[1]) - 1,
    `the stage trims below ${trim[1]}px while the Tafel's row stays two lines below ${oneLine[1]}px — `
    + 'every width in between gets three tall rows and the scene overruns its box',
  );
});

test('the stage box is a fixed height, never an aspect-ratio', () => {
  /* A ratio ties the box's height to its column's WIDTH, and the box's content
   * is text — which gets taller as the column narrows. The two move in opposite
   * directions, and measured (WebKit, with `aspect-ratio: 4/7` and `13/14` in
   * place) the ratio lost in two bands: at 360px the box came out 581 against a
   * 594px result scene, and from 1024px — where the hero becomes two columns and
   * the visual column drops to ~448px — the box fell to 483 while the vote card
   * stayed 547, i.e. every laptop width overran by ~60px onto the caption below.
   *
   * Pinned because "express the box as a ratio" is the tidier-looking form and
   * will be proposed again; the numbers and the reasoning are in the stylesheet. */
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...css.matchAll(/\.landing-moments__stage\s*\{([^}]*)\}/g)].map((m) => m[1]);
  // NOT `every`: a block may legitimately touch the box without sizing it (the
  // narrow-band `overflow-x: clip`). The claim is that no block sizes it by a
  // ratio, and that at least two DO size it in px — the base and its breakpoint.
  assert.ok(blocks.length >= 2, 'the stage box is declared, and re-sized in at least one breakpoint');
  for (const body of blocks) {
    assert.doesNotMatch(body, /aspect-ratio/,
      'the stage box must not be sized by a ratio — it shrinks exactly where its text grows');
  }
  assert.ok(blocks.filter((b) => /height:\s*\d+px/.test(b)).length >= 2,
    'the stage box must state an explicit pixel height in its base rule and in its breakpoint');
});

/* ------------------------------ the mount -------------------------------- */

test('the hero mounts the stage where the screenshot used to be', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => { dom.run('stopLandingMoments()'); dom.close(); });
  dom.set('fetch', async (url) => {
    if (String(url).startsWith('/api/config')) return { ok: true, json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  await dom.call('showLanding');

  const visual = dom.document.querySelector('.landing-hero__visual');
  assert.ok(visual, 'the hero still has its visual slot');
  assert.ok(visual.querySelector('.landing-moments'), 'the hero renders the stage');
  assert.equal(visual.querySelector('img'), null, 'the hero still carries a screenshot');

  // …and the shots did not simply disappear from the page: all three are the
  // walkthrough's, which is the other half of the #1091 swap.
  assert.equal(dom.document.querySelectorAll('.landing-walk .landing-shot').length, 3);
});
