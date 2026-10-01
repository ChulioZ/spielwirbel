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
    regalFilters = { tags: new Map(), query: '', tagMode: 'all', owners: [] };
    gamesSort = 'avg';
    regalFiltersRid = round.id;
  }
  // The metadata filters (#725) are re-normalized against the CURRENT shelf on
  // every render, which does two jobs in one line: it mints the canonical shape
  // for a freshly reset round, and it drops a category whose last game has since
  // been archived — the counterpart of the deleted-tag pruning below, and what
  // stops a filter surviving as an active count over a chip nobody can see.
  regalFilters.metadata = normalizeMetadataFilters(regalFilters.metadata, metadataFilterOptions(activeGames));
  // The owner filter (#1433), over the members who own a game on THIS shelf —
  // none on an unmarked shelf, which is what keeps the section away there (the
  // setup screen's `shelfIsMarked` question; no second check, it would be
  // redundant and untestable). A pick whose last game has since left the shelf
  // is pruned in place, for the reason the metadata line above gives.
  const ownerMembers = ownerFilterMembers(round, activeGames);
  const ownerPicks = regalFilters.owners;
  [...ownerPicks].forEach((x) => {
    if (!ownerMembers.some((m) => m.id === x)) ownerPicks.splice(ownerPicks.indexOf(x), 1);
  });

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
  // Die Brücke (#1239, B3.2/B2.6/B16.2) takes the composed head, the
  // „Sortiert:" statement, cards with their meta and score on an opaque band
  // (bruecke-shelf.js), and from 30 games a letter jump and batched loading.
  // Its empty shelf is #1243's (B7.2).
  const bruecke = designIs('bruecke');
  // Das Programmheft (#1373, P3.3/P6.2/P7.8) takes the composed head too, and
  // Ocean's „Sortiert:" statement; its cards set the number, the meta and the
  // score as print ABOUT the cover rather than on it (phCard below).
  const ph = designIs('programmheft');
  const composed = tisch || ocean || ph || bruecke;
  // h1, not h3: on the Regal/Chronik/Pokale tabs this is the top-level heading of
  // the view — only the Start tab renders the round-name hero (#145). The
  // section-label look is unchanged; `.section-head :is(h1,h2,h3)` styles it.
  const title = composed
    ? `<div class="regal-title"><h1>${esc(t('hub.tab.regal'))}</h1><span class="regal-title__count">${esc(tn(activeGames.length, 'home.chip.gamesOne', 'home.chip.games'))}</span></div>`
    : `<h1>${esc(t('games.title', { n: activeGames.length }))}</h1>`;
  const gamesHead = h(`<div class="section-head${composed ? ' regal-head' : ''}">${title}<div class="section-tools"></div></div>`);
  const gamesTools = gamesHead.querySelector('.section-tools');
  if (ph) gamesSec.classList.add('ph-regal');
  if (bruecke) gamesSec.classList.add('bruecke-regal');
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
  // Die Brücke draws no tile either: B3.2 adds from the toolbar, B2.6 from a
  // full-width button under the grid.
  const gridAddTile = tisch || bruecke ? [] : [addTile];

  if (activeGames.length === 0 && (ocean || bruecke)) {
    /* Ocean's empty shelf (#1216, O7.1) carries its two ways in ON the card —
       the same two tiles' labels and handlers, as the card's one action and its
       side road — so the dashed tiles below would offer them a second time.
       Die Brücke's too (#1243, B7.2), with the side road as a text link: „nie
       als zweiter Knopf". */
    const empty = gamesSec.appendChild(emptyState({ icon: 'ti-cards', title: t('games.emptyTitle'), text: t('games.empty') }));
    emptyStateAction(empty, { icon: 'ti-plus', label: t('round.addGame'), primary: true, onClick: () => showAddGame(round) });
    if (canImportBgg()) {
      emptyStateAction(empty, bruecke
        ? { icon: 'ti-arrow-right', label: t('bggImport.tile'), link: true, onClick: () => showBggImport(round) }
        : { icon: 'ti-download', label: t('bggImport.tile'), onClick: () => showBggImport(round) });
    }
  } else if (activeGames.length === 0) {
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
      // P6.2 folds it into the phone's „…" (phMoreButton below).
      if (ph) importBtn.classList.add('regal-tool--wide');
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
    if (ocean || ph || bruecke) {
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
    if (ph) bulk.button.classList.add('regal-tool--wide');
    gamesTools.appendChild(bulk.button);
    if (ph) gamesTools.appendChild(phMoreButton(round, bulk.button));


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
      // `owners` is the Regal's own opt-in (#1433); the setup screen never
      // passes it. Rebuilt per mount so the backfill's repaint keeps it.
      filterPanel = renderFilterPanel(activeGames, regalFilters.metadata, () => renderGames(), tagSection, {
        countBadge: composed,
        owners: { round, members: ownerMembers, picked: ownerPicks },
      });
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
      const gc = ph ? phCard(round, g, fallback, score, evidence, expBadge)
        : bruecke ? brueckeCard(g, fallback, score, evidence, expBadge) : h(`<a class="game-card game-card--clickable">
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
    // B16.2: a shelf of 30 or more games gets the letter row over the grid and
    // loads in batches. `bkLimit` is how many of the matching games are on the
    // page; a jump widens it to the batch holding the letter, so the target
    // card exists before it is scrolled to. The row jumps in NAME order, so a
    // jump switches the sort to „Name" — the only order in which a letter is a
    // place on the shelf.
    let bkLimit = BRUECKE_BATCH;
    const dense = bruecke && activeGames.length >= BRUECKE_DENSE_MIN
      ? brueckeShelfDensity({
        more: () => { bkLimit += BRUECKE_BATCH; renderGames(); },
        jump: (letter) => {
          if (gamesSort !== 'name') { gamesSort = 'name'; sortSel.value = 'name'; }
          const games = orderedGames().filter(matchesFilters);
          const i = games.findIndex((g) => brueckeLetter(g.title) === letter);
          if (i < 0) return;
          bkLimit = Math.max(bkLimit, Math.ceil((i + 1) / BRUECKE_BATCH) * BRUECKE_BATCH);
          renderGames();
          const card = cardById[games[i].id];
          card.scrollIntoView({ block: 'center' });
          card.focus({ preventScroll: true });
        },
      })
      : null;
    if (dense) gamesSec.appendChild(dense.letters);
    gamesSec.appendChild(grid);
    if (dense) gamesSec.appendChild(dense.foot);

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
      if (!matchesOwnerFilter(ownerPicks, g.ownerIds)) return false;
      const q = query.trim().toLowerCase();
      if (q && !g.title.toLowerCase().includes(q)) return false;
      return true;
    }
    // Reorder/filter the existing card nodes (no page rebuild); the add tile
    // always closes the grid.
    function renderGames() {
      const games = orderedGames().filter(matchesFilters);
      const cards = games.map((g) => cardById[g.id]);
      // The "add a game" tile is dropped while selecting: it is not selectable,
      // and a dashed tile sitting among checkable covers reads as one that is
      // simply unticked. `shownCards` is what "select all" means — the games
      // currently passing the search, tags and metadata filters, which is the
      // whole reason the mode lives in the grid rather than in a flat sheet.
      bulk.setShown(cards);
      // Selecting shows every match: „Alle wählen" means the filtered shelf,
      // and a tick on a card that is not on the page could not be seen.
      const onPage = dense && !bulk.isSelecting() ? cards.slice(0, bkLimit) : cards;
      if (dense) dense.sync(bulk.isSelecting() ? [] : games, onPage.length);
      if (cards.length === 0) {
        const msg = query.trim()
          ? t('games.noMatch', { q: query.trim() })
          : t('games.noMatchFilters');
        grid.replaceChildren(h(`<div class="muted games-nomatch">${esc(msg)}</div>`), ...(bulk.isSelecting() ? [] : gridAddTile));
        bulk.sync();
        return;
      }
      grid.replaceChildren(...onPage, ...(bulk.isSelecting() ? [] : gridAddTile));
      // The programme's running number follows what is on the page, so a sort
      // or a filter renumbers rather than leaving gaps.
      if (ph) cards.forEach((c, i) => { c.querySelector('.ph-card__nr').textContent = t('regal.cardNo', { n: i + 1 }); });
      bulk.sync();
    }

    searchInput.addEventListener('input', () => {
      query = searchInput.value;
      regalFilters.query = query;
      renderGames();
    });
    sortSel.addEventListener('change', () => {
      gamesSort = sortSel.value;
      bkLimit = BRUECKE_BATCH;
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
  // Das Programmheft draws it in the toolbar between 860 and 1279 (P3.3), and
  // closes the shelf with the list at every width (P6.2). From 1280px its rail
  // carries the „Nicht im Regal" group, so programmheft.css hides the toolbar
  // copy there (`regal-tool--offshelf`) — rail, toolbar and list made three
  // entries for one thing. Not `rail-owned`: the design's own `.link-btn`
  // display rule outranks `.app .rail-owned`, measured at 1440.
  const offShelfCls = ph ? ' regal-tool--wide regal-tool--offshelf' : railIsLean() ? '' : ' rail-owned';
  const offShelfBtn = h(`<button class="link-btn${offShelfCls}" type="button"><i class="ti ti-archive" aria-hidden="true"></i> <span>${esc(t('rail.archive'))}</span></button>`);
  offShelfBtn.addEventListener('click', () => openOffShelfSheet(round));
  gamesTools.appendChild(offShelfBtn);

  // „Spiel hinzufügen" as a button; `cls` is the design's own modifier classes.
  const addBtn = (cls) => {
    const b = h(`<button type="button" class="btn btn--primary ${cls}"><i class="ti ti-plus" aria-hidden="true"></i> <span>${esc(t('round.addGame'))}</span></button>`);
    b.addEventListener('click', () => showAddGame(round));
    return b;
  };

  // Der Tisch's gold „Spiel hinzufügen" (#1278). TWO buttons, one per layout,
  // and that is what keeps DOM order equal to visual order (WCAG 2.4.3): T3.3
  // ends the toolbar row with it, T6.2 puts it UNDER the shelf, sticky above the
  // dock. A sticky box only sticks within its parent, so the phone's copy has
  // to live after the grid — the toolbar's would scroll away with the head.
  // CSS shows exactly one at any width, and `display: none` drops the other
  // from the accessibility tree, so no width announces two.
  if (tisch) {
    gamesTools.appendChild(addBtn('regal-add regal-add--bar'));
    gamesSec.appendChild(addBtn('regal-add regal-add--dock'));
  }

  // Ocean closes the shelf with the four ways off it (O3.3 draws them as a band
  // of cards, O6.2 as one row above the dock), and puts „Spiel hinzufügen"
  // where each width draws it: the dashed tile from 1280px (O3.3), a pill in
  // the toolbar from 600px (O6.7, and at desktop too since #1427 — the tile
  // alone was the end of a long scroll), the round plus bubble below that
  // (O6.2). All are rendered and CSS shows what each width needs;
  // `display: none` drops the others from the accessibility tree.
  // An EMPTY shelf takes neither the pill nor the bubble (#1216): its empty
  // state carries the add action itself, and a second one beside it is noise.
  const oceanAdds = ocean && activeGames.length > 0;
  if (oceanAdds) gamesTools.appendChild(addBtn('btn--sm regal-add regal-add--bar'));
  if (ocean) gamesSec.appendChild(oceanOffShelfBand(round));
  // Das Programmheft: the black „Spiel hinzufügen" closes the toolbar at
  // desktop (P3.3); a phone gets a second copy, sticky above the dock, and keeps
  // the dashed tile in the grid (P6.2, #1427). CSS shows one copy per width, as
  // Ocean's three do; the sticky one is after the grid for the reason Der
  // Tisch's is.
  if (ph && activeGames.length > 0) {
    gamesTools.appendChild(addBtn('regal-add regal-add--bar'));
    gamesSec.appendChild(addBtn('regal-add regal-add--dock'));
  }
  if (ph) gamesSec.appendChild(phOffShelf(round));
  // Die Brücke: a cyan-wired „Spiel hinzufügen" closing the toolbar (B3.2) and,
  // on a phone, the same button full width under the grid (B2.6) — one per
  // width in CSS, as Der Tisch's pair. Then the shelf ends on the one line of
  // ways off it.
  if (bruecke && activeGames.length > 0) {
    gamesTools.appendChild(addBtn('btn--sm bruecke-add bruecke-add--bar'));
    gamesSec.appendChild(addBtn('bruecke-add bruecke-add--dock'));
  }
  if (bruecke) gamesSec.appendChild(brueckeOffShelfLine(round));
  // Klassisch closed the grid with the dashed tile alone. On a big
  // shelf that is a long scroll from the only add control, so it gets Der
  // Tisch's pair (#1427): a header button at 860px and up, a sticky bar above
  // the dock below. Their own `shelf-add` class, never `regal-add`: the three
  // designs above style that name, and a bare rule on it in styles.css would
  // reach theirs. An EMPTY shelf takes neither — its empty state carries the add.
  if (!composed && activeGames.length > 0) {
    gamesTools.appendChild(addBtn('btn--sm shelf-add shelf-add--bar'));
    gamesSec.appendChild(addBtn('shelf-add shelf-add--dock'));
  }
  if (oceanAdds) {
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

// A Programmheft card (#1373, P3.3/P6.2): the running number and the meta line
// ABOVE the cover, the title, who owns it and the score UNDER it — nothing is
// printed on the cover, which P1 forbids. The score is the pill's own figure and
// evidence, set as a display numeral in its ramp tone rather than as a badge.
// The number is filled by renderGames, which knows the order on the page.
function phCard(round, g, fallback, score, evidence, expBadge) {
  const owners = ownerNames(round, g.ownerIds);
  const scored = score !== null;
  const scoreAttrs = scored ? ` data-stop="${scoreStop(score)}" title="${esc(evidence)}"` : '';
  return h(`<a class="game-card game-card--clickable ph-card">
       <div class="ph-card__kicker"><span class="ph-card__nr"></span>${cardMeta(g)}${expBadge}</div>
       <div class="game-card__img">${fallback}
         <span class="game-card__pick" aria-hidden="true"><i class="ti ti-check"></i></span>
       </div>
       <div class="game-card__body">
         <div class="ph-card__text">
           <div class="game-card__title">${esc(g.title)}</div>
           ${owners.length ? `<div class="ph-card__owner">${esc(t('detail.owners', { names: owners.join(', ') }))}</div>` : ''}
         </div>
         <span class="ph-card__score${scored ? '' : ' ph-card__score--none'}"${scoreAttrs}>${esc(scored ? fmtAvg(displayScore(score)) : t('games.scoreNew'))}</span>
       </div>
     </a>`);
}

// The phone's „…" (P6.2): the two toolbar actions that do not fit a 390px row,
// „Auswählen" and the BGG import. The toolbar keeps both as buttons, and CSS
// shows either them or this — one per width.
function phMoreButton(round, selectBtn) {
  const btn = h(`<button type="button" class="btn regal-more" aria-label="${esc(t('detail.moreActions'))}" aria-expanded="false"><i class="ti ti-dots" aria-hidden="true"></i></button>`);
  const items = [{ icon: 'ti-checkbox', label: t('bulk.select'), kind: 'undoable', run: () => selectBtn.click() }];
  if (canImportBgg()) items.push({ icon: 'ti-download', label: t('bggImport.tile'), kind: 'undoable', run: () => showBggImport(round) });
  btn.addEventListener('click', () => {
    openPopover(btn, (el, close) => fillMenu(el, items, close), () => btn.setAttribute('aria-expanded', 'false'));
    btn.setAttribute('aria-expanded', 'true');
  });
  return btn;
}

// Das Programmheft's end of the shelf (P3.3: „Nicht im Regal" as a line of
// links under a rule; P6.2: the same four as 44px rows). One list, laid out per
// width; the entries and their counted labels come from off-shelf.js.
function phOffShelf(round) {
  const wrap = h(`<nav class="ph-offshelf" aria-labelledby="phOffShelfLabel">
      <h2 class="ph-offshelf__label" id="phOffShelfLabel">${esc(t('rail.archive'))}</h2>
      <ul class="ph-offshelf__list"></ul>
    </nav>`);
  const list = wrap.querySelector('ul');
  offShelfEntries(round).forEach(({ label, sub, go }) => {
    const li = h(`<li><a class="ph-offshelf__link"><span>${esc(label)}</span><i class="ti ti-chevron-right" aria-hidden="true"></i></a></li>`);
    navLink(li.querySelector('a'), roundPath(round.id, sub), go);
    list.appendChild(li);
  });
  return wrap;
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
