/* Spielwirbel – the vertical arithmetic behind `openPopover`'s `place()` (#739).

   Pure numbers, no DOM, in its own file so it can be unit-tested without
   dragging core.js into the coverage report
   (.claude/rules/frontend-helper-modules-and-coverage.md). The measuring and
   applying half stays in `place()`, which is where the layout lives.

   Why an anchored card needs clamping at all: `place()` puts it WHOLLY above or
   WHOLLY below its anchor, so the room it can count on is the larger of the two
   sides — worst case (an anchor in the vertical middle) half the viewport. A
   card taller than that has no legal placement, and "past the fold" is not a
   cosmetic problem here: a page scroll CLOSES a popover (the #247 handler), so
   whatever ends up below the fold is unreachable rather than merely off-screen.

   Individual cards have been capped one at a time to that budget — the tags
   editor (#722), the expansion editor (#728) — and those caps stay: a card that
   fits by construction gives a better result than one squeezed from outside,
   because it chooses WHICH child gives way. What no cap can fix is a card whose
   own content already exceeds the budget, which is the edition-cover editor:
   chrome 270px + a 264px grid = 534px against (900 - 180 - 12) / 2 = 354px,
   because „Bild ändern" IS the 180px cover and a large anchor eats the room.
   Hence the clamp here, against the room the anchor ACTUALLY leaves rather than
   against that worst case. */

'use strict';

// Between the card and its anchor, and between the card and the viewport edge.
// Same 6px `place()` has always used, so an unclamped card is placed exactly
// where it was before this file existed.
const POPOVER_GAP = 6;

// The most room any legal placement can offer — the larger of the two sides,
// since the card goes wholly on one of them.
function popoverRoom(anchorTop, anchorBottom, viewportH) {
  return Math.max(anchorTop - POPOVER_GAP, viewportH - anchorBottom - POPOVER_GAP);
}

// How tall the card ends up, and which side of the anchor it goes on.
//
// `natural` is the card's own height — already narrowed by whatever `max-height`
// its CSS declares, since that cap is part of what the card wants to be.
//
// There is NO floor under the clamp, and that is a deliberate reversal of the
// obvious design. A floor at "what the card's children insist on" is the natural
// way to keep a child carrying `min-height: 0` from collapsing and painting over
// its sibling (#728 measured 107px of exactly that). But such a floor also
// refuses to clamp a card whose children cannot shrink at ALL — and that is the
// edition-cover editor, i.e. the one case this file exists for: measured, its
// floor comes back as its full 534px, so the clamp never fires and the fix fixes
// nothing.
//
// So the collapse is prevented where it actually happens instead: `place()` bars
// every child from shrinking past its own content while the card is clamped, and
// the card is then free to take exactly the room it has and scroll the
// remainder. A clamped card is reachable either way; a card past the fold is not
// reachable at all, because a page scroll closes it.
//
// Dropping the floor also removed a hazard rather than trading one away. While
// the floor existed, a card whose minimum exceeded BOTH sides could be clamped
// to a height that fit neither, and choosing the roomier side for it hung the
// card off the TOP of the viewport — measured on a 12-option list at top -322px,
// its leading options gone, and unreachable there in a way a bottom overflow at
// least is not, since the card's own scroll box cannot move the viewport's
// clipping edge. With `height` never exceeding the room, that state cannot
// arise: deciding the side from the clamped height and picking the roomier side
// now agree in every case.
function popoverFit(natural, anchorTop, anchorBottom, viewportH) {
  const roomBelow = viewportH - anchorBottom - POPOVER_GAP;
  const roomAbove = anchorTop - POPOVER_GAP;
  const height = Math.min(natural, popoverRoom(anchorTop, anchorBottom, viewportH));
  return {
    height,
    above: height > roomBelow && height <= roomAbove,
    clamped: height < natural,
    gap: POPOVER_GAP,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { popoverFit, popoverRoom, POPOVER_GAP };
}
