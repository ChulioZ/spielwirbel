/* Spielwirbel – the session guest field (#458, #532): a label, one removable
   chip per named guest, and a name input that adds on Enter.

   Shared by the two screens that start a session — the draw setup
   (views-session.js) and the direct-play sheet (views-round-lookup.js) — so the
   two ways into a session look the same. Frontend shared-scope script; load
   order: see index.html. */

'use strict';

// Build the whole `.field`, ready to drop in wherever the caller mounted a
// placeholder.
//
//  - `note` is the hint under the input. It is a parameter rather than a fixed
//    key because it differs by screen and one of the wordings would be a lie:
//    the draw flow's guests vote, the direct-play flow's never do (no voting
//    phase — they are there to be recorded as present, and to be pickable as
//    the winner).
//  - `onChange` fires after every add and every removal, so the caller can
//    refresh whatever follows from the player count — the seat picker's centre
//    count on both screens, plus the pool preview in the draw flow.
//
// The live names hang off the returned element as `el.guests`, read at submit
// time, in the same element-with-a-method shape renderSeatPicker uses for
// `refreshSeats`. Only NAMES travel to the server; it mints the ids (#458).
function renderGuestPicker(note, onChange) {
  const field = h(`<div class="field">
      <label for="guestName">${esc(t('startSession.guestsLabel'))}</label>
      <div class="guest-list" id="guestList"></div>
      <div class="row">
        <input id="guestName" class="input" maxlength="${GUEST_NAME_MAX}" placeholder="${esc(t('startSession.guestPlaceholder'))}" />
        <button type="button" class="btn" id="guestAdd">${iconText('ti-plus', t('startSession.guestAdd'))}</button>
      </div>
      <div class="muted field__hint">${esc(note)}</div>
    </div>`);

  const guests = [];
  const list = field.querySelector('#guestList');
  const input = field.querySelector('#guestName');

  // Re-rendered whole on every change (the list is at most MAX_SESSION_GUESTS
  // long), so removing from the middle can't leave a chip holding a stale index.
  const render = () => {
    list.innerHTML = '';
    guests.forEach((name, i) => {
      const chip = h(`<span class="guest-chip">
           <span class="guest-chip__name">${esc(t('people.guest', { name }))}</span>
           <button type="button" class="guest-chip__del" aria-label="${esc(t('startSession.guestRemove', { name }))}"><i class="ti ti-x" aria-hidden="true"></i></button>
         </span>`);
      chip.querySelector('.guest-chip__del').addEventListener('click', () => {
        guests.splice(i, 1);
        render();
        input.focus();
      });
      list.appendChild(chip);
    });
    if (onChange) onChange();
  };

  const add = () => {
    const name = input.value.trim();
    if (!name) return toast(t('startSession.toast.guestName'));
    if (guests.length >= MAX_SESSION_GUESTS)
      return toast(t('startSession.toast.guestMax', { n: MAX_SESSION_GUESTS }));
    guests.push(name);
    input.value = '';
    render();
    input.focus();
  };
  field.querySelector('#guestAdd').addEventListener('click', add);
  // Enter in the name field adds, so a guest can be typed without reaching for
  // the button. Neither screen wraps this in a <form>, so nothing submits.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });

  field.guests = guests;
  return field;
}
