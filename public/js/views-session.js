/* Spielwirbel – views: session setup, voting (hot-seat), finale reveal, and
   results (winner spotlight + ranked rows). Part of the frontend; all files
   share one global script scope. */

// =================== Session: setup ===================

/* Size the pool so „Loswirbeln" is on screen without scrolling (#1346).

   The stylesheet's cap (`.setup-panel__body`, `100dvh - 500px`) is a CEILING
   only: what the aside column holds besides the pool — filter bar, chip line,
   title, reset link, owners note, the action bar, plus each design's own heads
   and pills — varies with the round, the filters and the design, so no one
   number holds. The page is measured instead, and the pool gives up exactly
   the rows the button is short by.

   Only ever SHRINKS, from the stylesheet's value (the inline cap is cleared
   first), so a taller window gets its rows back on the next resize. Floor: one
   whole row of tiles and a third of the next, so the pool still reads as a box
   that scrolls rather than a strip; below that the page scrolls instead.

   Skipped below 860px — Klassisch and Der Tisch render no tile panel there,
   and Ocean's shell starts so low on a phone (y≈600 at 375×812) that even the
   floor leaves the button below the fold, so shrinking would cost games and
   win nothing — and when the pool is not ABOVE the button: Ocean's desktop
   shell stands beside the bar, where shrinking it would move nothing. Window
   `resize` rather than a ResizeObserver: the Browser pane fires none, and a
   resize is the only thing besides updateHint() that moves these numbers. */
const SETUP_FIT_SLACK = 16;
function fitSetupPool(form) {
  const pool = form.querySelector('#poolGrid');
  const go = form.querySelector('#go');
  if (!pool || !go) return;
  pool.style.maxHeight = '';
  const p = pool.getBoundingClientRect();
  const b = go.getBoundingClientRect();
  if (!p.width || p.bottom > b.top || !window.matchMedia('(min-width: 860px)').matches) return;
  // Against the TOP of the document, so a resize while scrolled measures the
  // same page a fresh render does.
  const over = b.bottom + window.scrollY + SETUP_FIT_SLACK - document.documentElement.clientHeight;
  const tile = pool.querySelector('.pool-tile');
  if (over <= 0 || !tile) return;
  const cs = getComputedStyle(pool);
  const row = tile.getBoundingClientRect().height;
  const floor = Math.ceil((parseFloat(cs.paddingTop) || 0) + row + 0.3 * (row + (parseFloat(cs.rowGap) || 0)));
  pool.style.maxHeight = Math.max(floor, Math.floor(p.height - over)) + 'px';
}

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
  // Arriving, as opposed to re-rendering itself (a language switch through
  // currentView): only an arrival plays Das Programmheft's opening (#1382) and
  // Forest's whirl of leaves (#1476).
  const arriving = !app.querySelector('.setup-grid');
  app.innerHTML = '';
  const head = h(`<div class="page-head"><h1>${esc(t('startSession.title'))}</h1></div>`);
  app.appendChild(head);
  // Der Tisch composes this screen as two panels with the rail kept (#1267);
  // Klassisch is the default path below and never branches.
  const tisch = designIs('tisch');
  // Ocean (#1213) re-composes the same form into three columns — seats, the
  // Muschel, the count and „Abtauchen" (views-session-ocean.js).
  const ocean = oceanWorn();
  // Die Brücke (#1240) re-composes it into seats, the Pool and the Sonden with
  // „Zündung" (views-session-bruecke.js).
  const bruecke = designIs('bruecke');
  // Das Programmheft (#1374) re-composes it into the seats as a checklist, „Der
  // Topf" with its numeral and the games by name, and the black box at the foot
  // (views-session-programmheft.js).
  const ph = designIs('programmheft');
  // Forest (#1468) re-composes it into seats, the tree stump and the count card
  // with „Laub wirbeln" (views-session-forest.js).
  const forest = forestWorn();
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
              <button type="button" class="stepper__btn" data-d="-1" aria-label="${esc(t('startSession.countDown'))}"><i class="ti ti-minus" aria-hidden="true"></i></button>
              <input id="count" class="stepper__val" inputmode="numeric" value="3" />
              <button type="button" class="stepper__btn" data-d="1" aria-label="${esc(t('startSession.countUp'))}"><i class="ti ti-plus" aria-hidden="true"></i></button>
            </div>
          </div>
          <p class="setup-bar__summary" id="barSummary"></p>
          <button id="go" class="btn btn--primary btn--lg"><i class="ti ti-tornado" aria-hidden="true"></i> ${esc(t('startSession.draw'))}</button>
        </div>
      </div>
    </div>`);
  app.appendChild(form);
  if (tisch) composeTischSetup(round, head, form);
  if (ocean) composeOceanSetup(form);
  if (bruecke) composeBrueckeSetup(head, form);
  if (ph) composeProgrammheftSetup(round, head, form, arriving);
  if (forest) composeForestSetup(form, arriving);

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
  // SEATS, the live twin of `sessionSeatCount` over the stored session (#1610):
  // a team sharing one hand counts once, an own-seat team its headcount. The
  // server counts the blob it is about to store the same way, and the preview
  // must promise the pool the draw will produce (.claude/rules/session-teams.md §2).
  const playerCount = () =>
    joining.size + guests.length - teamPicker.sharedTeamedPeopleCount() + teamPicker.sharedTeamCount();
  // Multi-table mode (#796). Preset from the same #252 blob as everything else on
  // this screen; the checkbox below is bound to it and the pool reads it live.
  const tableState = { multiTable: !!(preset && preset.multiTable) };
  // A preset can arrive with BOTH remembered (#252), and `normalizeMetadataFilters`
  // above cannot drop it: it prunes against the SHELF's options, and whether this
  // evening has one table is a property of the screen. Without this the restored
  // session shows a chip for a filter with no control and no effect — see the gate
  // in `mountFilterPanel` for why the toggle does not exist in this mode.
  if (tableState.multiTable) metaFilters.onlyRecommended = false;

  /* The screen's ONE context (#1543). The pot preview, the tag section and the
     „ohne Spiele" chips live in views-session-setup-pool.js rather than as
     closures over this function, and each takes this object. Everything in it
     but `filterPanel` is a const binding: the Maps, Sets and objects are the
     screen's live state and are mutated IN PLACE by the controls, so a function
     that destructured them still sees every change.

     `filterPanel` is the exception — rebuilt by mountFilterPanel() below, so it
     is read through `setup` everywhere. It cannot be built until the tag section
     exists, and the preview reads it only from listeners, which run long after
     this function has finished. */
  const setup = {
    round, form, activeGames, selectedTags, tagFilterState, tableState, metaFilters,
    joining, awayShelves, guests, playerCount, shelfSeats,
    tisch, ocean, bruecke, ph, forest,
    filterPanel: null,
  };

  // The live pool preview (#634): what the draw would pick from, in the two
  // presentations described above, refreshed by every control on this screen.
  const preview = setupPoolPreview(setup);
  const pool = preview.pool;
  const updateHint = preview.update;
  // A tag chip changes the applied-filter chips the BAR renders, so it has to be
  // told. The metadata controls route through the panel's own onChange and
  // resync themselves, which is why only the tag half calls this.
  const syncFilterBar = () => { if (setup.filterPanel) setup.filterPanel.sync(); };

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
  }, guestList, { stateLines: tisch || ocean || bruecke || ph || forest });
  seatTable.setAttribute('role', 'group');
  seatTable.setAttribute('aria-labelledby', 'seatsLabel');
  const multiTableNote = form.querySelector('#multiTableNote');
  /* „Wer hat seine Spiele nicht dabei?" (#1002) — see buildSetupShelfField. Its
     `field` is null on an unmarked shelf, which is what decides whether the chip
     is offered; `refresh` is then a no-op. */
  const shelf = buildSetupShelfField(setup, () => {
    addons.relabelAddons();
    updateHint();
  });
  const refreshShelfChips = shelf.refresh;
  const shelfField = shelf.field;
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

  // Custom-tag chips (#238, tri-state #241) — the tag half of the filter panel,
  // or null on a round with no tags (buildSetupTagSection).
  const tagSection = buildSetupTagSection(setup, updateHint, syncFilterBar);


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
  // „Filter speichern" (#1328), placed beside the trigger since #1346. A rebuild
  // below replaces the trigger, so the button is re-placed after every one.
  // `.fbar` is `display: contents` here, so the trigger's next sibling is the
  // next flex item of the bar — and the chip line, which takes a line of its
  // own, follows the button rather than splitting it from the trigger. With
  // nothing to filter by, the button stands where the mount does. The reason
  // line always ends the bar, on a line of its own after the chips.
  let saveAction = null;
  const placeSave = () => {
    if (!saveAction) return;
    const trigger = setup.filterPanel && setup.filterPanel.el.querySelector('.fbar__trigger');
    if (trigger) trigger.after(saveAction.btn); else filterMount.after(saveAction.btn);
    filterMount.parentElement.appendChild(saveAction.reason);
  };
  const mountFilterPanel = () => {
    // NEVER rebuild under an open overlay. The trigger is the node `place()` and
    // `openPopover`'s outside-click guard both hold as the anchor, so replacing
    // it would strand the popover mid-adjustment. Skipping loses nothing: the
    // overlay body is built fresh on every open from `activeGames`, which the
    // backfill fills IN PLACE — so the metadata that just landed is there the
    // next time the user opens it, with nothing to invalidate.
    if (setup.filterPanel && setup.filterPanel.isOpen()) return;
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
    setup.filterPanel = renderFilterPanel(activeGames, metaFilters, () => updateHint(), tagSection,
      { tableSized: !tableState.multiTable, partyCount: playerCount });
    filterMount.replaceChildren();
    if (setup.filterPanel) filterMount.appendChild(setup.filterPanel.el);
    filterMount.hidden = !setup.filterPanel;
    placeSave();
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
      // Der Tisch's summary states the drawn number (T2.3), so it follows it —
      // and so does Ocean's, with its count bubbles, and Forest's, with its leaves.
      if (tisch || ocean || bruecke || forest) updateHint();
    });
  });
  // …and it was first written before the remembered count was loaded above.
  if (tisch || ocean || bruecke || forest) {
    countInput.addEventListener('input', updateHint);
    updateHint();
  }

  /* What „Filter speichern" saves: what the screen shows NOW, in the draw's own
     body shape, so the server resolves both through one function
     (lib/draw-filters.js). Seats travel; guests, teams and „ohne Spiele"
     deliberately do not — they are this evening's facts, not the group's
     recurring draw. Placed by placeSave() above. */
  saveAction = renderSaveFilterAction(round, () => {
    const cur = parseInt(countInput.value, 10);
    return {
      count: Number.isFinite(cur) && cur >= 1 ? cur : 1,
      tagIds: [...selectedTags].filter(([, s]) => s === 'include').map(([id]) => id),
      excludeTagIds: [...selectedTags].filter(([, s]) => s === 'exclude').map(([id]) => id),
      tagMode: tagFilterState.tagMode,
      metadata: metaFilters,
      multiTable: tableState.multiTable,
      memberIds: [...joining],
    };
  });
  placeSave();
  fitSetupPool(form);
  const onResize = () => {
    if (!form.isConnected) return window.removeEventListener('resize', onResize);
    fitSetupPool(form);
  };
  window.addEventListener('resize', onResize);

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
    // Ocean's O10.1 „Abtauchen" (#1221): the Muschel opens once on the same
    // press, under the same rule — views-session-ocean.js.
    if (ocean) oceanDive(form);
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
      showSessionLobby(round, data.session, false, tisch || ocean);
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
  //
  // Each person's column ends on a REVIEW step (#1434): the last card's beat
  // delivers it instead of submitting, so the voter can adjust a rating with
  // every candidate seen. It sits before the next person's handover, so a voter
  // reviews before the device is passed on — and on the last person, before
  // finish(). It is a real step with its own history entry, which is what makes
  // a Back from it land on the last card rather than out of the flow.
  const order = shuffled(people);
  const steps = [];
  order.forEach((p) => {
    if (!opts.skipIntro) steps.push({ type: 'intro', person: p });
    games.forEach((g) => steps.push({ type: 'vote', person: p, game: g }));
    steps.push({ type: 'review', person: p });
  });
  const reviewIdx = (person) => steps.findIndex((s) => s.type === 'review' && s.person === person);
  // People whose review has been on screen. From then on a rating tap returns to
  // the review rather than walking through every later card again — the review
  // is where they were, and "change one, see the list again" is the point.
  const reviewed = new Set();
  // True only on a card reached by a row tap on the review, until anything else
  // navigates. Then the entry BELOW this one is that review, so the re-rate goes
  // back to it with history.back() instead of pushing a second review entry —
  // which keeps a Back from the review landing on the last card, as it does
  // without a jump. Cleared by every other movement (onPopstate, go()), so it can
  // never send a history.back() to an entry that is not the review.
  let jumpedFromReview = false;

  let idx = 0;
  // True once finish() has POSTed. Until then everything the user has entered
  // exists only in this closure, which is what every guard below protects (#329).
  //
  // #655 shrank the blast radius rather than removing the need: what is at risk
  // is now ONE person's cards, not the whole table's evening, because the lobby
  // saves each column as it is given. The guards stay — losing four ratings to a
  // stray Back is still worth a confirm.
  let saved = false;
  // One POST per run (#1168). Since #1434 finish() is reached from the review
  // step's „Absenden", and a second press while the save is still awaiting
  // would write the column twice — the tap lock has long expired by then, so
  // this flag is the only guard on that window. The catch below resets it — a
  // failed save has to stay retryable, and the review is still on screen to
  // retry from.
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
  function go(next, fromReview = false) {
    jumpedFromReview = fromReview;
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
    jumpedFromReview = false;
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
  // A person's column in `steps` also holds their review, which fills the bar
  // rather than counting as a step of it (#1434).
  const stepsPerPerson = perPerson + 1;
  function progressBar() {
    return `<div class="vote-progress">${order
      .map((p, pi) => {
        const done = Math.max(0, Math.min(perPerson, idx - pi * stepsPerPerson));
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

  // The card as Klassisch draws it: progress, who, cover, title, question, and
  // the faces with their words. The two-ended „gar nicht … unbedingt" row went
  // when every face started carrying its own word (#1530).
  function klassischCard(person, game, color) {
    const imgStyle = game.image ? `style="background-image:url('${coverUrl(game.image, COVER_HERO)}')"` : '';
    return h(`<div class="vote vote--split">
        ${progressBar()}
        <div class="vote__who"><button class="vote__undo" id="backBtn" type="button" aria-label="${esc(t('vote.back'))}" title="${esc(t('vote.back'))}"><i class="ti ti-arrow-back-up" aria-hidden="true"></i></button>${esc(t('vote.who'))} <strong style="color:${personNameInk(color)}">${esc(personLabel(person))}</strong></div>
        <div class="vote__img${isThumbCover(game.image) ? ' cover--thumb' : ''}" ${imgStyle}>${coverPlaceholder(game)}</div>
        <h1 class="vote__title" tabindex="-1">${esc(game.title)}</h1>
        <div class="vote__secret"><i class="ti ti-eye-off" aria-hidden="true"></i> ${esc(t('vote.handoverSub'))}</div>
        <div class="vote__q" id="voteQ">${esc(t('vote.question'))}</div>
        <div class="rating" role="group" aria-labelledby="voteQ"></div>
      </div>`);
  }

  // Der Tisch's composition (#1268, T2.4/T4.2): header on the felt, the card,
  // the hand-off line — built in vote-card-composed.js, fed from this closure.
  // Ocean (#1213, O2.3/O4.2) takes the same composition — header, card, faces
  // with their words — and adds its two desktop side columns around the card.
  function composedCard(person, game) {
    const turn = voteTurn(round, session, order, person);
    const n = games.indexOf(game) + 1;
    const card = composedVoteCard({
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
    if (oceanWorn()) {
      // DOM order is the 1440 reading order: who has rated, the card, what is
      // still below. Both columns are hidden below the desktop breakpoint.
      const sides = oceanVoteSides(round, sessionPeople(round, session), person,
        session.votedIds, games.length - n);
      card.classList.add('vote--ocean');
      card.querySelector('.vote__card').before(sides.raters);
      if (sides.deep) card.querySelector('.vote__card').after(sides.deep);
    }
    if (designIs('bruecke')) {
      // Die Brücke (#1240, B2.4/B4.2): „Wer hat schon gewertet" under the card
      // on a phone, left of it at 1440; „Verdeckt" right of it at 1440 only.
      // DOM order is the phone's reading order; bruecke.css places the columns
      // by grid area. Neither holds a control, so focus order is unaffected.
      const sides = brueckeVoteSides(round, sessionPeople(round, session), person,
        session.votedIds, games.length - n);
      card.classList.add('vote--bruecke');
      card.querySelector('.vote__card').after(sides.raters);
      if (sides.sealed) sides.raters.after(sides.sealed);
    }
    // Das Programmheft (#1374, P2.3/P4.2): „Zurück" as a word, the scale ends.
    if (designIs('programmheft')) composeProgrammheftVoteCard(card);
    if (forestWorn()) {
      // Forest (#1468, F2.3/F4.2): who has rated left of the card (1440 only),
      // the cards still to come face down on the dusk right of it — under the
      // faces on a phone. DOM order is the 1440 reading order.
      const sides = forestVoteSides(round, sessionPeople(round, session), person,
        session.votedIds, games.length - n);
      composeForestVoteCard(card);
      card.querySelector('.vote__card').before(sides.raters);
      if (sides.hidden) card.querySelector('.vote__card').after(sides.hidden);
    }
    return card;
  }

  /* The review step (#1434) — vote-review.js builds it in the card's own frame.
     Every handler asks `advance.locked` first: the review arrives on the last
     card's beat, and under reduced motion the #1168 tap lock outlives that beat,
     so the second tap of a double-tap on the last face can land HERE — on
     „Absenden" in the worst case. */
  function renderReview(person, wanted) {
    reviewed.add(person.id);
    const composed = voteCardComposed();
    const turn = composed ? voteTurn(round, session, order, person) : null;
    const last = idx === steps.length - 1;
    app.innerHTML = '';
    const card = voteReviewCard({
      composed,
      person,
      who: { label: t('vote.who'), color: personColor(round, person) },
      roundName: round.name,
      handoff: composed ? voteHandoffLine(turn, !opts.skipIntro) : '',
      games,
      ratingOf: (g) => (votes[person.id][g.id] || {}).rating,
      onJump: (i) => {
        if (advance.locked) return;
        refocus = { kind: 'title' };
        go(steps.findIndex((s) => s.type === 'vote' && s.person === person && s.game === games[i]), true);
      },
      // The last person's review submits; any earlier one hands on to the next
      // person's handover (the pre-#655 multi-person run) without saving —
      // finish() writes the whole table at the end, as it always did.
      onSend: () => {
        if (advance.locked) return;
        if (last) return finish();
        go(idx + 1);
      },
      onBack: () => {
        if (advance.locked) return;
        history.back();
      },
    });
    if (!composed) card.querySelector('.vote__who').before(h(progressBar()));
    // The same header as the cards it reviews (#1374): „Zurück" as a word.
    if (designIs('programmheft')) composeProgrammheftVoteCard(card);
    if (forestWorn()) composeForestVoteCard(card);
    app.appendChild(card);
    // Arriving by the beat or a re-rate puts focus on the heading; a Back or a
    // language switch leaves it where it was, as on the cards.
    if (wanted && wanted.kind === 'title') card.querySelector('.vote-review__title').focus();
  }

  function render() {
    const step = steps[idx];
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
    // Ocean's blind is full-screen like its card (#1214), and so are Die
    // Brücke's and Das Programmheft's at both widths (#1241, #1375) — a blind
    // the previous person could navigate away from would defeat itself.
    // Klassisch keeps the top bar over its handover card. The review (#1434)
    // is part of the rating run, so it is full-screen too.
    const bruecke = designIs('bruecke');
    const ph = designIs('programmheft');
    // Forest's dusk blind too (#1469, F4.6/F6.6: „ohne Kopf und Dock").
    const forest = forestWorn();
    voteScreen(step.type !== 'intro' || oceanWorn() || bruecke || ph || forest);

    // Handover screen: full color card in the person's color — or, under
    // Ocean, the deep-water blind (views-session-ocean.js), and under Die
    // Brücke the night blind (views-session-bruecke.js), and under Das
    // Programmheft the paper blind between two bands
    // (views-session-programmheft.js), and under Forest the dusk with its
    // fireflies (views-session-forest.js).
    if (step.type === 'intro') {
      const color = personColor(round, step.person);
      app.innerHTML = '';
      const card = oceanWorn() ? oceanBlind(round, session, step.person, idx > 0)
        : bruecke ? brueckeBlind(round, step.person, idx > 0)
        : forest ? forestBlind(round, step.person, idx > 0)
        : ph ? programmheftBlind(round, step.person, idx > 0, order.indexOf(step.person) + 1, order.length) : h(`<div class="handover" style="background:${color}">
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

    if (step.type === 'review') return renderReview(step.person, wanted);

    const { person, game } = step;
    const current = votes[person.id][game.id] || { rating: null };
    const color = personColor(round, person);

    app.innerHTML = '';
    const card = voteCardComposed()
      ? composedCard(person, game) : klassischCard(person, game, color);
    /* Der Tisch's third motion ritual (#1200, T10.3): a card the BEAT delivered
       tips in about its middle axis — the hand-over, and the turn itself is the
       privacy screen. `wanted.kind === 'title'` is exactly "the advance brought
       this card", so arriving by Back, a language switch or the first card never
       tips. The motion is tisch.css's; nothing here waits for it. */
    if (designIs('tisch') && wanted && wanted.kind === 'title') card.classList.add('is-tipped');
    // Die Brücke's B10.3 (#1248) under the same gate: the card drives in from
    // below (bruecke.css).
    if (designIs('bruecke') && wanted && wanted.kind === 'title') card.classList.add('is-incoming');

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
      // aria-pressed + the face's word as its name (#145, #1530) — one builder
      // for both cards (vote-card-composed.js).
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
          refocus = { kind: 'title' };
          // A card the review sent the voter to goes back to it (see
          // jumpedFromReview); any other card after the review was seen
          // returns there too, with a fresh entry. Otherwise one step on —
          // which from the last card IS the review (#1434), never finish().
          if (jumpedFromReview) return history.back();
          go(reviewed.has(person.id) ? reviewIdx(person) : idx + 1);
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
  // Forest's reveal verb over the stage's title (#1468, F9.5).
  if (forestWorn()) stage.querySelector('.stage__title').before(forestFinaleKicker());
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
     markup lives in result-tafel-composed.js; every branch below is on this one
     flag, and Klassisch is the path it leaves alone. Ocean (#1213, O2.4/O4.4)
     shares the composition and arranges it in columns at the end
     (composeOceanResult, views-session-ocean.js). */
  const oceanLook = oceanWorn();
  // Die Brücke (#1240, B2.5/B4.3) takes the same composition and arranges it in
  // two panels at the end (composeBrueckeResult, views-session-bruecke.js).
  const brueckeLook = designIs('bruecke');
  // Das Programmheft (#1374, P2.4/P4.3) takes it too, as Der Tisch lays it out
  // — the band and its foot in the column beside the Tafel — and prints the
  // report's kicker over the headline and every step's count in the Tafel.
  const phLook = designIs('programmheft');
  // Forest (#1468, F2.4/F4.3) takes it too and arranges it in two columns at
  // the end (#1568) — the people, the sentence over the grown tree, the fact
  // line and the foot beside the Tafel (composeForestResult).
  const forestLook = forestWorn();
  const tischLook = designIs('tisch') || oceanLook || brueckeLook || phLook || forestLook;

  // Tally per game: ranked rows with tie-aware places (views-session-result-tafel.js).
  const rows = tallyResultRows(games, people, session);

  /* The screen's ONE context (#1543). The Tafel, the table band and the session
     controls live in their own files (views-session-result-tafel.js, -band.js,
     -actions.js) rather than as closures over this function, and every one of
     them takes this object. Three kinds of field, decided once here:

       inputs — what this render was handed, and what it derived from it;
       phase  — the evening's state. The controls CHANGE it after render, so it
                is read and written through `rs` everywhere and never copied;
       nodes  — the screen's DOM, assigned below as it is built and complete
                before the first resultUpdateChosen(rs) at the end.

     The phase starts from the session object exactly as the closures it
     replaces did; nothing above that point writes to the session. */
  const rs = {
    round, session, games, people, parties, rows, hasVotes, reveal,
    oceanLook, brueckeLook, phLook, forestLook, tischLook,
    chosenId: session.chosenGameId || null,
    finished: !!session.finished,
    cancelled: !!session.cancelled,
    winnerIds: Array.isArray(session.winnerIds) ? session.winnerIds.slice() : [],
    // How it ended when nobody won (#1038). Null unless the session carries one —
    // and mutually exclusive with `winnerIds` by the route's own rule, so these
    // two never both hold a value.
    ending: ENDINGS.includes(session.ending) ? session.ending : null,
    /* The band's one-shot unroll (#1058). Set by the CLICK that causes the
       moment and consumed by the next `resultRenderBand`, so a re-render from a
       chip toggle, a cold load, a Chronik visit or a shared link replays
       nothing. Its sibling flag gated the stamp's press, which #1122 removed. */
    freshChoice: false,
    /* Der Tisch's fifth motion ritual (#1200, T10.5): true for the one render
       that follows a finish the reader just recorded — the transition into
       `finished`, never a winner change on an already-finished session, never a
       cold load of one. resultRenderBand() consumes it, exactly like
       freshChoice. */
    freshStamp: false,
    /* Is the winner picker showing? False on load, so an archived session opens
       on the PICTURE (seats or the ending line) rather than on a 344px picker
       for a question answered months ago. It turns true for exactly two
       moments: right after „Als gespielt markieren", when the one question left
       is who won, and on „Ändern". A party tap keeps it open (#1327) — several
       people often won — while an ending (single-choice) or „Fertig" collapses
       it again. */
    // …except for an evening just LOGGED after the fact (#1616), whose one open
    // question is who won: the direct-play sheet asks for it, once.
    pickerOpen: takeResultPickerOpen(session.id),
    /* Which party chip to hand keyboard focus back to after the re-render a tap
       causes (#1327): resultRenderBand() rebuilds the chips, so the tapped
       button is detached and focus would fall to <body> — a full Tab back into
       the picker for every further winner. Same shape as the rating step's
       `refocus`: set only by the party chip handler, consumed (and cleared) by
       the next resultRenderBand(), and never set when the picker closes, so
       arriving on the picture never yanks focus. */
    pickerRefocus: null,
    // After a removal (#1538) or a removed game: the whole screen again from
    // the server's view, so the tally, teams, winners and spotlight follow
    // from the new set. The extracted files re-render through this and never
    // name showResults.
    reopen: (fresh, s) => showResults(fresh, s, games),
  };

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
  // The programme's kicker states the date and the counts, so it replaces the
  // subtitle rather than repeating it — over the headline, where P4.3 prints it.
  if (phLook) {
    head.querySelector('.muted').remove();
    head.firstElementChild.prepend(programmheftReportKicker(round, session, games, people));
    // P10.4 (#1382): the reveal prints the headline, then the Tafel row by row
    // (`--print-i` below). Only the reveal — never a cold load or a Chronik visit.
    if (reveal) head.setAttribute('data-print', '');
  }
  // Forest's kicker replaces the subtitle the same way (F2.4, F4.3): it carries
  // the date, and the Tafel's title the count. The fact line under the scene is
  // painted by resultUpdateTitle(), which every phase change reaches.
  const forestFacts = forestLook ? h('<p class="forest-result__facts" hidden></p>') : null;
  if (forestLook) {
    head.querySelector('.muted').remove();
    head.firstElementChild.prepend(forestResultKicker(session));
  }
  // Die Brücke's B10.4 „Entschlüsseln" (#1248): the reveal decrypts the
  // headline, then the Tafel drives in row by row (`--print-i` below). Only the
  // reveal — never a cold load or a Chronik visit.
  if (brueckeLook && reveal) head.setAttribute('data-decrypt', '');

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
  // state in place (resultUpdateChosen/resultRenderBand re-render only fragments), so a
  // text captured at render would share a result the user has since changed.
  const shareNow = !canShareResult() ? null : () => shareResult({
    roundName: round.name,
    when,
    // The DATE alone, for a card that must not print the time of day (Ocean,
    // O8.3 — „keine Uhrzeit"). `when` keeps the time for the text share.
    day: fmtDate(session.createdAt),
    cancelled: rs.cancelled,
    playedTitle: rs.chosenId ? (games.find((g) => g.id === rs.chosenId) || {}).title || null : null,
    winnerNames: rs.winnerIds.map((wid) => personLabel(people.find((p) => p.id === wid))).filter(Boolean),
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
      winner: rs.winnerIds.includes(p.id),
    })),
    // Das Programmheft's card adds the long date, the session's number and the
    // winner's streak (#1381) — nothing another design's share reads.
    ...(designIs('programmheft') ? programmheftEdition(round, session, rs.winnerIds) : {}),
    // Forest's card (#1475) adds the long date and the fact line exactly as
    // this screen shows it, read off the node paintForestFacts keeps current.
    ...(forestLook ? forestCardEdition(session, forestFacts) : {}),
  });
  // Der Tisch carries „Teilen" in the foot instead, beside the next evening
  // (T2.5, T4.4 — see fillComposedResultFoot).
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
    // paintComposedCrowns to find it by; Klassisch's markup is byte-for-byte as it was.
    peopleEl = h(`<div class="result-people">
         <span class="result-people__label">${esc(t('result.participants'))}</span>
         <span class="result-people__list">${people
           .map(
             (p) => `<${p.guest ? 'span' : 'a'} class="result-people__person"${p.guest ? '' : ` data-mid="${esc(p.id)}"`}${tischLook ? ` data-pid="${esc(p.id)}"` : ''}>
                ${tischLook ? composedPersonCrown() : ''}<span class="avatar${p.guest ? ' avatar--guest' : ''}"${p.guest ? '' : ` style="background:${memberColor(round, p.id)}"`}>${avatarFace(initials(p.name), { userId: p.userId })}</span>
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

  // The evening's points (#1630), best first, with the „neuer Rekord" marks —
  // after who was here and who played together, since the points belong to
  // those same seats. Absent until someone enters them.
  const pointsEl = session.finished ? renderSessionPoints(round, session) : null;
  if (pointsEl) screen.appendChild(pointsEl);

  /* Der Tisch (#1057) — the chosen game, as a band above the Tafel, and the
     only place the evening's own controls live.

     It exists ONLY while a game is chosen. Before that nothing may take room:
     the deep-dive's empty „Auf dem Tisch" slot was rejected on 2026-09-12 for
     exactly that. What it replaces is the in-row `.row-finish` panel, which sat
     1000+px down a 2905px page on the evening it was needed, and then stayed
     there at full size afterwards — a 344px winner picker on a session finished
     months ago.

     The `.chosen-banner` is gone with it: `resultUpdateTitle` already states the
     outcome in the h1 („„X" wurde gespielt."), and the cancelled case has its
     own title too. `views-session-tables.js` still renders that class on the
     split screen, so the CSS stays. */
  /* Abzeichen (#1388): the marks this session just earned, after the winner
     headline and before the table. Always in the DOM, hidden while empty, and
     refilled by resultRenderBand() on every phase change — a winner tap can earn or
     un-earn one (views-badges.js, fillBadgeMoment). Never a modal: the table
     and „Fertig" below stay operable from the first paint. */
  const badgeMoment = h('<section class="badge-moment" hidden></section>');
  screen.appendChild(badgeMoment);
  const tischSlot = h('<div class="tisch-slot"></div>');
  const tisch = h('<section class="tisch" hidden></section>');
  tischSlot.appendChild(tisch);
  screen.appendChild(tischSlot);

  // Cancel session (the alternative to choosing a game; see resultRenderCancel).
  // Created here because resultUpdateChosen() -> resultRenderCancel() runs below while the
  // footer that holds it is built later still; only the appendChild moves down
  // (#614). Writing into a detached node is fine — it is in the document by the
  // time anything can click it.
  const cancelWrap = h('<div class="cancel-area"></div>');
  // „Datum ändern" (#1616), Klassisch's footer only — the composed designs carry
  // it behind „Mehr" (resultRenderFoot). Refilled with the cancel area, since
  // the session can become finished after render.
  const dateWrap = h('<div class="date-area"></div>');
  // Der Tisch's foot takes the place of that footer row (#1275); built here for
  // the same reason, and filled by resultRenderFoot.
  const tischFoot = tischLook ? h('<div class="result-foot" hidden></div>') : null;

  // The ranked rows (#1056) and their gold top group, appended to the screen.
  Object.assign(rs, { screen, titleEl, forestFacts, peopleEl, shareNow, when,
    badgeMoment, tischSlot, tisch, cancelWrap, dateWrap, tischFoot });
  buildResultTafel(rs);

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
  rs.tischBar = tischBar;
  // One call for whatever the loop placed — and none to bind when no row had
  // votes. `wireInfoButtons` is idempotent, so the re-renders below (retire,
  // remove) cannot stack a second listener.
  screen.appendChild(tischBar);
  wireInfoButtons(app);

  resultUpdateChosen(rs);

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
  // behind „Mehr" (resultRenderFoot) — still the last block on the screen, except
  // under Ocean and Forest, whose composers move it into the side column ahead
  // of the Tafel (#1430, #1568): there the destructive pair is one more tap
  // away behind „Mehr", and „Noch eine Session" is what the screen is for next.
  if (tischFoot) {
    // Der Tisch's own foot sits under the box, inside its slot (#1430): the
    // slot is ONE grid item, so the foot travels with the pinned box beside the
    // Tafel instead of opening a row the Tafel spans, and on a phone the actions
    // follow the box ahead of the ranking — Ocean's order. Ocean and Die Brücke
    // compose their own sides from a foot that is a child of the screen.
    if (oceanLook || brueckeLook || forestLook) screen.appendChild(tischFoot);
    else tischSlot.appendChild(tischFoot);
    if (oceanLook) composeOceanResult(screen, head, peopleEl);
    if (forestLook) composeForestResult(screen, head, peopleEl, forestFacts);
    if (brueckeLook) composeBrueckeResult(screen);
    return;
  }
  const footer = h('<div class="section result-footer"></div>');
  // Taking someone out (#1538) — a correction, so first and before the two
  // ways to throw the session away.
  const removeEntry = removePersonEntry(round, session, rs.reopen);
  if (removeEntry) footer.appendChild(removeEntry);
  footer.appendChild(dateWrap);
  footer.appendChild(cancelWrap);
  // #137: deleting a played evening destroys its votes, result and winners for
  // everyone, so it is co-owner and up. Cancelling (above) stays an ordinary
  // write — it is reversible and is part of running the session.
  if (roundCan(round, 'session.delete')) {
    const delBtn = h(`<button class="link-btn" style="color:var(--danger)">${esc(t('result.deleteSession'))}</button>`);
    delBtn.addEventListener('click', () => resultDeleteSession(rs));
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
