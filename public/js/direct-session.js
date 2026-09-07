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
        <div id="guestMount"></div>
        <div id="teamMount"></div>
        <div class="toolbar sheet__actions">
          <button id="startDirect" class="btn btn--primary btn--lg"><i class="ti ti-player-play" aria-hidden="true"></i> ${esc(t('directPlay.start'))}</button>
        </div>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  const joining = new Set(round.members.map((m) => m.id));
  // Guests (#532). The field is always visible, like the setup screen's — the
  // sheet roughly doubles in height, which is the accepted price of the two ways
  // into a session looking the same. There is no voting phase here, so a guest
  // is a participation record and, above all, a pickable winner: the results
  // screen's winner chips come from sessionPeople(), members ∪ guests.
  // No pool preview to refresh either (direct-pick consults no player range),
  // so the only thing following the count is the table's centre.
  const guestPicker = renderGuestPicker(t('directPlay.guestsNote'), () => {
    seatTable.refreshSeats();
    teamPicker.refreshTeams();
  });
  // Teams (#575). Nothing here is filtered by a player range — direct-pick
  // consults none — so a team changes no pool: it is here so a team that wins
  // can be recorded in one tap, the same argument that brought guests to this
  // sheet in #532. Hence its own note, which promises no filtering.
  const teamPicker = renderTeamPicker(round, joining, guestPicker, t('directPlay.teamsNote'), null);
  const seatTable = renderSeatPicker(round, joining, () => teamPicker.refreshTeams(), () => guestPicker.guests.length);
  sheet.querySelector('#seatMount').replaceWith(seatTable);
  sheet.querySelector('#guestMount').replaceWith(guestPicker);
  sheet.querySelector('#teamMount').replaceWith(teamPicker);

  const dismiss = () => closeSheet();
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
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
        guests: guestPicker.guests, // names only; the server mints the ids (#458)
        teams: teamPicker.teamPayload(), // guests by POSITION in `guests` (#575)
      });
      closeSheet(() => showResults(round, data.session, data.games));
    } catch (e) { toast(e.message); }
  });
}
