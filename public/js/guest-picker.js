/* Spielwirbel – the session's guests (#458, #532): the names of people at the
   table tonight who are not members of the round.

   Until #1016 this file rendered a whole `.field` — a label, one removable chip
   per guest and a name input. That field is gone: guests now sit on the seat
   ring beside the members (seat-picker.js), which is the one control answering
   „who is at the table". What is left here is the STATE the ring drives and two
   other files read, which is why the file stayed rather than being folded into
   the ring: `renderTeamPicker` position-resolves a guest against `guestKeys`
   (.claude/rules/session-teams.md) and both screens POST `guests` at submit time.

   Frontend shared-scope script; load order: see index.html. */

'use strict';

// The live guest list for ONE session-starting screen.
//
//  - `note` is the hint shown under the ring's name input. It is a parameter
//    rather than a fixed key because it differs by screen and one of the
//    wordings would be a lie: the draw flow's guests vote, the direct-play
//    flow's never do (no voting phase — they are there to be recorded as
//    present, and to be pickable as the winner). It travels with the guest state
//    rather than as a separate argument to the ring, because it is a statement
//    about THESE guests.
//
// Only NAMES travel to the server; it mints the ids (#458). `guestKeys` is the
// index-aligned sibling the team picker holds on to (#575): it references a
// guest by key rather than by position, because removing a guest shifts every
// later index out from under it — while the wire format can only be positional,
// since the ids are minted server-side and do not exist yet. Keys never leave
// the browser.
//
// The cap (MAX_SESSION_GUESTS) is deliberately NOT enforced here: the ring stops
// rendering its „+" seat at the cap, so there is no second copy of the limit and
// no unreachable branch pretending to guard one.
function createGuestList(note) {
  const guests = [];
  const guestKeys = [];
  let seq = 0;
  return {
    guests,
    guestKeys,
    note,
    add(name) {
      guests.push(name);
      guestKeys.push('g' + ++seq);
    },
    remove(key) {
      const i = guestKeys.indexOf(key);
      if (i < 0) return;
      guests.splice(i, 1);
      guestKeys.splice(i, 1);
    },
  };
}
