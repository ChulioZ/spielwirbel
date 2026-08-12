'use strict';

/* The vertical arithmetic behind `openPopover`'s `place()` (#739).
 *
 * `place()` puts an anchored card WHOLLY above or WHOLLY below its anchor, so
 * the room it can count on is the larger of the two sides. A card taller than
 * that has no legal placement — and "past the fold" is unreachable rather than
 * merely off-screen, because a page scroll closes a popover outright.
 *
 * The DOM half (measuring the card, applying the clamp, barring its children
 * from collapsing, adding the scroll box) is in core.js and is verified in a
 * real browser; everything decidable from numbers alone lives here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { popoverFit, popoverRoom, POPOVER_GAP } = require('../public/js/popover-fit');

/* An anchor described by its top edge and height, so a test reads the way the
   screen does. */
const at = (top, height) => ({ top, bottom: top + height });
const fit = (natural, anchor, viewportH) =>
  popoverFit(natural, anchor.top, anchor.bottom, viewportH);

/* ------------------------------------------------- the unchanged happy paths */

test('a card that fits below its anchor goes below, unclamped', () => {
  const f = fit(200, at(100, 40), 800);
  assert.equal(f.above, false);
  assert.equal(f.clamped, false);
  assert.equal(f.height, 200);
});

test('a card that does not fit below but fits above flips above, unclamped', () => {
  // 594px below the anchor is not enough for a 620px card; 694px above is. This
  // is the pre-#739 flip, and it must still happen without a clamp.
  const f = fit(620, at(700, 40), 1340);
  assert.equal(f.above, true);
  assert.equal(f.clamped, false);
  assert.equal(f.height, 620);
});

test('the gap either side of the card is the 6px place() has always used', () => {
  // Pinned because an unclamped card must land exactly where it did before this
  // module existed — the fix is meant to be invisible until a card overflows.
  assert.equal(POPOVER_GAP, 6);
});

test('the room a placement can offer is the larger side, never the sum', () => {
  assert.equal(popoverRoom(300, 480, 900), 414);   // below: 900 - 480 - 6
  assert.equal(popoverRoom(700, 740, 900), 694);   // above: 700 - 6
});

/* -------------------------------------------- the case that had no placement */

test('a card too tall for either side is clamped to the roomier one', () => {
  // Anchor low in the viewport: 194px below it, 594px above.
  const f = fit(700, at(600, 40), 840);
  assert.equal(f.clamped, true);
  assert.equal(f.height, 594);
  assert.equal(f.above, true);
});

test('an anchor in the vertical middle leaves half the viewport, which is the ceiling every per-card cap is derived from', () => {
  // The dead-band condition the tags (#722) and expansion (#728) caps are
  // written against: with the anchor centred, both sides are (H - anchorH)/2 - 6
  // and no card taller than that can be placed unclamped.
  const H = 900;
  const anchorH = 40;
  const anchor = at((H - anchorH) / 2, anchorH);
  assert.equal(popoverRoom(anchor.top, anchor.bottom, H), (H - anchorH) / 2 - POPOVER_GAP);
  assert.equal(fit(600, anchor, H).clamped, true);
});

/* ------------------------------------ a clamped card ALWAYS fits on its side */

test('the clamped height never exceeds the room, however tall the card is', () => {
  /* The property the whole fix rests on, and the reason there is no floor under
     the clamp: whatever the card wants, what gets placed fits the side it is
     placed on — so nothing is ever left past the fold, where a page scroll
     (which closes the popover) cannot recover it. The card scrolls the rest.

     A floor at "what the card's children insist on" was tried first and is
     wrong: it refuses to clamp a card whose children cannot shrink at all,
     which is precisely the edition-cover editor this issue is about. */
  for (const anchorTop of [0, 60, 194, 300, 450, 600, 800]) {
    for (const natural of [120, 380, 534, 900, 2000]) {
      const anchor = at(anchorTop, 180);
      const f = fit(natural, anchor, 900);
      const room = f.above ? anchor.top - POPOVER_GAP : 900 - anchor.bottom - POPOVER_GAP;
      assert.ok(
        f.height <= room,
        `card ${natural} at anchorTop ${anchorTop}: placed ${f.height} into ${room} of room`,
      );
    }
  }
});

test('a clamped card is placed entirely inside the viewport, on either side', () => {
  for (const anchorTop of [60, 194, 300, 450, 600, 800]) {
    for (const natural of [380, 534, 900]) {
      const anchor = at(anchorTop, 180);
      const f = fit(natural, anchor, 900);
      const top = f.above ? anchor.top - f.height - POPOVER_GAP : anchor.bottom + POPOVER_GAP;
      assert.ok(top >= 0, `top ${top} for card ${natural} at ${anchorTop}`);
      assert.ok(top + f.height <= 900, `bottom ${top + f.height} for card ${natural} at ${anchorTop}`);
    }
  }
});

/* ------------------------------------- the editor no per-card cap could fix */

test('the edition-cover editor stops at the fold instead of running past it', () => {
  /* The measurement from #728, reproduced on the real editor with 40 editions:

       card (grid expanded)  534px   — and no `max-height` can help. „Bild
       chrome + 264px grid   534px     ändern" IS the 180px cover, so the anchor
       budget (900-180-12)/2 354px     itself eats the room.

     At anchorTop 300 the room below is 414px, so the card comes down to 414 and
     „Bild entfernen" moves from 120px past the fold to inside a card that
     scrolls. */
  const anchor = at(300, 180);
  const f = fit(534, anchor, 900);
  assert.equal(f.above, false);
  assert.equal(f.height, 414);
  assert.equal(f.clamped, true);
  assert.equal(anchor.bottom + POPOVER_GAP + f.height, 900, 'ends exactly at the fold');
  assert.equal(anchor.bottom + POPOVER_GAP + 534 - 900, 120, 'and used to end 120px past it');
});

test('the same editor overflows even at its BEST anchor position, and that is caught too', () => {
  // At scroll 0 on the demo round's game pages the cover sits at y=194 — the
  // roomiest the anchor ever gets — and the card still ran 14px past the fold
  // (measured on the real editor). So there is no scroll position at 900px of
  // viewport where this editor was fully reachable.
  const anchor = at(194, 180);
  const f = fit(534, anchor, 900);
  assert.equal(f.clamped, true);
  assert.equal(f.height, 520);
  assert.equal(anchor.bottom + POPOVER_GAP + 534 - 900, 14, 'the overflow it used to have');
});

/* ---------------------------------- a rigid card is reachable, not hung off */

test('a rigid option list too tall for both sides is clamped rather than left overflowing', () => {
  /* A 12-option menu has no child that can give way, so a floor-based clamp
     would decline to touch it and leave 422px of it past the fold. Clamping it
     to the room and letting the card scroll keeps every option reachable —
     which a popover cannot achieve any other way, since scrolling the page
     closes it. */
  const anchor = at(300, 400);        // 294px above, 194px below
  const f = fit(624, anchor, 900);
  assert.equal(f.height, 294);
  assert.equal(f.above, true);
  assert.equal(anchor.top - f.height - POPOVER_GAP, 0, 'its top edge is on screen');
});
