/* Spielwirbel – view: member detail page. Shows one round member's stats and
   lets the user edit their name and avatar color. Part of the frontend; all
   files share one global script scope (load order: see index.html). */

// Statistics for one member, computed on demand from the round's sessions
// (sessions are the single source of truth, like the game rating averages).
function memberStats(round, mid) {
  const finished = round.sessions.filter((s) => s.finished);

  // Sessions joined: finished sessions whose memberIds include the member.
  // Legacy sessions have no memberIds -> everyone counts as having joined.
  const joined = finished.filter(
    (s) => !Array.isArray(s.memberIds) || s.memberIds.includes(mid)
  );
  const wins = finished.filter((s) => (s.winnerIds || []).includes(mid)).length;
  const winRate = joined.length ? wins / joined.length : null;

  // Every numeric rating this member has given, and the per-game averages used
  // to find their favorite game (only games that still exist in the round and
  // that a taste stat may name — `isNameableGame`, recap.js, which this page
  // shares with the Pokale Lieblingsspiele card so a game cannot vanish there
  // while still sitting here). `allRatings` — and so `avgGiven` — deliberately
  // counts EVERY rating, retired games included: it measures how this member
  // rates, not what is on the shelf, so the filter must not reach it (#643).
  const allRatings = [];
  const perGame = {}; // gameId -> [ratings]
  round.sessions.forEach((s) => {
    const votes = s.votes[mid] || {};
    Object.keys(votes).forEach((gid) => {
      const r = votes[gid] && votes[gid].rating;
      if (typeof r !== 'number') return;
      allRatings.push(r);
      if (round.games.some((g) => g.id === gid && isNameableGame(g)))
        (perGame[gid] = perGame[gid] || []).push(r);
    });
  });
  const avgGiven = allRatings.length
    ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length
    : null;

  // Favorite game(s): highest average this member gave. Ties share the tile.
  let favGames = [];
  let favAvg = null;
  Object.keys(perGame).forEach((gid) => {
    const avg = perGame[gid].reduce((a, b) => a + b, 0) / perGame[gid].length;
    if (favAvg === null || avg > favAvg) {
      favAvg = avg;
      favGames = [gid];
    } else if (avg === favAvg) {
      favGames.push(gid);
    }
  });
  const favorite = favGames.map((gid) => round.games.find((g) => g.id === gid)).filter(Boolean);

  return { wins, joined: joined.length, winRate, avgGiven, favorite, favAvg };
}

async function showMember(rid, mid) {
  currentView = () => showMember(rid, mid);
  syncUrl(memberPath(rid, mid));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyBackground(round.background);
  const member = round.members.find((m) => m.id === mid);
  if (!member) return showRound(rid);
  setContext(round.name);
  setDocTitle(member.name, round.name);

  app.innerHTML = '';
  renderSubScreenTabs(round, 'member');
  app.appendChild(backRow(() => showRound(rid)));

  // Persist a partial update, then re-render the page from fresh data so the
  // new name/color is reflected here and everywhere it is derived from.
  async function updateMember(fields) {
    try {
      await api('PATCH', `/api/rounds/${rid}/members/${mid}`, fields);
      toast(t('member.saved'));
      showMember(rid, mid);
    } catch (e) {
      toast(e.message);
    }
  }

  const color = memberColor(round, mid);

  // Header: big avatar + editable name.
  const head = h(`<div class="member-head">
       <span class="avatar member-avatar" style="background:${color}">${esc(initials(member.name))}</span>
       <div class="member-head__info">
         <h1></h1>
       </div>
     </div>`);
  const h1 = head.querySelector('h1');
  const nameEl = h(`<span class="gd-title" title="${esc(t('member.editName'))}">${esc(member.name)}</span>`);

  // Click the name → inline input; Enter/blur saves, Escape cancels.
  nameEl.addEventListener('click', () => {
    const input = h('<input class="input gd-title-input" />');
    input.value = member.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let handled = false;
    const commit = () => {
      if (handled) return;
      handled = true;
      const val = input.value.trim();
      if (!val) {
        toast(t('member.toast.needName'));
        input.replaceWith(nameEl);
        return;
      }
      if (val === member.name) {
        input.replaceWith(nameEl); // nothing changed
        return;
      }
      updateMember({ name: val });
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { handled = true; input.replaceWith(nameEl); }
    });
  });
  h1.appendChild(nameEl);
  app.appendChild(head);

  // Color picker: the curated MEMBER_COLORS palette (no free hex).
  const colorSec = h(`<div class="section">
       <h2>${esc(t('member.colorLabel'))}</h2>
       <div class="member-swatches"></div>
     </div>`);
  const swatches = colorSec.querySelector('.member-swatches');
  MEMBER_COLORS.forEach((c) => {
    const active = c === color;
    const sw = h(`<button class="member-swatch${active ? ' is-active' : ''}" aria-pressed="${active}" style="background:${c}" aria-label="${c}">
         <i class="ti ti-check" aria-hidden="true"></i>
       </button>`);
    if (!active) sw.addEventListener('click', () => updateMember({ color: c }));
    swatches.appendChild(sw);
  });
  app.appendChild(colorSec);

  // Statistics, computed on demand from the sessions.
  const st = memberStats(round, mid);
  const statsSec = h(`<div class="section">
       <h2>${esc(t('member.statsTitle'))}</h2>
       <div class="pokale-cards"></div>
     </div>`);
  if (st.joined === 0) {
    // After the section title. The template has an <h2> (not <h3>) — querying the
    // wrong tag returned null and threw for EVERY member with no joined sessions
    // (a freshly-shared grantee is exactly that), crashing the member screen.
    statsSec
      .querySelector('h2')
      .insertAdjacentElement('afterend', h(`<div class="muted member-nosessions">${esc(t('member.noSessions'))}</div>`));
  }
  const cards = statsSec.querySelector('.pokale-cards');

  const statCard = (icon, label, value, sub) =>
    h(`<div class="pokale-card">
         <span class="pokale-card__icon"><i class="ti ${icon}" aria-hidden="true"></i></span>
         <span class="pokale-card__label">${esc(label)}</span>
         <span class="pokale-card__value">${esc(value)}</span>
         <span class="pokale-card__sub">${esc(sub)}</span>
       </div>`);

  cards.appendChild(statCard('ti-trophy', t('member.wins'), String(st.wins), ''));
  cards.appendChild(statCard('ti-confetti', t('member.sessions'), String(st.joined), ''));
  cards.appendChild(
    statCard(
      'ti-percentage',
      t('member.winRate'),
      st.winRate === null ? '–' : Math.round(st.winRate * 100) + '%',
      ''
    )
  );
  cards.appendChild(
    statCard('ti-star', t('member.avgGiven'), st.avgGiven === null ? '–' : 'Ø ' + st.avgGiven.toFixed(1), '')
  );

  // Favorite game: one card whose value links to the game detail page(s).
  const favCard = h(`<div class="pokale-card">
       <span class="pokale-card__icon"><i class="ti ti-heart" aria-hidden="true"></i></span>
       <span class="pokale-card__label">${esc(t('member.favorite'))}</span>
       <span class="pokale-card__games"></span>
       <span class="pokale-card__sub">${st.favAvg === null ? '' : esc('Ø ' + st.favAvg.toFixed(1))}</span>
     </div>`);
  const favList = favCard.querySelector('.pokale-card__games');
  if (st.favorite.length) {
    st.favorite.forEach((g) => {
      const row = h(`<span class="pokale-game"><a class="pokale-game__title">${esc(g.title)}</a></span>`);
      makeGameLink(row.querySelector('.pokale-game__title'), rid, g.id);
      favList.appendChild(row);
    });
  } else {
    favList.appendChild(h(`<span class="muted">${esc(t('member.favoriteNone'))}</span>`));
  }
  cards.appendChild(favCard);
  app.appendChild(statsSec);

  // Who sits here? Three mutually exclusive states, and the split matters:
  //   - MY seat (#421) → „Das bin ich nicht", which only nulls the link.
  //   - someone ELSE's account (a shared grantee, #207) → the owner revokes
  //     their access; the seat and its ratings/history stay.
  //   - unlinked → „Das bin ich" (#421).
  // Before #421 the first two were one branch, so an owner-claimed seat would
  // have offered „Zugriff entfernen" and hit DELETE …/shares/:userId, which
  // finds no grant and 404s.
  const me = currentUserId();
  const mine = !!me && member.userId === me;
  const seatPatch = async (userId) => {
    try {
      await api('PATCH', `/api/rounds/${rid}/members/${mid}`, { userId });
      showMember(rid, mid); // re-render into the other state
    } catch (e) {
      toast(e.message === 'seat_taken' ? t('member.toast.seatTaken')
        : e.message === 'already_seated' ? t('member.toast.alreadySeated')
          : e.message);
    }
  };

  if (mine) {
    const sec = h(`<div class="round-footer">
        <p class="muted">${esc(t('member.claimed'))}</p>
      </div>`);
    // No confirm, deliberately: this only nulls the link and the button one
    // click later puts it back. Unlike „Zugriff entfernen" below, which cuts
    // another person's access to the round and they cannot undo it themselves.
    const btn = h(`<button class="link-btn">${esc(t('member.unclaim'))}</button>`);
    btn.addEventListener('click', () => seatPatch(null));
    sec.appendChild(btn);
    app.appendChild(sec);
  } else if (!round.shared && member.userId) {
    const shareSec = h(`<div class="round-footer">
        <p class="muted">${esc(t('share.linked'))}</p>
      </div>`);
    const revokeBtn = h(`<button class="link-btn round-footer__danger">${esc(t('share.revoke'))}</button>`);
    revokeBtn.addEventListener('click', async () => {
      if (!confirm(t('share.revokeConfirm', { name: member.name }))) return;
      try {
        await api('DELETE', `/api/rounds/${rid}/shares/${member.userId}`);
        showMember(rid, mid); // re-render: the seat is now unlinked
      } catch (e) { toast(e.message); }
    });
    shareSec.appendChild(revokeBtn);
    app.appendChild(shareSec);
  } else if (!member.userId && !round.shared && isLoggedIn() && me
      && !round.members.some((m) => m.userId === me)) {
    // Holding a seat elsewhere in this round hides the button entirely — moving
    // seats is a deliberate two-step (release, then claim), so that a claim can
    // never silently unlink a chair you aren't looking at and make it invitable.
    const sec = h('<div class="round-footer"></div>');
    const btn = h(`<button class="link-btn">${esc(t('member.claim'))}</button>`);
    btn.addEventListener('click', () => seatPatch(me));
    sec.appendChild(btn);
    app.appendChild(sec);
  }
}

// The "+" trigger for the member strips, built in one place so the hero and the
// rail cannot drift apart on markup or labelling. Icon-only, so it carries an
// aria-label — the title alone is not an accessible name for a screen reader.
function addMemberBtn(round) {
  const btn = h(`<button class="avatar avatar--add" title="${esc(t('member.add'))}" aria-label="${esc(t('member.add'))}"><i class="ti ti-plus" aria-hidden="true"></i></button>`);
  btn.addEventListener('click', () => openAddMember(btn, round));
  return btn;
}

// The "+" seat in a round's member strip (#563). Lives here rather than in either
// caller because the SAME strip is rendered twice — the Start tab's hero below
// 1280px and the desktop rail above it — and both need this entry point for it to
// be reachable at every width.
//
// It goes through openEditor, never openPopover directly: it holds a text input,
// and an anchored popover cannot hold one on a phone — focusing the field makes
// the browser scroll the page, and openPopover's own scroll teardown then closes
// it before the keyboard finishes opening
// (.claude/rules/popover-vs-sheet-editors.md). openEditor gives the sheet
// presentation below 860px, and with it the focus trap (#145) and Back-dismissal
// (#333). The whole path stays synchronous from the click handler so iOS raises
// the keyboard, which is why the focus happens in the returned callback.
function openAddMember(anchor, round) {
  openEditor(anchor, 'add-member', t('member.add'), (el, close) => {
    // No maxlength: no member-name input in the app has one (the rename field and
    // the new-round form both omit it) and the route sets no ceiling either, so a
    // cap here alone would be cosmetic and asymmetric.
    const input = h(`<input class="input" placeholder="${esc(t('member.addPlaceholder'))}" />`);
    const okBtn = h(`<button class="btn btn--primary">${esc(t('common.ok'))}</button>`);
    const save = async () => {
      const name = input.value.trim();
      // Client-side first so a blank name never round-trips; the route validates
      // the same shape as the backstop.
      if (!name) return toast(t('member.toast.needName'));
      close();
      try {
        await api('POST', `/api/rounds/${round.id}/members`, { name });
        toast(t('member.toast.added', { name }));
        // Re-render whatever screen we are on. currentView() rather than a fixed
        // showRound(): the rail carries this strip on every round screen, so the
        // "+" can be clicked from the Regal, the Chronik or a sub-screen too.
        currentView();
      } catch (e) {
        toast(e.message === 'quota_members' ? t('member.toast.quota') : e.message);
      }
    };
    okBtn.addEventListener('click', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    const row = h('<div class="pp-row"></div>');
    row.appendChild(input);
    row.appendChild(okBtn);
    el.appendChild(row);
    return () => input.focus();
  });
}
