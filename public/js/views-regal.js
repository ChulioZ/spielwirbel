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

  // Stats per active game (for the rating pills and sorting), shelf-scoped:
  // one pass for the play counts, one for the raw scores, then the round's own
  // prior — never `gameStats` per card, which would rederive both per game
  // (#894, and see roundScoreIndex's own comment for the measured cost).
  const { byGame: statsByGame } = roundScoreIndex(round, activeGames);

  const gamesSec = h('<div class="section"></div>');
  // Der Tisch composes this head as T3.3/T6.2 draw it (#1278): a display title
  // „Regal" with the count beside it, one row of controls, and the gold „Spiel
  // hinzufügen" — which replaces the dashed tile closing the grid. Every other
  // design keeps the section-label head below, unchanged.
  const tisch = designIs('tisch');
  // Ocean (#1212, O3.3/O6.2/O6.7) takes the same composed head — „Regal" with
  // the count beside it — and the filter trigger lifted into the toolbar, and
  // words the sort „Sortiert: Bewertung". It keeps the dashed add tile and
  // brings its own ways off the shelf; ocean.css lays the rest out per width.
  const ocean = designIs('ocean');
  const composed = tisch || ocean;
  // h1, not h3: on the Regal/Chronik/Pokale tabs this is the top-level heading of
  // the view — only the Start tab renders the round-name hero (#145). The
  // section-label look is unchanged; `.section-head :is(h1,h2,h3)` styles it.
  const title = composed
    ? `<div class="regal-title"><h1>${esc(t('hub.tab.regal'))}</h1><span class="regal-title__count">${esc(tn(activeGames.length, 'home.chip.gamesOne', 'home.chip.games'))}</span></div>`
    : `<h1>${esc(t('games.title', { n: activeGames.length }))}</h1>`;
  const gamesHead = h(`<div class="section-head${composed ? ' regal-head' : ''}">${title}<div class="section-tools"></div></div>`);
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
  // while the Regal is empty, and as a persistent header action once it isn't
  // (under Der Tisch, as a row in the add sheet instead — see below).
  const importTile = h(`<button class="add-tile">
       <i class="ti ti-download" aria-hidden="true"></i>
       <span>${esc(t('bggImport.tile'))}</span>
     </button>`);
  importTile.addEventListener('click', () => showBggImport(round));

  // Under Der Tisch the gold button is THE add action, so the dashed tile goes.
  // The empty shelf keeps its import tile: that is the empty state's offer, not
  // the toolbar's (#1278 moved only the toolbar's import into the add sheet).
  const gridAddTile = tisch ? [] : [addTile];

  if (activeGames.length === 0) {
    gamesSec.appendChild(emptyState({ icon: 'ti-cards', title: t('games.emptyTitle'), text: t('games.empty') }));
    grid.append(...gridAddTile);
    if (canImportBgg()) grid.appendChild(importTile);
    gamesSec.appendChild(grid);
  } else {
    // Not under Der Tisch (#1278): T3.3 has no slot for it, and the add sheet
    // already offers the same import as a row (add-game-search.js, behind the
    // same canImportBgg() gate), so the toolbar holds exactly the sheet's
    // controls and nothing becomes unreachable.
    if (canImportBgg() && !tisch) {
      // Two spellings of one label, switched by width in CSS (#621) — the full
      // wording is ~269px, most of a 320px phone's content column. Both strings
      // already exist for the empty-Regal tile, so this needs no new i18n key.
      const importBtn = h(`<button class="link-btn"><i class="ti ti-download" aria-hidden="true"></i> <span class="tools-label tools-label--long">${esc(t('bggImport.link'))}</span><span class="tools-label tools-label--short">${esc(t('bggImport.tile'))}</span></button>`);
      importBtn.addEventListener('click', () => showBggImport(round));
      gamesTools.appendChild(importBtn);
    }
    // Score per game (from the already computed stats) for pill and sorting.
    // The Spielwirbel-Score, not the raw mean (#893) — the pill and the
    // „Sortieren: Bewertung" order read the same number, so the shelf cannot
    // show one ranking and sort by another.
    const scoreMap = {};
    activeGames.forEach((g) => (scoreMap[g.id] = statsByGame[g.id].score));

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
    // Ocean prints the sort as a statement, „Sortiert: Bewertung" (O3.3). The
    // prefix is a visible word beside the <select>, whose own aria-label is
    // unchanged — so it is aria-hidden rather than a second name.
    if (ocean) {
      const sortWrap = h(`<span class="regal-sort"><span class="regal-sort__prefix" aria-hidden="true">${esc(t('games.sortedBy'))}</span></span>`);
      sortWrap.appendChild(sortSel);
      gamesTools.appendChild(sortWrap);
    } else {
      gamesTools.appendChild(sortSel);
    }
    // The shelf's one ⓘ (#893) — beside the control that sorts on the score,
    // not on every pill in the grid.
    const scoreInfo = h(infoButton('score'));
    gamesTools.appendChild(scoreInfo);
    wireInfoButtons(gamesTools);

    /* Selection mode and its four bulk actions live in regal-bulk.js (#1000).
       `cards` and `refresh` are thunks because both are assigned further down
       this function — the module's header says why a plain value cannot work. */
    const bulk = createRegalBulk({
      round,
      rid,
      grid,
      gamesSec,
      cards: () => cardById,
      refresh: () => renderGames(),
    });
    // A hook for Der Tisch's phone row, which draws this toggle as a glyph chip
    // while it is off (T6.2 has no room for a fourth worded chip).
    if (tisch) bulk.button.classList.add('regal-select');
    gamesTools.appendChild(bulk.button);


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
    let toolTrigger = null;
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
      filterPanel = renderFilterPanel(activeGames, regalFilters.metadata, () => renderGames(), tagSection,
        composed ? { countBadge: true } : undefined);
      if (filterPanel) filterWrap.appendChild(filterPanel.el);
      filterWrap.hidden = !filterPanel;
      // Der Tisch lifts the trigger into the toolbar's one row, between the ⓘ
      // and „Auswählen" (T3.3's order); the applied chips stay below the head.
      // The node is MOVED, so the panel's own listener and its popover anchor
      // come with it — and a remount must take the old one out of the row.
      if (composed) {
        if (toolTrigger) toolTrigger.remove();
        toolTrigger = filterPanel ? filterPanel.el.querySelector('.fbar__trigger') : null;
        if (toolTrigger) gamesTools.insertBefore(toolTrigger, bulk.button);
      }
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
      const score = scoreMap[g.id];
      // What the number rests on, so a shelf score the reader cannot square with
      // their own memory („warum steht da 3,9, wir haben alle 5 gegeben") has an
      // answer on the card (#894). It rides the pill's `title` — the pattern
      // `exp-pill` below already uses — because the badge overlay sits on the
      // cover and has no room for a second figure.
      const st = statsByGame[g.id];
      const evidence = st.count
        ? tn(st.count, 'score.evidenceOne', 'score.evidence', { n: st.count })
        : tn(st.plays, 'score.evidencePlaysOne', 'score.evidencePlays', { n: st.plays });
      const scorePill =
        score !== null
          ? `<span class="score-pill" style="--sc:${scoreColor(score)}" data-stop="${scoreStop(score)}" title="${esc(evidence)}">${fmtAvg(displayScore(score))}</span>`
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
             <div class="game-card__title">${esc(g.title)}</div>${ocean ? cardMeta(g) : ''}
           </div>
         </a>`);
      if (g.image) loadCover(gc, coverUrl(g.image, COVER_CARD), gc.querySelector('.game-card__img'));
      navLink(gc, gamePath(rid, g.id), () => showGameDetail(rid, g.id));
      gc.dataset.gid = g.id;
      cardById[g.id] = gc;
    });
    gamesSec.appendChild(bulk.bar);
    gamesSec.appendChild(grid);

    function orderedGames() {
      if (gamesSort === 'name') {
        return [...activeGames].sort((a, b) =>
          a.title.localeCompare(b.title, getLocale(), { sensitivity: 'base' })
        );
      }
      if (gamesSort === 'avg') {
        // Best first; unrated (null) at the end. Sorted on the UNCLAMPED score,
        // so two games below the displayed floor still order by how bad they
        // are — the sentinel is below the curve's minimum for that reason.
        return [...activeGames].sort((a, b) => (scoreMap[b.id] ?? -Infinity) - (scoreMap[a.id] ?? -Infinity));
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
      bulk.setShown(cards);
      if (cards.length === 0) {
        const msg = query.trim()
          ? t('games.noMatch', { q: query.trim() })
          : t('games.noMatchFilters');
        grid.replaceChildren(h(`<div class="muted games-nomatch">${esc(msg)}</div>`), ...(bulk.isSelecting() ? [] : gridAddTile));
        bulk.sync();
        return;
      }
      grid.replaceChildren(...cards, ...(bulk.isSelecting() ? [] : gridAddTile));
      bulk.sync();
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
  //
  // NOT `rail-owned` under a lean rail (railIsLean, round-rail.js): Der Tisch's
  // (#1262) and Ocean's Reling (#1211) carry no off-shelf group, so at desktop
  // this button is the Regal's own way to the four — T3.3 draws it in the
  // toolbar at 1440, and O3's „Vom Regal führt ein Weg zu Nicht im Regal".
  const offShelfBtn = h(`<button class="link-btn${railIsLean() ? '' : ' rail-owned'}" type="button"><i class="ti ti-archive" aria-hidden="true"></i> <span>${esc(t('rail.archive'))}</span></button>`);
  offShelfBtn.addEventListener('click', () => openOffShelfSheet(round));
  gamesTools.appendChild(offShelfBtn);

  // Der Tisch's gold „Spiel hinzufügen" (#1278). TWO buttons, one per layout,
  // and that is what keeps DOM order equal to visual order (WCAG 2.4.3): T3.3
  // ends the toolbar row with it, T6.2 puts it UNDER the shelf, sticky above the
  // dock. A sticky box only sticks within its parent, so the phone's copy has
  // to live after the grid — the toolbar's would scroll away with the head.
  // CSS shows exactly one at any width, and `display: none` drops the other
  // from the accessibility tree, so no width announces two.
  if (tisch) {
    const addBtn = (where) => {
      const b = h(`<button type="button" class="btn btn--primary regal-add regal-add--${where}"><i class="ti ti-plus" aria-hidden="true"></i> <span>${esc(t('round.addGame'))}</span></button>`);
      b.addEventListener('click', () => showAddGame(round));
      return b;
    };
    gamesTools.appendChild(addBtn('bar'));
    gamesSec.appendChild(addBtn('dock'));
  }

  // Ocean closes the shelf with the four ways off it (O3.3 draws them as a band
  // of cards, O6.2 as one row above the dock), and puts „Spiel hinzufügen"
  // where each width draws it: the dashed tile at desktop, a pill in the
  // toolbar on a tablet (O6.7), the round plus bubble on a phone (O6.2). All
  // are rendered and CSS shows one per width; `display: none` drops the others
  // from the accessibility tree, so no width announces two.
  if (ocean) {
    const bar = h(`<button type="button" class="btn btn--primary btn--sm regal-add regal-add--bar"><i class="ti ti-plus" aria-hidden="true"></i> <span>${esc(t('round.addGame'))}</span></button>`);
    bar.addEventListener('click', () => showAddGame(round));
    gamesTools.appendChild(bar);
    gamesSec.appendChild(oceanOffShelfBand(round));
    const fab = h(`<button type="button" class="regal-fab" aria-label="${esc(t('round.addGame'))}"><i class="ti ti-plus" aria-hidden="true"></i></button>`);
    fab.addEventListener('click', () => showAddGame(round));
    gamesSec.appendChild(fab);
  }

  app.appendChild(gamesSec);
  // "Spiele verschieben" and "Einladen" used to sit in a footer below the grid
  // too. Neither is a shelf concern — one consolidates two rounds, the other
  // shares the round — and both were findable only by scrolling past the whole
  // game grid, so they moved to the round's Einstellungen screen (#561).
}

// The meta line under an Ocean card's title (O3.3: „2–5 · 90 Min") — the
// player range and the playing time the game already carries, nothing new.
// The range is bare digits behind the people glyph, as the sheet prints it:
// „3–7 Personen · 20–60 Min." wraps to two lines in a 170px box. The full
// wording is what a screen reader hears (`.sr-only`), so the bare digits never
// reach it unexplained. Empty when the game carries neither, so a hand-typed
// game keeps a one-line body.
function cardMeta(g) {
  const hasPl = Number.isInteger(g.minPlayers) && Number.isInteger(g.maxPlayers);
  const range = hasPl ? (g.minPlayers === g.maxPlayers ? String(g.minPlayers) : `${g.minPlayers}–${g.maxPlayers}`) : '';
  const time = playtimeText(g);
  if (!range && !time) return '';
  const players = range
    ? `<span aria-hidden="true"><i class="ti ti-users"></i> ${esc(range)}</span><span class="sr-only">${esc(playersText(g.minPlayers, g.maxPlayers))}</span>`
    : '';
  return `<div class="game-card__meta">${[players, time ? esc(time) : ''].filter(Boolean).join(' · ')}</div>`;
}

// Ocean's end of the shelf (#1212): the four off-shelf destinations as a band
// of link cards (O3.3), and — the phone's presentation — one row that opens the
// same list as a sheet (O6.2). Both are rendered; CSS shows one per width.
// Entries come from off-shelf.js, like every other presentation of the four.
function oceanOffShelfBand(round) {
  const entries = offShelfEntries(round);
  const wrap = h(`<nav class="regal-offshelf" aria-label="${esc(t('rail.archive'))}">
      <h2 class="regal-offshelf__label">${esc(t('rail.archive'))}</h2>
      <div class="regal-offshelf__band"></div>
    </nav>`);
  const band = wrap.querySelector('.regal-offshelf__band');
  entries.forEach(({ icon, label, sub, go }) => {
    const card = h(`<a class="regal-offshelf__card"><span class="regal-offshelf__icon"><i class="ti ${icon}" aria-hidden="true"></i></span><span>${esc(label)}</span></a>`);
    navLink(card, roundPath(round.id, sub), go);
    band.appendChild(card);
  });
  const row = h(`<button type="button" class="regal-offshelf__row">
      <span class="regal-offshelf__icon"><i class="ti ti-archive" aria-hidden="true"></i></span>
      <span class="regal-offshelf__text"><span class="regal-offshelf__name">${esc(t('rail.archive'))}</span><span class="regal-offshelf__sub">${esc(entries.map((e) => e.label).join(' · '))}</span></span>
      <i class="ti ti-chevron-right" aria-hidden="true"></i>
    </button>`);
  row.addEventListener('click', () => openOffShelfSheet(round));
  wrap.appendChild(row);
  return wrap;
}

// The four off-shelf destinations, as a plain list sheet.
//
// ONE presentation for everything below 1280px, deliberately: the trigger is
// `rail-owned`, so a popover/sheet split by the 860px editor breakpoint would
// invent a third presentation for the 860–1279px band alone. The
// popover-vs-sheet split exists because an anchored popover cannot hold a text
// input on a phone (.claude/rules/popover-vs-sheet-editors.md) — this holds only
// links, so it never needs it. Shape copied from pickExpansionBase (#664).
// Under Der Tisch the trigger is not `rail-owned` (#1262), so this same centred
// dialog serves the desktop too — still one presentation, just at every width.
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

  // Icons, labels and counts come from off-shelf.js, so this sheet, the rail
  // and the hub's „Nicht im Regal" group cannot disagree about which rows exist
  // or what they count — what test/off-shelf-parity.test.js used to have to
  // compare between two hand-built arrays.
  const list = backdrop.querySelector('.off-shelf');
  offShelfEntries(round).forEach(({ icon, label, sub, go }) => {
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
