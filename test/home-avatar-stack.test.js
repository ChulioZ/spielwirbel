'use strict';

/* The home lobby card's avatar stack is CAPPED (#820).

   The bug: `.avatar-stack` is an inline-flex row with no cap and no wrap, and
   renderLobbyList() mapped EVERY member of the round into it. A round may hold
   up to 50 members (MAX_MEMBERS_PER_ROUND, lib/quota.js), so the row simply grew
   until it ran past the right edge of the card — and `.round-card__meta`'s
   flex-wrap then pushed both stat chips onto a second line, so a big round's
   card stopped matching the height of its neighbours in the lobby grid.

   The fix caps the stack and puts the remainder in one neutral "+N" bubble. The
   arithmetic is what is pinned here: an off-by-one in either the slice or the
   remainder is invisible on a small fixture and wrong on every real round.

   The round hero (.hero__members) and the desktop rail (.rail__members) wrap
   already and are deliberately NOT capped — see the last spec in this file. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RULES, bodyOf, whole } = require('./support/css');
const { loadApp, translator } = require('./support/dom');
const { MEMBER_COLORS } = require('../public/js/member-colors');

/** The shape listRoundSummaries returns (lib/repo/json.js), with `n` members. */
const roundOf = (n) => ({
  id: 1,
  name: 'Donnerstagsrunde',
  members: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Mitglied ${i + 1}` })),
  memberCount: n,
  gameCount: 3,
  sessionCount: 1,
  playedCount: 1,
  background: null,
  lastPlayed: null,
});

/** The populated home over one round of `n` members, rendered for real (#602). */
async function lobbyCard(t, n) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => [roundOf(n)]);
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  await dom.call('showHome');
  const card = dom.document.querySelector('.round-card:not(.round-card--new)');
  assert.ok(card, 'the lobby rendered no round card at all');
  return { dom, card, stack: card.querySelector('.avatar-stack') };
}

/* Read from the implementation so a deliberate retune does not need a test
   rewrite — but bounded, because everything below is derived from it and a cap
   of 50 would satisfy the arithmetic vacuously by never overflowing. */
function cap(dom) {
  const value = dom.get('LOBBY_AVATAR_CAP');
  assert.equal(typeof value, 'number', 'LOBBY_AVATAR_CAP is not a number');
  assert.ok(value >= 3 && value <= 8, `LOBBY_AVATAR_CAP is ${value} — outside the range a card can hold`);
  return value;
}

test('a round bigger than the cap renders exactly cap avatars plus one +N bubble', async (t) => {
  const { dom, stack } = await lobbyCard(t, 15);
  const n = cap(dom);

  const more = stack.querySelectorAll('.avatar-stack__more');
  assert.equal(more.length, 1, 'the overflow bubble is missing (or duplicated) on a 15-member round');

  // Member avatars only — the bubble carries .avatar too, for its geometry.
  const seats = [...stack.querySelectorAll('.avatar')].filter((el) => !el.classList.contains('avatar-stack__more'));
  assert.equal(seats.length, n, `the stack rendered ${seats.length} member avatars, not the cap of ${n}`);

  // The true remainder, not the member count and not cap-off-by-one.
  assert.equal(more[0].textContent.trim(), `+${15 - n}`, 'the bubble does not show the true remainder');

  /* The bubble must not be mistakable for a member: no palette colour, and no
     inline background at all (which is how a member avatar gets its swatch). */
  assert.equal(more[0].getAttribute('style'), null, 'the overflow bubble carries an inline style — it will read as a member swatch');
  assert.ok(!MEMBER_COLORS.some((c) => more[0].outerHTML.includes(c)), 'the overflow bubble paints a member palette colour');
});

test('the bubble is absent at exactly the cap, and appears at one over it', async (t) => {
  const atCap = await lobbyCard(t, 5);
  const n = cap(atCap.dom);
  assert.equal(n, 5, 'this spec fixes the boundary at 5 — retune the fixtures with the cap');

  assert.equal(atCap.stack.querySelector('.avatar-stack__more'), null,
    'a round of exactly the cap renders an overflow bubble for nobody');
  assert.equal(atCap.stack.querySelectorAll('.avatar').length, n, 'a round at the cap lost an avatar');

  const over = await lobbyCard(t, n + 1);
  const bubble = over.stack.querySelector('.avatar-stack__more');
  assert.ok(bubble, 'a round one over the cap renders no overflow bubble');
  assert.equal(bubble.textContent.trim(), '+1', 'the remainder is wrong at the boundary');
});

test('the bubble carries a localized, pluralized accessible label', async (t) => {
  const de = translator('de');
  const en = translator('en');

  const one = await lobbyCard(t, 6);
  const oneBubble = one.stack.querySelector('.avatar-stack__more');
  assert.equal(oneBubble.getAttribute('aria-label'), de('home.moreMembersOne', { n: 1 }),
    'the single-remainder bubble is not labelled with the singular key');
  // The visible "+1" is a bare glyph; the label is what a screen reader reads.
  assert.notEqual(oneBubble.getAttribute('aria-label'), '+1', 'the bubble has no label beyond its glyph');
  assert.equal(oneBubble.getAttribute('title'), oneBubble.getAttribute('aria-label'),
    'the bubble tooltip and its accessible label disagree');

  const many = await lobbyCard(t, 15);
  assert.equal(many.stack.querySelector('.avatar-stack__more').getAttribute('aria-label'),
    de('home.moreMembers', { n: 10 }), 'the multi-remainder bubble is not labelled with the plural key');

  /* Not a parity check (i18n-parity covers that) — this asserts the keys carry
     the {n} placeholder, which a label reading "weitere Mitglieder" would not. */
  for (const [name, tr] of [['de', de], ['en', en]]) {
    assert.match(tr('home.moreMembers', { n: 10 }), /10/, `${name}: home.moreMembers drops the count`);
    assert.match(tr('home.moreMembersOne', { n: 1 }), /1/, `${name}: home.moreMembersOne drops the count`);
  }
});

test('.avatar-stack__more is declared, neutral, and cannot re-widen the meta row', () => {
  const body = bodyOf('.avatar-stack__more');
  assert.ok(body, '.avatar-stack__more rule not found — the bubble renders as a brand-coloured avatar');

  /* .avatar sets `background: var(--brand)` and `color: #fff`. The bubble's rule
     wins only by source order (same specificity), so it MUST come later. */
  const order = (sel) => RULES.findIndex(([s]) => s.split(',').map((x) => x.trim()).includes(sel));
  assert.ok(order('.avatar-stack__more') > order('.avatar'),
    '.avatar-stack__more is declared before .avatar — .avatar\'s brand background wins the cascade');

  assert.match(body, /background:\s*var\(--/, 'the bubble does not paint a page-derived neutral background');
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(body), 'the bubble hardcodes a hex colour instead of a theme token');

  /* The cap bounds the stack's width, but only if the stack keeps that width:
     its children are `flex: none`, so a shrunk stack box overflows its content
     instead of narrowing — the exact failure this issue is about. */
  assert.match(bodyOf('.avatar-stack') || '', /flex:\s*(none|0 0 auto)/,
    '.avatar-stack may shrink below its content — the avatars will spill past the card again');
});

test('the round hero and the desktop rail still wrap rather than cap', () => {
  /* The issue scopes the cap to the lobby card. Both in-round member strips
     wrap today, so a 20-person round shows several rows INSIDE the round — that
     is acceptable and deliberate. Pinned so a future "cap them too" does not
     land silently, and so this file cannot be read as covering them. */
  for (const sel of ['.hero__members', '.rail__members']) {
    const body = bodyOf(sel);
    assert.ok(body, `${sel} rule not found`);
    assert.match(body, /flex-wrap:\s*wrap/, `${sel} stopped wrapping — its members can now overflow`);
  }
  assert.ok(!RULES.some(([s]) => whole('.avatar-stack__more').test(s) && /hero|rail/.test(s)),
    'the overflow bubble leaked into the hero or rail member strips');
});
