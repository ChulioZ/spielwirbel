'use strict';

/* Driving a vote card in jsdom, after #1168 made the rating tap the advance.

   Shared by every spec that clicks a mood face, because the waiting rule is
   counter-intuitive and getting it wrong produces a confident wrong failure:

     - the CARD swaps after the beat (`swap`), but
     - TAPS stay locked for longer than that (`beat`), because the guard against
       a double-tap deliberately outlives the swap — see VOTE_TAP_GUARD_MS in
       public/js/vote-advance.js.

   A spec that waits only for the swap and then clicks has its click silently
   ignored, asserts against the card it was already on, and reads as the advance
   being broken. Wait with `beat()` before tapping again; reach for `swap()`
   only when the point is the window between the two. */

/** Pin `prefers-reduced-motion` — jsdom's own matchMedia never matches. */
function setMotion(dom, reduced) {
  dom.run(`window.matchMedia = (q) => ({ matches: ${!!reduced} && /reduced-motion/.test(q), addEventListener() {}, removeEventListener() {} });`);
}

/** Wait until the flow accepts a tap again, then let the render settle. */
async function beat(dom) {
  const ms = dom.run('Math.max(voteAdvanceMs(), VOTE_TAP_GUARD_MS)');
  await new Promise((r) => setTimeout(r, ms + 40));
  await new Promise((r) => setImmediate(r));
}

/** Wait past the beat only: the card has swapped, taps are still locked. */
async function swap(dom) {
  await new Promise((r) => setTimeout(r, dom.run('voteAdvanceMs()') + 40));
  await new Promise((r) => setImmediate(r));
}

module.exports = { setMotion, beat, swap };
