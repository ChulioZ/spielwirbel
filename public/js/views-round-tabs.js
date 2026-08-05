/* Spielwirbel – views: the round hub's non-Start tabs — Regal (games library),
   Chronik (session history), Pokale (trophies) and the two archive screens
   (retired / completed games).
   Loaded after views-round.js; shares one global script scope. */

// --- Regal tab: the games library — search, filter chips, cover grid.
function renderRegalTab(round, activeGames) {
  const rid = round.id;

  // Filters (and sort) persist for the session but are scoped to one round —
  // opening a different round's Regal resets them to defaults.
  if (regalFiltersRid !== round.id) {
    regalFilters = { tags: new Map(), query: '' };
    gamesSort = 'avg';
    regalFiltersRid = round.id;
  }

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
    if (canImportBgg(round)) grid.appendChild(importTile);
    gamesSec.appendChild(grid);
  } else {
    if (canImportBgg(round)) {
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
    // exclude, where included tags combine with AND and excluded tags reject a
    // game carrying any of them. Ids of since-deleted tags are pruned from the
    // persisted map so they can't invisibly filter everything out.
    const roundTags = round.tags || [];
    const tagFilter = regalFilters.tags;
    [...tagFilter.keys()].forEach((x) => { if (!roundTags.some((tg) => tg.id === x)) tagFilter.delete(x); });
    if (roundTags.length) {
      // Below 860px the chips are collapsed behind a "Filter" button so the cover
      // grid stays visible; from 860px up they show inline as before. The
      // phone-vs-wide switch is purely CSS (scoped to `.regal-filter`, since the
      // `.filter-chips` class is shared with the game-detail/add-game/session tag
      // pickers) — the JS only toggles the `is-open` class and keeps the badge in
      // sync. (#349)
      const filterWrap = h('<div class="regal-filter"></div>');
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
      roundTags.forEach((tg) => {
        const chip = h('<button class="chip"></button>');
        paintTagChip(chip, tg.name, tagFilter.get(tg.id), tg.icon);
        chip.addEventListener('click', () => {
          paintTagChip(chip, tg.name, cycleTagState(tagFilter, tg.id), tg.icon);
          syncFilterBadge();
          renderGames();
        });
        chips.appendChild(chip);
      });
      syncFilterBadge();
      filterWrap.appendChild(toggle);
      filterWrap.appendChild(chips);
      gamesSec.appendChild(filterWrap);
    }

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
      if (!matchesTagFilter(tagFilter, g.tagIds)) return false;
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

  // Quiet footer: the ways into the two archives — retired ("Aussortiert") and
  // completed ("Durchgespielt", #250). Both take a game out of the active
  // collection; they are kept apart because the reason differs.
  const retiredGames = round.games.filter((g) => g.retired);
  const completedGames = round.games.filter((g) => g.completed);
  const foot = h('<div class="round-footer rail-owned"></div>');
  const retiredBtn = h(`<a class="link-btn"><i class="ti ti-trash" aria-hidden="true"></i> ${esc(t('retired.link', { n: retiredGames.length }))}</a>`);
  navLink(retiredBtn, roundPath(round.id, 'retired'), () => showRetired(round.id));
  foot.appendChild(retiredBtn);
  const completedBtn = h(`<a class="link-btn"><i class="ti ti-circle-check" aria-hidden="true"></i> ${esc(t('completed.link', { n: completedGames.length }))}</a>`);
  navLink(completedBtn, roundPath(round.id, 'completed'), () => showCompleted(round.id));
  foot.appendChild(completedBtn);
  // "Spiele verschieben" and "Einladen" used to sit here too. Neither is a shelf
  // concern — one consolidates two rounds, the other shares the round — and both
  // were findable only by scrolling past the whole game grid, so they moved to
  // the round's Einstellungen screen (#561).
  app.appendChild(foot);
}

// Move games of this round into another of the user's rounds (#253), either the
// whole shelf or a selection (#402). The target list is fetched BEFORE the sheet
// opens, so it never renders an empty picker or a loading state — a user with
// only this one round gets a plain explanation instead.
async function showMoveGames(round) {
  let rounds;
  try {
    rounds = await fetchRoundList({ rerender: false });
  } catch (e) {
    toast(e.message);
    return;
  }
  const others = rounds.filter((r) => r.id !== round.id);
  const n = round.games.length;

  // Archived games move too, so they are listed — but labelled, since they are
  // invisible on the Regal the user is looking at and would otherwise be a
  // surprise in the count.
  const stateOf = (g) => (g.retired ? t('retired.crumb') : g.completed ? t('completed.crumb') : '');

  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(t('moveGames.title'))}">
        <div class="sheet__head">
          <h2>${esc(t('moveGames.title'))}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        ${others.length
          ? `<p class="muted">${esc(tn(n, 'moveGames.introOne', 'moveGames.intro'))}</p>
             <div class="field">
               <label for="moveTarget">${esc(t('moveGames.pick'))}</label>
               <select id="moveTarget" class="input">
                 ${others.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}
               </select>
             </div>
             <div class="move-picker">
               <div class="move-list__head">
                 <span id="moveCount" class="muted" aria-live="polite"></span>
                 <button id="moveToggle" type="button" class="link-btn"></button>
               </div>
               <div class="ds-list move-list" role="group" aria-label="${esc(t('moveGames.games'))}">
                 ${round.games.map((g) => {
    const state = stateOf(g);
    return `<label class="ds-row move-row">
                     <div class="ds-row__main">
                       <span class="move-row__name" title="${esc(g.title)}">${esc(g.title)}</span>
                       ${state ? `<span class="muted move-row__state">${esc(state)}</span>` : ''}
                     </div>
                     <div class="ds-row__meta">
                       <input type="checkbox" class="provider-row__box" value="${esc(g.id)}" checked />
                     </div>
                   </label>`;
  }).join('')}
               </div>
             </div>
             <div class="toolbar sheet__actions">
               <button id="moveGo" class="btn btn--primary btn--lg"><i class="ti ti-arrow-right" aria-hidden="true"></i> ${esc(t('moveGames.submit'))}</button>
             </div>`
          : `<p class="muted">${esc(t('moveGames.empty'))}</p>`}
      </div>
    </div>`);
  const form = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  form.querySelector('.sheet__close').addEventListener('click', closeSheet);

  const go = form.querySelector('#moveGo');
  if (!go) return;

  const boxes = [...form.querySelectorAll('.move-row input')];
  const countEl = form.querySelector('#moveCount');
  const toggle = form.querySelector('#moveToggle');
  const picked = () => boxes.filter((b) => b.checked).map((b) => b.value);
  // The toggle offers whichever action is still available: "select all" once
  // anything is unchecked, "clear" while everything is on.
  const sync = () => {
    const sel = picked().length;
    countEl.textContent = tn(sel, 'moveGames.selectedOne', 'moveGames.selected');
    toggle.textContent = sel === boxes.length ? t('moveGames.selectNone') : t('moveGames.selectAll');
    go.disabled = sel === 0;
  };
  boxes.forEach((b) => b.addEventListener('change', sync));
  toggle.addEventListener('click', () => {
    const all = picked().length === boxes.length;
    boxes.forEach((b) => { b.checked = !all; });
    sync();
  });
  sync();

  go.addEventListener('click', async () => {
    const select = form.querySelector('#moveTarget');
    const targetId = select.value;
    const targetName = (others.find((r) => r.id === targetId) || {}).name || '';
    const ids = picked();
    if (!ids.length) return;
    // Only warn about history when a selected game actually carries any: a
    // shelf-tidying move of never-played games loses nothing, and a warning
    // that cries wolf gets clicked through.
    const chosen = new Set(ids);
    const touchesHistory = (round.sessions || []).some((s) => (s.gameIds || []).some((x) => chosen.has(x)));
    const msg = touchesHistory
      ? tn(ids.length, 'moveGames.confirmOne', 'moveGames.confirm', { round: targetName })
      : tn(ids.length, 'moveGames.confirmPlainOne', 'moveGames.confirmPlain', { round: targetName });
    if (!confirm(msg)) return;
    go.disabled = true;
    try {
      // Send the explicit selection even when everything is checked — the count
      // the user just confirmed is then exactly what the server moves, with no
      // "all" shortcut that could pick up a game added from another device
      // since the sheet opened.
      const res = await api('POST', `/api/rounds/${round.id}/games/move-to`, { targetRoundId: targetId, gameIds: ids });
      toast(tn(res.movedGames, 'moveGames.toast.doneOne', 'moveGames.toast.done'));
      closeSheet(() => showRound(round.id, 'regal'));
    } catch (e) {
      go.disabled = false;
      const msg2 =
        e.message === 'quota_games' ? t('moveGames.toast.quotaGames')
          : e.message === 'quota_tags' ? t('moveGames.toast.quotaTags')
            : e.message;
      toast(msg2);
    }
  });
}

// Invite an account to share this round (#207). The OWNER fixes the seat here —
// take over a specific user-less member, or create a fresh one — so the invitee
// can't pick the wrong person. Accounts mode only (the entry points gate on
// accountsActive(); the route 404s otherwise). A grantee who somehow reaches this
// fails safely: the send route 404s a round they don't own.
async function showInvite(round) {
  const rid = round.id;
  const freeSeats = (round.members || []).filter((m) => !m.userId);

  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(t('invite.title'))}">
        <div class="sheet__head">
          <h2>${esc(t('invite.title'))}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <p class="muted">${esc(t('invite.intro', { round: round.name }))}</p>
        <div class="field">
          <label for="inviteUser">${esc(t('invite.username'))}</label>
          <input id="inviteUser" class="input" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(t('invite.usernamePlaceholder'))}">
        </div>
        <div class="field">
          <label for="inviteSeat">${esc(t('invite.seat'))}</label>
          <select id="inviteSeat" class="input">
            <option value="">${esc(t('invite.newMember'))}</option>
            ${freeSeats.map((m) => `<option value="${esc(m.id)}">${esc(t('invite.takeOver', { name: m.name }))}</option>`).join('')}
          </select>
        </div>
        <div class="toolbar sheet__actions">
          <button id="inviteGo" class="btn btn--primary btn--lg"><i class="ti ti-mail" aria-hidden="true"></i> ${esc(t('invite.submit'))}</button>
        </div>
      </div>
    </div>`);
  const form = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  // Synchronous, and after openSheet: iOS only raises the soft keyboard for a
  // focus() inside the opening gesture, and trapFocus captures the pre-open
  // activeElement as its restore target. Don't defer this into a timeout.
  form.querySelector('#inviteUser').focus();
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  form.querySelector('.sheet__close').addEventListener('click', () => closeSheet());

  const go = form.querySelector('#inviteGo');
  go.addEventListener('click', async () => {
    const username = form.querySelector('#inviteUser').value.trim();
    const memberId = form.querySelector('#inviteSeat').value || null;
    if (!username) { form.querySelector('#inviteUser').focus(); return; }
    go.disabled = true;
    try {
      await accountApi('POST', '/invitations', { roundId: rid, username, memberId });
      toast(t('invite.toast.sent', { user: username }));
      closeSheet();
    } catch (e) {
      go.disabled = false;
      toast(inviteError(e.message));
    }
  });
  form.querySelector('#inviteUser').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      go.click();
    }
  });

  // The Freundeskreis picker (#466) is fetched only AFTER the sheet is up:
  // typing a username must never wait on a network call. A failed fetch simply
  // leaves the picker out — the username field is the whole feature without it,
  // and accountApi already handles a dead session itself. The sheet may be gone
  // (or replaced) by the time this resolves, hence the isConnected check.
  try {
    const { friends } = await accountApi('GET', '/friends');
    if (backdrop.isConnected) insertFriendPicker(form, round, friends);
  } catch { /* no picker; inviting by username is unaffected */ }
}

// Offer the caller's accepted friends above the username field (#466), so an
// owner doesn't have to remember a handle they saw once in another view.
// Dropped: friends already holding a seat here (they would only ever produce
// `already_member`) and any whose username didn't resolve (nothing to address).
// When that leaves nothing, no field is inserted at all — the sheet then looks
// exactly as it did before. Inserting after openSheet is safe for the focus
// trap: focusables() is recomputed on every Tab, so the select joins the tab
// order at its DOM position (focus-trap.js).
function insertFriendPicker(form, round, friends) {
  const seated = new Set((round.members || []).map((m) => m.userId).filter(Boolean));
  const eligible = (friends || []).filter((f) => f.username && !seated.has(f.userId));
  if (!eligible.length) return;

  const field = h(`<div class="field">
      <label for="inviteFriend">${esc(t('invite.friendLabel'))}</label>
      <select id="inviteFriend" class="input">
        <option value="">${esc(t('invite.friendPick'))}</option>
        ${eligible.map((f) => `<option value="${esc(f.username)}">${esc(f.username)}</option>`).join('')}
      </select>
    </div>`);

  const user = form.querySelector('#inviteUser');
  user.closest('.field').before(field);
  // Fill the input rather than replacing it: it stays editable, so a non-friend
  // can still be invited by hand and the submit path reads one field as before.
  field.querySelector('#inviteFriend').addEventListener('change', (e) => {
    if (e.target.value) user.value = e.target.value;
  });
}

// Map a send-route error code to a localized message.
function inviteError(code) {
  const map = {
    user_not_found: 'invite.err.userNotFound',
    cannot_invite_self: 'invite.err.self',
    already_member: 'invite.err.alreadyMember',
    already_invited: 'invite.err.alreadyInvited',
    invalid_seat: 'invite.err.seatGone',
    seat_taken: 'invite.err.seatTaken',
    round_not_found: 'invite.err.roundGone',
  };
  return t(map[code] || 'invite.err.generic');
}

// --- Chronik tab: one timeline of sessions and shelf changes. The activity
// feed arrives as its own argument (fetched per visit by showRound, #197) —
// it is no longer part of the round payload.
// The timeline's visual tiers (#633). Keyed on the event TYPE, never on the icon
// class the row happens to render: `ti-trash` is `game_retired` AND
// `game_deleted`, so an icon-based match would wash a deletion as a milestone.
// Everything not listed here keeps the neutral middle tier — a move, an import,
// a new seat and a rename are bookkeeping, not moments in the round's history.
const CHRONIK_MILESTONES = ['game_retired', 'game_completed', 'game_restored', 'game_uncompleted'];
const chronikTier = (type) =>
  CHRONIK_MILESTONES.includes(type) ? 'milestone' : type === 'game_added' ? 'add' : '';

function renderChronikTab(round, activities) {
  const rid = round.id;
  const loadCover = createCoverLoader(); // lazy session thumbs (#198)

  // Collect all entries: done sessions as cards, game activities as quiet rows.
  const entries = [];
  round.sessions
    .filter((s) => s.done)
    .forEach((s) => entries.push({ kind: 'session', at: s.createdAt, session: s }));
  (activities || []).forEach((a) => {
    const meta = {
      game_added: { icon: 'ti-plus', text: t('activity.gameAdded', { title: a.title }) },
      game_retired: { icon: 'ti-trash', text: t('activity.gameRetired', { title: a.title }) },
      game_restored: { icon: 'ti-arrow-back-up', text: t('activity.gameRestored', { title: a.title }) },
      game_completed: { icon: 'ti-circle-check', text: t('activity.gameCompleted', { title: a.title }) },
      game_uncompleted: { icon: 'ti-arrow-back-up', text: t('activity.gameUncompleted', { title: a.title }) },
      game_deleted: { icon: 'ti-trash', text: t('activity.gameDeleted', { title: a.title }) },
      // One bulk entry per side of a whole-shelf move (#253) — these carry a
      // count and the other round's name, not a game title.
      games_moved_out: { icon: 'ti-arrow-right', text: tn(a.count, 'activity.gamesMovedOutOne', 'activity.gamesMovedOut', { round: a.roundName }) },
      games_moved_in: { icon: 'ti-arrow-left', text: tn(a.count, 'activity.gamesMovedInOne', 'activity.gamesMovedIn', { round: a.roundName }) },
      // One bulk entry per collection import (#481) — a count, not a title, for
      // the same reason as the two moves above: an import is routinely 100+
      // games and a row each would bury every other event on the round.
      games_imported: { icon: 'ti-download', text: tn(a.count, 'activity.gamesImportedOne', 'activity.gamesImported') },
      // A new seat (#563) — carries the member's NAME, not a game title. Written
      // for both an added seat and an accepted invitation (#207), since either way
      // a new person is in the round.
      member_added: { icon: 'ti-user-plus', text: t('activity.memberAdded', { name: a.name }) },
      // A rename (#562) — the round's NEW name. Renaming is open to a grantee
      // (it is acting within the round, not destroying it), so this entry is how
      // an owner sees that their shared round changed name, and who did it. The
      // previous name is deliberately not stored: it would outlive a moderation
      // redaction of the round's name.
      round_renamed: { icon: 'ti-pencil', text: t('activity.roundRenamed', { name: a.name }) },
      // Owned expansions (#653) — a count plus the GAME's title, for the same
      // reason the three bulk entries above carry counts: one save can tick ten
      // boxes. A quiet row, deliberately not a CHRONIK_MILESTONES entry: adding
      // an expansion is not on the level of retiring a game.
      game_expansion_added: { icon: 'ti-puzzle', text: tn(a.count, 'activity.expansionAddedOne', 'activity.expansionAdded', { title: a.title }) },
    }[a.type];
    if (!meta) return;
    // Who did it (#207): resolve the actor's member seat to a name (like
    // winnerNames). Absent on single-actor rounds, so nothing is shown there.
    const by = a.actorMemberId && (round.members.find((m) => m.id === a.actorMemberId) || {}).name;
    entries.push({ kind: 'activity', at: a.at, id: a.id, gameId: a.gameId, type: a.type, by, ...meta });
  });
  entries.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const sec = h('<div class="section"></div>');
  sec.appendChild(h(`<div class="section-head"><h1>${esc(t('chronik.title'))}</h1></div>`));

  // Filter chips: everything / sessions only / shelf changes only.
  let filter = 'all';
  const chips = h(`<div class="filter-chips">
      <button class="chip is-on" data-f="all">${esc(t('chronik.filter.all'))}</button>
      <button class="chip" data-f="sessions"><i class="ti ti-confetti" aria-hidden="true"></i>${esc(t('chronik.filter.sessions'))}</button>
      <button class="chip" data-f="changes"><i class="ti ti-cards" aria-hidden="true"></i>${esc(t('chronik.filter.changes'))}</button>
    </div>`);
  chips.querySelectorAll('[data-f]').forEach((chip) => {
    chip.addEventListener('click', () => {
      filter = chip.dataset.f;
      chips.querySelectorAll('[data-f]').forEach((c) => c.classList.toggle('is-on', c === chip));
      renderTimeline();
    });
  });
  sec.appendChild(chips);

  const tl = h('<div class="timeline"></div>');
  sec.appendChild(tl);
  app.appendChild(sec);

  function buildSessionCard(s) {
    const when = fmtDateTime(s.createdAt);
    const chosen = s.chosenGameId && round.games.find((g) => g.id === s.chosenGameId);
    // Against the session's own people, so a guest winner is listed with its
    // marker rather than silently dropped (#458).
    const sPeople = sessionPeople(round, s);
    const winnerNames = (s.winnerIds || [])
      .map((wid) => personLabel(sPeople.find((p) => p.id === wid)))
      .filter(Boolean);

    // Thumbnail: the chosen game's cover, or an icon for the session's state.
    const thumbIcon = chosen
      ? coverPlaceholder(chosen)
      : `<i class="ti ${s.cancelled ? 'ti-x' : 'ti-cards'}" aria-hidden="true"></i>`;

    // Headline is the chosen game (with a rating pill); the date leads only
    // when no game was played. The meta line carries the rest.
    const title = chosen ? esc(chosen.title) : esc(when);
    let pill = '';
    if (chosen) {
      const sst = gameStatsForSession(round, s, chosen.id);
      if (sst.avg !== null) pill = `<span class="score-pill" style="background:${avgColor(sst.avg)}">Ø ${sst.avg.toFixed(1)}</span>`;
    }

    const parts = [];
    if (chosen) parts.push(esc(when));
    if (s.finished) parts.push(winnerNames.length ? '<i class="ti ti-trophy" aria-hidden="true"></i> ' + winnerNames.map(esc).join(', ') : iconText('ti-check', t('sessions.played')));
    else if (s.cancelled) parts.push(`<span style="color:var(--danger)">${iconText('ti-x', t('sessions.cancelled'))}</span>`);
    parts.push(esc(t('sessions.rated', { n: s.gameIds.length })));

    const card = h(`<a class="session-card">
         <div class="session-card__img">${thumbIcon}</div>
         <div class="session-card__body">
           <div class="session-card__title">${title}${pill}</div>
           <div class="session-card__meta">${parts.join(' · ')}</div>
         </div>
       </a>`);
    if (chosen && chosen.image) loadCover(card.querySelector('.session-card__img'), coverUrl(chosen.image, COVER_THUMB));
    navLink(card, resultsPath(round.id, s.id), () => showResults(round, s));
    return card;
  }

  function buildActivityRow(e) {
    // Navigate to the game (if it still exists) or to the archive.
    const gameExists = e.gameId && round.games.some((g) => g.id === e.gameId);
    const target =
      e.type === 'game_retired'
        ? { path: roundPath(rid, 'retired'), nav: () => showRetired(rid) }
        : e.type === 'game_completed'
          ? { path: roundPath(rid, 'completed'), nav: () => showCompleted(rid) }
          : gameExists
            ? { path: gamePath(rid, e.gameId), nav: () => showGameDetail(rid, e.gameId) }
            : null;
    // Only the TEXT becomes an <a> (#330): the row also holds the delete button,
    // and a <button> inside an <a> is invalid markup. So the text carries the
    // href — new tab, copy address, link semantics — while the row keeps the
    // generous click target it always had around it.
    const by = e.by ? `<span class="tl-act__by">${esc(t('activity.by', { name: e.by }))}</span>` : '';
    const tier = chronikTier(e.type);
    const row = h(`<div class="tl-act${target ? ' tl-act--link' : ''}${tier ? ` tl-act--${tier}` : ''}">
         <span class="tl-act__icon"><i class="ti ${e.icon}" aria-hidden="true"></i></span>
         ${target ? `<a class="tl-act__text">${esc(e.text)}</a>` : `<span class="tl-act__text">${esc(e.text)}</span>`}
         ${by}
         <span class="tl-act__time">${fmtDateTime(e.at)}</span>
         <button class="tl-act__del" title="${esc(t('activity.delete'))}" aria-label="${esc(t('activity.delete'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
       </div>`);
    if (target) {
      navLink(row.querySelector('.tl-act__text'), target.path, target.nav);
      row.addEventListener('click', (ev) => {
        if (ev.target.closest('.tl-act__del')) return; // delete is not "open"
        // The anchor owns its own clicks — including a Cmd/middle-click, which
        // it lets through to the browser. Navigating here too would open the
        // new tab AND move this one.
        if (ev.target.closest('.tl-act__text')) return;
        target.nav();
      });
    }
    row.querySelector('.tl-act__del').addEventListener('click', async () => {
      if (!confirm(t('activity.deleteConfirm'))) return;
      try {
        await api('DELETE', `/api/rounds/${rid}/activities/${e.id}`);
        toast(t('activity.deleted'));
        showRound(rid, 'chronik');
      } catch (err) { toast(err.message); }
    });
    return row;
  }

  // Month-grouped timeline, newest first.
  function renderTimeline() {
    tl.innerHTML = '';
    const visible = entries.filter((e) =>
      filter === 'all' ? true : filter === 'sessions' ? e.kind === 'session' : e.kind === 'activity'
    );
    if (visible.length === 0) {
      tl.appendChild(h(`<div class="muted">${esc(t('chronik.empty'))}</div>`));
      return;
    }
    let lastMonth = '';
    visible.forEach((e) => {
      const month = fmtMonth(e.at);
      if (month !== lastMonth) {
        lastMonth = month;
        tl.appendChild(h(`<div class="tl-month">${esc(month)}</div>`));
      }
      const dot = e.kind === 'session' ? ' tl-dot--session'
        : chronikTier(e.type) === 'milestone' ? ' tl-dot--milestone' : '';
      const item = h(`<div class="tl-item"><span class="tl-dot${dot}"></span></div>`);
      item.appendChild(e.kind === 'session' ? buildSessionCard(e.session) : buildActivityRow(e));
      tl.appendChild(item);
    });
  }
  renderTimeline();
  // Deleting (or leaving) the round used to end this timeline, and it was the one
  // round action with no good home at any width: unlike the Regal's footer this
  // one was not `rail-owned`, so it stayed below the whole history on desktop too,
  // while the rail carried no entry for it. It is the danger zone of the round's
  // Einstellungen screen now (#561) — deleting a round is not a history concern.
}

// --- The two stat-card builders, shared by the Pokale tab and the Rückblick
// section below it. They were closures inside renderPokaleTab until #484 gave
// them a second caller; `round` is the only thing they lost by moving out.

// One stat card. `linkMid` turns the value into a link to that
// member's page (the streak card, the one stat here that names a person).
// Without it the value stays a plain <span> on purpose: an <a> carrying no href
// is neither focusable nor styled, so emitting one unconditionally would leave
// dead markup behind for every future stat that isn't a link.
function pokaleStatCard(round, icon, label, value, sub, linkMid) {
  const card = h(`<div class="pokale-card">
       <span class="pokale-card__icon"><i class="ti ${icon}" aria-hidden="true"></i></span>
       <span class="pokale-card__label">${esc(label)}</span>
       ${linkMid ? `<a class="pokale-card__value">${esc(value)}</a>` : `<span class="pokale-card__value">${esc(value)}</span>`}
       <span class="pokale-card__sub">${esc(sub)}</span>
     </div>`);
  if (linkMid) makeMemberLink(card.querySelector('.pokale-card__value'), round.id, linkMid);
  return card;
}

// Like pokaleStatCard but the value is one or more games, each listed on its own
// row with a "Jetzt spielen" launcher (icon-only; omitted for an archived game —
// retired or completed, neither is in the active collection any more).
function pokaleGameCard(round, icon, label, games, sub) {
  const card = h(`<div class="pokale-card">
       <span class="pokale-card__icon"><i class="ti ${icon}" aria-hidden="true"></i></span>
       <span class="pokale-card__label">${esc(label)}</span>
       <span class="pokale-card__games"></span>
       <span class="pokale-card__sub">${esc(sub)}</span>
     </div>`);
  const list = card.querySelector('.pokale-card__games');
  games.forEach((g) => {
    const row = h(`<span class="pokale-game">
         <a class="pokale-game__title">${esc(g.title)}</a>
       </span>`);
    // The game name opens its detail page (archived games too — the detail
    // view supports them; only the "Jetzt spielen" launcher is omitted).
    makeGameLink(row.querySelector('.pokale-game__title'), round.id, g.id);
    if (!g.retired && !g.completed) {
      const btn = h(`<button class="pokale-game__play" title="${esc(t('directPlay.button'))}" aria-label="${esc(t('directPlay.button'))}"><i class="ti ti-player-play" aria-hidden="true"></i></button>`);
      btn.addEventListener('click', () => startDirectSession(round, g));
      row.appendChild(btn);
    }
    list.appendChild(row);
  });
  return card;
}

// Resolve stat ids back to the games they name, dropping any that no longer
// exist (recap.js already ignores deleted ids; this keeps the view honest for
// anything it is handed).
const recapGames = (round, ids) => ids.map((id) => round.games.find((g) => g.id === id)).filter(Boolean);

// --- Pokale tab: hall of fame — member podium and fun stats, all computed
// on demand from sessions (single source of truth, like the rating averages).
// The Rückblick (#484) is appended as a second section at the end.
function renderPokaleTab(round) {
  const finished = round.sessions.filter((s) => s.finished);

  const sec = h('<div class="section"></div>');
  sec.appendChild(h(`<div class="section-head"><h1>${esc(t('pokale.title'))}</h1></div>`));

  if (finished.length === 0) {
    sec.appendChild(h(`<div class="empty"><p>${esc(t('pokale.empty'))}</p></div>`));
    app.appendChild(sec);
    return;
  }

  // The group's accumulated taste, derived on demand from the session votes
  // (#484). Read here for the best-rated card and again by the Rückblick
  // section appended at the end of this tab.
  const recap = roundRecap(round, sessionPeople);

  // Wins per member (a night can have several winners). Keyed by round member,
  // so a guest win is dropped by the `wid in wins` guard below — deliberately:
  // the standings are the permanent group's leaderboard, and a one-evening
  // visitor in it would be noise (#458).
  const wins = {};
  round.members.forEach((m) => (wins[m.id] = 0));
  finished.forEach((s) =>
    (s.winnerIds || []).forEach((wid) => {
      if (wid in wins) wins[wid]++;
    })
  );
  const ranked = [...round.members].sort((a, b) => wins[b.id] - wins[a.id]);

  // Competition ranking (1224): members tied on wins share a rank, so two
  // three-win members are both rank 1 and the next best jumps to rank 3. Only
  // members who have actually won something can stand on the podium.
  const winners = ranked.filter((m) => wins[m.id] > 0);
  const rankOf = {};
  winners.forEach((m) => {
    rankOf[m.id] = winners.filter((o) => wins[o.id] > wins[m.id]).length + 1;
  });

  // Podium slots by rank: left = 2, center = 1, right = 3. A slot holds every
  // member with that rank, so a tie shows several avatars sharing one step.
  const podiumCol = (rank) => {
    const members = winners.filter((m) => rankOf[m.id] === rank);
    if (!members.length) return '';
    const avatars = members
      .map(
        (m) =>
          `<a class="avatar podium__avatar" data-mid="${esc(m.id)}" style="background:${memberColor(round, m.id)}">${esc(initials(m.name))}</a>`
      )
      .join('');
    const names = members.map((m) => esc(m.name)).join(', ');
    return `<div class="podium__col podium__col--${rank}">
             ${rank === 1 ? '<i class="ti ti-crown podium__crown" aria-hidden="true"></i>' : ''}
             <span class="podium__avatars">${avatars}</span>
             <span class="podium__name">${names}</span>
             <span class="podium__base"><span class="podium__rank">${rank}</span>${esc(tn(wins[members[0].id], 'pokale.winsOne', 'pokale.wins'))}</span>
           </div>`;
  };
  if (winners.length) {
    const podium = h(`<div class="podium">${podiumCol(2)}${podiumCol(1)}${podiumCol(3)}</div>`);
    // Each podium avatar opens that member's detail page.
    podium.querySelectorAll('.podium__avatar[data-mid]').forEach((el) => {
      makeMemberLink(el, round.id, el.dataset.mid);
    });
    sec.appendChild(podium);
  }
  // Anyone ranked below the podium's three steps drops to the summary line.
  const onPodium = new Set(winners.filter((m) => rankOf[m.id] <= 3).map((m) => m.id));
  const rest = ranked.filter((m) => !onPodium.has(m.id));
  if (rest.length) {
    const line = rest
      .map(
        (m) =>
          `<a class="podium__rest-name" data-mid="${esc(m.id)}">${esc(m.name)}</a> · ${esc(tn(wins[m.id], 'pokale.winsOne', 'pokale.wins'))}`
      )
      .join('&ensp;—&ensp;');
    const restEl = h(`<div class="muted podium__rest">${line}</div>`);
    restEl.querySelectorAll('.podium__rest-name[data-mid]').forEach((el) => {
      makeMemberLink(el, round.id, el.dataset.mid);
    });
    sec.appendChild(restEl);
  }

  const cards = h('<div class="pokale-cards"></div>');

  // Most played: chosen most often across finished nights (game must exist).
  //
  // ARCHIVED GAMES COUNT HERE, retired ones included — deliberately, and against
  // the reflex that #643 set up next door. This card is a factual record of
  // nights that happened, not a statement about the current shelf: retiring a
  // game does not unmake the evenings the group spent on it, so those sessions
  // keep counting and a retired game may still top the card (operator decision,
  // 2026-08-04). The cards that DO drop retired games — Größte Uneinigkeit and
  // Lieblingsspiele, via `retiredIds` in recap.js — are about taste, which is a
  // claim the group has withdrawn. Don't unify the two; see
  // `.claude/rules/active-games-filter-sites.md`.
  const playCount = {};
  finished.forEach((s) => {
    if (s.chosenGameId && round.games.some((g) => g.id === s.chosenGameId))
      playCount[s.chosenGameId] = (playCount[s.chosenGameId] || 0) + 1;
  });
  let maxPlays = 0;
  Object.keys(playCount).forEach((gid) => {
    if (playCount[gid] > maxPlays) maxPlays = playCount[gid];
  });
  const mostGames = Object.keys(playCount)
    .filter((gid) => playCount[gid] === maxPlays)
    .map((gid) => round.games.find((x) => x.id === gid));
  if (mostGames.length) {
    cards.appendChild(
      pokaleGameCard(round, 'ti-flame', t('pokale.mostPlayed'), mostGames, tn(maxPlays, 'home.chip.sessionsOne', 'home.chip.sessions'))
    );
  }

  // Best rated: highest overall average with a bit of data behind it; ties
  // share the tile. Computed by recap.js (#484) rather than inline, so it and
  // the Rückblick's worst-rated card below cannot drift apart on the evidence
  // threshold or on how ties are handled — they are one aggregation read twice.
  if (recap.best) {
    cards.appendChild(
      pokaleGameCard(round, 'ti-star', t('pokale.bestRated'), recapGames(round, recap.best.gameIds), `Ø ${recap.best.avg.toFixed(1)}`)
    );
  }

  // Streak: how many of the latest nights in a row one member won alone.
  // Chronological by `createdAt` (when the night happened), like the Chronik —
  // `finishedAt` moves when an old session is re-finished.
  // A night any guest won is skipped entirely (#458): a session-only visitor
  // must neither break nor extend a member's streak, and treating their win as
  // an ordinary sole win would silently blank the card (there is no member row
  // behind the id) — which is breaking it by another name.
  const wonByGuest = (s) => {
    const gids = new Set((s.guests || []).map((g) => g.id));
    return gids.size > 0 && (s.winnerIds || []).some((wid) => gids.has(wid));
  };
  const chrono = [...finished]
    .filter((s) => !wonByGuest(s))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  let streakMember = null;
  let streak = 0;
  for (let i = chrono.length - 1; i >= 0; i--) {
    const ws = chrono[i].winnerIds || [];
    if (streakMember === null) {
      if (ws.length !== 1) break;
      streakMember = ws[0];
      streak = 1;
    } else if (ws.length === 1 && ws[0] === streakMember) {
      streak++;
    } else break;
  }
  const streakM = streakMember && round.members.find((m) => m.id === streakMember);
  if (streakM && streak >= 2) {
    // The member name links to their detail page, like the podium above.
    cards.appendChild(
      pokaleStatCard(round, 'ti-bolt', t('pokale.streak'), streakM.name, t('pokale.streakN', { n: streak }), streakMember)
    );
  }

  // Gathering dust: the active game whose last night is longest ago (or never).
  const lastAt = {};
  finished.forEach((s) => {
    if (!s.chosenGameId) return;
    const at = s.createdAt;
    if (!lastAt[s.chosenGameId] || at > lastAt[s.chosenGameId]) lastAt[s.chosenGameId] = at;
  });
  const active = round.games.filter((g) => !g.retired && !g.completed);
  // Find the earliest last-played timestamp ('' = never played sorts first),
  // then pick a random game among all that tie for it, so the same game isn't
  // always highlighted.
  let dustyAt = null;
  active.forEach((g) => {
    const at = lastAt[g.id] || '';
    if (dustyAt === null || at < dustyAt) dustyAt = at;
  });
  const dustyCandidates = active.filter((g) => (lastAt[g.id] || '') === dustyAt);
  const dusty = dustyCandidates.length
    ? { g: dustyCandidates[Math.floor(Math.random() * dustyCandidates.length)], at: dustyAt }
    : null;
  if (dusty && active.length > 1) {
    cards.appendChild(
      pokaleGameCard(
        round,
        'ti-sparkles',
        t('pokale.dusty'),
        [dusty.g],
        dusty.at ? t('pokale.dustyAt', { when: fmtMonth(dusty.at) }) : t('pokale.dustyNever')
      )
    );
  }

  if (cards.children.length) sec.appendChild(cards);
  app.appendChild(sec);
  app.appendChild(renderRecapSection(round, recap));
}

/*
 * The Rückblick (#484): what a round's accumulated ratings say about the group's
 * taste, as a second section under the standings rather than a screen of its own
 * — the record belongs beside the trophies it is made of, and a surface nobody
 * navigates to is not more legible than one nobody scrolls to.
 *
 * Everything here comes from `roundRecap` (recap.js); this function only renders.
 * It always returns a section: with thin data it shows the totals plus a
 * "keep going" line, because a round two sessions in has genuinely accumulated
 * something and must not read as a broken screen.
 */
function renderRecapSection(round, recap) {
  const sec = h('<div class="section recap"></div>');
  sec.appendChild(h(`<div class="section-head"><h2>${esc(t('recap.title'))}</h2></div>`));
  sec.appendChild(h(`<p class="muted recap__lead">${esc(t('recap.lead'))}</p>`));

  const chip = (icon, text) =>
    h(`<span class="stat-chip"><i class="ti ${icon}" aria-hidden="true"></i>${esc(text)}</span>`);
  const totals = h('<div class="recap__totals"></div>');
  totals.appendChild(chip('ti-confetti', tn(recap.totals.sessions, 'home.chip.sessionsOne', 'home.chip.sessions')));
  totals.appendChild(chip('ti-cards', tn(recap.totals.games, 'home.chip.gamesOne', 'home.chip.games')));
  totals.appendChild(chip('ti-star', tn(recap.totals.ratings, 'recap.ratingsOne', 'recap.ratings')));
  // Only when there is an archive — "0 aussortiert" is noise on a young round.
  if (recap.totals.archived) totals.appendChild(chip('ti-archive', t('recap.archived', { n: recap.totals.archived })));
  sec.appendChild(totals);

  const cards = h('<div class="pokale-cards"></div>');

  if (recap.worst) {
    cards.appendChild(
      pokaleGameCard(round, 'ti-mood-empty', t('recap.worstRated'), recapGames(round, recap.worst.gameIds), `Ø ${recap.worst.avg.toFixed(1)}`)
    );
  }

  // The disagreement card names two people and a game, so it is built here
  // rather than through pokaleStatCard, which carries at most one member link.
  if (recap.divisive) {
    const game = round.games.find((g) => g.id === recap.divisive.gameId);
    const nameOf = (mid) => (round.members.find((m) => m.id === mid) || {}).name || '';
    if (game) {
      const card = h(`<div class="pokale-card">
           <span class="pokale-card__icon"><i class="ti ti-arrows-split" aria-hidden="true"></i></span>
           <span class="pokale-card__label">${esc(t('recap.divisive'))}</span>
           <a class="pokale-card__value">${esc(game.title)}</a>
           <span class="pokale-card__sub">${esc(t('recap.divisiveSub', {
             high: nameOf(recap.divisive.high.memberId),
             highAvg: recap.divisive.high.avg.toFixed(1),
             low: nameOf(recap.divisive.low.memberId),
             lowAvg: recap.divisive.low.avg.toFixed(1),
           }))}</span>
         </div>`);
      makeGameLink(card.querySelector('.pokale-card__value'), round.id, game.id);
      cards.appendChild(card);
    }
  }

  if (cards.children.length) sec.appendChild(cards);

  // Each member's own favourite, one card per person who has rated anything.
  if (recap.favourites.length) {
    const group = h(`<div class="recap__group">
         <h3 class="recap__sub">${esc(t('recap.favourites'))}</h3>
       </div>`);
    const favs = h('<div class="pokale-cards"></div>');
    recap.favourites.forEach((fav) => {
      const member = round.members.find((m) => m.id === fav.memberId);
      const game = round.games.find((g) => g.id === fav.gameId);
      if (!member || !game) return;
      const card = h(`<div class="pokale-card recap-fav">
           <span class="recap-fav__who">
             <a class="avatar" style="background:${memberColor(round, member.id)}">${esc(initials(member.name))}</a>
             <span class="recap-fav__name">${esc(member.name)}</span>
           </span>
           <a class="pokale-card__value">${esc(game.title)}</a>
           <span class="pokale-card__sub">${esc(t('recap.favSub', { avg: fav.avg.toFixed(1) }))}</span>
         </div>`);
      makeMemberLink(card.querySelector('.recap-fav__who .avatar'), round.id, member.id);
      makeGameLink(card.querySelector('.pokale-card__value'), round.id, game.id);
      favs.appendChild(card);
    });
    if (favs.children.length) {
      group.appendChild(favs);
      sec.appendChild(group);
    }
  }

  // Thin data reads as "keep going", never as an empty screen: the totals above
  // already say something real, and this says what would make it say more.
  if (!cards.children.length && !recap.favourites.length) {
    sec.appendChild(h(`<p class="muted recap__thin">${esc(t('recap.thin'))}</p>`));
  }
  return sec;
}

// =================== Archives: retired & completed games ===================
/*
 * Two parallel archive screens (#250). Both take a game out of the active
 * collection and offer the same two actions (restore / delete permanently);
 * only the wording, the icon and the flag differ — retiring means "we don't
 * want this any more", completing means "we finished it". They share one
 * renderer so the pair can't drift apart, with ARCHIVES holding everything
 * that is genuinely per-kind.
 */
const ARCHIVES = {
  retired: {
    icon: 'ti-trash',
    flag: (g) => g.retired,
    at: (g) => g.retiredAt,
    endpoint: (rid, gid) => `/api/rounds/${rid}/games/${gid}/retire`,
    body: { retired: false },
  },
  completed: {
    icon: 'ti-circle-check',
    flag: (g) => g.completed,
    at: (g) => g.completedAt,
    endpoint: (rid, gid) => `/api/rounds/${rid}/games/${gid}/complete`,
    body: { completed: false },
  },
};

const showRetired = (rid) => showArchive(rid, 'retired');
const showCompleted = (rid) => showArchive(rid, 'completed');

// `kind` keys both ARCHIVES and the i18n namespace (retired.* / completed.*),
// so the two stay in lockstep by construction.
async function showArchive(rid, kind) {
  const a = ARCHIVES[kind];
  currentView = () => showArchive(rid, kind);
  syncUrl(roundPath(rid, kind));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyBackground(round.background);
  setContext(round.name);
  // `kind` keys the i18n namespace, so both archives are covered by one line.
  setDocTitle(t(`${kind}.title`), round.name);

  // Newest first.
  const games = round.games
    .filter(a.flag)
    .sort((x, y) => String(a.at(y) || '').localeCompare(String(a.at(x) || '')));

  app.innerHTML = '';
  renderSubScreenTabs(round, kind);
  app.appendChild(backRow(() => showRound(rid, 'regal')));
  app.appendChild(
    h(`<div class="page-head"><div>
         <h1>${esc(t(`${kind}.title`))}</h1>
         <div class="muted">${esc(round.name)}</div>
       </div></div>`)
  );

  if (games.length === 0) {
    app.appendChild(h(`<div class="empty"><p>${esc(t(`${kind}.empty`))}</p></div>`));
  } else {
    const list = h('<div class="archive-list"></div>');
    const loadCover = createCoverLoader(); // lazy archive thumbs (#198)
    games.forEach((g) => {
      const fallback = coverPlaceholder(g);
      const when = a.at(g) ? fmtDateTime(a.at(g)) : '?';
      const row = h(`<div class="archive-row">
           <div class="archive-row__img">${fallback}</div>
           <div class="archive-row__body">
             <div class="archive-row__title">${esc(g.title)}</div>
             <div class="muted archive-row__meta"><i class="ti ${a.icon}" aria-hidden="true"></i> ${esc(t(`${kind}.at`, { when }))}</div>
           </div>
           <div class="archive-row__actions">
             <button class="btn" data-act="restore"><i class="ti ti-arrow-back-up" aria-hidden="true"></i> ${esc(t(`${kind}.restore`))}</button>
             <button class="btn btn--danger" data-act="delete"><i class="ti ti-trash" aria-hidden="true"></i> ${esc(t(`${kind}.delete`))}</button>
           </div>
         </div>`);
      if (g.image) loadCover(row.querySelector('.archive-row__img'), coverUrl(g.image, COVER_THUMB));
      row.querySelector('[data-act="restore"]').addEventListener('click', async () => {
        try {
          await api('POST', a.endpoint(rid, g.id), a.body);
          toast(t(`${kind}.restored`, { title: g.title }));
          showArchive(rid, kind);
        } catch (e) { toast(e.message); }
      });
      row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        if (!confirm(t(`${kind}.deleteConfirm`, { title: g.title }))) return;
        try {
          await api('DELETE', `/api/rounds/${rid}/games/${g.id}`);
          toast(t(`${kind}.deleted`, { title: g.title }));
          showArchive(rid, kind);
        } catch (e) { toast(e.message); }
      });
      list.appendChild(row);
    });
    app.appendChild(list);
  }
}

// =================== Design ===================

