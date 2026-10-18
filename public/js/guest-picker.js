/* Spielwirbel – the session's guests (#458, #532): the names of people at the
   table tonight who are not members of the round.

   Until #1016 this file rendered a whole `.field` — a label, one removable chip
   per guest and a name input. That field is gone: guests now sit on the seat
   ring beside the members (seat-picker.js), which is the one control answering
   „who is at the table". What is left here is the STATE the ring drives and two
   other files read, which is why the file stayed rather than being folded into
   the ring: `renderTeamPicker` position-resolves a guest against `guestKeys`
   (.claude/rules/session-teams.md) and both screens POST `guests` at submit time.
   Since #1681 it also holds each guest's brought games (the draw flow only).

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
//
// `bringsGames` (#1681) is true on the draw flow only: there a guest may bring
// their own games, which join THIS session's pool. `guestGames` is the third
// index-aligned array — each guest's brought game ids — and `payload()` is what
// the start request sends: a bare name for a guest who brought nothing (the
// wire form that predates #1681, so a guestless or game-less draw is
// byte-identical), `{ name, gameIds }` otherwise. Direct play has no pool to
// bring a game into, so its list never offers it.
function createGuestList(note, { bringsGames = false } = {}) {
  const guests = [];
  const guestKeys = [];
  const guestGames = [];
  let seq = 0;
  const at = (key) => guestKeys.indexOf(key);
  return {
    guests,
    guestKeys,
    guestGames,
    note,
    bringsGames,
    add(name) {
      guests.push(name);
      guestKeys.push('g' + ++seq);
      guestGames.push([]);
    },
    remove(key) {
      const i = at(key);
      if (i < 0) return;
      guests.splice(i, 1);
      guestKeys.splice(i, 1);
      guestGames.splice(i, 1);
    },
    nameOf(key) {
      const i = at(key);
      return i < 0 ? '' : guests[i];
    },
    gamesOf(key) {
      const i = at(key);
      return i < 0 ? [] : guestGames[i];
    },
    // One box is brought by one guest, so bringing it moves it off anyone else;
    // the cap is MAX_GUEST_GAMES, the same number the start route enforces.
    bring(key, gameId) {
      const i = at(key);
      if (i < 0 || guestGames[i].includes(gameId) || guestGames[i].length >= MAX_GUEST_GAMES) return false;
      guestGames.forEach((list) => {
        const j = list.indexOf(gameId);
        if (j >= 0) list.splice(j, 1);
      });
      guestGames[i].push(gameId);
      return true;
    },
    unbring(key, gameId) {
      const list = this.gamesOf(key);
      const j = list.indexOf(gameId);
      if (j >= 0) list.splice(j, 1);
    },
    // Every brought game id, as the Set the draw pool's `isBroughtGame` takes.
    broughtIds() {
      return new Set(guestGames.flat());
    },
    payload() {
      return guests.map((name, i) => (guestGames[i].length ? { name, gameIds: guestGames[i].slice() } : name));
    },
  };
}
