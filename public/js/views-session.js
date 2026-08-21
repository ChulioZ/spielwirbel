/* Spielwirbel – views: session setup, voting (hot-seat),
   finale reveal, results podium. Part of the frontend; all files share one
   global script scope. */

// =================== Session: setup ===================

function showStartSession(round) {
  currentView = () => showStartSession(round);
  // Reached either from the hub CTA or by backing out of the wizard; either way
  // the wizard (if any) is over, so drop its flow before claiming the entry.
  endFlow();
  syncUrl(sessionSetupPath(round.id));
  setContext(round.name);
  setDocTitle(t('startSession.title'), round.name);
  app.innerHTML = '';
  app.appendChild(h(`<div class="page-head"><h1>${esc(t('startSession.title'))}</h1></div>`));

  const activeGames = round.games.filter(isActiveGame);

  // These two headings label a group of buttons, not a form control, so they are
  // <div class="label">, not <label> (#145): a <label> with no `for` and no
  // wrapped input labels nothing at all. `aria-labelledby` on the group is what
  // actually ties the text to the seats/chips.
  //
  // `.setup-grid` splits the screen along the two questions it actually asks:
  // WHO is at the table (left) and WHAT gets drawn (right — the two controls
  // that shape the pool, the resulting pool itself, and the button that draws
  // from it). From 860px up that is two columns; below it the grid is a plain
  // block, so the DOM order below IS the phone order — and it is byte-for-byte
  // the order this screen already had, so nothing moves on a phone.
  //
  // The pool is rendered twice on purpose — a tile panel beside the form, the
  // compact overlapping strip below it — and CSS picks one by width, the same
  // "render both, let the viewport decide" shape the rail and dock use. Both are
  // filled by the one updateHint() below, so they cannot drift.
  const form = h(`<div class="setup-grid">
      <div class="setup-grid__main">
        <div class="field">
          <div class="field__label" id="seatsLabel">${esc(t('startSession.membersLabel'))}</div>
          <div id="seatMount"></div>
          <div class="muted field__hint center">${esc(t('startSession.membersNote'))}</div>
        </div>
        <div id="guestMount"></div>
        <div id="teamMount"></div>
      </div>
      <div class="setup-grid__aside">
        <div class="field" id="gamesFilterField" hidden>
          <div class="field-head">
            <div class="field__label" id="tagFilterLabel">${esc(t('startSession.whichGames'))}</div>
            <span id="tagBulkMount"></span>
          </div>
          <div id="tagModeMount"></div>
          <div class="filter-chips" id="filterChips" role="group" aria-labelledby="tagFilterLabel"></div>
        </div>
        <div id="metaFilterMount"></div>
        <div class="field">
          <label for="count">${esc(t('startSession.countLabel'))}</label>
          <div class="stepper">
            <button type="button" class="stepper__btn" data-d="-1" aria-label="−"><i class="ti ti-minus" aria-hidden="true"></i></button>
            <input id="count" class="stepper__val" inputmode="numeric" value="3" />
            <button type="button" class="stepper__btn" data-d="1" aria-label="+"><i class="ti ti-plus" aria-hidden="true"></i></button>
          </div>
        </div>
        <div class="setup-panel">
          <h2 class="setup-panel__title" id="poolTitle"></h2>
          <div class="setup-panel__body" id="poolGrid"></div>
        </div>
        <div class="pool-hint" id="poolHint"></div>
        <div id="poolReset"></div>
        <div class="toolbar">
          <button id="go" class="btn btn--primary btn--lg"><i class="ti ti-tornado" aria-hidden="true"></i> ${esc(t('startSession.draw'))}</button>
        </div>
      </div>
    </div>`);
  app.appendChild(form);

  // Custom-tag filter (#238, tri-state #241): all ignored by default = no tag
  // filter. Map<tagId, 'include'|'exclude'>; included tags combine per
  // `tagFilterState.tagMode` (#726 — 'all' by default, 'any' for at least one),
  // excluded tags reject a game carrying any of them in either mode.
  // Preset from the round's last draw-flow session (#252) when there is one;
  // tag ids whose tag has since been deleted are dropped, mirroring the
  // drop-unknown-ids rule the backend applies at session-creation time.
  const preset = round.lastSessionFilters || null;
  const selectedTags = new Map();
  // An absent key reads as 'all' — every pre-#726 preset, and every AND draw.
  const tagFilterState = { tagMode: preset && preset.tagMode === 'any' ? 'any' : 'all' };
  if (preset) {
    const known = new Set((round.tags || []).map((tg) => tg.id));
    (preset.tagIds || []).filter((x) => known.has(x)).forEach((x) => selectedTags.set(x, 'include'));
    (preset.excludeTagIds || [])
      .filter((x) => known.has(x) && !selectedTags.has(x))
      .forEach((x) => selectedTags.set(x, 'exclude'));
  }
  // The metadata filters (#725), preset from the same #252 blob. Normalizing
  // against THIS shelf's options is what drops a category no game carries any
  // more — the exact counterpart of the deleted-tag drop above, and the reason a
  // filter can never survive as an invisible active count over a control the
  // disclosure no longer renders.
  const metaFilters = normalizeMetadataFilters(
    preset && preset.metadata,
    metadataFilterOptions(activeGames)
  );
  // All members join by default; the number of people joining filters the games
  // by their player count.
  const joining = new Set(round.members.map((m) => m.id));
  // Guests (#458): plain names, held only here until the draw POSTs them — the
  // server mints their ids. Frozen at the draw, exactly like the seat selection.
  // The field is shared with the direct-play sheet (#532); its callback names
  // `seatTable` and `updateHint`, both declared below, which is safe because it
  // only ever runs on a click (.claude/rules/frontend-script-load-order.md).
  const guestPicker = renderGuestPicker(t('startSession.guestsNote'), () => {
    seatTable.refreshSeats();
    teamPicker.refreshTeams();
    updateHint();
  });
  const guests = guestPicker.guests;
  // Teams (#575): two or more of the people above playing as one party. Frozen
  // at the draw like the seats and the guests, and the reason the pool count
  // below is not simply a headcount.
  const teamPicker = renderTeamPicker(round, joining, guestPicker, t('startSession.teamsNote'), () => updateHint());
  const playerCount = () =>
    joining.size + guests.length - teamPicker.teamedPeopleCount() + teamPicker.teamCount();

  // Games matching the tag filter, whose player range fits the joining count.
  // Guests sit at the table, so they count here, and a team counts once however
  // many people it holds (#575). The range clause and the active filter above are
  // the SERVER's own (draw-pool.js, required by lib/draw.js), so this preview
  // cannot promise a pool the draw would not produce — only the tag filter is
  // expressed differently here, over the chip map instead of resolved id lists
  // (.claude/rules/active-games-filter-sites.md).
  const pool = () =>
    activeGames.filter(
      (g) =>
        matchesTagFilter(selectedTags, g.tagIds, tagFilterState.tagMode) &&
        fitsPlayerCount(g, playerCount()) &&
        fitsMetadataFilters(g, metaFilters)
    );

  // Live pool preview, in the two presentations described above. The wide panel
  // lists EVERY matching game (its own scroll box bounds it), so it needs no
  // "+n" overflow chip and the two representations share no counting logic
  // beyond the one headline string.
  const hint = form.querySelector('#poolHint');
  const poolTitle = form.querySelector('#poolTitle');
  const poolGrid = form.querySelector('#poolGrid');
  const poolReset = form.querySelector('#poolReset');
  // Clear everything that shapes the pool — tags and metadata alike. A user
  // looking at an empty pool does not care which of the two controls caused it,
  // and with five more filters than before, arriving there is far easier than it
  // used to be. Both hooks are assigned later (the tag one only when the round
  // has tags at all), so they default to no-ops rather than being conditional at
  // the call site.
  let resetTagFilters = () => {};
  let resetMetaFilters = () => {};
  const anyFilterActive = () => selectedTags.size > 0 || countMetadataFilters(metaFilters) > 0;
  const coverStyle = (g, w) =>
    g.image ? ` style="background-image:url('${coverUrl(g.image, w)}')"` : '';
  const updateHint = () => {
    const games = pool();
    // Resolved once: both presentations must always report the same number, and
    // two tn() calls is two places for that to stop being true.
    const headline = tn(games.length, 'startSession.availableOne', 'startSession.available');

    // Compact strip (below 860px): the first six covers, overlapping, + a count.
    const thumbs = games
      .slice(0, 6)
      .map((g) => `<span class="pool-thumb"${coverStyle(g, COVER_THUMB)} title="${esc(g.title)}">${coverPlaceholder(g)}</span>`)
      .join('');
    const more = games.length > 6 ? `<span class="pool-thumb pool-thumb--more">+${games.length - 6}</span>` : '';
    hint.innerHTML = `<span class="pool-hint__text">${esc(headline)}</span><span class="pool-thumbs">${thumbs}${more}</span>`;

    // Tile panel (860px up). An empty pool needs its own line: a grid with no
    // tiles reads as a broken panel rather than as "nothing matches yet".
    poolTitle.textContent = headline;
    poolGrid.innerHTML = games.length
      ? games
          .map(
            (g) => `<span class="pool-tile" title="${esc(g.title)}">
                 <span class="pool-tile__img"${coverStyle(g, COVER_CARD)}>${coverPlaceholder(g)}</span>
                 <span class="pool-tile__name">${esc(g.title)}</span>
               </span>`
          )
          .join('')
      : `<p class="muted setup-panel__empty">${esc(t('startSession.poolEmpty'))}</p>`;

    // The way back out of an empty pool. It lives OUTSIDE both presentations
    // above — the tile panel is `display: none` below 860px and the strip above
    // it — so the escape hatch is reachable at every width, which neither
    // presentation could manage on its own.
    poolReset.replaceChildren();
    if (games.length === 0 && anyFilterActive()) {
      const btn = h(`<button type="button" class="link-btn">${esc(t('metaFilter.reset'))}</button>`);
      btn.addEventListener('click', () => {
        resetTagFilters();
        resetMetaFilters();
        updateHint();
      });
      poolReset.appendChild(btn);
    }
  };
  // Seats around the table: tap a member to toggle whether they join tonight.
  // The group attributes go on the table itself, not on #seatMount — replaceWith
  // swaps the mount out, so anything set on it in the markup would be lost.
  // Taking a member out of the session must also take them out of their team
  // (#575) — the picker drops them and dissolves a team left with one person.
  const seatTable = renderSeatPicker(round, joining, () => {
    teamPicker.refreshTeams();
    updateHint();
  }, () => guests.length);
  seatTable.setAttribute('role', 'group');
  seatTable.setAttribute('aria-labelledby', 'seatsLabel');
  form.querySelector('#seatMount').replaceWith(seatTable);
  form.querySelector('#guestMount').replaceWith(guestPicker);
  form.querySelector('#teamMount').replaceWith(teamPicker);
  updateHint();

  // Custom-tag chips (#238, tri-state #241) are the only game filter now (#242).
  // Clicking cycles ignore -> include -> exclude -> ignore. With no round tags
  // there is nothing to filter, so the whole field stays hidden.
  const chips = form.querySelector('#filterChips');
  const roundTags = round.tags || [];
  if (roundTags.length) {
    form.querySelector('#gamesFilterField').hidden = false;
    // Built before the chips so their click handlers can call bulk.sync() and
    // mode.sync(); the nodes are mounted after, which is why these are
    // declarations and not inline appends.
    const chipEls = [];
    const repaintChips = () =>
      chipEls.forEach(({ el, tag }) =>
        paintTagChip(el, tag.name, selectedTags.get(tag.id), tag.icon, tagFilterState.tagMode));
    // Switching the mode repaints the chips as well as redrawing the pool: the
    // included chips' aria-labels state the semantics in words (#726).
    const mode = renderTagModeToggle(tagFilterState, selectedTags, () => {
      repaintChips();
      updateHint();
    });
    const bulk = renderTagBulkToggle(
      selectedTags,
      roundTags,
      repaintChips,
      () => { mode.sync(); updateHint(); }
    );
    roundTags.forEach((tg) => {
      const chip = h('<button type="button" class="chip"></button>');
      chipEls.push({ el: chip, tag: tg });
      paintTagChip(chip, tg.name, selectedTags.get(tg.id), tg.icon, tagFilterState.tagMode);
      chip.addEventListener('click', () => {
        paintTagChip(chip, tg.name, cycleTagState(selectedTags, tg.id), tg.icon, tagFilterState.tagMode);
        bulk.sync();
        mode.sync();
        updateHint();
      });
      chips.appendChild(chip);
    });
    form.querySelector('#tagBulkMount').replaceWith(bulk.el);
    form.querySelector('#tagModeMount').replaceWith(mode.el);
    resetTagFilters = () => {
      selectedTags.clear();
      repaintChips();
      bulk.sync();
      mode.sync();
    };
  }

  // „Weitere Filter" (#725) — the filters over BGG's imported metadata. It sits
  // under the tag chips and above the count stepper because it shapes the pool,
  // and those are the two controls that already do. It renders NOTHING when the
  // shelf carries none of the fields, so a round of hand-typed games — or an
  // instance with no BGG token — sees exactly the screen it saw before.
  //
  // It is (re)built through `mountMetaFilter` rather than mounted once, because
  // the backfill below can make controls appear that this shelf could not offer
  // a moment ago (#736). The mount element STAYS in the DOM as the anchor —
  // `hidden` while there is nothing to show, which costs no flex gap because a
  // `display: none` element is not a flex item at all. It carries no class, so
  // no rule can override the UA's `[hidden]`
  // (.claude/rules/hidden-attribute-vs-display-rule.md).
  const metaMount = form.querySelector('#metaFilterMount');
  let metaFilter = null;
  const mountMetaFilter = () => {
    // Preserved across a rebuild: the user's picks (the `metaFilters` object is
    // mutated in place and handed back in), and whether they had the disclosure
    // OPEN — losing that would snap the panel shut under someone mid-adjustment.
    const wasOpen = !!(metaFilter && metaFilter.el.open);
    metaFilter = renderMetadataFilter(activeGames, metaFilters, () => updateHint());
    metaMount.replaceChildren();
    if (metaFilter) {
      metaFilter.el.open = wasOpen;
      metaMount.appendChild(metaFilter.el);
    }
    resetMetaFilters = metaFilter ? metaFilter.reset : () => {};
    metaMount.hidden = !metaFilter;
  };
  mountMetaFilter();

  // Fill the shelf's missing BGG metadata (#736). Without this the controls
  // above are derived from whatever happened to be stored, so a shelf nobody had
  // opened the detail pages of offered no complexity filter at all — and the
  // filters it did offer passed every game they could not see a value for.
  //
  // Folded in rather than re-rendered: `showStartSession(round)` would throw
  // away the seats, guests and teams the user has already set. Re-seeding the
  // SWR cache keeps the filled values across a back-navigation — the entry holds
  // this very object, so the fold already updated it in memory; the `set` is
  // what persists it (public/js/swr.js).
  refreshShelfGameInfo(round.id, activeGames, () => {
    mountMetaFilter();
    updateHint();
    swrStore.set('round:' + round.id, round);
  });

  const countInput = form.querySelector('#count');
  // Preloaded from the remembered preset (#252); the markup's 3 stays the
  // default for a round that has never run a draw-flow session.
  if (preset && Number.isInteger(preset.count) && preset.count >= 1) {
    countInput.value = String(preset.count);
  }
  countInput.addEventListener('input', () => {
    const digits = countInput.value.replace(/\D/g, '');
    if (countInput.value !== digits) countInput.value = digits;
  });
  form.querySelectorAll('.stepper__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cur = parseInt(countInput.value, 10);
      countInput.value = Math.max(1, (Number.isInteger(cur) ? cur : 1) + parseInt(btn.dataset.d, 10));
    });
  });

  form.querySelector('#go').addEventListener('click', async () => {
    let count = parseInt(countInput.value, 10);
    if (!Number.isFinite(count) || count < 1) count = 1;
    if (joining.size === 0) return toast(t('startSession.toast.noMembers'));
    if (pool().length === 0) return toast(t('startSession.toast.noGames'));
    try {
      const data = await api('POST', `/api/rounds/${round.id}/sessions`, {
        count,
        tagIds: [...selectedTags].filter(([, s]) => s === 'include').map(([id]) => id),
        excludeTagIds: [...selectedTags].filter(([, s]) => s === 'exclude').map(([id]) => id),
        tagMode: tagFilterState.tagMode, // #726; the server drops it when nothing is included
        metadata: metaFilters, // #725; re-normalized server-side against the same shelf
        memberIds: [...joining],
        guests, // names only; the server mints the ids (#458)
        teams: teamPicker.teamPayload(), // guests by POSITION in `guests` (#575)
      });
      // A per-device session opens the lobby instead: its votes arrive one
      // person at a time, from wherever those people are, so there is no single
      // hot-seat run to start. The lobby is where anyone in the room votes.
      // Every session lands in the lobby (#655). It shows who still has to vote,
      // lets whoever is holding this device vote for any of them, and offers the
      // shareable link for everyone voting from their own phone — so there is no
      // longer a mode to choose before the draw. The drawn games stay secret: the
      // lobby renders a COUNT, never a title.
      showSessionLobby(round, data.session);
    } catch (e) { toast(e.message); }
  });
}

// =================== Voting (hot-seat) ===================

// `people` is the sessionPeople() shape ({ id, name, guest }), so a guest takes
// their hot-seat turn exactly like a member (#458) — only their vote card
// differs, see the retire control below.
// `opts` (#209) lets the per-device lobby reuse this wizard for ONE person at a
// time instead of duplicating it. Everything subtle here — the history entry per
// step, the #329 leave guard, the beforeunload block — is machinery a second
// implementation would have to get right again, so the hot-seat run and a single
// person's run are the same code path with two knobs:
//   opts.saveVotes(votes) – async; replaces the one POST /results at the end
//   opts.onSaved()        – where to go afterwards, instead of the finale
//   opts.skipIntro        – drop the "you're up, don't peek" handover screen
// Absent opts is the original hot-seat behaviour, byte for byte.
function startVoting(round, session, games, people, opts = {}) {
  // votes[personId][gameId] = { rating, retire }
  const votes = {};
  people.forEach((p) => (votes[p.id] = {}));

  // A "you're up" screen before each person, then their cards.
  //
  // Since #655 the lobby is the only caller and always passes ONE person, so
  // this is in practice "intro + that person's games". The loop is kept rather
  // than flattened because the generality costs four lines and the guards below
  // are written against `votes` as a map — collapsing it would touch every one
  // of them to save nothing. `shuffled` is therefore a no-op on a single person;
  // it stays so the shape does not silently acquire an order dependency.
  //
  // The handover screen is skipped when someone is voting on their OWN device:
  // "pass the device on, no peeking" is advice about a shared phone, and showing
  // it to a person alone with their own is just a screen in the way.
  const order = shuffled(people);
  const steps = [];
  order.forEach((p) => {
    if (!opts.skipIntro) steps.push({ type: 'intro', person: p });
    games.forEach((g) => steps.push({ type: 'vote', person: p, game: g }));
  });

  let idx = 0;
  // True once finish() has POSTed. Until then everything the user has entered
  // exists only in this closure, which is what every guard below protects (#329).
  //
  // #655 shrank the blast radius rather than removing the need: what is at risk
  // is now ONE person's cards, not the whole table's evening, because the lobby
  // saves each column as it is given. The guards stay — losing four ratings to a
  // stray Back is still worth a confirm.
  let saved = false;
  // Set by finish() so a Back out of the results screen can rebuild the finale.
  let finaleArgs = null;

  const hasVotes = () => Object.values(votes).some((byGame) => Object.keys(byGame).length > 0);

  // Self-heal for a game the wizard received without its provider metadata
  // (#717 follow-up): a session drawn before the fields existed — or before
  // the fire-and-forget backfill landed — hands this closure field-less games,
  // so voting showed no ⓘ while the detail page (which has its own lazy
  // trigger) did. Same trigger here: ask once per game per wizard run, mutate
  // the SHARED game object (every rating tap rebuilds the card from it, so
  // later renders carry the fields synchronously), and slot the ⓘ into the
  // live card only if it still shows this game.
  const infoAsked = new Set();
  function fetchCardGameInfo(game, card) {
    if (!wantsGameInfo(game) || infoAsked.has(game.id)) return;
    infoAsked.add(game.id);
    api('GET', `/api/rounds/${round.id}/games/${game.id}/provider-info`)
      .then((info) => {
        mergeGameInfo(game, info);
        const title = card.querySelector('.vote__title');
        if (!document.body.contains(title) || title.querySelector('.vote__info')) return;
        const btn = gameInfoButton(game);
        if (btn) title.append(' ', btn);
      })
      .catch(() => {}); // best-effort — the card stands without it
  }

  // Blocks a reload / tab close while votes are unsaved. Removed on every exit
  // path: an abandoned closure that kept its listener would keep blocking
  // reloads for the rest of the SPA session.
  const unloadGuard = (e) => { if (!saved && hasVotes()) e.preventDefault(); };
  window.addEventListener('beforeunload', unloadGuard);

  // The router's leave guard (see confirmLeave in router.js): false aborts the
  // navigation, true tears this wizard down on the way out.
  const guardLeave = () => {
    if (!saved && hasVotes() && !confirm(t('vote.leaveConfirm'))) return false;
    window.removeEventListener('beforeunload', unloadGuard);
    return true;
  };

  // Plain context label; the top bar no longer offers a leave-point. Votes are
  // still guarded on every exit: the brand mark (core.js) and the in-wizard
  // "Zurück" both route through confirmLeave(), and beforeunload covers
  // reload/close (#348, see .claude/rules/session-flow-history.md).
  setContext(round.name);

  // Every step is a real history entry, so browser/OS Back steps back through
  // the wizard exactly like its own "Zurück" button — which is why that button
  // now calls history.back() too, keeping index and history in one story.
  // Always via syncUrl(), never history.pushState: syncUrl also bumps
  // swrRenderToken and maintains navIndex (router.js).
  function go(next) {
    idx = next;
    syncUrl(sessionStepPath(round.id, session.id, idx));
    render();
  }

  // Back/Forward inside the flow. Returns true when this wizard owns the entry.
  function onPopstate(pathname) {
    const at = parseSessionPath(pathname);
    const mine = at && at.rid === round.id && at.sid === session.id;
    if (mine && at.kind === 'vote' && at.step < steps.length) {
      idx = at.step;
      render();
      return true;
    }
    if (mine && at.kind === 'finale' && finaleArgs) {
      showFinale(...finaleArgs);
      return true;
    }
    // Every other entry leaves the wizard, and which one it is depends on how
    // the wizard was entered: the setup screen when it was started there, the
    // round hub when an abandoned draw was resumed from its ticket. So the ask
    // belongs here, on the way out, rather than on any one of those paths —
    // guarding only the setup screen would let the resume path discard votes
    // silently. Declining re-pushes the step we were on, leaving the user
    // exactly where they were.
    if (!confirmLeave()) {
      syncUrl(sessionStepPath(round.id, session.id, idx));
      render();
      return true;
    }
    // Backing out to the setup screen re-renders the form (its entry is still
    // the one we pushed); every other destination is the router's to resolve.
    if (at && at.kind === 'setup' && at.rid === round.id) {
      showStartSession(round);
      return true;
    }
    return false;
  }

  beginFlow(onPopstate, guardLeave);

  // Re-render the current step in the new language (keeps votes/progress). The
  // context label is the locale-independent round name, so it needs no refresh.
  currentView = () => { render(); };

  // Segmented progress: one segment per person, filled in their color.
  const perPerson = games.length + (opts.skipIntro ? 0 : 1); // (intro +) one card per game
  function progressBar() {
    return `<div class="vote-progress">${order
      .map((p, pi) => {
        const done = Math.max(0, Math.min(perPerson, idx - pi * perPerson));
        const pct = Math.round((done / perPerson) * 100);
        return `<span class="vote-progress__seg"><span style="width:${pct}%;background:${personColor(round, p)}"></span></span>`;
      })
      .join('')}</div>`;
  }

  // Which control the pending re-render was triggered from, so focus can be put
  // back on its rebuilt counterpart (#667). render() replaces the whole card, so
  // a rating tap otherwise detaches the focused button and drops the keyboard
  // user on <body> — a full Tab through the card again, once per game per voter,
  // on the app's central action.
  //
  // Only the in-place tile handler sets it; go(), onPopstate and the language
  // switch leave it null on purpose, so *arriving* on a step never yanks focus
  // into the middle of the card. Since #797 the retirement proposal is one of
  // those tiles rather than a separate control, so there is one kind, not two.
  let refocus = null;

  function render() {
    const step = steps[idx];
    const total = steps.length;
    // Consumed here rather than at the end: every path out of this function,
    // including the intro's early return, must clear it, or a stale intent
    // would fire on the next unrelated render.
    const wanted = refocus;
    refocus = null;
    let restore = null;
    // Inside render(), not next to the currentView assignment above: unlike the
    // context label — which is the locale-independent round name and says so —
    // this title has a translated part, so it has to be re-applied when the
    // language picker re-runs the current step. It is deliberately the same on
    // every step: a tab reading "Voting" must not leak whose turn it is or
    // which game is on screen to anyone glancing at the handover device.
    setDocTitle(t('vote.crumb'), round.name);

    // Handover screen: full color card in the person's color.
    if (step.type === 'intro') {
      const color = personColor(round, step.person);
      app.innerHTML = '';
      const card = h(`<div class="handover" style="background:${color}">
          ${progressBar()}
          <span class="handover__avatar" style="color:${color}">${esc(initials(step.person.name))}</span>
          <h1 class="handover__name">${esc(t('vote.turn', { name: personLabel(step.person) }))}</h1>
          <div class="handover__sub"><i class="ti ti-eye-off" aria-hidden="true"></i> ${esc(t('vote.handoverSub'))}</div>
          <button class="handover__go" id="goBtn" style="color:${color}">${esc(t('vote.go'))}</button>
          ${idx > 0 ? `<button class="handover__back" id="backBtn"><i class="ti ti-chevron-left" aria-hidden="true"></i> ${esc(t('vote.back'))}</button>` : ''}
        </div>`);
      card.querySelector('#goBtn').addEventListener('click', () => go(idx + 1));
      const back = card.querySelector('#backBtn');
      // Through history, so the wizard's Zurück and the platform's Back are the
      // same movement rather than two disagreeing ones.
      if (back) back.addEventListener('click', () => history.back());
      app.appendChild(card);
      return;
    }

    const { person, game } = step;
    const current = votes[person.id][game.id] || { rating: null, retire: false };
    const color = personColor(round, person);
    // A guest rates the game but does not get to vote it off the shelf (#458):
    // that is the permanent group governing its own collection, and a one-off
    // visitor shouldn't nudge a game toward the retire recommendation. Since
    // #797 that means their scale simply starts at 1 — the zero tile is not
    // rendered at all rather than cast and filtered later, so gameStats() needs
    // no guest exclusion.
    const mayRetire = !person.guest;

    const imgStyle = game.image ? `style="background-image:url('${coverUrl(game.image, COVER_HERO)}')"` : '';
    const fallback = coverPlaceholder(game);

    app.innerHTML = '';
    const card = h(`<div class="vote vote--split">
        ${progressBar()}
        <div class="vote__who">${esc(t('vote.who'))} <strong style="color:${color}">${esc(personLabel(person))}</strong></div>
        <div class="vote__img" ${imgStyle}>${fallback}</div>
        <h1 class="vote__title">${esc(game.title)}</h1>
        <div class="vote__q" id="voteQ">${esc(t('vote.question'))}</div>
        <div class="rating" role="group" aria-labelledby="voteQ"></div>
        <div class="rating-scale"><span>${esc(t('vote.scaleLow'))}</span><span>${esc(t('vote.scaleHigh'))}</span></div>
        <div class="vote__nav">
          <button class="btn" id="backBtn"><i class="ti ti-chevron-left" aria-hidden="true"></i> ${esc(t('vote.back'))}</button>
          <button class="btn btn--primary" id="nextBtn">${idx === total - 1 ? esc(t('vote.finish')) + ' <i class="ti ti-chevron-right" aria-hidden="true"></i>' : esc(t('vote.next'))}</button>
        </div>
      </div>`);

    // Info affordance (#717): the provider metadata behind a small ⓘ in the
    // title line, so the height-budgeted card gains no extra row
    // (.claude/rules/fitting-a-screen-to-the-viewport-height.md). Rendered
    // only when the game actually carries the data — and when it doesn't but
    // could, the card self-heals below.
    const infoBtn = gameInfoButton(game);
    if (infoBtn) card.querySelector('.vote__title').append(' ', infoBtn);
    else fetchCardGameInfo(game, card);

    /* The scale: a trash tile for 0 (members only), then 1–5 as mood faces. The
       selected one takes the rating's traffic-light colour, and `avgColor(0)`
       lands on the deep red at the bottom of that ramp with no special case —
       which is the point of the whole change, the zero being the bottom of one
       axis rather than a second question.

       Deliberately duplicated in views-vote-link.js — the two cards must render
       the same markup and write the same vote shape; see that file's header. */
    const MOODS = ['ti-mood-cry', 'ti-mood-sad', 'ti-mood-neutral', 'ti-mood-smile', 'ti-mood-crazy-happy'];
    const ratingEl = card.querySelector('.rating');
    for (let n = mayRetire ? 0 : 1; n <= RATING_MAX; n++) {
      // Read through effectiveRating rather than comparing `current.rating`, so
      // a legacy column carrying both a rating and the flag lights the tile the
      // rest of the app will actually count (#797).
      const sel = effectiveRating(current) === n;
      // aria-pressed carries the choice (#145): the selected face is otherwise
      // marked only by its traffic-light fill, so nothing announced which rating
      // was picked — on the app's central action. The label spells out the scale
      // too; a bare "1" gave no hint of what the number meant or how far it ran.
      // The zero carries no numeral, so its label is the whole of what it means;
      // its `.mood__n` is a non-breaking space rather than absent, which keeps
      // its icon on the same baseline as the five faces beside it.
      const b = h(`<button class="mood${n === 0 ? ' mood--retire' : ''}${sel ? ' is-selected' : ''}"
           aria-pressed="${sel}" aria-label="${esc(n === 0 ? t('vote.suggestRetire') : t('vote.ratingLabel', { n, max: RATING_MAX }))}">
           <i class="ti ${n === 0 ? 'ti-trash' : MOODS[n - 1]}" aria-hidden="true"></i><span class="mood__n">${n === 0 ? '&nbsp;' : n}</span>
         </button>`);
      if (sel) {
        b.style.background = avgColor(n);
        b.style.borderColor = avgColor(n);
      }
      if (wanted && wanted.kind === 'mood' && wanted.n === n) restore = b;
      b.addEventListener('click', () => {
        // Mutually exclusive: picking a face clears the flag, picking the trash
        // clears the rating. That is what removes the contradiction a vote could
        // express before (#797).
        votes[person.id][game.id] = n === 0 ? { rating: null, retire: true } : { rating: n, retire: false };
        refocus = { kind: 'mood', n };
        render();
      });
      ratingEl.appendChild(b);
    }

    const backBtn = card.querySelector('#backBtn');
    backBtn.disabled = idx === 0;
    backBtn.addEventListener('click', () => history.back());

    card.querySelector('#nextBtn').addEventListener('click', () => {
      // One scale, so one guard: has this person put the game anywhere on it?
      // (#797 — it used to be "a rating, or the flag, unless you're a guest".)
      if (effectiveRating(votes[person.id][game.id]) === null) {
        return toast(t('vote.toast.needRating'));
      }
      if (idx === total - 1) finish();
      else go(idx + 1);
    });

    /* No scroll reset here. `render()` also runs from onPopstate (a Back, where
       the browser is restoring the position) and from currentView on a language
       switch (where nothing navigated) — the forward case is `go()`, which goes
       through syncUrl and resets there (#623, router.js). */
    app.appendChild(card);

    // After the append, never before: focus() on a detached node is a no-op.
    // A pointer user sees nothing change — the browser already focused the
    // button on mousedown, and a scripted focus() does not turn on
    // :focus-visible (`.claude/rules/accessibility-contrast-and-modals.md`).
    if (restore) restore.focus();
  }

  async function finish() {
    try {
      // Per-device run (#209): the caller writes the columns its own way (one
      // request per person) and decides where to go next. The teardown in
      // between is identical, and doing it HERE rather than in the callback is
      // what keeps the two runs from drifting on the part that actually bites —
      // a wizard left registered as the active flow swallows the next Back.
      if (opts.saveVotes) {
        await opts.saveVotes(votes);
        saved = true;
        window.removeEventListener('beforeunload', unloadGuard);
        endFlow();
        return opts.onSaved && opts.onSaved();
      }
      await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/results`, { votes });
      // From here on there is nothing left to lose, so the leave guards go
      // quiet — a Back out of the finale must not ask about discarding votes
      // that are already on the server.
      saved = true;
      window.removeEventListener('beforeunload', unloadGuard);
      const fresh = await fetchRoundFresh(round.id);
      const savedSession = fresh.sessions.find((s) => s.id === session.id);
      // Nobody sees the result yet: the finale gate gathers everyone first.
      finaleArgs = [fresh, savedSession, games];
      showFinale(...finaleArgs);
    } catch (e) { toast(e.message); }
  }

  go(0);
}

// =================== Finale: everyone gathers for the reveal ===================

// Shown only when arriving from voting; opening old results from the Chronik
// skips the gate.
function showFinale(round, session, games) {
  currentView = () => showFinale(round, session, games);
  // Its own entry, so Back from the results reveal returns here rather than
  // skipping the whole flow. The votes are already saved by this point, so the
  // wizard's flow (still registered) lets this one go without asking.
  syncUrl(sessionFinalePath(round.id, session.id));
  setContext(round.name);
  setDocTitle(t('finale.crumb'), round.name);

  const voters = sessionPeople(round, session);

  app.innerHTML = '';
  const stage = h(`<div class="stage">
      <div class="stage__seal">
        <i class="ti ti-mail" aria-hidden="true"></i>
        <span class="stage__lock"><i class="ti ti-lock" aria-hidden="true"></i></span>
      </div>
      <h1 class="stage__title">${esc(t('finale.title'))}</h1>
      <div class="stage__sub">${esc(t('finale.sub'))}</div>
      <div class="stage__voters">${voters
        .map(
          (p) => `<span class="stage__voter">
             <span class="stage__voter-avatar">
               <span class="avatar${p.guest ? ' avatar--guest' : ''}"${p.guest ? '' : ` style="background:${memberColor(round, p.id)}"`}>${esc(initials(p.name))}</span>
               <span class="stage__voter-check"><i class="ti ti-check" aria-hidden="true"></i></span>
             </span>
             <span class="stage__voter-name">${esc(personLabel(p))}</span>
           </span>`
        )
        .join('')}</div>
      <button class="btn btn--primary btn--lg stage__reveal"><i class="ti ti-sparkles" aria-hidden="true"></i> ${esc(t('finale.reveal'))}</button>
      <div class="stage__note">${esc(t('finale.note'))}</div>
    </div>`);
  stage.querySelector('.stage__reveal').addEventListener('click', () => {
    // The flow is over. Ending it here leaves its entries to resolveRoute,
    // which maps every transient session path to the round hub — so Back out of
    // the results lands on the round instead of replaying the wizard.
    endFlow();
    showResults(round, session, games, true);
  });
  app.appendChild(stage);
}

// =================== Results ===================

async function showResults(round, session, gamesHint, reveal) {
  currentView = () => showResults(round, session, gamesHint);
  syncUrl(resultsPath(round.id, session.id));
  setContext(round.name);
  setDocTitle(t('result.title'), round.name);

  // Resolve the session's game objects.
  const games = session.gameIds
    .map((gid) => round.games.find((g) => g.id === gid) || (gamesHint || []).find((g) => g.id === gid))
    .filter(Boolean);
  // Everyone who took part: the members who joined plus this session's guests
  // (#458). Older sessions have no member list, so sessionPeople falls back to
  // all members of the round, and no `guests` key means none.
  const people = sessionPeople(round, session);
  // The same people grouped into playing parties (#575): one entry per team plus
  // one per un-teamed person. Drives the winner picker below, so a team is
  // recorded in one tap and nobody is offered twice.
  const parties = sessionParties(round, session);

  // Tally per game.
  const rows = games.map((g) => {
    const ratings = [];
    let sortCount = 0;
    people.forEach((p) => {
      const v = (session.votes[p.id] || {})[g.id];
      if (!v) return;
      if (wantsRetire(v)) sortCount++;
      // 0–5 since #797: a retirement proposal is a vote of 0, so it lands in
      // the average and in its own bucket rather than only in `sortCount`.
      const r = effectiveRating(v);
      if (r !== null) ratings.push(r);
    });
    const sum = ratings.reduce((a, b) => a + b, 0);
    const avg = ratings.length ? sum / ratings.length : 0;
    const dist = [0, 0, 0, 0, 0, 0];
    ratings.forEach((r) => dist[r]++);
    return { game: g, avg, count: ratings.length, sortCount, dist };
  });

  rows.sort((a, b) => b.avg - a.avg);
  // Tie-aware places ("1, 2, 2, 4"): games with the same displayed average share
  // a place, medal, and pedestal. Drives both the podium and the medal list.
  computePlaces(rows).forEach((place, i) => { rows[i].place = place; });

  app.innerHTML = '';
  // A finished session's results belong to the Chronik, and this is a routed
  // screen (unlike the wizard's transient steps, which deliberately resolve to
  // nothing and so get no strip).
  renderSubScreenTabs(round, 'session');
  app.appendChild(backRow(() => showRound(round.id)));
  const when = fmtDateTime(session.createdAt);
  const head = h(`<div class="page-head"><div>
         <h1 class="result-title">${esc(t('result.title'))}</h1>
         <div class="muted">${esc(t('result.subtitle', { when, n: games.length }))}</div>
       </div></div>`);
  app.appendChild(head);
  const titleEl = head.querySelector('.result-title');

  // „Teilen": hand the group chat what this screen says, as plain text (#526).
  // Hidden outright where neither API exists — which is a real case, not a
  // theoretical one: `navigator.clipboard` is undefined outside a secure
  // context, so a self-hosted plain-HTTP instance shows no button rather than a
  // dead one. `.page-head` is already a space-between flex row, so appending the
  // button as its second child parks it at the right edge with no new CSS.
  if (canShareResult()) {
    const shareBtn = h(`<button class="btn btn--ghost">${iconText('ti-share', t('share.button'))}</button>`);
    // The model is built at CLICK time, never up front: choosing a game,
    // finishing, recording winners and cancelling all mutate this closure's
    // state in place (updateChosen/renderFinish re-render only fragments), so a
    // text captured at render would share a result the user has since changed.
    shareBtn.addEventListener('click', () => shareResult({
      roundName: round.name,
      when,
      cancelled,
      playedTitle: chosenId ? (games.find((g) => g.id === chosenId) || {}).title || null : null,
      winnerNames: winnerIds.map((wid) => personLabel(people.find((p) => p.id === wid))).filter(Boolean),
      rows: rows.map((r) => ({ title: r.game.title, avg: r.avg, count: r.count, place: r.place })),
    }));
    head.appendChild(shareBtn);
  }

  // Who took part in this session — the people whose votes make up the result.
  if (people.length) {
    // A guest has no member page, so their entry is a <span>, not an <a>: an
    // anchor with no href is neither focusable nor styled as a link, so emitting
    // one would leave dead markup behind (.claude/rules/in-app-nav-links.md).
    const peopleEl = h(`<div class="result-people">
         <span class="result-people__label">${esc(t('result.participants'))}</span>
         <span class="result-people__list">${people
           .map(
             (p) => `<${p.guest ? 'span' : 'a'} class="result-people__person"${p.guest ? '' : ` data-mid="${esc(p.id)}"`}>
                <span class="avatar${p.guest ? ' avatar--guest' : ''}"${p.guest ? '' : ` style="background:${memberColor(round, p.id)}"`}>${esc(initials(p.name))}</span>
                <span class="result-people__name">${esc(personLabel(p))}</span>
              </${p.guest ? 'span' : 'a'}>`
           )
           .join('')}</span>
       </div>`);
    // Each member participant opens that member's detail page.
    peopleEl.querySelectorAll('.result-people__person[data-mid]').forEach((el) => {
      makeMemberLink(el, round.id, el.dataset.mid);
    });
    app.appendChild(peopleEl);
  }

  // Who played together (#575). Listed as its own row rather than folded into
  // the participants above: that row answers "who was here", which is still one
  // entry per person, and a team is a different fact about the same people.
  const teamParties = parties.filter((p) => p.team);
  if (teamParties.length) {
    app.appendChild(
      h(`<div class="result-people">
           <span class="result-people__label">${esc(t('result.teams'))}</span>
           <span class="result-people__list">${teamParties
             .map(
               (party) => `<span class="team-card team-card--flat">
                  <span class="team-card__name">${iconText('ti-users', party.name)}</span>
                </span>`
             )
             .join('')}</span>
         </div>`)
    );
  }

  // Podium: the top three *places* as a stage. Tied games share a place, so a
  // 3-way tie for 1st shows all three (all crowned, same height). Arranged as
  // [place 2 | place 1 | place 3] so a lone winner stays centered as before.
  // With `reveal` the pedestals rise (shortest first) and confetti falls — the
  // finale's payoff moment.
  const podiumRows = rows.filter((r) => r.place && r.place <= 3);
  if (rows.length >= 2 && podiumRows.length && !session.cancelled) {
    const atPlace = (p) => podiumRows.filter((r) => r.place === p);
    const arranged = [...atPlace(2), ...atPlace(1), ...atPlace(3)];
    const podium = h(`<div class="result-podium${reveal ? ' is-reveal' : ''}"></div>`);
    arranged.forEach((r) => {
      const place = r.place;
      const g = r.game;
      const imgStyle = g.image ? ` style="background-image:url('${coverUrl(g.image, COVER_THUMB)}')"` : '';
      const fb = coverPlaceholder(g);
      const col = h(`<a class="result-podium__col result-podium__col--${place}">
             ${place === 1 ? '<i class="ti ti-crown result-podium__crown" aria-hidden="true"></i>' : ''}
             <span class="result-podium__img"${imgStyle}>${fb}</span>
             <span class="result-podium__title">${esc(g.title)}</span>
             <span class="score-pill result-podium__pill" style="background:${avgColor(r.avg)}">Ø ${r.avg.toFixed(1)}</span>
             <span class="result-podium__base">${place}</span>
           </a>`);
      makeGameLink(col, round.id, g.id);
      podium.appendChild(col);
    });
    if (reveal) {
      const conf = h('<div class="confetti" aria-hidden="true"></div>');
      for (let i = 0; i < 16; i++) {
        const bit = h('<span class="confetti__bit"></span>');
        bit.style.left = Math.round(Math.random() * 100) + '%';
        bit.style.background = MEMBER_COLORS[i % MEMBER_COLORS.length];
        bit.style.animationDelay = (Math.random() * 0.9).toFixed(2) + 's';
        conf.appendChild(bit);
      }
      podium.appendChild(conf);
    }
    app.appendChild(podium);
  }

  function updateTitle() {
    if (cancelled) {
      titleEl.textContent = t('result.titleCancelled');
    } else if (finished && chosenId) {
      const g = games.find((x) => x.id === chosenId);
      const gname = g ? g.title : '';
      const names = winnerIds
        .map((wid) => personLabel(people.find((p) => p.id === wid)))
        .filter(Boolean);
      if (names.length === 0) {
        titleEl.textContent = t('result.titlePlayed', { game: gname });
      } else {
        titleEl.textContent = t(names.length === 1 ? 'result.titleWonOne' : 'result.titleWonMany', {
          game: gname,
          names: joinNames(names),
        });
      }
    } else {
      titleEl.textContent = t('result.title');
    }
  }

  // Banner: shows which game is being played (or prompts to choose).
  let chosenId = session.chosenGameId || null;
  const banner = h('<div class="chosen-banner"></div>');
  app.appendChild(banner);

  // Cancel session (the alternative to choosing a game; see renderCancel).
  // Created here because updateChosen() -> renderCancel() runs below while the
  // footer that holds it is built later still; only the appendChild moves down
  // (#614). Writing into a detached node is fine — it is in the document by the
  // time anything can click it.
  const cancelWrap = h('<div class="cancel-area"></div>');

  const medalRanks = ['gold', 'silver', 'bronze'];
  const maxBar = Math.max(1, ...rows.map((r) => Math.max(...r.dist)));
  const rowRefs = [];

  rows.forEach((r) => {
    const g = r.game;
    const imgStyle = g.image ? `style="background-image:url('${coverUrl(g.image, COVER_THUMB)}')"` : '';
    const fallback = coverPlaceholder(g);
    /* Six bars since #797, the leftmost being the retirement proposals. It
       carries the same trash glyph as the vote card's zero tile INSTEAD of its
       count, because the numeral inside a bar already means the count and two
       numbers in a 22px box would say neither. Nothing is lost: that count is
       `sortCount`, which the „X wollen aussortieren" line directly below states
       in words whenever it is non-zero. */
    const bars = r.dist
      .map((c, n) => {
        const hpx = 4 + Math.round((c / maxBar) * 24);
        const title = n === 0 ? t('result.barTitleRetire', { c }) : t('result.barTitle', { c, r: n });
        const label = n === 0 ? (c ? '<i class="ti ti-trash" aria-hidden="true"></i>' : '') : (c || '');
        return `<div class="bar${n === 0 ? ' bar--retire' : ''}" style="height:${hpx}px" title="${esc(title)}">${label}</div>`;
      })
      .join('');
    // Info if the game has been archived in the meantime (#250: either way).
    const retiredBadge = g.retired
      ? ` <span class="tag tag--retired">${iconText('ti-trash', t('result.retiredTag'))}</span>`
      : g.completed
        ? ` <span class="tag tag--completed">${iconText('ti-circle-check', t('result.completedTag'))}</span>`
        : '';
    // "Suggested for retirement" line; with a direct action only while the game
    // is still active — an already-archived game has nothing left to retire, and
    // neither has one that has since moved to the Wunschliste (#560), where
    // retiring it would claim the group is discarding a game they do not own.
    const sortFlag = r.sortCount
      ? `<div class="sort-flag"><i class="ti ti-trash" aria-hidden="true"></i> ${esc(t('result.sortFlag', { n: r.sortCount }))}${
          g.retired || g.completed || g.wish ? '' : ` <button class="link-btn sortflag-btn">${esc(t('result.retireNow'))}</button>`
        }</div>`
      : '';
    const medal = r.place && r.place <= 3 ? `<span class="rank-medal rank-medal--${medalRanks[r.place - 1]}"><i class="ti ti-medal" aria-hidden="true"></i></span>` : '';
    const row = h(`<div class="result-row">
         <a class="result-row__img" ${imgStyle}>${fallback}</a>
         <div>
           <a class="result-row__title">${medal}${esc(g.title)}${retiredBadge}</a>
           <div class="result-row__bars">${bars}</div>
           ${sortFlag}
           <button class="link-btn result-row__remove">${iconText('ti-trash', t('result.removeGame'))}</button>
         </div>
         <div class="result-row__score">
           <div class="score-big">${r.count ? r.avg.toFixed(1) : '–'}</div>
           <div class="score-label">${esc(t('result.avgOf', { n: r.count }))}</div>
           <button class="btn play-btn">${iconText('ti-player-play', t('result.play'))}</button>
         </div>
         <div class="row-finish" hidden></div>
       </div>`);
    // Title and cover open the game's detail page (the action buttons below
    // live in sibling elements, so they keep working independently). The cover
    // is flagged redundant: it targets the same game as the title beside it, so
    // it stays mouse-clickable but is not a second (nameless) tab stop.
    makeGameLink(row.querySelector('.result-row__title'), round.id, g.id);
    makeGameLink(row.querySelector('.result-row__img'), round.id, g.id, { redundant: true });
    const sortBtn = row.querySelector('.sortflag-btn');
    if (sortBtn) {
      sortBtn.addEventListener('click', async () => {
        if (!confirm(t('result.retireNowConfirm', { title: g.title }))) return;
        try {
          await api('POST', `/api/rounds/${round.id}/games/${g.id}/retire`, { retired: true });
          toast(t('games.retired', { title: g.title }));
          const fresh = await fetchRoundFresh(round.id);
          const sess = fresh.sessions.find((s) => s.id === session.id) || session;
          showResults(fresh, sess, games);
        } catch (e) { toast(e.message); }
      });
    }
    const removeBtn = row.querySelector('.result-row__remove');
    removeBtn.addEventListener('click', async () => {
      if (!confirm(t('result.removeGameConfirm', { title: g.title }))) return;
      try {
        await api('DELETE', `/api/rounds/${round.id}/sessions/${session.id}/games/${g.id}`);
        toast(t('result.toast.gameRemoved', { title: g.title }));
        const fresh = await fetchRoundFresh(round.id);
        const sess = fresh.sessions.find((s) => s.id === session.id) || session;
        showResults(fresh, sess, games);
      } catch (e) { toast(e.message); }
    });
    const btn = row.querySelector('.play-btn');
    btn.addEventListener('click', async () => {
      const newId = chosenId === g.id ? null : g.id; // tapping again clears it
      try {
        await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/choice`, { gameId: newId });
        chosenId = newId;
        session.chosenGameId = newId;
        updateChosen();
        toast(newId ? t('result.toast.willPlay', { title: g.title }) : t('result.toast.choiceCleared'));
      } catch (e) { toast(e.message); }
    });
    rowRefs.push({ gameId: g.id, row, btn, finishEl: row.querySelector('.row-finish') });
    app.appendChild(row);
  });

  function updateChosen() {
    rowRefs.forEach(({ gameId, row, btn }) => {
      const isChosen = gameId === chosenId;
      row.classList.toggle('is-chosen', isChosen);
      btn.classList.toggle('btn--primary', isChosen);
      btn.innerHTML = isChosen
        ? iconText('ti-check', t('result.willPlay'))
        : iconText('ti-player-play', t('result.play'));
      // Once the result is recorded or the session cancelled, the choice can
      // no longer be changed.
      btn.disabled = finished || cancelled;
      btn.title = finished ? t('result.lockedHint') : cancelled ? t('result.cancelledHint') : '';
    });
    banner.classList.toggle('is-cancelled', cancelled);
    if (cancelled) {
      banner.innerHTML = iconText('ti-x', t('result.bannerCancelled'));
      banner.classList.remove('is-set');
    } else if (chosenId) {
      const g = games.find((x) => x.id === chosenId);
      const icon = `<i class="ti ${GAME_ICON}" aria-hidden="true"></i> `;
      banner.innerHTML = icon + t('result.bannerChosen', { title: '<strong>' + esc(g ? g.title : '') + '</strong>' });
      // Say so when the base box does NOT seat this table and an owned
      // expansion is what made the game drawable at all (#653) — otherwise the
      // group carries the wrong box to the table. Derived from the same
      // predicate the draw used, so the warning can never name a different set.
      const needed = g ? requiredExpansions(g, parties.length) : [];
      if (needed.length) {
        banner.innerHTML += `<div class="chosen-banner__note">${esc(t('result.needsExpansion', { names: needed.map((e) => e.title).join(', ') }))}</div>`;
      }
      banner.classList.add('is-set');
    } else {
      banner.textContent = t('result.bannerPrompt');
      banner.classList.remove('is-set');
    }
    renderCancel();
    renderFinish();
  }

  // --- Finish game / record winners (rendered inside the chosen game's tile) ---
  let finished = !!session.finished;
  let cancelled = !!session.cancelled;
  let winnerIds = Array.isArray(session.winnerIds) ? session.winnerIds.slice() : [];

  // Cancel is the alternative final state: only offered while no game is
  // chosen, and undoable like the finish reset. Rendered as a `link-btn` in the
  // footer next to „Session löschen" (#614) — the rare escape hatch, not a peer
  // of the podium it used to sit above.
  function renderCancel() {
    cancelWrap.innerHTML = '';
    if (finished || chosenId) return;
    if (cancelled) {
      const undo = h(`<button class="link-btn">${esc(t('result.cancelUndo'))}</button>`);
      undo.addEventListener('click', async () => {
        try {
          await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/cancel`, { cancelled: false });
          cancelled = false;
          session.cancelled = false;
          session.cancelledAt = null;
          toast(t('result.toast.cancelUndone'));
          updateChosen();
        } catch (e) { toast(e.message); }
      });
      cancelWrap.appendChild(undo);
    } else {
      // „Session abbrechen" alone, with the reason („Kein Spiel gefällt") moved
      // to the title (#817): spelled out it was 293px, which with „Session
      // löschen" beside it wrapped the footer row at 375px. Visible text is
      // present, so the title supplies the accessible DESCRIPTION and not the
      // name — SC 2.5.3 is unaffected.
      const btn = h(`<button class="link-btn" title="${esc(t('result.cancelHint'))}">${iconText('ti-x', t('result.cancel'))}</button>`);
      btn.addEventListener('click', async () => {
        if (!confirm(t('result.cancelConfirm'))) return;
        try {
          await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/cancel`, { cancelled: true });
          cancelled = true;
          session.cancelled = true;
          toast(t('result.toast.cancelled'));
          updateChosen();
        } catch (e) { toast(e.message); }
      });
      cancelWrap.appendChild(btn);
    }
  }

  function renderFinish() {
    updateTitle();
    rowRefs.forEach(({ finishEl }) => { finishEl.hidden = true; finishEl.innerHTML = ''; });
    if (!chosenId) return;
    const ref = rowRefs.find((x) => x.gameId === chosenId);
    if (!ref) return;
    const finishWrap = ref.finishEl;
    finishWrap.hidden = false;
    const chosenGame = games.find((g) => g.id === chosenId);
    finishWrap.appendChild(
      h(`<h2>${finished ? iconText('ti-trophy', t('result.finishTitleDone')) : esc(t('result.finishTitle'))}</h2>`)
    );
    // Finishing comes first and needs no winners; the winner picker only shows
    // up afterwards, so it can't read as a prerequisite (#254).
    if (!finished) {
      finishWrap.appendChild(
        h(`<div class="muted" style="margin-bottom:10px">${esc(t('result.finishPrompt', { game: chosenGame ? chosenGame.title : '' }))}</div>`)
      );
      const finishBtn = h(`<button class="btn btn--primary">${iconText('ti-check', t('result.markPlayed'))}</button>`);
      finishBtn.addEventListener('click', () => saveWinners([]));
      const actions = h('<div class="toolbar" style="margin-top:14px"></div>');
      actions.appendChild(finishBtn);
      finishWrap.appendChild(actions);
      return;
    }

    finishWrap.appendChild(
      h(`<div class="muted" style="margin-bottom:10px">${esc(t('result.whoWon', { game: chosenGame ? chosenGame.title : '' }))}</div>`)
    );

    // Guests can win too (#458) — they played the game. They just never enter
    // the round-level standings; see the Pokale tab.
    //
    // One chip per PARTY (#575), so a team is recorded in a single tap. What is
    // stored stays a flat list of person ids: a team win is a win for each of
    // its people, which is what lets the Pokale standings, the Chronik and the
    // recap keep reading `winnerIds` with no idea teams exist.
    const chips = h('<div class="winner-chips"></div>');
    parties.forEach((party) => {
      const ids = party.people.map((p) => p.id);
      // A team counts as selected only when ALL of its people are in — a
      // partially-set list (hand-crafted, or written before the team existed)
      // reads as not selected, so one tap completes it rather than clearing it.
      const sel = ids.every((id) => winnerIds.includes(id));
      const chip = h(`<button class="winner-chip ${sel ? 'is-selected' : ''}" aria-pressed="${sel}">${sel ? '<i class="ti ti-trophy" aria-hidden="true"></i> ' : ''}${party.team ? '<i class="ti ti-users" aria-hidden="true"></i> ' : ''}${esc(party.name)}</button>`);
      // Each toggle persists right away — no separate save button in this state.
      chip.addEventListener('click', () => saveWinners(
        sel
          ? winnerIds.filter((x) => !ids.includes(x))
          : [...winnerIds, ...ids.filter((id) => !winnerIds.includes(id))]
      ));
      chips.appendChild(chip);
    });
    finishWrap.appendChild(chips);

    const actions = h('<div class="toolbar" style="margin-top:14px"></div>');
    const resetBtn = h(`<button class="btn btn--ghost">${esc(t('result.reset'))}</button>`);
    resetBtn.addEventListener('click', async () => {
      try {
        await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/finish`, {
          finished: false,
          winnerIds: [],
        });
        finished = false;
        winnerIds = [];
        session.finished = false;
        session.winnerIds = [];
        session.finishedAt = null; // the server clears it too; keep the copy honest
        toast(t('result.toast.reset'));
        renderFinish();
      } catch (e) { toast(e.message); }
    });
    actions.appendChild(resetBtn);
    finishWrap.appendChild(actions);

    const names = winnerIds
      .map((wid) => personLabel(people.find((p) => p.id === wid)))
      .filter(Boolean);
    const inner = names.length
      ? iconText('ti-trophy', t('result.winners', { names: names.join(', ') }))
      : iconText('ti-check', t('result.playedNoWinner'));
    finishWrap.appendChild(h(`<div class="winner-result">${inner}</div>`));

    // „An BG Stats übergeben" (#485): the whole play as one tappable link.
    //
    // Rendered only for an account that opted in (Konto → BG Stats), because a
    // website cannot detect whether the app is installed and the vendor's own
    // guidance is to let the user enable the button rather than dead-end
    // everyone else. Built here rather than at click time because renderFinish()
    // re-runs after every winner toggle, so the href is never stale — and a real
    // anchor is long-pressable and copyable, which a JS click is not.
    //
    // `noreferrer` as well as `noopener`: the referrer would otherwise carry
    // this round's and session's ids to a third party that has no use for them
    // (.claude/rules/secrets-in-paths-reach-the-logs.md, same reasoning one hop
    // further out).
    const pushUrl = bgStatsEnabled()
      ? bgStatsPlayUrl({ session, game: chosenGame, people, parties, winnerIds })
      : null;
    if (pushUrl) {
      const push = h(`<div class="toolbar" style="margin-top:14px">
           <a class="btn btn--ghost" target="_blank" rel="noopener noreferrer" href="${esc(pushUrl)}">${iconText('ti-external-link', t('result.bgStats'))}</a>
         </div>`);
      finishWrap.appendChild(push);
    }
  }

  // Marks the session finished with the given winners (possibly none) and
  // re-renders; only committed to local state once the server accepted it.
  async function saveWinners(ids) {
    try {
      const saved = await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/finish`, {
        finished: true,
        winnerIds: ids,
      });
      finished = true;
      winnerIds = saved.winnerIds.slice(); // filtered server-side
      session.finished = true;
      session.winnerIds = winnerIds.slice();
      // The server stamps this, and the BG Stats push (#485) sends it as the
      // play's date — without the sync it would fall back to createdAt, i.e.
      // report the evening as having happened when the draw started, until the
      // next reload.
      session.finishedAt = saved.finishedAt || session.finishedAt;
      toast(t('result.toast.saved'));
      renderFinish();
    } catch (e) { toast(e.message); }
  }

  updateChosen();

  // What happened during this session (#209), between the games and the
  // destructive action: a hybrid evening's votes can come from several people's
  // accounts, so the results are only half the story without it. Rendered by
  // views-session-live.js — a later file in the load order, which is fine
  // because this runs on navigation, never at load time
  // (.claude/rules/frontend-script-load-order.md).
  const sessionLog = renderSessionLog(round, session);
  if (sessionLog) app.appendChild(sessionLog);

  // One install nudge (#616), at the one moment the app has just delivered
  // something. Above the footer, because the footer's two controls are how you
  // throw this evening away and nothing may push them off the end of the screen.
  const installOffer = buildInstallOffer(reveal);
  if (installOffer) app.appendChild(installOffer);

  // The two ways to get rid of this session, together and last on the screen:
  // cancel (reversible, destroys nothing) before delete (permanent). Both sit
  // below the games and the log so reading the results never means scrolling
  // past the way to throw them away (#614). It sat above the terminal "Zurück"
  // row until #623 moved that control to the top of the content, so this is now
  // simply the final block; the #561 constraint it was phrased against
  // ("nothing belongs after a back link") is satisfied by construction.
  const footer = h('<div class="section result-footer"></div>');
  footer.appendChild(cancelWrap);
  // #137: deleting a played evening destroys its votes, result and winners for
  // everyone, so it is co-owner and up. Cancelling (above) stays an ordinary
  // write — it is reversible and is part of running the session.
  if (roundCan(round, 'session.delete')) {
    const delBtn = h(`<button class="link-btn" style="color:var(--danger)">${esc(t('result.deleteSession'))}</button>`);
    delBtn.addEventListener('click', async () => {
      if (!confirm(t('sessions.deleteConfirm', { when }))) return;
      try {
        await api('DELETE', `/api/rounds/${round.id}/sessions/${session.id}`);
        toast(t('sessions.deleted'));
        showRound(round.id);
      } catch (e) { toast(e.message); }
    });
    footer.appendChild(delBtn);
  }
  app.appendChild(footer);
}

/* The one post-session install offer (#616), or null.

   `reveal` is the whole gate on *when*. Its three callers are all the same
   moment — the session just closed while this device was watching: the finale's
   own reveal button, and the two lobby paths that land here when voting was
   closed from somewhere else (`views-session-live.js`, since #655 the ordinary
   route). Every OTHER way in passes it undefined — `showResultsById` on a cold
   load, the Chronik rows, the Start tickets, the round-detail list — so looking
   an old evening up never produces the card. The localStorage flag is the gate
   on *how often*: answered once, gone for good on that device.

   Kept out of showResults' body: it closes over nothing there, and the view is
   long enough already (token-friendly-source-files.md). */
function buildInstallOffer(reveal) {
  if (!reveal) return null;
  // A demo self-erases on a TTL, so its icon on a home screen would point at an
  // account that stops existing — same reasoning as the Konto section.
  if (isDemoAccount()) return null;
  if (installOfferDismissed()) return null;
  const state = installState();
  if (state !== 'prompt' && state !== 'ios') return null;

  const card = h(`<div class="install-offer">
       <h2>${esc(t('install.offer.title'))}</h2>
       <p class="muted">${esc(t('install.intro'))}</p>
     </div>`);
  const actions = h('<div class="install-actions"></div>');
  if (state === 'ios') {
    card.appendChild(h(`<p class="muted">${esc(t('install.ios.steps'))}</p>`));
  } else {
    const btn = h(`<button class="btn btn--primary install-cta" type="button">${iconText('ti-download', t('install.cta'))}</button>`);
    btn.addEventListener('click', async () => {
      // Remembered BEFORE the dialog and regardless of its outcome: opening it
      // is an answer, and re-offering after someone declined the browser's own
      // prompt is the nagging this one-shot card exists to avoid.
      dismissInstallOffer();
      if (await runInstallPrompt() === 'accepted') toast(t('install.done'));
    });
    actions.appendChild(btn);
  }
  const no = h(`<button class="link-btn install-offer__dismiss" type="button">${esc(t('install.offer.dismiss'))}</button>`);
  no.addEventListener('click', () => { dismissInstallOffer(); card.remove(); });
  actions.appendChild(no);
  card.appendChild(actions);
  hideOnInstalled(card);
  return card;
}

// Can this browser share a result at all? The share sheet is a mobile API and
// `navigator.clipboard` needs a secure context, so both may genuinely be absent
// — in which case the button is never rendered rather than shown and inert.
function canShareResult() {
  return !!(navigator.share || (navigator.clipboard && navigator.clipboard.writeText));
}

// Share the summary the user is looking at. Text only, and never sent anywhere
// by us: `navigator.share` hands it to a picker the *user* chooses a recipient
// in, and the fallback only writes the clipboard. That is what keeps this free
// of any new privacy disclosure — don't add an auto-send of any kind.
async function shareResult(model) {
  // joinNames is passed in so the shared headline is byte-identical to the h1
  // above it ("Anna und Ben", not "Anna, Ben") — see session-share.js.
  const text = sessionShareText(model, t, joinNames);
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      // Dismissing the sheet is a normal outcome, not a failure — reporting it
      // would toast at a user who simply changed their mind.
      if (e && e.name === 'AbortError') return;
      // Anything else (a browser that advertises the API but refuses the call)
      // falls through to the clipboard rather than dead-ending.
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(t('share.toast.copied'));
  } catch {
    toast(t('share.toast.failed'));
  }
}
