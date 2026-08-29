/* Spielwirbel – views: the Regal tab, the round's games library — search, the
   tri-state tag filter chips, sort, the lazy cover grid, and the header control
   that opens the four off-shelf screens. Rendered by showRound()
   (views-round.js).
   Part of the frontend; all files share one global script scope. */

// --- Regal tab: the games library — search, filter chips, cover grid.
function renderRegalTab(round, activeGames) {
  const rid = round.id;

  // Filters (and sort) persist for the session but are scoped to one round —
  // opening a different round's Regal resets them to defaults.
  if (regalFiltersRid !== round.id) {
    regalFilters = { tags: new Map(), query: '', tagMode: 'all' };
    gamesSort = 'avg';
    regalFiltersRid = round.id;
  }
  // The metadata filters (#725) are re-normalized against the CURRENT shelf on
  // every render, which does two jobs in one line: it mints the canonical shape
  // for a freshly reset round, and it drops a category whose last game has since
  // been archived — the counterpart of the deleted-tag pruning below, and what
  // stops a filter surviving as an active count over a chip nobody can see.
  regalFilters.metadata = normalizeMetadataFilters(regalFilters.metadata, metadataFilterOptions(activeGames));

  // Stats per active game (for the rating pills and sorting).
  const statsByGame = {};
  activeGames.forEach((g) => (statsByGame[g.id] = gameStats(round, g.id)));

  const gamesSec = h('<div class="section"></div>');
  // h1, not h3: on the Regal/Chronik/Pokale tabs this is the top-level heading of
  // the view — only the Start tab renders the round-name hero (#145). The
  // section-label look is unchanged; `.section-head :is(h1,h2,h3)` styles it.
  const gamesHead = h(`<div class="section-head"><h1>${esc(t('games.title', { n: activeGames.length }))}</h1><div class="section-tools"></div></div>`);
  const gamesTools = gamesHead.querySelector('.section-tools');
  gamesSec.appendChild(gamesHead);

  const grid = h('<div class="cards"></div>');

  // The dashed "add a game" tile always closes the grid.
  const addTile = h(`<button class="add-tile">
       <i class="ti ti-plus" aria-hidden="true"></i>
       <span>${esc(t('round.addGame'))}</span>
     </button>`);
  addTile.addEventListener('click', () => showAddGame(round));

  // Bulk-import a linked BoardGameGeek collection (#481). Filling a shelf one
  // game at a time is the most tedious part of setting a round up, so the entry
  // point is offered where that tedium is felt: as a tile beside "add a game"
  // while the Regal is empty, and as a persistent header action once it isn't.
  const importTile = h(`<button class="add-tile">
       <i class="ti ti-download" aria-hidden="true"></i>
       <span>${esc(t('bggImport.tile'))}</span>
     </button>`);
  importTile.addEventListener('click', () => showBggImport(round));

  if (activeGames.length === 0) {
    gamesSec.appendChild(h(`<div class="empty"><p>${esc(t('games.empty'))}</p></div>`));
    grid.appendChild(addTile);
    if (canImportBgg()) grid.appendChild(importTile);
    gamesSec.appendChild(grid);
  } else {
    if (canImportBgg()) {
      // Two spellings of one label, switched by width in CSS (#621) — the full
      // wording is ~269px, most of a 320px phone's content column. Both strings
      // already exist for the empty-Regal tile, so this needs no new i18n key.
      const importBtn = h(`<button class="link-btn"><i class="ti ti-download" aria-hidden="true"></i> <span class="tools-label tools-label--long">${esc(t('bggImport.link'))}</span><span class="tools-label tools-label--short">${esc(t('bggImport.tile'))}</span></button>`);
      importBtn.addEventListener('click', () => showBggImport(round));
      gamesTools.appendChild(importBtn);
    }
    // Average per game (from the already computed stats) for pill and sorting.
    const avgMap = {};
    activeGames.forEach((g) => (avgMap[g.id] = statsByGame[g.id].avg));

    // Search pill + sort next to the heading. Sort, search and filter chips are
    // all kept for the session (scoped to this round) — see regalFilters.
    const search = h(`<label class="search-pill"><i class="ti ti-search" aria-hidden="true"></i><input type="search" placeholder="${esc(t('games.search'))}" aria-label="${esc(t('games.search'))}" /></label>`);
    const searchInput = search.querySelector('input');
    searchInput.value = regalFilters.query;
    const sortSel = h(`<select class="sort-select" aria-label="${esc(t('games.sortLabel'))}">
        <option value="random">${esc(t('games.sort.random'))}</option>
        <option value="name">${esc(t('games.sort.name'))}</option>
        <option value="avg">${esc(t('games.sort.rating'))}</option>
      </select>`);
    sortSel.value = gamesSort;
    gamesTools.appendChild(search);
    gamesTools.appendChild(sortSel);

    // --- Selection mode (#832): tidy the shelf in bulk.
    //
    // It lives IN the grid rather than in a picker sheet on purpose. A shelf can
    // be filled in one action (the BGG collection import, #481) but was emptied
    // one game and two steps at a time, so undoing a 200-game import ran to some
    // 400 interactions — which is what a tester hit mid-evaluation. A flat sheet
    // of 200 checkbox rows would be a bulk path with no way to aim it; here the
    // search, the tag chips, the metadata filters and the sort all keep working,
    // so "select all" means "everything I have narrowed to".
    //
    // The selection deliberately SURVIVES a filter change: picking a few games,
    // searching again and picking a few more is the normal way to use it. The
    // count is always on screen, so a selection reaching beyond what is currently
    // shown is stated rather than hidden.
    let selecting = false;
    let shownCards = [];
    const selection = new Set();
    const canBulkDelete = roundCan(round, 'game.delete');

    const bulkBar = h(`<div class="bulk-bar" hidden>
         <div class="bulk-bar__info">
           <span class="bulk-bar__count" aria-live="polite"></span>
           <span class="muted bulk-bar__hint">${esc(t('bulk.hint'))}</span>
         </div>
         <div class="bulk-bar__actions">
           <button type="button" class="link-btn" data-act="all"></button>
           <button type="button" class="btn" data-act="retire"><i class="ti ti-trash" aria-hidden="true"></i> ${esc(t('bulk.retire'))}</button>
           ${canBulkDelete ? `<button type="button" class="btn btn--danger" data-act="delete"><i class="ti ti-trash-x" aria-hidden="true"></i> ${esc(t('bulk.delete'))}</button>` : ''}
         </div>
       </div>`);
    const bulkCount = bulkBar.querySelector('.bulk-bar__count');
    const bulkAll = bulkBar.querySelector('[data-act="all"]');

    // The one place the card's selected state is written, so the class, the
    // ARIA state and the enabled actions can never disagree.
    function syncSelection() {
      shownCards.forEach((c) => {
        const on = selection.has(c.dataset.gid);
        c.classList.toggle('is-picked', on);
        if (selecting) c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const n = selection.size;
      bulkCount.textContent = tn(n, 'bulk.selectedOne', 'bulk.selected');
      // „Alle auswählen" until everything currently SHOWN is on, then „Auswahl
      // aufheben" — showMoveGames' semantics, not the tag chips' (#723). The two
      // differ deliberately; see the comment on core.js's bulk toggle.
      const allShown = shownCards.length > 0 && shownCards.every((c) => selection.has(c.dataset.gid));
      bulkAll.textContent = allShown ? t('bulk.selectNone') : t('bulk.selectAll');
      bulkBar.querySelectorAll('[data-act="retire"], [data-act="delete"]')
        .forEach((b) => { b.disabled = n === 0; });
    }

    // A card is a link to the game's detail page; in selection mode it becomes a
    // toggle instead. Swapping the role and dropping the href is what keeps that
    // honest for assistive tech — a nested checkbox would be an interactive
    // control inside an <a>, the shape the archive rows avoid too.
    function paintCardMode(card) {
      if (selecting) {
        card.dataset.href = card.getAttribute('href') || '';
        card.removeAttribute('href');
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-pressed', 'false');
      } else {
        if (card.dataset.href) card.setAttribute('href', card.dataset.href);
        card.removeAttribute('role');
        card.removeAttribute('tabindex');
        card.removeAttribute('aria-pressed');
        card.classList.remove('is-picked');
      }
    }

    function setSelecting(on) {
      selecting = on;
      if (!on) selection.clear();
      gamesSec.classList.toggle('is-selecting', on);
      bulkBar.hidden = !on;
      selectBtn.classList.toggle('is-active', on);
      selectBtn.querySelector('.tools-label').textContent = on ? t('bulk.done') : t('bulk.select');
      Object.values(cardById).forEach(paintCardMode);
      renderGames();
    }

    // Capture phase, on the grid: the card's own navLink handler is attached to
    // the card itself, so stopping propagation here is what keeps a pick from
    // navigating away. Delegated rather than per-card, so it costs one listener
    // whatever the shelf holds.
    const toggleFrom = (e) => {
      if (!selecting) return false;
      const card = e.target.closest && e.target.closest('.game-card');
      if (!card || !grid.contains(card)) return false;
      e.preventDefault();
      e.stopPropagation();
      const gid = card.dataset.gid;
      if (selection.has(gid)) selection.delete(gid); else selection.add(gid);
      syncSelection();
      return true;
    };
    grid.addEventListener('click', toggleFrom, true);
    grid.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      toggleFrom(e);
    }, true);

    bulkAll.addEventListener('click', () => {
      const allShown = shownCards.length > 0 && shownCards.every((c) => selection.has(c.dataset.gid));
      shownCards.forEach((c) => {
        if (allShown) selection.delete(c.dataset.gid); else selection.add(c.dataset.gid);
      });
      syncSelection();
    });

    // Both actions send the explicit id list the user just confirmed a count
    // for — never an "everything" shortcut, which could pick up a game added
    // from another device since the mode was entered (showMoveGames' reasoning).
    async function runBulk(act) {
      const ids = [...selection];
      if (!ids.length) return;
      const msg = act === 'retire'
        ? tn(ids.length, 'bulk.confirmRetireOne', 'bulk.confirmRetire')
        : selectionTouchesHistory(round, selection)
          ? tn(ids.length, 'bulk.confirmDeleteOne', 'bulk.confirmDelete')
          : tn(ids.length, 'bulk.confirmDeletePlainOne', 'bulk.confirmDeletePlain');
      if (!confirm(msg)) return;
      const buttons = [...bulkBar.querySelectorAll('button')];
      buttons.forEach((b) => { b.disabled = true; });
      try {
        const res = await api('POST', `/api/rounds/${rid}/games/bulk-${act}`, { gameIds: ids });
        const n = act === 'retire' ? res.retired : res.deleted;
        toast(act === 'retire'
          ? tn(n, 'bulk.retiredOne', 'bulk.retired')
          : tn(n, 'bulk.deletedOne', 'bulk.deleted'));
        // Await the fresh round before re-rendering: after a destructive bulk
        // action the stale-then-revalidate render would show the deleted games
        // one more time, which reads as the action having failed.
        await fetchRoundFresh(rid);
        showRound(rid, 'regal');
      } catch (e) {
        buttons.forEach((b) => { b.disabled = false; });
        syncSelection();
        toast(e.message);
      }
    }
    bulkBar.querySelector('[data-act="retire"]').addEventListener('click', () => runBulk('retire'));
    const bulkDelBtn = bulkBar.querySelector('[data-act="delete"]');
    if (bulkDelBtn) bulkDelBtn.addEventListener('click', () => runBulk('delete'));

    const selectBtn = h(`<button class="link-btn"><i class="ti ti-checkbox" aria-hidden="true"></i> <span class="tools-label">${esc(t('bulk.select'))}</span></button>`);
    selectBtn.addEventListener('click', () => setSelecting(!selecting));
    gamesTools.appendChild(selectBtn);

    let query = regalFilters.query;
    // Filter chips: custom round tags only (#238, tri-state #241). One chip per
    // round tag, all ignored by default; clicking cycles ignore -> include ->
    // exclude, where included tags combine per `regalFilters.tagMode` (#726) and
    // excluded tags reject a game carrying any of them, whatever the mode.
    // Ids of since-deleted tags are pruned from the
    // persisted map so they can't invisibly filter everything out.
    const roundTags = round.tags || [];
    const tagFilter = regalFilters.tags;
    [...tagFilter.keys()].forEach((x) => { if (!roundTags.some((tg) => tg.id === x)) tagFilter.delete(x); });
    // The tag half of the filter panel (#827). It used to be a chip row with its
    // OWN phone-only „Filter" toggle sitting beside the „Weitere Filter" drawer —
    // three affordances for one job, and the toggle collapsed only below 860px
    // while the drawer collapsed at every width. Now it is a plain section handed
    // to `renderFilterPanel`, which owns the one trigger and the applied chips.
    function buildTagSection() {
      const sectionEl = h(`<div class="fpanel__group">
          <div class="field-head">
            <div class="field__label" id="regalTagLabel">${esc(t('tags.title'))}</div>
            <span id="regalBulkMount"></span>
          </div>
          <div id="regalModeMount"></div>
          <div class="filter-chips" role="group" aria-labelledby="regalTagLabel"></div>
        </div>`);
      const chips = sectionEl.querySelector('.filter-chips');
      const chipEls = [];
      const repaintChips = () =>
        chipEls.forEach(({ el, tag }) =>
          paintTagChip(el, tag.name, tagFilter.get(tag.id), tag.icon, regalFilters.tagMode));
      // The AND/OR control for the included tags (#726), shared with the session
      // setup screen and reading its state out of `regalFilters` so it survives
      // navigation within the round like the chips and the search do.
      const mode = renderTagModeToggle(regalFilters, tagFilter, () => {
        repaintChips();
        renderGames();
      });
      // The bulk „Alle wählen"/„Alle abwählen" action (#723), shared with the
      // session setup screen. It sits in the section head beside the label
      // rather than after the chips, which is where the setup screen already put
      // it — one panel, one grammar.
      const bulk = renderTagBulkToggle(
        tagFilter,
        roundTags,
        repaintChips,
        () => { mode.sync(); syncFilterBar(); renderGames(); }
      );
      roundTags.forEach((tg) => {
        const chip = h('<button class="chip"></button>');
        chipEls.push({ el: chip, tag: tg });
        paintTagChip(chip, tg.name, tagFilter.get(tg.id), tg.icon, regalFilters.tagMode);
        chip.addEventListener('click', () => {
          paintTagChip(chip, tg.name, cycleTagState(tagFilter, tg.id), tg.icon, regalFilters.tagMode);
          bulk.sync();
          mode.sync();
          syncFilterBar();
          renderGames();
        });
        chips.appendChild(chip);
      });
      sectionEl.querySelector('#regalBulkMount').replaceWith(bulk.el);
      sectionEl.querySelector('#regalModeMount').replaceWith(mode.el);
      return {
        el: sectionEl,
        // `tagFilterChips` is shared with the session setup screen
        // (filter-panel.js): one tri-state map, one set of applied chips, so the
        // two screens cannot describe the same picks differently.
        chips: () => tagFilterChips(roundTags, tagFilter, () => {
          repaintChips();
          bulk.sync();
          mode.sync();
        }),
        reset: () => { tagFilter.clear(); repaintChips(); bulk.sync(); mode.sync(); },
      };
    }

    // The wrapper is created UNCONDITIONALLY and hidden while it holds nothing,
    // because the backfill below can make the panel appear on a shelf that could
    // not offer it a moment ago (#736) — and with no wrapper there would be
    // nowhere to put it. `hidden` costs no space: `.regal-filter` sets only a
    // margin, so nothing overrides the UA's `[hidden]`
    // (.claude/rules/hidden-attribute-vs-display-rule.md).
    const filterWrap = h('<div class="regal-filter"></div>');
    gamesSec.appendChild(filterWrap);

    const tagSection = roundTags.length ? buildTagSection() : null;
    let filterPanel = null;
    // A tag chip changes the applied-filter chips the bar renders, so it has to
    // be told; the metadata controls resync themselves through the panel's
    // onChange.
    function syncFilterBar() { if (filterPanel) filterPanel.sync(); }
    const mountFilterPanel = () => {
      // Never rebuild under an open overlay (#844) — the trigger is the popover's
      // anchor, and replacing it would strand it mid-adjustment. Nothing is lost:
      // the overlay body is rebuilt from `activeGames` on every open, and the
      // backfill fills those game objects IN PLACE.
      if (filterPanel && filterPanel.isOpen()) return;
      // The picks survive because `regalFilters.metadata` is mutated in place and
      // handed straight back in, and the tag section node is MOVED into the new
      // panel rather than rebuilt.
      if (filterPanel) filterPanel.el.remove();
      filterPanel = renderFilterPanel(activeGames, regalFilters.metadata, () => renderGames(), tagSection);
      if (filterPanel) filterWrap.appendChild(filterPanel.el);
      filterWrap.hidden = !filterPanel;
    };
    mountFilterPanel();

    // Fill the shelf's missing BGG metadata (#736) — the Regal is the other
    // screen #725 gave these filters to, and it was no more a backfill trigger
    // than the setup screen was. Folded in and repainted in place rather than
    // re-rendered: a rebuild would reset the scroll position, the search box and
    // the sort the user just chose.
    refreshShelfGameInfo(rid, activeGames, () => {
      mountFilterPanel();
      renderGames();
      swrStore.set('round:' + rid, round);
    });

    // Build the cards once and remember them by game id. When re-sorting we only
    // reorder these existing nodes – no page rebuild that would reset the scroll.
    // Covers load lazily as cards scroll into view (#198); watch the card, not
    // the __img — the card's `content-visibility: auto` skips descendant layout.
    const loadCover = createCoverLoader();
    const cardById = {};
    activeGames.forEach((g) => {
      const fallback = coverPlaceholder(g);
      const avg = avgMap[g.id];
      const scorePill =
        avg !== null
          ? `<span class="score-pill" style="background:${avgColor(avg)}">Ø ${fmtAvg(avg)}</span>`
          : `<span class="score-pill score-pill--none">${esc(t('games.scoreNew'))}</span>`;
      // What the round owns for this game (#653) — no badge at zero, so a shelf
      // of plain base boxes looks exactly as it always did.
      const expCount = (g.expansions || []).length;
      const expBadge = expCount
        ? `<span class="exp-pill" title="${esc(tn(expCount, 'detail.expansionsBadgeOne', 'detail.expansionsBadge', { n: expCount }))}">+${expCount}</span>`
        : '';
      const gc = h(`<a class="game-card game-card--clickable">
           <div class="game-card__img">${fallback}
             <div class="game-card__badges">${expBadge}${scorePill}</div>
             <span class="game-card__pick" aria-hidden="true"><i class="ti ti-check"></i></span>
           </div>
           <div class="game-card__body">
             <div class="game-card__title">${esc(g.title)}</div>
           </div>
         </a>`);
      if (g.image) loadCover(gc, coverUrl(g.image, COVER_CARD), gc.querySelector('.game-card__img'));
      navLink(gc, gamePath(rid, g.id), () => showGameDetail(rid, g.id));
      gc.dataset.gid = g.id;
      cardById[g.id] = gc;
    });
    gamesSec.appendChild(bulkBar);
    gamesSec.appendChild(grid);

    function orderedGames() {
      if (gamesSort === 'name') {
        return [...activeGames].sort((a, b) =>
          a.title.localeCompare(b.title, getLocale(), { sensitivity: 'base' })
        );
      }
      if (gamesSort === 'avg') {
        // Best first; unrated (null) at the end.
        return [...activeGames].sort((a, b) => (avgMap[b.id] ?? -1) - (avgMap[a.id] ?? -1));
      }
      return randomOrderedGames(round, activeGames);
    }
    function matchesFilters(g) {
      if (!matchesTagFilter(tagFilter, g.tagIds, regalFilters.tagMode)) return false;
      // The same predicate the draw applies (#725) — the Regal filters in the
      // browser only, so there is no route change here, but the semantics must
      // be the shelf's and the draw's alike.
      if (!fitsMetadataFilters(g, regalFilters.metadata)) return false;
      const q = query.trim().toLowerCase();
      if (q && !g.title.toLowerCase().includes(q)) return false;
      return true;
    }
    // Reorder/filter the existing card nodes (no page rebuild); the add tile
    // always closes the grid.
    function renderGames() {
      const cards = orderedGames().filter(matchesFilters).map((g) => cardById[g.id]);
      // The "add a game" tile is dropped while selecting: it is not selectable,
      // and a dashed tile sitting among checkable covers reads as one that is
      // simply unticked. `shownCards` is what "select all" means — the games
      // currently passing the search, tags and metadata filters, which is the
      // whole reason the mode lives in the grid rather than in a flat sheet.
      shownCards = cards;
      if (cards.length === 0) {
        const msg = query.trim()
          ? t('games.noMatch', { q: query.trim() })
          : t('games.noMatchFilters');
        grid.replaceChildren(h(`<div class="muted games-nomatch">${esc(msg)}</div>`), ...(selecting ? [] : [addTile]));
        syncSelection();
        return;
      }
      grid.replaceChildren(...cards, ...(selecting ? [] : [addTile]));
      syncSelection();
    }

    searchInput.addEventListener('input', () => {
      query = searchInput.value;
      regalFilters.query = query;
      renderGames();
    });
    sortSel.addEventListener('change', () => {
      gamesSort = sortSel.value;
      renderGames();
    });
    renderGames();
  }

  // The ways off the active shelf — the two archives, retired ("Aussortiert")
  // and completed ("Durchgespielt", #250), the Wunschliste (#560) and the
  // recommendations (#682). All four are kept apart because the reason differs:
  // two are games the group had, one is games they want, and one is games they
  // do not own at all.
  //
  // `rail-owned`, so from 1280px up this is display:none and the rail's
  // "Nicht im Regal" group carries the same four. Below that they used to be a
  // row at the very BOTTOM of the grid — #334 fixed only the desktop half, and
  // on a phone column of 1–2 covers a large Regal buries them a hundred-plus
  // rows down (#777). Same footer-stranding #561 fixed for the round's actions.
  //
  // Appended OUTSIDE the branch above on purpose: `.section-tools` is otherwise
  // only populated when the shelf has games, and an empty shelf can still have a
  // full Wunschliste or Aussortiert — i.e. it would vanish exactly where it is
  // most needed.
  const offShelfBtn = h(`<button class="link-btn rail-owned" type="button"><i class="ti ti-archive" aria-hidden="true"></i> <span>${esc(t('rail.archive'))}</span></button>`);
  offShelfBtn.addEventListener('click', () => openOffShelfSheet(round));
  gamesTools.appendChild(offShelfBtn);

  app.appendChild(gamesSec);
  // "Spiele verschieben" and "Einladen" used to sit in a footer below the grid
  // too. Neither is a shelf concern — one consolidates two rounds, the other
  // shares the round — and both were findable only by scrolling past the whole
  // game grid, so they moved to the round's Einstellungen screen (#561).
}

// The four off-shelf destinations, as a plain list sheet.
//
// ONE presentation for everything below 1280px, deliberately: the trigger is
// `rail-owned`, so a popover/sheet split by the 860px editor breakpoint would
// invent a third presentation for the 860–1279px band alone. The
// popover-vs-sheet split exists because an anchored popover cannot hold a text
// input on a phone (.claude/rules/popover-vs-sheet-editors.md) — this holds only
// links, so it never needs it. Shape copied from pickExpansionBase (#664).
function openOffShelfSheet(round) {
  const rid = round.id;
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog sheet--list" role="dialog" aria-modal="true" aria-label="${esc(t('rail.archive'))}">
        <div class="sheet__head">
          <h2>${esc(t('rail.archive'))}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="ds-list off-shelf"></div>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const dismiss = () => closeSheet();
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', onKey, true);
  // Must go through openSheet for the focus trap (#145) and Back-dismissal
  // (#333) — never assign activeSheet directly.
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) dismiss(); });
  backdrop.querySelector('.sheet__close').addEventListener('click', dismiss);

  // Same icons, labels and counts as the rail's rows — the two are one
  // navigation at two widths, which is what test/off-shelf-parity.test.js
  // pins. Recommendations carry no count deliberately: the other three number
  // the round's OWN games, while this one would number a list the round has
  // never seen (see the comment at round-rail.js's suggest row).
  const list = backdrop.querySelector('.off-shelf');
  [
    { icon: 'ti-trash', label: t('retired.link', { n: round.games.filter((g) => g.retired).length }), sub: 'retired', go: () => showRetired(rid) },
    { icon: 'ti-circle-check', label: t('completed.link', { n: round.games.filter((g) => g.completed).length }), sub: 'completed', go: () => showCompleted(rid) },
    { icon: 'ti-heart', label: t('wish.link', { n: round.games.filter((g) => g.wish).length }), sub: 'wishlist', go: () => showWishlist(rid) },
    { icon: 'ti-sparkles', label: t('suggest.link'), sub: 'recommendations', go: () => showRecommendations(rid) },
  ].forEach(({ icon, label, sub, go }) => {
    // Real <a href> (#330), so ⌘/middle-click still open them in a new tab.
    // `class` FIRST, like every other .ds-row site — test/ds-row-affordance.test.js
    // matches on `<a\s+class="ds-row…"`, so an attribute in front of it makes the
    // row invisible to that guard rather than failing it.
    const row = h(`<a class="ds-row off-shelf__row">
         <span class="ds-row__main"><i class="ti ${icon}" aria-hidden="true"></i><span>${esc(label)}</span></span>
         <span class="ds-row__meta"><i class="ti ti-chevron-right" aria-hidden="true"></i></span>
       </a>`);
    // Through closeSheet, never on the line after it, or the queued history pop
    // races the screen the choice renders
    // (.claude/rules/sheet-history-back-dismissal.md).
    navLink(row, roundPath(rid, sub), () => closeSheet(go));
    list.appendChild(row);
  });
}
