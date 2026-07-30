/* Spielwirbel – the session team field (#575): group two or more of the people
   joining a session into a party that plays — and wins — together.

   Shared by the two screens that start a session, exactly like the guest field:
   the draw setup (views-session.js) and the direct-play sheet
   (views-round-lookup.js). Frontend shared-scope script; load order: see
   index.html (after guest-picker.js, before the views that mount it).

   Members and guests mix freely — the whole point of the feature is that a
   member and a visitor can play as a pair — so this file never distinguishes
   the two beyond the guest marker personLabel() already adds. */

'use strict';

// A person in the picker is addressed by a TOKEN, not by an id: a guest has no
// id yet at this point (the server mints it at session start), and their
// position in the guest list shifts whenever an earlier guest is removed. So a
// member is 'm:<memberId>' and a guest is 'g:<key>' against the guest picker's
// own stable keys, and positions are resolved once, at submit time.
const TEAM_TOKEN_MEMBER = 'm:';
const TEAM_TOKEN_GUEST = 'g:';

// Build the whole `.field`, ready to drop in wherever the caller mounted a
// placeholder.
//
//  - `joining` is the live Set of member ids from renderSeatPicker, read (never
//    mutated) so a member taken out of the session leaves their team too.
//  - `guestPicker` is the renderGuestPicker element, for its live `guests` and
//    `guestKeys` arrays.
//  - `note` is the hint under the field. A parameter for the same reason the
//    guest picker's is: only the draw flow filters its pool by the number of
//    parties, so only there may the hint say so.
//  - `onChange` fires after a team is formed or dissolved, so the caller can
//    refresh whatever follows from the party count (the draw's pool preview).
//
// The caller drives it back through `el.refreshTeams()` whenever the people
// change — the seat picker and the guest list both live outside this field, in
// the element-with-a-method shape renderSeatPicker and renderGuestPicker use.
function renderTeamPicker(round, joining, guestPicker, note, onChange) {
  const field = h(`<div class="field">
      <label>${esc(t('startSession.teamsLabel'))}</label>
      <div class="team-list" id="teamList"></div>
      <div class="team-pool" id="teamPool"></div>
      <div class="row">
        <button type="button" class="btn" id="teamMake">${iconText('ti-users', t('startSession.teamMake'))}</button>
      </div>
      <div class="muted field__hint">${esc(note)}</div>
    </div>`);

  // Formed teams, each an array of tokens. Order is the order they were formed.
  const teams = [];
  // Tokens ticked in the pool, waiting to become a team.
  const selected = new Set();
  const list = field.querySelector('#teamList');
  const pool = field.querySelector('#teamPool');
  const makeBtn = field.querySelector('#teamMake');

  // Everyone at the table right now, in the same order the session will resolve
  // them: the members who are in, then the guests.
  const people = () => {
    const out = round.members
      .filter((m) => joining.has(m.id))
      .map((m) => ({ token: TEAM_TOKEN_MEMBER + m.id, label: m.name }));
    guestPicker.guests.forEach((name, i) => {
      out.push({
        token: TEAM_TOKEN_GUEST + guestPicker.guestKeys[i],
        label: t('people.guest', { name }),
      });
    });
    return out;
  };

  const labelOf = (all, token) => (all.find((p) => p.token === token) || {}).label;

  // Same join as partyName() produces for a stored session, so the name a team
  // is formed under is the name it keeps on every later screen.
  const nameOf = (all, tokens) => {
    const names = tokens.map((tk) => labelOf(all, tk)).filter(Boolean);
    if (names.length <= 1) return names[0] || '';
    return names.slice(0, -1).join(', ') + ' ' + t('list.and') + ' ' + names[names.length - 1];
  };

  // Re-rendered whole on every change, and it starts by DROPPING what is no
  // longer there: a member taken out of the session, or a removed guest, must
  // leave their team behind — and a team that falls below MIN_TEAM_SIZE is
  // dissolved rather than kept as a one-person "team", which the server and the
  // resolver would both refuse anyway.
  const render = () => {
    const all = people();
    const live = new Set(all.map((p) => p.token));
    for (let i = teams.length - 1; i >= 0; i--) {
      teams[i] = teams[i].filter((tk) => live.has(tk));
      if (teams[i].length < MIN_TEAM_SIZE) teams.splice(i, 1);
    }
    [...selected].forEach((tk) => { if (!live.has(tk)) selected.delete(tk); });

    const teamed = new Set();
    teams.forEach((tokens) => tokens.forEach((tk) => teamed.add(tk)));

    list.innerHTML = '';
    teams.forEach((tokens, i) => {
      const name = nameOf(all, tokens);
      const card = h(`<div class="team-card">
           <span class="team-card__name">${iconText('ti-users', name)}</span>
           <button type="button" class="team-card__del" aria-label="${esc(t('startSession.teamDissolve', { name }))}"><i class="ti ti-x" aria-hidden="true"></i></button>
         </div>`);
      card.querySelector('.team-card__del').addEventListener('click', () => {
        teams.splice(i, 1);
        render();
        if (onChange) onChange();
      });
      list.appendChild(card);
    });

    // The pool holds everyone who is not in a team yet. Someone in a team is
    // not offered again — a person belongs to at most one party.
    pool.innerHTML = '';
    const free = all.filter((p) => !teamed.has(p.token));
    free.forEach((p) => {
      const on = selected.has(p.token);
      // aria-pressed carries the tick: the chip's only other cue is colour, and
      // this is the control that decides who plays with whom (#145).
      const chip = h(`<button type="button" class="team-chip${on ? ' is-selected' : ''}" aria-pressed="${on}">${esc(p.label)}</button>`);
      chip.addEventListener('click', () => {
        if (selected.has(p.token)) selected.delete(p.token);
        else selected.add(p.token);
        render();
      });
      pool.appendChild(chip);
    });

    makeBtn.disabled = selected.size < MIN_TEAM_SIZE;
    // With nobody left to group, the pool row would be an empty gap.
    pool.hidden = free.length === 0;
  };

  makeBtn.addEventListener('click', () => {
    if (selected.size < MIN_TEAM_SIZE) return toast(t('startSession.toast.teamMin', { n: MIN_TEAM_SIZE }));
    // Keep the table's own order inside a team, so the derived name reads the
    // same as it will once the session is stored.
    const order = people().map((p) => p.token);
    teams.push(order.filter((tk) => selected.has(tk)));
    selected.clear();
    render();
    if (onChange) onChange();
  });

  render();

  field.refreshTeams = render;
  field.teamCount = () => teams.length;
  // How many people are in a team at all — the caller subtracts this and adds
  // teamCount() to turn a headcount into the number of playing parties.
  field.teamedPeopleCount = () => teams.reduce((n, tokens) => n + tokens.length, 0);
  // Wire format (#575): member ids plus guest POSITIONS, resolved from the keys
  // only now, because the server mints guest ids from the very same list in the
  // same request.
  field.teamPayload = () =>
    teams.map((tokens) => ({
      memberIds: tokens
        .filter((tk) => tk.startsWith(TEAM_TOKEN_MEMBER))
        .map((tk) => tk.slice(TEAM_TOKEN_MEMBER.length)),
      guestIndices: tokens
        .filter((tk) => tk.startsWith(TEAM_TOKEN_GUEST))
        .map((tk) => guestPicker.guestKeys.indexOf(tk.slice(TEAM_TOKEN_GUEST.length)))
        .filter((i) => i >= 0),
    }));
  return field;
}
