/* Spielwirbel – „Wer fängt an?" (#1769): the pure half of the start-player
   whirl. Who may be drawn, the draw itself, and the whirl's step sequence.

   The draw is over PLAYING PARTIES (sessionParties), never over people: a team
   is one unit (#575), and an automa (#1672) is not a seat at all — it lives in
   `session.automa`, which no party resolver reads — so it can never be drawn.
   The answer is shown, never stored.

   Dependency-free with a module.exports guard, so the RNG-injected unit tests
   can require it (.claude/rules/frontend-helper-modules-and-coverage.md). The
   DOM lives in start-player-view.js. Load order: see index.html. */

'use strict';

// Fewer than two parties is no choice at all — a solo table gets no button.
const START_PLAYER_MIN_UNITS = 2;

function canDrawStartPlayer(units) {
  return Array.isArray(units) && units.length >= START_PLAYER_MIN_UNITS;
}

// One unit, uniformly. `rng` is injectable (Math.random's contract: [0, 1));
// the clamp keeps an out-of-contract 1 from falling off the end.
function pickStartPlayer(units, rng = Math.random) {
  if (!canDrawStartPlayer(units)) return null;
  const i = Math.min(units.length - 1, Math.floor(rng() * units.length));
  return units[i];
}

// The indices the whirl lights, in order: two full laps from the first unit,
// then on round to the drawn one. Always ends on `landing`.
function startPlayerWhirl(count, landing) {
  if (count < 2) return [landing];
  const steps = 2 * count + landing + 1;
  const seq = [];
  for (let i = 0; i < steps; i++) seq.push(i % count);
  return seq;
}

// How long each step stays lit: fast at first, easing out towards the answer,
// so the whole whirl stays well under two and a half seconds.
function whirlDelays(steps) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const p = steps > 1 ? i / (steps - 1) : 1;
    out.push(Math.round(55 + 220 * p * p));
  }
  return out;
}

/* The direct-play sheet has no stored session yet — only its live pickers. This
   shapes them into the blob sessionParties reads, so the sheet draws over
   exactly the parties the results screen will show, through the same resolver
   rather than a fifth copy of the party arithmetic (.claude/rules/session-teams.md).
   Guests get draft ids here (the server mints the real ones), addressed by
   POSITION exactly like the team payload's `guestIndices`. */
function draftSession(memberIds, guestNames, teamPayload) {
  const guestId = (i) => `draft-guest-${i}`;
  const session = { memberIds: [...memberIds] };
  if (guestNames && guestNames.length) session.guests = guestNames.map((name, i) => ({ id: guestId(i), name }));
  if (teamPayload && teamPayload.length) {
    session.teams = teamPayload.map((tm, i) => ({
      id: `draft-team-${i}`,
      personIds: [...(tm.memberIds || []), ...(tm.guestIndices || []).map(guestId)],
      sharedSeat: tm.sharedSeat,
    }));
  }
  return session;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    START_PLAYER_MIN_UNITS,
    canDrawStartPlayer,
    pickStartPlayer,
    startPlayerWhirl,
    whirlDelays,
    draftSession,
  };
}
