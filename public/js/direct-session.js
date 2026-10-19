'use strict';

/* „Jetzt spielen" — start a session for one specific game, with no vote and no
   draw, landing straight on the results screen with that game already chosen.

   Split out of views-round-lookup.js by #956, where it was the one section that
   had nothing to do with looking a game up: its own header said so, and it is
   opened from the game detail page and the Pokale cards rather than from either
   lookup sheet. It is a session-starting screen, so it reads views-session.js's
   showResults and the shared guest/team pickers. Since #1682 it also holds the
   game picker in front of the sheet and the Start tab's button that opens it.
   No `module.exports`: DOM. */

// Bottom sheet: pick who joins, then start a session for one specific game with
// no vote and no draw, landing straight on the results screen with that game
// already chosen. Opened from the game detail page and the Pokale cards — and,
// with `opts.dayKey` set to yesterday, from the Chronik's „Session nachtragen"
// (#1616).
function startDirectSession(round, game, opts = {}) {
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
        <div id="playedOnMount"></div>
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
  // „Wann?" (#1616): today by default, so playing tonight is exactly the sheet
  // it always was. A past day logs the evening instead — created finished on
  // that day, with no running session in between. So does a TIME (#1629), on
  // any day: „we played at 18:00" is an evening that already happened.
  const dateField = playedOnField(opts.dayKey);
  sheet.querySelector('#playedOnMount').replaceWith(dateField);
  const logs = () => isPastDay(dateField.value()) || !!dateField.time();
  const relabel = () => {
    sheet.querySelector('#startDirect').innerHTML = logs()
      ? `<i class="ti ti-calendar-plus" aria-hidden="true"></i> ${esc(t('directPlay.log'))}`
      : `<i class="ti ti-player-play" aria-hidden="true"></i> ${esc(t('directPlay.start'))}`;
  };
  [dateField.input, dateField.timeInput].forEach((el) => {
    el.addEventListener('change', relabel);
    el.addEventListener('input', relabel);
  });
  relabel();

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
    const picked = readPlayedOn(dateField);
    if (!picked) return;
    // Only a PAST day or an entered time is sent: today with no time stays the
    // ordinary direct play, stamped now by the server, with its feed line and
    // its running results screen. `dateOnly` says whether the instant is the
    // 20:00 stand-in (#1629).
    const playedOn = isPastDay(picked.day) || picked.time
      ? playedOnInstant(picked.day, new Date(), picked.time)
      : null;
    try {
      const data = await api('POST', `/api/rounds/${round.id}/sessions`, {
        gameId: game.id,
        memberIds: [...joining],
        guests: guestList.guests, // names only; the server mints the ids (#458)
        teams: teamPicker.teamPayload(), // guests by POSITION in `guests` (#575)
        ...(playedOn ? { playedOn, dateOnly: !picked.time } : {}),
      });
      // A logged evening lands with the winner picker OPEN: the one question
      // left about it is who won.
      if (playedOn) openResultPickerOnce(data.session.id);
      closeSheet(() => showResults(round, data.session, data.games));
    } catch (e) { toast(e.message, { tone: 'error' }); }
  });
}

/* Which game? — the picker in front of the direct-play sheet (#1682). Opened
   by the Start tab's „Jetzt spielen" and by the Chronik's „Session nachtragen"
   (`opts.play` carries that one's `dayKey`), so the two cannot drift apart.

   One <button> per game, because picking IS the action — there is no OK step.
   The list is the shelf (the same isActiveGame predicate the draw uses) plus
   the round's earlier guest games, the one off-shelf state the server's direct
   pick admits. The last row is always „Ein Spiel, das ihr nicht habt": the
   add-game form in its guest mode with no guest name, which creates — or, by
   title or provider id, REUSES — a guest game and hands it to the sheet. It
   stays visible under an empty search on purpose: „not found" is exactly when
   it is wanted, and it takes the typed query as its title.

   A guest game created here and then abandoned in the direct-play sheet stays
   an unused guest game: it is listed under „Gastspiele", deletable there, and
   reused the next time the same title is brought (#1682, "Abandoned start"). */
function showDirectPlayPicker(round, { title = t('directPlay.pickTitle'), hint = '', play = {} } = {}) {
  const shelf = round.games.filter(isActiveGame);
  const guests = round.games.filter((g) => g.guestGame === true);
  const games = [...shelf, ...guests].sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const backdrop = h(`<div class="sheet-backdrop">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet__head">
          <h2>${esc(title)}</h2>
          <button class="sheet__close" type="button" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        ${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
        <div class="field"${games.length ? '' : ' hidden'}>
          <label for="playPickSearch">${esc(t('chronik.log.search'))}</label>
          <input id="playPickSearch" class="input" type="search" autocomplete="off" autocorrect="off" spellcheck="false">
        </div>
        <ul class="play-pick" role="list"></ul>
        <p class="muted play-pick__empty" hidden>${esc(t('chronik.log.none'))}</p>
        <button type="button" class="ds-row play-pick__row play-pick__guest">
          <span class="ds-row__main"><i class="ti ti-plus" aria-hidden="true"></i> ${esc(t('directPlay.notOwned'))}
            <span class="play-pick__sub muted">${esc(t('directPlay.notOwnedHint'))}</span></span>
          <span class="ds-row__meta"><i class="ti ti-chevron-right" aria-hidden="true"></i></span>
        </button>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  const list = sheet.querySelector('.play-pick');
  const empty = sheet.querySelector('.play-pick__empty');
  const search = sheet.querySelector('#playPickSearch');

  games.forEach((g) => {
    const marker = g.guestGame === true ? `<span class="play-pick__tag">${esc(t('guestGames.marker'))}</span>` : '';
    const li = h(`<li><button type="button" class="ds-row play-pick__row" data-title="${esc(String(g.title).toLowerCase())}">
        <span class="ds-row__main">${esc(g.title)}</span>
        <span class="ds-row__meta">${marker}<i class="ti ti-chevron-right" aria-hidden="true"></i></span>
      </button></li>`);
    li.querySelector('button').addEventListener('click', () => {
      closeSheet(() => startDirectSession(round, g, play));
    });
    list.appendChild(li);
  });
  const filter = () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    list.querySelectorAll('li').forEach((li) => {
      const hit = !q || li.firstElementChild.dataset.title.includes(q);
      li.hidden = !hit;
      if (hit) shown++;
    });
    // An empty round has no list to come up empty — only the guest row.
    empty.hidden = shown > 0 || games.length === 0;
  };
  search.addEventListener('input', filter);
  filter();

  // The add-game form REPLACES this sheet and the direct-play sheet replaces
  // the form, each reusing the history marker (openSheet), so Back still
  // dismisses exactly one sheet.
  sheet.querySelector('.play-pick__guest').addEventListener('click', () => {
    showAddGameForm(round, {
      title: search.value.trim(),
      guest: {
        name: null,
        onCreated(game) {
          if (!round.games.some((g) => g.id === game.id)) round.games.push(game);
          startDirectSession(round, game, play);
        },
      },
    });
  });

  document.body.appendChild(backdrop);
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  sheet.querySelector('.sheet__close').addEventListener('click', () => closeSheet());
  (games.length ? search : sheet.querySelector('.play-pick__guest')).focus();
}

/* The Start tab's „Jetzt spielen" (#1682): the SECONDARY way into a session,
   beside „Session wirbeln" in every design, and in the Klassisch rail. Never
   disabled — direct play needs no shelf, so the young-round lock on the draw
   does not apply to it, and an empty round is precisely the one that can only
   play something it does not own. `cls` places it (`hub-play`, `rail__play`).
   The Start tab's copy comes after the CTA and the presets that modify it, so it
   never splits the two, and is `rail-owned` wherever the CTA is: the Klassisch
   rail carries its own copy from 1280px up, and the pane keeping this one would
   leave a lone button where the primary action was. */
function directPlayButton(round, cls) {
  const btn = h(`<button type="button" class="btn ${cls}"><i class="ti ti-player-play" aria-hidden="true"></i>${esc(t('directPlay.button'))}</button>`);
  btn.addEventListener('click', () => showDirectPlayPicker(round));
  return btn;
}
