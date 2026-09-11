/* Spielwirbel – who owns a game (#971): the chip picker three screens share, and
   the rule deciding what it starts out selecting.

   One file because the add-game sheet, the BGG import sheet and the game detail
   page offer the SAME control, and because the preselection rule is the whole
   point of the feature being pleasant rather than tedious — a shelf is entered
   by one person, mostly recording their own boxes, so the picker that starts
   empty gets ticked identically a hundred times.

   The two pure halves are CommonJS-exported and unit-tested from Node
   (test/owner-picker.test.js); the renderer is DOM code, so it stays uncovered
   there and is exercised through the jsdom harness instead. Requiring this file
   costs ~0.1 points of the global coverage figure — measured, and well clear of
   the 90% floor (.claude/rules/frontend-helper-modules-and-coverage.md). */

'use strict';

// What the picker starts with, in this order:
//   1. the caller's seat's stored `ownerPreset` — including an EMPTY one, which
//      is why the test is `Array.isArray` and not truthiness: "I took myself off
//      the list" must survive to the next add rather than being re-defaulted;
//   2. otherwise the caller's own seat, since the common case is entering your
//      own shelf;
//   3. otherwise nothing — a grantee, or an instance with accounts off, has no
//      seat, so there is nobody to guess at.
function ownerPresetFor(round, userId) {
  const members = (round && round.members) || [];
  const seat = userId ? members.find((m) => m.userId === userId) : null;
  if (seat && Array.isArray(seat.ownerPreset)) {
    // A preset naming a seat that is gone must not resurrect it — same rule the
    // tag filter applies to a deleted tag.
    const live = new Set(members.map((m) => m.id));
    return seat.ownerPreset.filter((x) => live.has(x));
  }
  return seat ? [seat.id] : [];
}

// The member names for a set of owner ids, in the round's own member order so
// two screens never list one game's owners differently. An id with no member is
// dropped rather than rendered as a blank.
function ownerNames(round, ownerIds) {
  const ids = new Set(Array.isArray(ownerIds) ? ownerIds : []);
  return ((round && round.members) || []).filter((m) => ids.has(m.id)).map((m) => m.name);
}

/* Who has to BRING the box (#971, lifted out of renderFinish by #1008). Said
   only when it is NEWS, which is the whole rule:
     - no recorded owner        -> nothing to say;
     - everyone seated owns it  -> not news, so stay quiet;
     - otherwise name the owners who can actually PUT IT DOWN — here, and with
       their shelf (#1002) — falling back to every owner when none of them can:
       a direct pick is not filtered by ownership, so it can legitimately land
       on a game nobody present owns, and that is exactly when the line is most
       worth printing.

   Pure and shared because two screens print it: the ranking row and the chosen
   row's finish panel. They must never list one game's owners differently
   (.claude/rules/shared-constants-across-the-stack.md, the logic half —
   draw-pool.js is the precedent).

   `[].every(...)` is vacuously TRUE, so a seatless session would read as
   "everyone owns it" and fall into the quiet branch. The route guarantees at
   least one seat, so that is unreachable — and suppressing is the safe
   direction anyway: saying nothing beats naming the wrong person. */
function boxBringers(round, session, game, shelfParty) {
  const ownerIds = (game && game.ownerIds) || [];
  if (!ownerIds.length) return [];
  const seated = new Set((session && session.memberIds) || []);
  // Who can actually put the box down (#1002): the seats whose shelf is in the
  // room, i.e. the very party the draw filtered its pool by.
  //
  // `shelfParty` (public/js/draw-pool.js) is INJECTED, and carries NO DEFAULT,
  // for the reason table-split.js gives about `tileValue`: these are classic
  // scripts over one global scope and this file is ALSO required from Node,
  // where that sibling is not loaded, so it cannot simply be called. A default
  // — or a hand-written `seated && !away` filter, which is the same subtraction
  // spelled a second time — would let this screen and the draw part company and
  // hand back a plausible, confident list naming somebody who said they brought
  // nothing, with no error anywhere. Omitting the argument throws instead.
  const bringing = new Set(shelfParty([...seated], (session && session.withoutShelfIds) || []));
  // The QUIET rule stays on the SEATS, deliberately, while the naming below
  // moves to the people who can produce a copy. It asks about OWNERSHIP — if
  // everybody at the table owns one, nobody needs telling, whoever happened to
  // carry theirs — where the line itself answers tonight's logistics.
  const everyoneOwnsIt = [...seated].every((mid) => ownerIds.includes(mid));
  if (everyoneOwnsIt) return [];
  const here = ownerIds.filter((x) => bringing.has(x));
  return ownerNames(round, here.length ? here : ownerIds);
}

// The chip row itself. `selected` is a live Set the caller reads back on submit —
// the same contract the tag chips beside it use, so the two rows behave
// identically under the finger.
//
// The avatar goes through memberColor() like every other avatar in the app: a
// member's colour is position-derived unless one was picked on the member page,
// so `m.color` is usually ABSENT, and the `m.color || '#888'` this shipped with
// painted every chip flat grey — white initials at 3.5:1, and the one avatar on
// screen that did not match the rail (2026-09-08 audit).
function renderOwnerChips(round, selected) {
  const wrap = h('<div class="filter-chips"></div>');
  const members = (round && round.members) || [];
  wrap.hidden = members.length === 0;
  wrap.replaceChildren(...members.map((m) => {
    const on = selected.has(m.id);
    const chip = h(`<button type="button" class="chip${on ? ' is-on' : ''}" aria-pressed="${on}">`
      + `<span class="chip__avatar avatar" style="background:${esc(memberColor(round, m.id))}">`
      + `${avatarFace(initials(m.name), { userId: m.userId })}</span>${esc(m.name)}</button>`);
    chip.addEventListener('click', () => {
      if (selected.has(m.id)) selected.delete(m.id);
      else selected.add(m.id);
      const now = selected.has(m.id);
      chip.classList.toggle('is-on', now);
      chip.setAttribute('aria-pressed', String(now));
    });
    return chip;
  }));
  return wrap;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ownerPresetFor, ownerNames, boxBringers };
}
