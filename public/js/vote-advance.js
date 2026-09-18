/* Spielwirbel – the beat between a rating tap and the next card (#1168).

   A rating used to need two taps: the face, then „Weiter". The second one
   carried no information — the vote is already in the closure the moment the
   face is pressed — so five games times five people cost fifty taps of pure
   confirmation per evening. Now the face tap itself advances, and this file
   owns the pause in between.

   Its own file because TWO card renderers must behave identically: the wizard's
   card (views-session.js — which the own-device lobby reuses through
   `startVoting`, so that surface is the same code) and the shared-link card
   (views-vote-link.js). A drift between them does not throw; it just makes the
   same gesture mean different things depending on whose phone the round is on.

   The pause is not decoration. It is the whole safety mechanism:

     - it gives the tapped face a beat at its traffic-light fill, so the tap
       reads as REGISTERED rather than as the screen jumping away;
     - it holds the OUTGOING card in place for its duration, so the next game's
       faces never appear under a finger that is already moving;
     - while it runs, `locked` is true and every control on the card is inert,
       so a double-tap cannot rate the following game. That is the one hard
       constraint of the feature, and the JS guard — not the CSS below — is what
       enforces it: a keyboard Enter never touches `pointer-events`.

   Dependency-free and tiny by design, so a spec can `require()` it without
   dragging a DOM view into the coverage report
   (.claude/rules/frontend-helper-modules-and-coverage.md).
   Load order: see index.html — before its two view consumers. */

'use strict';

/* ~1/3 s: long enough to see the face fill and short enough that five games in
   a row still feel like one motion. Tuned by hand on a phone; if it ever reads
   as lag, this is the number to move. */
const VOTE_ADVANCE_MS = 340;

/* Under `prefers-reduced-motion` the swap is effectively instant — but NOT 0.
   A zero-length beat would swap the card in the same frame as the selection is
   painted, so the person would never see their own choice acknowledged, which
   is feedback rather than motion. 90ms is one or two frames: no animation, one
   visible selected state. */
const VOTE_ADVANCE_REDUCED_MS = 90;

/* How long taps are IGNORED, measured from the first one — a different question
   from how long the card is held, and the reason it is a second number.

   The beat above is visual, so reduced motion shortens it. Safety must not
   shorten with it: at a 90ms beat, the second tap of an ordinary double-tap
   lands AFTER the card has already swapped and rates the following game — which
   is the one thing this feature may never do. Found by the double-tap spec
   going red at exactly that, on the reduced-motion path only.

   So the lock outlives the swap. 350ms covers a double-tap (the platforms'
   own thresholds sit around 250–300ms) while costing the default beat 10ms of
   inertness on the card it has just delivered. The failure it trades for is the
   benign one: a genuinely fast deliberate tap is dropped, and the person taps
   again looking straight at the card they meant. */
const VOTE_TAP_GUARD_MS = 350;

/** The beat this device should use, honouring `prefers-reduced-motion`. */
function voteAdvanceMs(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  // Guarded rather than assumed: an old browser (and a bare jsdom) has no
  // matchMedia at all, and `undefined.matches` would throw inside a click
  // handler on the app's central action.
  const reduced = !!(w && w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
  return reduced ? VOTE_ADVANCE_REDUCED_MS : VOTE_ADVANCE_MS;
}

/** One flow's advance state. Created once per vote run, not per card. */
function createVoteAdvance(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  // The beat: holds the outgoing card, then delivers the next one.
  let beatTimer = null;
  // The guard: outlives the beat and keeps every control inert until a
  // double-tap's second tap can no longer be in flight. See VOTE_TAP_GUARD_MS.
  let guardTimer = null;
  const isLocked = () => beatTimer !== null || guardTimer !== null;

  return {
    /* True from the tap until taps are safe again. Every handler on the card
       asks this FIRST and returns early — the mood faces, so a second tap can
       never land on the next game, and „Zurück", so a pending advance cannot
       race a navigation the user asked for at the same moment. */
    get locked() { return isLocked(); },

    /** Hold `card` for one beat, then run `fn`. A no-op while one is in flight. */
    schedule(card, fn) {
      if (isLocked()) return false;
      // The class is belt to the guard's braces: it takes the card out of the
      // pointer's reach so the tap never even becomes an event. It rides on the
      // OUTGOING card, so it is discarded with it — the lock that survives the
      // swap is the JS one, which is the half a keyboard Enter answers to.
      if (card) card.classList.add('vote--advancing');
      const beat = voteAdvanceMs(w);
      guardTimer = w.setTimeout(() => { guardTimer = null; },
        Math.max(beat, VOTE_TAP_GUARD_MS));
      beatTimer = w.setTimeout(() => {
        // Cleared BEFORE fn(), so the callback is free to navigate — and so a
        // flow that renders a fresh card is not left waiting on a timer id that
        // already fired.
        beatTimer = null;
        fn();
      }, beat);
      return true;
    },

    /* Drop a pending advance. Called on every way OUT of the current step that
       is not the advance itself — a Back, a leave — because the callback closes
       over "one step forward from here" and would otherwise push the user
       forward out of the screen they just navigated to. Releases the tap guard
       with it: the user is deliberately somewhere else, so there is no swap left
       for a stray tap to fall through. */
    cancel() {
      if (beatTimer !== null) { w.clearTimeout(beatTimer); beatTimer = null; }
      if (guardTimer !== null) { w.clearTimeout(guardTimer); guardTimer = null; }
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VOTE_ADVANCE_MS, VOTE_ADVANCE_REDUCED_MS, VOTE_TAP_GUARD_MS,
    voteAdvanceMs, createVoteAdvance,
  };
}
