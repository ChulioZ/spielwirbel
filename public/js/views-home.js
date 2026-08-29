/* Spielwirbel – views: home (lobby), new round.
   Part of the frontend; all files share one global script scope. */

// =================== Home: lobby ===================

async function showHome() {
  // In accounts mode a logged-out visitor has no home to render — every read
  // below 401s — so '/' belongs to the marketing landing (#322/#501). This is
  // what makes Back out of /login or /register land on the landing page instead
  // of a screen that immediately bounces to login, and it equally catches the
  // `return showHome()` fallback in showInbox/showFriends/showAccount.
  if (accountsActive() && !isLoggedIn()) return showLanding();
  currentView = () => showHome();
  syncUrl('/');
  setContext(''); // home: no round context
  setDocTitle(t('home.docTitle'));
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

  const resume = renderResumeZone(rounds);
  if (resume) app.appendChild(resume);

  if (rounds.length === 0) {
    // #358: with no rounds the welcome area IS the create-round CTA, and the
    // `.lobby-list` grid is not rendered at all. It used to be a text block with
    // a separate `.round-card--new` card below it — but that card was then the
    // grid's only item, so `auto-fill` packed it into the leftmost track and
    // stranded it ~360px wide against the left edge of an up-to-1800px shell,
    // misaligned with the centred welcome text above it. Merging the two leaves
    // no stray card to pack, rather than fighting the grid over where to put it.
    //
    // A logged-in account with no rounds yet gets a first-run welcome (#138);
    // the shared-password / legacy world keeps the neutral empty state.
    const onboard = accountsActive() && isLoggedIn();
    const cta = h(`<a class="lobby-cta">
         <span class="lobby-cta__icon"><i class="ti ti-plus" aria-hidden="true"></i></span>
         <span class="lobby-cta__title">${esc(t(onboard ? 'home.onboard.title' : 'home.empty.title'))}</span>
         <span class="lobby-cta__sub">${esc(t(onboard ? 'home.onboard.sub' : 'home.empty.sub'))}</span>
         <span class="lobby-cta__action">${esc(t('home.newRound'))}</span>
       </a>`);
    navLink(cta, '/round/new', () => showNewRound());
    app.appendChild(cta);
  } else {
    app.appendChild(renderLobbyList(rounds));
  }

  app.appendChild(renderHomeDash());
}

/* How many resume tickets the screen offers at once, across ALL rounds (#842).
   Separate from the repo's per-round OPEN_SESSIONS_CAP (lib/repo/json.js): that
   one bounds the PAYLOAD, this one bounds the SCREEN. A member of eight rounds
   could otherwise push the round grid below the fold with tickets. */
const HOME_RESUME_CAP = 3;

/* Zone 2: the sessions people are mid-way through, newest first, across every
   round (#842). Above the round grid at every width — a session already running
   is the most actionable thing on the screen, and before this it was reachable
   only by remembering which round it was in and opening that round's hub.

   Returns null when there is nothing running, so the caller appends nothing at
   all rather than an empty container. */
function renderResumeZone(rounds) {
  const open = [];
  rounds.forEach((r) => (r.openSessions || []).forEach((session) => open.push({ round: r, session })));
  if (!open.length) return null;
  // The per-round arrays arrive newest-first; interleaving several rounds needs
  // the sort again. Same key and direction as the backends use.
  open.sort((a, b) => String(b.session.at).localeCompare(String(a.session.at)));

  /* The heading is a SIBLING of the grid, not a full-width item inside it.
     A `grid-column: 1 / -1` heading occupies every track, so no track is ever
     empty and `auto-fit` has nothing to collapse — measured at 1440px, two
     tickets then left a 457px hole, and one ticket would have been stranded
     ~340px wide against the left edge. That is the defect #358 fixed on the
     empty lobby, reintroduced by the heading rather than by the grid. */
  const zone = h(`<section class="home-resume">
      <h2 class="home-resume__head">${esc(t('round.inProgressLabel'))}</h2>
      <div class="home-resume__list"></div>
    </section>`);
  const list = zone.querySelector('.home-resume__list');
  open.slice(0, HOME_RESUME_CAP).forEach(({ round, session }) => {
    const voting = session.stage === 'voting';
    // A voting session names no game BY CONSTRUCTION — the draw stays secret
    // until everyone has rated, so the backends send null title and cover
    // (lib/repo/json.js). Never a missing-cover bug to chase.
    const imgStyle = session.image
      ? ` style="background-image:url('${coverUrl(session.image, COVER_THUMB)}')"`
      : '';
    const title = voting
      ? t('round.liveLabel')
      : session.gameTitle || t('round.inProgressDeciding');
    const ticket = h(`<a class="ticket ticket--live">
         <span class="ticket__main">
           <span class="ticket__img"${imgStyle}>${session.image ? '' : '<i class="ti ti-tornado" aria-hidden="true"></i>'}</span>
           <span class="ticket__info">
             <span class="ticket__label">${esc(round.name)}</span>
             <span class="ticket__title">${esc(title)}</span>
             <span class="ticket__meta">${esc(fmtDateTime(session.at))}</span>
           </span>
         </span>
         <span class="ticket__stub">
           <i class="ti ti-player-play" aria-hidden="true"></i>
           <span class="ticket__names">${esc(voting ? t('round.liveVote') : t('home.resume.result'))}</span>
         </span>
       </a>`);
    /* ONE path for both stages. `/round/:rid/session/:sid` is what the router
       already resolves by state — a session still collecting votes opens the
       lobby, a closed one opens the results screen (router.js) — so home does
       not decide the destination and cannot disagree with it. A real <a href>
       via navLink, so Cmd-click works (.claude/rules/in-app-nav-links.md). */
    navLink(ticket, resultsPath(round.id, session.id), () => showResultsById(round.id, session.id));
    list.appendChild(ticket);
  });
  return zone;
}

/* Zone 4: the dashboard region (#842) — Freundeskreis, Entdecken and the news
   tile as tiles in ONE full-shell grid, replacing the two stacked half-width
   blocks that used to trail off the bottom of the page.

   Every tile is optional and two of the three decide asynchronously, so the
   grid is styled to disappear when it ends up empty (`.home-dash:empty`) rather
   than leaving a gap. DOM order is the phone order and the tab order — no CSS
   `order` anywhere. */
function renderHomeDash() {
  const dash = h('<div class="home-dash"></div>');

  // Compact Freundeskreis feed (#325): a placeholder the friends module fills in
  // or removes. Not awaited — it must not delay the (SWR-instant) home render,
  // and it self-guards against a re-render. Since #842 it renders an invite card
  // rather than removing itself when the account simply has no friends yet.
  if (accountsActive() && isLoggedIn()) {
    const friends = h('<section class="home-friends dash-tile" id="homeFriends"></section>');
    dash.appendChild(friends);
    renderHomeFriends(friends);
  }

  // Instance-wide statistics (#564): the same placeholder-or-remove shape as the
  // friends feed above, and unawaited for the same reason. Not gated on being
  // logged in — this hub only renders for someone who is, in accounts mode, but
  // a password-only instance reaches it logged out and the numbers are public
  // either way.
  const stats = h('<section class="home-stats dash-tile" id="homeStats"></section>');
  dash.appendChild(stats);
  mountHomeStatsPanel(stats);

  const news = renderHomeNewsTile();
  if (news) dash.appendChild(news);
  return dash;
}

/* The „Was ist neu" tile (#741 content, #842 surface). Gated on hasUnseenNews()
   — no network call: the list ships in the bundle and the account's stamp rode
   in on /me.

   It carries NO dismiss control and deliberately does NOT call markNewsSeen():
   opening /neu is the acknowledgement, so the tile is simply absent on the next
   home render. That narrowing is recorded in views-news.js's header — a
   DISMISSABLE strip is what would train people to dismiss the
   Nutzungsbedingungen §11 terms notice unread, and that is the constraint, not
   "never mention the news anywhere". */
function renderHomeNewsTile() {
  if (!hasUnseenNews() || !NEWS.length) return null;
  const entry = NEWS[0];
  const text = newsText(entry, getLocale()) || {};
  const tile = h(`<a class="dash-tile home-news">
      <span class="home-news__label"><i class="ti ti-sparkles" aria-hidden="true"></i>${esc(t('news.title'))}</span>
      <span class="home-news__title">${esc(text.title || '')}</span>
      <span class="home-news__body muted">${esc(text.body || '')}</span>
    </a>`);
  navLink(tile, '/neu', () => showNews());
  return tile;
}

/* The lobby tile's avatar row is a single non-wrapping line in a card only
   ~360px wide at its narrowest, while a round may hold up to 50 members
   (MAX_MEMBERS_PER_ROUND, lib/quota.js) — so it is capped and the remainder
   rides in one "+N" bubble (#820). Uncapped, the row simply grew until it ran
   past the card's right edge, and `.round-card__meta`'s flex-wrap then pushed
   both stat chips onto a second line, so the card stopped matching the height
   of its neighbours in the grid. The round's OWN member strips
   (.hero__members, .rail__members) wrap instead and are deliberately uncapped:
   several rows of avatars are fine inside the round, not on the lobby tile. */
const LOBBY_AVATAR_CAP = 5;

// The populated lobby: one rich card per round, plus the dashed new-round card
// at the end. Only ever called with >= 1 round — the empty state is its own
// centred CTA (#358), so this grid never renders holding just the new card.
function renderLobbyList(rounds) {
  const list = h('<div class="lobby-list"></div>');
  rounds.forEach((r) => {
    // Members ride along in the summary so the avatars get their colors.
    const seats = r.members.slice(0, LOBBY_AVATAR_CAP);
    const rest = r.members.length - seats.length;
    /* The bubble is a count, not a person: no inline background, so it takes
       the neutral fill from .avatar-stack__more rather than a palette swatch.
       It stays a <span> like the seats around it — the whole card is already
       one <a>, so a nested control would be a link inside a link. The visible
       glyph is bare "+N"; the localized wording is the accessible label. */
    const moreLabel = rest > 0 ? tn(rest, 'home.moreMembersOne', 'home.moreMembers') : '';
    const stack =
      seats
        .map(
          (m) =>
            `<span class="avatar" style="background:${memberColor(r, m.id)}" title="${esc(m.name)}">${esc(initials(m.name))}</span>`
        )
        .join('') +
      (rest > 0
        ? `<span class="avatar avatar-stack__more" title="${esc(moreLabel)}" aria-label="${esc(moreLabel)}">+${rest}</span>`
        : '');

    let lastLine = '';
    if (r.lastPlayed) {
      const lp = r.lastPlayed;
      const text = lp.winnerNames.length
        ? tn(lp.winnerNames.length, 'home.lastPlayedWonOne', 'home.lastPlayedWonMany', {
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
  return list;
}

// =================== New round ===================

async function showNewRound() {
  currentView = () => showNewRound();
  syncUrl('/round/new');
  setContext(''); // creating a round, not inside one yet
  setDocTitle(t('newRound.title'));
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
            ${importable.map((r) => `<option value="${r.id}">${esc(tn(r.gameCount, 'newRound.importOptionOne', 'newRound.importOption', { name: r.name }))}</option>`).join('')}
          </select>
          <div class="muted import-card__note">${esc(t('newRound.importNote'))}</div>
        </div>
      </div>`
    : '';

  app.innerHTML = '';
  // The form is a dead end without this (#623): it renders no dock and no rail,
  // and nothing in the top bar leads back to the lobby it was opened from.
  app.appendChild(backRow(() => showHome()));
  app.appendChild(h(`<div class="page-head"><h1>${esc(t('newRound.title'))}</h1></div>`));

  // Same two-column setup layout as the session screen (`.setup-grid`): what the
  // round IS on the left (its name, the shelf it starts from), who sits at it on
  // the right. Below 860px the grid is a plain block, so this DOM order is also
  // the phone order — visual order and tab order therefore never disagree, which
  // is why the columns are built as real DOM groups rather than with CSS `order`.
  //
  // That does move the optional import card ABOVE the table on a phone (it used
  // to sit between the seats and the CTA). Deliberate: it groups the two
  // round-level settings, and the CTA stays last, which is the position that
  // actually matters. The seat table has to be the LAST block either way — it is
  // what the CTA rides with.
  const form = h(`<div class="setup-grid">
      <div class="setup-grid__main">
        <div class="field">
          <label for="roundName">${esc(t('newRound.nameLabel'))}</label>
          <input id="roundName" class="input" placeholder="${esc(t('newRound.namePlaceholder'))}" />
        </div>
        ${importField}
      </div>
      <div class="setup-grid__aside">
        <div class="field">
          <label for="memberInput">${esc(t('newRound.membersLabel'))}</label>
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
        <div class="toolbar">
          <button id="createRound" class="btn btn--primary btn--lg"><i class="ti ti-sparkles" aria-hidden="true"></i> ${esc(t('newRound.create'))}</button>
        </div>
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
