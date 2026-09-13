'use strict';

/* „Jetzt spielen" — start a session for one specific game, with no vote and no
   draw, landing straight on the results screen with that game already chosen.

   Split out of views-round-lookup.js by #956, where it was the one section that
   had nothing to do with looking a game up: its own header said so, and it is
   opened from the game detail page and the Pokale cards rather than from either
   lookup sheet. It is a session-starting screen, so it reads views-session.js's
   showResults and the shared guest/team pickers. No `module.exports`: DOM. */

// Bottom sheet: pick who joins, then start a session for one specific game with
// no vote and no draw, landing straight on the results screen with that game
// already chosen. Opened from the game detail page and the Pokale cards.
function startDirectSession(round, game) {
  const label = t('directPlay.title', { title: game.title });
  const backdrop = h(`<div class="sheet-backdrop">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">
        <div class="sheet__head">
          <h2>${esc(label)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="field">
          <label>${esc(t('startSession.membersLabel'))}</label>
          <div id="seatMount"></div>
        </div>
        <div id="addonMount"></div>
        <div class="toolbar sheet__actions">
          <button id="startDirect" class="btn btn--primary btn--lg"><i class="ti ti-player-play" aria-hidden="true"></i> ${esc(t('directPlay.start'))}</button>
        </div>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  // Retired members are not offered a seat (#1006); their history is untouched.
  const joining = new Set(activeMembers(round).map((m) => m.id));
  // The same add-on row the setup screen uses (#1015), behind the same chip —
  // the one that still applies here, since nothing is drawn (no owner clause, no
  // multi-table). Both fields used to stand open, which roughly doubled the
  // sheet's height for an evening with neither; the two ways into a session
  // still look the same, which was the point of carrying them here at all.
  //
  // Guests (#532): there is no voting phase, so a guest is a participation
  // record and, above all, a pickable winner — the results screen's winner chips
  // come from sessionPeople(), members ∪ guests. Since #1016 they sit on the seat
  // ring rather than behind a chip of their own, so the note below is the only
  // thing left saying that these guests — unlike the draw flow's — never vote.
  const addons = renderSetupAddons(t('startSession.addon.label'));
  const guestList = createGuestList(t('directPlay.guestsNote'));
  // Teams (#575). Nothing here is filtered by a player range — direct-pick
  // consults none — so a team changes no pool: it is here so a team that wins
  // can be recorded in one tap, the same argument that brought guests to this
  // sheet in #532. Hence its own note, which promises no filtering.
  const teamPicker = renderTeamPicker(round, joining, guestList, t('directPlay.teamsNote'), () => addons.relabelAddons());
  const seatTable = renderSeatPicker(round, joining, () => {
    teamPicker.refreshTeams();
    addons.relabelAddons();
  }, guestList);
  sheet.querySelector('#seatMount').replaceWith(seatTable);
  addons.addAddon({
    key: 'team',
    icon: 'ti-users',
    el: teamPicker,
    label: () => (teamPicker.teamCount()
      ? tn(teamPicker.teamCount(), 'startSession.addon.teamsOne', 'startSession.addon.teams')
      : t('startSession.teamMake')),
    on: () => teamPicker.teamCount() > 0,
  });
  sheet.querySelector('#addonMount').replaceWith(addons);

  const dismiss = () => closeSheet();
  // The ring's guest-name input owns Escape while it is open (#1016). This
  // handler sits on `document` in the CAPTURE phase, so without the deferral it
  // would run first and close the whole sheet, taking the half-typed name with
  // it — the same way the two lookup sheets ask `lookup.isOpen()`
  // (.claude/rules/lookup-menu-keyboard-combobox.md §1).
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (seatTable.isAddingGuest()) return;
    dismiss();
  };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) dismiss();
  });
  sheet.querySelector('.sheet__close').addEventListener('click', dismiss);

  sheet.querySelector('#startDirect').addEventListener('click', async () => {
    if (joining.size === 0) return toast(t('startSession.toast.noMembers'));
    try {
      const data = await api('POST', `/api/rounds/${round.id}/sessions`, {
        gameId: game.id,
        memberIds: [...joining],
        guests: guestList.guests, // names only; the server mints the ids (#458)
        teams: teamPicker.teamPayload(), // guests by POSITION in `guests` (#575)
      });
      closeSheet(() => showResults(round, data.session, data.games));
    } catch (e) { toast(e.message); }
  });
}
