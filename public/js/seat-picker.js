/* Spielwirbel – the seat ring both session-starting screens open with: who is at
   the table tonight. Members sit on the ring as toggles, the session's guests
   (#458) sit on it beside them since #1016, and a dashed „+" seat adds one.

   Split out of core.js by #1016, along the seam that file's own header names:
   core.js holds shared helpers and state, and this is a self-contained widget
   with two callers — the draw setup (views-session.js) and the direct-play sheet
   (direct-session.js) — exactly like guest-picker.js, team-picker.js and
   setup-addons.js beside it. Frontend shared-scope script; load order: see
   index.html (after core.js, whose memberColor/avatarFace/initials it calls, and
   after session-people.js for the two guest limits). */

'use strict';

// Unique per ring, because the id is what the „+" seat's `aria-controls` points
// at and two setup surfaces can be in the document at once — the direct-play
// sheet opens over a screen that may itself be the setup form. Same reason
// setup-addons.js counts its bodies.
let seatGuestSeq = 0;

// Seat-picker around a table: tap a member to toggle whether they join tonight,
// tap the „+" seat to add a guest, tap a guest to send them home again.
//
//  - `joining` is a Set of member ids, mutated in place; at least one member must
//    stay in.
//  - `onChange` (optional) runs after every change — a member toggled, a guest
//    added or removed — so the caller can refresh whatever follows from who is at
//    the table (the team picker, the pool preview, the add-on chip labels).
//  - `guestList` is the createGuestList() state holder (guest-picker.js): its
//    live `guests`/`guestKeys` arrays, its `note`, and the add/remove operations
//    this ring drives. It is REQUIRED rather than optional, and both callers pass
//    one: an absent-means-no-guests default would render a ring with no „+" seat
//    that looks finished and silently cannot take a visitor.
//
// Returns the wrapper to append where needed: the ring plus the guest-name input
// that unfolds under it. It exposed a `refreshSeats()` until #1016 — the guest
// list lived outside the picker then, so a caller had to be able to redraw it.
// The ring owns that list now, so there is nothing left for an outside caller to
// tell it, and a redraw hook nobody calls is a second way to render the ring.
function renderSeatPicker(round, joining, onChange, guestList) {
  const addId = 'seatGuestAdd' + ++seatGuestSeq;
  const wrap = h(`<div class="nr-seats">
      <div class="nr-table">
        <div class="nr-table__ring"></div>
        <div class="nr-table__center"></div>
      </div>
      <div class="nr-guest-add" id="${addId}" hidden>
        <div class="row">
          <input class="input" maxlength="${GUEST_NAME_MAX}"
                 aria-label="${esc(t('startSession.guestPlaceholder'))}"
                 placeholder="${esc(t('startSession.guestPlaceholder'))}" />
          <button type="button" class="btn">${iconText('ti-plus', t('startSession.guestAdd'))}</button>
        </div>
        <div class="muted field__hint">${esc(guestList.note)}</div>
      </div>
    </div>`);
  const table = wrap.querySelector('.nr-table');
  const tableCenter = wrap.querySelector('.nr-table__center');
  const addBox = wrap.querySelector('.nr-guest-add');
  const input = addBox.querySelector('input');

  // Whether the name input is unfolded. Held here rather than read back off
  // `addBox.hidden`, because the „+" seat is re-created on every render and has
  // to be given the current state — see `.claude/rules/hidden-attribute-vs-display-rule.md`
  // for why the attribute is not the thing to reason from.
  let adding = false;

  const changed = () => {
    render();
    if (onChange) onChange();
  };

  // A guest may be added while the ring is at the cap only if the „+" seat is
  // there at all, which is what enforces MAX_SESSION_GUESTS: the seat is simply
  // not rendered at the cap, so `startSession.toast.guestMax` is unreachable and
  // there is no second copy of the limit to drift.
  const canAdd = () => guestList.guests.length < MAX_SESSION_GUESTS;

  const closeAdd = (refocus) => {
    adding = false;
    addBox.hidden = true;
    input.value = '';
    const seat = table.querySelector('.nr-seat--add');
    if (seat) seat.setAttribute('aria-expanded', 'false');
    if (refocus && seat) seat.focus();
  };

  const submit = () => {
    const name = input.value.trim();
    if (!name) return toast(t('startSession.toast.guestName'));
    guestList.add(name);
    input.value = '';
    // Stay open: adding two guests in a row is the normal case, and re-opening
    // the input for the second one would cost a tap the old field never did.
    // The „+" seat has moved by now (the ring grew), so focus stays in the input
    // rather than chasing it. `render()` folds the box away by itself once the
    // cap is reached, since the seat it belongs to is gone.
    changed();
    if (!addBox.hidden) input.focus();
  };

  // The ring is rebuilt whole on every change, so a removal from the middle can
  // never leave a seat holding a stale index — the same reason the guest chips
  // were re-rendered whole before #1016.
  function render() {
    /* The ring is rebuilt whole, so the button that was just clicked is about to
       be destroyed — and with it the focus a keyboard user had. Remember which
       seat held it and put it back below.

       `table.contains` is a guard NO TEST HOLDS, measured: every render today is
       either detached (the first one, before the ring is mounted — `focus()` on
       a detached element is a no-op) or started by a seat click, so focus is
       always either nowhere or already in this ring. It is here for the two
       shapes that would be observable if either came back: a render started from
       the name input, which is a sibling and must keep its focus; and a second
       ring in the document at once — the direct-play sheet opens over the setup
       screen, and both would match `[data-seat="m:<id>"]` for the same member. */
    const hadFocus = table.contains(document.activeElement)
      ? document.activeElement.closest('.nr-seat')?.dataset.seat
      : null;
    table.querySelectorAll('.nr-seat').forEach((el) => el.remove());
    const guests = guestList.guests;
    tableCenter.textContent = tn(joining.size + guests.length,
      'startSession.tableCountOne', 'startSession.tableCount');

    /* Percentages of the table's own box, not pixels (#1015): `.nr-table` is
       fluid on the session setup screen (`--ring-w`) while keeping the 280x240
       aspect ratio these numbers were derived from, so a seat placed in px would
       stay on a 280px circle inside a 360px ring. 140/280, 118/240, 112/280,
       92/240 — pixel-identical at the 280px default.
       The avatar itself does NOT scale (46px, and the name under it is type), so
       the two half-avatar corrections below stay absolute: `margin-left: -32px`
       in the stylesheet, and the 23px lifted off `top` here. */
    const cx = 50, cy = 49.1667, rx = 40, ry = 38.3333;
    // Members, then guests, then the „+" seat — the same order the team picker
    // lists people in, and the order the stored session resolves them in
    // (sessionPeople). The angles run over the TOTAL, so adding a guest re-spaces
    // the whole ring rather than squeezing them in beside the last member.
    const total = activeMembers(round).length + guests.length + (canAdd() ? 1 : 0);
    let slot = 0;
    const place = (seat, key) => {
      seat.dataset.seat = key;
      const angle = ((-90 + (slot * 360) / total) * Math.PI) / 180;
      slot++;
      seat.style.left = (cx + rx * Math.cos(angle)).toFixed(3) + '%';
      seat.style.top = `calc(${(cy + ry * Math.sin(angle)).toFixed(3)}% - 23px)`;
      table.appendChild(seat);
    };

    // Retired members are off the seating list (#1006).
    activeMembers(round).forEach((m) => {
      const joined = joining.has(m.id);
      // aria-pressed carries the in/out state (#145). Without it the seat is
      // announced as a bare name and whether that member is playing tonight is
      // conveyed by color and a "+" glyph alone — unusable without sight, on the
      // control that decides who is in the session.
      const seat = h(`<button type="button" class="nr-seat${joined ? '' : ' nr-seat--out'}"
           aria-pressed="${joined}" title="${esc(m.name)}">
           <span class="nr-seat__avatar"${joined ? ` style="background:${memberColor(round, m.id)}"` : ''}>${
             joined ? avatarFace(initials(m.name), { userId: m.userId }) : '<i class="ti ti-plus" aria-hidden="true"></i>'
           }</span>
           <span class="nr-seat__name">${esc(m.name)}</span>
         </button>`);
      seat.addEventListener('click', () => {
        if (joining.has(m.id)) {
          if (joining.size === 1) return toast(t('startSession.toast.noMembers'));
          joining.delete(m.id);
        } else {
          joining.add(m.id);
        }
        changed();
      });
      place(seat, 'm:' + m.id);
    });

    guests.forEach((name, i) => {
      const key = guestList.guestKeys[i];
      /* The „(Gast)" marker is its OWN line, not a suffix on the name: the same
         measurement that gave the owner marker `.nr-seat__you` applies here —
         `.nr-seat__name` is 64px with an ellipsis, so „Anna (Gast)" would clip
         the marker away entirely, which is the one part that must not be lost
         (.claude/rules/session-guests-are-not-members.md). The button's
         accessible name carries both regardless. */
      const seat = h(`<button type="button" class="nr-seat nr-seat--guest"
           aria-label="${esc(t('startSession.guestRemove', { name }))}"
           title="${esc(t('people.guest', { name }))}">
           <span class="nr-seat__avatar">${esc(initials(name))}</span>
           <span class="nr-seat__name">${esc(name)}</span>
           <span class="nr-seat__guest">${esc(t('startSession.guestSeat'))}</span>
         </button>`);
      seat.addEventListener('click', () => {
        guestList.remove(key);
        // Removing the last guest while the input is open is fine — the „+" seat
        // is back by definition, so the open box still belongs to it.
        changed();
      });
      place(seat, 'g:' + key);
    });

    // Restoring focus has to happen whether or not the „+" seat is rendered, so
    // it is a closure both exits call rather than a line at the end of one.
    const restore = () => {
      if (!hadFocus) return;
      // The seat may be gone — a removed guest — in which case the „+" seat is
      // the honest destination: it is the one that is back BECAUSE of the
      // removal, and it is where the user would go next.
      const again = table.querySelector(`.nr-seat[data-seat="${hadFocus}"]`)
        || table.querySelector('.nr-seat--add');
      if (again) again.focus();
    };

    if (!canAdd()) {
      if (adding) closeAdd(false);
      restore();
      return;
    }
    const add = h(`<button type="button" class="nr-seat nr-seat--empty nr-seat--add"
         aria-expanded="${adding}" aria-controls="${addId}"
         aria-label="${esc(t('startSession.guestAddTitle'))}"
         title="${esc(t('startSession.guestAddTitle'))}">
         <span class="nr-seat__avatar"><i class="ti ti-plus" aria-hidden="true"></i></span>
         <span class="nr-seat__name">${esc(t('startSession.guestSeat'))}</span>
       </button>`);
    add.addEventListener('click', () => {
      if (adding) return closeAdd(true);
      adding = true;
      addBox.hidden = false;
      add.setAttribute('aria-expanded', 'true');
      input.focus();
    });
    place(add, 'add');
    restore();
  }

  addBox.querySelector('button').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    // Escape belongs to the input while it is open. What keeps the direct-play
    // sheet from closing around it is the sheet ASKING `isAddingGuest()` before
    // it dismisses — measured: deleting that one line reddens the spec, while
    // deleting the `stopPropagation()` below changes nothing. It cannot: the
    // sheet's handler sits on `document` in the CAPTURE phase, so it has already
    // run by the time this one does. Same deferral the two lookup sheets use
    // (.claude/rules/lookup-menu-keyboard-combobox.md §1). The `stopPropagation`
    // stays as the guard for a future ancestor handler that listens on the way
    // back UP — nothing does today, which is why no test can hold it.
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAdd(true); }
  });

  render();
  // What a sheet asks before letting Escape dismiss it.
  wrap.isAddingGuest = () => adding;
  return wrap;
}
