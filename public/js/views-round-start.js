/* Spielwirbel – the round hub's Start tab (#923, split out of views-round.js).

   The launchpad: identity, the one big CTA, the tickets that carry the latest
   story — and the grid those tickets sit above. Before #923 a settled round met
   a ticket and a button here, and above 1280px the rail had taken even those,
   which is what `.empty--rail-gap` was invented to paper over.

   THE CARDS THEMSELVES LEFT IN #1189, for hub-cards.js — the seam the banner
   in this file had marked since #923, taken when the file crossed its budget
   (.claude/rules/token-friendly-source-files.md). What is left is the tab: what
   it composes, in what order, and the three things that decide whether a block
   appears at all. The card renderers, their shared frame and the preset chips
   are next door; the three sub-page previews went to hub-previews.js in #1185.

   THE LOAD-BEARING RULE EVERY CARD FOLLOWS: it renders NOTHING when it has
   nothing to say. A brand-new round with three games and no session must meet
   the screen it met before, not six empty boxes — so each renderer returns null
   for that case and the loop below appends only what came back.

   The YOUNG round (#1269, T7.3/T7.4) does not contradict that rule. The rule is
   about not showing six empty boxes; T7 asks instead for ONE named next step —
   the empty table with its two actions on a 0-game round (every design since
   the #1269 merge interview), and under Der Tisch the invitation card and a
   sentence per card („ab wann es Zahlen gibt") once games exist but no session
   does. Each is a single statement of what comes next, never an empty
   container.

   Part of the frontend; all files share one global script scope. Loaded right
   after views-round.js. */

// --- Start tab: the launchpad — identity, the one big CTA, the latest story.
function renderStartTab(round, activeGames) {
  const rid = round.id;

  // Stats per active game (for the retirement recommendations below). Shelf-
  // scoped and built in one pass, for the reason roundScoreIndex states (#894).
  const { byGame: statsByGame } = roundScoreIndex(round, activeGames);

  const playedCount = round.sessions.filter((s) => s.finished).length;
  /* Der Tisch composes the top of the hub as ONE felt band at desktop — seats,
     the one action and its presets together (T3.2, #1262). So under that design
     the three are gathered in a `.hub-stage` wrapper: DOM order is unchanged
     (hero, CTA, presets — the phone order), and CSS alone decides whether the
     band holds just the hero (below 1280) or all three (from 1280 up), so a
     resize needs no re-render. Klassisch appends straight to `app`, exactly as
     before. */
  const tisch = designIs('tisch');
  const stage = tisch ? app.appendChild(h('<div class="hub-stage"></div>')) : app;
  const hero = h(`<div class="hero rail-owned">
       <h1></h1>
       <div class="hero__members">${activeMembers(round)
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
  stage.appendChild(hero);
  // Each hero avatar opens that member's detail page. Queried before the "+" is
  // appended, so the index-to-member mapping cannot pick it up.
  hero.querySelectorAll('.hero__members .avatar').forEach((el, i) => {
    const m = activeMembers(round)[i];
    if (m) makeMemberLink(el, rid, m.id);
  });
  // Add a seat (#563), right where the seats are listed. A real <button>, not a
  // focusable span: it is not inline text sharing a line, so the platform gives
  // focus, Enter and Space for free (.claude/rules/native-button-vs-focusable-span.md).
  hero.querySelector('.hero__members').appendChild(addMemberBtn(round));
  /* Retired seats (#1006), dimmed and after the "+", on the hero ONLY. They are
     off every forward-looking list — the setup seats, teams, rankings, trophies —
     but they have to stay REACHABLE or there is no way back: restoring one
     happens on that member's own page, and nothing else on the screen links to
     it. Appended after the link wiring above so the index-to-member mapping
     cannot pick them up, and given their own link here. */
  (round.members || []).filter((m) => !memberIsActive(m)).forEach((m) => {
    const el = h(`<a class="avatar avatar--retired" style="background:${memberColor(round, m.id)}" title="${esc(t('member.retiredTitle', { name: m.name }))}">${avatarFace(initials(m.name), { userId: m.userId })}</a>`);
    makeMemberLink(el, rid, m.id);
    hero.querySelector('.hero__members').appendChild(el);
  });

  /* `--seat-i` / `--seat-n` are design-NEUTRAL position hints (#1189), written
     LAST so every seat the strip ends up holding is counted: the members, the
     „+" and the retired tail. Nothing in styles.css reads either, so Klassisch's
     strip is the flex line it has always been — but a design that lays the seats
     out as an ARC on the table's edge needs to know which seat this is and how
     many there are, and the offset of one depends on the count, which CSS
     cannot ask for. Same shape as markerStyle(): per-element data handed to CSS
     as an inline custom property. */
  const seatRow = hero.querySelector('.hero__members');
  seatRow.style.setProperty('--seat-n', seatRow.children.length);
  [...seatRow.children].forEach((el, i) => el.style.setProperty('--seat-i', i));
  if (tisch) tischSeatHints(round, seatRow);

  /* `rail-owned` only where the rail still carries its own copy. Der Tisch's
     rail is identity plus the five links (#1262), so there the band's CTA and
     presets are the ONLY ones at every width — one control, one place, one tab
     stop. */
  const railOwned = tisch ? '' : ' rail-owned';
  /* The young round (T7.3, T7.4; #1269). A 0-game round gets the EMPTY TABLE
     right before the locked button, with the two ways to fill it — in EVERY
     design: Klassisch's phone hub had the same dead end (operator, #1269 merge
     interview). Under Der Tisch a round with games and no session yet also has
     the CTA say „Erste Session wirbeln"; the invitation card in the grid carries
     the count. The threshold is the app's own — one active game — not the
     sheet's „ab 2 Spielen" (operator default on #1269). */
  if (activeGames.length === 0) stage.appendChild(hubEmptyTable(round));
  const ctaLabel = tisch && activeGames.length && roundIsYoung(round)
    ? t('hub.young.firstCta') : t('round.startSession');
  const startBtn = h(
    `<button class="btn btn--primary hub-cta${railOwned}"><i class="ti ti-tornado" aria-hidden="true"></i>${esc(ctaLabel)}</button>`
  );
  startBtn.addEventListener('click', () => showStartSession(round));
  if (activeGames.length === 0) {
    startBtn.disabled = true;
    /* The reason is VISIBLE on the button (T7.3), in every design — it used to
       be a `title`, which no touch screen shows and no screen reader reliably
       reads. aria-hidden inside the button so the name stays „Session
       wirbeln", and referenced by aria-describedby so it is still announced,
       as the description (a hidden node is included when referenced). */
    startBtn.appendChild(h(`<span class="hub-cta__reason" id="hub-cta-reason" aria-hidden="true">${esc(t('hub.young.lock'))}</span>`));
    startBtn.setAttribute('aria-describedby', 'hub-cta-reason');
  }
  stage.appendChild(startBtn);

  // Quick-start presets (#923): the same draw, already narrowed. Directly under
  // the CTA because they modify it — and only when this shelf can actually
  // express one, so the row is absent rather than empty.
  if (activeGames.length) {
    const presets = hubPresetChips(round, activeGames);
    // `rail-owned`, exactly like the CTA above: from 1280px up the rail carries
    // both, and a chip row left behind here would modify a button that has left
    // the pane.
    if (presets) {
      if (!tisch) presets.classList.add('rail-owned');
      stage.appendChild(presets);
    }
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
        if (sst.score !== null) pill = `<span class="score-pill" style="--sc:${scoreColor(sst.score)}" data-stop="${scoreStop(sst.score)}">${fmtAvg(displayScore(sst.score))}</span>`;
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
        ? `<span class="score-pill" style="--sc:${scoreColor(sst.score)}" data-stop="${scoreStop(sst.score)}">${fmtAvg(displayScore(sst.score))}</span>`
        : '';
    /* The stub's icon names what is written under it — the convention the three
       live stubs above follow, and the one this ticket broke (#1106): the trophy
       sat OUTSIDE the winner ternary, so a lost evening rendered it over the
       skull „Verloren" carries. Icon and label now come from the same entry, so
       they cannot disagree, and `endingText()` is deliberately NOT used here —
       it returns icon and label as one unit, which is what stacked the second
       glyph. `ENDING_LABELS` has no `won` entry by design (session-outcome.js),
       so the winner branch and the map cannot overlap; don't re-derive the state
       from `winnerIds`/`cancelled`. */
    const ending = ENDING_LABELS[sessionEnding(lastPlayed)];
    const stubIcon = winnerNames.length ? 'ti-trophy' : ending ? ending.icon : 'ti-check';
    const stubLabel = winnerNames.length
      ? joinNames(winnerNames)
      : ending ? t(ending.key) : t('sessions.played');
    const ticket = h(`<a class="ticket">
         <span class="ticket__main">
           <span class="ticket__img"${imgStyle}>${fallback}</span>
           <span class="ticket__info">
             <span class="ticket__label">${esc(t('round.lastPlayedLabel'))}</span>
             <span class="ticket__title">${esc(game.title)}</span>
             <span class="ticket__meta">${esc(when)}${pill}</span>
           </span>
         </span>
         <span class="ticket__stub${winnerNames.length ? '' : ' ticket__stub--plain'}">
           <i class="ti ${stubIcon}" aria-hidden="true"></i>
           <span class="ticket__names">${esc(stubLabel)}</span>
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
  const recs = retireRecommendations(activeGames, statsByGame, activeMembers(round).length * 3);
  const nagged = new Set(recs.map((r) => r.game.id));

  // The card grid (#923). Built DETACHED and appended below, so the #869
  // stand-in can ask whether anything landed in it before deciding whether the
  // pane is empty. Every renderer returns null when it has nothing to say, and
  // an all-null grid is never appended at all — a young round meets the screen
  // it met before, not six empty boxes.
  //
  // DOM order is the phone order, action-first.
  //
  // Each card goes in a `.card-slot`, which carries the flow's vertical spacing
  // (#946) — a margin on the card itself is carried across the column break by
  // WebKit instead of being truncated.
  const grid = h('<div class="hub-cards"></div>');
  [
    // Der Tisch's invitation (T7.4, #1269) leads — it is the one next step.
    // Null on every other round and on Klassisch, so that list is unchanged.
    hubYoungCard(round, activeGames),
    hubSuggestCard(round, activeGames, statsByGame, nagged),
    hubPulseCard(round, activeGames),
    hubCareCard(round, activeGames),
    hubAnniversaryCard(round),
  ].forEach((card) => { if (card) grid.appendChild(cardSlot(card)); });
  // The three sub-page previews (#1185, hub-previews.js), LAST in the grid:
  // "what is over there" is a weaker claim on the reader than "play this
  // tonight". Same null-or-nothing contract as the four above.
  const previews = [
    hubRegalPreview(round, activeGames),
    hubPokalePreview(round),
    hubChronikPreview(round),
  ].filter(Boolean);
  if (tisch && previews.length) {
    /* Der Tisch lays the survivors out as ONE row of small tiles on a phone
       (T2.2, #1263), so they share one slot: two survivors are two half-width
       tiles, never three cells with a hole. From 1280 up the wrapper is
       `display: contents` and each preview is a cell of the 3-wide grid
       (T3.2) — same nodes, CSS picks the presentation. */
    const row = h('<div class="card-slot hub-previews"></div>');
    previews.forEach((card) => row.appendChild(card));
    grid.appendChild(row);
  } else {
    previews.forEach((card) => grid.appendChild(cardSlot(card)));
  }

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
  // The empty table (#1269) is already that stand-in, at every width.
  if (!app.querySelector('.ticket') && !grid.querySelector('.hub-card')
    && !app.querySelector('.empty--table')) {
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

  /* „Nicht im Regal" (#1185): the four off-shelf destinations under one heading,
     at EVERY width — below the grid because they are navigation rather than
     content, above the quick actions because they are destinations rather than
     tasks. Unconditional, unlike every card above: a screen is not less
     reachable for being empty, and the Wunschliste of a round that has never
     used one is exactly where someone goes to start. */
  app.appendChild(hubOffShelfGroup(round));

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
  // A 0-game round's empty table already carries „Spiel hinzufügen" as its
  // primary action; a second copy two screens down would be the same control
  // twice (#1269).
  if (activeGames.length) actions.appendChild(addGameBtn);
  actions.appendChild(settingsBtn);
  app.appendChild(actions);
}

/* Der Tisch's seat captions (T2.1, T3.2; #1262/#1263): a name under each seat,
   the member's win count as a badge, a crown on whoever leads the standings and
   „Platz dazu" under the „+". Tisch-only — Klassisch's strip stays the bare row
   of discs it has always been, so this runs behind `designIs('tisch')` rather
   than as a design-neutral hint every design pays for in its DOM.

   The counts come from roundStandings() (views-pokale.js), never a second tally:
   the seat that wears the crown and the Pokale's top step must be the same
   person, and two derivations over the same sessions is the drift
   `.claude/rules/shared-constants-across-the-stack.md` is about. A tie for first
   crowns every member on that step — `rankOf` already says they share it.

   The caption is REAL text inside the seat's link, so it also completes the
   link's accessible name (the initials were all it had). The badge and crown
   are aria-hidden: the count goes into the `title` beside the name it belongs
   to, and the Pokale one tap away carry the full table. A zero is not badged —
   a „0" on every newcomer is noise, not a record. */
function tischSeatHints(round, seatRow) {
  const { wins, rankOf } = roundStandings(round);
  const caption = (el, text) => el.appendChild(h(`<span class="seat__cap">${esc(text)}</span>`));
  const seats = [...seatRow.querySelectorAll(':scope > a.avatar:not(.avatar--retired)')];
  activeMembers(round).forEach((m, i) => {
    const el = seats[i];
    if (!el) return;
    caption(el, m.name);
    const n = wins[m.id] || 0;
    if (n === 0) return;
    el.title = `${m.name} · ${tn(n, 'pokale.winsOne', 'pokale.wins')}`;
    el.appendChild(h(`<span class="seat__wins" aria-hidden="true">${n}</span>`));
    if (rankOf[m.id] === 1) el.appendChild(h('<i class="ti ti-crown seat__crown" aria-hidden="true"></i>'));
  });
  // aria-hidden: the „+" button's aria-label is its name, and would override a
  // caption inside it anyway — this keeps the tree saying what it means.
  const add = seatRow.querySelector(':scope > .avatar--add');
  if (add) add.appendChild(h(`<span class="seat__cap" aria-hidden="true">${esc(t('hub.seat.add'))}</span>`));
  const retired = (round.members || []).filter((m) => !memberIsActive(m));
  seatRow.querySelectorAll(':scope > a.avatar--retired').forEach((el, i) => {
    if (retired[i]) caption(el, retired[i].name);
  });
}

/* The EMPTY TABLE (T7.3, #1269): a 0-game round's one next step — „Der Topf ist
   noch leer", a sentence, and the two ways to fill the pot. The same
   `emptyState` every other empty screen uses, plus its actions, so each design
   paints it with the material it already gives `.empty` (Der Tisch's felt
   medallion, #1194). Every design since the #1269 merge interview.

   „Von BGG übernehmen" only where the import exists (canImportBgg — accounts
   mode), and the sentence drops its BGG half with it: copy that points at a
   button which is not there is the kind of promise T7 exists to stop making. */
function hubEmptyTable(round) {
  const bgg = canImportBgg();
  const table = emptyState({
    icon: 'ti-tornado',
    title: t('hub.young.emptyTitle'),
    text: t(bgg ? 'hub.young.emptyTextBgg' : 'hub.young.emptyText'),
  });
  table.classList.add('empty--table');
  const actions = h('<div class="empty__actions"></div>');
  const add = h(`<button class="btn btn--primary"><i class="ti ti-plus" aria-hidden="true"></i> ${esc(t('round.addGame'))}</button>`);
  add.addEventListener('click', () => showAddGame(round));
  actions.appendChild(add);
  if (bgg) {
    const imp = h(`<button class="btn"><i class="ti ti-download" aria-hidden="true"></i> ${esc(t('bggImport.tile'))}</button>`);
    imp.addEventListener('click', () => showBggImport(round));
    actions.appendChild(imp);
  }
  table.appendChild(actions);
  return table;
}
