/* Spielwirbel – views: Der Tisch's SEARCH-FIRST add-game step (#1264, T3.5
   desktop / T6.4 phone). Loaded after views-round-lookup.js; shares one global
   script scope.

   Klassisch never reaches this file: showAddGame (views-round-lookup.js) asks
   for Der Tisch or Ocean (#1212, O3.5/O6.4 draw the same search-first step;
   ocean.css styles it) and sends every other design straight to the form. Under
   Der Tisch the sheet opens on a query field with a hit count, lists the hits
   as rows that each carry their own state — „Im Regal", „Auf der Wunschliste",
   or an add button — and offers two ways out below: the BGG collection import
   and „Selbst eintragen", which is today's form with the query handed over.

   A hit's add button adds the game DIRECTLY: the same detail hop and the same
   POST the form sends after a pick followed by „Speichern", with the form's own
   defaults for anything the provider leaves out. Tags, owners beyond the seat's
   preset and an edition cover are set afterwards on the Spielepass, where every
   one of them is also editable — the operator question in the PR records this
   as the default taken, and the form-first alternative.

   Deliberately NOT a combobox. The dropdown (attachLookup, lookup.js) is an APG
   listbox popup whose options are never tab stops; a result LIST that stays on
   the sheet is ordinary content, so each add button is a real button in the tab
   order, the list is a plain <ul>, and Escape belongs to the sheet alone — there
   is no popup to close first (.claude/rules/lookup-menu-keyboard-combobox.md). */

'use strict';

function showAddGameSearch(round, { wish = false } = {}) {
  const sheetTitle = wish ? t('addGame.wishTitle') : t('addGame.title');
  const back = wish ? () => showWishlist(round.id) : () => showRound(round.id, 'regal');
  // The Regal tile's short label, as T3.5 draws it: the long one wraps to three
  // lines in half a 390px row.
  const importLabel = wish ? t('bggImport.wishTile') : t('bggImport.tile');
  const backdrop = h(`<div class="sheet-backdrop">
      <div class="sheet add-search" role="dialog" aria-modal="true" aria-label="${esc(sheetTitle)}">
        <div class="sheet__head">
          <h2>${esc(sheetTitle)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="add-search__query">
          <i class="ti ti-search" aria-hidden="true"></i>
          <input id="addSearchQ" class="add-search__input" type="search" enterkeyhint="search" autocomplete="off"
                 aria-label="${esc(t('addGame.searchLabel'))}" placeholder="${esc(t('addGame.titlePlaceholder'))}" />
          <span class="add-search__count" id="addSearchCount" role="status" aria-live="polite" aria-atomic="true"></span>
        </div>
        <div class="add-search__msg" id="addSearchMsg" role="status" aria-live="polite" aria-atomic="true"></div>
        <ul class="add-search__list" aria-label="${esc(t('lookup.suggestions'))}"></ul>
        <div class="add-search__ways">
          ${canImportBgg() ? `<button type="button" class="btn add-search__way" id="addSearchImport"><i class="ti ti-cards" aria-hidden="true"></i> ${esc(importLabel)}</button>` : ''}
          <button type="button" class="btn add-search__way" id="addSearchSelf"><i class="ti ti-pencil" aria-hidden="true"></i> ${esc(t('addGame.selfEntry'))}</button>
        </div>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  // A wish moved onto the shelf from a row keeps the sheet open, so the screen
  // behind is only re-rendered when the sheet is dismissed — the form's own
  // rule (#34).
  let addedWhileOpen = false;
  const dismiss = () => closeSheet(addedWhileOpen ? back : undefined);
  const onKey = (e) => {
    if (e.key === 'Escape') dismiss();
  };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) dismiss();
  });
  sheet.querySelector('.sheet__close').addEventListener('click', dismiss);

  const input = sheet.querySelector('#addSearchQ');
  const count = sheet.querySelector('#addSearchCount');
  const msg = sheet.querySelector('#addSearchMsg');
  const list = sheet.querySelector('.add-search__list');

  // Both ways out REPLACE this sheet (openSheet reuses the history marker), so
  // Back still dismisses exactly one sheet — never a leading closeSheet() here
  // (.claude/rules/sheet-history-back-dismissal.md §2).
  const importBtn = sheet.querySelector('#addSearchImport');
  if (importBtn) importBtn.addEventListener('click', () => showBggImport(round, wish ? 'wishlist' : 'own'));
  sheet.querySelector('#addSearchSelf').addEventListener('click', () =>
    showAddGameForm(round, { wish, title: input.value.trim(), dirty: addedWhileOpen }));

  // The round's games as this sheet has changed them (a wish moved onto the
  // shelf), which is what the row state is read from. A local copy rather than
  // edits to `round`, the caller's cached object.
  const localGames = (round.games || []).map((g) => Object.assign({}, g));
  const gamesNow = () => localGames;
  let rows = [];

  // Both live regions stay in the tree and only their CONTENT changes, so
  // every change is announced (.claude/rules/accessibility-contrast-and-modals.md §4).
  // A failure (`icon` given) is T15b's card: an aria-hidden icon disc above
  // the line, so the announced text is the same words either way (#1281).
  function setStatus(text, hits, icon) {
    msg.classList.toggle('is-fail', !!icon);
    if (icon) {
      msg.replaceChildren(
        h(`<span class="sheet-disc" aria-hidden="true"><i class="ti ${icon}"></i></span>`),
        h(`<p>${esc(text)}</p>`));
    } else {
      msg.textContent = text || '';
    }
    count.textContent = hits;
  }

  function stateLabel(state) {
    if (state === 'shelf') return t('addGame.row.stateShelf');
    if (state === 'wish') return t('addGame.row.stateWish');
    if (state === 'archived') return t('addGame.row.stateArchived');
    return '';
  }

  // A row offers its add button unless the game is already where this sheet
  // would put it: on the shelf, or — for a wish — on the shelf or the list.
  // An archived game keeps the button: adding it is what the form allows today.
  // A WISHED game on the shelf variant offers „Ins Regal" instead, which moves
  // that very game over (operator decision 2026-09-24) — adding it would leave
  // the round holding it twice, once on each list.
  const held = (state) => state === 'shelf' || (wish && state === 'wish');
  const shelvable = (state) => !wish && state === 'wish';

  function renderRows() {
    list.replaceChildren(...rows.map((hit) => {
      const state = hitShelfState(gamesNow(), hit);
      const meta = [hit.year, providerLabelShort(hit.provider)].filter(Boolean).join(' · ');
      const cover = hit.thumbnail
        ? `<img src="${esc(hit.thumbnail)}" alt="" loading="lazy" />`
        : coverPlaceholder({ title: hit.title });
      const heldLabel = state === 'shelf' ? t('addGame.row.inShelf') : t('addGame.row.onList');
      // The held badge is aria-hidden: the state line beside the title already
      // says the same words, and a screen reader should hear them once.
      const act = held(state)
        ? `<span class="add-search__held" aria-hidden="true"><i class="ti ti-check"></i><span class="add-search__act-label">${esc(heldLabel)}</span></span>`
        : shelvable(state)
          ? `<button type="button" class="btn btn--primary add-search__shelve" aria-label="${esc(t('addGame.row.shelveNamed', { title: hit.title }))}"><i class="ti ti-cards" aria-hidden="true"></i><span class="add-search__act-label">${esc(t('wish.restore'))}</span></button>`
          : `<button type="button" class="btn btn--primary add-search__add" aria-label="${esc(t('addGame.row.addNamed', { title: hit.title }))}"><i class="ti ti-plus" aria-hidden="true"></i><span class="add-search__act-label">${esc(t('addGame.row.add'))}</span></button>`;
      const li = h(`<li class="add-search__row${held(state) ? ' is-held' : ''}">
          <span class="add-search__cover">${cover}</span>
          <span class="add-search__text">
            <span class="add-search__title">${esc(hit.title)}</span>
            ${meta ? `<span class="add-search__meta">${esc(meta)}</span>` : ''}
            ${state ? `<span class="add-search__state">${esc(stateLabel(state))}</span>` : ''}
          </span>
          ${act}
        </li>`);
      // „Hinzufügen" opens the form filled from this hit (operator decision
      // 2026-09-24): a hit is a starting point, so tags, owners and the edition
      // cover can be set before anything is stored. It REPLACES this sheet, the
      // same way „Selbst eintragen" does.
      const add = li.querySelector('.add-search__add');
      if (add) add.addEventListener('click', () => showAddGameForm(round, { wish, hit, dirty: addedWhileOpen }));
      const shelve = li.querySelector('.add-search__shelve');
      if (shelve) shelve.addEventListener('click', () => shelveWish(hit, shelve));
      return li;
    }));
  }

  // „Ins Regal" on a wished hit: the wishlist's own action on the game the hit
  // matched (views-archive.js), including its road for a wished EXPANSION, which
  // becomes an entry on its base game rather than a game of its own.
  async function shelveWish(hit, btn) {
    const g = localGames.find((x) => x.wish && x.source && x.source.provider === hit.provider
      && String(x.source.externalId) === String(hit.providerId));
    if (!g) return;
    const moved = () => {
      g.wish = false;
      addedWhileOpen = true;
      renderRows();
      input.focus();
    };
    if (Array.isArray(g.expansionOf)) return acquireWishedExpansion(round, g, moved);
    btn.disabled = true;
    try {
      await api('POST', `/api/rounds/${round.id}/games/${g.id}/wish`, { wish: false });
    } catch (e) {
      btn.disabled = false;
      return toast(e.message, { tone: 'error' });
    }
    toast(t('wish.restored', { title: g.title }));
    // The re-render swaps the button for the held badge, so the focus it had
    // would fall to <body>. Land it on the query instead.
    moved();
  }

  let timer;
  let seq = 0; // a newer query supersedes an in-flight one
  function runSearch(q) {
    const mine = ++seq;
    setStatus(t('lookup.searching'), '');
    searchAllProviders(round.id, q, ({ rows: ranked, pending, anyFulfilled }) => {
      if (mine !== seq) return;
      rows = ranked;
      renderRows();
      if (ranked.length) {
        setStatus(pending > 0 ? t('lookup.loadingMore') : '',
          tn(ranked.length, 'addGame.hitsOne', 'addGame.hitsOther', { n: ranked.length, provider: providerLabelShort(ranked[0].provider) }));
      } else if (pending > 0) {
        setStatus(t('lookup.searching'), '');
      } else {
        setStatus(anyFulfilled ? t('lookup.noResults') : t('lookup.error'), '',
          anyFulfilled ? 'ti-search' : 'ti-alert-triangle');
      }
    });
  }
  function idle() {
    seq++;
    rows = [];
    list.replaceChildren();
    setStatus(t('addGame.searchHint'), '');
  }
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return idle();
    timer = setTimeout(() => runSearch(q), 300);
  });
  // The phone keyboard's „Suchen" key: search now rather than after the pause.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length >= 2) runSearch(q);
  });

  idle();
  input.focus();
}
