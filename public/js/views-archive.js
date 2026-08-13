/* Spielwirbel – views: the three off-shelf screens — retired, completed and the
   Wunschliste — through one renderer, plus the road a wished expansion takes
   onto the shelf (#664). These are screens, not hub tabs: they are reached from
   the Regal's footer, the desktop rail and the router.
   Part of the frontend; all files share one global script scope. */

// ============ Off-shelf screens: retired, completed & wished-for ============
/*
 * Three parallel screens. All hold games that are NOT in the active collection
 * and offer the same two actions (move back onto the shelf / delete
 * permanently); only the wording, the icon and the flag differ — retiring means
 * "we don't want this any more", completing means "we finished it", wishing
 * means "we don't own it yet" (#250, #560). They share one renderer so they
 * can't drift apart, with ARCHIVES holding everything genuinely per-kind.
 *
 * The wish list is not an archive — it is the one entry here that points
 * forwards rather than back — but it is structurally identical, so giving it
 * its own near-copy of this renderer would be the drift this table prevents.
 * Its two real differences are declared as data: `restoreIcon` (a game arriving
 * on the shelf is not a restoration) and `importStatus`, which is what puts the
 * BGG button on this screen and on neither archive.
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
  wish: {
    icon: 'ti-heart',
    flag: (g) => g.wish,
    at: (g) => g.wishAt,
    endpoint: (rid, gid) => `/api/rounds/${rid}/games/${gid}/wish`,
    body: { wish: false },
    // The Regal's own icon (the hub tab uses it too), because that is literally
    // where the button sends the game — "restore" (ti-arrow-back-up) would claim
    // it is going back somewhere it has never been.
    restoreIcon: 'ti-cards',
    importStatus: 'wishlist',
    canAdd: true,
    // #696: this screen exists to bring games IN, so „Ins Regal" leads the row
    // as the filled primary, and removal drops to the quiet danger-text form
    // the game-detail „Aussortieren" set the precedent for — `btn--danger`
    // stays reserved for the archives, where deleting really is „Endgültig
    // löschen" of a played game. Removing a wish does delete the row outright,
    // so the danger hint (text colour) stays; dominance was the bug.
    primaryRestore: true,
    quietDelete: true,
    // A wished EXPANSION says which game it belongs to, so the row does not read
    // as a game the round could play (#664). `expansionOf` is what marks the row
    // as an expansion at all, and it may be EMPTY — BGG does not always report an
    // inbound link — which is a state the user has to see, because it is the one
    // where "Ins Regal" will ask them to file it by hand. A parent already in
    // the Regal is named by the round's own title, not BGG's primary name (#705).
    note: (g, round) => {
      if (!Array.isArray(g.expansionOf)) return null;
      return g.expansionOf.length
        ? t('wish.expansionOf', { titles: expansionParentTitles(g.expansionOf, (g.source || {}).provider, round.games).join(', ') })
        : t('wish.expansionOfUnknown');
    },
  },
};

const showRetired = (rid) => showArchive(rid, 'retired');
const showCompleted = (rid) => showArchive(rid, 'completed');
// The route segment is 'wishlist' while the i18n/ARCHIVES key is 'wish', which
// is also the data field — so the URL reads as a place and the code reads as a
// game state.
const showWishlist = (rid) => showArchive(rid, 'wish', 'wishlist');

// `kind` keys both ARCHIVES and the i18n namespace (retired.* / completed.* /
// wish.*), so the two stay in lockstep by construction. `seg` is the URL
// segment, which differs from `kind` only for the wish list.
async function showArchive(rid, kind, seg = kind) {
  const a = ARCHIVES[kind];
  currentView = () => showArchive(rid, kind, seg);
  syncUrl(roundPath(rid, seg));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyBackground(round.background);
  setContext(round.name);
  // `kind` keys the i18n namespace, so all three screens are covered by one line.
  setDocTitle(t(`${kind}.title`), round.name);

  // Newest first.
  const games = round.games
    .filter(a.flag)
    .sort((x, y) => String(a.at(y) || '').localeCompare(String(a.at(x) || '')));

  app.innerHTML = '';
  // The URL segment, not `kind` — it is what HUB_TAB_OF is keyed by.
  renderSubScreenTabs(round, seg);
  app.appendChild(backRow(() => showRound(rid, 'regal')));
  const head = h(`<div class="page-head"><div>
         <h1>${esc(t(`${kind}.title`))}</h1>
         <div class="muted">${esc(round.name)}</div>
       </div><div class="section-tools"></div></div>`);
  // Adding by hand and importing in bulk both live on the wish list only: a game
  // enters an archive by being taken off the shelf, never by being created there.
  if (a.canAdd) {
    const addBtn = h(`<button class="link-btn"><i class="ti ti-plus" aria-hidden="true"></i> <span class="tools-label">${esc(t('wish.add'))}</span></button>`);
    addBtn.addEventListener('click', () => showAddGame(round, { wish: true }));
    head.querySelector('.section-tools').appendChild(addBtn);
  }
  // The BGG import pulls the same account's `wishlist=1` shelf that the Regal's
  // own button pulls with `own=1` (#560). Two spellings of the label, switched
  // by width in CSS, exactly like the Regal's (#621).
  if (a.importStatus && canImportBgg()) {
    const importBtn = h(`<button class="link-btn"><i class="ti ti-download" aria-hidden="true"></i> <span class="tools-label tools-label--long">${esc(t('bggImport.wishLink'))}</span><span class="tools-label tools-label--short">${esc(t('bggImport.wishTile'))}</span></button>`);
    importBtn.addEventListener('click', () => showBggImport(round, a.importStatus));
    head.querySelector('.section-tools').appendChild(importBtn);
  }
  app.appendChild(head);

  if (games.length === 0) {
    app.appendChild(h(`<div class="empty"><p>${esc(t(`${kind}.empty`))}</p></div>`));
  } else {
    const list = h('<div class="archive-list"></div>');
    const loadCover = createCoverLoader(); // lazy archive thumbs (#198)
    games.forEach((g) => {
      const fallback = coverPlaceholder(g);
      const when = a.at(g) ? fmtDateTime(a.at(g)) : '?';
      const note = a.note ? a.note(g, round) : null;
      const row = h(`<div class="archive-row">
           <a class="archive-row__img">${fallback}</a>
           <div class="archive-row__body">
             <a class="archive-row__title">${esc(g.title)}</a>
             <div class="muted archive-row__meta"><i class="ti ${a.icon}" aria-hidden="true"></i> ${esc(t(`${kind}.at`, { when }))}</div>
             ${note ? `<div class="muted archive-row__meta">${esc(note)}</div>` : ''}
           </div>
           <div class="archive-row__actions">
             <button class="btn${a.primaryRestore ? ' btn--primary' : ''}" data-act="restore"><i class="ti ${a.restoreIcon || 'ti-arrow-back-up'}" aria-hidden="true"></i> ${esc(t(`${kind}.restore`))}</button>
             ${roundCan(round, 'game.delete') ? `<button class="btn${a.quietDelete ? '' : ' btn--danger'}"${a.quietDelete ? ' style="color:var(--danger)"' : ''} data-act="delete"><i class="ti ti-trash" aria-hidden="true"></i> ${esc(t(`${kind}.delete`))}</button>` : ''}
           </div>
         </div>`);
      if (g.image) loadCover(row.querySelector('.archive-row__img'), coverUrl(g.image, COVER_THUMB));
      // The way back INTO a game that has left the shelf (#663): until these
      // three screens linked their rows, an off-shelf game's detail page — where
      // its title, cover, range and tags are edited — was reachable by URL only.
      // The row itself must NOT become the link: it holds the Restore and Delete
      // buttons, and a <button> inside an <a> is invalid HTML, so this is the
      // "linked half + inert remainder" shape ds-row-is-a-click-target.md
      // records. The cover is flagged redundant — it targets the same game as
      // the title beside it, so it stays mouse-clickable but leaves the tab order
      // and the accessibility tree rather than announcing as a nameless control.
      makeGameLink(row.querySelector('.archive-row__title'), rid, g.id);
      makeGameLink(row.querySelector('.archive-row__img'), rid, g.id, { redundant: true });
      row.querySelector('[data-act="restore"]').addEventListener('click', async () => {
        // A wished EXPANSION takes a different road onto the shelf: it becomes
        // an entry on its base game rather than a game of its own, so the flat
        // `{ wish: false }` below would put a box on the shelf that can never be
        // voted on or drawn (.claude/rules/expansions-widen-by-union.md).
        if (Array.isArray(g.expansionOf)) {
          return acquireWishedExpansion(round, g, () => showArchive(rid, kind, seg));
        }
        try {
          await api('POST', a.endpoint(rid, g.id), a.body);
          toast(t(`${kind}.restored`, { title: g.title }));
          showArchive(rid, kind, seg);
        } catch (e) { toast(e.message); }
      });
      // #137: deleting a game takes its whole rating history with it, so it is
      // co-owner and up — the button is absent below that, hence the null check.
      const delBtn = row.querySelector('[data-act="delete"]');
      if (delBtn) delBtn.addEventListener('click', async () => {
        if (!confirm(t(`${kind}.deleteConfirm`, { title: g.title }))) return;
        try {
          await api('DELETE', `/api/rounds/${rid}/games/${g.id}`);
          toast(t(`${kind}.deleted`, { title: g.title }));
          showArchive(rid, kind, seg);
        } catch (e) { toast(e.message); }
      });
      list.appendChild(row);
    });
    app.appendChild(list);
  }
}

// ============ Acquiring a wished expansion (#664) ============
/*
 * "Ins Regal" on a wished expansion cannot simply clear the wish flag. An
 * expansion is never voted on, drawn, rated or tagged, so a shelf entry for one
 * would be a box the group can never actually put on the table — it belongs on
 * its base game's `expansions` list instead
 * (.claude/rules/expansions-widen-by-union.md).
 *
 * Which game that is, is the only decision, and expansionAcquirePlan() answers
 * it (public/js/wish-expansion.js) so the branching is unit-tested rather than
 * living in a DOM handler.
 */
function acquireWishedExpansion(round, game, done) {
  const plan = expansionAcquirePlan(round, game);
  if (plan.action === 'attach') return attachWishedExpansion(round, game, plan.base, done);
  if (plan.action === 'createBase') return createBaseThenAttach(round, game, plan.parent, done);
  if (plan.action === 'pickParent') {
    return pickExpansionBase(t('wish.pickParent', { title: game.title }),
      plan.choices.map((p) => ({ label: p.title, run: () => createBaseThenAttach(round, game, p, done) })));
  }
  // 'pickBase' — several of the declared parents are here, or none is and the
  // expansion arrived without any, so the user files it against the shelf.
  if (!plan.choices.length) return toast(t('wish.noBase'));
  return pickExpansionBase(t('wish.pickBase', { title: game.title }),
    plan.choices.map((g) => ({ label: g.title, run: () => attachWishedExpansion(round, game, g, done) })));
}

// Write the expansion onto `base` and drop the wish row — one request, because
// the repo does both halves in one transaction.
//
// The base game may itself still be a wish, and then ONE confirm brings both
// onto the shelf: acquiring an expansion for a box the group does not own would
// record an inventory they do not have.
async function attachWishedExpansion(round, game, base, done) {
  const key = base.wish ? 'wish.acquireBothConfirm' : 'wish.acquireConfirm';
  if (!confirm(t(key, { title: game.title, base: base.title }))) return;
  try {
    if (base.wish) await api('POST', `/api/rounds/${round.id}/games/${base.id}/wish`, { wish: false });
    await api('POST', `/api/rounds/${round.id}/games/${game.id}/acquire-expansion`, { baseGameId: base.id });
    toast(t('wish.acquired', { title: game.title, base: base.title }));
    done();
  } catch (e) {
    toast(e.message === 'quota_expansions' ? t('detail.toast.expansionQuota') : e.message);
  }
}

// The base game is not in the round at all, so it has to arrive first. One
// confirm covers both, per #664 — being sent away to add Catan by hand before
// the wish list will accept Seefahrer is the flow nobody finishes.
async function createBaseThenAttach(round, game, parent, done) {
  if (!confirm(t('wish.acquireWithBaseConfirm', { title: game.title, base: parent.title }))) return;
  const provider = (game.source || {}).provider;
  let detail = null;
  try {
    detail = await api('GET', `/api/rounds/${round.id}/lookup/game`
      + `?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(parent.providerId)}`);
  } catch {
    // The inbound link already carries the title, so a failed detail hop costs
    // the cover and the player range — both editable afterwards — rather than
    // the acquisition. A round with this provider switched off lands here too.
  }
  const fd = new FormData();
  fd.append('title', (detail && detail.title) || parent.title);
  // POST /games requires a range, while a game whose range is unknown is meant
  // to be drawable at ANY count (fitsOwnRange, public/js/draw-pool.js). 1–99 is
  // the closest that route can express; the detail page edits it in two taps.
  fd.append('minPlayers', (detail && detail.minPlayers) || 1);
  fd.append('maxPlayers', (detail && detail.maxPlayers) || 99);
  if (detail && detail.imageUrl) fd.append('imageUrl', detail.imageUrl);
  fd.append('sourceProvider', provider);
  fd.append('sourceExternalId', String(parent.providerId));
  if (detail && detail.url) fd.append('sourceUrl', detail.url);

  let base;
  try {
    base = await api('POST', `/api/rounds/${round.id}/games`, fd);
  } catch (e) {
    return toast(e.message === 'quota_games' ? t('addGame.toast.quota') : e.message);
  }
  try {
    await api('POST', `/api/rounds/${round.id}/games/${game.id}/acquire-expansion`, { baseGameId: base.id });
    toast(t('wish.acquired', { title: game.title, base: base.title }));
  } catch (e) {
    // The base game did land, so say what actually happened rather than
    // reporting a failure that would send the user looking for a missing game.
    toast(e.message === 'quota_expansions' ? t('detail.toast.expansionQuota') : e.message);
  }
  done();
}

// Ask which game an expansion belongs to. A plain list sheet: every row is a
// real <button>, so it is focusable and Enter/Space-activated by the platform
// and may keep `.ds-row`'s pointer affordance
// (.claude/rules/ds-row-is-a-click-target.md).
function pickExpansionBase(title, options) {
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog sheet--list" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet__head">
          <h2>${esc(title)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="ds-list wish-pick"></div>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const list = backdrop.querySelector('.wish-pick');
  const dismiss = () => closeSheet();
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) dismiss(); });
  backdrop.querySelector('.sheet__close').addEventListener('click', dismiss);

  options.forEach((opt) => {
    // `class` FIRST, like every other .ds-row site: test/ds-row-affordance.test.js
    // finds construction sites with `<button\s+class="ds-row…"`, so an attribute
    // in front of it makes the row invisible to the guard — it would pass
    // vacuously rather than pinning that this row keeps the affordance.
    const row = h(`<button class="ds-row wish-pick__row" type="button">
        <span class="ds-row__main">${esc(opt.label)}</span>
        <span class="ds-row__meta"><i class="ti ti-chevron-right" aria-hidden="true"></i></span>
      </button>`);
    // Through closeSheet, never on the line after it, or the queued history pop
    // races whatever the choice renders next
    // (.claude/rules/sheet-history-back-dismissal.md).
    row.addEventListener('click', () => closeSheet(opt.run));
    list.appendChild(row);
  });
}
