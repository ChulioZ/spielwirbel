/* Spielwirbel – views: session setup, voting (hot-seat), finale reveal, and
   results (winner spotlight + ranked rows). Part of the frontend; all files
   share one global script scope. */

// =================== Session: setup ===================

/* `prefill` (#923) is a partial, shaped exactly like `round.lastSessionFilters`,
   that WINS over the stored preset for this entry only — the quick-start chips
   on the hub. It is a shallow merge at the top level, so a chip carrying
   `metadata` replaces the remembered metadata block wholesale rather than
   merging into it: a chip named „unter 60 Min" that quietly inherited last
   week's complexity range would open a pool nobody asked for and offer no clue
   why it is that small.

   Nothing here persists it. `lastSessionFilters` is written server-side by the
   draw itself, so an exploratory tap that never draws leaves the round's
   remembered preset untouched.

   One key is NOT a filter: `memberIds` (#1275) seats exactly those members
   instead of everyone — see `joining` below. */
function showStartSession(round, prefill) {
  currentView = () => showStartSession(round, prefill);
  // Reached either from the hub CTA or by backing out of the wizard; either way
  // the wizard (if any) is over, so drop its flow before claiming the entry.
  endFlow();
  syncUrl(sessionSetupPath(round.id));
  setContext(round.name);
  setDocTitle(t('startSession.title'), round.name);
  app.innerHTML = '';
  const head = h(`<div class="page-head"><h1>${esc(t('startSession.title'))}</h1></div>`);
  app.appendChild(head);
  // Der Tisch composes this screen as two panels with the rail kept (#1267);
  // Klassisch is the default path below and never branches.
  const tisch = designIs('tisch');
  if (tisch) {
    // The rail's rename and „+" re-render through currentView(), and the
    // `round` this closure holds is a snapshot — so under the rail the screen
    // re-reads the round rather than redrawing a stale name or seat list.
    currentView = () => fetchRoundFresh(round.id)
      .then((fresh) => showStartSession(fresh, prefill), () => showStartSession(round, prefill));
  }

  const activeGames = round.games.filter(isActiveGame);

  // These two headings label a group of buttons, not a form control, so they are
  // <div class="label">, not <label> (#145): a <label> with no `for` and no
  // wrapped input labels nothing at all. `aria-labelledby` on the group is what
  // actually ties the text to the seats/chips.
  //
  // `.setup-grid` splits the screen along the two questions it actually asks:
  // WHO is at the table (left) and WHAT gets drawn (right — the filter control
  // and the count that shape the pool, the resulting pool itself, and the button
  // that draws from it). From 860px up that is two columns; below it the grid is a plain
  // block, so the DOM order below IS the phone order — and it is byte-for-byte
  // the order this screen already had, so nothing moves on a phone.
  //
  // Since #1015 the four exception questions — guests, teams, „wer hat seine
  // Spiele nicht dabei", „mehrere Tische" — are the add-on CHIP row below the
  // ring rather than four always-open fields. Measured before: they cost ~640px
  // on every visit, ~200px of it hint text, for an evening that has no guests,
  // no teams, everyone's shelf present and one table. A layout-only fix was
  // prototyped and still scrolled ~200px on a 13" laptop, because the height is
  // in the content — so the content collapses and the chip carries its state.
  //
  // The count and „Loswirbeln" moved out of the row above the pool into
  // `.setup-bar` at the end of the column: on a phone the button used to be the
  // last thing on a 1667px page, at y=1454. It is a plain in-flow card and
  // deliberately NOT sticky — see the stylesheet, and
  // .claude/rules/sticky-bottom-bar-needs-slack-below-it.md for the measurement.
  //
  // The pool is rendered twice on purpose — a tile panel beside the form, the
  // compact overlapping strip inside the filter bar below it — and CSS picks one
  // by width, the same "render both, let the viewport decide" shape the rail and
  // dock use. Both are filled by the one updateHint() below, so they cannot
  // drift, and the bar's summary is resolved from the same string.
  const form = h(`<div class="setup-grid setup-grid--session">
      <div class="setup-grid__main">
        <div class="field">
          <div class="field__label" id="seatsLabel">${esc(t('startSession.membersLabel'))}</div>
          <div id="seatMount"></div>
          <div class="muted field__hint center">${esc(t('startSession.membersNote'))}</div>
        </div>
        <div id="addonMount"></div>
        <div class="muted field__hint setup-addons__note" id="multiTableNote" hidden>${esc(t('startSession.multiTableNote'))}</div>
      </div>
      <div class="setup-grid__aside">
        <div class="setup-filterbar">
          <div class="pool-hint" id="poolHint"></div>
          <div id="filterMount" class="fbar-mount"></div>
        </div>
        <div class="setup-panel">
          <h2 class="setup-panel__title" id="poolTitle"></h2>
          <div class="setup-panel__body" id="poolGrid"></div>
        </div>
        <div id="poolReset"></div>
        <div class="setup-bar">
          <div class="setup-bar__count">
            <label for="count">${esc(t('startSession.barCount'))}</label>
            <div class="stepper">
              <button type="button" class="stepper__btn" data-d="-1" aria-label="−"><i class="ti ti-minus" aria-hidden="true"></i></button>
              <input id="count" class="stepper__val" inputmode="numeric" value="3" />
              <button type="button" class="stepper__btn" data-d="1" aria-label="+"><i class="ti ti-plus" aria-hidden="true"></i></button>
            </div>
          </div>
          <p class="setup-bar__summary" id="barSummary"></p>
          <button id="go" class="btn btn--primary btn--lg"><i class="ti ti-tornado" aria-hidden="true"></i> ${esc(t('startSession.draw'))}</button>
        </div>
      </div>
    </div>`);
  app.appendChild(form);
  if (tisch) composeTischSetup(round, head, form);

  // Custom-tag filter (#238, tri-state #241): all ignored by default = no tag
  // filter. Map<tagId, 'include'|'exclude'>; included tags combine per
  // `tagFilterState.tagMode` (#726 — 'all' by default, 'any' for at least one),
  // excluded tags reject a game carrying any of them in either mode.
  // Preset from the round's last draw-flow session (#252) when there is one;
  // tag ids whose tag has since been deleted are dropped, mirroring the
  // drop-unknown-ids rule the backend applies at session-creation time.
  const stored = round.lastSessionFilters || null;
  const preset = prefill ? { ...(stored || {}), ...prefill } : stored;
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
  // Retired members are not offered a seat (#1006); every past session's
  // participant list keeps resolving them through sessionPeople().
  // `prefill.memberIds` (#1275) narrows that to the people who sat down last
  // time — Der Tisch's „Noch eine Session". Intersected with the active seats,
  // so a member retired since cannot come back through it, and ignored when
  // nothing survives: an empty table is not a sensible place to start from.
  const seatIds = activeMembers(round).map((m) => m.id);
  const lastTable = prefill && Array.isArray(prefill.memberIds)
    ? seatIds.filter((id) => prefill.memberIds.includes(id)) : [];
  const joining = new Set(lastTable.length ? lastTable : seatIds);
  // Seats that are here WITHOUT their shelf (#1002): somebody came straight from
  // work, or the evening is at someone else's place. Empty by default, because
  // that is the normal evening — see the chip row further down for why this is
  // framed as the exception rather than as a second seat picker.
  const awayShelves = new Set();
  // What the owner clause is actually about, on BOTH sides of the draw: the
  // seats whose boxes are in the room. The reduction is the server's own
  // (draw-pool.js), so the preview below cannot narrow differently than the
  // draw will (.claude/rules/shared-constants-across-the-stack.md).
  const shelfSeats = () => shelfParty([...joining], [...awayShelves]);
  // The chip row (#1015). Built empty here, before anything that has to relabel
  // it: the chips themselves are added once every body they open exists (the
  // shelf one does not exist on every round), but `relabelAddons()` is a safe
  // no-op until then, so the change callbacks below can all name it.
  const addons = renderSetupAddons(t('startSession.addon.label'));
  // Guests (#458): plain names, held only here until the draw POSTs them — the
  // server mints their ids. Frozen at the draw, exactly like the seat selection.
  // Since #1016 they sit on the seat ring beside the members rather than in a
  // field of their own, so this is state, not a control — the ring below adds
  // and removes them, and everything that follows from the count comes through
  // its `onChange`. The note travels with the list because it is a statement
  // about THESE guests: here they vote, in the direct-play sheet they do not.
  const guestList = createGuestList(t('startSession.guestsNote'));
  const guests = guestList.guests;
  // Teams (#575): two or more of the people above playing as one party. Frozen
  // at the draw like the seats and the guests, and the reason the pool count
  // below is not simply a headcount.
  const teamPicker = renderTeamPicker(round, joining, guestList, t('startSession.teamsNote'), () => {
    addons.relabelAddons();
    updateHint();
  });
  const playerCount = () =>
    joining.size + guests.length - teamPicker.teamedPeopleCount() + teamPicker.teamCount();
  // Multi-table mode (#796). Preset from the same #252 blob as everything else on
  // this screen; the checkbox below is bound to it and the pool reads it live.
  const tableState = { multiTable: !!(preset && preset.multiTable) };
  // A preset can arrive with BOTH remembered (#252), and `normalizeMetadataFilters`
  // above cannot drop it: it prunes against the SHELF's options, and whether this
  // evening has one table is a property of the screen. Without this the restored
  // session shows a chip for a filter with no control and no effect — see the gate
  // in `mountFilterPanel` for why the toggle does not exist in this mode.
  if (tableState.multiTable) metaFilters.onlyRecommended = false;

  // Games matching the tag filter, whose player range fits the joining count.
  // Guests sit at the table, so they count here, and a team counts once however
  // many people it holds (#575). The range clause and the active filter above are
  // the SERVER's own (draw-pool.js, required by lib/draw.js), so this preview
  // cannot promise a pool the draw would not produce — only the tag filter is
  // expressed differently here, over the chip map instead of resolved id lists
  // (.claude/rules/active-games-filter-sites.md).
  // In multi-table mode the range clause is `fitsSomeTable` instead (#796) — "can
  // this box seat some table this group could form?" rather than "does it seat
  // the whole party?". Both predicates are the SERVER's own, so this preview can
  // never promise a pool the draw would not produce.
  // The owner clause (#971) keys off the joining SEATS, not `playerCount` —
  // guests own nothing — and it is the server's own predicate, like the two
  // above, so the preview cannot promise a pool the draw would refuse.
  const pool = () =>
    activeGames.filter(
      (g) =>
        matchesTagFilter(selectedTags, g.tagIds, tagFilterState.tagMode) &&
        (tableState.multiTable
          ? fitsSomeTable(g, playerCount(), fitsPlayerCount)
          : fitsPlayerCount(g, playerCount())) &&
        fitsMetadataFilters(g, metaFilters) &&
        (tableState.multiTable || fitsRecommendedCount(g, playerCount(), metaFilters.onlyRecommended)) &&
        ownedByParty(g, shelfSeats())
    );

  // How many games pass every OTHER clause and fail only on their owners being
  // away (#971). Counted rather than listed, and it is not a filter the user set
  // — so it gets a plain line and stays out of `lastSessionFilters` and out of
  // the applied-filter chips, both of which are about choices somebody made.
  //
  // Without it a shelf silently shrinks when somebody cannot come, which reads
  // as games having gone missing.
  const ownersHiddenCount = () =>
    activeGames.filter(
      (g) =>
        matchesTagFilter(selectedTags, g.tagIds, tagFilterState.tagMode) &&
        (tableState.multiTable
          ? fitsSomeTable(g, playerCount(), fitsPlayerCount)
          : fitsPlayerCount(g, playerCount())) &&
        fitsMetadataFilters(g, metaFilters) &&
        (tableState.multiTable || fitsRecommendedCount(g, playerCount(), metaFilters.onlyRecommended)) &&
        !ownedByParty(g, shelfSeats())
    ).length;

  // Live pool preview, in the two presentations described above. The wide panel
  // lists EVERY matching game (its own scroll box bounds it), so it needs no
  // "+n" overflow chip and the two representations share no counting logic
  // beyond the one headline string.
  const hint = form.querySelector('#poolHint');
  const poolTitle = form.querySelector('#poolTitle');
  const poolGrid = form.querySelector('#poolGrid');
  const poolReset = form.querySelector('#poolReset');
  // The action bar's own line. It restates the two numbers the screen is about —
  // how many people are at the table, how many games are in the pot — because on
  // a phone the panel is not rendered at all, and it must never disagree with the
  // panel title where both are: they come from the one `headline` resolved in
  // updateHint() below.
  const barSummary = form.querySelector('#barSummary');
  // Appended once, next to the reset hatch, and filled by updateHint() below.
  const ownersNote = h('<p class="muted pool-owners-note" role="status" aria-live="polite"></p>');
  poolReset.after(ownersNote);
  // Clear everything that shapes the pool — tags and metadata alike. A user
  // looking at an empty pool does not care which of the two controls caused it,
  // and with five more filters than before, arriving there is far easier than it
  // used to be. Both hooks are assigned later (the tag one only when the round
  // has tags at all), so they default to no-ops rather than being conditional at
  // the call site.
  // Declared here because `updateHint` closes over it, and it cannot be built
  // until the tag section below exists. Both are read only from listeners, which
  // run long after this function has finished.
  let filterPanel = null;
  // A tag chip changes the applied-filter chips the BAR renders, so it has to be
  // told. The metadata controls route through the panel's own onChange and
  // resync themselves, which is why only the tag half calls this.
  const syncFilterBar = () => { if (filterPanel) filterPanel.sync(); };
  const anyFilterActive = () => selectedTags.size > 0 || countMetadataFilters(metaFilters) > 0;
  // Split into a declaration and an attribute builder so a game with NO cover
  // emits no `style` attribute at all rather than an empty one. Variadic because
  // a pre-baked `style="…"` cannot be merged with a second one; it carried the
  // whirl's per-cover delay alongside the cover until #1122.
  const coverDecl = (g, w) => (g.image ? `background-image:url('${coverUrl(g.image, w)}')` : '');
  const styleAttr = (...decls) => {
    const css = decls.filter(Boolean).join(';');
    return css ? ` style="${css}"` : '';
  };
  /* The pot's headline, as a numeral and the noun it counts. Deliberately NOT
     `headline` split on its number: every shipped locale happens to put {n}
     first today, and an eighth that does not would silently render a stray digit
     (.claude/rules/shared-constants-across-the-stack.md's family of assumption).
     The two spans still read as the full phrase, so the panel's <h2> states the
     count to a screen reader exactly as it always did. */
  const potCount = (n) => `<span class="pool-count-group"><span class="pool-count">${n}</span> `
    + `<span class="pool-count__label">${esc(tn(n, 'startSession.potLabelOne', 'startSession.potLabel'))}</span></span>`;
  /* Der Tisch's first motion ritual (#1200, T10.1): a game that ENTERS the pot
     is thrown in from outside, staggered. Only an entering one — the first
     render records what is already there and throws nothing, because a screen
     arriving in motion reads as one still loading (#1122); after that, a seat
     tap or a loosened filter that adds games throws exactly those. The index is
     all this writes: the stagger, its cap and the five directions live in
     tisch.css beside the pot, so dropping the ritual is one block there and
     this. Klassisch never gets a mark, so its markup is what it was. */
  let potSeen = null;
  const potThrows = (games) => {
    const marks = new Map();
    if (tisch && potSeen) games.forEach((g) => { if (!potSeen.has(g.id)) marks.set(g.id, marks.size); });
    potSeen = new Set(games.map((g) => g.id));
    return marks;
  };
  const throwClass = (marks, g) => (marks.has(g.id) ? ' is-thrown' : '');
  const throwAttr = (marks, g) => (marks.has(g.id) ? ` data-throw="${marks.get(g.id) % 5}"` : '');
  const throwDecl = (marks, g) => (marks.has(g.id) ? `--throw-i:${marks.get(g.id)}` : '');
  const updateHint = () => {
    const games = pool();
    const marks = potThrows(games);
    // Resolved once: both presentations must always report the same number, and
    // two tn() calls is two places for that to stop being true.
    const headline = tn(games.length, 'startSession.availableOne', 'startSession.available');

    // The pot below 860px: the numeral, then EVERY cover as a tilted square on a
    // horizontally snapping shelf (#1017). It replaces the six overlapping thumbs
    // and the „+n" chip — a shelf that scrolls needs no chip to stand in for the
    // games it could not fit, and below 860 this is the only presentation there
    // is, so a capped one hides part of the pot outright. The strip still lives
    // INSIDE the filter bar (#1015), so it costs no row of its own.
    const shelf = games
      .map((g) => `<span class="pool-thumb${throwClass(marks, g)}"${throwAttr(marks, g)}${styleAttr(coverDecl(g, COVER_THUMB), throwDecl(marks, g))} title="${esc(g.title)}">${coverPlaceholder(g)}</span>`)
      .join('');
    hint.innerHTML = potCount(games.length) + `<span class="pool-shelf">${shelf}</span>`;

    // Deliberately not a live region: the ring centre and the panel title already
    // state these two numbers, and a third announcement on every seat tap would
    // talk over the ownersNote below, which IS one.
    barSummary.textContent = tisch
      ? tischDrawSummary(joining.size + guests.length, games.length, parseInt(form.querySelector('#count').value, 10))
      : tn(joining.size + guests.length, 'startSession.tableCountOne', 'startSession.tableCount') + ' · ' + headline;

    // Tile panel (860px up). An empty pool needs its own line: a grid with no
    // tiles reads as a broken panel rather than as "nothing matches yet".
    poolTitle.innerHTML = potCount(games.length);
    poolGrid.innerHTML = games.length
      ? games
          .map(
            (g) => `<span class="pool-tile${throwClass(marks, g)}"${throwAttr(marks, g)}${styleAttr(throwDecl(marks, g))} title="${esc(g.title)}">
                 <span class="pool-tile__img"${styleAttr(coverDecl(g, COVER_CARD))}>${coverPlaceholder(g)}</span>
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
        // One button for one control: the panel clears both halves and resyncs
        // its own badge, so a half-cleared filter can never survive the escape.
        if (filterPanel) filterPanel.reset();
        updateHint();
      });
      poolReset.appendChild(btn);
    }

    // „3 weitere Spiele fehlen, weil ihre Besitzer nicht mitspielen." (#971).
    // Below the reset button so it reads as a footnote to the pool rather than
    // as another control, and rendered at 0 as an EMPTY node rather than being
    // removed — the same always-in-the-tree shape the app's other status lines
    // use (.claude/rules/accessibility-contrast-and-modals.md §4).
    const hiddenN = ownersHiddenCount();
    ownersNote.textContent = hiddenN
      ? tn(hiddenN, 'startSession.ownersHiddenOne', 'startSession.ownersHidden')
      : '';

    // The applied chips STATE the party count since #1005 („BGG-Tipp für 4
    // Personen"), so seating somebody changes a chip nobody touched. This runs on
    // every seat, guest and team change, which is exactly the set of events that
    // moves the number — without it the chip keeps naming the party the filter
    // was switched on at, disagreeing with the label inside the panel and with
    // the ring above it. Cheap and idempotent: `sync` only rebuilds the chip row
    // and the trigger's aria-label, and it is safe under an open overlay because
    // the chips live OUTSIDE it (unlike `mountFilterPanel`, which must not).
    if (filterPanel) filterPanel.sync();
  };
  // Seats around the table: tap a member to toggle whether they join tonight,
  // tap the „+" seat to add a guest (#1016).
  // The group attributes go on the ring itself, not on #seatMount — replaceWith
  // swaps the mount out, so anything set on it in the markup would be lost.
  // Taking a member out of the session must also take them out of their team
  // (#575) — the picker drops them and dissolves a team left with one person.
  // One callback for every change to who is at the table, guests included: the
  // ring owns the guest list now, so there is no second change path to keep in
  // step with this one.
  const seatTable = renderSeatPicker(round, joining, () => {
    teamPicker.refreshTeams();
    refreshShelfChips();
    // Unseating somebody can dissolve their team and drops their shelf mark, so
    // two of the three chips can change from a click on the ring.
    addons.relabelAddons();
    updateHint();
  }, guestList, { stateLines: tisch });
  seatTable.setAttribute('role', 'group');
  seatTable.setAttribute('aria-labelledby', 'seatsLabel');
  const multiTableNote = form.querySelector('#multiTableNote');
  /* „Wer hat seine Spiele nicht dabei?" (#1002) — a chip per seated member,
     OFF by default.

     Framed as the exception rather than as "who IS bringing theirs" with every
     chip lit: the normal evening ticks nothing here, and a row of all-on
     avatars directly under the seat ring would read as a second seat picker
     that disagrees with the first. Off-by-default also means the control is
     inert until somebody deliberately touches it.

     Built only when the shelf records an owner ANYWHERE — on an unmarked shelf
     `ownedByParty` is true for every game, so the control could not change a
     single row, and offering one that cannot do anything is exactly what
     `metadataFilterOptions` drops a metadata control to avoid. */
  const shelfIsMarked = activeGames.some((g) => (g.ownerIds || []).length > 0);
  let refreshShelfChips = () => {};
  // Null on an unmarked shelf, which is what decides whether the chip is offered
  // at all — the control has no body, so there is nothing to open.
  let shelfField = null;
  if (shelfIsMarked) {
    shelfField = h(`<div class="field">
        <div class="field__label" id="shelfLabel">${esc(t('startSession.withoutShelfLabel'))}</div>
        <div class="filter-chips" id="shelfChips" role="group" aria-labelledby="shelfLabel"></div>
        <div class="muted field__hint">${esc(t('startSession.withoutShelfNote'))}</div>
      </div>`);
    const shelfChips = shelfField.querySelector('#shelfChips');
    refreshShelfChips = () => {
      // Taking a member off the table takes their mark with them, so re-seating
      // them is a fresh statement about tonight rather than a resurrected old
      // one — the same rule the team picker applies to an unseated player. It
      // also keeps the two sets consistent: `shelfSeats()` subtracts from the
      // seats, so a stale mark would be inert but would still light a chip the
      // moment that member came back.
      [...awayShelves].forEach((id) => { if (!joining.has(id)) awayShelves.delete(id); });
      shelfChips.replaceChildren(...activeMembers(round).filter((m) => joining.has(m.id)).map((m) => {
        const on = awayShelves.has(m.id);
        const chip = h(`<button type="button" class="chip${on ? ' is-on' : ''}" aria-pressed="${on}">`
          + `<span class="chip__avatar avatar" style="background:${esc(memberColor(round, m.id))}">`
          + `${avatarFace(initials(m.name), { userId: m.userId })}</span>${esc(m.name)}</button>`);
        chip.addEventListener('click', () => {
          if (awayShelves.has(m.id)) awayShelves.delete(m.id);
          else awayShelves.add(m.id);
          const now = awayShelves.has(m.id);
          chip.classList.toggle('is-on', now);
          chip.setAttribute('aria-pressed', String(now));
          addons.relabelAddons();
          updateHint();
        });
        return chip;
      }));
    };
    refreshShelfChips();
  }
  form.querySelector('#seatMount').replaceWith(seatTable);

  /* The three chips, in the order the questions used to stand open. Each one's
     label is a function of the option's own live state, so „Team" becomes
     „2 Teams" and the option can never be hidden by having been used — which is
     the whole licence for collapsing them.

     There were four until #1016 took the guest field out: guests are people at
     the table, so they belong on the ring above rather than behind a chip that
     answers the same question a second time.

     The first two open a body; „Mehrere Tische" has none, so it is a plain
     `aria-pressed` toggle whose hint appears under the row while it is on. */
  addons.addAddon({
    key: 'team',
    icon: 'ti-users',
    el: teamPicker,
    label: () => (teamPicker.teamCount()
      ? tn(teamPicker.teamCount(), 'startSession.addon.teamsOne', 'startSession.addon.teams')
      : t('startSession.teamMake')),
    on: () => teamPicker.teamCount() > 0,
  });
  if (shelfField) {
    addons.addAddon({
      key: 'shelf',
      icon: 'ti-ban',
      el: shelfField,
      // Named rather than counted: „Ben ohne Spiele" says which shelf is missing,
      // and it is at most a handful of people. Read in round order so the chip
      // and the body below it list them the same way.
      label: () => (awayShelves.size
        ? t('startSession.addon.shelfOn', {
          names: joinNames(activeMembers(round).filter((m) => awayShelves.has(m.id)).map((m) => m.name)),
        })
        : t('startSession.addon.shelf')),
      on: () => awayShelves.size > 0,
    });
  }
  addons.addAddon({
    key: 'multi',
    icon: 'ti-layout-grid',
    label: () => t('startSession.multiTable'),
    on: () => tableState.multiTable,
    onToggle: () => {
      tableState.multiTable = !tableState.multiTable;
      multiTableNote.hidden = !tableState.multiTable;
      // Hiding the control is not enough: the VALUE would survive on `metaFilters`,
      // so the chip outside the panel would keep claiming a filter whose control
      // has gone — a filter the user could neither see nor clear, which is the
      // vanished-referent rule `normalizeMetadataFilters` applies to every other
      // control here. Cleared rather than remembered, because the mode is a
      // deliberate act and a filter silently returning later is worse than
      // re-ticking a box.
      if (tableState.multiTable) metaFilters.onlyRecommended = false;
      // The panel carries one control fewer (or one more), so it is rebuilt
      // rather than merely resynced — `mountFilterPanel` is a no-op under an open
      // overlay, and this addon sits outside it, so it cannot be mid-adjustment.
      mountFilterPanel();
      updateHint();
    },
  });
  // A remembered preset can arrive with the mode already on (#252).
  multiTableNote.hidden = !tableState.multiTable;
  form.querySelector('#addonMount').replaceWith(addons);
  updateHint();

  // Custom-tag chips (#238, tri-state #241). Clicking cycles ignore -> include
  // -> exclude -> ignore. With no round tags there is nothing to filter, so the
  // section is not built at all and the panel below carries only the metadata
  // half — or, on a shelf with neither, does not exist.
  //
  // Since #827 this is a detached SECTION handed to `renderFilterPanel`, not a
  // field of its own on the screen. The node is built once and MOVED into each
  // rebuilt panel (appendChild moves a node), so every chip listener, and the
  // user's current picks, survive the backfill's remount untouched.
  const roundTags = round.tags || [];
  let tagSection = null;
  if (roundTags.length) {
    const sectionEl = h(`<div class="fpanel__group">
        <div class="field-head">
          <div class="field__label" id="tagFilterLabel">${esc(t('tags.title'))}</div>
          <span id="tagBulkMount"></span>
        </div>
        <div id="tagModeMount"></div>
        <div class="filter-chips" id="filterChips" role="group" aria-labelledby="tagFilterLabel"></div>
      </div>`);
    const chips = sectionEl.querySelector('#filterChips');
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
      () => { mode.sync(); syncFilterBar(); updateHint(); }
    );
    roundTags.forEach((tg) => {
      const chip = h('<button type="button" class="chip"></button>');
      chipEls.push({ el: chip, tag: tg });
      paintTagChip(chip, tg.name, selectedTags.get(tg.id), tg.icon, tagFilterState.tagMode);
      chip.addEventListener('click', () => {
        paintTagChip(chip, tg.name, cycleTagState(selectedTags, tg.id), tg.icon, tagFilterState.tagMode);
        bulk.sync();
        mode.sync();
        syncFilterBar();
        updateHint();
      });
      chips.appendChild(chip);
    });
    sectionEl.querySelector('#tagBulkMount').replaceWith(bulk.el);
    sectionEl.querySelector('#tagModeMount').replaceWith(mode.el);
    tagSection = {
      el: sectionEl,
      // Read on every sync rather than captured: the map is mutated in place, so
      // a list taken at build time would describe picks the user has left.
      // `tagFilterChips` is shared with the Regal (filter-panel.js) — the two
      // screens must not offer different chips over the same tri-state map.
      chips: () => tagFilterChips(roundTags, selectedTags, () => {
        repaintChips();
        bulk.sync();
        mode.sync();
      }),
      reset: () => {
        selectedTags.clear();
        repaintChips();
        bulk.sync();
        mode.sync();
      },
    };
  }

  // The one filter control (#827) — both halves behind one trigger, parked beside
  // the count stepper directly above the pool it shapes, because those are the
  // two things that decide what gets drawn. It renders NOTHING when the round has
  // neither tags nor a shelf carrying BGG metadata, so a round of hand-typed
  // games — or an instance with no BGG token — sees exactly the screen it saw
  // before.
  //
  // Since #844 the body opens as an overlay, so this row holds only the trigger
  // and the applied chips and can no longer be pushed around by opening it.
  //
  // It is (re)built through `mountFilterPanel` rather than mounted once, because
  // the backfill below can make the control appear on a shelf that could not
  // offer it a moment ago (#736). The mount element STAYS in the DOM as the
  // anchor — `hidden` while there is nothing to show, which costs no flex gap
  // because a `display: none` element is not a flex item at all.
  //
  // Since #854 it carries `.fbar-mount`, whose `display: contents` dissolves both
  // this wrapper and the `.fbar` inside it: the trigger and the applied-chip row
  // are items of `.setup-filterbar` itself, where as ONE item they wrapped
  // together and a long chip label carried the „Filter" button onto its own row.
  // That class is also why the `[hidden]` above is no longer free — a declared
  // `display` outranks the UA sheet's, so `.fbar-mount[hidden]` restates it
  // (.claude/rules/hidden-attribute-vs-display-rule.md).
  const filterMount = form.querySelector('#filterMount');
  const mountFilterPanel = () => {
    // NEVER rebuild under an open overlay. The trigger is the node `place()` and
    // `openPopover`'s outside-click guard both hold as the anchor, so replacing
    // it would strand the popover mid-adjustment. Skipping loses nothing: the
    // overlay body is built fresh on every open from `activeGames`, which the
    // backfill fills IN PLACE — so the metadata that just landed is there the
    // next time the user opens it, with nothing to invalidate.
    if (filterPanel && filterPanel.isOpen()) return;
    // Preserved across a rebuild: the user's picks (the `metaFilters` object is
    // mutated in place and handed back in) and the tag section node itself.
    // `tableSized`: this screen has a party, so the recommendation toggle
    // (#1005) can mean something here. The Regal passes nothing and gets no
    // toggle — it filters a shelf, not an evening.
    // `tableSized` is FALSE under „Mehrere Tische", and that is the same gate the
    // Regal gets rather than a second one: the toggle asks what the community
    // recommends AT A TABLE SIZE, and a split has no one size — which is why both
    // the draw (lib/draw.js) and the preview above skip the clause there. Left
    // rendered it would be a control that does nothing, and since #1005 states a
    // count it would do worse than nothing: „BGG-Tipp für 5 Personen" over an
    // evening where those five sit at two tables of two and three.
    //
    // `partyCount`: a thunk, so the toggle's own label and its applied chip can
    // state the number they are filtering on rather than saying „hier".
    filterPanel = renderFilterPanel(activeGames, metaFilters, () => updateHint(), tagSection,
      { tableSized: !tableState.multiTable, partyCount: playerCount });
    filterMount.replaceChildren();
    if (filterPanel) filterMount.appendChild(filterPanel.el);
    filterMount.hidden = !filterPanel;
  };
  mountFilterPanel();

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
    mountFilterPanel();
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
      // Der Tisch's summary states the drawn number (T2.3), so it follows it.
      if (tisch) updateHint();
    });
  });
  // …and it was first written before the remembered count was loaded above.
  if (tisch) {
    countInput.addEventListener('input', updateHint);
    updateHint();
  }

  /* The draw is in flight. #1122 removed the whirl this was written for, which
     SHRINKS the double-press window to the request itself rather than closing it:
     the button is still not disabled while the POST runs, so a second press on a
     slow connection would otherwise still book a second session. */
  let drawing = false;

  form.querySelector('#go').addEventListener('click', async () => {
    let count = parseInt(countInput.value, 10);
    if (!Number.isFinite(count) || count < 1) count = 1;
    if (drawing) return;
    // Both guards refuse the draw outright, before `drawing` is raised: a refusal
    // must leave the screen exactly as usable as it was.
    if (joining.size === 0) return toast(t('startSession.toast.noMembers'));
    if (pool().length === 0) return toast(t('startSession.toast.noGames'));
    drawing = true;
    /* Der Tisch's second motion ritual (#1200, T10.2): the pot's glyph turns ONCE
       on the press. It never holds the lobby — #1122 removed exactly that — so
       on a fast connection the lobby replaces it mid-turn, which is correct:
       the turn is feedback on the press, not a wait. Removed and re-added so a
       second draw after a failed one turns again. The rest of the ritual, the
       drawn games dealt out, is the lobby's `data-dealt` below. */
    if (tisch) {
      const goBtn = form.querySelector('#go');
      goBtn.classList.remove('is-whirling');
      void goBtn.offsetWidth; // restart the animation
      goBtn.classList.add('is-whirling');
    }
    try {
      const data = await api('POST', `/api/rounds/${round.id}/sessions`, {
        count,
        tagIds: [...selectedTags].filter(([, s]) => s === 'include').map(([id]) => id),
        excludeTagIds: [...selectedTags].filter(([, s]) => s === 'exclude').map(([id]) => id),
        tagMode: tagFilterState.tagMode, // #726; the server drops it when nothing is included
        metadata: metaFilters, // #725; re-normalized server-side against the same shelf
        memberIds: [...joining],
        // Who is here without their games (#1002). The MARKS travel, not the
        // reduced list: the server subtracts them with the same `shelfParty` the
        // preview above used, so the two cannot apply different arithmetic to
        // the same answer.
        withoutShelfIds: [...awayShelves],
        guests, // names only; the server mints the ids (#458)
        teams: teamPicker.teamPayload(), // guests by POSITION in `guests` (#575)
        multiTable: tableState.multiTable, // #796; the server drops it when false
      });
      // A per-device session opens the lobby instead: its votes arrive one
      // person at a time, from wherever those people are, so there is no single
      // hot-seat run to start. The lobby is where anyone in the room votes.
      // Every session lands in the lobby (#655). It shows who still has to vote,
      // lets whoever is holding this device vote for any of them, and offers the
      // shareable link for everyone voting from their own phone — so there is no
      // longer a mode to choose before the draw. The drawn games stay secret: the
      // lobby renders a COUNT, never a title.
      showSessionLobby(round, data.session, false, tisch);
    } catch (e) {
      toast(e.message, { tone: 'error' });
    } finally {
      // The guard covers the FLIGHT. On success the lobby has already replaced
      // this screen by the time this runs, so releasing it here cannot reopen the
      // window — and a screen that is somehow still up (a caller that renders
      // nothing) stays usable rather than dead.
      drawing = false;
    }
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
  // votes[personId][gameId] = { rating }   (the retire flag went with #909)
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
  // One POST per run (#1168). Reaching finish() used to take a deliberate
  // „Weiter" press; now the last rating tap does it after a beat, so a stray
  // tap landing just as the beat releases would fire a second submission while
  // the first is still awaiting. The catch below resets it — a failed save has
  // to stay retryable.
  let finishing = false;
  // Set by finish() so a Back out of the results screen can rebuild the finale.
  let finaleArgs = null;
  // The beat between a rating tap and the next card (vote-advance.js, #1168).
  // Per RUN, not per card: it is what a card's handlers ask whether an advance
  // is already in flight, and a per-card one could not answer that.
  const advance = createVoteAdvance();

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
  //
  // It holds the app's ONE remaining native confirm (#939 §4). confirmLeave is a
  // SYNCHRONOUS boolean, which onPopstate below answers with while the pop is
  // already in flight — and the themed confirmDialog arbitrates the very history
  // stack this guard is arbitrating (it pushes a marker of its own and pops it to
  // close). Converting it means making the router's popstate path promise-aware,
  // which is a redesign rather than a call-site change; a half-converted guard
  // drops votes.
  const guardLeave = () => {
    if (!saved && hasVotes() && !confirm(t('vote.leaveConfirm'))) return false;
    window.removeEventListener('beforeunload', unloadGuard);
    // Or the beat fires after the wizard is gone and renders a vote card over
    // whatever screen the user actually navigated to (#1168).
    advance.cancel();
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
    // Any traversal outranks a pending advance: its callback means "one step
    // forward from where I was", which after a Back is forward out of the card
    // the user just asked for (#1168).
    advance.cancel();
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
        // One progressbar per person: the bar is otherwise purely visual, and
        // "step 2 of 3" is the one thing a reader cannot infer from the card
        // (2026-09-06 audit, WCAG 1.3.1). aria-valuetext because the raw
        // value/max pair would be read as a percentage.
        return `<span class="vote-progress__seg" role="progressbar" aria-label="${esc(personLabel(p))}" aria-valuemin="0" aria-valuemax="${perPerson}" aria-valuenow="${done}" aria-valuetext="${esc(t('vote.progress', { n: done, total: perPerson }))}"><span style="width:${pct}%;background:${personColor(round, p)}"></span></span>`;
      })
      .join('')}</div>`;
  }

  /* What a beat delivers to a screen reader (#1168). A sighted voter watches
     the card change; a reader gets a focus move onto a heading and otherwise no
     idea which game this is or how far through the person's cards they are.
     Counted in GAMES rather than in steps — `steps` interleaves the handover
     screens, and "Spiel 2 von 5" is about the shelf, not about the wizard. */
  function announceCard() {
    const step = steps[idx];
    if (!step || step.type !== 'vote') return;
    announce(t('vote.advanced', {
      n: games.indexOf(step.game) + 1,
      total: games.length,
      title: step.game.title,
    }));
  }

  // Which control the pending re-render was triggered from, so focus can be put
  // back on its rebuilt counterpart (#667). render() replaces the whole card, so
  // a rating tap otherwise detaches the focused button and drops the keyboard
  // user on <body> — a full Tab through the card again, once per game per voter,
  // on the app's central action.
  //
  // Only the in-place tile handler sets it; go(), onPopstate and the language
  // switch leave it null on purpose, so *arriving* on a step never yanks focus
  // into the middle of the card.
  let refocus = null;

  // The card as Klassisch has always drawn it: progress, who, cover, title,
  // question, faces, the two-ended scale.
  function klassischCard(person, game, color) {
    const imgStyle = game.image ? `style="background-image:url('${coverUrl(game.image, COVER_HERO)}')"` : '';
    return h(`<div class="vote vote--split">
        ${progressBar()}
        <div class="vote__who"><button class="vote__undo" id="backBtn" type="button" aria-label="${esc(t('vote.back'))}" title="${esc(t('vote.back'))}"><i class="ti ti-arrow-back-up" aria-hidden="true"></i></button>${esc(t('vote.who'))} <strong style="color:${personNameInk(color)}">${esc(personLabel(person))}</strong></div>
        <div class="vote__img" ${imgStyle}>${coverPlaceholder(game)}</div>
        <h1 class="vote__title" tabindex="-1">${esc(game.title)}</h1>
        <div class="vote__secret"><i class="ti ti-eye-off" aria-hidden="true"></i> ${esc(t('vote.handoverSub'))}</div>
        <div class="vote__q" id="voteQ">${esc(t('vote.question'))}</div>
        <div class="rating" role="group" aria-labelledby="voteQ"></div>
        <div class="rating-scale"><span>${esc(t('vote.scaleLow'))}</span><span>${esc(t('vote.scaleHigh'))}</span></div>
      </div>`);
  }

  // Der Tisch's composition (#1268, T2.4/T4.2): header on the felt, the card,
  // the hand-off line — built in vote-card-tisch.js, fed from this closure.
  function tischCard(person, game) {
    const turn = voteTurn(round, session, order, person);
    const n = games.indexOf(game) + 1;
    return tischVoteCard({
      person,
      count: `${t('vote.gameOf', { n, total: games.length })} · ${t('vote.personOf', { n: turn.n, total: turn.total })}`,
      roundName: round.name,
      gameN: n,
      gameTotal: games.length,
      secret: true,
      game,
      meta: voteMetaLine(game, round),
      handoff: voteHandoffLine(turn, !opts.skipIntro),
    });
  }

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

    /* The rating step runs full-screen (#1185): chrome off for a `vote` step, back
       on for the handover. The ONLY setter — every way out of the wizard lands on
       a screen that calls setContext(), which clears it (core.js). Deliberately
       not re-cleared in finish()/guardLeave()/onPopstate: a second clear would be
       a guard that can never be observed failing, so neither could be trusted
       (.claude/rules/redundant-guards-make-each-other-untestable.md). */
    voteScreen(step.type === 'vote');

    // Handover screen: full color card in the person's color.
    if (step.type === 'intro') {
      const color = personColor(round, step.person);
      app.innerHTML = '';
      const card = h(`<div class="handover" style="background:${color}">
          ${progressBar()}
          <span class="handover__avatar" style="color:${color}">${avatarFace(initials(step.person.name), { userId: step.person.userId })}</span>
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
    const current = votes[person.id][game.id] || { rating: null };
    const color = personColor(round, person);

    app.innerHTML = '';
    const card = designIs('tisch') ? tischCard(person, game) : klassischCard(person, game, color);
    /* Der Tisch's third motion ritual (#1200, T10.3): a card the BEAT delivered
       tips in about its middle axis — the hand-over, and the turn itself is the
       privacy screen. `wanted.kind === 'title'` is exactly "the advance brought
       this card", so arriving by Back, a language switch or the first card never
       tips. The motion is tisch.css's; nothing here waits for it. */
    if (designIs('tisch') && wanted && wanted.kind === 'title') card.classList.add('is-tipped');

    // Info affordance (#717): the provider metadata behind a small ⓘ in the
    // title line, so the height-budgeted card gains no extra row
    // (.claude/rules/fitting-a-screen-to-the-viewport-height.md). Rendered
    // only when the game actually carries the data — and when it doesn't but
    // could, the card self-heals below.
    const infoBtn = gameInfoButton(game);
    if (infoBtn) card.querySelector('.vote__title').append(' ', infoBtn);
    else fetchCardGameInfo(game, card);

    // A card a beat delivered puts focus on its heading, so a keyboard or
    // screen-reader voter lands at the top of the new game rather than on
    // <body> (#1168). Deliberately NOT a rating: `wanted` is only ever set by
    // the two in-place handlers below and by the advance itself, so arriving
    // through a Back or a language switch still moves nothing.
    if (wanted && wanted.kind === 'title') restore = card.querySelector('.vote__title');

    /* The scale: 1–5 as mood faces, the same five for a member and a guest
       (#909 removed the members-only trash tile that used to sit below the 1).
       The selected one takes the rating's traffic-light colour.

       The faces come from rating-faces.js, which views-vote-link.js and the
       results distribution read too — the two cards must render the same markup
       and write the same vote shape (see that file's header), and the chart the
       group reads seconds later must name each rung with the same glyph. */
    const ratingEl = card.querySelector('.rating');
    for (let n = RATING_MIN; n <= RATING_MAX; n++) {
      const sel = current.rating === n;
      // aria-pressed + a label that spells out the scale (#145), the word too
      // under Der Tisch — one builder for both cards (vote-card-tisch.js).
      const b = voteMoodButton(n, sel);
      if (wanted && wanted.kind === 'mood' && wanted.n === n) restore = b;
      b.addEventListener('click', () => {
        /* The guard, and the whole safety story of #1168: this is what makes
           "no double-tap may ever rate the following game" true. The
           `.vote--advancing` class only stops a POINTER — an Enter on a focused
           face is not a pointer event and would sail straight past it. */
        if (advance.locked) return;
        votes[person.id][game.id] = { rating: n };
        refocus = { kind: 'mood', n };
        // Re-render first, so the beat is spent on a card showing the choice at
        // its traffic-light fill. That frame IS the acknowledgement; without it
        // the screen would simply jump and the tap would read as unregistered.
        render();
        // The node to hold is the one render() just built — the card this
        // handler closed over is already detached.
        advance.schedule(app.querySelector('.vote'), () => {
          // No "did idx move?" check here on purpose. It would be a SECOND
          // mechanism covering what advance.cancel() already covers in
          // onPopstate and guardLeave — and a redundant one is worse than
          // none: with it in place, deleting either cancel leaves every test
          // green, so the thing that actually protects the user stops being
          // guarded. Measured (#1168) — both breaks, zero red.
          if (idx === total - 1) return finish();
          refocus = { kind: 'title' };
          go(idx + 1);
          announceCard();
        });
      });
      ratingEl.appendChild(b);
    }

    const backBtn = card.querySelector('#backBtn');
    backBtn.disabled = idx === 0;
    backBtn.addEventListener('click', () => {
      if (advance.locked) return;
      history.back();
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
    if (finishing) return;
    finishing = true;
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
    } catch (e) { finishing = false; toast(e.message, { tone: 'error' }); }
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
               <span class="avatar${p.guest ? ' avatar--guest' : ''}"${p.guest ? '' : ` style="background:${memberColor(round, p.id)}"`}>${avatarFace(initials(p.name), { userId: p.userId })}</span>
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

/* `plain` (#796) forces the ordinary result screen for a multi-table session.
   Its one caller is the builder's own escape hatch, for a session drawn with
   „Mehrere Tische" that turns out to have no feasible split — too few people, or
   fewer usable games than tables. Without it that evening would have a screen
   with nothing on it but an apology. */
async function showResults(round, session, gamesHint, reveal, plain) {
  // A multi-table session's result IS the split, so it gets the builder (before
  // confirming) or the summary of its children (after) instead of the ranking.
  // Branching on the session rather than on a caller's flag is what makes every
  // way in — the finale, the lobby, the Chronik, a cold load — agree.
  if (!plain && (session.multiTable || isSplitParent(session)))
    return showTableBuilder(round, session, gamesHint);
  // The round's marker, applied HERE and not left to the hub: a results URL is
  // shared and cold-loaded (session-share.js, showResultsById), and this screen
  // used to render that visit without the round's look (#940, when the look was
  // still a round design). Idempotent, so the finale's path pays nothing for it.
  applyMarker(round);
  currentView = () => showResults(round, session, gamesHint, false, plain);
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

  /* Did anybody vote at all (#915)? A direct-play session (#532) is created
     with `votes: {}`, so it arrives here having asked nobody anything — and the
     whole ranking treatment then rendered its EMPTY state rather than being
     absent. Session-level on purpose, not per row: within a voted session a
     game added after the vote legitimately shows „–" beside its scored
     neighbours, and that row is still part of a ranking. A session nobody voted
     in is not a ranking at all. */
  const hasVotes = sessionHasVotes(session);
  /* Der Tisch composes this screen differently (#1275, T2.5/T4.4): compact rows
     under a header row, the people on the felt head, and a foot of its own. The
     markup lives in result-tafel-tisch.js; every branch below is on this one
     flag, and Klassisch is the path it leaves alone. */
  const tischLook = designIs('tisch');

  /* The „aussortiert" / „durchgespielt" badge (#250). Shared by the ranking row
     and the table band (#1107) rather than written twice: the band is the ONLY
     surface carrying it once the Tafel is gated away, so a look-alike copy here
     would be a fact that silently drifts. */
  const archivedBadge = (g) => (g.retired
    ? ` <span class="tag tag--retired">${iconText('ti-trash', t('result.retiredTag'))}</span>`
    : g.completed
      ? ` <span class="tag tag--completed">${iconText('ti-circle-check', t('result.completedTag'))}</span>`
      : '');

  /* Is this a direct-play session (#532) whose Tafel says nothing? Such a
     session is created with `votes: {}` and its game already chosen, so the
     section renders a heading naming a vote nobody was asked for over exactly
     one row restating the „Auf dem Tisch" band directly above it. #915 already
     stripped that row's vote-derived parts; this drops the rest (#1107).

     All three terms are load-bearing, and two of them guard states reachable
     TODAY rather than legacy data:
       !hasVotes          — session-level, per #915's reasoning.
       games.length === 1 — a lobby closed with zero votes and 2+ games is a
                            real state, and there the rows are the only list of
                            candidates the group has.
       chosenId           — draw ONE game, close the lobby with zero votes, and
                            nothing is chosen: the row's „Spielen" button is then
                            the only way onto the table. Without this term that
                            group lands on an empty screen.

     A FUNCTION, not a frozen flag: `chosenId` is mutable, so `updateChosen()`
     has to re-ask. The transition is one-way in practice, because the two
     clear-choice controls are dropped for this case below. */
  const isSoloDirectPlay = () => !hasVotes && games.length === 1 && !!chosenId;

  // Tally per game.
  const rows = games.map((g) => {
    const ratings = [];
    people.forEach((p) => {
      const v = (session.votes[p.id] || {})[g.id];
      if (v && Number.isFinite(v.rating)) ratings.push(v.rating);
    });
    const sum = ratings.reduce((a, b) => a + b, 0);
    const avg = ratings.length ? sum / ratings.length : 0;
    // The Spielwirbel-Score (#893): the same votes weighed through the tile
    // curve, so a game one person does not want to play stops outranking a game
    // everybody is fine with. `avg` stays for the share text's raw fallback and
    // for anything describing the votes rather than the game.
    const sc = scoreRatings(ratings);
    // Indexed by rating, so slot 0 is a permanent hole the chart below skips —
    // the same shape (and the same reason) as vote-score.js's TILE_VALUE.
    const dist = [0, 0, 0, 0, 0, 0];
    ratings.forEach((r) => dist[r]++);
    return {
      game: g,
      avg,
      score: sc ? sc.score : 0,
      // What the pill prints and what places tie on — see computePlaces.
      shown: sc ? displayScore(sc.score) : 0,
      vetoes: sc ? sc.vetoes : 0,
      count: ratings.length,
      dist,
    };
  });

  // Sorted on the UNCLAMPED score, so two games below the displayed floor still
  // order by how bad they actually are.
  rows.sort((a, b) => b.score - a.score);
  // Tie-aware places ("1, 2, 2, 4"): games with the same displayed score share
  // a place and a medal. Drives both the winner spotlight and the medal list.
  computePlaces(rows).forEach((place, i) => { rows[i].place = place; });

  app.innerHTML = '';
  // A finished session's results belong to the Chronik, and this is a routed
  // screen (unlike the wizard's transient steps, which deliberately resolve to
  // nothing and so get no strip).
  renderSubScreenTabs(round, 'session');
  app.appendChild(backRow(() => showRound(round.id)));
  /* ONE content wrapper for the whole result (#1055). Everything from the head
     down used to be a direct child of `#app`, which meant each block took the
     reading measure (`--w-read`, 900px) on its own and the screen could not opt
     out of it as a unit: measured 2026-09-12, the page was 2905px tall at every
     width from 1280 to 2560 while the pane grew to 1900, leaving 51% of a
     2560px pane empty.

     The sub-screen tab strip and the back row stay OUTSIDE it — the strip
     because navigation must not move with content
     (`.claude/rules/responsive-content-width.md`), the back row because it opts
     out alongside the wrapper in CSS instead, so their edges cannot drift apart
     (the #543/#577 lesson). The wrapper carries no padding or border, so the
     blocks inside keep collapsing their margins exactly as they did as
     children of `#app`. */
  const screen = h('<div class="result-screen"></div>');
  app.appendChild(screen);
  const when = fmtDateTime(session.createdAt);
  /* `page-head--result`, not a change to `.page-head` itself: that class is
     shared by ~16 sites and only this one puts a whole SENTENCE in the title
     slot. With the finished-session title („„Ticket to Ride" wurde gespielt.
     Max und Anna haben gewonnen!") the default `flex: 0 1 auto` first child
     fills all 900px and „Teilen" wraps to a second line — head 180px, button at
     x=312. The modifier gives that child `flex: 1 1 0; min-width: 0` so the
     sentence wraps inside its own column and the button keeps the edge. */
  const head = h(`<div class="page-head page-head--result"><div>
         <h1 class="result-title">${esc(t('result.title'))}</h1>
         <div class="muted">${esc(tn(games.length, 'result.subtitleOne', 'result.subtitle', { when }))}</div>
       </div></div>`);
  screen.appendChild(head);
  const titleEl = head.querySelector('.result-title');

  // „Teilen": hand the group chat what this screen says, as plain text (#526).
  // Hidden outright where neither API exists — which is a real case, not a
  // theoretical one: `navigator.clipboard` is undefined outside a secure
  // context, so a self-hosted plain-HTTP instance shows no button rather than a
  // dead one. `.page-head` is a space-between flex row, so the button is its
  // second child — but that alone parks it at the right edge only while the
  // title is SHORT. `page-head--result` above is what makes it hold for the
  // finished-session sentence too, which is every archived session (#1055).
  // The model is built at CLICK time, never up front: choosing a game,
  // finishing, recording winners and cancelling all mutate this closure's
  // state in place (updateChosen/renderTisch re-render only fragments), so a
  // text captured at render would share a result the user has since changed.
  const shareNow = !canShareResult() ? null : () => shareResult({
    roundName: round.name,
    when,
    cancelled,
    playedTitle: chosenId ? (games.find((g) => g.id === chosenId) || {}).title || null : null,
    winnerNames: winnerIds.map((wid) => personLabel(people.find((p) => p.id === wid))).filter(Boolean),
    // So the shared headline says „Verloren" where the screen does, instead
    // of the bare „wurde gespielt." every winnerless night used to get (#1038).
    ending: sessionEnding(session),
    rows: rows.map((r) => ({ title: r.game.title, score: r.shown, count: r.count, place: r.place })),
    // Who sat at the table, for a design that shares a CARD (#1199) — the
    // same people this screen lists under the headline, with the member
    // colour it paints them in. The text share ignores it.
    people: people.map((p) => ({
      name: personLabel(p),
      initials: initials(p.name),
      color: p.guest ? null : memberHex(round, p.id),
      winner: winnerIds.includes(p.id),
    })),
  });
  // Der Tisch carries „Teilen" in the foot instead, beside the next evening
  // (T2.5, T4.4 — see fillTischResultFoot).
  if (shareNow && !tischLook) {
    const shareBtn = h(`<button class="btn btn--ghost">${iconText('ti-share', t('share.button'))}</button>`);
    shareBtn.addEventListener('click', shareNow);
    head.appendChild(shareBtn);
  }

  // Who took part in this session — the people whose votes make up the result.
  let peopleEl = null;
  if (people.length) {
    // A guest has no member page, so their entry is a <span>, not an <a>: an
    // anchor with no href is neither focusable nor styled as a link, so emitting
    // one would leave dead markup behind (.claude/rules/in-app-nav-links.md).
    // Der Tisch adds a crown to every piece and a `data-pid` for
    // paintTischCrowns to find it by; Klassisch's markup is byte-for-byte as it was.
    peopleEl = h(`<div class="result-people">
         <span class="result-people__label">${esc(t('result.participants'))}</span>
         <span class="result-people__list">${people
           .map(
             (p) => `<${p.guest ? 'span' : 'a'} class="result-people__person"${p.guest ? '' : ` data-mid="${esc(p.id)}"`}${tischLook ? ` data-pid="${esc(p.id)}"` : ''}>
                ${tischLook ? tischPersonCrown() : ''}<span class="avatar${p.guest ? ' avatar--guest' : ''}"${p.guest ? '' : ` style="background:${memberColor(round, p.id)}"`}>${avatarFace(initials(p.name), { userId: p.userId })}</span>
                <span class="result-people__name">${esc(personLabel(p))}</span>
              </${p.guest ? 'span' : 'a'}>`
           )
           .join('')}</span>
       </div>`);
    // Each member participant opens that member's detail page.
    peopleEl.querySelectorAll('.result-people__person[data-mid]').forEach((el) => {
      makeMemberLink(el, round.id, el.dataset.mid);
    });
    // Under Der Tisch „Wer dabei war" sits ON the felt head, under its sentence,
    // as the sheet draws it (T2.5, T4.4).
    if (tischLook) head.firstElementChild.appendChild(peopleEl);
    else screen.appendChild(peopleEl);
  }

  // Who played together (#575). Listed as its own row rather than folded into
  // the participants above: that row answers "who was here", which is still one
  // entry per person, and a team is a different fact about the same people.
  const teamParties = parties.filter((p) => p.team);
  if (teamParties.length) {
    screen.appendChild(
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
        // „wurde gespielt." was the only sentence a winnerless night could get,
        // and it reads as unfinished business for the three nights that are
        // finished (#1038). `ending` is the session's own copy, kept in step by
        // saveWinners below.
        const meta = ENDING_LABELS[ending];
        titleEl.textContent = meta
          ? t(meta.title, { game: gname })
          : t('result.titlePlayed', { game: gname });
      } else {
        titleEl.textContent = tn(names.length, 'result.titleWonOne', 'result.titleWonMany', {
          game: gname,
          names: joinNames(names),
        });
      }
    } else {
      titleEl.textContent = t('result.title');
    }
  }

  let chosenId = session.chosenGameId || null;
  /* Der Tisch (#1057) — the chosen game, as a band above the Tafel, and the
     only place the evening's own controls live.

     It exists ONLY while a game is chosen. Before that nothing may take room:
     the deep-dive's empty „Auf dem Tisch" slot was rejected on 2026-09-12 for
     exactly that. What it replaces is the in-row `.row-finish` panel, which sat
     1000+px down a 2905px page on the evening it was needed, and then stayed
     there at full size afterwards — a 344px winner picker on a session finished
     months ago.

     The `.chosen-banner` is gone with it: `updateTitle` already states the
     outcome in the h1 („„X" wurde gespielt."), and the cancelled case has its
     own title too. `views-session-tables.js` still renders that class on the
     split screen, so the CSS stays. */
  const tischSlot = h('<div class="tisch-slot"></div>');
  const tisch = h('<section class="tisch" hidden></section>');
  tischSlot.appendChild(tisch);
  screen.appendChild(tischSlot);
  /* The band's one-shot unroll (#1058). Set by the CLICK that causes the moment
     and consumed by the next `renderTisch`, so a re-render from a chip toggle, a
     cold load, a Chronik visit or a shared link replays nothing. Its sibling flag
     gated the stamp's press, which #1122 removed. */
  let freshChoice = false;
  /* Der Tisch's fifth motion ritual (#1200, T10.5): true for the one render
     that follows a finish the reader just recorded — the transition into
     `finished`, never a winner change on an already-finished session, never a
     cold load of one. renderTisch() consumes it, exactly like freshChoice. */
  let freshStamp = false;

  // Cancel session (the alternative to choosing a game; see renderCancel).
  // Created here because updateChosen() -> renderCancel() runs below while the
  // footer that holds it is built later still; only the appendChild moves down
  // (#614). Writing into a detached node is fine — it is in the document by the
  // time anything can click it.
  const cancelWrap = h('<div class="cancel-area"></div>');
  // Der Tisch's foot takes the place of that footer row (#1275); built here for
  // the same reason, and filled by renderTischFoot.
  const tischFoot = tischLook ? h('<div class="result-foot" hidden></div>') : null;

  /* Die Tafel (#1056) — the ranked rows, carrying the celebration themselves.

     What this replaces: a 900px gold `.spotlight` around 272px of winner covers,
     sitting above rows that stated the same ranking again. It conflated two
     different facts — what the VOTE said (a top place, possibly shared) and what
     was PLAYED (one game, someone won) — so a tie showed two covers over one
     pair of winners with nothing linking them, and a group that played a third
     game made the hero contradict the record.

     The row is the whole instrument now: a rank rail, a background fill whose
     width IS the Spielwirbel-Score, and — for every row sharing first place —
     one gold group with one kicker. A tie therefore adds a ROW rather than
     growing anything, which is the property `.claude/rules/rank-encodings-must-
     not-be-growable-by-ties.md` asks for. */
  const tafel = h(`<div class="tafel">
       <div class="tafel__kick">
         <h2 class="tafel__title">${esc(tn(games.length, 'result.voteTitleOne', 'result.voteTitle', { n: games.length }))}</h2>
         <span class="tafel__hint" hidden>${esc(t('result.choosePrompt'))}</span>
       </div>
     </div>`);
  screen.appendChild(tafel);
  const tafelHint = tafel.querySelector('.tafel__hint');
  // Der Tisch's column-header row (#1275). Only over a ranking: a session nobody
  // voted in lists candidates, with no votes or score to head (#915). The
  // score's ⓘ moves up beside the heading, because the row's „Spielwirbel-Score"
  // label it used to ride is exactly what the header's „Score" replaces.
  if (tischLook && hasVotes) {
    if (rows.some((r) => r.count)) {
      tafel.querySelector('.tafel__title').insertAdjacentHTML('afterend', infoButton('score'));
    }
    tafel.appendChild(tischTafelCols());
  }
  /* The phone's one CTA (#1057). Desktop gets NO action bar: a sticky bar inside
     a column that fits never sticks and reads as one more card, which is why the
     deep-dive's first prototype had an invisible one. A thumb zone is a physical
     fact, so touch keeps it — CSS hides this above the rail breakpoint.

     Placed after the rows rather than after the footer: `position: sticky` pins
     an element while its containing block still extends below it, so this holds
     through the whole ranking and releases over the log. After the footer it
     would also trip the "nothing is appended after the footer" guard, which is
     there to keep the destructive actions last. */
  const tischBar = h('<div class="tisch-bar" hidden></div>');

  /* The gold group. Same gate the spotlight had: two or more games to rank, a
     top place to name, and a session that was not cancelled — a cancelled
     evening has nothing to celebrate, and a single-game session has nothing to
     have won. `reveal` is the only thing that animates it; every other way in
     (the Chronik, a shared link, a cold load) renders the rest state, which is
     also what a reduced-motion reader gets. */
  const topRows = rows.filter((r) => r.place === 1);
  const hasTop = rows.length >= 2 && topRows.length && !session.cancelled;
  let topGroup = null;
  if (hasTop) {
    const shared = topRows.length > 1;
    topGroup = h(`<div class="tafel-top${reveal ? ' is-reveal' : ''}">
         <div class="tafel-top__kicker">
           <i class="ti ti-crown tafel-top__crown" aria-hidden="true"></i>
           ${esc(t(shared ? 'result.winnerShared' : 'result.voteWinner'))}
         </div>
       </div>`);
    tafel.appendChild(topGroup);
    if (reveal) {
      // Design-agnostic on purpose (#940): a design may re-shape these SAME bits
      // in CSS (the round worlds did, until #1202), so nothing here knows which
      // design is worn. The per-bit randomness therefore travels as custom
      // properties: the colour, because an inline `background` would beat every
      // rule a design could write; and a horizontal drift, set for every bit
      // and simply ignored by the default fall.
      const conf = h('<div class="confetti" aria-hidden="true"></div>');
      for (let i = 0; i < 16; i++) {
        const bit = h('<span class="confetti__bit"></span>');
        bit.style.left = Math.round(Math.random() * 100) + '%';
        bit.style.setProperty('--bit-color', MEMBER_COLORS[i % MEMBER_COLORS.length]);
        bit.style.setProperty('--bit-drift', Math.round(Math.random() * 60 - 30) + 'px');
        bit.style.animationDelay = (Math.random() * 0.9).toFixed(2) + 's';
        conf.appendChild(bit);
      }
      topGroup.appendChild(conf);
    }
  }

  const maxBar = Math.max(1, ...rows.map((r) => Math.max(...r.dist)));
  const rowRefs = [];
  let infoPlaced = false;

  rows.forEach((r) => {
    const g = r.game;
    const imgStyle = g.image ? `style="background-image:url('${coverUrl(g.image, COVER_THUMB)}')"` : '';
    const fallback = coverPlaceholder(g);
    /* The distribution, drawn in the VOTE CARD's vocabulary (#890): five columns
       1–5, each tinted with `avgColor(n)` and named on an always-visible axis by
       the same mood face the voter pressed minutes earlier. (It had a sixth for
       the trash tile until #909 removed that rung; `dist` is still indexed by
       rating, so the chart drops slot 0 rather than re-basing the array.)

       What it replaces, and why: identical `--brand-edge` bars whose only
       numerals were vote COUNTS, sitting precisely where an axis label belongs.
       So a „3" in the fourth column read as „this is a 3" before it read as
       „three people", while bar height already carried that count. The label
       channel is spent on the axis instead, and colour does the rest — the
       columns stop having to be read as a left-to-right sequence at all.

       Counts stay in `title=`, on the whole column rather than the bar, so a
       one-vote column is still hoverable. The readable numbers remain the score
       and its „Spielwirbel-Score" label.

       The label cannot live INSIDE the bar: an unvoted rung is 0px tall, and
       every column must be labelled — that is what makes an empty rung read as
       an empty slot rather than as a missing one. Hence the full-height track
       behind each fill, and the separate axis row. */
    const bars = !hasVotes ? '' : r.dist
      .slice(RATING_MIN)
      .map((c, i) => {
        const n = i + RATING_MIN;
        const title = t('result.barTitle', { c, r: n });
        // The numeral stays `--ink-soft` while the fill and the glyph carry the
        // ramp: as TEXT on the page the tightest point of the ramp is ~4.58:1,
        // and a per-round theme moves the surface under it. A glyph is a
        // non-text UI component, so it sits at the 3:1 bar instead.
        /* `--sc` + `data-stop` rather than two inline colours (#1191). T8.2
           ships the bar half of a ramp DARKER than the pill half, because these
           sit on paper while a pill carries its own ink — so a design has to be
           able to repaint the fill and the glyph, and an inline `background`
           would beat every rule it could write. The continuous colour stays the
           default, so Klassisch is unchanged. */
        return `<div class="bar-col" title="${esc(title)}" style="--sc:${avgColor(n)}" data-stop="${rampStop(n)}">
             <div class="bar-track"><div class="bar" style="height:${Math.round((c / maxBar) * 100)}%"></div></div>
             <div class="bar-axis"><i class="ti ${ratingFace(n)}" aria-hidden="true"></i><span class="bar-axis__n">${n}</span></div>
           </div>`;
      })
      .join('');
    // Info if the game has been archived in the meantime (#250: either way).
    const retiredBadge = archivedBadge(g);
    /* The score's NAME, not a vote count (#902). Within one session `n` is the
       same on every row — the vote card refuses to advance until each drawn
       game has been placed somewhere on the scale (see the guard in
       renderVote) — so „Score aus 3" restated the participant line once per
       row while the number itself, no longer a plain mean since #893, went
       unnamed. A row nobody voted on prints the bare „–" and gets NO label at
       all: there is no score there to name.

       The single ⓘ rides the first labelled row, i.e. the highest-scoring game
       anybody voted on (`rows` is sorted by score above). score-info.js places
       it once per screen, never per pill. */
    const scoreLabel = r.count
      ? `<div class="score-label">${esc(t('score.name'))}${infoPlaced ? '' : ` ${infoButton('score')}`}</div>`
      : '';
    if (r.count) infoPlaced = true;
    /* Who brings the box, on EVERY row (#1008). #971 printed this only inside
       the chosen row's finish panel, and a VOTING session has no chosen game
       until somebody taps „Spielen" — so the one screen listing every candidate
       said nothing about ownership at the exact moment the group is deciding.
       Same shared rule as the panel, so the two can never disagree. */
    const bringers = boxBringers(round, session, g, shelfParty);
    const ownersLine = bringers.length
      ? `<div class="trow__owners">${iconText('ti-user', t('result.ownedBy', { names: bringers.join(', ') }))}</div>`
      : '';
    /* The fill: `--pct` is the displayed score over the scale's top, so the row
       IS its own bar chart and the empty part of a row is the score's
       remainder. That is what lets the row use the 544px of nothing it used to
       carry between the mini chart and the number — a wider column becomes a
       longer score axis instead of a wider gutter (`.claude/rules/tiles-vs-
       lists.md`). `--sc` travels as the raw accent and CSS does the mix, the
       `.stamp` mechanism from #1040: an inline `background` would beat every
       rule a design could write. A row nobody voted on carries 0%,
       so it is simply bare. */
    const pct = r.count ? Math.round((r.shown / RATING_MAX) * 1000) / 10 : 0;
    const fillVars = `--pct:${pct}%;${r.count ? `--sc:${scoreColor(r.score)};` : ''}`;
    // Only the reveal path gets a duration, and it is per row: every fill starts
    // together, the short ones land first and the winner's completes last.
    const raceVar = reveal && r.count ? `--dur:${(0.5 + r.shown * 0.32).toFixed(2)}s;` : '';
    const rankClass = r.place && r.place <= 3 ? ` trow__rank--${r.place}` : '';
    const row = tischLook ? tischTrow({
      row: r, gameId: g.id, hasVotes, bars, rankClass, imgStyle, fallback,
      rowClass: `trow${reveal ? ' is-race' : ''}`, rowStyle: `${fillVars}${raceVar}`,
      title: g.title, badge: retiredBadge, ownersLine,
      whyLine: r.count && scoreReason(r) ? `<div class="score-why">${esc(scoreReason(r))}</div>` : '',
    }) : h(`<div class="trow${reveal ? ' is-race' : ''}" style="${fillVars}${raceVar}">
         <span class="trow__rank${rankClass}">${r.place || ''}</span>
         <a class="trow__img" ${imgStyle}>${fallback}</a>
         <div class="trow__main">
           <a class="trow__title">${esc(g.title)}${retiredBadge}</a>
           ${ownersLine}
           ${r.count && scoreReason(r) ? `<div class="score-why">${esc(scoreReason(r))}</div>` : ''}
         </div>
         ${hasVotes ? `<div class="trow__bars">${bars}</div>` : ''}
         <div class="trow__score">
           ${!hasVotes ? '' : `
           <div class="score-big"${r.count ? ` style="--sc:${scoreColor(r.score)}"` : ''}>${r.count ? fmtAvg(r.shown) : '–'}</div>
           ${scoreLabel}`}
         </div>
         <div class="trow__action"></div>
       </div>`);
    // Title and cover open the game's detail page (the action column below lives
    // in a sibling element, so it keeps working independently). The cover is
    // flagged redundant: it targets the same game as the title beside it, so it
    // stays mouse-clickable but is not a second (nameless) tab stop.
    makeGameLink(row.querySelector('.trow__title'), round.id, g.id);
    makeGameLink(row.querySelector('.trow__img'), round.id, g.id, { redundant: true });
    rowRefs.push({ gameId: g.id, game: g, row, actionEl: row.querySelector('.trow__action'),
      ownersEl: row.querySelector('.trow__owners') });
    (hasTop && r.place === 1 ? topGroup : tafel).appendChild(row);
  });
  // One call for whatever the loop placed — and none to bind when no row had
  // votes. `wireInfoButtons` is idempotent, so the re-renders below (retire,
  // remove) cannot stack a second listener.
  screen.appendChild(tischBar);
  wireInfoButtons(app);

  async function removeGame(g) {
    if (!await confirmDialog({
      body: t('result.removeGameConfirm', { title: g.title }),
      confirmLabel: t('result.removeGame'), icon: 'ti-trash',
    })) return;
    try {
      await api('DELETE', `/api/rounds/${round.id}/sessions/${session.id}/games/${g.id}`);
      toast(t('result.toast.gameRemoved', { title: g.title }));
      const fresh = await fetchRoundFresh(round.id);
      const sess = fresh.sessions.find((s) => s.id === session.id) || session;
      showResults(fresh, sess, games);
    } catch (e) { toast(e.message, { tone: 'error' }); }
  }

  /* One action column per row, rebuilt by `updateChosen` whenever the phase
     moves. The old row carried a „Spielen" button that went `disabled` at 0.45
     opacity on every row of every finished session (245px over five rows) plus
     a permanent „Aus Session entfernen" trash link (168px) — spent instrument
     on a record. Nothing is disabled here: a control that cannot act is not
     rendered.

     The „…" menu is on EVERY row, not only on a finished one. Removing a game
     is the session's own housekeeping and must not disappear while the evening
     is running — the issue's phase list only requires that a FINISHED session
     have no bare remove link, and putting the menu everywhere satisfies that
     while keeping the action reachable in both phases. */
  function renderAction({ gameId, game, actionEl }) {
    actionEl.innerHTML = '';
    const isChosen = gameId === chosenId;
    if (finished || cancelled) {
      // nothing primary: the choice is settled and the row is a record
    } else if (isChosen) {
      actionEl.appendChild(h(`<span class="trow__chip">${iconText('ti-check', t('result.onTable'))}</span>`));
    } else {
      const btn = h(`<button class="btn play-btn">${iconText('ti-player-play', t('result.play'))}</button>`);
      btn.addEventListener('click', async () => {
        try {
          await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/choice`, { gameId });
          chosenId = gameId;
          session.chosenGameId = gameId;
          freshChoice = true;
          updateChosen();
          // The row lifts as it hands its game to the table (#1058). Added
          // AFTER the re-render, because `updateChosen` rebuilds the action
          // column and a class set before it would be on a node nobody sees.
          // Removed on `animationend` so a later re-render cannot replay it.
          const lifted = rowRefs.find((x) => x.gameId === gameId);
          if (lifted) {
            lifted.row.classList.add('is-lift');
            lifted.row.addEventListener('animationend', function off(e) {
              if (e.animationName !== 'trow-lift') return;
              lifted.row.classList.remove('is-lift');
              lifted.row.removeEventListener('animationend', off);
            });
          }
          toast(t('result.toast.willPlay', { title: game.title }));
        } catch (e) { toast(e.message, { tone: 'error' }); }
      });
      actionEl.appendChild(btn);
    }
    const menuBtn = h(`<button type="button" class="btn btn--sm trow__menu" aria-label="${esc(t('result.more'))}" aria-expanded="false"><i class="ti ti-dots" aria-hidden="true"></i></button>`);
    const items = [{ icon: 'ti-external-link', label: t('result.openGame'), kind: 'edit', run: () => showGameDetail(round.id, gameId) }];
    // Un-choosing is how a live session changes its mind; it was the second tap
    // on „Spielen" before the chip replaced that button.
    // Not for a solo direct-play session: with one game there is nothing else to
    // choose, and with the Tafel gone there would be no way back (#1107). The
    // escape hatch stays „Session löschen" in the footer.
    if (isChosen && !finished && !cancelled && !isSoloDirectPlay()) {
      items.push({ icon: 'ti-x', label: t('result.clearChoice'), kind: 'undoable', run: async () => {
        try {
          await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/choice`, { gameId: null });
          chosenId = null;
          session.chosenGameId = null;
          updateChosen();
          toast(t('result.toast.choiceCleared'));
        } catch (e) { toast(e.message, { tone: 'error' }); }
      } });
    }
    items.push({ icon: 'ti-trash', label: t('result.removeGame'), kind: 'destructive', run: () => removeGame(game) });
    // Buttons only, so this is a popover at every width — the account menu's
    // case, not the editors' (.claude/rules/popover-vs-sheet-editors.md §2b).
    // `aria-expanded` is synced through openPopover's onClose rather than by
    // wrapping `close`: the wrapped form misses four of the six exits.
    menuBtn.addEventListener('click', () => {
      openPopover(menuBtn, (el, close) => fillMenu(el, items, close),
        () => menuBtn.setAttribute('aria-expanded', 'false'));
      menuBtn.setAttribute('aria-expanded', 'true');
    });
    actionEl.appendChild(menuBtn);
  }

  function updateChosen() {
    rowRefs.forEach((ref) => {
      ref.row.classList.toggle('is-chosen', ref.gameId === chosenId);
      renderAction(ref);
    });
    // The prompt lives on the Tafel's own kicker now, beside the heading it
    // belongs to, rather than in a banner between the head and the rows.
    if (tafelHint) tafelHint.hidden = !!(chosenId || finished || cancelled);
    // …and the whole section stands down when it would only restate the band
    // (#1107). Toggled here rather than skipped at build time so `rowRefs` stays
    // intact and nothing downstream needs a null check.
    tafel.hidden = isSoloDirectPlay();
    renderCancel();
    renderTisch();
  }

  // --- Finish game / record winners (rendered inside the chosen game's tile) ---
  let finished = !!session.finished;
  let cancelled = !!session.cancelled;
  let winnerIds = Array.isArray(session.winnerIds) ? session.winnerIds.slice() : [];
  // How it ended when nobody won (#1038). Null unless the session carries one —
  // and mutually exclusive with `winnerIds` by the route's own rule, so these
  // two never both hold a value.
  let ending = ENDINGS.includes(session.ending) ? session.ending : null;
  /* Is the winner picker showing? False on load, so an archived session opens on
     the PICTURE (seats or the ending line) rather than on a 344px picker for a
     question answered months ago. It turns true for exactly two moments: right
     after „Als gespielt markieren", when the one question left is who won, and
     on „Ändern". A party tap keeps it open (#1327) — several people often won —
     while an ending (single-choice) or „Fertig" collapses it again. */
  let pickerOpen = false;
  /* Which party chip to hand keyboard focus back to after the re-render a tap
     causes (#1327): renderTisch() rebuilds the chips, so the tapped button is
     detached and focus would fall to <body> — a full Tab back into the picker
     for every further winner. Same shape as the rating step's `refocus`: set
     only by the party chip handler, consumed (and cleared) by the next
     renderTisch(), and never set when the picker closes, so arriving on the
     picture never yanks focus. */
  let pickerRefocus = null;

  // Cancel is the alternative final state: only offered while no game is
  // chosen, and undoable like the finish reset. Rendered as a `link-btn` in the
  // footer next to „Session löschen" (#614) — the rare escape hatch, not a peer
  // of the result it used to sit above.
  // The two cancel actions and the delete, as closures both footers call — the
  // Klassisch link row below and Der Tisch's „Mehr" menu (#1275) — so the two
  // designs cannot drift apart on what cancelling or deleting actually does.
  async function setCancelled(next) {
    try {
      await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/cancel`, { cancelled: next });
      cancelled = next;
      session.cancelled = next;
      if (!next) session.cancelledAt = null;
      toast(t(next ? 'result.toast.cancelled' : 'result.toast.cancelUndone'));
      updateChosen();
    } catch (e) { toast(e.message, { tone: 'error' }); }
  }
  async function confirmCancel() {
    if (!await confirmDialog({
      body: t('result.cancelConfirm'), confirmLabel: t('result.cancel'), icon: 'ti-x',
    })) return;
    await setCancelled(true);
  }
  async function deleteThisSession() {
    if (!await confirmDialog({
      body: t('sessions.deleteConfirm', { when }),
      confirmLabel: t('result.deleteSession'), icon: 'ti-trash',
    })) return;
    try {
      await api('DELETE', `/api/rounds/${round.id}/sessions/${session.id}`);
      toast(t('sessions.deleted'));
      showRound(round.id);
    } catch (e) { toast(e.message, { tone: 'error' }); }
  }

  function renderCancel() {
    cancelWrap.innerHTML = '';
    if (finished || chosenId) return;
    if (cancelled) {
      const undo = h(`<button class="link-btn">${esc(t('result.cancelUndo'))}</button>`);
      undo.addEventListener('click', () => setCancelled(false));
      cancelWrap.appendChild(undo);
    } else {
      // „Session abbrechen" alone, with the reason („Kein Spiel gefällt") moved
      // to the title (#817): spelled out it was 293px, which with „Session
      // löschen" beside it wrapped the footer row at 375px. Visible text is
      // present, so the title supplies the accessible DESCRIPTION and not the
      // name — SC 2.5.3 is unaffected.
      const btn = h(`<button class="link-btn" title="${esc(t('result.cancelHint'))}">${iconText('ti-x', t('result.cancel'))}</button>`);
      btn.addEventListener('click', confirmCancel);
      cancelWrap.appendChild(btn);
    }
  }

  /* Der Tisch's foot (#1275): „Noch eine Session" once this one is settled,
     „Teilen", and „Mehr" holding what Klassisch's footer row offers — cancel
     (or its undo) while no game is chosen, and delete for a co-owner. Refilled
     from renderTisch, which every phase change reaches.

     „Noch eine Session" opens the setup PREFILLED with tonight's members
     (operator question 1, decided unilaterally — see the PR): the same people
     sitting down again is the common case, and a plain setup would seat every
     member of the round. Guests are not carried: they were named for this
     session only, and the setup's guest list is the place to add them again. */
  function renderTischFoot() {
    if (!tischFoot) return;
    const more = [];
    if (!finished && !chosenId) {
      more.push(cancelled
        ? { icon: 'ti-arrow-back-up', label: t('result.cancelUndo'), kind: 'undoable', run: () => setCancelled(false) }
        : { icon: 'ti-x', label: t('result.cancel'), kind: 'destructive', run: confirmCancel });
    }
    if (roundCan(round, 'session.delete')) {
      more.push({ icon: 'ti-trash', label: t('result.deleteSession'), kind: 'destructive', run: deleteThisSession });
    }
    const memberIds = people.filter((p) => !p.guest).map((p) => p.id);
    fillTischResultFoot(tischFoot, {
      again: finished || cancelled ? () => showStartSession(round, { memberIds }) : null,
      againDisabled: !round.games.some(isActiveGame),
      share: shareNow,
      more,
    });
  }

  /* Der Tisch (#1057). One builder for all three states of the chosen game, so
     the evening and the record cannot drift apart:

       am Tisch   — box, title, who brings it, the expansion note, „Als gespielt
                    markieren" and „Anderes Spiel wählen".
       frisch fertig — the stamp on the box and the picker OPEN, because the one
                    question left is who won.
       im Archiv  — the stamp and the winners as SEATS, with the picker behind
                    „Ändern". The record needs the outcome once, as a picture.

     `updateChosen()` calls this on every phase change, so nothing here holds
     state of its own beyond `pickerOpen`. */
  function renderTisch() {
    updateTitle();
    // Consumed at the top so every exit, including the early return below,
    // clears it — a stale intent must not fire on a later, unrelated render.
    const wantedChip = pickerRefocus;
    pickerRefocus = null;
    // Der Tisch's crowns and foot follow every phase change, and this is the
    // one function all of them reach — including the early return below.
    if (tischLook) {
      paintTischCrowns(peopleEl, winnerIds);
      renderTischFoot();
    }
    rowRefs.forEach(({ gameId, ownersEl }) => {
      // The table band states the same fact with more context, so the chosen
      // row's own line stands down rather than saying it twice on one screen.
      if (ownersEl) ownersEl.hidden = gameId === chosenId;
    });
    tisch.innerHTML = '';
    tischBar.innerHTML = '';
    // Cleared on every pass and re-set below only for the one render that earned
    // it: an attribute left behind would re-run the animation on the next write.
    tischSlot.removeAttribute('data-unroll');
    tischSlot.removeAttribute('data-stamped');
    tisch.hidden = !chosenId;
    tischBar.hidden = true;
    if (!chosenId) { freshChoice = false; freshStamp = false; return; }
    if (freshChoice) { tischSlot.setAttribute('data-unroll', ''); freshChoice = false; }
    if (freshStamp) {
      if (tischLook && finished) tischSlot.setAttribute('data-stamped', '');
      freshStamp = false;
    }
    const game = games.find((g) => g.id === chosenId);
    /* Three states, matching the three render branches below exactly — the
       picker is a sub-state of `done`, not a fourth one: the finish is already
       recorded when it opens. `picking` is what lets the phone rule narrow the
       band while the question is on screen (#1139) without touching the width
       the record is read at. */
    tisch.dataset.state = !finished ? 'table' : (pickerOpen ? 'picking' : 'done');

    const imgStyle = game && game.image
      ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"`
      : '';
    const box = h(`<a class="tisch__box"${imgStyle}>${game ? coverPlaceholder(game) : ''}</a>`);
    if (game) makeGameLink(box, round.id, game.id, { redundant: true });
    if (finished) {
      /* The same stamp the game page shows (#1040) — the class, not a
         look-alike — so the two surfaces can never drift. `--sc` is the score,
         which is what makes a well-liked evening's stamp read differently from
         a lukewarm one. `--table` only re-sizes it onto the box. */
      const r = rows.find((x) => x.game && x.game.id === chosenId);
      const sc = r && r.count ? ` style="--sc:${scoreColor(r.score)}"` : '';
      // `finishedAt` only if it actually parses: a session finished before #254
      // recorded one has none, and a garbage value would print „Invalid Date"
      // onto the record rather than falling back to the evening it happened.
      const at = [session.finishedAt, session.createdAt]
        .find((d) => d && !Number.isNaN(Date.parse(d)));
      box.appendChild(h(`<span class="stamp stamp--table"${sc}>
           <span class="stamp__status">${esc(t('result.stamp'))}</span>
           ${at ? `<span class="stamp__date">${esc(fmtDate(at))}</span>` : ''}
         </span>`));
    }

    const main = h('<div class="tisch__main"></div>');
    main.appendChild(h(`<div class="tisch__kick">${esc(t('result.tableTitle'))}</div>`));
    /* The archived badge rides INSIDE the title anchor, exactly as the ranking
       row builds it — same helper, same classes, same placement. Once the Tafel
       is gated away on a solo direct-play session the band is the only surface
       left that can say a game was retired or completed after the fact (#1107),
       and a badge sitting in a different place would be a second implementation
       waiting to drift. It joins the link's accessible name, which is the
       behaviour the row has shipped since #250. */
    const title = h(`<a class="tisch__title">${esc(game ? game.title : '')}${game ? archivedBadge(game) : ''}</a>`);
    if (game) makeGameLink(title, round.id, game.id);
    main.appendChild(title);

    // Say so when the base box does NOT seat this table and an owned expansion
    // is what made the game drawable at all (#653) — otherwise the group
    // carries the wrong box to the table. Derived from the same predicate the
    // draw used, so the warning can never name a different set.
    const needed = game ? requiredExpansions(game, parties.length) : [];
    if (needed.length) {
      main.appendChild(h(`<div class="tisch__note tisch__note--warn">${iconText('ti-alert-triangle', t('result.needsExpansion', { names: needed.map((e) => e.title).join(', ') }))}</div>`));
    }
    // „Gehört Anna" (#971) — who has to bring the box, via the shared rule in
    // owner-picker.js so this band and the ranking rows can never list one
    // game's owners differently (#1008).
    const bringers = boxBringers(round, session, game, shelfParty);
    if (bringers.length) {
      main.appendChild(h(`<div class="tisch__note">${iconText('ti-user', t('result.ownedBy', { names: bringers.join(', ') }))}</div>`));
    }

    const actions = h('<div class="tisch__actions"></div>');
    let restoreChip = null;

    if (!finished) {
      // Finishing comes first and needs no winners; the picker only appears
      // afterwards, so it can never read as a prerequisite (#254).
      const cta = h(`<button class="btn btn--primary tisch__cta">${iconText('ti-check', t('result.markPlayed'))}</button>`);
      cta.addEventListener('click', () => { pickerOpen = true; saveWinners([]); });
      actions.appendChild(cta);
      // Today's toggle-off path, spelled out: tapping „Spielen" again on the
      // chosen row used to be the only way back, which is invisible. Suppressed
      // for a solo direct-play session, where there is no other game (#1107).
      const other = isSoloDirectPlay() ? null
        : h(`<button class="link-btn">${esc(t('result.otherGame'))}</button>`);
      if (other) {
        other.addEventListener('click', async () => {
          try {
            await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/choice`, { gameId: null });
            chosenId = null;
            session.chosenGameId = null;
            updateChosen();
            toast(t('result.toast.choiceCleared'));
          } catch (e) { toast(e.message, { tone: 'error' }); }
        });
        actions.appendChild(other);
      }
      main.appendChild(actions);
      // The phone's copy of the one CTA. A second button rather than a moved
      // one: both must be live at once, because the band's own CTA is what a
      // tablet and a desktop press.
      const barBtn = h(`<button class="btn btn--primary">${iconText('ti-check', t('result.markPlayed'))}</button>`);
      barBtn.addEventListener('click', () => { pickerOpen = true; saveWinners([]); });
      tischBar.appendChild(barBtn);
      tischBar.hidden = false;
    } else if (pickerOpen) {
      main.appendChild(h(`<div class="tisch__prompt">${esc(t('result.whoWon'))}</div>`));

      /* ONE picker for every design (#1327). Klassisch, Der Tisch, Ocean and any
         design added later all render these rows from here, and its open/close
         behaviour — party taps keep it open, an ending or „Fertig" closes it,
         focus follows the tapped chip — lives here and nowhere else. A design
         RESTYLES the picker (`.winner-chip` in its stylesheet); it must not fork
         it, or the old collapse-on-every-tap comes back on that design alone.

         Guests can win too (#458) — they played the game. They just never enter
         the round-level standings; see the Pokale tab.

         One chip per PARTY (#575), so a team is recorded in a single tap. What
         is stored stays a flat list of person ids: a team win is a win for each
         of its people, which is what lets the Pokale standings, the Chronik and
         the recap keep reading `winnerIds` with no idea teams exist. */
      const chips = h('<div class="winner-chips"></div>');
      parties.forEach((party, pi) => {
        const ids = party.people.map((pp) => pp.id);
        // A team counts as selected only when ALL of its people are in — a
        // partially-set list reads as not selected, so one tap completes it
        // rather than clearing it.
        const sel = ids.every((id) => winnerIds.includes(id));
        const chip = h(`<button class="winner-chip ${sel ? 'is-selected' : ''}" aria-pressed="${sel}">${sel ? '<i class="ti ti-trophy" aria-hidden="true"></i> ' : ''}${party.team ? '<i class="ti ti-users" aria-hidden="true"></i> ' : ''}${esc(party.name)}</button>`);
        // Each toggle persists right away — no separate save button in this
        // state — and leaves the picker OPEN (#1327), so a shared win is two
        // or three taps rather than a tap and „Ändern" per winner. „Fertig"
        // below is what closes it. Keyed by position: `parties` is rebuilt
        // from the same session on every render, so index i is the same party.
        chip.addEventListener('click', () => {
          pickerRefocus = pi;
          saveWinners(sel
            ? winnerIds.filter((x) => !ids.includes(x))
            : [...winnerIds, ...ids.filter((id) => !winnerIds.includes(id))]);
        });
        chips.appendChild(chip);
        if (wantedChip === pi) restoreChip = chip;
      });
      main.appendChild(chips);

      /* The second row: how it ended when nobody won (#1038). Same chip
         component as the parties above, because it answers the same question —
         the two rows are mutually exclusive by construction, so selecting one
         deselects the other with no extra state to keep in step: the server
         clears whichever the request did not carry, and this re-renders from
         what it returned. */
      const endChips = h('<div class="winner-chips"></div>');
      ENDINGS.forEach((id) => {
        const meta = ENDING_LABELS[id];
        const sel = ending === id;
        const chip = h(`<button class="winner-chip ${sel ? 'is-selected' : ''}" aria-pressed="${sel}">${iconText(meta.icon, t(meta.key))}</button>`);
        // Tapping the selected one again returns to "nothing recorded", which is
        // the same toggle the party chips give and the only way back without Reset.
        chip.addEventListener('click', () => { pickerOpen = false; saveWinners([], sel ? null : id); });
        endChips.appendChild(chip);
      });
      main.appendChild(endChips);

      const done = h(`<button class="btn btn--ghost">${esc(t('result.done'))}</button>`);
      done.addEventListener('click', () => { pickerOpen = false; renderTisch(); });
      actions.appendChild(done);
    } else {
      /* The record, as a picture. One seat per winner — a team win is already a
         flat list of its people, so nothing here knows teams exist — and an
         ENDING renders its own line instead, because the two are exclusive. */
      const winners = winnerIds.map((wid) => people.find((pp) => pp.id === wid)).filter(Boolean);
      if (winners.length) {
        const seats = h('<div class="tisch__seats"></div>');
        winners.forEach((pp) => {
          seats.appendChild(h(`<span class="seat">
               <span class="avatar${pp.guest ? ' avatar--guest' : ''}"${pp.guest ? '' : ` style="background:${memberColor(round, pp.id)}"`}>${avatarFace(initials(pp.name), { userId: pp.userId })}</span>
               <span class="seat__name">${esc(personLabel(pp))}</span>
             </span>`));
        });
        seats.appendChild(h(`<span class="tisch__won">${esc(tn(winners.length, 'result.wonSeatsOne', 'result.wonSeats'))}</span>`));
        main.appendChild(seats);
      } else {
        const meta = ENDING_LABELS[ending];
        main.appendChild(h(`<div class="tisch__outcome">${meta
          ? iconText(meta.icon, t(meta.line))
          : iconText('ti-check', t('result.playedNoWinner'))}</div>`));
      }
      /* „Falls etwas anders lief" (T4.4): the three controls that CORRECT a
         settled record — change the winner, say another game was played, reset
         — are a labelled group rather than three loose buttons. Only in this
         state: while the evening is still running the same element holds „Als
         gespielt markieren", which is not a correction, and while the winner
         picker is open it holds „Fertig".

         Rendered on every design and hidden by styles.css, the same "render it,
         let CSS decide" shape the pool and the dock use. The alternative — a
         `::before` carrying the words — cannot be translated into the shipped
         locales at all. */
      actions.appendChild(h(`<span class="tisch__actions-label">${esc(t('result.corrections'))}</span>`));
      const change = h(`<button class="btn btn--ghost btn--sm">${esc(t('result.change'))}</button>`);
      change.addEventListener('click', () => { pickerOpen = true; renderTisch(); });
      actions.appendChild(change);
    }

    if (finished) {
      const resetBtn = h(`<button class="link-btn">${esc(t('result.reset'))}</button>`);
      resetBtn.addEventListener('click', async () => {
        try {
          await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/finish`, {
            finished: false,
            winnerIds: [],
          });
          finished = false;
          winnerIds = [];
          ending = null;
          pickerOpen = false;
          session.finished = false;
          session.winnerIds = [];
          delete session.ending;
          session.finishedAt = null; // the server clears it too; keep the copy honest
          toast(t('result.toast.reset'));
          updateChosen();
        } catch (e) { toast(e.message, { tone: 'error' }); }
      });
      actions.appendChild(resetBtn);

      /* „An BG Stats übergeben" (#485): the whole play as one tappable link.

         Rendered only for an account that opted in (Konto → BG Stats), because a
         website cannot detect whether the app is installed and the vendor's own
         guidance is to let the user enable the button rather than dead-end
         everyone else. Built here rather than at click time because renderTisch()
         re-runs after every winner toggle, so the href is never stale — and a
         real anchor is long-pressable and copyable, which a JS click is not.

         `noreferrer` as well as `noopener`: the referrer would otherwise carry
         this round's and session's ids to a third party that has no use for them
         (.claude/rules/secrets-in-paths-reach-the-logs.md, same reasoning one hop
         further out). */
      const pushUrl = bgStatsEnabled()
        ? bgStatsPlayUrl({ session, game, people, parties, winnerIds })
        : null;
      if (pushUrl) {
        actions.appendChild(h(`<a class="link-btn" target="_blank" rel="noopener noreferrer" href="${esc(pushUrl)}">${iconText('ti-external-link', t('result.bgStats'))}</a>`));
      }
      main.appendChild(actions);
    }

    tisch.appendChild(box);
    tisch.appendChild(main);
    // After both are attached: focus() on a detached node does nothing.
    if (restoreChip) restoreChip.focus();
  }

  // Marks the session finished with the given winners (possibly none) and
  // re-renders; only committed to local state once the server accepted it.
  async function saveWinners(ids, nextEnding) {
    try {
      const saved = await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/finish`, {
        finished: true,
        winnerIds: ids,
        // Omitted rather than sent as null when there is none: the route CLEARS
        // a stored ending on every finish that does not carry one, so a winner
        // tap needs no second field to replace it (#1038).
        ...(nextEnding ? { ending: nextEnding } : {}),
      });
      if (!finished) freshStamp = true;
      finished = true;
      winnerIds = saved.winnerIds.slice(); // filtered server-side
      // Read back from the server, never from the argument: it is the side that
      // decides the exclusivity, so this is what keeps the two chip rows honest.
      ending = saved.ending || null;
      session.finished = true;
      session.winnerIds = winnerIds.slice();
      if (ending) session.ending = ending; else delete session.ending;
      // The server stamps this, and the BG Stats push (#485) sends it as the
      // play's date — without the sync it would fall back to createdAt, i.e.
      // report the evening as having happened when the draw started, until the
      // next reload.
      session.finishedAt = saved.finishedAt || session.finishedAt;
      toast(t('result.toast.saved'));
      renderTisch();
    } catch (e) {
      // Nothing was re-rendered, so the tapped chip still holds focus; a
      // leftover intent would otherwise fire on some later, unrelated render.
      pickerRefocus = null;
      toast(e.message, { tone: 'error' });
    }
  }

  updateChosen();

  // What happened during this session (#209), between the games and the
  // destructive action: a hybrid evening's votes can come from several people's
  // accounts, so the results are only half the story without it. Rendered by
  // views-session-live.js — a later file in the load order, which is fine
  // because this runs on navigation, never at load time
  // (.claude/rules/frontend-script-load-order.md).
  // Collapsed here (#1055): 355px on every visit for a list most sessions never
  // open. The lobby renders the same builder open — there it is the live record.
  const sessionLog = renderSessionLog(round, session, { collapsed: true });
  if (sessionLog) screen.appendChild(sessionLog);

  // One install nudge (#616), at the one moment the app has just delivered
  // something. Above the footer, because the footer's two controls are how you
  // throw this evening away and nothing may push them off the end of the screen.
  const installOffer = buildInstallOffer(reveal);
  if (installOffer) screen.appendChild(installOffer);

  // The two ways to get rid of this session, together and last on the screen:
  // cancel (reversible, destroys nothing) before delete (permanent). Both sit
  // below the games and the log so reading the results never means scrolling
  // past the way to throw them away (#614). It sat above the terminal "Zurück"
  // row until #623 moved that control to the top of the content, so this is now
  // simply the final block; the #561 constraint it was phrased against
  // ("nothing belongs after a back link") is satisfied by construction.
  // Der Tisch ends on its own foot instead, which carries the same two actions
  // behind „Mehr" (renderTischFoot) — still the last block on the screen.
  if (tischFoot) {
    screen.appendChild(tischFoot);
    return;
  }
  const footer = h('<div class="section result-footer"></div>');
  footer.appendChild(cancelWrap);
  // #137: deleting a played evening destroys its votes, result and winners for
  // everyone, so it is co-owner and up. Cancelling (above) stays an ordinary
  // write — it is reversible and is part of running the session.
  if (roundCan(round, 'session.delete')) {
    const delBtn = h(`<button class="link-btn" style="color:var(--danger)">${esc(t('result.deleteSession'))}</button>`);
    delBtn.addEventListener('click', deleteThisSession);
    footer.appendChild(delBtn);
  }
  screen.appendChild(footer);
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
  const text = sessionShareText(model, t, joinNames, tn, fmtAvg);
  if (designCard() && await shareResultCard(model, text)) return;
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
    toast(t('share.toast.copied'), { tone: 'success' });
  } catch {
    toast(t('share.toast.failed'), { tone: 'error' });
  }
}
