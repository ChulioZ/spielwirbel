/* Spielwirbel – views: the session setup's pot — the live preview of what the
   draw will pick from (the tile panel and the compact strip), the custom-tag
   section of the filter, and „Wer hat seine Spiele nicht dabei?". Split out of
   showStartSession (#1543, the #968 shape).

   Every function here takes the setup screen's one context object, `setup`,
   built once by showStartSession (views-session.js) — see its comment there.
   The Maps, Sets and objects in it are the screen's live state and are mutated
   IN PLACE by the controls, so destructuring them is safe; the one field that
   is reassigned, `setup.filterPanel`, is always read through `setup`. Part of
   the frontend; all files share one global script scope. */

function setupPoolPreview(setup) {
  const { form, activeGames, selectedTags, tagFilterState, tableState, metaFilters,
    joining, guests, playerCount, shelfSeats, tisch, ocean, bruecke, ph, forest } = setup;
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
  const anyFilterActive = () => selectedTags.size > 0 || countMetadataFilters(metaFilters) > 0;
  // Split into a declaration and an attribute builder so a game with NO cover
  // emits no `style` attribute at all rather than an empty one. Variadic because
  // a pre-baked `style="…"` cannot be merged with a second one; it carried the
  // whirl's per-cover delay alongside the cover until #1122.
  const coverDecl = (g, w) => (g.image ? `background-image:url('${coverUrl(g.image, w)}')` : '');
  // Das Programmheft lists the pot by name and playtime (P4.1, P2.2), so its
  // tile carries the playtime as a line of its own; a game without one prints
  // none rather than an empty cell.
  const phPlaytime = (g) => {
    const time = playtimeText(g);
    return time ? `<span class="pool-tile__meta">${esc(time)}</span>` : '';
  };
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
    + `<span class="pool-count__label">${esc(ocean
      ? tn(n, 'startSession.potLabelOceanOne', 'startSession.potLabelOcean')
      : forest
        ? tn(n, 'startSession.potLabelForestOne', 'startSession.potLabelForest')
      : bruecke
        ? tn(n, 'startSession.potLabelBrueckeOne', 'startSession.potLabelBruecke')
        : tn(n, 'startSession.potLabelOne', 'startSession.potLabel'))}</span></span>`;
  /* Der Tisch's first motion ritual (#1200, T10.1): a game that ENTERS the pot
     is thrown in from outside, staggered. Only an entering one — the first
     render records what is already there and throws nothing, because a screen
     arriving in motion reads as one still loading (#1122); after that, a seat
     tap or a loosened filter that adds games throws exactly those. The index is
     all this writes: the stagger, its cap and the five directions live in
     tisch.css beside the pot, so dropping the ritual is one block there and
     this. Klassisch never gets a mark, so its markup is what it was. */
  /* Das Programmheft's second (#1382, P10.2) shares the gate exactly — the
     first paint is still here too (operator decision at the PR, against the
     sheet's set-the-whole-pot end frame) — and only the presentation differs:
     its entering rows get `is-set` and a stagger index capped at 9 instead of
     the throw's mark and direction, and the rows are SET in from the left
     (programmheft.css). Die Brücke's B10.2 (#1248) takes the same gate and the
     same `is-set` mark — its titles drive in from below (bruecke.css) — and so
     does Forest's F10.2 (#1476): its covers drop onto the stump (forest.css). */
  const setLook = ph || bruecke || forest;
  let potSeen = null;
  const potThrows = (games) => {
    const marks = new Map();
    if ((tisch || setLook) && potSeen) games.forEach((g) => { if (!potSeen.has(g.id)) marks.set(g.id, marks.size); });
    potSeen = new Set(games.map((g) => g.id));
    return marks;
  };
  const throwClass = (marks, g) => (marks.has(g.id) ? (setLook ? ' is-set' : ' is-thrown') : '');
  const throwAttr = (marks, g) => (marks.has(g.id) && !setLook ? ` data-throw="${marks.get(g.id) % 5}"` : '');
  const throwDecl = (marks, g) => (!marks.has(g.id) ? ''
    : setLook ? `--set-i:${Math.min(marks.get(g.id), 9)}` : `--throw-i:${marks.get(g.id)}`);
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
    barSummary.textContent = forest
      ? forestDrawSummary(joining.size + guests.length, games.length, parseInt(form.querySelector('#count').value, 10))
      : tisch || ocean || bruecke || ph
      ? tischDrawSummary(joining.size + guests.length, games.length, parseInt(form.querySelector('#count').value, 10))
      : tn(joining.size + guests.length, 'startSession.tableCountOne', 'startSession.tableCount') + ' · ' + headline;

    // Tile panel (860px up). An empty pool needs its own line: a grid with no
    // tiles reads as a broken panel rather than as "nothing matches yet".
    // Die Brücke counts the numeral to its new value (B10.2, #1248). What the
    // old numeral SHOWS is read before it is replaced, so a count that changes
    // mid-run carries on from where it stands; the first render has none.
    const shownBefore = bruecke ? poolTitle.querySelector('.pool-count') : null;
    poolTitle.innerHTML = potCount(games.length);
    if (shownBefore) brueckeCountPool(poolTitle.querySelector('.pool-count'), Number(shownBefore.textContent), games.length);
    poolGrid.innerHTML = games.length
      ? games
          .map(
            (g) => `<span class="pool-tile${throwClass(marks, g)}"${throwAttr(marks, g)}${styleAttr(throwDecl(marks, g))} title="${esc(g.title)}">
                 <span class="pool-tile__img"${styleAttr(coverDecl(g, COVER_CARD))}>${coverPlaceholder(g)}</span>
                 <span class="pool-tile__name">${esc(g.title)}</span>${ph ? phPlaytime(g) : ''}
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
        if (setup.filterPanel) setup.filterPanel.reset();
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
    if (setup.filterPanel) setup.filterPanel.sync();
    if (ocean) paintOceanCount(form);
    if (forest) paintForestCount(form);
    fitSetupPool(form);
  };
  return { pool, update: updateHint };
}

function buildSetupTagSection(setup, updateHint, syncFilterBar) {
  const { round, selectedTags, tagFilterState } = setup;
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
  return tagSection;
}

function buildSetupShelfField(setup, onChange) {
  const { round, activeGames, joining, awayShelves } = setup;
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
          onChange();
        });
        return chip;
      }));
    };
    refreshShelfChips();
  }
  return { field: shelfField, refresh: refreshShelfChips };
}
