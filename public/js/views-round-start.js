/* Spielwirbel – the round hub's Start tab (#923, split out of views-round.js).

   The launchpad: identity, the one big CTA, the tickets that carry the latest
   story — and, below them, the card grid that gives the tab content of its own.
   Before #923 a settled round met a ticket and a button here, and above 1280px
   the rail had taken even those, which is what `.empty--rail-gap` was invented
   to paper over.

   Everything the cards say is DERIVED on demand from the round payload this
   screen already holds (public/js/hub-insights.js) — no new field, no new
   table, no extra request. The one exception is the recommendations teaser,
   which fetches after first paint and renders nothing if anything at all goes
   wrong; see renderRecoTeaser at the bottom.

   THE LOAD-BEARING RULE FOR EVERY CARD: it renders NOTHING when it has nothing
   to say — no heading, no empty container, no skeleton. A brand-new round with
   three games and no session must meet the screen it met before, not six empty
   boxes. Each renderer below returns null for that case and the caller appends
   only what came back.

   Part of the frontend; all files share one global script scope. Loaded right
   after views-round.js. */

// --- Start tab: the launchpad — identity, the one big CTA, the latest story.
function renderStartTab(round, activeGames) {
  const rid = round.id;

  // Stats per active game (for the retirement recommendations below). Shelf-
  // scoped and built in one pass, for the reason roundScoreIndex states (#894).
  const { byGame: statsByGame } = roundScoreIndex(round, activeGames);

  const playedCount = round.sessions.filter((s) => s.finished).length;
  const hero = h(`<div class="hero rail-owned">
       <h1></h1>
       <div class="hero__members">${round.members
         .map((m) => `<a class="avatar" style="background:${memberColor(round, m.id)}" title="${esc(m.name)}">${avatarFace(initials(m.name), { userId: m.userId })}</a>`)
         .join('')}</div>
       <div class="hero__chips">
         <span class="stat-chip"><i class="ti ti-cards" aria-hidden="true"></i>${esc(tn(activeGames.length, 'home.chip.gamesOne', 'home.chip.games'))}</span>
         <span class="stat-chip"><i class="ti ti-confetti" aria-hidden="true"></i>${esc(tn(playedCount, 'home.chip.sessionsOne', 'home.chip.sessions'))}</span>
       </div>
     </div>`);
  // The name is inline-editable (#562); the rail's copy of this heading carries
  // the same affordance for widths where CSS hides the hero.
  hero.querySelector('h1').appendChild(editableRoundName(round));
  app.appendChild(hero);
  // Each hero avatar opens that member's detail page. Queried before the "+" is
  // appended, so the index-to-member mapping cannot pick it up.
  hero.querySelectorAll('.hero__members .avatar').forEach((el, i) => {
    const m = round.members[i];
    if (m) makeMemberLink(el, rid, m.id);
  });
  // Add a seat (#563), right where the seats are listed. A real <button>, not a
  // focusable span: it is not inline text sharing a line, so the platform gives
  // focus, Enter and Space for free (.claude/rules/native-button-vs-focusable-span.md).
  hero.querySelector('.hero__members').appendChild(addMemberBtn(round));

  const startBtn = h(
    `<button class="btn btn--primary hub-cta rail-owned"><i class="ti ti-tornado" aria-hidden="true"></i>${esc(t('round.startSession'))}</button>`
  );
  startBtn.addEventListener('click', () => showStartSession(round));
  if (activeGames.length === 0) {
    startBtn.disabled = true;
    startBtn.title = t('round.startSessionDisabled');
  }
  app.appendChild(startBtn);

  // Quick-start presets (#923): the same draw, already narrowed. Directly under
  // the CTA because they modify it — and only when this shelf can actually
  // express one, so the row is absent rather than empty.
  if (activeGames.length) {
    const presets = hubPresetChips(round, activeGames);
    // `rail-owned`, exactly like the CTA above: from 1280px up the rail carries
    // both, and a chip row left behind here would modify a button that has left
    // the pane.
    if (presets) { presets.classList.add('rail-owned'); app.appendChild(presets); }
  }

  // "Vote in progress" tickets: a draw whose voting was abandoned before the
  // hot-seat wizard POSTed its results (#329). The row is created server-side at
  // draw time, so leaving mid-vote used to strand a `done: false` session that
  // no screen ever showed. Offered here instead — resuming re-enters the wizard
  // with the same drawn games (no vote was ever saved, so it honestly starts
  // over), and the discard deletes the row.
  // The draw stays secret until everyone has rated, so this ticket deliberately
  // shows neither cover nor title — only how many games were drawn.
  round.sessions
    .filter((s) => !s.done && !s.cancelled)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .forEach((session) => {
      const n = (session.gameIds || []).length;
      // One vocabulary since #655: every open session's votes live on the
      // server as they are given, so none of them is an "abandoned draw" to be
      // resumed — voting is simply still running, here or on someone's phone.
      const ticket = h(`<button class="ticket ticket--live">
           <span class="ticket__main">
             <span class="ticket__img"><i class="ti ti-tornado" aria-hidden="true"></i></span>
             <span class="ticket__info">
               <span class="ticket__label">${esc(t('round.liveLabel'))}</span>
               <span class="ticket__title">${esc(tn(n, 'round.draftTitleOne', 'round.draftTitle'))}</span>
               <span class="ticket__meta">${esc(fmtDateTime(session.createdAt))}</span>
             </span>
           </span>
           <span class="ticket__stub">
             <i class="ti ti-player-play" aria-hidden="true"></i>
             <span class="ticket__names">${esc(t('round.liveVote'))}</span>
           </span>
         </button>`);
      // The lobby is the entry point every participant uses: open the app, tap
      // the round, tap the ticket, vote. It needs no guard against a deleted game
      // or member — unlike the wizard it used to open, it renders whatever the
      // session still has and offers the actions that fit.
      ticket.addEventListener('click', () => showSessionLobby(round, session));
      app.appendChild(ticket);

      // Guarded even though every grantee role clears the floor today (#857):
      // the route decides on a capability, so the control has to ask the same
      // question, or a re-tightening tomorrow degrades to a button that 403s
      // instead of one that is simply absent.
      if (!roundCan(round, 'session.discard')) return;

      const discard = h(`<div class="center ticket__discard"><button class="link-btn">${esc(t('round.draftDiscard'))}</button></div>`);
      discard.querySelector('button').addEventListener('click', async () => {
        if (!await confirmDialog({
          body: t('round.draftDiscardConfirm'), confirmLabel: t('round.draftDiscard'),
        })) return;
        try {
          await api('DELETE', `/api/rounds/${round.id}/sessions/${session.id}`);
          toast(t('round.toast.draftDiscarded'));
          await fetchRoundFresh(round.id);
          showRound(round.id, 'start');
        } catch (e) { toast(e.message); }
      });
      app.appendChild(discard);
    });

  // "In progress" tickets: sessions whose voting is done but that have not yet
  // reached a final state (no winner recorded, not cancelled). Shown above the
  // last-played ticket, newest first; tapping resumes on the results screen.
  //
  // A split parent (#796) is NOT in progress — it is resolved, and its tables are
  // the sessions still open — so it is excluded by outcome rather than by a
  // fourth boolean. Its children stay in the list and are nested under one header
  // below, so three tickets at the same minute read as one evening's three tables
  // rather than as three unrelated evenings.
  const inProgress = round.sessions
    .filter((s) => s.done && !s.finished && !s.cancelled && !isSplitParent(s));
  const splitParents = new Map(
    round.sessions.filter(isSplitParent).map((s) => [s.id, s])
  );
  const groupKey = (s) => (s.parentSessionId && splitParents.has(s.parentSessionId) ? s.parentSessionId : null);
  const mounts = new Map(); // parent id -> the element its tables render into
  inProgress
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .forEach((session) => {
      const game = session.chosenGameId && round.games.find((g) => g.id === session.chosenGameId);
      const when = fmtDateTime(session.chosenAt || session.createdAt);
      const imgStyle = game && game.image ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"` : '';
      const fallback = game
        ? coverPlaceholder(game)
        : '<i class="ti ti-tornado" aria-hidden="true"></i>';
      let pill = '';
      if (game) {
        const sst = gameStatsForSession(round, session, game.id);
        if (sst.score !== null) pill = `<span class="score-pill" style="background:${scoreColor(sst.score)}">${fmtAvg(displayScore(sst.score))}</span>`;
      }
      const title = game ? esc(game.title) : esc(t('round.inProgressDeciding'));
      const ticket = h(`<a class="ticket ticket--live">
           <span class="ticket__main">
             <span class="ticket__img"${imgStyle}>${fallback}</span>
             <span class="ticket__info">
               <span class="ticket__label">${esc(t('round.inProgressLabel'))}</span>
               <span class="ticket__title">${title}</span>
               <span class="ticket__meta">${esc(when)}${pill}</span>
             </span>
           </span>
           <span class="ticket__stub">
             <i class="ti ti-player-play" aria-hidden="true"></i>
             <span class="ticket__names">${esc(t('round.resume'))}</span>
           </span>
         </a>`);
      navLink(ticket, resultsPath(round.id, session.id), () => showResults(round, session));
      const parentId = groupKey(session);
      if (!parentId) {
        app.appendChild(ticket);
        return;
      }
      // One header per split evening, created by whichever of its tables is
      // rendered first, so the group keeps the newest-first position it earned.
      if (!mounts.has(parentId)) {
        const parent = splitParents.get(parentId);
        const group = h(`<div class="split-group">
             <a class="split-group__head">${iconText('ti-layout-grid', t('tables.parentLabel'))}
               <span class="split-group__link">${esc(t('tables.openParent'))}</span>
             </a>
             <div class="split-group__body"></div>
           </div>`);
        navLink(group.querySelector('.split-group__head'), resultsPath(round.id, parentId), () => showResults(round, parent));
        app.appendChild(group);
        mounts.set(parentId, group.querySelector('.split-group__body'));
      }
      mounts.get(parentId).appendChild(ticket);
    });

  // "Last played" ticket: the newest finished session whose chosen game still
  // exists. Delivers the emotional payoff above the fold; tap opens that result.
  // Ordered by `createdAt` — when the session was played — so this agrees with
  // the Chronik; `finishedAt` changes when an old session is re-finished.
  const lastPlayed = round.sessions
    .filter((s) => s.finished && s.chosenGameId && round.games.some((g) => g.id === s.chosenGameId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (lastPlayed) {
    const game = round.games.find((g) => g.id === lastPlayed.chosenGameId);
    // Winners resolve against the session's own people, so a guest winner shows
    // up here too — marked as a guest (#458).
    const lastPeople = sessionPeople(round, lastPlayed);
    const winnerNames = (lastPlayed.winnerIds || [])
      .map((wid) => personLabel(lastPeople.find((p) => p.id === wid)))
      .filter(Boolean);
    const sst = gameStatsForSession(round, lastPlayed, game.id);
    const when = fmtDateTime(lastPlayed.createdAt);
    const imgStyle = game.image ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"` : '';
    const fallback = coverPlaceholder(game);
    const pill =
      sst.avg !== null
        ? `<span class="score-pill" style="background:${scoreColor(sst.score)}">${fmtAvg(displayScore(sst.score))}</span>`
        : '';
    const ticket = h(`<a class="ticket">
         <span class="ticket__main">
           <span class="ticket__img"${imgStyle}>${fallback}</span>
           <span class="ticket__info">
             <span class="ticket__label">${esc(t('round.lastPlayedLabel'))}</span>
             <span class="ticket__title">${esc(game.title)}</span>
             <span class="ticket__meta">${esc(when)}${pill}</span>
           </span>
         </span>
         <span class="ticket__stub">
           <i class="ti ti-trophy" aria-hidden="true"></i>
           <span class="ticket__names">${winnerNames.length ? esc(joinNames(winnerNames)) : esc(t('sessions.played'))}</span>
         </span>
       </a>`);
    navLink(ticket, resultsPath(round.id, lastPlayed.id), () => showResults(round, lastPlayed));
    app.appendChild(ticket);
  }

  // The retirement recommendations are resolved BEFORE the cards, because the
  // suggestion card has to exclude whatever this banner is about to nag about —
  // a screen that recommends and archives the same game in one render reads as
  // the app disagreeing with itself. The banner is appended further down, in
  // the position it has always had.
  const recs = retireRecommendations(activeGames, statsByGame, round.members.length * 3);
  const nagged = new Set(recs.map((r) => r.game.id));

  // The card grid (#923). Built DETACHED and appended below, so the #869
  // stand-in can ask whether anything landed in it before deciding whether the
  // pane is empty. Every renderer returns null when it has nothing to say, and
  // an all-null grid is never appended at all — a young round meets the screen
  // it met before, not six empty boxes.
  //
  // DOM order is the phone order, action-first.
  const grid = h('<div class="hub-cards"></div>');
  [
    hubSuggestCard(round, activeGames, statsByGame, nagged),
    hubPulseCard(round, activeGames),
    hubCareCard(round, activeGames),
    hubAnniversaryCard(round),
  ].forEach((card) => { if (card) grid.appendChild(card); });

  // From 1280px up the rail owns the hero and the big CTA above, so a round with
  // no ticket to show left the pane holding only `.hub-actions` — one visible
  // child over 816px of bare page, on every young round (#869). This is the
  // pane's stand-in; `.empty--rail-gap` renders it ONLY where the rail exists,
  // because below that width the hero and CTA are right here and it would
  // duplicate them.
  //
  // Asked of the DOM rather than re-deriving the three ticket predicates above,
  // so a fourth kind of ticket is covered without anyone remembering this line.
  // Safe because the rail renders no tickets of its own. Since #923 it asks the
  // detached grid the same way, for the same reason: a card is content, so a
  // pane holding one is not the bare page this stand-in exists for.
  if (!app.querySelector('.ticket') && !grid.querySelector('.hub-card')) {
    const gap = emptyState({
      icon: 'ti-tornado',
      title: t('round.startEmptyTitle'),
      text: t('round.startEmpty'),
    });
    gap.classList.add('empty--rail-gap');
    app.appendChild(gap);
  }

  // Retirement suggestions: a slim, dismissible banner. Enough data = at least
  // three times as many votes as members. Collapsed by default; expand to see
  // the list, or dismiss it for this session.
  if (recs.length && !minimizedRecs.has(round.id)) {
    const banner = h(`<div class="rec-banner">
         <div class="rec-banner__bar" role="button" tabindex="0" aria-expanded="false">
           <span class="rec-banner__text"><i class="ti ti-trash" aria-hidden="true"></i> ${esc(t('rec.title', { n: recs.length }))}</span>
           <div class="rec-banner__actions">
             <i class="ti ti-chevron-down rec-banner__caret" aria-hidden="true"></i>
             <button class="rec-banner__dismiss" title="${esc(t('rec.dismiss'))}" aria-label="${esc(t('rec.dismiss'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
           </div>
         </div>
         <div class="rec-banner__body" hidden>
           <div class="muted rec-banner__sub">${esc(t('rec.sub'))}</div>
           <div class="recommend-list"></div>
         </div>
       </div>`);
    const body = banner.querySelector('.rec-banner__body');
    const bar = banner.querySelector('.rec-banner__bar');
    let expanded = false;
    const toggle = () => {
      expanded = !expanded;
      body.hidden = !expanded;
      banner.classList.toggle('is-open', expanded);
      bar.setAttribute('aria-expanded', String(expanded));
    };
    bar.addEventListener('click', toggle);
    bar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
    banner.querySelector('.rec-banner__dismiss').addEventListener('click', (e) => {
      e.stopPropagation();
      minimizedRecs.add(round.id);
      banner.remove();
    });
    const list = banner.querySelector('.recommend-list');
    recs.slice(0, 5).forEach(({ game, reasons }) => {
      const item = h(`<div class="recommend-item">
           <div class="recommend-item__info">
             <a class="recommend-item__title">${esc(game.title)}</a>
             <span class="recommend-item__reason">${reasons.map(esc).join(' · ')}</span>
           </div>
           <button class="btn recommend-item__btn">${esc(t('rec.retire'))}</button>
         </div>`);
      navLink(item.querySelector('.recommend-item__title'), gamePath(round.id, game.id), () =>
        showGameDetail(round.id, game.id)
      );
      item.querySelector('.recommend-item__btn').addEventListener('click', async () => {
        if (!await confirmDialog({
          body: t('detail.retireConfirm', { title: game.title }),
          confirmLabel: t('detail.retire'), icon: 'ti-trash',
        })) return;
        try {
          await api('POST', `/api/rounds/${round.id}/games/${game.id}/retire`, { retired: true });
          toast(t('games.retired', { title: game.title }));
          showRound(round.id);
        } catch (e) { toast(e.message); }
      });
      list.appendChild(item);
    });
    if (recs.length > 5) {
      list.appendChild(h(`<div class="muted recommend-more">${esc(tn(recs.length - 5, 'rec.moreOne', 'rec.more'))}</div>`));
    }
    app.appendChild(banner);
  }

  // The grid goes below the banner and above the quiet actions, and it is
  // appended even when EMPTY: the teaser below arrives after this function has
  // returned and needs somewhere connected to land, and a grid that was left
  // out because nothing else filled it would silently swallow the one card a
  // young round is most likely to get. `.hub-cards:empty` is `display: none`,
  // so an empty grid costs no margin and no gap — the "renders nothing when it
  // has nothing to say" rule, kept by CSS rather than by an append condition
  // that cannot see the future.
  app.appendChild(grid);

  // Fetched AFTER this paint, never in showRound's Promise.all: the route does
  // a full getRound plus the corpus join, so putting it on the critical path
  // would double the round read for a card that is often empty. Deliberately
  // not awaited — this renderer is synchronous and the tab must not wait on it.
  renderRecoTeaser(round.id, grid);

  // Quick actions: quieter secondary tasks below the fold.
  const actions = h('<div class="hub-actions"></div>');
  const addGameBtn = h(
    `<button class="btn"><i class="ti ti-plus" aria-hidden="true"></i> ${esc(t('round.addGame'))}</button>`
  );
  addGameBtn.addEventListener('click', () => showAddGame(round));
  // One "Einstellungen" entry rather than the three separate Tags/Provider/Design
  // links this used to carry (#561): those three now live INSIDE that screen,
  // together with the round-level actions that were stranded in the Regal and
  // Chronik footers — so a phone reaches every one of them in two taps from here.
  // It is a routed screen, so it is a link (#330); "Spiel hinzufügen" opens a
  // sheet and stays a button. `rail-owned`, because ≥1280px the rail carries it.
  const settingsBtn = h(
    `<a class="btn rail-owned"><i class="ti ti-settings" aria-hidden="true"></i> ${esc(t('rail.settings'))}</a>`
  );
  navLink(settingsBtn, roundPath(rid, 'settings'), () => showRoundSettings(rid));
  actions.appendChild(addGameBtn);
  actions.appendChild(settingsBtn);
  app.appendChild(actions);
}


// =================== Start tab: the card grid (#923) ===================

/* The siblings hub-insights.js needs, gathered in one place so the six cards
   below cannot each assemble a slightly different set. Every entry is the app's
   own function, passed through rather than restated — the injection shape
   hub-insights.js's header explains. */
const hubDeps = () => ({
  outcomeOf: sessionOutcome,
  monthKeyOf: periodKeyOf,
  neutralScore: PRIOR_DEFAULT,
  filterOptions: metadataFilterOptions,
  normalizeMetadata: normalizeMetadataFilters,
  fitsMetadata: fitsMetadataFilters,
});

// One card frame. The title is a real <h2> so the grid reads as a set of
// labelled regions to a screen reader rather than as a wall of links.
function hubCard(icon, title) {
  return h(`<section class="hub-card">
       <h2 class="hub-card__title">${iconText(icon, title)}</h2>
       <div class="hub-card__body"></div>
     </section>`);
}

/* a) Spielvorschläge — the positive mirror of the retirement banner.

   `exclude` is the id set that banner is proposing in this same render, so the
   screen cannot recommend and nag the same game. */
function hubSuggestCard(round, activeGames, statsByGame, exclude) {
  const rows = gameSuggestions(
    round, activeGames, { statsByGame, exclude }, hubDeps()
  );
  if (!rows.length) return null;
  const card = hubCard('ti-bulb', t('hub.suggest.title'));
  const body = card.querySelector('.hub-card__body');
  rows.forEach(({ game, reason }) => {
    const why =
      reason.kind === 'longAgo'
        ? tn(reason.months, 'hub.suggest.longAgoOne', 'hub.suggest.longAgo')
        : t('hub.suggest.' + reason.kind);
    const row = h(`<a class="hub-row">
         <span class="hub-row__main">
           <span class="hub-row__title">${esc(game.title)}</span>
           <span class="hub-row__sub">${esc(why)}</span>
         </span>
         <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
       </a>`);
    navLink(row, gamePath(round.id, game.id), () => showGameDetail(round.id, game.id));
    body.appendChild(row);
  });
  return card;
}

/* b) Schnellstart-Presets — chips under the big CTA that open the session setup
   with the draw already narrowed.

   They sit at the CTA rather than in the grid because they are a modifier on
   the one action this screen exists for, not a module of their own.

   NOTHING IS PERSISTED HERE. `lastSessionFilters` is written server-side by the
   draw itself (POST …/sessions), so an exploratory tap that never draws leaves
   the round's remembered preset exactly as it was — which is a property of
   where the write lives, not a guard this code has to remember. */
function hubPresetChips(round, activeGames) {
  const chips = quickPresets(activeGames, hubDeps());
  if (!chips.length) return null;
  const row = h(`<div class="hub-presets" role="group" aria-label="${esc(t('hub.preset.label'))}"></div>`);
  // The Start tab's copy is `rail-owned` (see the caller); the rail builds its
  // own from the same function, so the two can never offer different chips.
  chips.forEach((chip) => {
    const btn = h(`<button class="chip hub-preset">${esc(t('hub.preset.' + chip.id))}</button>`);
    btn.addEventListener('click', () => showStartSession(round, { metadata: chip.metadata }));
    row.appendChild(btn);
  });
  return row;
}

/* c) Rundenpuls — how often the round meets, when it last did, and how much of
   the shelf has ever reached the table.

   The bars are CSS only. The app ships no chart library and must not gain one
   for twelve numbers (#923 scope): each bar is a <span> with a height
   percentage, which is also why the whole row degrades to readable text when
   styles fail to load. */
function hubPulseCard(round, activeGames) {
  const pulse = roundPulse(round, activeGames, {}, hubDeps());
  if (!pulse) return null;
  const card = hubCard('ti-activity', t('hub.pulse.title'));
  const body = card.querySelector('.hub-card__body');
  const peak = Math.max(...pulse.months.map((m) => m.count), 1);
  // `month: 'narrow'` gives one letter per bar, which is what makes twelve of
  // them fit a 280px card at every locale. The full month name rides along as
  // the accessible name, so the axis is never only a letter.
  const narrow = (at) => new Date(at).toLocaleString(localeTag(locale), { month: 'narrow' });
  const bars = pulse.months
    .map((m) => {
      const label = t('hub.pulse.barLabel', { month: fmtMonth(new Date(m.at).toISOString()), n: m.count });
      return `<span class="pulse-bar" title="${esc(label)}">
           <span class="pulse-bar__fill" style="height:${Math.round((m.count / peak) * 100)}%"></span>
           <span class="pulse-bar__tick" aria-hidden="true">${esc(narrow(m.at))}</span>
         </span>`;
    })
    .join('');
  body.appendChild(h(`<div class="pulse-bars" role="img" aria-label="${esc(tn(pulse.total, 'hub.pulse.sessionsOne', 'hub.pulse.sessions'))}">${bars}</div>`));

  const facts = [tn(pulse.total, 'hub.pulse.sessionsOne', 'hub.pulse.sessions')];
  if (pulse.daysSinceLast !== null) {
    facts.push(
      pulse.daysSinceLast === 0
        ? t('hub.pulse.lastToday')
        : tn(pulse.daysSinceLast, 'hub.pulse.lastDaysOne', 'hub.pulse.lastDays')
    );
  }
  body.appendChild(h(`<p class="muted hub-card__facts">${esc(facts.join(' · '))}</p>`));

  // Shelf coverage links into the Regal, because that is where the untouched
  // games are — the number is only useful if it is one tap from acting on it.
  if (pulse.neverPlayed > 0) {
    const link = h(`<a class="hub-row hub-row--quiet">
         <span class="hub-row__main"><span class="hub-row__sub">${esc(t('hub.pulse.coverage', { n: pulse.neverPlayed, total: pulse.shelfSize }))}</span></span>
         <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
       </a>`);
    navLink(link, roundPath(round.id, 'regal'), () => showRound(round.id, 'regal'));
    body.appendChild(link);
  }
  return card;
}

/* d) Kümmerliste — gaps that quietly degrade other features, each row a link to
   the screen that fixes it.

   Guarded on `game.edit` even though every grantee role clears that floor today,
   for the reason the discard control above states: the routes behind these fixes
   decide on a capability, so the card that points at them asks the same
   question — a re-tightening tomorrow then removes the card instead of leaving
   a list of things the reader is not allowed to do. */
function hubCareCard(round, activeGames) {
  if (!roundCan(round, 'game.edit')) return null;
  const list = careList(round, activeGames, hubDeps());
  if (list.empty) return null;
  const card = hubCard('ti-tool', t('hub.care.title'));
  const body = card.querySelector('.hub-card__body');

  const section = (total, one, many, rows, label, href, go) => {
    if (!total) return;
    body.appendChild(h(`<div class="hub-care__head">${esc(tn(total, one, many))}</div>`));
    rows.forEach((item) => {
      const row = h(`<a class="hub-row hub-row--quiet">
           <span class="hub-row__main"><span class="hub-row__sub">${esc(label(item))}</span></span>
           <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
         </a>`);
      navLink(row, href(item), () => go(item));
      body.appendChild(row);
    });
  };

  // The winnerless rows first: a played evening with no winner is skipped
  // entirely by the Siegwertung (win-score.js), so it is the gap that costs the
  // most and the one nothing else on any screen mentions.
  section(
    list.winnerlessTotal, 'hub.care.winnerOne', 'hub.care.winner', list.winnerless,
    (s) => {
      const g = round.games.find((x) => x.id === s.chosenGameId);
      return g ? t('hub.care.winnerRow', { game: g.title, when: fmtDate(s.createdAt) }) : fmtDate(s.createdAt);
    },
    (s) => resultsPath(round.id, s.id),
    (s) => showResults(round, s)
  );
  section(
    list.noRangeTotal, 'hub.care.rangeOne', 'hub.care.range', list.noRange,
    (g) => g.title, (g) => gamePath(round.id, g.id), (g) => showGameDetail(round.id, g.id)
  );
  section(
    list.coverlessTotal, 'hub.care.coverOne', 'hub.care.cover', list.coverless,
    (g) => g.title, (g) => gamePath(round.id, g.id), (g) => showGameDetail(round.id, g.id)
  );
  return card;
}

/* e) „Heute vor einem Jahr" — rare by construction: on 364 days of the year
   this returns null and nothing is rendered at all. */
function hubAnniversaryCard(round) {
  const found = anniversary(round, {}, hubDeps());
  if (!found) return null;
  const { session, game, years } = found;
  const card = hubCard('ti-confetti', tn(years, 'hub.anniv.yearsOne', 'hub.anniv.years'));
  // Winners resolve against the session's OWN people, so a guest winner is named
  // and marked here exactly as on the ticket above (#458).
  const people = sessionPeople(round, session);
  const names = (session.winnerIds || [])
    .map((wid) => personLabel(people.find((p) => p.id === wid)))
    .filter(Boolean);
  const row = h(`<a class="hub-row">
       <span class="hub-row__main">
         <span class="hub-row__title">${esc(game.title)}</span>
         <span class="hub-row__sub">${esc(names.length ? t('result.winners', { names: joinNames(names) }) : fmtDate(session.createdAt))}</span>
       </span>
       <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
     </a>`);
  navLink(row, resultsPath(round.id, session.id), () => showResults(round, session));
  card.querySelector('.hub-card__body').appendChild(row);
  return card;
}

/* f) Empfehlungs-Teaser — one or two rows from the recommendations screen
   (#682), which below 1280px is reachable only from the desktop rail and is
   therefore effectively invisible on a phone.

   FETCHED AFTER FIRST PAINT, never in showRound's Promise.all: the route does a
   full getRound plus the corpus join, so putting it on the critical path would
   double the round read for a card that is often empty.

   It answers 200 with an empty list — not 404 — for a round below the profile
   floor, an instance with no corpus, and an instance with no BGG_API_TOKEN. All
   three, and any error at all, degrade to rendering nothing; the reader loses a
   teaser they never knew was coming.

   The reason lines go through `recReasonText`, the recommendations screen's own
   phrasing of the server's terms. A second opinion here is precisely the drift
   .claude/rules/shared-constants-across-the-stack.md exists for. */
async function renderRecoTeaser(rid, grid) {
  let data;
  try { data = await api('GET', `/api/rounds/${rid}/recommendations`); }
  catch { return; }
  const recs = (data && data.recommendations) || [];
  if (!recs.length) return;
  // The tab may have been left while the fetch was in flight — a re-render, a
  // tab switch, a navigation. The grid is then detached and appending to it
  // would build a card nobody can ever see, on top of a round that may not even
  // be on screen any more.
  if (!grid.isConnected) return;
  const card = hubCard('ti-sparkles', t('suggest.title'));
  const body = card.querySelector('.hub-card__body');
  recs.slice(0, 2).forEach((rec) => {
    const why = (rec.reasons || []).map(recReasonText).filter(Boolean)[0] || '';
    const row = h(`<div class="hub-row hub-row--static">
         <span class="hub-row__main">
           <span class="hub-row__title">${esc(rec.title)}</span>
           ${why ? `<span class="hub-row__sub">${esc(why)}</span>` : ''}
         </span>
       </div>`);
    body.appendChild(row);
  });
  const more = h(`<a class="hub-row hub-row--quiet">
       <span class="hub-row__main"><span class="hub-row__sub">${esc(t('hub.reco.more'))}</span></span>
       <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
     </a>`);
  navLink(more, roundPath(rid, 'recommendations'), () => showRecommendations(rid));
  body.appendChild(more);
  grid.appendChild(card);
  // This card is content, so the #869 stand-in above is no longer standing in
  // for an empty pane. It was rendered before the fetch resolved — the only
  // ordering available for something deliberately kept off the critical path.
  const gap = grid.parentNode && grid.parentNode.querySelector('.empty--rail-gap');
  if (gap) gap.remove();
}
