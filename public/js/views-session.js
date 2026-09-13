/* Spielwirbel – views: session setup, voting (hot-seat), finale reveal, and
   results (winner spotlight + ranked rows). Part of the frontend; all files
   share one global script scope. */

// =================== Session: setup ===================

/* The whirl's per-cover head start (#1017), written inline as `--wd` and read by
   the `pot-whirl` animation in styles.css. It is what makes the pot turn as a
   pot rather than as one rigid block.

   Derived from the INDEX, not from a random draw: every seat tap, tag chip and
   stepper press re-runs updateHint(), and a delay that changed on each render
   would make the same pot break differently every time it is looked at.

   Seven entries on purpose — the panel fits 3–5 covers per row, and 7 is coprime
   with all of them, so no column ever shares one delay down its whole length. */
const POT_WHIRL_DELAY = [0, 0.06, 0.02, 0.08, 0.04, 0.07, 0.03];
const potStagger = (i) => `--wd:${POT_WHIRL_DELAY[i % POT_WHIRL_DELAY.length]}s`;

/* One cover's turn. The SAME decision as the `pot-whirl` keyframe's duration in
   styles.css, and test/session-pot.test.js pins the two to each other: drifted,
   the lobby either cuts the turn off or opens after a dead pause, with nothing
   red anywhere. 0.9s sits deliberately off the --dur-* micro-interaction scale,
   like the finale seal and the podium rise — see the comment on those tokens. */
const POT_TURN_MS = 900;

/* How long „Loswirbeln" holds the screen. DERIVED, because the covers do not all
   start together: the last one to go begins a stagger later, so a flat 900 would
   swap the lobby in while it was still turning. Computed rather than written
   down so retuning the stagger table cannot leave this behind — the bug would be
   a tail of covers cut off mid-spin, which nothing errors on.
   `Math.round` because 0.08 * 1000 is 80.00000000000001. */
const WHIRL_MS = POT_TURN_MS + Math.round(Math.max(...POT_WHIRL_DELAY) * 1000);

/* `prefill` (#923) is a partial, shaped exactly like `round.lastSessionFilters`,
   that WINS over the stored preset for this entry only — the quick-start chips
   on the hub. It is a shallow merge at the top level, so a chip carrying
   `metadata` replaces the remembered metadata block wholesale rather than
   merging into it: a chip named „unter 60 Min" that quietly inherited last
   week's complexity range would open a pool nobody asked for and offer no clue
   why it is that small.

   Nothing here persists it. `lastSessionFilters` is written server-side by the
   draw itself, so an exploratory tap that never draws leaves the round's
   remembered preset untouched. */
function showStartSession(round, prefill) {
  currentView = () => showStartSession(round, prefill);
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
  const joining = new Set(round.members.map((m) => m.id));
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
  // Split into a declaration and an attribute builder because a pot cover carries
  // TWO things in one `style` — its cover and its whirl delay — and a pre-baked
  // `style="…"` cannot be merged with a second one.
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
  const updateHint = () => {
    const games = pool();
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
      .map((g, i) => `<span class="pool-thumb"${styleAttr(potStagger(i), coverDecl(g, COVER_THUMB))} title="${esc(g.title)}">${coverPlaceholder(g)}</span>`)
      .join('');
    hint.innerHTML = potCount(games.length) + `<span class="pool-shelf">${shelf}</span>`;

    // Deliberately not a live region: the ring centre and the panel title already
    // state these two numbers, and a third announcement on every seat tap would
    // talk over the ownersNote below, which IS one.
    barSummary.textContent = tn(joining.size + guests.length,
      'startSession.tableCountOne', 'startSession.tableCount') + ' · ' + headline;

    // Tile panel (860px up). An empty pool needs its own line: a grid with no
    // tiles reads as a broken panel rather than as "nothing matches yet".
    poolTitle.innerHTML = potCount(games.length);
    poolGrid.innerHTML = games.length
      ? games
          .map(
            (g, i) => `<span class="pool-tile"${styleAttr(potStagger(i))} title="${esc(g.title)}">
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
  }, guestList);
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
      shelfChips.replaceChildren(...round.members.filter((m) => joining.has(m.id)).map((m) => {
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
          names: joinNames(round.members.filter((m) => awayShelves.has(m.id)).map((m) => m.name)),
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
    });
  });

  /* The browser default where the media feature is unsupported is "motion is
     fine", so an ABSENT matchMedia must not read as `reduce` — that inversion
     would silently drop the whirl for everyone in such an environment while
     looking like a conservative guard. */
  const motionAllowed = () =>
    !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* The draw is in flight. It exists because of the whirl: holding the screen
     open for WHIRL_MS is WHIRL_MS in which a second press books a second
     session, and the button is not disabled while the request runs. */
  let drawing = false;

  form.querySelector('#go').addEventListener('click', async () => {
    let count = parseInt(countInput.value, 10);
    if (!Number.isFinite(count) || count < 1) count = 1;
    if (drawing) return;
    // Both guards refuse the draw outright, so nothing whirls: a pot that turns
    // and then toasts would announce a draw that never started.
    if (joining.size === 0) return toast(t('startSession.toast.noMembers'));
    if (pool().length === 0) return toast(t('startSession.toast.noGames'));
    /* The pot turns while the request runs — Promise.all rather than a chained
       delay, so a slow POST costs nothing on top of the animation and a fast one
       still gets the whole turn instead of a flicker. */
    const whirl = motionAllowed();
    drawing = true;
    if (whirl) form.classList.add('is-whirl');
    try {
      const [data] = await Promise.all([api('POST', `/api/rounds/${round.id}/sessions`, {
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
      }), whirl ? new Promise((resolve) => setTimeout(resolve, WHIRL_MS)) : null]);
      // A per-device session opens the lobby instead: its votes arrive one
      // person at a time, from wherever those people are, so there is no single
      // hot-seat run to start. The lobby is where anyone in the room votes.
      // Every session lands in the lobby (#655). It shows who still has to vote,
      // lets whoever is holding this device vote for any of them, and offers the
      // shareable link for everyone voting from their own phone — so there is no
      // longer a mode to choose before the draw. The drawn games stay secret: the
      // lobby renders a COUNT, never a title.
      showSessionLobby(round, data.session);
    } catch (e) {
      // Back to a still pot: the class is what selects the animation, so leaving
      // it on would sit the screen in its mid-draw state with nothing running.
      form.classList.remove('is-whirl');
      toast(e.message);
    } finally {
      // The guard covers the FLIGHT, which is what the whirl lengthened. On
      // success the lobby has already replaced this screen by the time this runs,
      // so releasing it here cannot reopen the window — and a screen that is
      // somehow still up (a caller that renders nothing) stays usable rather than
      // dead.
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
        // One progressbar per person: the bar is otherwise purely visual, and
        // "step 2 of 3" is the one thing a reader cannot infer from the card
        // (2026-09-06 audit, WCAG 1.3.1). aria-valuetext because the raw
        // value/max pair would be read as a percentage.
        return `<span class="vote-progress__seg" role="progressbar" aria-label="${esc(personLabel(p))}" aria-valuemin="0" aria-valuemax="${perPerson}" aria-valuenow="${done}" aria-valuetext="${esc(t('vote.progress', { n: done, total: perPerson }))}"><span style="width:${pct}%;background:${personColor(round, p)}"></span></span>`;
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
  // into the middle of the card.
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
      // aria-pressed carries the choice (#145): the selected face is otherwise
      // marked only by its traffic-light fill, so nothing announced which rating
      // was picked — on the app's central action. The label spells out the scale
      // too; a bare "1" gave no hint of what the number meant or how far it ran.
      const b = h(`<button class="mood${sel ? ' is-selected' : ''}"
           aria-pressed="${sel}" aria-label="${esc(t('vote.ratingLabel', { n, max: RATING_MAX }))}">
           <i class="ti ${ratingFace(n)}" aria-hidden="true"></i><span class="mood__n">${n}</span>
         </button>`);
      if (sel) {
        b.style.background = avgColor(n);
        b.style.borderColor = avgColor(n);
      }
      if (wanted && wanted.kind === 'mood' && wanted.n === n) restore = b;
      b.addEventListener('click', () => {
        votes[person.id][game.id] = { rating: n };
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
      if (!Number.isFinite((votes[person.id][game.id] || {}).rating)) {
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
  // The round's design, applied HERE and not left to the hub: a results URL is
  // shared and cold-loaded (session-share.js, showResultsById), and this screen
  // used to render that visit on the Standard design — no accent, no world,
  // and since #940 no victory scene on the spotlight a later visit is meant to
  // show. Idempotent, so the finale's path pays nothing for it.
  applyBackground(round.background);
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
  if (canShareResult()) {
    const shareBtn = h(`<button class="btn btn--ghost">${iconText('ti-share', t('share.button'))}</button>`);
    // The model is built at CLICK time, never up front: choosing a game,
    // finishing, recording winners and cancelling all mutate this closure's
    // state in place (updateChosen/renderTisch re-render only fragments), so a
    // text captured at render would share a result the user has since changed.
    shareBtn.addEventListener('click', () => shareResult({
      roundName: round.name,
      when,
      cancelled,
      playedTitle: chosenId ? (games.find((g) => g.id === chosenId) || {}).title || null : null,
      winnerNames: winnerIds.map((wid) => personLabel(people.find((p) => p.id === wid))).filter(Boolean),
      // So the shared headline says „Verloren" where the screen does, instead
      // of the bare „wurde gespielt." every winnerless night used to get (#1038).
      ending: sessionEnding(session),
      rows: rows.map((r) => ({ title: r.game.title, score: r.shown, count: r.count, place: r.place })),
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
                <span class="avatar${p.guest ? ' avatar--guest' : ''}"${p.guest ? '' : ` style="background:${memberColor(round, p.id)}"`}>${avatarFace(initials(p.name), { userId: p.userId })}</span>
                <span class="result-people__name">${esc(personLabel(p))}</span>
              </${p.guest ? 'span' : 'a'}>`
           )
           .join('')}</span>
       </div>`);
    // Each member participant opens that member's detail page.
    peopleEl.querySelectorAll('.result-people__person[data-mid]').forEach((el) => {
      makeMemberLink(el, round.id, el.dataset.mid);
    });
    screen.appendChild(peopleEl);
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
  const tisch = h('<section class="tisch" hidden></section>');
  screen.appendChild(tisch);

  // Cancel session (the alternative to choosing a game; see renderCancel).
  // Created here because updateChosen() -> renderCancel() runs below while the
  // footer that holds it is built later still; only the appendChild moves down
  // (#614). Writing into a detached node is fine — it is in the document by the
  // time anything can click it.
  const cancelWrap = h('<div class="cancel-area"></div>');

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
      // World-agnostic on purpose (#940): a world re-shapes these SAME bits in
      // CSS — fireflies, streaking stars — off the one root hook a world sets
      // (slot 7 under "Worlds" in styles.css), so nothing here knows a world
      // exists. The per-bit randomness therefore travels as custom properties:
      // the colour, because an inline `background` would beat every rule a world
      // could write; and a horizontal drift, set for every bit and simply
      // ignored by the palette's fall.
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
        return `<div class="bar-col" title="${esc(title)}">
             <div class="bar-track"><div class="bar" style="height:${Math.round((c / maxBar) * 100)}%;background:${avgColor(n)}"></div></div>
             <div class="bar-axis"><i class="ti ${ratingFace(n)}" aria-hidden="true" style="color:${avgColor(n)}"></i><span class="bar-axis__n">${n}</span></div>
           </div>`;
      })
      .join('');
    // Info if the game has been archived in the meantime (#250: either way).
    const retiredBadge = g.retired
      ? ` <span class="tag tag--retired">${iconText('ti-trash', t('result.retiredTag'))}</span>`
      : g.completed
        ? ` <span class="tag tag--completed">${iconText('ti-circle-check', t('result.completedTag'))}</span>`
        : '';
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
       rule a design or a world could write. A row nobody voted on carries 0%,
       so it is simply bare. */
    const pct = r.count ? Math.round((r.shown / RATING_MAX) * 1000) / 10 : 0;
    const fillVars = `--pct:${pct}%;${r.count ? `--sc:${scoreColor(r.score)};` : ''}`;
    // Only the reveal path gets a duration, and it is per row: every fill starts
    // together, the short ones land first and the winner's completes last.
    const raceVar = reveal && r.count ? `--dur:${(0.5 + r.shown * 0.32).toFixed(2)}s;` : '';
    const rankClass = r.place && r.place <= 3 ? ` trow__rank--${r.place}` : '';
    const row = h(`<div class="trow${reveal ? ' is-race' : ''}" style="${fillVars}${raceVar}">
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
           <div class="score-big"${r.count ? ` style="color:${scoreColor(r.score)}"` : ''}>${r.count ? fmtAvg(r.shown) : '–'}</div>
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
    } catch (e) { toast(e.message); }
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
          updateChosen();
          toast(t('result.toast.willPlay', { title: game.title }));
        } catch (e) { toast(e.message); }
      });
      actionEl.appendChild(btn);
    }
    const menuBtn = h(`<button type="button" class="btn btn--sm trow__menu" aria-label="${esc(t('result.more'))}" aria-expanded="false"><i class="ti ti-dots" aria-hidden="true"></i></button>`);
    const items = [['ti-external-link', t('result.openGame'), () => showGameDetail(round.id, gameId)]];
    // Un-choosing is how a live session changes its mind; it was the second tap
    // on „Spielen" before the chip replaced that button.
    if (isChosen && !finished && !cancelled) {
      items.push(['ti-x', t('result.clearChoice'), async () => {
        try {
          await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/choice`, { gameId: null });
          chosenId = null;
          session.chosenGameId = null;
          updateChosen();
          toast(t('result.toast.choiceCleared'));
        } catch (e) { toast(e.message); }
      }]);
    }
    items.push(['ti-trash', t('result.removeGame'), () => removeGame(game)]);
    // Buttons only, so this is a popover at every width — the account menu's
    // case, not the editors' (.claude/rules/popover-vs-sheet-editors.md §2b).
    // `aria-expanded` is synced through openPopover's onClose rather than by
    // wrapping `close`: the wrapped form misses four of the six exits.
    menuBtn.addEventListener('click', () => {
      openPopover(menuBtn, (el, close) => {
        el.classList.add('popover--menu');
        items.forEach(([icon, label, run]) => {
          const b = h(`<button class="popover__opt"><i class="ti ${icon}" aria-hidden="true"></i> ${esc(label)}</button>`);
          b.addEventListener('click', () => { close(); run(); });
          el.appendChild(b);
        });
      }, () => menuBtn.setAttribute('aria-expanded', 'false'));
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
     on „Ändern". Recording anything collapses it again. */
  let pickerOpen = false;

  // Cancel is the alternative final state: only offered while no game is
  // chosen, and undoable like the finish reset. Rendered as a `link-btn` in the
  // footer next to „Session löschen" (#614) — the rare escape hatch, not a peer
  // of the result it used to sit above.
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
        if (!await confirmDialog({
          body: t('result.cancelConfirm'), confirmLabel: t('result.cancel'), icon: 'ti-x',
        })) return;
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
    rowRefs.forEach(({ gameId, ownersEl }) => {
      // The table band states the same fact with more context, so the chosen
      // row's own line stands down rather than saying it twice on one screen.
      if (ownersEl) ownersEl.hidden = gameId === chosenId;
    });
    tisch.innerHTML = '';
    tischBar.innerHTML = '';
    tisch.hidden = !chosenId;
    tischBar.hidden = true;
    if (!chosenId) return;
    const game = games.find((g) => g.id === chosenId);
    tisch.dataset.state = finished ? 'done' : 'table';

    const imgStyle = game && game.image
      ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"`
      : '';
    const box = h(`<a class="tisch__box"${imgStyle}>${game ? coverPlaceholder(game) : ''}</a>`);
    if (game) makeGameLink(box, round.id, game.id, { redundant: true });
    if (finished) {
      /* The same stamp the game page presses (#1040) — the class, not a
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
    const title = h(`<a class="tisch__title">${esc(game ? game.title : '')}</a>`);
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

    if (!finished) {
      // Finishing comes first and needs no winners; the picker only appears
      // afterwards, so it can never read as a prerequisite (#254).
      const cta = h(`<button class="btn btn--primary tisch__cta">${iconText('ti-check', t('result.markPlayed'))}</button>`);
      cta.addEventListener('click', () => { pickerOpen = true; saveWinners([]); });
      actions.appendChild(cta);
      // Today's toggle-off path, spelled out: tapping „Spielen" again on the
      // chosen row used to be the only way back, which is invisible.
      const other = h(`<button class="link-btn">${esc(t('result.otherGame'))}</button>`);
      other.addEventListener('click', async () => {
        try {
          await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/choice`, { gameId: null });
          chosenId = null;
          session.chosenGameId = null;
          updateChosen();
          toast(t('result.toast.choiceCleared'));
        } catch (e) { toast(e.message); }
      });
      actions.appendChild(other);
      main.appendChild(actions);
      // The phone's copy of the one CTA. A second button rather than a moved
      // one: both must be live at once, because the band's own CTA is what a
      // tablet and a desktop press.
      const barBtn = h(`<button class="btn btn--primary">${iconText('ti-check', t('result.markPlayed'))}</button>`);
      barBtn.addEventListener('click', () => { pickerOpen = true; saveWinners([]); });
      tischBar.appendChild(barBtn);
      tischBar.hidden = false;
    } else if (pickerOpen) {
      main.appendChild(h(`<div class="tisch__prompt">${esc(t('result.whoWon', { game: game ? game.title : '' }))}</div>`));

      /* Guests can win too (#458) — they played the game. They just never enter
         the round-level standings; see the Pokale tab.

         One chip per PARTY (#575), so a team is recorded in a single tap. What
         is stored stays a flat list of person ids: a team win is a win for each
         of its people, which is what lets the Pokale standings, the Chronik and
         the recap keep reading `winnerIds` with no idea teams exist. */
      const chips = h('<div class="winner-chips"></div>');
      parties.forEach((party) => {
        const ids = party.people.map((pp) => pp.id);
        // A team counts as selected only when ALL of its people are in — a
        // partially-set list reads as not selected, so one tap completes it
        // rather than clearing it.
        const sel = ids.every((id) => winnerIds.includes(id));
        const chip = h(`<button class="winner-chip ${sel ? 'is-selected' : ''}" aria-pressed="${sel}">${sel ? '<i class="ti ti-trophy" aria-hidden="true"></i> ' : ''}${party.team ? '<i class="ti ti-users" aria-hidden="true"></i> ' : ''}${esc(party.name)}</button>`);
        // Each toggle persists right away — no separate save button in this
        // state — and collapses the picker to the picture it just produced.
        chip.addEventListener('click', () => {
          pickerOpen = false;
          saveWinners(sel
            ? winnerIds.filter((x) => !ids.includes(x))
            : [...winnerIds, ...ids.filter((id) => !winnerIds.includes(id))]);
        });
        chips.appendChild(chip);
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
        } catch (e) { toast(e.message); }
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
    } catch (e) { toast(e.message); }
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
  const footer = h('<div class="section result-footer"></div>');
  footer.appendChild(cancelWrap);
  // #137: deleting a played evening destroys its votes, result and winners for
  // everyone, so it is co-owner and up. Cancelling (above) stays an ordinary
  // write — it is reversible and is part of running the session.
  if (roundCan(round, 'session.delete')) {
    const delBtn = h(`<button class="link-btn" style="color:var(--danger)">${esc(t('result.deleteSession'))}</button>`);
    delBtn.addEventListener('click', async () => {
      if (!await confirmDialog({
        body: t('sessions.deleteConfirm', { when }),
        confirmLabel: t('result.deleteSession'), icon: 'ti-trash',
      })) return;
      try {
        await api('DELETE', `/api/rounds/${round.id}/sessions/${session.id}`);
        toast(t('sessions.deleted'));
        showRound(round.id);
      } catch (e) { toast(e.message); }
    });
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
