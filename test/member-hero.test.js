'use strict';

/* The member page's hero band (#995).
 *
 * The page used to open on a 44px avatar and a modest name — about 50px of head
 * that read as a breadcrumb, on the one screen in the round hub with nothing
 * leading it. Each member already OWNS a colour and the page spent almost none
 * of it.
 *
 * Two halves, with the two tools they need:
 *
 *   - the DOM half runs the real view through the jsdom harness, because the
 *     interesting assertion is about where the tone COMES FROM: it must be the
 *     same `memberColor` value the avatar is painted with, never a hex written
 *     into the stylesheet (the acceptance criterion, and
 *     .claude/rules/shared-constants-across-the-stack.md);
 *   - the CSS half is a text assertion, because jsdom applies no external
 *     stylesheet (.claude/rules/testing-views-under-jsdom.md). Comments are
 *     stripped by test/support/css.js
 *     (.claude/rules/css-text-assertions-strip-comments.md).
 *
 * What NEITHER can see is the rendered band — its contrast, and whether it
 * fights a world's own backdrop. Those are browser measurements and they are
 * written down in the PR rather than left as "verified".
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { bodyOf } = require('./support/css');

const RID = 'r1';
const MID = 'm1';

const roundFixture = () => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  members: [{ id: MID, name: 'Anna', color: '#7f77dd' }, { id: 'm2', name: 'Ben' }],
  games: [],
  sessions: [],
  tags: [],
});

test('the head carries --m-tone, and it is the member\'s OWN colour', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = roundFixture();
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (new RegExp(`^/api/rounds/${RID}$`).test(url)) return round;
    return {};
  });
  await dom.call('showMember', RID, MID);

  const head = dom.app.querySelector('.member-head');
  assert.ok(head, 'the member page rendered no head at all');
  const tone = head.style.getPropertyValue('--m-tone');
  assert.ok(tone, '.member-head carries no --m-tone, so the band paints on nothing');

  /* THE ASSERTION THAT MATTERS. The band, the avatar ring and the accent rule
     all read one property, and it has to be the value the avatar is already
     painted with — a second definition of "Anna's colour" is the palette-drift
     shape, and here it would show as a band in one colour behind a disc in
     another. Compared against the view's own source rather than against the
     stored hex, because a dark design lifts the tone through memberTone(). */
  // Normalised through the CSSOM: a custom property is stored verbatim while
  // `background` is parsed, so `#c6522c` and `rgb(198, 82, 44)` are the same
  // colour spelled two ways and a bare string compare reports a false drift.
  const probe = dom.document.createElement('span');
  probe.style.background = tone;
  assert.equal(probe.style.background, head.querySelector('.member-avatar').style.background,
    'the band\'s tone and the avatar\'s fill are two different colours');
  assert.equal(tone, dom.run(`memberColor(${JSON.stringify(round)}, '${MID}')`),
    'the tone is not memberColor()\'s value');

  // The tone is set on the BAND, not on the avatar: three rules read it, and a
  // custom property set on a child cannot be read by its parent.
  assert.equal(head.querySelector('.member-avatar').style.getPropertyValue('--m-tone'), '',
    'the tone moved onto the avatar, where the band and the accent rule cannot see it');
});

test('a member with no colour of their own still renders a band', async (t) => {
  // memberColor falls back, so --m-tone is always set — but the band must not
  // depend on it resolving to anything in particular: its ring is an inset
  // shadow rather than a border, so the shape survives whatever the tone is.
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = roundFixture();
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (new RegExp(`^/api/rounds/${RID}$`).test(url)) return round;
    return {};
  });
  await dom.call('showMember', RID, 'm2');
  const head = dom.app.querySelector('.member-head');
  assert.ok(head.style.getPropertyValue('--m-tone'), 'the uncoloured member got no tone');
});

test('the band is derived from --m-tone and the surface — never a literal hex', () => {
  const head = bodyOf('.member-head');
  assert.ok(head, '.member-head has no rule any more');

  // Every colour in the band comes from the tone or from a theme token, so a
  // round's design carries it and a dark scheme is not a special case.
  assert.match(head, /var\(--m-tone\)/, 'the band does not read the member tone');
  assert.match(head, /var\(--surface\)/, 'the band does not sit on the card surface');
  assert.doesNotMatch(head, /#[0-9a-f]{3,8}\b/i,
    'a literal hex in the band — the tone must come from the member, the rest from tokens');

  // The accent rule under the name is the one place the colour is used at full
  // strength, and it is the only one carrying no text.
  const rule = bodyOf('.member-head__info::after');
  assert.ok(rule, 'the accent rule under the name is gone');
  assert.match(rule, /var\(--m-tone\)/);

  /* The relocated figures' LABEL must be `--ink`. It sits in the band's
     top-right corner, where the radial wash is strongest — measured there,
     `--ink-soft` is 3.40:1 against the 4.5 AA bar while `--ink` is 6.63:1. The
     quiet tone is the natural choice for a small uppercase label, which is
     exactly why it is pinned. */
  const statLabel = bodyOf('.member-head__stat-label');
  assert.ok(statLabel, 'the relocated figures have no label rule');
  assert.match(statLabel, /color:\s*var\(--ink\)/);
  assert.doesNotMatch(statLabel, /var\(--ink-soft\)/,
    'the stat label went back to the quiet tone, which fails AA over the wash');

  // The avatar grew, and it must not carry a bespoke tinted shadow: elevation
  // comes from the --shadow ramp, and a ring is the exempt shape
  // (test/design-tokens.test.js refuses anything else).
  const avatar = bodyOf('.member-avatar');
  assert.match(avatar, /width:\s*104px/, 'the avatar is no longer the hero-sized one');
  assert.match(avatar, /box-shadow:\s*0 0 0 \d+px var\(--surface\)/,
    'the avatar shadow is not the plain --surface ring');
});
