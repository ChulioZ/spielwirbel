/* Spielwirbel – the round hub's Start tab (#923, split out of views-round.js).

   ONE STAGE (#1853): the seats, whatever session is running, the one action
   („Session wirbeln") and ONE row of chips under it — „Direkt wählen" first,
   then the quick-start presets. Below the stage only what a group needs often:
   „Zuletzt gespielt" (carrying the last session's new Abzeichen), „Wie wär's
   mit", one folded „Zu tun · n" row and a slim challenge row. Nothing here
   restates another screen: the Regal/Pokale/Chronik previews, „Weitere
   Listen", the recommendations teaser, the Rundenpuls and the Regal-Steckbrief
   all left in #1853 (the dock, the tab strip and the rail reach every one of
   those sections at every width, and #1852 gave the pulse and the profile
   their own homes). Don't bring a preview back: a fact twice on one screen is
   what the 2026-11-21 deep-dive measured as half the phone height.

   THE STAGE SAYS WHERE THE ROUND STANDS (#1854): one sentence, what it is
   about on the table and the state's own primary (stageState in
   stage-state.js, drawn by hub-stage-say.js). While a session is open its
   primary leads and „Session wirbeln" becomes the second action; while a vote
   runs the chip row is not drawn at all.

   WHAT IS RUNNING SITS ABOVE THE ACTION. An open vote is the evening already in
   progress, so its ticket leads the stage and „Session wirbeln" — starting a
   second one — follows it. „Abstimmung verwerfen" is not here at all any more:
   it lives in the voting lobby (showSessionLobby), the screen the ticket opens.

   THE CARDS THEMSELVES live in hub-cards.js — the seam the banner in this file
   had marked since #923. What is left is the tab: what it composes, in what
   order, and where each design wants it.

   THE LOAD-BEARING RULE EVERY CARD FOLLOWS: it renders NOTHING when it has
   nothing to say. A brand-new round with three games and no session must meet
   the screen it met before, not six empty boxes — so each renderer returns null
   for that case and the loop below appends only what came back.

   The YOUNG round (#1269, T7.3/T7.4) does not contradict that rule: the empty
   table on a 0-game round and Der Tisch's invitation card are each a single
   statement of what comes next, never an empty container.

   Part of the frontend; all files share one global script scope. Loaded right
   after views-round.js. */

// --- Start tab: the stage, then what is used often.
function renderStartTab(round, activeGames) {
  const rid = round.id;

  // Stats per active game (for the retirement recommendations below). Shelf-
  // scoped and built in one pass, for the reason roundScoreIndex states (#894).
  const { byGame: statsByGame } = roundScoreIndex(round, activeGames);

  const playedCount = round.sessions.filter((s) => s.finished).length;
  /* Der Tisch composes the top of the hub as ONE felt band at desktop — seats,
     what is running, the one action and its chips together (T3.2, #1262). DOM
     order is the phone order, and CSS alone decides whether the band holds just
     the hero (below 1280) or all of it (from 1280 up). Klassisch appends
     straight to `app`. */
  const tisch = designIs('tisch');
  /* Ocean and Forest compose the hub as three columns at desktop and one at a
     phone (O3.2, F3.2; #1211, #1466): the crew, the main column with the one
     action, and the aside — real DOM columns, so the phone order IS the DOM
     order. Since #1853 the aside carries the „Zu tun" and challenge rows. */
  const ocean = designIs('ocean');
  const forest = designIs('forest');
  const cols = ocean ? oceanHubFrame() : forest ? forestHubFrame() : null;
  if (cols) app.appendChild(cols.root);
  /* Die Brücke (#1238, B2.2/B3.1) lays the hub out as named slots in the phone
     order (bruecke-hub.js), moved into column wrappers from 1280 (#1496). */
  const bh = designIs('bruecke') ? brueckeHubFrame() : null;
  if (bh) app.appendChild(bh.root);
  /* Das Programmheft sets the hub as a printed front page (P3.2, P2.1; #1372):
     the head, the black box with the one action, the lead story and the side
     column — real DOM cells (programmheft-hub.js). */
  const ph = designIs('programmheft') ? phHubFrame() : null;
  if (ph) app.appendChild(ph.root);
  const stage = tisch ? app.appendChild(h('<div class="hub-stage"></div>'))
    : cols ? cols.crew : bh ? bh.crew : ph ? ph.head : app;
  // Where the running tickets, the one action and its chips go, and where the
  // rest follows them.
  const launch = cols ? cols.main : bh ? bh.mission : ph ? ph.box : stage;
  const feed = cols ? cols.main : bh ? bh.feed : ph ? ph.more : app;
  // Where the „Zu tun" and challenge rows go: each design's side column.
  const side = cols ? cols.aside : bh ? bh.care : ph ? ph.side : feed;
  const hero = h(`<div class="hero${cols || bh || ph ? '' : ' rail-owned'}">
       <h1></h1>
       <div class="hero__members">${activeMembers(round)
         .map((m) => `<a class="avatar" style="background:${memberColor(round, m.id)}" title="${esc(m.name)}">${avatarFace(initials(m.name), { userId: m.userId })}</a>`)
         .join('')}</div>
     </div>`);
  // The name is inline-editable (#562); the rail's copy of this heading carries
  // the same affordance for widths where CSS hides the hero.
  const h1 = hero.querySelector('h1');
  h1.appendChild(editableRoundName(round));
  /* Einstellungen as a gear on the round's name (#1853) — the one way to the
     round's settings from this tab at every width. Forest and the Programmheft
     print their own labelled link in their head (forestHeroCompose,
     phHeroCompose), so they get no second one. Klassisch's rail keeps its own
     entry: that one is navigation (persistent-chrome-defines-the-main-pages). */
  if (!forest && !ph) h1.appendChild(hubSettingsGear(round));
  stage.appendChild(hero);
  // Each hero avatar opens that member's detail page. Queried before the "+" is
  // appended, so the index-to-member mapping cannot pick it up.
  hero.querySelectorAll('.hero__members .avatar').forEach((el, i) => {
    const m = activeMembers(round)[i];
    if (m) makeMemberLink(el, rid, m.id);
  });
  // Add a seat (#563), right where the seats are listed — a real <button>
  // (.claude/rules/native-button-vs-focusable-span.md).
  hero.querySelector('.hero__members').appendChild(addMemberBtn(round));
  /* Retired seats (#1006), dimmed and after the "+", on the hero ONLY: restoring
     one happens on that member's own page, and nothing else on the screen links
     to it. Appended after the link wiring above so the index-to-member mapping
     cannot pick them up. */
  (round.members || []).filter((m) => !memberIsActive(m)).forEach((m) => {
    const el = h(`<a class="avatar avatar--retired" style="background:${memberColor(round, m.id)}" title="${esc(t('member.retiredTitle', { name: m.name }))}">${avatarFace(initials(m.name), { userId: m.userId })}</a>`);
    makeMemberLink(el, rid, m.id);
    hero.querySelector('.hero__members').appendChild(el);
  });

  /* `--seat-i` / `--seat-n` are design-NEUTRAL position hints (#1189), written
     LAST so every seat the strip ends up holding is counted: a design that lays
     the seats out as an ARC needs to know which seat this is and how many there
     are, which CSS cannot ask for. */
  const seatRow = hero.querySelector('.hero__members');
  seatRow.style.setProperty('--seat-n', seatRow.children.length);
  [...seatRow.children].forEach((el, i) => el.style.setProperty('--seat-i', i));
  if (tisch) tischSeatHints(round, seatRow);
  if (ocean) oceanHeroCompose(round, hero);
  if (bh) brueckeHeroCompose(round, hero, playedCount);
  if (ph) phHeroCompose(round, hero);
  if (forest) forestHeroCompose(round, hero);

  /* `rail-owned` only where the rail still carries its own copy. Der Tisch's
     rail is identity plus the five links (#1262), so there the band's CTA and
     chips are the ONLY ones at every width. */
  const railOwned = railIsLean() ? '' : ' rail-owned';

  /* --- The stage SAYS where the round stands (#1854): one sentence, the
     state's own primary where it has one, what it is about on the table
     (hub-stage-say.js). It speaks for the newest open session; any other one
     stays a ticket directly under it (#1853 put them ABOVE the action). Die
     Brücke's sit in its mission slot ahead of the Missionskontrolle panel; the
     Programmheft's at the top of the black box, over its kicker. A 0-game round
     keeps the empty table below instead of a sentence. */
  const st = stageOf(round, activeGames);
  const say = st.kind === 'empty' ? null : hubStageSay(round, st);
  const running = hubRunningTickets(round, st.session ? st.session.id : null);
  if (ph) [running, say].forEach((el) => { if (el) launch.prepend(el); });
  else [say, running].forEach((el) => { if (el) launch.appendChild(el); });
  // While a session is open the stage's own primary leads, and „Session
  // wirbeln" becomes the second action under it.
  const busy = st.kind === 'running' || st.kind === 'table';

  /* The young round (T7.3, T7.4; #1269). A 0-game round gets the EMPTY TABLE
     right before the locked button, with the two ways to fill it — in EVERY
     design. Die Brücke folds it into the Missionskontrolle (B7.1); Forest puts it
     UNDER the stump (F7.3, #1471 — forestYoung). */
  if (activeGames.length === 0 && !bh && !forest) (ph ? ph.lead : launch).appendChild(hubEmptyTable(round));
  // Ocean's one themed verb, „Abtauchen" (O9 §2), on the one action; Die
  // Brücke's „Mission starten" with its own glyph (B9 „Hauptaktion 1").
  const ctaLabel = st.kind === 'running' ? t('hub.stage.newSession')
    : ocean ? t('round.startSessionOcean')
    : bh ? t('round.startSessionBruecke')
      : activeGames.length && roundIsYoung(round)
        ? t('hub.young.firstCta') : t('round.startSession');
  const startBtn = h(
    `<button class="btn ${busy ? 'hub-cta--second' : 'btn--primary'} hub-cta${railOwned}"><i class="ti ${bh ? 'ti-rocket' : 'ti-tornado'}" aria-hidden="true"></i>${esc(ctaLabel)}</button>`
  );
  startBtn.addEventListener('click', () => showStartSession(round));
  if (activeGames.length === 0) {
    startBtn.disabled = true;
    /* The reason is VISIBLE on the button (T7.3), in every design. aria-hidden
       inside the button so the name stays „Session wirbeln", and referenced by
       aria-describedby so it is still announced, as the description. */
    startBtn.appendChild(h(`<span class="hub-cta__reason" id="hub-cta-reason" aria-hidden="true">${esc(t('hub.young.lock'))}</span>`));
    startBtn.setAttribute('aria-describedby', 'hub-cta-reason');
  }
  if (bh) launch.appendChild(brueckeMission(startBtn, round, activeGames));
  else launch.appendChild(ocean ? oceanShell(startBtn) : forest ? forestStump(activeGames.length ? startBtn : null) : startBtn);
  // Forest's empty table stands UNDER the stump (F7.3). What a young round is
  // waiting for is the stage's sentence now (#1854), in every design.
  const forestLine = forest && forestYoung(round, activeGames);
  if (forestLine) launch.appendChild(forestLine);

  /* ONE chip row under the action (#1853): „Direkt wählen" first, then the
     quick-start presets — hubPresetChips builds both, for the rail too. It does
     not wrap; on a phone it scrolls sideways (styles.css). `rail-owned` exactly
     like the CTA above: from 1280px up Klassisch's rail carries both. While a
     vote runs there is no row at all (#1854, decided 2026-11-21): the one
     thing to do is finish that vote, and „Neue Session wirbeln" is still there
     for a second one. */
  if (st.kind !== 'running') {
    const chips = hubPresetChips(round, activeGames);
    if (!railIsLean()) chips.classList.add('rail-owned');
    if (ph && chips.querySelector('.hub-preset:not(.hub-preset--direct)')) launch.appendChild(phPresetsLabel());
    if (forest) chips.prepend(forestPresetsLabel());
    // Die Brücke: inside the Missionskontrolle panel, under the ignition.
    (bh ? launch.querySelector('.bruecke-mission') : launch).appendChild(chips);
  }
  // „Einfacher Modus" offer (#1768): below the one action, above what it hides.
  const simplePrompt = simpleModePromptCard(round);
  if (simplePrompt) feed.appendChild(simplePrompt);

  // --- „Zuletzt gespielt": the newest finished session whose chosen game still
  // exists. Ordered by `createdAt` — when it was played — so this agrees with
  // the Chronik. It carries the last session's new Abzeichen (#1853), the one
  // fact only the Pokale preview used to say (hubBadgeLine, views-badges.js).
  /* Ocean and Forest set „Zuletzt gespielt" and „Wie wär's mit" side by side
     under the action (O3.2) and stacked on a phone (O2.1): one wrapper, dropped
     again if neither has anything to say. */
  const pair = cols ? cols.main.appendChild(h(`<div class="${forest ? 'forest-pair' : 'ocean-pair'}"></div>`)) : null;
  const lastPlayed = newestSessionsFirst(round.sessions
    .filter((s) => s.finished && s.chosenGameId && round.games.some((g) => g.id === s.chosenGameId)))[0];
  const badges = lastPlayed ? hubBadgeLine(round) : null;
  if (lastPlayed && ph) {
    const game = round.games.find((g) => g.id === lastPlayed.chosenGameId);
    const people = sessionPeople(round, lastPlayed);
    const sst = gameStatsForSession(round, lastPlayed, game.id);
    const lead = phLead({
      game,
      winnerNames: (lastPlayed.winnerIds || []).map((wid) => personLabel(people.find((p) => p.id === wid))).filter(Boolean),
      ending: sessionEnding(lastPlayed),
      when: fmtSessionWhen(lastPlayed),
      score: sst.avg !== null ? fmtAvg(displayScore(sst.score)) : '',
      pot: (lastPlayed.gameIds || []).length,
      note: youngRoundPlayed(round, hubDeps()) < YOUNG_ROUND_SERIES_FROM
        ? tn(YOUNG_ROUND_SERIES_FROM, 'hub.young.seriesOne', 'hub.young.series') : '',
    });
    if (badges) lead.querySelector('.ph-lead__open').before(badges);
    navLink(lead, resultsPath(round.id, lastPlayed.id), () => showResults(round, lastPlayed));
    ph.lead.appendChild(lead);
  } else if (lastPlayed && forest) {
    const lead = forestLead(round, lastPlayed);
    if (badges) lead.querySelector('.forest-last__text').appendChild(badges);
    pair.appendChild(lead);
  } else if (lastPlayed) {
    const ticket = hubLastTicket(round, lastPlayed);
    if (badges) ticket.querySelector('.ticket__info').appendChild(badges);
    (ocean ? pair : bh ? bh.last : app).appendChild(ticket);
  }

  // The retirement recommendations are resolved BEFORE the cards, because the
  // suggestion card has to exclude whatever the „Zu tun" row is about to nag
  // about — a screen that recommends and archives the same game in one render
  // reads as the app disagreeing with itself.
  // „Einfacher Modus" (#1646): the gentle retire nudges ride `suggestions`.
  const recs = simpleHidden('suggestions') ? []
    : retireRecommendations(activeGames, statsByGame, activeMembers(round).length * 3);
  const nagged = new Set(recs.map((r) => r.game.id));

  // The card grid (#923). Every renderer returns null when it has nothing to
  // say, and `.hub-cards:empty` is `display: none`. Each card goes in a
  // `.card-slot`, which carries the flow's vertical spacing (#946).
  const grid = h('<div class="hub-cards"></div>');
  // The demo's „Gefällt dir das?" invitation (T7.6, #1280) leads every design's
  // demo hub; Forest's is a band over the whole hub (F7.6, #1471).
  if (isDemoAccount()) {
    const invite = hubDemoInvite();
    if (forest) cols.root.before(invite);
    else if (ph) ph.lead.appendChild(invite);
    else grid.appendChild(cardSlot(invite));
  }
  const suggest = hubSuggestCard(round, activeGames, statsByGame, nagged);
  if (cols) {
    if (suggest) pair.appendChild(suggest);
    if (!pair.children.length) pair.remove();
  }
  if (bh && suggest) bh.suggest.appendChild(suggest);
  if (ph) { // a young round's empty suggestion stands as a locked block (#1377)
    const youngSuggest = phYoungSide(round, activeGames, { suggest });
    if (youngSuggest) ph.suggest.appendChild(youngSuggest);
  }
  [
    cols || bh || ph ? null : suggest,
    hubAnniversaryCard(round),
  ].forEach((card) => { if (card) grid.appendChild(cardSlot(card)); });

  // --- The two slim rows: a running (or just-ended) challenge, and „Zu tun".
  const challenge = hubChallengeRow(round);
  if (challenge) side.appendChild(challenge);
  const todo = hubTodoRow(round, activeGames, recs);
  if (todo) side.appendChild(todo);

  /* No rail stand-in any more (#869 → #1854): from 1280px up the rail takes
     Klassisch's hero and big CTA, and the pane used to be left bare on a young
     round. The stage's sentence (.hub-say) is not rail-owned and renders for
     every round with a game, and a 0-game round has the empty table — so a
     pane with nothing in it is a state this tab can no longer reach. */
  if (grid.children.length) (bh ? bh.more : feed).appendChild(grid);
  if (bh) brueckeStatus();
}

/* The Einstellungen gear on the round's name (#1853). A routed screen, so a
   link (#330). Named by its label: the glyph alone says nothing to a screen
   reader. */
function hubSettingsGear(round) {
  const a = h(`<a class="hero__settings" aria-label="${esc(t('rail.settings'))}" title="${esc(t('rail.settings'))}"><i class="ti ti-settings" aria-hidden="true"></i></a>`);
  return navLink(a, roundPath(round.id, 'settings'), () => showRoundSettings(round.id));
}

/* The running sessions as tickets (#1853 moved them above the action): open
   votes, then sessions whose voting is done but that have no final state yet.
   Null when nothing is running, so the stage carries no empty wrapper.
   `except` is the session the stage's sentence already speaks for (#1854). */
function hubRunningTickets(round, except = null) {
  const wrap = h('<div class="hub-running"></div>');
  // Open votes. Every open session's votes live on the server as they are
  // given (#655), so voting is simply still running, here or on someone's phone.
  // The draw stays secret until everyone has rated, so this ticket shows
  // neither cover nor title — only how many games were drawn.
  newestSessionsFirst(round.sessions.filter((s) => !s.done && !s.cancelled && s.id !== except)).forEach((session) => {
    const n = (session.gameIds || []).length;
    const ticket = h(`<button class="ticket ticket--live">
         <span class="ticket__main">
           <span class="ticket__img"><i class="ti ti-tornado" aria-hidden="true"></i></span>
           <span class="ticket__info">
             <span class="ticket__label">${esc(t('round.liveLabel'))}</span>
             <span class="ticket__title">${esc(tn(n, 'round.draftTitleOne', 'round.draftTitle'))}</span>
             <span class="ticket__meta">${esc(fmtSessionWhen(session))}</span>
           </span>
         </span>
         <span class="ticket__stub">
           <i class="ti ti-player-play" aria-hidden="true"></i>
           <span class="ticket__names">${esc(t('round.liveVote'))}</span>
         </span>
       </button>`);
    // The lobby is the entry point every participant uses — and, since #1853,
    // where „Abstimmung verwerfen" lives.
    ticket.addEventListener('click', () => showSessionLobby(round, session));
    wrap.appendChild(ticket);
  });

  /* "In progress": voting done, no final state yet. A split parent (#796) is
     resolved — its tables are the sessions still open — so it is excluded by
     outcome, and its children are nested under one header, so three tickets at
     the same minute read as one evening's three tables. */
  const inProgress = round.sessions
    .filter((s) => s.done && !s.finished && !s.cancelled && !isSplitParent(s) && s.id !== except);
  const splitParents = new Map(round.sessions.filter(isSplitParent).map((s) => [s.id, s]));
  const groupKey = (s) => (s.parentSessionId && splitParents.has(s.parentSessionId) ? s.parentSessionId : null);
  const mounts = new Map(); // parent id -> the element its tables render into
  newestSessionsFirst(inProgress).forEach((session) => {
    const game = session.chosenGameId && round.games.find((g) => g.id === session.chosenGameId);
    const when = fmtSessionWhen(session, session.chosenAt || session.createdAt);
    const imgStyle = game && game.image ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"` : '';
    const fallback = game ? coverPlaceholder(game) : '<i class="ti ti-tornado" aria-hidden="true"></i>';
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
      wrap.appendChild(ticket);
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
      wrap.appendChild(group);
      mounts.set(parentId, group.querySelector('.split-group__body'));
    }
    // Prepended: a split's tables share one stamp and arrive last table first
    // (#1622); prepending puts table 1 back on top, as the Chronik nests them.
    mounts.get(parentId).prepend(ticket);
  });
  return wrap.children.length ? wrap : null;
}

/* The „Zuletzt gespielt" ticket of Klassisch, Der Tisch, Ocean and Die Brücke.
   The stub's icon names what is written under it (#1106): icon and label come
   from the same entry, so they cannot disagree. `ENDING_LABELS` has no `won`
   entry by design (session-outcome.js). */
function hubLastTicket(round, lastPlayed) {
  const game = round.games.find((g) => g.id === lastPlayed.chosenGameId);
  // Winners resolve against the session's own people, so a guest winner shows
  // up here too — marked as a guest (#458).
  const lastPeople = sessionPeople(round, lastPlayed);
  const winnerNames = (lastPlayed.winnerIds || [])
    .map((wid) => personLabel(lastPeople.find((p) => p.id === wid)))
    .filter(Boolean);
  const sst = gameStatsForSession(round, lastPlayed, game.id);
  const imgStyle = game.image ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"` : '';
  const pill = sst.avg !== null
    ? `<span class="score-pill" style="--sc:${scoreColor(sst.score)}" data-stop="${scoreStop(sst.score)}">${fmtAvg(displayScore(sst.score))}</span>`
    : '';
  const ending = ENDING_LABELS[sessionEnding(lastPlayed)];
  const stubIcon = winnerNames.length ? 'ti-trophy' : ending ? ending.icon : 'ti-check';
  const stubLabel = winnerNames.length ? joinNames(winnerNames) : ending ? t(ending.key) : t('sessions.played');
  const ticket = h(`<a class="ticket">
       <span class="ticket__main">
         <span class="ticket__img"${imgStyle}>${coverPlaceholder(game)}</span>
         <span class="ticket__info">
           <span class="ticket__label">${esc(t('round.lastPlayedLabel'))}</span>
           <span class="ticket__title">${esc(game.title)}</span>
           <span class="ticket__meta">${esc(fmtSessionWhen(lastPlayed))}${pill}</span>
         </span>
       </span>
       <span class="ticket__stub${winnerNames.length ? '' : ' ticket__stub--plain'}">
         <i class="ti ${stubIcon}" aria-hidden="true"></i>
         <span class="ticket__names">${esc(stubLabel)}</span>
       </span>
     </a>`);
  navLink(ticket, resultsPath(round.id, lastPlayed.id), () => showResults(round, lastPlayed));
  return ticket;
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
