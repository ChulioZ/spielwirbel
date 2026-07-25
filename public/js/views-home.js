/* Spielwirbel – views: home (lobby), new round.
   Part of the frontend; all files share one global script scope. */

// =================== Home: lobby ===================

async function showHome() {
  currentView = () => showHome();
  syncUrl('/');
  setContext(''); // home: no round context
  applyBackground(null); // home: default background
  app.innerHTML = '<p class="muted">…</p>';
  // SWR: renders instantly from the cached summary (a background refresh
  // re-invokes showHome via currentView if anything changed).
  const rounds = await fetchRoundList();

  app.innerHTML = '';
  app.appendChild(
    h(`<div class="lobby-head">
         <h1>${esc(t('home.greeting'))}</h1>
         <div class="muted lobby-head__sub">${esc(t('home.sub'))}</div>
       </div>`)
  );

  if (rounds.length === 0) {
    // A logged-in account with no rounds yet gets a first-run welcome (#138);
    // the shared-password / legacy world keeps the neutral empty state.
    const onboard = accountsActive() && isLoggedIn();
    app.appendChild(
      h(`<div class="empty"><p>${esc(t(onboard ? 'home.onboard.title' : 'home.empty.title'))}</p>
           <p class="muted">${esc(t(onboard ? 'home.onboard.sub' : 'home.empty.sub'))}</p></div>`)
    );
  }

  const list = h('<div class="lobby-list"></div>');
  rounds.forEach((r) => {
    // Members ride along in the summary so the avatars get their colors.
    const stack = r.members
      .map(
        (m) =>
          `<span class="avatar" style="background:${memberColor(r, m.id)}" title="${esc(m.name)}">${esc(initials(m.name))}</span>`
      )
      .join('');

    let lastLine = '';
    if (r.lastPlayed) {
      const lp = r.lastPlayed;
      const text = lp.winnerNames.length
        ? t(lp.winnerNames.length === 1 ? 'home.lastPlayedWonOne' : 'home.lastPlayedWonMany', {
            game: lp.gameTitle,
            names: joinNames(lp.winnerNames),
          })
        : t('home.lastPlayed', { game: lp.gameTitle });
      lastLine = `<span class="round-card__last"><i class="ti ti-trophy" aria-hidden="true"></i>${esc(text)}</span>`;
    }

    const card = h(`<a class="round-card">
         <span class="round-card__emblem" style="background:${themeAccent(r.background)}"><i class="ti ti-tornado" aria-hidden="true"></i></span>
         <span class="round-card__body">
           <span class="round-card__name">${esc(r.name)}${r.shared ? ` <span class="round-card__shared"><i class="ti ti-users" aria-hidden="true"></i> ${esc(t('home.shared'))}</span>` : ''}</span>
           <span class="round-card__meta">
             <span class="avatar-stack">${stack}</span>
             <span class="stat-chip"><i class="ti ti-cards" aria-hidden="true"></i>${esc(tn(r.gameCount, 'home.chip.gamesOne', 'home.chip.games'))}</span>
             <span class="stat-chip"><i class="ti ti-confetti" aria-hidden="true"></i>${esc(tn(r.playedCount, 'home.chip.sessionsOne', 'home.chip.sessions'))}</span>
           </span>
           ${lastLine}
         </span>
         <i class="ti ti-chevron-right round-card__chev" aria-hidden="true"></i>
       </a>`);
    navLink(card, roundPath(r.id), () => showRound(r.id));
    list.appendChild(card);
  });

  const newCard = h(
    `<a class="round-card round-card--new"><i class="ti ti-plus" aria-hidden="true"></i>${esc(t('home.newRound'))}</a>`
  );
  navLink(newCard, '/round/new', () => showNewRound());
  list.appendChild(newCard);
  app.appendChild(list);

  // Compact Freundeskreis feed (#325): a placeholder the friends module fills in
  // (only in accounts mode with >= 1 friend) or removes. Not awaited — it must not
  // delay the (SWR-instant) home render, and it self-guards against a re-render.
  if (accountsActive() && isLoggedIn()) {
    const friends = h('<section class="home-friends" id="homeFriends"></section>');
    app.appendChild(friends);
    renderHomeFriends(friends);
  }
}

// =================== New round ===================

async function showNewRound() {
  currentView = () => showNewRound();
  syncUrl('/round/new');
  setContext(''); // creating a round, not inside one yet
  applyBackground(null);
  app.innerHTML = '<p class="muted">…</p>';

  // Rounds whose games list can be copied over. rerender:false — this screen
  // is a form, and a background re-render would wipe what the user typed; a
  // moments-stale import dropdown is harmless.
  const allRounds = await fetchRoundList({ rerender: false });
  const importable = allRounds.filter((r) => r.gameCount > 0);
  const importField = importable.length
    ? `<div class="field import-card">
        <i class="ti ti-copy import-card__icon" aria-hidden="true"></i>
        <div class="import-card__body">
          <label for="importSel">${esc(t('newRound.importLabel'))}</label>
          <select id="importSel" class="select">
            <option value="">${esc(t('newRound.importNone'))}</option>
            ${importable.map((r) => `<option value="${r.id}">${esc(t('newRound.importOption', { name: r.name, n: r.gameCount }))}</option>`).join('')}
          </select>
          <div class="muted import-card__note">${esc(t('newRound.importNote'))}</div>
        </div>
      </div>`
    : '';

  app.innerHTML = '';
  app.appendChild(h(`<div class="page-head"><h1>${esc(t('newRound.title'))}</h1></div>`));

  const form = h(`<div>
      <div class="field">
        <label for="roundName">${esc(t('newRound.nameLabel'))}</label>
        <input id="roundName" class="input" placeholder="${esc(t('newRound.namePlaceholder'))}" />
      </div>
      <div class="field">
        <label>${esc(t('newRound.membersLabel'))}</label>
        <div class="nr-table">
          <div class="nr-table__ring"></div>
          <div class="nr-table__center"></div>
        </div>
        <div class="row">
          <input id="memberInput" class="input" placeholder="${esc(t('newRound.memberPlaceholder'))}" />
          <button id="addMember" class="btn">${esc(t('newRound.add'))}</button>
        </div>
      </div>
      ${/* Outside the .field on purpose: `.field label` is (0,1,1) and would win — see label-rows-lose-to-field-label.md */ ''}
      ${isLoggedIn() ? `<label class="nr-owner"><input type="checkbox" id="ownerSeat" checked /> <span>${esc(t('newRound.ownerSeatPlaying'))}</span></label>` : ''}
      ${importField}
      <div class="toolbar">
        <button id="createRound" class="btn btn--primary btn--lg"><i class="ti ti-sparkles" aria-hidden="true"></i> ${esc(t('newRound.create'))}</button>
      </div>
    </div>`);
  app.appendChild(form);

  const members = [];
  const nameInput = form.querySelector('#roundName');
  const memberInput = form.querySelector('#memberInput');
  const table = form.querySelector('.nr-table');
  const tableCenter = form.querySelector('.nr-table__center');
  // #421: in accounts mode the table starts with one seat already taken — yours.
  // The typed names are the OTHER players. Removable (there is no add-member
  // route after creation, so an owner who doesn't play must not be stuck with a
  // phantom member) and restorable via the checkbox.
  const ownerBox = form.querySelector('#ownerSeat');
  const hasOwnerSeat = () => !!ownerBox && ownerBox.checked;

  // Seats sit evenly on an ellipse around the table: the owner's seat (if any)
  // first, then all typed members, plus one dashed empty seat that focuses the
  // name input.
  function renderMembers() {
    table.querySelectorAll('.nr-seat').forEach((el) => el.remove());
    // Each entry: { name, owner } — the owner seat is index 0 exactly as the
    // server prepends it, so the position-derived avatar colours line up with
    // what the round will actually render.
    const taken = [
      // 'Gast' matches the server's own fallback, so the preview names the seat
      // exactly what createRound will store.
      ...(hasOwnerSeat() ? [{ name: currentUsername() || 'Gast', owner: true }] : []),
      ...members.map((nm) => ({ name: nm, owner: false })),
    ];
    tableCenter.textContent = taken.length
      ? t('newRound.tableCount', { n: taken.length })
      : t('newRound.tableEmpty');
    const cx = 140, cy = 118, rx = 112, ry = 92;
    const seats = taken.length + 1; // + empty seat
    for (let i = 0; i < seats; i++) {
      const angle = ((-90 + (i * 360) / seats) * Math.PI) / 180;
      const x = cx + rx * Math.cos(angle);
      const y = cy + ry * Math.sin(angle);
      const isEmpty = i === taken.length;
      const seat = isEmpty
        ? h(`<button type="button" class="nr-seat nr-seat--empty" title="${esc(t('newRound.add'))}">
               <span class="nr-seat__avatar"><i class="ti ti-plus" aria-hidden="true"></i></span>
             </button>`)
        : h(`<button type="button" class="nr-seat" title="${esc(t('newRound.removeHint'))}">
               <span class="nr-seat__avatar" style="background:${MEMBER_COLORS[i % MEMBER_COLORS.length]}">${esc(initials(taken[i].name))}</span>
               <span class="nr-seat__name">${esc(taken[i].name)}</span>
               ${taken[i].owner ? `<span class="nr-seat__you">${esc(t('newRound.ownerSeatYou'))}</span>` : ''}
             </button>`);
      seat.style.left = x + 'px';
      seat.style.top = y - 23 + 'px';
      if (isEmpty) {
        seat.addEventListener('click', () => memberInput.focus());
      } else if (taken[i].owner) {
        // The seat is the affordance, the checkbox is the undo — shipping one
        // without the other leaves the seat unrecoverable.
        seat.addEventListener('click', () => { ownerBox.checked = false; renderMembers(); });
      } else {
        const idx = i - (hasOwnerSeat() ? 1 : 0);
        seat.addEventListener('click', () => {
          members.splice(idx, 1);
          renderMembers();
        });
      }
      table.appendChild(seat);
    }
  }
  renderMembers();
  if (ownerBox) ownerBox.addEventListener('change', renderMembers);
  function addMember() {
    const v = memberInput.value.trim();
    if (!v) return;
    members.push(v);
    memberInput.value = '';
    memberInput.focus();
    renderMembers();
  }
  form.querySelector('#addMember').addEventListener('click', addMember);
  memberInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addMember(); }
  });

  form.querySelector('#createRound').addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return toast(t('newRound.toast.needName'));
    // Relaxed with the server (#421): only a genuinely EMPTY table is refused.
    // Guarding on typed members alone would block the solo round the API allows.
    if (members.length === 0 && !hasOwnerSeat()) return toast(t('newRound.toast.needMember'));
    const importSel = form.querySelector('#importSel');
    const body = { name, members };
    // Omit the flag when the seat is wanted — the server defaults to seating you.
    if (ownerBox && !ownerBox.checked) body.ownerSeat = false;
    if (importSel && importSel.value) body.importFromRoundId = importSel.value;
    try {
      const round = await api('POST', '/api/rounds', body);
      toast(body.importFromRoundId ? t('newRound.toast.createdImported') : t('newRound.toast.created'));
      showRound(round.id);
    } catch (e) { toast(e.message === 'quota_rounds' ? t('newRound.toast.quota') : e.message); }
  });

  nameInput.focus();
}
