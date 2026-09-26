/* Spielwirbel – view: member detail page. Shows one round member's stats and
   lets the user edit their name and avatar color. Part of the frontend; all
   files share one global script scope (load order: see index.html). */

async function showMember(rid, mid) {
  currentView = () => showMember(rid, mid);
  syncUrl(memberPath(rid, mid));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyMarker(round);
  const member = round.members.find((m) => m.id === mid);
  if (!member) return showRound(rid);
  setContext(round.name);
  setDocTitle(member.name, round.name);

  app.innerHTML = '';
  renderSubScreenTabs(round, 'member');
  // Kept, because the „…“ page menu (#1074) rides on it as a second child —
  // the #1039 shape, `back-row--split` and all.
  const back = backRow(() => showRound(rid));
  app.appendChild(back);

  // Persist a partial update, then re-render the page from fresh data so the
  // new name/color is reflected here and everywhere it is derived from.
  async function updateMember(fields) {
    try {
      await api('PATCH', `/api/rounds/${rid}/members/${mid}`, fields);
      toast(t('member.saved'));
      showMember(rid, mid);
    } catch (e) {
      toast(e.message, { tone: 'error' });
    }
  }

  const st = memberStats(round, mid);
  const color = memberColor(round, mid);
  // The picker compares against the STORED hex; `color` above is what gets
  // painted, which a dark scheme lifts into a color-mix() (memberTone, #904).
  const ownHex = memberHex(round, mid);
  const me = currentUserId();
  const mine = !!me && member.userId === me;
  // Der Tisch composes the card's head and foot differently (#1276, T13.4):
  // an attendance line under the name, and the owned boxes as a panel inside
  // the card. Ocean takes the same two (#1218, O13.4 — „Bringt mit" beside the
  // record). Klassisch takes none of these branches.
  const panelled = designIs('tisch') || designIs('ocean');

  // Link or unlink this seat, then re-render into the other state. Shared by
  // „Das bin ich“ in the card and „Das bin ich nicht“ in the page menu.
  const seatPatch = async (userId) => {
    try {
      await api('PATCH', `/api/rounds/${rid}/members/${mid}`, { userId });
      showMember(rid, mid);
    } catch (e) {
      toast(e.message === 'seat_taken' ? t('member.toast.seatTaken')
        : e.message === 'already_seated' ? t('member.toast.alreadySeated')
          : e.message, { tone: 'error' });
    }
  };

  /* Die Tischkarte (#1074): ONE card in the member's colour carrying the whole
     record — who this is, how they play, what they are strongest at.

     It replaces a head band, a colour-picker section and a „Statistiken" grid,
     which split the answer across three treatments and put the two RARE
     questions (what colour, whose seat) above the one the screen exists for.
     Measured before: the two game tiles — the only imagery on the page — ended
     at 952px, below the fold on every laptop and on the phone, and the auto-fit
     grid left one to three empty card slots from 860px up (728px of blank card
     at 1920).

     `--m-tone` is set on the CARD rather than on the avatar, because four things
     read it — the wash, the avatar ring, the figure strip's rules and the state
     chip — and a property set on a child cannot be read by its parent. It is the
     same `memberColor` value the avatar is painted with, so the tone can never be
     a second, drifting definition of the member's colour
     (.claude/rules/shared-constants-across-the-stack.md). */
  /* The Siegquote AS the ring (#1075): a conic fill around the avatar, so the
     one number that says how this member does is the shape of their own face
     rather than a figure three tiles along. `--pct` is set inline from the same
     `memberStats` value the figure strip prints, so the two can never disagree.

     `winRate === null` (no contested session at all) gets `--member-ring--none`:
     the plain 18% tone ring, no gauge. A 0% gauge would say "never wins" about
     somebody who has never been in a contest (operator decision). */
  const pct = st.winRate === null ? null : Math.round(st.winRate * 100);
  const card = h(`<div class="member-card" style="--m-tone:${color}">
       <span class="member-card__mark" aria-hidden="true">${esc(initials(member.name))}</span>
       <div class="member-card__id">
         <span class="member-ring${pct === null ? ' member-ring--none' : ''}"${pct === null ? '' : ` style="--pct:${pct}"`}>
         <button type="button" class="avatar member-avatar" style="background:${color}" aria-label="${esc(t('member.colorChange'))}" aria-expanded="false">${avatarFace(initials(member.name), { userId: member.userId })}<span class="member-avatar__pen" aria-hidden="true"><i class="ti ti-pencil"></i></span></button>
         </span>
         <div class="member-card__who">
           <h1></h1>
           <div class="member-card__state"></div>
         </div>
       </div>
       <div class="member-card__figures"></div>
       <div class="pokale-cards member-card__games"></div>
     </div>`);
  const h1 = card.querySelector('h1');
  const nameEl = h(`<span class="gd-title" title="${esc(t('member.editName'))}">${esc(member.name)}</span>`);

  // Click the name -> inline input; Enter/blur saves, Escape cancels.
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

  /* „21 von 23 Sessions dabei" under the name (Der Tisch, #1276, T13.4) — the
     share of the round's finished sessions this member took part in, over the
     same `st.joined` the „Sessions" figure prints, so the two cannot disagree.
     Plural follows the TOTAL, the noun it counts.

     The sheet leads it with „In der Donnerstagsrunde seit Mai 2025". That half
     is NOT built: a member carries no join date, and a first-session proxy
     reads wrong for anyone who sat at the table long before they played. A
     stored date is new data, so it is the operator's call (#1276's PR).

     Absent with no finished session at all: „0 von 0" says nothing, and the
     state chip below already says „noch bei keiner Session dabei". */
  const finishedCount = round.sessions.filter((s) => s.finished).length;
  if (panelled && finishedCount) {
    h1.after(h(`<p class="member-card__attendance">${esc(tn(finishedCount, 'member.attendanceOne', 'member.attendance', { n: st.joined, total: finishedCount }))}</p>`));
  }

  /* The colour picker moved BEHIND the avatar (#1074). It was the second block
     on the page, above the record — 94px of chrome answering a question asked
     once per member, and 144px with eight 40px targets on a phone. The avatar IS
     the colour, so clicking it is where the change belongs.

     openEditor, not openPopover: a popover above 860px and a sheet below, which
     is what gives the swatch row the focus trap and Back-dismissal on a phone
     for free (.claude/rules/popover-vs-sheet-editors.md). `aria-expanded` is
     synced through the onClose hook rather than by wrapping `close` — the
     wrapped form misses Escape, a backdrop tap, Back and the scroll teardown. */
  const avatarBtn = card.querySelector('.member-avatar');
  avatarBtn.addEventListener('click', () => {
    openEditor(avatarBtn, 'member-color', t('member.colorLabel'), (el, close) => {
      const swatches = h('<div class="member-swatches"></div>');
      MEMBER_COLORS.forEach((c) => {
        const active = c === ownHex;
        // Shown in the tone the round actually paints, so the swatch a member
        // wears and the swatch you pick are the same colour on a dark design too.
        const sw = h(`<button class="member-swatch${active ? ' is-active' : ''}" aria-pressed="${active}" style="background:${memberTone(c)}" aria-label="${c}">
             <i class="ti ti-check" aria-hidden="true"></i>
           </button>`);
        if (!active) sw.addEventListener('click', () => { close(); updateMember({ color: c }); });
        swatches.appendChild(sw);
      });
      el.appendChild(swatches);
    }, () => avatarBtn.setAttribute('aria-expanded', 'false'));
    avatarBtn.setAttribute('aria-expanded', 'true');
  });

  /* The state row: at most one chip, plus the one action a newcomer needs.

     „nicht mehr dabei", never „aussortiert" — a person is not a game
     (.claude/rules/retired-members-filter-sites.md). The chip is mutually
     exclusive by construction: a retired seat's state is what matters about it,
     a claimed seat's is whose it is, and „noch bei keiner Session dabei" only
     ever applies to a seat that is neither. */
  const state = card.querySelector('.member-card__state');
  const chip = (cls, text) => h(`<span class="member-card__chip ${cls}">${esc(text)}</span>`);
  if (member.retired) state.appendChild(chip('member-card__chip--retired', t('member.retiredChip')));
  else if (mine) state.appendChild(chip('member-card__chip--mine', t('member.mySeat')));
  else if (st.joined === 0) state.appendChild(chip('member-card__chip--new', t('member.noSessions')));

  /* „Das bin ich" stays a VISIBLE button in the card rather than moving into the
     „…" menu with its siblings. It is the one action on this screen a newcomer
     is looking for, and the gate already makes it rare: an unlinked seat, in a
     round they may link in, while logged in and holding no other seat here.
     Holding a seat elsewhere hides it entirely — moving seats is a deliberate
     two-step (release, then claim), so a claim can never silently unlink a chair
     nobody is looking at and make it invitable. */
  if (!member.userId && roundCan(round, 'member.link') && isLoggedIn() && me
      && !round.members.some((m) => m.userId === me)) {
    const claim = h(`<button class="btn btn--sm btn--primary member-card__claim">${esc(t('member.claim'))}</button>`);
    claim.addEventListener('click', () => seatPatch(me));
    state.appendChild(claim);
  }

  /* Five figures in ONE strip, in one treatment. Two of them used to sit in the
     head band and three in `.pokale-card`s under a „Statistiken" heading — on a
     page that is nothing but statistics — so the record read as two unrelated
     things. `flex: 1 1 96px` wraps five to 3 + 2 on a phone with the second row
     filling the width, and no track can be empty because there is no grid.

     An empty record shows a dash or 0 rather than hiding the strip: a member
     with no sessions is a real and common state (a freshly-shared grantee is
     exactly that), and a card that silently loses half its content reads as
     broken rather than as empty. */
  const figures = card.querySelector('.member-card__figures');
  const figure = (label, value, extra) =>
    h(`<div class="member-figure">
         <span class="member-figure__value">${esc(value)}</span>
         ${extra || ''}
         <span class="member-figure__label">${esc(label)}</span>
       </div>`);
  /* FOUR figures, and none of them carries a bar. `.member-bar` (#1075) was the
     Siegwertung's own encoding — a track filled left or right by the sign — and
     it went with the measure on 2026-09-22. Every figure here is a count, a
     percentage or an average, none of which has a direction to lean, so a bar
     beside one would be a second and different claim about the same number. */
  figures.appendChild(figure(t('member.wins'), String(st.wins)));
  figures.appendChild(figure(t('member.winRate'), st.winRate === null ? '–' : Math.round(st.winRate * 100) + '%'));
  figures.appendChild(figure(t('member.sessions'), String(st.joined)));
  figures.appendChild(figure(t('member.avgGiven'), st.avgGiven === null ? '–' : 'Ø ' + fmtAvg(st.avgGiven)));
  // The member's earned Abzeichen under the figures (#1388) — never the open ones.
  const badgeRow = memberCardBadges(round, member);
  if (badgeRow) figures.after(badgeRow);

  const cards = card.querySelector('.member-card__games');

  /* The two game-link cards: „Stärkstes Spiel" (where this member has won most,
     #920) and „Lieblingsspiel" (what they rate highest). They read as a pair on
     purpose — one is taste, the other is record, and the two disagreeing is the
     interesting case — so they are adjacent and share one builder.

     Each carries `__games` rather than `__value`, so the phone reorder must not
     apply — a list of wrapping links is not a "number to promote", and they are
     the cards given the full row (#694) precisely because they hold more text.
     Hence their own classes rather than the `:last-child` the issue sketched:
     both the span and the exemption follow the card, not its position. */
  /* Both tiles LEAD WITH THE GAME'S COVER, through the same `gameCardHead` pair
     the Pokale and Chronik cards use (#979, views-pokale.js) — an icon-led game
     card here would have recreated one screen over exactly the sibling
     inconsistency that change removes. An EMPTY tile („noch kein
     Lieblingsspiel") keeps its icon row instead, which is the helper's own rule
     and is why the empty text still reads like the numeric tiles beside it.

     One loader for both tiles, as each section elsewhere does. */
  const loadCover = createCoverLoader();
  /* The ribbon (#1075) says which of the pair a tile is, in the member's own
     tone, so the two read apart at a glance instead of by their eyebrow text.
     An EMPTY tile gets none: a ribbon over „noch kein Lieblingsspiel" labels an
     absence as an award. */
  const gameCard = (cls, icon, label, games, sub, emptyText, ribbon) => {
    const lead = games[0];
    const card = h(`<div class="pokale-card ${cls}">
         ${games.length && ribbon ? `<span class="member-ribbon">${esc(ribbon)}</span>` : ''}
         ${gameCardHead(icon, label, lead)}
         <span class="pokale-card__games"></span>
         <span class="pokale-card__sub">${esc(sub)}</span>
       </div>`);
    wireGameCardHead(card, rid, lead, loadCover);
    const list = card.querySelector('.pokale-card__games');
    if (games.length) {
      games.forEach((g) => {
        const row = h(`<span class="pokale-game"><a class="pokale-game__title">${esc(g.title)}</a></span>`);
        makeGameLink(row.querySelector('.pokale-game__title'), rid, g.id);
        list.appendChild(row);
      });
    } else {
      list.appendChild(h(`<span class="muted">${esc(emptyText)}</span>`));
    }
    return card;
  };

  /* ti-sword: `ti-crown` is the Pokale podium's, and a card under an icon that
     already means something else reads as the same statistic shown twice. The
     codepoint was read from the bundled woff2's own cmap and the glyph looked
     at on screen — a wrong-but-present one draws a plausible OTHER icon with
     nothing red (.claude/rules/tabler-icon-codepoints.md).

     The sub-line is the win RATE plus the plays it rests on („67 % · 3×"), not
     the rate alone: a bare percentage invites the reading that 100 % means
     unbeatable, and the count is what says how much to trust it. A 0 % best is
     shown honestly — this is the member's own page, not a leaderboard — and
     `bestScore === null` (no game at or above BEST_GAME_MIN_PLAYS) is the only
     empty state. */
  cards.appendChild(
    gameCard(
      'member-stats__best',
      'ti-sword',
      t('member.bestGame'),
      st.bestGames,
      st.bestScore === null ? '' : bestGameSub(st),
      t('member.bestGameNone'),
      t('member.ribbonBest')
    )
  );
  cards.appendChild(
    gameCard(
      'member-stats__fav',
      'ti-heart',
      t('member.favorite'),
      st.favorite,
      st.favAvg === null ? '' : 'Ø ' + fmtAvg(st.favAvg),
      t('member.favoriteNone'),
      t('member.ribbonFav')
    )
  );

  /* The boxes this member brings — read here, above the card's foot, because
     Der Tisch sets them INSIDE the card; Klassisch still renders them as the
     section after it (see „3 Spiele von Anna" below for the filter's reasons). */
  const owned = round.games
    .filter((g) => isActiveGame(g) && (g.ownerIds || []).includes(mid))
    .sort((a, b) => a.title.localeCompare(b.title, getLocale(), { sensitivity: 'base' }));

  /* „Gehört Jonas" (Der Tisch, #1276, T13.4): the owned boxes as a panel beside
     the two game tiles, where the sheet draws them beside the record. The two
     tiles stay — the sheet's second panel (the rating distribution) was dropped
     by the operator, and „Stärkstes Spiel" is shown nowhere else, so removing
     them would take away a block that is reachable today. Hidden at zero, as
     the Klassisch section is: the tiles then keep the card's full width. */
  if (panelled && owned.length) {
    const lower = h('<div class="member-card__lower"></div>');
    cards.replaceWith(lower);
    lower.appendChild(memberOwnedPanel(round, member, owned));
    lower.appendChild(cards);
  }

  /* „Am Tisch“ — the round's other seats in the card's foot, below 1280px only.
     ACTIVE members (`activeMembers`): a forward-facing strip, so a retired
     member is absent from it while still being reachable as this page's own
     subject (.claude/rules/retired-members-filter-sites.md). From 1280px the
     rail carries the same strip, so the foot is hidden by the media query that
     hides the Start hero rather than being rendered twice. */
  const seated = activeMembers(round);
  if (seated.length > 1) {
    const table = h(`<div class="member-card__table">
         <span class="member-card__table-label">${esc(t('member.atTable'))}</span>
         <div class="member-card__seats"></div>
       </div>`);
    const seats = table.querySelector('.member-card__seats');
    seated.forEach((m) => {
      const here = m.id === mid;
      const el = h(`<a class="avatar member-seat${here ? ' is-current' : ''}" style="background:${memberColor(round, m.id)}" title="${esc(m.name)}"${here ? ' aria-current="page"' : ''}>${avatarFace(initials(m.name), { userId: m.userId })}</a>`);
      makeMemberLink(el, rid, m.id);
      seats.appendChild(el);
    });
    card.appendChild(table);
  }
  app.appendChild(card);

  /* „3 Spiele von Anna" (#973): the boxes this member brings. The fourth reader
     of `game.ownerIds` (#971) and the only one asking from the PERSON's side —
     the other three ask whether the table can put a given box on it.

     `isActiveGame` rather than a hand-written `!retired`: a retired or completed
     game is off the shelf and a wish is nobody's, so none of the three answers
     "which boxes are Anna's?" (.claude/rules/active-games-filter-sites.md). An
     owner id naming a seat that is gone simply never matches, like every other
     reader.

     HIDDEN ENTIRELY at zero, not shown empty. Most rounds will never record an
     owner, and „Spiele von Anna" over an empty grid on every member page would
     advertise a feature the round does not use — the same call the detail page's
     expansions section makes on a sparse page. */
  if (owned.length && !panelled) {
    // This heading puts `{name}` after a preposition in most locales, which is
    // why the demo seed may not name a seat with a pronoun — „4 Spiele von Du"
    // is wrong German. See
    // .claude/rules/interpolated-names-must-not-be-case-governed.md.
    const ownedSec = h(`<div class="section">
         <h2>${esc(tn(owned.length, 'member.ownedTitleOne', 'member.ownedTitle', { name: member.name }))}</h2>
         <div class="member-games"></div>
       </div>`);
    const grid = ownedSec.querySelector('.member-games');
    owned.forEach((g) => {
      // The setup screen's pool tile, reused whole: same object, same crop, so a
      // cover the round recognises there is the same picture here. An <a>, not
      // its <span>, because these navigate — makeGameLink then carries the href
      // and the .nav-link reset that strips the UA underline.
      const style = g.image ? ` style="background-image:url('${coverUrl(g.image, COVER_CARD)}')"` : '';
      const tile = h(`<a class="pool-tile" title="${esc(g.title)}">
           <span class="pool-tile__img"${style}>${coverPlaceholder(g)}</span>
           <span class="pool-tile__name">${esc(g.title)}</span>
         </a>`);
      makeGameLink(tile, rid, g.id);
      grid.appendChild(tile);
    });
    app.appendChild(ownedSec);
  }

  /* The rare seat actions, in the back row's „…“ menu (#1074).

     They were three stacked `.round-footer` blocks under the record — up to two
     of them at once, each a full-width strip for something done at most once per
     member. The menu is the Spielepass's (#1039): same class, same position,
     same „state flips at the top right, the record on the page“ reading. Don't
     invent a second menu shape.

     Which items exist is unchanged — the three footers' gates are the three
     branches below, in the same order and running the same flows. Only „Das bin
     ich“ left, into the card, because it is the one a newcomer looks for.

     Who sits here? Three mutually exclusive states, and the split matters:
       - MY seat (#421) → „Das bin ich nicht“, which only nulls the link.
       - someone ELSE's account (a shared grantee, #207) → the owner revokes
         their access; the seat and its ratings/history stay.
       - unlinked → „Das bin ich“ (#421), rendered in the card above.
     Before #421 the first two were one branch, so an owner-claimed seat would
     have offered „Zugriff entfernen“ and hit DELETE …/shares/:userId, which
     finds no grant and 404s. */
  const menuItems = [];

  if (mine) {
    // No confirm, deliberately: this only nulls the link and „Das bin ich“ one
    // click later puts it back. Unlike „Zugriff entfernen“ below, which cuts
    // another person's access to the round and they cannot undo it themselves.
    menuItems.push({ icon: 'ti-user-x', label: t('member.unclaim'), cls: 'popover__opt--muted', kind: 'undoable', run: () => seatPatch(null) });
  } else if (roundCan(round, 'round.shares.manage') && member.userId) {
    menuItems.push({ icon: 'ti-lock-off', label: t('share.revoke'), cls: 'popover__opt--warn', kind: 'destructive', run: async () => {
      if (!await confirmDialog({
        body: t('share.revokeConfirm', { name: member.name }), confirmLabel: t('share.revoke'),
      })) return;
      try {
        await api('DELETE', `/api/rounds/${rid}/shares/${member.userId}`);
        showMember(rid, mid); // re-render: the seat is now unlinked
      } catch (e) { toast(e.message, { tone: 'error' }); }
    } });
  }

  /* Retire / restore this seat, and — only where there is demonstrably nothing
     to keep — delete it outright (#1006).

     Retiring touches nothing but two flags, so every past session's participant
     list and every game's Spielwirbel-Score stay byte-identical; what changes is
     that the person leaves the forward-looking lists (`activeMembers`). Deleting
     is offered only when the seat holds no votes, no recorded win and no team
     membership anywhere — the "added by mistake" case, which should not leave a
     retired ghost behind. The server re-checks both; this is what to OFFER. */
  const myVotes = (round.sessions || []).some((s2) => {
    const v = (s2.votes || {})[mid];
    if (v && Object.keys(v).length) return true;
    if (Array.isArray(s2.winnerIds) && s2.winnerIds.includes(mid)) return true;
    // Stored as `personIds` (#575) — a team can hold guests too.
    return (s2.teams || []).some((team) => (team.personIds || []).includes(mid));
  });

  if (member.retired) {
    menuItems.push({ icon: 'ti-arrow-back-up', label: t('member.restore'), kind: 'undoable', run: async () => {
      try {
        await api('POST', `/api/rounds/${rid}/members/${mid}/retire`, { retired: false });
        toast(t('member.toast.restored', { name: member.name }));
        showMember(rid, mid);
      } catch (e) { toast(e.message, { tone: 'error' }); }
    } });
  } else {
    menuItems.push({ icon: 'ti-user-minus', label: t('member.retire'), cls: 'popover__opt--warn', kind: 'destructive', run: async () => {
      /* The two follow-up questions, asked ONLY when they apply — each is a real
         consequence the user cannot see from here.

         Solely-owned games are load-bearing rather than a nicety: `ownedByParty`
         keeps a game in the draw only while an owner is seated, and a retired
         member is never seated, so those games would silently vanish from every
         draw with nothing on screen to explain it.

         The seat link is offered only for the caller's OWN seat, because
         releasing someone else's is what `PATCH …/members/:mid` refuses on
         purpose — nulling a grantee's link leaves their grant matching on
         roundId+userId with no chair, invitable to someone else
         (.claude/rules/member-seat-self-claim.md §1). For another person's
         linked seat the honest path is „Zugriff entfernen“ above, which drops
         the grant and the link together. */
      const solely = (round.games || []).filter((g) => !g.retired && !g.completed && !g.wish
        && Array.isArray(g.ownerIds) && g.ownerIds.length === 1 && g.ownerIds[0] === mid);
      const options = [];
      if (solely.length) {
        options.push({ id: 'games', checked: true,
          label: tn(solely.length, 'member.retireGamesOne', 'member.retireGames', { n: solely.length, name: member.name }) });
      }
      if (member.userId && me && member.userId === me) {
        options.push({ id: 'seat', checked: true, label: t('member.retireSeat') });
      }
      const answer = await confirmDialog({
        body: t('member.retireConfirm', { name: member.name }),
        confirmLabel: t('member.retire'), icon: 'ti-user-minus', options,
      });
      const ok = options.length ? answer.ok : answer;
      if (!ok) return;
      const picked = options.length ? answer.picked : {};
      try {
        if (picked.games) {
          for (const g of solely) {
            await api('POST', `/api/rounds/${rid}/games/${g.id}/retire`, { retired: true });
          }
        }
        if (picked.seat) await api('PATCH', `/api/rounds/${rid}/members/${mid}`, { userId: null });
        await api('POST', `/api/rounds/${rid}/members/${mid}/retire`, { retired: true });
        toast(t('member.toast.retired', { name: member.name }));
        showMember(rid, mid);
      } catch (e) { toast(e.message, { tone: 'error' }); }
    } });
  }
  if (!myVotes && roundCan(round, 'round.delete')) {
    menuItems.push({ icon: 'ti-trash', label: t('member.delete'), cls: 'popover__opt--warn', kind: 'destructive', run: async () => {
      if (!await confirmDialog({
        body: t('member.deleteConfirm', { name: member.name }),
        confirmLabel: t('member.delete'), icon: 'ti-trash',
      })) return;
      try {
        await api('DELETE', `/api/rounds/${rid}/members/${mid}`);
        toast(t('member.toast.deleted', { name: member.name }));
        showRound(rid);
      } catch (e) { toast(e.message, { tone: 'error' }); }
    } });
  }

  if (menuItems.length) {
    back.classList.add('back-row--split');
    const menuBtn = h(`<button type="button" class="btn btn--sm gd-menu" aria-label="${esc(t('detail.moreActions'))}" aria-expanded="false"><i class="ti ti-dots" aria-hidden="true"></i></button>`);
    // Buttons only, so this is a popover at EVERY width — the account menu's
    // case, not the editors' (.claude/rules/popover-vs-sheet-editors.md §2b).
    // `aria-expanded` is synced through openPopover's onClose rather than by
    // wrapping `close`: the wrapped form misses four of the six exits (Escape,
    // a backdrop tap, Back, the page scroll that tears a popover down) and
    // leaves the trigger claiming a panel that is gone.
    menuBtn.addEventListener('click', () => {
      openPopover(menuBtn, (el, close) => fillMenu(el, menuItems, close),
        () => menuBtn.setAttribute('aria-expanded', 'false'));
      menuBtn.setAttribute('aria-expanded', 'true');
    });
    back.appendChild(menuBtn);
  }

  /* The grantee's role select keeps a compact row UNDER the card, owner-only.
     Not a menu item: a `<select>` does not belong in a buttons-only popover, and
     `share.linked` — which used to be the footer's lead text — is the row's
     own now. Rendered only once the server confirms this seat really holds a
     grant: a seat the OWNER claimed for themselves is linked but un-granted, and
     offering a role picker there would 404 on save. The fetch is best-effort. */
  if (!mine && roundCan(round, 'round.shares.manage') && member.userId) {
    api('GET', `/api/rounds/${rid}/shares`).then((shares) => {
      const grant = (shares || []).find((sh) => sh.userId === member.userId);
      if (!grant) return;
      const field = h(`<div class="field member-role">
          <p class="muted">${esc(t('share.linked'))}</p>
          <label for="shareRole">${esc(t('share.role'))}</label>
          <select id="shareRole" class="input">
            ${ROUND_ROLES.filter((r) => r !== 'owner').map((r) =>
    `<option value="${esc(r)}"${r === grant.role ? ' selected' : ''}>${esc(t('share.role.' + r))}</option>`).join('')}
          </select>
          <p class="muted field__hint" id="shareRoleHint">${esc(t('share.role.' + grant.role + '.hint'))}</p>
        </div>`);
      const sel = field.querySelector('#shareRole');
      sel.addEventListener('change', async () => {
        const role = sel.value;
        try {
          await api('PATCH', `/api/rounds/${rid}/shares/${member.userId}`, { role });
          field.querySelector('#shareRoleHint').textContent = t('share.role.' + role + '.hint');
          toast(t('share.roleSaved', { name: member.name }));
        } catch (e) { toast(e.message, { tone: 'error' }); }
      });
      app.appendChild(field);
    }).catch(() => {});
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
    const okBtn = h(`<button class="btn btn--primary">${esc(t('common.add'))}</button>`);
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
        toast(e.message === 'quota_members' ? t('member.toast.quota') : e.message, { tone: 'error' });
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

/* „Gehört <Name>" — Der Tisch's owned-games panel (#1276, T13.4): one row per
   box, its cover standing up, its title, and the shelf score as the Regal pill
   prints it, so the number a member sees here is the one the shelf ranks by.

   The heading is the Klassisch section's own („3 Spiele von Anna"), not a new
   sentence: one concept keeps one string in nine languages. Each row is one
   link to the game. */
function memberOwnedPanel(round, member, owned) {
  const index = roundScoreIndex(round, owned);
  const panel = h(`<div class="member-owned">
       <h2 class="member-owned__title">${esc(tn(owned.length, 'member.ownedTitleOne', 'member.ownedTitle', { name: member.name }))}</h2>
     </div>`);
  owned.forEach((g) => {
    const score = index.byGame[g.id] ? index.byGame[g.id].score : null;
    const pill = score !== null
      ? `<span class="score-pill" style="--sc:${scoreColor(score)}" data-stop="${scoreStop(score)}">${fmtAvg(displayScore(score))}</span>`
      : `<span class="score-pill score-pill--none">${esc(t('games.scoreNew'))}</span>`;
    const style = g.image ? ` style="background-image:url('${coverUrl(g.image, COVER_THUMB)}')"` : '';
    const row = h(`<a class="member-owned__row">
         <span class="member-owned__cover"${style}>${coverPlaceholder(g)}</span>
         <span class="member-owned__name">${esc(g.title)}</span>
         ${pill}
       </a>`);
    makeGameLink(row, round.id, g.id);
    panel.appendChild(row);
  });
  return panel;
}

/* „Stärkstes Spiel"'s sub-line, shared with the profile (views-profile.js),
   which shows the same tile over an account-wide merge of the same figures.

   Rate AND plays, never the rate alone: „100 %" off three evenings and off
   thirty are not the same claim, and the tile has no other room to say which
   one the reader is looking at. Percent formatting matches the „Siegquote"
   figure two tiles up, so the two numbers read as the same kind of thing. */
function bestGameSub(st) {
  return t('member.bestGameSub', {
    pct: Math.round(st.bestScore * 100) + '%',
    n: st.bestPlays,
  });
}
