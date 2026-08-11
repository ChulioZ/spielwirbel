/* Spielwirbel – views: the Regal tab, the round's games library — search, the
   tri-state tag filter chips, sort, the lazy cover grid, and the footer links
   to the three off-shelf screens. Rendered by showRound() (views-round.js).
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
    // The tag half of `.regal-filter`, unchanged but for having become a
    // function: since #725 it is one of two things that may fill the wrapper.
    function buildTagFilter(filterWrap) {
      const chips = h('<div class="filter-chips"></div>');
      const toggle = h(`<button class="filter-toggle" type="button" aria-expanded="false">
           <i class="ti ti-tags" aria-hidden="true"></i><span>${esc(t('games.filter'))}</span>
           <span class="filter-toggle__badge" aria-hidden="true" hidden></span>
         </button>`);
      const badge = toggle.querySelector('.filter-toggle__badge');
      // The count of actively-filtering tags is shown two ways so it is never
      // conveyed by colour alone while collapsed: the badge (sighted) and the
      // button's aria-label (screen readers). The badge is aria-hidden so the
      // label doesn't announce the number twice.
      function syncFilterBadge() {
        const n = tagFilter.size;
        badge.textContent = n;
        badge.hidden = n === 0;
        toggle.setAttribute('aria-label', t('games.filterLabel', { n }));
      }
      toggle.addEventListener('click', () => {
        const open = filterWrap.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      // The bulk „Alle wählen"/„Alle abwählen" action (#723), shared with the
      // session setup screen. It lives in `.regal-filter` rather than inside
      // `.filter-chips` — an action is not one of the chips — so CSS collapses
      // it with them below 860px.
      const chipEls = [];
      const repaintChips = () =>
        chipEls.forEach(({ el, tag }) =>
          paintTagChip(el, tag.name, tagFilter.get(tag.id), tag.icon, regalFilters.tagMode));
      // The AND/OR control for the included tags (#726), shared with the session
      // setup screen and reading its state out of `regalFilters` so it survives
      // navigation within the round like the chips and the search do. The count
      // badge is unaffected — it counts actively-filtering tags, which the mode
      // does not change.
      const mode = renderTagModeToggle(regalFilters, tagFilter, () => {
        repaintChips();
        renderGames();
      });
      const bulk = renderTagBulkToggle(
        tagFilter,
        roundTags,
        repaintChips,
        () => { mode.sync(); syncFilterBadge(); renderGames(); }
      );
      roundTags.forEach((tg) => {
        const chip = h('<button class="chip"></button>');
        chipEls.push({ el: chip, tag: tg });
        paintTagChip(chip, tg.name, tagFilter.get(tg.id), tg.icon, regalFilters.tagMode);
        chip.addEventListener('click', () => {
          paintTagChip(chip, tg.name, cycleTagState(tagFilter, tg.id), tg.icon, regalFilters.tagMode);
          bulk.sync();
          mode.sync();
          syncFilterBadge();
          renderGames();
        });
        chips.appendChild(chip);
      });
      syncFilterBadge();
      filterWrap.appendChild(toggle);
      filterWrap.appendChild(mode.el);
      filterWrap.appendChild(chips);
      filterWrap.appendChild(bulk.el);
    }

    // „Weitere Filter" (#725), the same disclosure the session setup screen
    // carries. It decides whether there is a wrapper at all: a round with no
    // tags but BGG metadata on its shelf gets a `.regal-filter` holding only
    // this, and a round with neither still gets none. Its summary carries its
    // OWN count — deliberately not folded into the tag toggle's badge, because
    // the two collapse independently (the chips only below 860px, this at every
    // width) and one number over two controls could not say which is filtering.
    //
    // The wrapper is created UNCONDITIONALLY and hidden while it holds nothing,
    // because the backfill below can make the disclosure appear on a shelf that
    // could not offer it a moment ago (#736) — and with no wrapper there would
    // be nowhere to put it. `hidden` costs no space: `.regal-filter` sets only a
    // margin, so nothing overrides the UA's `[hidden]`
    // (.claude/rules/hidden-attribute-vs-display-rule.md).
    const filterWrap = h('<div class="regal-filter"></div>');
    if (roundTags.length) buildTagFilter(filterWrap);
    gamesSec.appendChild(filterWrap);

    let metaFilter = null;
    const mountMetaFilter = () => {
      // The open flag survives a rebuild; the picks survive because
      // `regalFilters.metadata` is mutated in place and handed straight back in.
      const wasOpen = !!(metaFilter && metaFilter.el.open);
      if (metaFilter) metaFilter.el.remove();
      metaFilter = renderMetadataFilter(activeGames, regalFilters.metadata, () => renderGames());
      if (metaFilter) {
        metaFilter.el.open = wasOpen;
        filterWrap.appendChild(metaFilter.el);
      }
      filterWrap.hidden = !roundTags.length && !metaFilter;
    };
    mountMetaFilter();

    // Fill the shelf's missing BGG metadata (#736) — the Regal is the other
    // screen #725 gave these filters to, and it was no more a backfill trigger
    // than the setup screen was. Folded in and repainted in place rather than
    // re-rendered: a rebuild would reset the scroll position, the search box and
    // the sort the user just chose.
    refreshShelfGameInfo(rid, activeGames, () => {
      mountMetaFilter();
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
          ? `<span class="score-pill" style="background:${avgColor(avg)}">Ø ${avg.toFixed(1)}</span>`
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
           </div>
           <div class="game-card__body">
             <div class="game-card__title">${esc(g.title)}</div>
           </div>
         </a>`);
      if (g.image) loadCover(gc, coverUrl(g.image, COVER_CARD), gc.querySelector('.game-card__img'));
      navLink(gc, gamePath(rid, g.id), () => showGameDetail(rid, g.id));
      cardById[g.id] = gc;
    });
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
      if (cards.length === 0) {
        const msg = query.trim()
          ? t('games.noMatch', { q: query.trim() })
          : t('games.noMatchFilters');
        grid.replaceChildren(h(`<div class="muted games-nomatch">${esc(msg)}</div>`), addTile);
        return;
      }
      grid.replaceChildren(...cards, addTile);
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
  app.appendChild(gamesSec);

  // Quiet footer: the ways off the active shelf — the two archives, retired
  // ("Aussortiert") and completed ("Durchgespielt", #250), plus the Wunschliste
  // (#560). All three are kept apart because the reason differs: two are games
  // the group had, the third is games they want.
  const retiredGames = round.games.filter((g) => g.retired);
  const completedGames = round.games.filter((g) => g.completed);
  const wishGames = round.games.filter((g) => g.wish);
  const foot = h('<div class="round-footer rail-owned"></div>');
  const retiredBtn = h(`<a class="link-btn"><i class="ti ti-trash" aria-hidden="true"></i> ${esc(t('retired.link', { n: retiredGames.length }))}</a>`);
  navLink(retiredBtn, roundPath(round.id, 'retired'), () => showRetired(round.id));
  foot.appendChild(retiredBtn);
  const completedBtn = h(`<a class="link-btn"><i class="ti ti-circle-check" aria-hidden="true"></i> ${esc(t('completed.link', { n: completedGames.length }))}</a>`);
  navLink(completedBtn, roundPath(round.id, 'completed'), () => showCompleted(round.id));
  foot.appendChild(completedBtn);
  const wishBtn = h(`<a class="link-btn"><i class="ti ti-heart" aria-hidden="true"></i> ${esc(t('wish.link', { n: wishGames.length }))}</a>`);
  navLink(wishBtn, roundPath(round.id, 'wishlist'), () => showWishlist(round.id));
  foot.appendChild(wishBtn);
  // "Spiele verschieben" and "Einladen" used to sit here too. Neither is a shelf
  // concern — one consolidates two rounds, the other shares the round — and both
  // were findable only by scrolling past the whole game grid, so they moved to
  // the round's Einstellungen screen (#561).
  app.appendChild(foot);
}
