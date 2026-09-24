'use strict';

/* Der Tisch's Tier-2b screens (#1197, T14.1–T14.5): die Spielerkarte, the
 * Freundeskreis and its feed, the Posteingang, „Was ist neu", the signed-in
 * statistics and the round's Einstellungen with the felt picker.
 *
 * Paint only, so most of it is covered generically: test/tisch-hub-lobby.test.js
 * derives the scheme gate over the whole file and test/design-layer.test.js
 * refuses a colour literal outside the root blocks. What those cannot see are
 * the four claims below, each of which regresses silently:
 *
 *   - a RAISED plate (--control-fill) under a `.link-btn` — brass on that fill
 *     is 4.37:1, i.e. every „Ablehnen" on it drops under AA with nothing red;
 *   - the Spielerkarte's felt head bleeding by a margin hand-copied from
 *     styles.css's padding, which drifts the day that padding is retuned;
 *   - the felt picker painting the DESIGN's felt instead of each swatch's own
 *     marker, which would show eight identical green swatches;
 *   - the statistics rules reaching the logged-out /entdecken, which is the
 *     face and belongs to #1198.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CSS, rulesOf, mediaBlocks, topLevel } = require('./support/css');
const { contrast, evaluate, token } = require('./support/theme');
const { designById } = require('../public/js/designs');

const RAW = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = rulesOf(RAW);
const TISCH = designById('tisch');
const AA = 4.5;

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+)`).exec(body || '');
  return m && norm(m[1]);
};
// Every rule whose selector list has a member ending exactly in `tail`.
const rulesEndingIn = (tail, rules = RULES) => rules.filter(([sel]) =>
  sel.split(',').map(norm).some((s) => s.endsWith(tail)));

/* 1 — A RAISED PLATE TAKES THE BRASS OFF EVERY LINK ON IT.
 *
 * The two hosts are the raised plates that CARRY a `.link-btn` (an incoming
 * friend request's „Ablehnen", an unread inbox row's „Ablehnen" or dismiss
 * glyph) — the others on --control-fill hold no link, which a stylesheet
 * cannot tell, hence a list. Each host must still BE raised, so a stale entry
 * fails instead of passing on nothing, and the premise is asserted too: if
 * brass ever clears AA on the raised fill, the re-ink stops being
 * load-bearing and this test should be re-read rather than trusted.
 */
test('a link on a raised plate is re-inked to clear AA', () => {
  const fill = evaluate('var(--control-fill)', TISCH);
  const brand = token('--brand', TISCH);
  assert.ok(contrast(brand, fill) < AA,
    'brass now clears AA on --control-fill by itself — this guard has lost its premise');

  const HOSTS = ['.k-card--incoming', '.inbox-row.inbox-row--unread'];
  for (const host of HOSTS) {
    const raised = rulesEndingIn(host).some(([, body]) => decl(body, 'background') === 'var(--control-fill)');
    assert.ok(raised, `${host} is no longer raised — drop it from this list`);

    const link = rulesEndingIn(`${host} .link-btn`);
    assert.ok(link.length, `${host} is raised onto --control-fill but its .link-btn keeps the brass`);
    const ink = decl(link[0][1], 'color');
    const ratio = contrast(evaluate(ink, TISCH), fill);
    assert.ok(ratio >= AA, `${host} .link-btn measures ${ratio.toFixed(2)}:1 on the raised fill (floor ${AA})`);
  }
});

/* 2 — THE FELT HEAD BLEEDS BY THE CARD'S OWN PADDING, at both widths.
 *
 * The negative margin is a copy of styles.css's padding on `.profile-card`
 * (shared with `.member-card`). Retune that padding and a hand-copied bleed
 * leaves a walnut sliver beside the felt — or pushes the felt past the card's
 * rounded edge — with nothing going red. So the two are compared here.
 */
test('the Spielerkarte\'s felt head bleeds exactly by the card\'s padding', () => {
  const HEAD = '.profile-card .member-card__id';
  const is520 = ([q]) => /max-width:\s*520px/.test(q);
  // The padding styles.css gives `.profile-card` in a chunk of CSS.
  const padIn = (css) => {
    const hit = rulesOf(css).find(([sel, body]) =>
      sel.split(',').map(norm).includes('.profile-card') && decl(body, 'padding'));
    return hit && decl(hit[1], 'padding');
  };
  const phoneApp = mediaBlocks(CSS).filter(is520).map(([, b]) => b).find((b) => padIn(b));
  const phoneTisch = mediaBlocks(RAW).filter(is520).map(([, b]) => b).join('\n');
  const cases = [
    ['wide', padIn(topLevel(CSS)), rulesEndingIn(HEAD, rulesOf(topLevel(RAW)))],
    ['phone', phoneApp && padIn(phoneApp), rulesEndingIn(HEAD, rulesOf(phoneTisch))],
  ];
  for (const [label, padding, rules] of cases) {
    assert.ok(padding, `no ${label} padding on .profile-card in styles.css`);
    const rule = rules.find(([, body]) => decl(body, 'margin'));
    assert.ok(rule, `no ${label} bleed on the felt head`);
    const [v, hz] = padding.split(' ');
    const [mTop, mSide, , mLeft = mSide] = decl(rule[1], 'margin').split(' ');
    assert.deepEqual([mTop, mSide, mLeft], [`-${v}`, `-${hz}`, `-${hz}`],
      `${label}: the head's bleed does not match the card's padding (${padding})`);
    assert.equal(decl(rule[1], 'padding'), padding, `${label}: the head must restore the padding it bled out of`);
  }
});

/* 3 — EACH SWATCH IS ITS OWN FELT.
 *
 * `--marker`/`--marker-deep` are set INLINE on each swatch (views-round-
 * settings.js), so the felt gradient must read them. Written with the design's
 * default `--felt` instead — the obvious spelling beside every other felt rule
 * in this file — the picker shows eight identical Tannenfilz swatches.
 */
test('the felt picker paints every swatch in its own marker', () => {
  const fill = rulesEndingIn('.marker-card__fill').find(([, body]) => decl(body, 'background-image'));
  assert.ok(fill, 'the Tisch swatch no longer paints a felt');
  const value = decl(fill[1], 'background-image');
  assert.match(value, /var\(--marker\)/, 'the swatch must read the marker it was given');
  assert.match(value, /var\(--marker-deep\)/, 'and its deep stop');
  assert.doesNotMatch(value, /var\(--felt\)|var\(--felt-deep\)/, 'not the design\'s default felt');
});

/* 4 — THE LOGGED-OUT STATISTICS ARE NOT THIS SLICE'S.
 *
 * /entdecken renders for a logged-out visitor on the auth-screen chrome, which
 * is the face (#1198). Every statistics rule here therefore carries both the
 * signed-in scope and the standalone-screen scope; the anti-vacuous floor
 * counts the rules actually checked. Only THIS section is swept — #1198
 * styles the logged-out face in the same file, deliberately without the
 * scope. The section is cut out of the UNSTRIPPED file between its own banner
 * and the next one, not "from here to the end": every later slice appends a
 * section to this file, and #1198's logged-out statistics rules landing after
 * this one would otherwise be swept as if they were this slice's.
 */
test('every statistics rule is scoped to the signed-in standalone screen', () => {
  const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8');
  const from = SOURCE.indexOf('#1197 — the SPIELERKARTE');
  assert.ok(from > 0, 'the #1197 section is gone — this check is vacuous');
  const next = SOURCE.indexOf('/* ====', from);
  const raw = SOURCE.slice(from, next < 0 ? undefined : next);
  // `from` sits inside the banner, so drop the rest of it before stripping.
  const section = raw.slice(raw.indexOf('*/') + 2).replace(/\/\*[\s\S]*?\*\//g, '');
  const stats = rulesOf(section).filter(([sel]) => /\.stats-/.test(sel));
  assert.ok(stats.length >= 5, `only ${stats.length} statistics rules found — this check is vacuous`);
  for (const [sel] of stats) {
    for (const part of sel.split(',').map(norm)) {
      assert.match(part, /body:not\(\.auth-screen\) \.app > \.stats-block /,
        `${part} can reach the logged-out /entdecken (#1198's face)`);
    }
  }
});
